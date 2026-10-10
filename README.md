# Expenses Tracker

A personal finance app that links a bank account via [Plaid](https://plaid.com) and fetches transactions from Plaid.

## Features

- Connect a bank account through Plaid Link
- Fetch and list transactions from Plaid

## Project structure

```
expenses_tracker/
├── backend/          # Flask API (Plaid, Supabase)
│   ├── server.py
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
| `transactions_cursor` | text | |

Sign in on the app with an email that already exists in Supabase Authentication → Users. The API uses that user's id.

## Running locally

Start the backend and frontend in separate terminals.

### Backend (port 8000)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 server.py
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
| `POST` | `/api/login` | Sign in with an email from Supabase Auth users |
| `POST` | `/api/signup` | Create a Supabase Auth user for a new email and sign in |
| `POST` | `/api/logout` | Clear the session |
| `GET` | `/api/session` | Signed-in email, or 401 if nobody is signed in |
| `GET` | `/api/bank` | Whether a bank account is already linked |
| `POST` | `/api/bank/link-token` | Start Plaid Link |
| `POST` | `/api/bank/connect` | Save the bank connection after Link |
| `GET` | `/api/transactions` | Fetch transactions from Plaid |

## Plaid Sandbox test credentials

In Sandbox, use:

- **Username:** `user_good`
- **Password:** `pass_good`
- **2FA code (if prompted):** `1234`

For more realistic transaction data, try **First Platypus Bank** with username `user_transactions_dynamic`.

See [Plaid Sandbox docs](https://plaid.com/docs/sandbox/) for more test users.

## Troubleshooting

**Backend won't start / `python` not found**

Activate the venv first (`source .venv/bin/activate`), then run `python3 server.py`.

**Frontend can't reach API (`ECONNREFUSED`)**

Make sure the backend is running on port 8000 before starting the frontend.

**`Sign in required` or `No account for that email`**

Use an email that already exists under Supabase Authentication → Users.

**Link errors**

Check backend logs or the [Plaid Dashboard activity logs](https://dashboard.plaid.com/activity/logs).

## License

Private / personal project — add a license if you plan to open-source it.
