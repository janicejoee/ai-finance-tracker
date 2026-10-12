from .tools import CATEGORY_ID

DATE_PROPS = {
    "start_date": {"type": "string", "description": "YYYY-MM-DD, inclusive"},
    "end_date": {"type": "string", "description": "YYYY-MM-DD, inclusive"},
}
PERIOD = {
    "type": "object",
    "properties": DATE_PROPS,
    "required": ["start_date", "end_date"],
}

TOOL_SCHEMAS = [
    {
        "name": "get_spending_summary",
        "description": (
            "Total expense spending over a date range, optionally grouped by "
            "category or merchant. Excludes income, transfers, and unapproved "
            "rows. Use for 'how much did I spend last month' or 'spending by category'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **DATE_PROPS,
                "group_by": {
                    "type": "string",
                    "enum": ["none", "category", "merchant"],
                },
            },
            "required": ["start_date", "end_date"],
        },
    },
    {
        "name": "get_merchant_spending",
        "description": (
            "Total spent at a specific merchant over a date range. Matches names "
            "loosely and returns which merchant names matched."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"merchant": {"type": "string"}, **DATE_PROPS},
            "required": ["merchant", "start_date", "end_date"],
        },
    },
    {
        "name": "search_transactions",
        "description": (
            "List individual expense transactions with optional filters. Returns "
            "at most 20 rows; check the 'truncated' flag. Use for 'show my biggest "
            "purchases' or 'what did I buy at X'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                **DATE_PROPS,
                "merchant": {"type": "string"},
                "category": {"type": "string", "enum": list(CATEGORY_ID)},
                "min_amount": {"type": "number"},
                "max_amount": {"type": "number"},
                "sort": {
                    "type": "string",
                    "enum": ["date_desc", "amount_desc", "amount_asc"],
                },
                "limit": {"type": "integer", "maximum": 20},
            },
        },
    },
    {
        "name": "compare_periods",
        "description": (
            "Compare spending between two date ranges. period_a is the more recent "
            "period, period_b the earlier one. Percent change = (a - b) / b."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "period_a": PERIOD,
                "period_b": PERIOD,
                "group_by": {
                    "type": "string",
                    "enum": ["none", "category", "merchant"],
                },
            },
            "required": ["period_a", "period_b"],
        },
    },
    {
        "name": "list_categories_and_merchants",
        "description": (
            "Lists the fixed category list and the user's most frequent merchants. "
            "Use to resolve vague merchant names."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
]
