from datetime import datetime, timezone

from services.db import supabase_client
from services.transactions import entry_type_from_amount, get_plaid_item_ids


def list_expense_categories() -> list[dict]:
    rows = (
        supabase_client.table("expense_categories")
        .select("id, name, sort_order")
        .order("sort_order")
        .execute()
        .data
        or []
    )
    return rows


def _next_sort_order() -> int:
    rows = (
        supabase_client.table("expense_categories")
        .select("sort_order")
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return 1
    return int(rows[0].get("sort_order") or 0) + 1


def _normalize_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise ValueError("Category name is required")
    return normalized


def _find_category_by_name(name: str) -> dict | None:
    normalized = _normalize_name(name)
    rows = (
        supabase_client.table("expense_categories")
        .select("id, name, sort_order")
        .ilike("name", normalized)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def create_expense_category(name: str) -> dict:
    normalized = _normalize_name(name)
    existing = _find_category_by_name(normalized)
    if existing:
        raise ValueError(f"Category '{normalized}' already exists")

    row = {
        "name": normalized,
        "sort_order": _next_sort_order(),
    }
    result = (
        supabase_client.table("expense_categories")
        .insert(row)
        .execute()
        .data
        or []
    )
    if not result:
        raise RuntimeError("Failed to create category")
    return result[0]


def update_expense_category(category_id: str, name: str) -> dict:
    normalized = _normalize_name(name)
    existing = _find_category_by_name(normalized)
    if existing and existing["id"] != category_id:
        raise ValueError(f"Category '{normalized}' already exists")

    result = (
        supabase_client.table("expense_categories")
        .update({"name": normalized})
        .eq("id", category_id)
        .execute()
        .data
        or []
    )
    if not result:
        raise ValueError("Category not found")
    return result[0]


def delete_expense_category(category_id: str) -> None:
    in_use = (
        supabase_client.table("transactions")
        .select("plaid_transaction_id", count="exact")
        .eq("category_id", category_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if (in_use.count or 0) > 0:
        raise ValueError("Cannot delete a category that is assigned to transactions")

    result = (
        supabase_client.table("expense_categories")
        .delete()
        .eq("id", category_id)
        .execute()
        .data
        or []
    )
    if not result:
        raise ValueError("Category not found")


def get_or_create_expense_category(name: str) -> dict:
    normalized = _normalize_name(name)
    existing = _find_category_by_name(normalized)
    if existing:
        return existing
    return create_expense_category(normalized)


def _get_user_transaction(user_id: str, plaid_transaction_id: str) -> dict:
    item_ids = get_plaid_item_ids(user_id)
    if not item_ids:
        raise ValueError("No linked bank account")

    rows = (
        supabase_client.table("transactions")
        .select(
            "plaid_transaction_id, amount, entry_type, category_id, expense_categories(name)"
        )
        .eq("plaid_transaction_id", plaid_transaction_id)
        .in_("plaid_item_id", item_ids)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise ValueError("Transaction not found")
    return rows[0]


def _can_categorize_transaction(transaction: dict) -> bool:
    if transaction.get("entry_type") == "transfer":
        return False
    return float(transaction["amount"]) > 0


def assign_transaction_category(
    user_id: str,
    plaid_transaction_id: str,
    *,
    category_id: str | None = None,
    category_name: str | None = None,
) -> dict:
    if not category_id and not category_name:
        raise ValueError("category_id or category_name is required")

    transaction = _get_user_transaction(user_id, plaid_transaction_id)
    if not _can_categorize_transaction(transaction):
        raise ValueError("Only expense transactions can be categorized")

    if category_name and not category_id:
        category = get_or_create_expense_category(category_name)
        category_id = category["id"]
    else:
        rows = (
            supabase_client.table("expense_categories")
            .select("id, name")
            .eq("id", category_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            raise ValueError("Category not found")
        category = rows[0]

    now = datetime.now(timezone.utc).isoformat()
    supabase_client.table("transactions").update({
        "category_id": category_id,
        "entry_type": entry_type_from_amount(transaction["amount"]),
        "categorized_at": now,
    }).eq("plaid_transaction_id", plaid_transaction_id).execute()

    return {
        "plaid_transaction_id": plaid_transaction_id,
        "category_id": category_id,
        "category_name": category["name"],
        "entry_type": entry_type_from_amount(transaction["amount"]),
    }
