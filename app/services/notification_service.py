from app.extensions import db
from app.models.notifications import Notification
from app.services.push_service import send_notification
from app.utils.subscription_manager import has_feature
from app.utils.time_utils import utc_now


class NotificationService:

    @staticmethod
    def create_notification(sender_id, recipient_id, title, message, type, identifier):
        from app.models.users import UserData

        recipient = db.session.get(UserData, recipient_id)
        if recipient and not has_feature(recipient, "notifications", "in_app_notifications"):
            return None

        notification = Notification(
            sender_id=sender_id,
            recipient_id=recipient_id,
            title=title,
            message=message,
            type=type,
            identifier=identifier,
        )

        db.session.add(notification)
        db.session.commit()

        return notification

    @staticmethod
    def update_or_create(type, identifier, message, recipient_id, sender_id=None, title="Notification", commit=True):
        from app.models.users import UserData

        recipient = db.session.get(UserData, recipient_id)
        # BUG FIX: recipient can be None if user was deleted; guard before checking features.
        if recipient is None:
            return None
        if not has_feature(recipient, "notifications", "in_app_notifications"):
            return None

        notification = db.session.execute(
            db.select(Notification).where(
                (Notification.type == type)
                & (Notification.identifier == identifier)
                & (Notification.recipient_id == recipient_id)
            )
        ).scalar_one_or_none()

        if notification:
            notification.created_at = utc_now()
            notification.is_read = False
            notification.message = message
            notification.title = title
        else:
            notification = Notification(
                title=title,
                message=message,
                type=type,
                identifier=identifier,
                recipient_id=recipient_id,
                sender_id=sender_id,
            )
            db.session.add(notification)

        if commit:
            db.session.commit()

        return notification

    @staticmethod
    def send_mention_notifications(post, state):

        mentioned_objects = post.mentions
        notifications = []

        for obj in mentioned_objects:

            user_id = obj.get("user_id")
            if not user_id:
                continue

            if user_id == post.user.id:
                continue

            from app.models.users import UserData

            recipient = db.session.get(UserData, user_id)
            # BUG FIX: guard None recipient before checking features.
            if recipient is None:
                continue
            if not has_feature(recipient, "notifications", "in_app_notifications"):
                continue

            notif = Notification(
                sender_id=post.user.id,
                recipient_id=user_id,
                title="Mentioned",
                message=f"{post.user.name} mentioned you in a {state}.",
                type=f"mention_{state}",
                identifier=post.id,
            )

            db.session.add(notif)
            notifications.append(notif)

        db.session.commit()

        # BUG FIX: refresh each notification after commit so the recipient
        # relationship is accessible without a DetachedInstanceError.
        for notif in notifications:
            try:
                db.session.refresh(notif)
                # BUG FIX: check recipient push feature using the already-fetched
                # recipient object, not the lazy relationship, to avoid a second
                # query on a potentially stale relationship proxy.
                push_recipient = db.session.get(
                    __import__("app.models.users", fromlist=["UserData"]).UserData,
                    notif.recipient_id,
                )
                if push_recipient and has_feature(push_recipient, "notifications", "push_notifications"):
                    send_notification(notif)
            except Exception as exc:
                print("Notification failed:", exc)
