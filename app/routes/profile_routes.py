from flask import Blueprint, request, jsonify, render_template
from flask_login import login_required, current_user

from app.extensions import db
from app.models.users import UserData
from app.models.follows import Follow
from app.services.cloudinary_service import CloudinaryService
from app.decorators import verified_user
from app.utils.subscription_manager import get_limit
from app.routes.main_routes import is_spa_fragment_request, render_app_shell

profile_bp = Blueprint("profile", __name__)

@profile_bp.route("/update-profile/<int:id>", methods=["POST"])
@login_required
@verified_user
def upload_profile(id):

    if "profile" not in request.files:
        return jsonify({"status": "error", "message": "No file provided"}), 400

    file = request.files["profile"]

    if file.filename == "":
        return jsonify({"status": "error", "message": "Empty file"}), 400

    user = db.session.get(UserData, id)

    if not user:
        return jsonify({"status": "error", "message": "User not found"}), 404

    if current_user.id != id:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403

    try:
        image_url = CloudinaryService.upload_profile_picture(
            file,
            id,
            resolution=get_limit(current_user, "profile", "profile_image_resolution", "256x256"),
        )

        user.profile_image_url = image_url
        db.session.commit()

        return jsonify({"status": "success", "image_url": image_url}), 200

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@profile_bp.route("/profile/<int:id>/about")
@login_required
def profile_about(id):
    if not is_spa_fragment_request():
        return render_app_shell()

    user = db.session.get(UserData, id)

    if not user:
        return jsonify({"status": "error", "message": "User not found"}), 404

    return render_template("profileAbout.html", user=user)

@profile_bp.route("/profile/<int:id>")
@login_required
def profile(id):
    if not is_spa_fragment_request():
        return render_app_shell()

    # If id=0, show new post page
    if id == 0:
        return render_template("newPost.html")

    user = db.session.execute(
        db.select(UserData).where(UserData.id == id)
    ).scalar()

    is_following = (
        db.session.execute(
            db.select(Follow).where(
                (Follow.follower_id == current_user.id)
                & (Follow.following_id == id)
            )
        ).scalar()
        is not None
    )
    return render_template("profile.html", user=user, is_following=is_following)
