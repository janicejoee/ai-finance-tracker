# Expenses Tracker

A personal finance tracker that links bank accounts via [Plaid](https://plaid.com), stores transactions in [Supabase](https://supabase.com), and uses Claude to categorize spending.

## Features

- Connect a bank account through Plaid Link
- Sync transactions and account balances
- AI-powered expense categorization (Claude)
- Dashboard with balance summary, spending charts, and separated income/expense lists

## Project structure

```
expenses_tracker/
├── backend/          # Flask API (Plaid, Supabase, Anthropic)
│   ├── server.py
│   ├── start.sh
│   ├── requirements.txt
│   └── services/
└── frontend/         # React + Vite + Tailwind
    └── src/
```

## Prerequisites

- Python 3.8+
- Node.js 18+
- [Plaid](https://dashboard.plaid.com/) account (Sandbox is fine for development)
- [Supabase](https://supabase.com/) project
- [Anthropic](https://console.anthropic.com/) API key (for categorization)

## Setup

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd expenses_tracker
```

### 2. Configure environment variables

Create `backend/.env` with:

```env
# Plaid
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
PLAID_PRODUCTS=transactions
PLAID_COUNTRY_CODES=US

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# App
DEFAULT_USER_ID=          # UUID for your user row in Supabase
ANTHROPIC_API_KEY=
ANTHROPIC_CATEGORIZE_MODEL=claude-haiku-4-5
ANTHROPIC_INSIGHTS_MODEL=claude-haiku-4-5

# Optional
PORT=8000
PLAID_REDIRECT_URI=       # only needed for OAuth institutions
```

Get Plaid keys from the [Plaid Dashboard](https://dashboard.plaid.com/developers/keys).

> Never commit `.env` or expose service role keys. The root `.gitignore` already excludes `.env`.

### 3. Database (Supabase)

Create these tables in your Supabase project:

**`plaid_items`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | |
| `plaid_item_id` | text | unique, Plaid item ID |
| `access_token` | text | |
| `transactions_cursor` | text | Plaid sync cursor |

**`transactions`**

| Column | Type | Notes |
|--------|------|-------|
| `plaid_transaction_id` | text | unique |
| `plaid_item_id` | uuid | FK → `plaid_items.id` |
| `plaid_account_id` | text | |
| `name` | text | |
| `merchant_name` | text | nullable |
| `logo_url` | text | nullable, Plaid icon URL (merchant logo, or `personal_finance_category_icon_url` fallback) |
| `amount` | numeric | Plaid: positive = expense, negative = income |
| `date` | date | |
| `iso_currency_code` | text | nullable |
| `pending` | boolean | |
| `plaid_category_primary` | text | nullable |
| `plaid_category_detailed` | text | nullable |
| `category_id` | uuid | nullable, FK → `expense_categories.id` |
| `entry_type` | text | `'income'` or `'expense'` |
| `categorized_at` | timestamptz | nullable |
| `deleted_at` | timestamptz | nullable, soft delete |

Set `DEFAULT_USER_ID` in `.env` to match a user UUID in your app (auth is not implemented yet — a single hardcoded user is used).

## Running locally

Start the backend and frontend in separate terminals.

### Backend (port 8000)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./start.sh
```

### Frontend (port 3000)

```bash
cd frontend
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The frontend proxies `/api` requests to the backend.

## API endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/create_link_token` | Start Plaid Link |
| `POST` | `/api/set_access_token` | Exchange public token after Link |
| `GET` | `/api/transactions` | Sync from Plaid, return stored transactions |
| `GET` | `/api/balance` | Account balances from Plaid |
| `POST` | `/api/categorize` | AI-categorize uncategorized transactions |
| `POST` | `/api/link_exit_error` | Log Plaid Link errors |

## Plaid Sandbox test credentials

In Sandbox, use:

- **Username:** `user_good`
- **Password:** `pass_good`
- **2FA code (if prompted):** `1234`

For more realistic transaction data, try **First Platypus Bank** with username `user_transactions_dynamic`.

See [Plaid Sandbox docs](https://plaid.com/docs/sandbox/) for more test users.

## Troubleshooting

**Backend won't start / `python` not found**

Use `python3` or run via `./start.sh`, which prefers the local `.venv`.

**Frontend can't reach API (`ECONNREFUSED`)**

Make sure the backend is running on port 8000 before starting the frontend.

**`No user ID found`**

Set `DEFAULT_USER_ID` in `backend/.env`.

**Categorize returns nothing**

Only expense transactions (`amount > 0`) with `category_id IS NULL` are sent to the AI. `entry_type` is always derived from amount in application code, not by the AI.

**Link errors**

Check backend logs or the [Plaid Dashboard activity logs](https://dashboard.plaid.com/activity/logs).

## License

Private / personal project — add a license if you plan to open-source it.
