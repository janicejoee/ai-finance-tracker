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
from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest

from services.db import supabase_client
from services.plaid_client import plaid_client
from services.transactions import (
    sync_transactions,
    fetch_transactions,
)
from services.categorization import categorize_uncategorized_transactions
from services.categories import (
    assign_transaction_category,
    create_expense_category,
    delete_expense_category,
    list_expense_categories,
    update_expense_category,
)
from services.insights import generate_insights

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
def get_transactions():
    plaid_item_id, access_token, error = require_plaid_item()
    if error:
        return error

    user_id = get_user_id()

    try:
        added, modified, removed = sync_transactions(plaid_item_id, access_token)
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500

    categorized = 0
    try:
        result = categorize_uncategorized_transactions(user_id)
        categorized = result.get('categorized', 0)
    except Exception as e:
        print(f'[auto-categorize] Failed after sync: {e}')

    return jsonify({
        'transactions': fetch_transactions(user_id),
        'added': added,
        'modified': modified,
        'removed': removed,
        'categorized': categorized,
    })


@app.route('/api/balance', methods=['GET'])
def get_balance():
    _, access_token, error = require_plaid_item()
    if error:
        return error

    balance_request = AccountsBalanceGetRequest(access_token=access_token)
    balance_response = plaid_client.accounts_balance_get(balance_request).to_dict()
    return jsonify(balance_response)


@app.route('/api/insights', methods=['GET'])
def get_insights():
    _, _, error = require_plaid_item()
    if error:
        return error

    user_id = get_user_id()

    try:
        insight = generate_insights(user_id)
    except Exception as e:
        return jsonify({'error': f'Failed to generate insights: {e}'}), 500

    return jsonify({'insight': insight})


@app.route('/api/categories', methods=['GET'])
def get_categories():
    return jsonify({'categories': list_expense_categories()})


@app.route('/api/categories', methods=['POST'])
def post_category():
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    if not name or not str(name).strip():
        return jsonify({'error': 'name is required'}), 400

    try:
        category = create_expense_category(str(name))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Failed to create category: {e}'}), 500

    return jsonify({'category': category}), 201


@app.route('/api/categories/<category_id>', methods=['PATCH'])
def patch_category(category_id):
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    if not name or not str(name).strip():
        return jsonify({'error': 'name is required'}), 400

    try:
        category = update_expense_category(category_id, str(name))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Failed to update category: {e}'}), 500

    return jsonify({'category': category})


@app.route('/api/categories/<category_id>', methods=['DELETE'])
def remove_category(category_id):
    try:
        delete_expense_category(category_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Failed to delete category: {e}'}), 500

    return jsonify({'success': True})


@app.route('/api/transactions/<plaid_transaction_id>/category', methods=['PATCH'])
def patch_transaction_category(plaid_transaction_id):
    _, _, error = require_plaid_item()
    if error:
        return error

    data = request.get_json(silent=True) or {}
    category_id = data.get('category_id')
    category_name = data.get('category_name')

    if not category_id and not category_name:
        return jsonify({'error': 'category_id or category_name is required'}), 400

    user_id = get_user_id()

    try:
        transaction = assign_transaction_category(
            user_id,
            plaid_transaction_id,
            category_id=category_id,
            category_name=str(category_name).strip() if category_name else None,
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Failed to assign category: {e}'}), 500

    return jsonify({'transaction': transaction})


@app.route('/api/categorize', methods=['POST'])
def categorize():
    plaid_item_id, access_token, error = require_plaid_item()
    if error:
        return error

    user_id = get_user_id()

    try:
        sync_transactions(plaid_item_id, access_token)
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500

    try:
        result = categorize_uncategorized_transactions(user_id)
    except Exception as e:
        return jsonify({'error': f'Categorization failed: {e}'}), 500

    if result.get('message'):
        return jsonify(result), 200

    return jsonify(result)    

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
