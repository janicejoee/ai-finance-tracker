import time
from datetime import datetime, timezone

from plaid.model.transactions_sync_request import TransactionsSyncRequest

from services.batch import DB_BATCH_SIZE, chunked
from services.db import supabase_client
from services.plaid_client import plaid_client


def _serialize_value(value):
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return value


def entry_type_from_amount(amount) -> str:
    return 'expense' if float(amount) > 0 else 'income'


def transaction_name(transaction) -> str:
    return (
        transaction.get('name')
        or transaction.get('merchant_name')
        or transaction.get('original_description')
        or 'Unknown transaction'
    )


def transaction_icon_url(transaction) -> str | None:
    """Best display icon from Plaid: merchant logo, then category icon."""
    url = transaction.get('logo_url')
    if url:
        return url

    for counterparty in transaction.get('counterparties') or []:
        if counterparty.get('type') == 'merchant' and counterparty.get('logo_url'):
            return counterparty['logo_url']

    for counterparty in transaction.get('counterparties') or []:
        if counterparty.get('logo_url'):
            return counterparty['logo_url']

    return transaction.get('personal_finance_category_icon_url')


def get_plaid_item_ids(user_id):
    rows = supabase_client.table('plaid_items').select('id').eq(
        'user_id', user_id
    ).execute().data or []
    return [row['id'] for row in rows]


def merge_transactions(plaid_item_id, added, modified, removed):
    rows = []
    for transaction in added + modified:
        pfc = transaction.get('personal_finance_category') or {}
        rows.append({
            'plaid_item_id': plaid_item_id,
            'plaid_transaction_id': transaction['transaction_id'],
            'plaid_account_id': transaction.get('account_id'),
            'name': transaction_name(transaction),
            'merchant_name': transaction.get('merchant_name'),
            'logo_url': transaction_icon_url(transaction),
            'date': _serialize_value(transaction['date']),
            'amount': float(transaction['amount']),
            'iso_currency_code': transaction.get('iso_currency_code'),
            'pending': transaction.get('pending', False),
            'plaid_category_primary': pfc.get('primary'),
            'plaid_category_detailed': pfc.get('detailed'),
            'entry_type': entry_type_from_amount(transaction['amount']),
            'deleted_at': None,
        })

    deleted_at = datetime.now(timezone.utc).isoformat()

    try:
        for batch in chunked(rows, DB_BATCH_SIZE):
            supabase_client.table('transactions').upsert(
                batch,
                on_conflict='plaid_transaction_id',
            ).execute()

        for batch in chunked(removed, DB_BATCH_SIZE):
            supabase_client.table('transactions').update({
                'deleted_at': deleted_at,
            }).eq('plaid_item_id', plaid_item_id).in_(
                'plaid_transaction_id', batch
            ).execute()
    except Exception as e:
        raise RuntimeError(f'Failed to save transactions: {e}') from e


def sync_transactions(plaid_item_id, access_token):
    item_row = supabase_client.table('plaid_items').select(
        'transactions_cursor'
    ).eq('id', plaid_item_id).single().execute().data

    if not item_row:
        raise RuntimeError('No linked bank account found')

    cursor = item_row.get('transactions_cursor') or ''
    added, modified, removed = [], [], []
    has_more = True
    page_index = 0
    while has_more:
        sync_request = TransactionsSyncRequest(
            access_token=access_token,
            cursor=cursor,
        )
        response = plaid_client.transactions_sync(sync_request).to_dict()
        page_index += 1

        cursor = response['next_cursor']

        if cursor == '':
            time.sleep(2)
            continue

        page_added = response['added']
        page_modified = response['modified']
        page_removed = response['removed']

        merge_transactions(plaid_item_id, page_added, page_modified, page_removed)

        added.extend(page_added)
        modified.extend(page_modified)
        removed.extend(page_removed)
        has_more = response['has_more']

    supabase_client.table('plaid_items').update({
        'transactions_cursor': cursor,
    }).eq('id', plaid_item_id).execute()

    return added, modified, removed


def fetch_transactions(user_id):
    item_ids = get_plaid_item_ids(user_id)
    if not item_ids:
        return []

    result = supabase_client.table('transactions').select(
        'plaid_transaction_id, name, amount, date, iso_currency_code, category_id, entry_type, logo_url, expense_categories(name)'
    ).in_('plaid_item_id', item_ids).is_('deleted_at', 'null').order(
        'date', desc=True
    ).execute()

    transactions = []
    for row in result.data or []:
        category = row.pop('expense_categories', None) or {}
        row['category_name'] = category.get('name')
        transactions.append(row)

    return transactions
