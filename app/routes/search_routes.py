"""Search and discovery API routes for ChatFlick."""

from datetime import timedelta

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from app.extensions import db
from app.models.follows import Follow
from app.models.posts import Post
from app.models.users import UserData
from app.services.account_service import AccountService
from app.utils.subscription_manager import get_plan
from app.utils.time_utils import utc_iso_from, utc_now

search_bp = Blueprint("search", __name__)


def _visible_posts_query():
    return (
        db.select(Post)
        .options(joinedload(Post.user))
        .where(or_(Post.status.is_(None), Post.status == "ACTIVE"))
    )


def _serialize_post(post):
    liked_posts = current_user.liked_posts or []
    reposted_posts = current_user.reposted_posts or []
    user_plan = get_plan(post.user)

    return {
        "id": post.id,
        "content": post.content,
        "hashtags": post.hashtags or [],
        "mentions": post.mentions or [],
        "likes": post.likes or 0,
        "comments": post.comments or 0,
        "reposts": post.reposts or 0,
        "shares": post.shares or 0,
        "timestamp": utc_iso_from(post.timestamp),
        "user": {
            "id": post.user.id,
            "name": post.user.name,
            "username": post.user.username,
            "profile_image_url": post.user.profile_image_url,
            "is_pro": user_plan in ("pro", "enterprise"),
        },
        "liked_by_me": post.id in liked_posts,
        "reposted_by_me": post.id in reposted_posts,
    }


def _account_follow_counts(account_ids):
    if not account_ids:
        return {}

    rows = db.session.execute(
        db.select(Follow.following_id, func.count(Follow.id))
        .where(Follow.following_id.in_(account_ids))
        .group_by(Follow.following_id)
    ).all()
    return {account_id: count for account_id, count in rows}


def _serialize_account(account, follower_count=0, following_ids=None):
    if following_ids is None:
        following_ids = {follow.following_id for follow in current_user.following}

    plan = get_plan(account)
    status = account.status or ""

    return {
        "id": account.id,
        "name": account.name or account.username,
        "username": account.username,
        "profile_image_url": account.profile_image_url or "/static/assets/default-profile.jpg",
        "is_pro": plan in ("pro", "enterprise") or status in {"PRO", "ENTERPRISE"},
        "follower_count": follower_count,
        "is_following": account.id in following_ids,
    }


def _serialize_accounts(accounts):
    following_ids = {follow.following_id for follow in current_user.following}
    counts = _account_follow_counts([account.id for account in accounts])

    return [
        _serialize_account(account, counts.get(account.id, 0), following_ids)
        for account in accounts
    ]


@search_bp.route("/api/explore/accounts")
@login_required
def api_explore_accounts():
    """Return suggested accounts, three at a time, ordered by follower count."""
    page = max(1, request.args.get("page", 1, type=int))
    per_page = min(max(1, request.args.get("per_page", 3, type=int)), 20)
    offset = (page - 1) * per_page

    follower_counts = (
        db.select(Follow.following_id, func.count(Follow.id).label("follower_count"))
        .group_by(Follow.following_id)
        .subquery()
    )

    accounts_query = (
        db.select(UserData)
        .outerjoin(follower_counts, UserData.id == follower_counts.c.following_id)
        .where(UserData.id != current_user.id)
        .where(UserData.status.in_(["VERIFIED", "PRO", "ENTERPRISE", "PENDING_PRO"]))
        .order_by(func.coalesce(follower_counts.c.follower_count, 0).desc(), UserData.id.asc())
        .offset(offset)
        .limit(per_page + 1)
    )

    accounts = db.session.scalars(accounts_query).all()
    has_more = len(accounts) > per_page

    return jsonify(
        {
            "accounts": _serialize_accounts(accounts[:per_page]),
            "page": page,
            "has_more": has_more,
        }
    )


@search_bp.route("/api/trending")
@login_required
def api_trending():
    """Return platform-only discovery data based on recent ChatFlick activity."""
    since = utc_now() - timedelta(days=7)

    recent_posts = db.session.scalars(
        _visible_posts_query().where(Post.timestamp >= since)
    ).all()

    hashtag_counts = {}
    for post in recent_posts:
        for tag in post.hashtags or []:
            normalized = str(tag).strip().lower()
            if not normalized:
                continue
            if not normalized.startswith("#"):
                normalized = f"#{normalized}"
            hashtag_counts[normalized] = hashtag_counts.get(normalized, 0) + 1

    sorted_tags = sorted(hashtag_counts.items(), key=lambda item: item[1], reverse=True)
    trending_hashtags = [
        {"tag": tag, "count": count}
        for tag, count in sorted_tags[:3]
    ]
    trending_topics = [
        {
            "title": tag,
            "query": tag,
            "count": count,
            "label": f"{count} post{'s' if count != 1 else ''}",
        }
        for tag, count in sorted_tags[:3]
    ]

    candidate_posts = db.session.scalars(
        _visible_posts_query()
        .where(Post.timestamp >= utc_now() - timedelta(days=14))
        .order_by(Post.likes.desc())
        .limit(50)
    ).all()

    def engagement_score(post):
        return (
            ((post.likes or 0) * 2)
            + ((post.reposts or 0) * 3)
            + (post.comments or 0)
            + (post.shares or 0)
        )

    popular_posts = sorted(candidate_posts, key=engagement_score, reverse=True)[:3]

    return jsonify(
        {
            "trending_hashtags": trending_hashtags,
            "trending_topics": trending_topics,
            "popular_posts": [_serialize_post(post) for post in popular_posts],
        }
    )


@search_bp.route("/api/search")
@login_required
def api_search():
    """
    Unified search endpoint.

    Auto mode preserves current behavior: regular queries search people, and
    #hashtag queries search posts. Explicit type=posts prepares the endpoint
    for future post-content search without changing the current UI behavior.
    """
    query = request.args.get("q", "").strip()
    search_type = request.args.get("type", "auto")

    if not query:
        return jsonify({"accounts": [], "posts": [], "hashtags": []})

    results = {"accounts": [], "posts": [], "hashtags": []}
    is_hashtag = query.startswith("#")

    if not is_hashtag and search_type in ("auto", "accounts"):
        accounts = AccountService.search_accounts(query)
        results["accounts"] = _serialize_accounts(accounts[:10])

    if is_hashtag or search_type in ("auto", "hashtags"):
        tag = query.lstrip("#").lower()
        matching_posts = db.session.scalars(
            _visible_posts_query()
            .order_by(Post.timestamp.desc())
            .limit(100)
        ).all()
        tag_posts = [
            post for post in matching_posts
            if any(str(item).lower().lstrip("#") == tag for item in (post.hashtags or []))
        ][:20]

        results["posts"] = [_serialize_post(post) for post in tag_posts]
        if tag_posts:
            results["hashtags"] = [{"tag": f"#{tag}", "count": len(tag_posts)}]

    if not is_hashtag and search_type == "posts":
        content_posts = db.session.scalars(
            _visible_posts_query()
            .where(Post.content.ilike(f"%{query}%"))
            .order_by(Post.timestamp.desc())
            .limit(20)
        ).all()
        results["posts"] = [_serialize_post(post) for post in content_posts]

    return jsonify(results)
