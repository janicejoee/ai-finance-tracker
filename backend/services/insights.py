import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from services.categorization import anthropic_client
from services.db import supabase_client
from services.transactions import entry_type_from_amount, get_plaid_item_ids

INSIGHTS_MODEL = os.getenv("ANTHROPIC_INSIGHTS_MODEL", "claude-haiku-4-5")

INSIGHTS_SYSTEM_PROMPT = """
You are a concise personal finance assistant.

Given spending summary data, write exactly ONE short paragraph (2-4 sentences) for the user.

Rules:
- Use specific dollar amounts from the data
- Compare this month vs last month when possible (include % change when meaningful)
- Mention the largest expense this month if available
- Friendly, direct tone — no bullet points, no markdown, no greeting
- If data is sparse, say what you can see and keep it brief
"""


def _fetch_recent_transactions(user_id: str, days: int = 90) -> list[dict]:
    item_ids = get_plaid_item_ids(user_id)
    if not item_ids:
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    result = (
        supabase_client.table("transactions")
        .select(
            "name, merchant_name, amount, date, entry_type, expense_categories(name)"
        )
        .in_("plaid_item_id", item_ids)
        .is_("deleted_at", "null")
        .gte("date", cutoff)
        .order("date", desc=True)
        .execute()
    )

    transactions = []
    for row in result.data or []:
        category = row.pop("expense_categories", None) or {}
        row["category_name"] = category.get("name")
        transactions.append(row)

    return transactions


def _build_context(transactions: list[dict]) -> dict:
    today = datetime.now(timezone.utc).date()
    current_month = today.strftime("%Y-%m")
    previous_month = (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")

    current_by_category: dict[str, float] = defaultdict(float)
    previous_by_category: dict[str, float] = defaultdict(float)
    current_expenses = 0.0
    previous_expenses = 0.0
    current_income = 0.0
    largest_this_month: list[dict] = []

    for tx in transactions:
        amount = float(tx["amount"])
        entry_type = tx.get("entry_type") or entry_type_from_amount(amount)
        month = tx["date"][:7]
        abs_amount = abs(amount)

        if entry_type == "expense":
            category = (tx.get("category_name") or "Uncategorized").strip()
            if month == current_month:
                current_by_category[category] += abs_amount
                current_expenses += abs_amount
                largest_this_month.append(
                    {
                        "name": tx.get("merchant_name") or tx.get("name"),
                        "amount": abs_amount,
                        "category": category,
                        "date": tx["date"],
                    }
                )
            elif month == previous_month:
                previous_by_category[category] += abs_amount
                previous_expenses += abs_amount
        elif month == current_month:
            current_income += abs_amount

    largest_this_month.sort(key=lambda item: item["amount"], reverse=True)

    recent = []
    for tx in transactions[:25]:
        entry_type = tx.get("entry_type") or entry_type_from_amount(float(tx["amount"]))
        recent.append(
            {
                "name": tx.get("merchant_name") or tx.get("name"),
                "amount": float(tx["amount"]),
                "date": tx["date"],
                "entry_type": entry_type,
                "category": tx.get("category_name"),
            }
        )

    return {
        "today": today.isoformat(),
        "current_month": current_month,
        "previous_month": previous_month,
        "current_month_expenses_by_category": dict(current_by_category),
        "previous_month_expenses_by_category": dict(previous_by_category),
        "current_month_total_expenses": round(current_expenses, 2),
        "previous_month_total_expenses": round(previous_expenses, 2),
        "current_month_total_income": round(current_income, 2),
        "largest_expenses_this_month": largest_this_month[:5],
        "recent_transactions": recent,
    }


def generate_insights(user_id: str) -> str:
    transactions = _fetch_recent_transactions(user_id)
    if not transactions:
        return (
            "Sync your transactions to get a personalized spending summary "
            "once you have activity in your linked account."
        )

    context = _build_context(transactions)

    response = anthropic_client.messages.create(
        model=INSIGHTS_MODEL,
        max_tokens=300,
        system=INSIGHTS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(context)}],
    )

    return response.content[0].text.strip()
