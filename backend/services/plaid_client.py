import os

import plaid
from dotenv import load_dotenv
from plaid.api import plaid_api

load_dotenv()

host = plaid.Environment.Sandbox
if os.getenv('PLAID_ENV', 'sandbox') == 'production':
    host = plaid.Environment.Production

configuration = plaid.Configuration(
    host=host,
    api_key={
        'clientId': os.getenv('PLAID_CLIENT_ID'),
        'secret': os.getenv('PLAID_SECRET'),
        'plaidVersion': '2020-09-14'
    }
)

api_client = plaid.ApiClient(configuration)
plaid_client = plaid_api.PlaidApi(api_client)
