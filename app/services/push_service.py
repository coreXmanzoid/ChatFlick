import os

from flask import current_app, request
from firebase_admin import messaging
from app.extensions import db
from app.firebase.firebase_config import init_firebase


def send_notification(notification) -> bool:
    ok, status = init_firebase()
    if not ok:
        current_app.logger.warning("Firebase not initialized: %s", status)
        return False

    recipient = getattr(notification, "recipient", None)
    token = getattr(recipient, "fb_auth_token", None)

    if not token:
        current_app.logger.info("Missing FCM token for recipient")
        return False

    base_url = (
        os.getenv("PUBLIC_BASE_URL")
        or os.getenv("APP_BASE_URL")
        or os.getenv("CHATFLICK_BASE_URL")
        or ""
    ).rstrip("/")
    origin = base_url or request.host_url.rstrip("/")
    notification_url = f"{origin}/home"
    asset_url = f"{origin}/static/icons/icon-192.png"

    webpush_options = {
        "headers": {
            "Urgency": "high",
        },
        "notification": messaging.WebpushNotification(
            title=str(notification.title or "ChatFlick"),
            body=str(notification.message or ""),
            icon=asset_url,
            badge=asset_url,
            tag=f"chatflick_{notification.type}_{notification.identifier or ''}",
            renotify=True,
        ),
        "fcm_options": messaging.WebpushFCMOptions(link=notification_url),
    }

    title = str(notification.title or "ChatFlick")
    body = str(notification.message or "")

    message = messaging.Message(
        notification=messaging.Notification(
            title=title,
            body=body,
        ),
        data={
            "title": title,
            "body": body,
            "type": str(notification.type),
            "identifier": str(notification.identifier or ""),
            "sender_id": str(notification.sender_id or ""),
            "url": notification_url,
        },
        webpush=messaging.WebpushConfig(**webpush_options),
        token=token,
    )

    try:
        messaging.send(message)
        return True
    except (messaging.UnregisteredError, messaging.SenderIdMismatchError):
        current_app.logger.warning("Removing invalid FCM token for recipient_id=%s", getattr(recipient, "id", None))
        recipient.fb_auth_token = None
        db.session.commit()
        return False
    except Exception as exc:
        current_app.logger.exception("Push notification failed: %s", exc)
        return False


def send_diagnostic_notification(user) -> dict:
    ok, status = init_firebase()
    if not ok:
        return {
            "status": "error",
            "message": f"Firebase not initialized: {status}",
        }

    token = getattr(user, "fb_auth_token", None)
    if not token:
        return {
            "status": "error",
            "message": "No FCM token is saved for the current user.",
        }

    title = "ChatFlick diagnostic"
    body = "Firebase notification payload test"
    origin = request.host_url.rstrip("/")
    message = messaging.Message(
        notification=messaging.Notification(
            title=title,
            body=body,
        ),
        data={
            "title": title,
            "body": body,
            "type": "diagnostic",
            "identifier": str(getattr(user, "id", "")),
            "sender_id": str(getattr(user, "id", "")),
            "url": f"{origin}/home",
        },
        webpush=messaging.WebpushConfig(
            headers={
                "TTL": "60",
                "Urgency": "high",
            },
            notification=messaging.WebpushNotification(
                title=title,
                body=body,
                icon=f"{origin}/static/icons/icon-192.png",
                badge=f"{origin}/static/icons/icon-192.png",
                tag=f"chatflick_diagnostic_{getattr(user, 'id', '')}",
                renotify=True,
            ),
            fcm_options=messaging.WebpushFCMOptions(
                link=f"{origin}/home",
            ),
        ),
        token=token,
    )

    try:
        message_id = messaging.send(message)
        return {
            "status": "sent",
            "message_id": message_id,
            "saved_token_length": len(token),
            "saved_token_preview": f"{token[:16]}...{token[-16:]}",
        }
    except (messaging.UnregisteredError, messaging.SenderIdMismatchError) as exc:
        user.fb_auth_token = None
        db.session.commit()
        return {
            "status": "error",
            "message": f"Saved FCM token is invalid and was removed: {exc}",
        }
    except Exception as exc:
        current_app.logger.exception("Diagnostic push notification failed: %s", exc)
        return {
            "status": "error",
            "message": str(exc),
        }
