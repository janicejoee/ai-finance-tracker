# Expenses Tracker

Expenses Tracker turns your bank feed into a month you've actually reviewed.

Link a bank account, and new transactions land in an inbox. Give each one a category and check it off. Only approved transactions count toward the month, so the totals reflect what you've looked at, not whatever the bank sent. On the Ask page, an AI assistant answers spending questions from those approved expenses—totals, categories, merchants, and period comparisons.

## How it works

**Syncing.** Plaid Link connects the bank in the browser. The API exchanges the public token for an access token and stores it with your account. Opening the app or pressing Refresh calls Plaid's `/transactions/sync` with a saved cursor, so each sync brings only what was added, changed, or removed since the last one.

**Sorting.** Pending charges are skipped until they post. Each posted transaction is labeled an expense, income, or transfer based on Plaid's personal-finance category. Card payments and moves between accounts count as transfers, so paying a card isn't counted as spending twice. Money sent or received through apps like Zelle counts as an expense or income.

**Categories.** When a row is first inserted, a database trigger assigns a default category from `plaid_category_map`. Later syncs upsert on Plaid's transaction id and leave `category_id` and `approved` alone, so your choices survive bank updates. Transactions the bank removes are soft-deleted.

**Reviewing.** You can use the tracker before linking a bank. Add a transaction by hand from Home or New Transactions; it stays unapproved until you check it off, same as a bank row. New Transactions lists everything not yet approved. Home shows one month at a time: total spending, total income, spending by category, and separate lists for income, expenses, and transfers. Connect a bank when you want synced rows; Refresh syncs only when a bank is linked.

**Asking.** The Ask tab talks to Claude through the Flask API. The model never queries the database itself; it calls server-side tools that return approved expense totals, merchant matches, transaction lists, and period comparisons for the signed-in user only. Income, transfers, and unapproved inbox rows are excluded. The Anthropic API key and Supabase service-role key stay on the server.

## Stack

| Layer | Tools |
|---|---|
| Frontend | React, Vite, TypeScript, react-plaid-link |
| Backend | Flask |
| Auth & data | Supabase Auth, Postgres |
| Banking | Plaid (Link, Transactions Sync) |
| AI chat | Anthropic Claude (tool calling via `/api/chat`) |

## Project layout

```
backend/                Flask API (port 8000)
  server.py             Routes for auth, bank linking, categories, and transactions
  chat/                 Spending chatbot (Claude tools + /api/chat)
  services/
    plaid_client.py     Plaid client configuration
    transactions.py     Cursor-based transaction sync
    db.py               Supabase persistence and transaction classification
frontend/               React app (port 3000)
  src/App.tsx           Sign-in, bank link, inbox, monthly view, and Ask chat
```

In development, Vite proxies `/api` to the Flask server.

## Run locally

Start the API:

```bash
cd backend
source .venv/bin/activate
python3 server.py
```

In another terminal, start the UI:

```bash
cd frontend
npm start
```

Open [http://localhost:3000](http://localhost:3000). Create an account with your name, email, and password, then connect a bank. In Sandbox, sign in to the bank with `user_good` / `pass_good`. For more realistic data, use `user_transactions_dynamic`.

For Ask, set `ANTHROPIC_API_KEY` in the backend environment (along with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `FLASK_SECRET_KEY`).

Accounts created before password auth was added need a password set in the Supabase dashboard (Auth → Users), or create a new account.

## API

Routes other than login and signup require a signed-in Flask session cookie.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/signup` | Create an account (`email`, `password`, `name`) and sign in |
| `POST` | `/api/login` | Sign in with `email` and `password` |
| `POST` | `/api/logout` | Clear the session |
| `GET` | `/api/session` | Current user's email and name |
| `GET` | `/api/bank` | Whether a bank is linked |
| `POST` | `/api/bank/link-token` | Create a Plaid Link token |
| `POST` | `/api/bank/connect` | Exchange the Link `public_token` (form field) and save the bank |
| `GET` | `/api/categories` | List categories in display order |
| `GET` | `/api/transactions` | List the user's transactions; sync from Plaid first when a bank is linked |
| `POST` | `/api/transactions` | Create a manual transaction (`name`, `amount`, `date`, `entry_type`, optional `category_id`) |
| `PATCH` | `/api/transactions/<plaid_transaction_id>` | Update `approved`, `category_id`, `name`, `date`, `entry_type`, and/or `amount` |
| `DELETE` | `/api/transactions/<plaid_transaction_id>` | Soft-delete a transaction |
| `POST` | `/api/chat` | Ask a spending question (`question`, optional `history`); answers from approved expenses only |
