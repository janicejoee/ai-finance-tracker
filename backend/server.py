from dotenv import load_dotenv

load_dotenv()

import json
import os
import time

from flask import Flask, request, jsonify
import plaid
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser

from services.db import supabase_client, list_transactions
from services.plaid_client import plaid_client
from services.transactions import get_transactions

app = Flask(__name__)

PLAID_PRODUCTS = os.getenv('PLAID_PRODUCTS', 'transactions').split(',')
PLAID_COUNTRY_CODES = os.getenv('PLAID_COUNTRY_CODES', 'US').split(',')


def empty_to_none(field):
    value = os.getenv(field)
    if value is None or len(value) == 0:
        return None
    return value


PLAID_REDIRECT_URI = empty_to_none('PLAID_REDIRECT_URI')
products = [Products(product) for product in PLAID_PRODUCTS]


def get_user_id():
    user_id = os.getenv('DEFAULT_USER_ID')
    if not user_id:
        raise RuntimeError('No user ID found')
    return user_id


def require_plaid_item():
    user_id = get_user_id()
    rows = supabase_client.table('plaid_items').select(
        'id, access_token'
    ).eq('user_id', user_id).execute().data

    if not rows or not rows[0].get('access_token'):
        return None, None, (jsonify({'error': 'No linked bank account. Connect one first.'}), 400)

    return rows[0]['id'], rows[0]['access_token'], None


@app.route('/api/link_status', methods=['GET'])
def link_status():
    user_id = get_user_id()
    rows = supabase_client.table('plaid_items').select(
        'id, access_token'
    ).eq('user_id', user_id).execute().data

    linked = bool(rows and rows[0].get('access_token'))
    return jsonify({'linked': linked})


@app.route('/api/create_link_token', methods=['POST'])
def create_link_token():
    link_request = LinkTokenCreateRequest(
        products=products,
        client_name='Expenses Tracker',
        country_codes=[CountryCode(code) for code in PLAID_COUNTRY_CODES],
        language='en',
        user=LinkTokenCreateRequestUser(
            client_user_id=str(time.time())
        )
    )

    if PLAID_REDIRECT_URI is not None:
        link_request['redirect_uri'] = PLAID_REDIRECT_URI

    response = plaid_client.link_token_create(link_request)
    return jsonify(response.to_dict())


@app.route('/api/set_access_token', methods=['POST'])
def set_access_token():
    public_token = request.form['public_token']
    user_id = get_user_id()

    exchange_request = ItemPublicTokenExchangeRequest(public_token=public_token)
    exchange_response = plaid_client.item_public_token_exchange(exchange_request)

    plaid_item_id = exchange_response['item_id']
    access_token = exchange_response['access_token']

    try:
        supabase_client.table('plaid_items').upsert(
            {
                'user_id': user_id,
                'plaid_item_id': plaid_item_id,
                'access_token': access_token,
                'transactions_cursor': '',
            },
            on_conflict='plaid_item_id',
        ).execute()
    except Exception as e:
        return jsonify({'error': f'Failed to save bank link: {e}'}), 500

    return jsonify({
        'item_id': plaid_item_id,
        'success': True,
    })


@app.route('/api/transactions', methods=['GET'])
def transactions():
    plaid_item_id, access_token, error = require_plaid_item()
    if error:
        return error

    get_transactions(access_token)
    return jsonify(list_transactions(plaid_item_id))


@app.route('/api/link_exit_error', methods=['POST'])
def link_exit_error():
    data = request.get_json()
    print('[Link Exit Error (frontend)]')
    print(json.dumps(data, indent=2, sort_keys=True, default=str))
    return jsonify({'status': 'logged'})


def format_error(e):
    response = json.loads(e.body)
    return {'error': {**response, 'status_code': e.status}}


@app.errorhandler(plaid.ApiException)
def handle_plaid_error(e):
    response = format_error(e)
    print(json.dumps(response, indent=2, sort_keys=True, default=str))
    return jsonify(response), e.status


if __name__ == '__main__':
    app.run(port=int(os.getenv('PORT', 8000)))
