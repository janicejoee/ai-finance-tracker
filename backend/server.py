from dotenv import load_dotenv

load_dotenv()

import json
import os

from flask import Flask, request, jsonify, session
import plaid
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser

from services.db import (
    supabase_client,
    create_user_by_email,
    find_user_by_email,
    list_transactions,
    update_transaction,
)
from services.plaid_client import plaid_client
from services.transactions import get_transactions

app = Flask(__name__)
app.secret_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']

PLAID_PRODUCTS = os.getenv('PLAID_PRODUCTS', 'transactions').split(',')
PLAID_COUNTRY_CODES = os.getenv('PLAID_COUNTRY_CODES', 'US').split(',')
ALLOWED_FIELDS_UPDATE = {'approved'}  # later: 'category_id', 'entry_type', ...


def empty_to_none(field):
    value = os.getenv(field)
    if value is None or len(value) == 0:
        return None
    return value


PLAID_REDIRECT_URI = empty_to_none('PLAID_REDIRECT_URI')
products = [Products(product) for product in PLAID_PRODUCTS]


def start_session(user):
    session['user_id'] = str(user.id)
    session['email'] = user.email
    return jsonify({'email': user.email})


def require_user_id():
    user_id = session.get('user_id')
    if not user_id:
        return None, (jsonify({'error': 'Sign in required'}), 401)
    return user_id, None


def require_plaid_item():
    user_id, error = require_user_id()
    if error:
        return None, None, error
    rows = supabase_client.table('plaid_items').select(
        'id, access_token'
    ).eq('user_id', user_id).execute().data

    if not rows or not rows[0].get('access_token'):
        return None, None, (jsonify({'error': 'No linked bank account. Connect one first.'}), 400)

    return rows[0]['id'], rows[0]['access_token'], None


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    if not email:
        return jsonify({'error': 'Email is required'}), 400

    user = find_user_by_email(email)
    if not user:
        return jsonify({'error': 'No account for that email'}), 401

    return start_session(user)


@app.route('/api/signup', methods=['POST'])
def signup():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    if not email or '@' not in email:
        return jsonify({'error': 'Email is required'}), 400

    if find_user_by_email(email):
        return jsonify({'error': 'An account with that email already exists'}), 409

    try:
        user = create_user_by_email(email)
    except Exception as e:
        message = str(e).lower()
        if 'already' in message or 'exists' in message or 'registered' in message:
            return jsonify({'error': 'An account with that email already exists'}), 409
        print(f'[signup] {e}')
        return jsonify({'error': 'Could not create account'}), 500

    if not user or not user.email:
        return jsonify({'error': 'Could not create account'}), 500

    response = start_session(user)
    return response, 201


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/me', methods=['GET'])
def me():
    email = session.get('email')
    if not session.get('user_id') or not email:
        return jsonify({'error': 'Sign in required'}), 401
    return jsonify({'email': email})


@app.route('/api/link_status', methods=['GET'])
def link_status():
    user_id, error = require_user_id()
    if error:
        return error
    rows = supabase_client.table('plaid_items').select(
        'id, access_token'
    ).eq('user_id', user_id).execute().data

    linked = bool(rows and rows[0].get('access_token'))
    return jsonify({'linked': linked})


@app.route('/api/create_link_token', methods=['POST'])
def create_link_token():
    user_id, error = require_user_id()
    if error:
        return error

    link_request = LinkTokenCreateRequest(
        products=products,
        client_name='Expenses Tracker',
        country_codes=[CountryCode(code) for code in PLAID_COUNTRY_CODES],
        language='en',
        user=LinkTokenCreateRequestUser(
            client_user_id=user_id
        )
    )

    if PLAID_REDIRECT_URI is not None:
        link_request['redirect_uri'] = PLAID_REDIRECT_URI

    response = plaid_client.link_token_create(link_request)
    return jsonify(response.to_dict())


@app.route('/api/set_access_token', methods=['POST'])
def set_access_token():
    public_token = request.form['public_token']
    user_id, error = require_user_id()
    if error:
        return error

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

@app.route('/api/transactions/<plaid_transaction_id>', methods=['PATCH'])
def patch_transaction(plaid_transaction_id):
    plaid_item_id, _, error = require_plaid_item()
    if error:
        return error

    data = request.get_json(silent=True) or {}
    fields = {key: data[key] for key in ALLOWED_FIELDS_UPDATE if key in data}
    if not fields:
        return jsonify({'error': 'No fields to update'}), 400

    result = update_transaction(plaid_item_id, plaid_transaction_id, fields)
    if not result:
        return jsonify({'error': 'Transaction not found'}), 404
    return jsonify(result)

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
