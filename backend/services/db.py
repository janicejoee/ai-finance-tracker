import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

def _date(value):
    return datetime.strptime(value, '%Y-%m-%d').date()

def _row(transaction, plaid_item_id):
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
        'pending': transaction.get('pending', False),
        'plaid_category_primary': category.get('primary'),
        'plaid_category_detailed': category.get('detailed'),
        'logo_url': transaction.get('logo_url') or transaction.get('personal_finance_category_icon_url'),
        'entry_type': 'expense' if amount > 0 else 'income',
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
    rows = [_row(transaction, plaid_item_id) for transaction in added + modified]

    if rows:
        supabase_client.from_('transactions').upsert(
            rows,
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


def list_transactions(plaid_item_id):
    result = (
        supabase_client.from_('transactions')
        .select('plaid_transaction_id, name, merchant_name, amount, date')
        .eq('plaid_item_id', plaid_item_id)
        .is_('deleted_at', 'null')
        .order('date', desc=True)
        .execute()
    )
    return result.data or []
