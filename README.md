# Expenses Tracker

**Nothing counts until you've looked at it.**

Most budgeting apps take your bank feed on faith. This one treats every transaction as a suspect. It waits in an inbox until you give it a category and check the box. Only then does it count toward the month.

Changed your mind? Uncheck it, and it walks back to the inbox.

## The two screens

**New Transactions** is the inbox. It shows everything you haven't approved yet, with a badge counting what's left. Clear it and you get: *You're all caught up.*

**Home** is one month at a time. At the top: what you spent, what came in, and which categories took the money, biggest first. Below that, income, expenses, and transfers each get their own list. Step back through earlier months with Prev and Next.

## The journey of a coffee

```mermaid
flowchart LR
    Bank -->|Plaid sync| API[Flask API]
    API -->|sort + upsert| DB[(Supabase)]
    DB --> Inbox[New Transactions]
    Inbox -->|you approve| Month[Home]
```

You buy a $5 latte. Here's what happens to it.

1. **It stays pending.** The bank shows the charge as pending, and the app pretends it doesn't exist. Pending amounts can still change, and nobody wants to file a charge twice.
2. **It posts.** When you open the app or hit Refresh, the Flask API asks Plaid what has changed since last time. Plaid answers from a saved *cursor* on your bank link, so a sync only brings what was added, changed, or removed, never the whole history again.
3. **It gets sorted.** Before the API saves it, it reads Plaid's category and labels the latte an expense, income, or transfer (rules below). The row is upserted on Plaid's transaction id, so syncing twice never creates a duplicate.
4. **It gets a category.** On insert, a database trigger gives it a default category, which you can change from a dropdown.
5. **You approve it.** Check the box, and it lands in the month.

If the bank cancels the charge, Plaid reports a removal. The row is soft-deleted and vanishes from both screens.

## The rules of the sort

Banks are messy, so the classifier runs a short list of rules, in this order:

| If the transaction is… | It becomes |
|---|---|
| Named like a card payment thank-you | **Transfer** |
| Money sent through an app such as Zelle | **Expense** |
| Money received through an app | **Income** |
| An account transfer, card or loan payment, or investment | **Transfer** |
| Anything else Plaid marks as income | **Income** |
| Everything else | **Expense** |

The first rule exists because some banks file a card payment as a purchase. Left alone, paying off your card would look like spending the same money twice.

Transfers get their own list and stay out of both totals. A refund stays an expense; the money simply comes back in.

## Yours vs. the bank's

Every row has two kinds of fields.

- **The bank's:** name, amount, date, and Plaid's category labels. Any sync can rewrite these.
- **Yours:** whether it's approved, and which category it's in. The sync payload leaves both out, so a later update can correct an amount without wiping your decisions.

## Under the hood

- **React + Vite** is the screen you see, and it only talks to the API.
- **Flask** is the only process that holds Plaid or Supabase credentials. It exchanges Plaid Link's public token for an access token, runs the sync, and stores your session.
- **Plaid** connects the bank and supplies its transactions through `/transactions/sync`.
- **Supabase** holds accounts (through Auth), bank links, categories, and transactions. The API uses the service role, so the browser never touches the database.

Sign-in uses just an email. It's a personal tool, not a bank.
