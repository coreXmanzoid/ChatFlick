from flask import Blueprint, request, jsonify, render_template, redirect, url_for
from flask_login import login_required, current_user, logout_user

from app.extensions import db
from app.models.posts import Post
from app.models.users import UserData
from app.services.account_service import AccountService
from app.services.follow_service import FollowService
from app.services.post_service import PostService
from app.decorators import verified_user
from app.utils.time_utils import utc_iso_from

# Blueprint for account-related routes
account_bp = Blueprint("account", __name__)


def _normalize_hashtag(value):
    tag = (value or "").strip().split()[0].lower()
    return tag if tag.startswith("#") else f"#{tag}"


def _search_posts_by_hashtag(state):
    hashtag = _normalize_hashtag(state)
    posts = (
        db.session.execute(
            db.select(Post)
            .where((Post.status.is_(None)) | (Post.status == "ACTIVE"))
            .order_by(Post.timestamp.desc())
        )
        .scalars()
        .all()
    )

    return [
        post for post in posts
        if any(str(tag).lower() == hashtag for tag in (post.hashtags or []))
    ]

# ----------------- Explore Accounts -----------------
@account_bp.route("/exploreAccounts/<int:id>/<string:state>")
@login_required
def explore_accounts(id, state):
    user = db.session.get(UserData, id)

    if state == "random":
        accounts = AccountService.random_accounts()

    elif state == "following":
        accounts = AccountService.following_accounts(user)

    elif state == "followers":
        accounts = AccountService.follower_accounts(user)

    elif state.strip().startswith("#"):
        posts = _search_posts_by_hashtag(state)
        return render_template(
            "posts.html",
            posts=posts,
            editable_post_ids={
                post.id for post in posts if PostService.can_edit(post, current_user.id)
            },
            utc_iso_from=utc_iso_from,
            reposts=None,
            no_of_hashtags=[
                (tag, sum(1 for post in posts if tag in post.hashtags))
                for tag in set(tag for post in posts for tag in post.hashtags)
            ],
            append_mode=False,
        )

    else:
        accounts = AccountService.search_accounts(state)

    following_ids = {f.following_id for f in current_user.following}

    return render_template(
        "exploreAccounts.html",
        accounts=accounts,
        following=following_ids
    )

# ----------------- Follow / Unfollow -----------------
@account_bp.route("/follows/<int:id>/<int:st>", methods=["POST"])
@login_required
@verified_user
def follows(id, st):
    if st == 1:
        try:
            FollowService.follow_user(id)
        except ValueError as exc:
            return jsonify({"status": "error", "message": str(exc)}), 403
    elif st == 2:
        FollowService.unfollow_user(id)

    follower_count = FollowService.follower_count(id)

    return jsonify({
        "status": "success",
        "follower_id": current_user.id,
        "follower_name": current_user.name,
        "followersCount": follower_count,
    })

# ----------------- Logout -----------------
@account_bp.route("/logout/<int:st>")
@login_required
def logout(st):
    current_user.fb_auth_token = None
    db.session.commit()
    logout_user()
    if st == 1:
        return redirect(url_for("main.home"))
    return redirect(url_for("auth.login"))
