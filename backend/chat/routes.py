import time
from collections import defaultdict, deque

from flask import Blueprint, jsonify, request, session

from .agent import answer_question

chat_bp = Blueprint("chat", __name__)

CHAT_RATE_LIMIT = 20
CHAT_RATE_WINDOW_SECONDS = 3600
_chat_hits: dict[str, deque[float]] = defaultdict(deque)


def _require_user_id():
    user_id = session.get("user_id")
    if not user_id:
        return None, (jsonify({"error": "Sign in required"}), 401)
    return user_id, None


def _rate_limited(user_id: str) -> bool:
    now = time.monotonic()
    hits = _chat_hits[user_id]
    while hits and now - hits[0] >= CHAT_RATE_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= CHAT_RATE_LIMIT:
        return True
    hits.append(now)
    return False


@chat_bp.route("/api/chat", methods=["POST"])
def chat():
    user_id, error = _require_user_id()
    if error:
        return error

    if _rate_limited(user_id):
        return jsonify({"error": "Too many chat requests. Try again later."}), 429

    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()[:1000]
    if not question:
        return jsonify({"error": "question is required"}), 400

    raw_history = data.get("history") or []
    if not isinstance(raw_history, list):
        raw_history = []
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in raw_history[-10:]
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and isinstance(m.get("content"), str)
    ]

    try:
        answer, _ = answer_question(user_id, history, question)
    except Exception:
        return jsonify({"error": "Could not answer that question"}), 500

    return jsonify({"answer": answer})
