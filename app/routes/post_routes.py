from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.services.post_service import PostService
from app.services.notification_service import NotificationService
from app.extensions import db
from app.services.feed_service import FeedService
from app.services.post_action_service import PostActionService
from flask import render_template
from app.models.posts import Post
from app.models.comments import Comments
from app.decorators import verified_user
from app.utils.subscription_manager import get_limit, has_feature, is_unlimited
from app.utils.time_utils import utc_iso_from
from app.routes.main_routes import render_app_shell

post_bp = Blueprint("post", __name__)


@post_bp.route("/post/<int:post_id>")
@login_required
def post_permalink(post_id):
    return render_app_shell()

@post_bp.route("/send-mention-notifications", methods=["POST"])
@login_required
@verified_user
def send_mention_notifications():

    data = request.get_json()

    post_id = data.get("post_id")
    state = data.get("state")

    if state == "post":
        post = db.session.get(Post, post_id)
    else:
        post = db.session.get(Comments, post_id)

    if not post:
        return jsonify({"status": "error", "message": "Post not found"}), 404

    NotificationService.send_mention_notifications(post, state)

    return jsonify({"status": "success"})


@post_bp.route("/managePosts/<int:state>", methods=["POST"])
@login_required
def manage_posts(state):
    data = request.get_json()

    if state == 1:  # create post

        if data.get("user_id") != current_user.id:
            return jsonify({"status": "Unauthorized"}), 403

        content = data.get("content", "").strip()

        if not content:
            return jsonify({"status": "error", "message": "Empty post"}), 400

        try:
            post = PostService.create_post(content, current_user.id)
        except ValueError as exc:
            return jsonify({"status": "error", "message": str(exc)}), 403

        return jsonify({
            "status": "success",
            "post_id": post.id,
            "username": current_user.username,
            "hashtags": post.hashtags,
            "mentions": post.mentions,
            "timestamp": utc_iso_from(post.timestamp)
        })


    post = db.session.get(Post, data.get("post_id"))

    if not post:
        return jsonify({"status": "Post not found"})

    if state == 2:
        if not PostService.can_edit(post, current_user.id):
            return jsonify({"status": "error", "message": "Editing is not available for this post or plan."}), 403
        try:
            PostService.edit_post(post, data.get("content"))
        except ValueError as exc:
            return jsonify({"status": "error", "message": str(exc)}), 403
        return jsonify({"status": "success", "content": post.content})


    if state == 3:
        if not PostService.can_delete(post, current_user.id):
            return jsonify({"status": "error", "message": "Deleting is not available for this post or plan."}), 403
        PostService.delete_post(post, current_user.id)
        return jsonify({"status": "success"})
    
    return jsonify({"status": "Invalid state"})
@post_bp.route("/showPosts/<int:state>/<int:id>")
@login_required
def show_posts(state, id):

    reposts = None
    requested_per_page = min(max(request.args.get("per_page", 10, type=int), 1), 25)
    append_mode = request.args.get("append") == "1"
    raw_exclude_ids = request.args.get("exclude_ids", "")
    exclude_ids = []

    for raw_id in raw_exclude_ids.split(","):
        try:
            exclude_ids.append(int(raw_id))
        except ValueError:
            continue

    if state == 1:
        posts = FeedService.profile_posts(id, limit=requested_per_page, exclude_ids=exclude_ids)

    elif state == 2:
        feed_limit = get_limit(current_user, "feed", "following_feed_limit", 10)
        per_page = requested_per_page if is_unlimited(feed_limit) else min(requested_per_page, int(feed_limit))
        posts = FeedService.following_posts(id, limit=per_page, exclude_ids=exclude_ids)

    elif state == 3:
        feed_limit = get_limit(current_user, "feed", "liked_posts_limit", 10)
        per_page = requested_per_page if is_unlimited(feed_limit) else min(requested_per_page, int(feed_limit))
        posts = FeedService.liked_posts(id, limit=per_page, exclude_ids=exclude_ids)

    elif state == 4:
        posts, reposts = FeedService.reposted_posts(id, limit=requested_per_page, exclude_ids=exclude_ids)

    else:
        feed_limit = get_limit(current_user, "feed", "random_feed_limit", 10)
        per_page = requested_per_page if is_unlimited(feed_limit) else min(requested_per_page, int(feed_limit))
        posts = FeedService.random_posts(limit=per_page, exclude_ids=exclude_ids)

    return render_template(
        "posts.html",
        posts=posts,
        editable_post_ids={
            post.id for post in posts if PostService.can_edit(post, current_user.id)
        },
        utc_iso_from=utc_iso_from,
        reposts=reposts,
        append_mode=append_mode,
    )

@post_bp.route("/PostAction/<int:state>", methods=["POST"])
@login_required
def post_action(state):

    data = request.get_json()
    post_id = data.get("post_id")

    if state == 1:
        if not has_feature(current_user, "social", "can_like"):
            return jsonify({"status": "error", "message": "Your plan does not allow likes."}), 403
        post = PostActionService.like_post(post_id, data.get("like"))

    elif state == 2:
        if not has_feature(current_user, "social", "can_repost"):
            return jsonify({"status": "error", "message": "Your plan does not allow reposts."}), 403
        post = PostActionService.repost_post(post_id, data.get("repost"))

    elif state == 3:
        if not has_feature(current_user, "social", "can_like"):
            return jsonify({"status": "error", "message": "Your plan does not allow likes."}), 403
        comment = PostActionService.like_comment(post_id, data.get("like"))

        return jsonify({
            "status": "success",
            "likes": comment.likes
        })

    elif state == 4:
        if not has_feature(current_user, "social", "can_share"):
            return jsonify({"status": "error", "message": "Your plan does not allow sharing."}), 403
        post = PostActionService.share_post(post_id)

        if not post:
            return jsonify({
                "status": "error",
                "message": "Post not found"
            }), 404

        return jsonify({
            "status": "success",
            "shares": post.shares
        })

    return jsonify({
        "current_user_name": current_user.name,
        "likes": post.likes,
        "user_id": post.user_id,
        "reposts": post.reposts,
    })
