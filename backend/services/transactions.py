from services.db import get_latest_cursor_or_none, add_transactions
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from services.plaid_client import plaid_client


def get_transactions(access_token):
    """Pull transactions from Plaid. An empty cursor returns the full history in `added`."""
    cursor = get_latest_cursor_or_none(access_token) or ''

    added = []
    modified = []
    removed = []
    has_more = True

    while has_more:
        request = TransactionsSyncRequest(
            access_token=access_token,
            cursor=cursor,
        )
        response = plaid_client.transactions_sync(request).to_dict()

        added.extend(response['added'])
        modified.extend(response['modified'])
        removed.extend(response['removed'])

        has_more = response['has_more']
        cursor = response['next_cursor']
    
    add_transactions(access_token, added, modified, removed, cursor)
