import os
import re
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

TRANSFER_PRIMARIES = {'TRANSFER_IN', 'TRANSFER_OUT', 'EQUITY_AND_INVESTMENTS'}
EXPENSE_DETAILED = {'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'}   # Zelle etc. sent out
INCOME_DETAILED = {'TRANSFER_IN_TRANSFER_IN_FROM_APPS'}      # Zelle etc. received
CARD_PAYMENT_NAME = re.compile(r'payment\s*-?\s*thank', re.IGNORECASE)
TRANSACTION_LIST_SELECT = (
    'plaid_transaction_id, name, merchant_name, amount, date, approved, entry_type, category_id'
)
ENTRY_TYPES = {'expense', 'income', 'transfer'}

def find_user_by_email(email):
    target = email.strip().lower()
    if not target:
        return None

    page = 1
    while True:
        users = supabase_client.auth.admin.list_users(page=page, per_page=200)
        if not users:
            return None
        for user in users:
            if user.email and user.email.lower() == target:
                return user
        if len(users) < 200:
            return None
        page += 1

def create_user_by_email(email):
    created = supabase_client.auth.admin.create_user({
        'email': email.strip().lower(),
        'email_confirm': True,
    })
    return created.user

def classify_transaction_type(transaction):
    category = transaction.get('personal_finance_category') or {}
    primary = category.get('primary')
    detailed = category.get('detailed')
    name = transaction.get('name') or ''

    if CARD_PAYMENT_NAME.search(name):
        return 'transfer'
    if detailed in EXPENSE_DETAILED:
        return 'expense'
    if detailed in INCOME_DETAILED:
        return 'income'
    if primary in TRANSFER_PRIMARIES or detailed == 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT':
        return 'transfer'
    if primary == 'INCOME':
        return 'income'
    return 'expense'     # positive = purchase, negative = refund

def to_transaction_row(transaction, item_id, user_id):
    date = transaction['date']
    if hasattr(date, 'isoformat'):
        date = date.isoformat()

    category = transaction.get('personal_finance_category') or {}
    amount = float(transaction['amount'])

    return {
        'item_id': item_id,
        'user_id': user_id,
        'plaid_transaction_id': transaction['transaction_id'],
        'plaid_account_id': transaction.get('account_id'),
        'name': transaction.get('name') or 'Unknown transaction',
        'merchant_name': transaction.get('merchant_name'),
        'amount': amount,
        'date': str(date)[:10],
        'iso_currency_code': transaction.get('iso_currency_code'),
        'plaid_category_primary': category.get('primary'),
        'plaid_category_detailed': category.get('detailed'),
        'logo_url': transaction.get('logo_url') or transaction.get('personal_finance_category_icon_url'),
        'entry_type': classify_transaction_type(transaction),
    }

def get_latest_cursor_or_none(access_token):
    cursor = (
        supabase_client.from_('plaid_items')
        .select('transactions_cursor')
        .eq('access_token', access_token)
        .single()
        .execute()
        )
    
    if cursor.data is None:
        return None
    return cursor.data['transactions_cursor']

USER_EDITABLE_SYNC_FIELDS = ('name', 'amount', 'date', 'entry_type')

def add_transactions(access_token, added, modified, removed, cursor):
    item = (
        supabase_client.from_('plaid_items')
        .select('id, user_id')
        .eq('access_token', access_token)
        .single()
        .execute()
    )

    item_id = item.data['id']
    user_id = item.data['user_id']
    posted = [transaction for transaction in added + modified if not transaction.get('pending')]
    posted_transaction_rows = [
        to_transaction_row(transaction, item_id, user_id) for transaction in posted
    ]

    if posted_transaction_rows:
        # Leave category_id off the payload. Inserts get it from the
        # set_default_category trigger; updates must keep a user's choice.
        # Existing rows also keep name/amount/date/entry_type so edits survive sync.
        plaid_ids = [row['plaid_transaction_id'] for row in posted_transaction_rows]
        existing = set()
        for i in range(0, len(plaid_ids), 100):
            chunk = plaid_ids[i:i + 100]
            found = (
                supabase_client.from_('transactions')
                .select('plaid_transaction_id')
                .in_('plaid_transaction_id', chunk)
                .execute()
            )
            for row in found.data or []:
                existing.add(row['plaid_transaction_id'])

        for row in posted_transaction_rows:
            if row['plaid_transaction_id'] in existing:
                for field in USER_EDITABLE_SYNC_FIELDS:
                    row.pop(field, None)

        supabase_client.from_('transactions').upsert(
            posted_transaction_rows,
            on_conflict='plaid_transaction_id',
        ).execute()

    deleted_at = datetime.now(timezone.utc).isoformat()
    for removed_item in removed:
        transaction_id = (
            removed_item['transaction_id']
            if isinstance(removed_item, dict)
            else removed_item
        )
        supabase_client.from_('transactions').update({
            'deleted_at': deleted_at,
        }).eq('plaid_transaction_id', transaction_id).execute()
    
    supabase_client.from_('plaid_items').update({
        'transactions_cursor': cursor
    }).eq('access_token', access_token).execute()


def list_categories():
    result = (
        supabase_client.from_('categories')
        .select('id, name')
        .order('sort_order')
        .execute()
    )
    return result.data or []

def get_category(category_id):
    result = (
        supabase_client.from_('categories')
        .select('id, name')
        .eq('id', category_id)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None

def with_category_names(rows):
    names = {row['id']: row['name'] for row in list_categories()}
    for row in rows:
        row['category_name'] = names.get(row.get('category_id'))
    return rows

def list_transactions(user_id):
    result = (
        supabase_client.from_('transactions')
        .select(TRANSACTION_LIST_SELECT)
        .eq('user_id', user_id)
        .is_('deleted_at', 'null')
        .order('date', desc=True)
        .execute()
    )
    return with_category_names(result.data or [])

def stored_amount(amount, entry_type):
    return -abs(amount) if entry_type == 'income' else abs(amount)

def fetch_transaction(user_id, plaid_transaction_id):
    result = (
        supabase_client.from_('transactions')
        .select(TRANSACTION_LIST_SELECT)
        .eq('user_id', user_id)
        .eq('plaid_transaction_id', plaid_transaction_id)
        .is_('deleted_at', 'null')
        .limit(1)
        .execute()
    )
    rows = with_category_names(result.data or [])
    return rows[0] if rows else None

def create_manual_transaction(user_id, name, amount, date, entry_type, category_id=None):
    row = {
        'user_id': user_id,
        'item_id': None,
        'plaid_transaction_id': f'manual-{uuid.uuid4()}',
        'name': name,
        'amount': stored_amount(amount, entry_type),
        'date': date,
        'iso_currency_code': 'USD',
        'entry_type': entry_type,
        'approved': True,
        'category_id': category_id,
    }
    result = (
        supabase_client.from_('transactions')
        .insert(row)
        .execute()
    )
    created = result.data or []
    if not created:
        return None
    return fetch_transaction(user_id, created[0]['plaid_transaction_id'])

def update_transaction(user_id, plaid_transaction_id, fields):
    result = (
        supabase_client.from_('transactions')
        .update(fields)
        .eq('user_id', user_id)
        .eq('plaid_transaction_id', plaid_transaction_id)
        .is_('deleted_at', 'null')
        .execute()
    )
    if not result.data:
        return None
    return fetch_transaction(user_id, plaid_transaction_id)

def soft_delete_transaction(user_id, plaid_transaction_id):
    deleted_at = datetime.now(timezone.utc).isoformat()
    result = (
        supabase_client.from_('transactions')
        .update({'deleted_at': deleted_at})
        .eq('user_id', user_id)
        .eq('plaid_transaction_id', plaid_transaction_id)
        .is_('deleted_at', 'null')
        .execute()
    )
    return bool(result.data)