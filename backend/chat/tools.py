import logging
import re
import time
from datetime import date

from postgrest.exceptions import APIError

from services.db import supabase_client as sb

logger = logging.getLogger(__name__)

_cats = sb.table("categories").select("id, name").order("sort_order").execute().data or []
CATEGORY_ID = {c["name"]: c["id"] for c in _cats}
CATEGORY_NAME = {c["id"]: c["name"] for c in _cats}

GROUP_OPTIONS = {"none", "category", "merchant"}
SORT_OPTIONS = {
    "date_desc": ("date", True),
    "amount_desc": ("amount", True),
    "amount_asc": ("amount", False),
}


def parse_dates(start: str, end: str) -> tuple[date, date]:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if s > e:
        raise ValueError("start_date must be on or before end_date")
    return s, e


def clean(text: str) -> str:
    """Strip characters that could alter PostgREST filter syntax."""
    return re.sub(r"[,()%*\\]", " ", text).strip()


def get_spending_summary(user_id, start_date, end_date, group_by="none"):
    s, e = parse_dates(start_date, end_date)
    if group_by not in GROUP_OPTIONS:
        raise ValueError("group_by must be 'category', 'merchant', or 'none'")
    rows = sb.rpc("spending_summary", {
        "p_user_id": user_id,
        "p_start": s.isoformat(),
        "p_end": e.isoformat(),
        "p_group_by": group_by,
    }).execute().data or []

    if group_by == "none":
        r = rows[0] if rows else {"total": 0, "txn_count": 0}
        return {
            "total": float(r["total"] or 0),
            "count": r["txn_count"] or 0,
            "start_date": start_date,
            "end_date": end_date,
        }
    return {
        "group_by": group_by,
        "groups": [
            {
                "label": r["label"],
                "total": float(r["total"] or 0),
                "count": r["txn_count"] or 0,
            }
            for r in rows
        ],
        "start_date": start_date,
        "end_date": end_date,
    }


def get_merchant_spending(user_id, merchant, start_date, end_date):
    s, e = parse_dates(start_date, end_date)
    rows = sb.rpc("merchant_spending", {
        "p_user_id": user_id,
        "p_merchant": clean(merchant),
        "p_start": s.isoformat(),
        "p_end": e.isoformat(),
    }).execute().data or []
    if not rows:
        return {
            "matched": [],
            "total": 0,
            "note": f"No expenses found matching '{merchant}'",
        }
    return {
        "matched": [
            {
                "merchant": r["merchant"],
                "total": float(r["total"] or 0),
                "count": r["txn_count"] or 0,
            }
            for r in rows
        ],
        "total": round(sum(float(r["total"] or 0) for r in rows), 2),
        "start_date": start_date,
        "end_date": end_date,
    }


def search_transactions(
    user_id,
    start_date=None,
    end_date=None,
    merchant=None,
    category=None,
    min_amount=None,
    max_amount=None,
    sort="date_desc",
    limit=20,
):
    limit = max(1, min(int(limit), 20))
    q = (
        sb.table("transactions")
        .select("date, name, merchant_name, amount, category_id")
        .eq("user_id", user_id)
        .eq("entry_type", "expense")
        .eq("approved", True)
        .is_("deleted_at", "null")
    )

    if start_date and end_date:
        s, e = parse_dates(start_date, end_date)
        q = q.gte("date", s.isoformat()).lte("date", e.isoformat())
    if merchant:
        m = clean(merchant)
        q = q.or_(f"merchant_name.ilike.%{m}%,name.ilike.%{m}%")
    if category:
        cid = CATEGORY_ID.get(category)
        if not cid:
            raise ValueError(f"Unknown category '{category}'. Valid: {list(CATEGORY_ID)}")
        q = q.eq("category_id", cid)
    if min_amount is not None:
        q = q.gte("amount", min_amount)
    if max_amount is not None:
        q = q.lte("amount", max_amount)

    col, desc = SORT_OPTIONS.get(sort, SORT_OPTIONS["date_desc"])
    rows = q.order(col, desc=desc).limit(limit + 1).execute().data or []

    return {
        "transactions": [
            {
                "date": r["date"],
                "merchant": r["merchant_name"] or r["name"],
                "category": CATEGORY_NAME.get(r["category_id"], "Uncategorized"),
                "amount": float(r["amount"]),
            }
            for r in rows[:limit]
        ],
        "truncated": len(rows) > limit,
    }


def compare_periods(user_id, period_a, period_b, group_by="none"):
    pa = {k: period_a[k] for k in ("start_date", "end_date")}
    pb = {k: period_b[k] for k in ("start_date", "end_date")}
    a = get_spending_summary(user_id, **pa, group_by=group_by)
    b = get_spending_summary(user_id, **pb, group_by=group_by)

    def pct(new, old):
        return round((new - old) / old * 100, 1) if old else None

    if group_by == "none":
        return {
            "period_a": a,
            "period_b": b,
            "difference": round(a["total"] - b["total"], 2),
            "percent_change": pct(a["total"], b["total"]),
        }

    a_map = {g["label"]: g["total"] for g in a["groups"]}
    b_map = {g["label"]: g["total"] for g in b["groups"]}
    diffs = [
        {
            "label": k,
            "period_a": a_map.get(k, 0),
            "period_b": b_map.get(k, 0),
            "difference": round(a_map.get(k, 0) - b_map.get(k, 0), 2),
            "percent_change": pct(a_map.get(k, 0), b_map.get(k, 0)),
        }
        for k in set(a_map) | set(b_map)
    ]
    diffs.sort(key=lambda d: abs(d["difference"]), reverse=True)
    return {"group_by": group_by, "comparison": diffs[:15]}


def list_categories_and_merchants(user_id):
    merchants = sb.rpc("top_merchants", {"p_user_id": user_id}).execute().data or []
    return {
        "categories": list(CATEGORY_ID),
        "top_merchants": [r["merchant"] for r in merchants],
    }


TOOLS = {
    "get_spending_summary": get_spending_summary,
    "get_merchant_spending": get_merchant_spending,
    "search_transactions": search_transactions,
    "compare_periods": compare_periods,
    "list_categories_and_merchants": list_categories_and_merchants,
}


def run_tool(name, args, user_id):
    fn = TOOLS.get(name)
    if fn is None:
        return {"error": f"Unknown tool '{name}'"}
    started = time.perf_counter()
    # Never accept user_id from the model.
    safe_args = {k: v for k, v in (args or {}).items() if k != "user_id"}
    try:
        result = fn(user_id=user_id, **safe_args)
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "tool_call name=%s duration_ms=%s args=%s",
            name,
            duration_ms,
            safe_args,
        )
        return result
    except (ValueError, TypeError, KeyError) as exc:
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "tool_call name=%s duration_ms=%s args=%s error=%s",
            name,
            duration_ms,
            safe_args,
            exc,
        )
        return {"error": str(exc)}
    except APIError:
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.exception(
            "Supabase error in %s duration_ms=%s args=%s",
            name,
            duration_ms,
            safe_args,
        )
        return {"error": "Database error running this tool"}
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.exception(
            "Tool %s failed duration_ms=%s args=%s",
            name,
            duration_ms,
            safe_args,
        )
        return {"error": "Internal error running this tool"}
