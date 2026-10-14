from dotenv import load_dotenv

load_dotenv()

import json
import math
import os
import uuid
from datetime import datetime

from flask import Flask, request, jsonify, session
import plaid
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser

from chat.routes import chat_bp
from services.db import (
    ENTRY_TYPES,
    MAX_NAME_LENGTH,
    MIN_PASSWORD_LENGTH,
    supabase_client,
    create_manual_transaction,
    create_user_by_email,
    fetch_transaction,
    find_user_by_email,
    get_category,
    list_categories,
    list_transactions,
    sign_in_with_password,
    soft_delete_transaction,
    stored_amount,
    update_transaction,
    user_display_name,
)
from services.plaid_client import plaid_client
from services.transactions import get_transactions

app = Flask(__name__)
app.secret_key = os.environ['FLASK_SECRET_KEY']
app.register_blueprint(chat_bp)

PLAID_PRODUCTS = os.getenv('PLAID_PRODUCTS', 'transactions').split(',')
PLAID_COUNTRY_CODES = os.getenv('PLAID_COUNTRY_CODES', 'US').split(',')
ALLOWED_FIELDS_UPDATE = {
    'approved',
    'category_id',
    'name',
    'date',
    'entry_type',
    'amount',
}

def empty_to_none(field):
    value = os.getenv(field)
    if value is None or len(value) == 0:
        return None
    return value


PLAID_REDIRECT_URI = empty_to_none('PLAID_REDIRECT_URI')
products = [Products(product) for product in PLAID_PRODUCTS]


def start_session(user):
    name = user_display_name(user)
    session['user_id'] = str(user.id)
    session['email'] = user.email
    session['name'] = name
    return jsonify({'email': user.email, 'name': name})


def require_user_id():
    user_id = session.get('user_id')
    if not user_id:
        return None, (jsonify({'error': 'Sign in required'}), 401)
    return user_id, None


def get_linked_access_token(user_id):
    rows = supabase_client.table('plaid_items').select(
        'access_token'
    ).eq('user_id', user_id).execute().data

    if not rows or not rows[0].get('access_token'):
        return None
    return rows[0]['access_token']


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    try:
        user = sign_in_with_password(email, password)
    except Exception as e:
        print(f'[login] {e}')
        return jsonify({'error': 'Invalid email or password'}), 401

    if not user or not user.email:
        return jsonify({'error': 'Invalid email or password'}), 401

    return start_session(user)


@app.route('/api/signup', methods=['POST'])
def signup():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()
    if not email or '@' not in email:
        return jsonify({'error': 'Email is required'}), 400
    if not name or len(name) > MAX_NAME_LENGTH:
        return jsonify({'error': 'Name is required'}), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify({
            'error': f'Password must be at least {MIN_PASSWORD_LENGTH} characters',
        }), 400

    if find_user_by_email(email):
        return jsonify({'error': 'An account with that email already exists'}), 409

    try:
        user = create_user_by_email(email, password, name)
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


@app.route('/api/session', methods=['GET'])
def current_session():
    email = session.get('email')
    if not session.get('user_id') or not email:
        return jsonify({'error': 'Sign in required'}), 401
    return jsonify({'email': email, 'name': session.get('name')})


@app.route('/api/bank', methods=['GET'])
def bank_status():
    user_id, error = require_user_id()
    if error:
        return error
    rows = supabase_client.table('plaid_items').select(
        'id, access_token'
    ).eq('user_id', user_id).execute().data

    linked = bool(rows and rows[0].get('access_token'))
    return jsonify({'linked': linked})


@app.route('/api/bank/link-token', methods=['POST'])
def bank_link_token():
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


@app.route('/api/bank/connect', methods=['POST'])
def connect_bank():
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


@app.route('/api/categories', methods=['GET'])
def categories():
    _, error = require_user_id()
    if error:
        return error
    return jsonify(list_categories())


@app.route('/api/transactions', methods=['GET'])
def transactions():
    user_id, error = require_user_id()
    if error:
        return error

    access_token = get_linked_access_token(user_id)
    if access_token:
        get_transactions(access_token)
    return jsonify(list_transactions(user_id))


def parse_category_id(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError
    return str(uuid.UUID(value))


def parse_manual_category_id(data):
    if 'category_id' not in data:
        return None, None
    try:
        category_id = parse_category_id(data['category_id'])
    except (ValueError, TypeError):
        return None, (jsonify({'error': 'category_id must be a category id'}), 400)
    if category_id is not None and not get_category(category_id):
        return None, (jsonify({'error': 'Unknown category'}), 400)
    return category_id, None


def parse_positive_amount(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None, (jsonify({'error': 'amount must be a positive number'}), 400)
    if not math.isfinite(amount) or amount <= 0:
        return None, (jsonify({'error': 'amount must be a positive number'}), 400)
    return amount, None


def parse_date_value(value):
    if not isinstance(value, str):
        return None, (jsonify({'error': 'date must be YYYY-MM-DD'}), 400)
    try:
        return datetime.strptime(value, '%Y-%m-%d').date().isoformat(), None
    except ValueError:
        return None, (jsonify({'error': 'date must be YYYY-MM-DD'}), 400)


@app.route('/api/transactions', methods=['POST'])
def create_transaction():
    user_id, error = require_user_id()
    if error:
        return error

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400

    amount, amount_error = parse_positive_amount(data.get('amount'))
    if amount_error:
        return amount_error

    date, date_error = parse_date_value(data.get('date'))
    if date_error:
        return date_error

    entry_type = data.get('entry_type')
    if entry_type not in ENTRY_TYPES:
        return jsonify({'error': 'entry_type must be expense, income, or transfer'}), 400

    category_id, category_error = parse_manual_category_id(data)
    if category_error:
        return category_error

    created = create_manual_transaction(
        user_id,
        name=name,
        amount=amount,
        date=date,
        entry_type=entry_type,
        category_id=category_id,
    )
    if not created:
        return jsonify({'error': 'Could not create transaction'}), 500
    return jsonify(created), 201


@app.route('/api/transactions/<plaid_transaction_id>', methods=['PATCH'])
def patch_transaction(plaid_transaction_id):
    user_id, error = require_user_id()
    if error:
        return error

    data = request.get_json(silent=True) or {}
    fields = {key: data[key] for key in ALLOWED_FIELDS_UPDATE if key in data}
    if not fields:
        return jsonify({'error': 'No fields to update'}), 400

    if 'name' in fields:
        name = (fields['name'] or '').strip() if isinstance(fields['name'], str) else ''
        if not name:
            return jsonify({'error': 'name is required'}), 400
        fields['name'] = name

    if 'date' in fields:
        date, date_error = parse_date_value(fields['date'])
        if date_error:
            return date_error
        fields['date'] = date

    if 'entry_type' in fields and fields['entry_type'] not in ENTRY_TYPES:
        return jsonify({'error': 'entry_type must be expense, income, or transfer'}), 400

    if 'amount' in fields:
        amount, amount_error = parse_positive_amount(fields['amount'])
        if amount_error:
            return amount_error
        fields['amount'] = amount

    if 'category_id' in fields:
        try:
            category_id = parse_category_id(fields['category_id'])
        except (ValueError, TypeError):
            return jsonify({'error': 'category_id must be a category id'}), 400
        if category_id is not None and not get_category(category_id):
            return jsonify({'error': 'Unknown category'}), 400
        fields['category_id'] = category_id

    if 'amount' in fields or 'entry_type' in fields:
        current = fetch_transaction(user_id, plaid_transaction_id)
        if not current:
            return jsonify({'error': 'Transaction not found'}), 404
        entry_type = fields.get('entry_type', current.get('entry_type'))
        if entry_type not in ENTRY_TYPES:
            return jsonify({'error': 'entry_type must be expense, income, or transfer'}), 400
        if 'amount' in fields:
            magnitude = fields['amount']
        else:
            magnitude = abs(float(current['amount']))
        fields['amount'] = stored_amount(magnitude, entry_type)
        fields['entry_type'] = entry_type

    result = update_transaction(user_id, plaid_transaction_id, fields)
    if not result:
        return jsonify({'error': 'Transaction not found'}), 404
    return jsonify(result)


@app.route('/api/transactions/<plaid_transaction_id>', methods=['DELETE'])
def delete_transaction(plaid_transaction_id):
    user_id, error = require_user_id()
    if error:
        return error

    if not soft_delete_transaction(user_id, plaid_transaction_id):
        return jsonify({'error': 'Transaction not found'}), 404
    return jsonify({'ok': True})

def format_error(e):
    response = json.loads(e.body)
    return {'error': {**response, 'status_code': e.status}}


@app.errorhandler(plaid.ApiException)
def handle_plaid_error(e):
    response = format_error(e)
    print(json.dumps(response, indent=2, sort_keys=True, default=str))
    return jsonify(response), e.status


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 8000)))
