import os
import re
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

def to_transaction_row(transaction, plaid_item_id):
    date = transaction['date']
    if hasattr(date, 'isoformat'):
        date = date.isoformat()

    category = transaction.get('personal_finance_category') or {}
    amount = float(transaction['amount'])

    return {
        'plaid_item_id': plaid_item_id,
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

def add_transactions(access_token, added, modified, removed, cursor):
    item = (
        supabase_client.from_('plaid_items')
        .select('id')
        .eq('access_token', access_token)
        .single()
        .execute()
    )

    plaid_item_id = item.data['id']
    posted = [transaction for transaction in added + modified if not transaction.get('pending')]
    posted_transaction_rows = [to_transaction_row(transaction, plaid_item_id) for transaction in posted]

    if posted_transaction_rows:
        # Leave category_id off the payload. Inserts get it from the
        # set_default_category trigger; updates must keep a user's choice.
        supabase_client.from_('transactions').upsert(
            posted_transaction_rows,
            on_conflict='plaid_transaction_id',
        ).execute()

    deleted_at = datetime.now(timezone.utc).isoformat()
    for item in removed:
        transaction_id = item['transaction_id'] if isinstance(item, dict) else item
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

def list_transactions(plaid_item_id):
    result = (
        supabase_client.from_('transactions')
        .select(
            'plaid_transaction_id, name, merchant_name, amount, date, approved, entry_type, category_id'
        )
        .eq('plaid_item_id', plaid_item_id)
        .is_('deleted_at', 'null')
        .order('date', desc=True)
        .execute()
    )
    names = {row['id']: row['name'] for row in list_categories()}
    rows = result.data or []
    for row in rows:
        row['category_name'] = names.get(row.get('category_id'))
    return rows

def update_transaction(plaid_item_id, plaid_transaction_id, fields):
    result = (
        supabase_client.from_('transactions')
        .update(fields)
        .eq('plaid_item_id', plaid_item_id)
        .eq('plaid_transaction_id', plaid_transaction_id)
        .is_('deleted_at', 'null')
        .execute()
    )
    return result.data or []