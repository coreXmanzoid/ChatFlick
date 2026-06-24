from datetime import timedelta
import os
from flask import Flask, redirect, session, url_for
from dotenv import load_dotenv
from flask_login import current_user, logout_user

from app.extensions import db, login_manager, oauth as oauth_client
from app.utils.time_utils import utc_now
from app.utils.subscription_manager import (
    get_feature,
    get_limit,
    get_plan,
    has_feature,
    load_plans,
    session_lifetime_for,
)

from app.routes.notification_routes import notification_bp
from app.firebase.firebase_config import get_firebase_web_config, init_firebase
from app.routes.profile_routes import profile_bp
from app.routes.post_routes import post_bp
from app.routes.ai_routes import ai_bp
from app.routes.auth_routes import auth_bp
from app.routes.main_routes import main_bp
from app.routes.comment_routes import comment_bp
from app.routes.account_routes import account_bp
from app.routes.setting_routes import setting_bp
from app.routes.admin_routes import admin_bp
from app.routes.pricing_routes import pricing_bp
from app.routes.report_routes import report_bp
from app.routes.search_routes import search_bp

def create_app():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    load_dotenv(os.path.join(base_dir, ".env"))

    app = Flask(
        __name__,
        template_folder=os.path.join(base_dir, "templates"),
        static_folder=os.path.join(base_dir, "static"),
    )
    app.config["SECRET_KEY"] = "8BYkEfBA6O6donzWlSihBXox7C0sKR6b"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///ChatFlick.db"
    # app.config["SQLALCHEMY_DATABASE_URI"] = str(os.environ.get("SQLALCHEMY_DATABASE_URI"))
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
    secure_cookie = os.getenv("SESSION_COOKIE_SECURE", "").lower()
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=secure_cookie in {"1", "true", "yes", "on"},
        SESSION_COOKIE_SAMESITE="Lax",
    )
    db.init_app(app)
    login_manager.init_app(app)
    # migrate = Migrate(app, db)
    oauth_client.init_app(app)
    firebase_enabled, firebase_status = init_firebase()

    @app.before_request
    def enforce_subscription_session_lifetime():
        if not current_user.is_authenticated or not session.permanent:
            return None

        login_at = session.get("login_at")
        if not login_at:
            session["login_at"] = utc_now().isoformat()
            return None

        try:
            from datetime import datetime

            started_at = datetime.fromisoformat(login_at)
        except (TypeError, ValueError):
            session["login_at"] = utc_now().isoformat()
            return None

        if utc_now() - started_at > session_lifetime_for(current_user):
            logout_user()
            session.clear()
            return redirect(url_for("auth.login"))

        return None

    @app.context_processor
    def inject_runtime_config():
        return {
            "firebase_enabled": firebase_enabled,
            "firebase_status": firebase_status,
            "fcm_vapid_key": os.getenv("FCM_VAPID_KEY", ""),
            "firebase_api_key": os.getenv("FIREBASE_API_KEY", ""),
            "firebase_config": get_firebase_web_config(),
            "current_time": utc_now(),
            "current_user": current_user if current_user else None,
            "subscription_plans": load_plans(),
            "subscription_plan": get_plan(current_user),
            "subscription_feature": get_feature,
            "subscription_has_feature": has_feature,
            "subscription_limit": get_limit,
        }

    app.register_blueprint(notification_bp)
    app.register_blueprint(profile_bp)
    app.register_blueprint(post_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(comment_bp)
    app.register_blueprint(account_bp)
    app.register_blueprint(setting_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(pricing_bp)
    app.register_blueprint(report_bp)
    app.register_blueprint(search_bp)

    with app.app_context():
        from app import models
        from app import auth
        from app.oauth import google_oauth

        try:
            db.create_all()
        except Exception as e:
            print("DB init skipped:", e)
    return app
