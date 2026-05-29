from flask import Blueprint, request, jsonify, render_template
from flask_login import current_user, login_required

from app.extensions import db
from app.services.ai_service import AIService
from app.decorators import verified_user
from app.utils.subscription_manager import get_limit, has_feature, is_unlimited
from app.utils.time_utils import utc_now
from app.routes.main_routes import is_spa_fragment_request, render_app_shell

ai_bp = Blueprint("ai", __name__)


def _consume_ai_request(user):
    limit = get_limit(user, "ai", "ai_requests_per_day", 5)
    if is_unlimited(limit):
        return True

    today = utc_now().date().isoformat()
    usage = user.get_setting("usage", "ai", {}) or {}
    if usage.get("date") != today:
        usage = {"date": today, "count": 0}

    if int(usage.get("count") or 0) >= int(limit):
        return False

    user.set_setting("usage", "ai", {"date": today, "count": int(usage.get("count") or 0) + 1})
    db.session.commit()
    return True

@ai_bp.route("/Manzoid-AI", methods=["GET", "POST"])
@login_required
@verified_user
def manzoid_ai():
    if not has_feature(current_user, "ai", "ai_access"):
        return jsonify({"error": "Your plan does not include AI access"}), 403

    if request.method == "GET" and not is_spa_fragment_request():
        return render_app_shell()
    
    if request.method == "POST":

        data = request.get_json()

        if not data or "message" not in data:
            return jsonify({"error": "Message is required"}), 400

        message = data["message"].strip()

        if not message:
            return jsonify({"error": "Empty message"}), 400

        max_length = get_limit(current_user, "ai", "ai_message_length", 100)
        if not is_unlimited(max_length) and len(message) > int(max_length):
            return jsonify({"error": f"Message must be {max_length} characters or fewer for your plan"}), 400

        if not _consume_ai_request(current_user):
            return jsonify({"error": "Daily AI request limit reached for your plan"}), 429

        try:
            user_id = str(current_user.id)
            memory_limit = get_limit(current_user, "ai", "ai_conversation_memory", 0)
            max_history = -1 if is_unlimited(memory_limit) else int(memory_limit)
            answer = AIService.chat(user_id, message, max_history=max_history)
            return jsonify({"reply": answer})

        except Exception as e:
            print("Groq error:", e)
            return jsonify({"error": "AI service unavailable"}), 503

    return render_template("AI.html")

@ai_bp.route("/api_chat", methods=["POST"])
def ai_chat():

    data = request.get_json()

    if not data or "message" not in data:
        return jsonify({"error": "Message is required"}), 400

    prompt = data["message"].strip()

    if not prompt:
        return jsonify({"error": "Empty message"}), 400

    if len(prompt) > 1000:
        return jsonify({"error": "Message too long"}), 400

    try:
        answer = AIService.simple_chat(prompt)
        return jsonify({"reply": answer})

    except Exception as e:
        print("Groq error:", e)
        return jsonify({"error": "AI service unavailable"}), 503
