import json
import os
from datetime import datetime, timezone

from anthropic import Anthropic

from services.batch import CATEGORIZE_BATCH_SIZE, chunked
from services.db import supabase_client
from services.transactions import entry_type_from_amount, get_plaid_item_ids

anthropic_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
CATEGORIZE_MODEL = os.getenv("ANTHROPIC_CATEGORIZE_MODEL", "claude-haiku-4-5")


SELF_TRANSFER_DETAILED_CATEGORIES = {
    "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",   # checking -> credit card payment
    "TRANSFER_IN_ACCOUNT_TRANSFER",        # savings -> checking (inbound side)
    "TRANSFER_OUT_ACCOUNT_TRANSFER",       # checking -> savings (outbound side)
    "TRANSFER_OUT_WITHDRAWAL",             # checking -> cash (outbound side)
}


SYSTEM_PROMPT = """
You are a financial transaction categorizer.

You only assign expense category_id values. entry_type is determined elsewhere from amount — do not infer or return entry_type.

Each transaction you receive is an expense (amount > 0).

- category_id MUST be one of the ids from this list: {expense_categories}
- Each item has "id" (uuid) and "name" (human-readable label). Use merchant_name, name, and plaid_category_primary as signals to pick the best match.
- If genuinely unclear, set category_id to null.
- Return only ids from the provided list, never invent names or ids

Return only the JSON string, no markdown fences.

Output format:
{{
    "transactions":
    [
        {{"plaid_transaction_id": "string", "category_id": "uuid-or-null"}},
        ...
    ]
}}
"""


def is_self_transfer(transaction: dict) -> bool:
    return transaction.get("plaid_category_detailed") in SELF_TRANSFER_DETAILED_CATEGORIES


def fetch_expense_categories() -> dict[str, str]:
    rows = (
        supabase_client.table("expense_categories")
        .select("id, name")
        .order("sort_order")
        .execute()
        .data
        or []
    )
    return {r["id"]: r["name"] for r in rows}


def format_categories_for_prompt(categories: dict[str, str]) -> str:
    payload = [{"id": category_id, "name": name} for category_id, name in categories.items()]
    return json.dumps(payload)


def assistant_categorize(
    client,
    transactions: list[dict],
    categories: dict[str, str],
) -> list[dict]:
    if not transactions:
        return []

    # Caller guarantees these are all amount > 0, non-transfer expenses,
    # but keep this as a defensive filter in case it's called directly elsewhere.
    expenses = [t for t in transactions if float(t["amount"]) > 0]
    if not expenses:
        return transactions

    slim = [
        {
            "plaid_transaction_id": t["plaid_transaction_id"],
            "name": t["name"],
            "merchant_name": t.get("merchant_name"),
            "plaid_category_primary": t.get("plaid_category_primary"),
            "plaid_category_detailed": t.get("plaid_category_detailed"),
        }
        for t in expenses
    ]

    response = client.messages.create(
        model=CATEGORIZE_MODEL,
        max_tokens=min(4096, 256 + len(expenses) * 80),
        system=SYSTEM_PROMPT.format(
            expense_categories=format_categories_for_prompt(categories),
        ),
        messages=[{"role": "user", "content": str(slim)}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        result = json.loads(raw)
        categorized = {
            t["plaid_transaction_id"]: t.get("category_id")
            for t in result["transactions"]
        }
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[categorize] Failed to parse response: {e}\nRaw: {raw}")
        categorized = {}

    allowed_ids = set(categories.keys())
    now = datetime.now(timezone.utc)

    for t in transactions:
        if float(t["amount"]) <= 0:
            continue

        category_id = categorized.get(t["plaid_transaction_id"])
        if category_id in allowed_ids:
            t["category_id"] = category_id
            t["categorized_at"] = now
        else:
            t["category_id"] = None
            t["categorized_at"] = None

    return transactions


def save_categorized_transactions(
    categorized: list[dict],
    categories: dict[str, str],
) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for transaction in categorized:
        if transaction["category_id"] is None:
            continue
        rows.append({
            "plaid_transaction_id": transaction["plaid_transaction_id"],
            "category_id": transaction["category_id"],
            "entry_type": entry_type_from_amount(transaction["amount"]),
            "categorized_at": now,
        })

    for row in rows:
        supabase_client.table("transactions").update({
            "category_id": row["category_id"],
            "entry_type": row["entry_type"],
            "categorized_at": row["categorized_at"],
        }).eq("plaid_transaction_id", row["plaid_transaction_id"]).execute()

    return [
        {
            "plaid_transaction_id": row["plaid_transaction_id"],
            "category_id": row["category_id"],
            "category_name": categories.get(row["category_id"]),
            "entry_type": row["entry_type"],
        }
        for row in rows
    ]


def save_transfers(transfers: list[dict]) -> list[dict]:
    """Persist self-transfers directly, bypassing AI categorization entirely."""
    now = datetime.now(timezone.utc).isoformat()

    for t in transfers:
        supabase_client.table("transactions").update({
            "category_id": None,
            "entry_type": "transfer",
            "categorized_at": now,
        }).eq("plaid_transaction_id", t["plaid_transaction_id"]).execute()

    return [
        {
            "plaid_transaction_id": t["plaid_transaction_id"],
            "category_id": None,
            "category_name": "Transfer",
            "entry_type": "transfer",
        }
        for t in transfers
    ]


def categorize_uncategorized_transactions(user_id: str) -> dict:
    item_ids = get_plaid_item_ids(user_id)
    if not item_ids:
        return {"categorized": 0, "transactions": []}

    # NOTE: no .gt("amount", 0) here anymore — transfers can be either sign,
    # and income (amount <= 0) also needs to pass through to get entry_type set.
    transactions = (
        supabase_client.table("transactions")
        .select(
            "plaid_transaction_id, name, merchant_name, amount, plaid_category_primary, plaid_category_detailed"
        )
        .in_("plaid_item_id", item_ids)
        .is_("category_id", "null")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )

    if not transactions:
        return {"categorized": 0, "transactions": [], "message": "All transactions already categorized"}

    transfers = [t for t in transactions if is_self_transfer(t)]
    remaining = [t for t in transactions if not is_self_transfer(t)]

    saved = []

    if transfers:
        saved.extend(save_transfers(transfers))

    expenses = [t for t in remaining if float(t["amount"]) > 0]
    incomes = [t for t in remaining if float(t["amount"]) <= 0]

    # Income transactions don't go through AI categorization — just stamp entry_type
    if incomes:
        saved.extend(save_incomes(incomes))

    if expenses:
        categories = fetch_expense_categories()
        if not categories:
            raise RuntimeError("No expense categories configured")

        for batch in chunked(expenses, CATEGORIZE_BATCH_SIZE):
            categorized = assistant_categorize(anthropic_client, batch, categories)
            saved.extend(save_categorized_transactions(categorized, categories))

    return {
        "categorized": len(saved),
        "transactions": saved,
    }


def save_incomes(incomes: list[dict]) -> list[dict]:
    """Persist income transactions directly — no category needed for income."""
    now = datetime.now(timezone.utc).isoformat()

    for t in incomes:
        supabase_client.table("transactions").update({
            "category_id": None,
            "entry_type": "income",
            "categorized_at": now,
        }).eq("plaid_transaction_id", t["plaid_transaction_id"]).execute()

    return [
        {
            "plaid_transaction_id": t["plaid_transaction_id"],
            "category_id": None,
            "category_name": "Income",
            "entry_type": "income",
        }
        for t in incomes
    ]