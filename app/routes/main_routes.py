import re
import json
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path

from flask import (
    Blueprint,
    after_this_request,
    current_app,
    jsonify,
    make_response,
    render_template,
    request,
    send_file,
    send_from_directory,
    url_for,
    redirect
)
from flask_login import login_required, current_user
from sqlalchemy import UniqueConstraint, create_engine, inspect, select, tuple_
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from werkzeug.utils import secure_filename

from app.decorators import only_admin, verified_user
from app.extensions import db
from app import models
from app.firebase.firebase_config import get_firebase_web_config
from app.services.account_service import AccountService

main_bp = Blueprint("main", __name__)


MIGRATION_BATCH_SIZE = 1000
SQLITE_BACKUP_EXTENSIONS = {".db", ".sqlite", ".sqlite3"}


def _sqlite_database_path(require_exists=True):
    """Resolve the local SQLite database path inside the Flask instance folder."""
    configured_uri = current_app.config.get(
        "LOCAL_SQLITE_DATABASE_URI",
        current_app.config.get("SQLALCHEMY_DATABASE_URI", "sqlite:///ChatFlick.db"),
    )
    url = make_url(configured_uri)

    if url.drivername != "sqlite":
        configured_uri = "sqlite:///ChatFlick.db"
        url = make_url(configured_uri)

    if url.database in (None, "", ":memory:"):
        raise ValueError("A file-based SQLite database is required.")

    sqlite_path = Path(url.database)
    if not sqlite_path.is_absolute():
        sqlite_path = Path(current_app.instance_path) / sqlite_path

    if require_exists and not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {sqlite_path}")

    return sqlite_path


def _absolute_sqlite_uri(require_exists=True):
    """Build a SQLAlchemy SQLite URI for the local app database."""
    return f"sqlite:///{_sqlite_database_path(require_exists).as_posix()}"


def _mapped_models_by_table():
    """Return every imported ORM model keyed by its table object."""
    return {
        mapper.local_table: mapper.class_
        for mapper in db.Model.registry.mappers
        if mapper.local_table is not None
    }


def _primary_key_identity(row, primary_key_columns):
    """Extract a comparable primary-key tuple from a SQLAlchemy row mapping."""
    return tuple(row[column.name] for column in primary_key_columns)


def _existing_primary_keys(target_session, model_class, primary_key_columns, rows):
    """Fetch primary keys already present in the target database for this batch."""
    row_identities = [_primary_key_identity(row, primary_key_columns) for row in rows]
    if not row_identities:
        return set()

    model_columns = [getattr(model_class, column.name) for column in primary_key_columns]
    if len(model_columns) == 1:
        values = [identity[0] for identity in row_identities]
        existing = target_session.execute(
            select(model_columns[0]).where(model_columns[0].in_(values))
        )
        return {(value,) for value in existing.scalars().all()}

    existing = target_session.execute(
        select(*model_columns).where(tuple_(*model_columns).in_(row_identities))
    )
    return {tuple(row) for row in existing.all()}


def _unique_key_column_sets(table):
    """Discover non-primary unique keys that can also identify duplicate rows."""
    key_sets = []

    for column in table.columns:
        if column.unique and not column.primary_key:
            key_sets.append((column,))

    for constraint in table.constraints:
        if isinstance(constraint, UniqueConstraint):
            columns = tuple(constraint.columns)
            if columns and not all(column.primary_key for column in columns):
                key_sets.append(columns)

    return key_sets


def _existing_unique_keys(target_session, model_class, key_columns, rows):
    """Fetch existing values for a unique key, ignoring rows with NULL key parts."""
    identities = [
        tuple(row[column.name] for column in key_columns)
        for row in rows
        if all(row[column.name] is not None for column in key_columns)
    ]
    if not identities:
        return set()

    model_columns = [getattr(model_class, column.name) for column in key_columns]
    if len(model_columns) == 1:
        existing = target_session.execute(
            select(model_columns[0]).where(
                model_columns[0].in_([identity[0] for identity in identities])
            )
        )
        return {(value,) for value in existing.scalars().all()}

    existing = target_session.execute(
        select(*model_columns).where(tuple_(*model_columns).in_(identities))
    )
    return {tuple(row) for row in existing.all()}


def _is_duplicate_by_unique_key(target_session, model_class, table, rows):
    """Return a set of row positions that already exist by unique constraints."""
    duplicate_indexes = set()

    for key_columns in _unique_key_column_sets(table):
        existing_values = _existing_unique_keys(
            target_session, model_class, key_columns, rows
        )
        if not existing_values:
            continue

        for index, row in enumerate(rows):
            identity = tuple(row[column.name] for column in key_columns)
            if None not in identity and identity in existing_values:
                duplicate_indexes.add(index)

    return duplicate_indexes


def _copy_orm_tables(source_session, target_session, batch_size):
    """Copy all registered ORM tables from source to target in dependency order."""
    summary = {
        "tables": {},
        "inserted": 0,
        "skipped": 0,
    }

    mapped_models = _mapped_models_by_table()
    source_table_names = set(inspect(source_session.bind).get_table_names())

    # sorted_tables keeps foreign-key dependencies in a safe insert order.
    for table in db.metadata.sorted_tables:
        model_class = mapped_models.get(table)
        primary_key_columns = list(table.primary_key.columns)
        if model_class is None or not primary_key_columns:
            continue

        if table.name not in source_table_names:
            summary["tables"][table.name] = {
                "inserted": 0,
                "skipped": 0,
                "status": "missing_in_source",
            }
            continue

        try:
            table_summary = {"inserted": 0, "skipped": 0}
            result = source_session.execute(select(table)).mappings().yield_per(batch_size)
            batch = []

            for row in result:
                batch.append(dict(row))
                if len(batch) >= batch_size:
                    inserted, skipped = _copy_model_batch(
                        target_session, model_class, table, primary_key_columns, batch
                    )
                    table_summary["inserted"] += inserted
                    table_summary["skipped"] += skipped
                    batch.clear()

            if batch:
                inserted, skipped = _copy_model_batch(
                    target_session, model_class, table, primary_key_columns, batch
                )
                table_summary["inserted"] += inserted
                table_summary["skipped"] += skipped

            summary["tables"][table.name] = table_summary
            summary["inserted"] += table_summary["inserted"]
            summary["skipped"] += table_summary["skipped"]
        except Exception as exc:
            raise RuntimeError(f"Failed while copying table '{table.name}': {exc}") from exc

    return summary


def _run_database_copy(source_engine, target_engine, batch_size):
    """Open isolated sessions, copy ORM tables, and rollback the target on failure."""
    # Import model modules so every mapper is registered before table discovery.
    _ = models

    SourceSession = sessionmaker(bind=source_engine, autoflush=False, future=True)
    TargetSession = sessionmaker(bind=target_engine, autoflush=False, future=True)
    source_session = SourceSession()
    target_session = TargetSession()

    try:
        # Create missing target tables without dropping or truncating existing data.
        db.metadata.create_all(bind=target_engine)
        summary = _copy_orm_tables(source_session, target_session, batch_size)
        target_session.commit()
        return summary
    except Exception:
        target_session.rollback()
        raise
    finally:
        source_session.close()
        target_session.close()


def create_sqlite_backup_file():
    """Create a consistent SQLite backup file and return its temporary path."""
    source_path = _sqlite_database_path()
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_path = Path(tempfile.gettempdir()) / f"chatflick-backup-{timestamp}.db"

    # sqlite3 backup gives a consistent copy even while the app has DB connections.
    source_connection = sqlite3.connect(source_path)
    backup_connection = sqlite3.connect(backup_path)
    try:
        source_connection.backup(backup_connection)
    finally:
        backup_connection.close()
        source_connection.close()

    return backup_path


def _validate_sqlite_backup_file(upload_path):
    """Validate extension, SQLite header, and readability before restore."""
    if upload_path.suffix.lower() not in SQLITE_BACKUP_EXTENSIONS:
        raise ValueError("Upload a .db, .sqlite, or .sqlite3 file.")

    with upload_path.open("rb") as file:
        header = file.read(16)
    if header != b"SQLite format 3\x00":
        raise ValueError("Uploaded file is not a valid SQLite database.")

    test_connection = sqlite3.connect(upload_path)
    try:
        result = test_connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise ValueError("Uploaded SQLite database failed integrity check.")
    finally:
        test_connection.close()


def restore_sqlite_backup_to_local(upload_path, batch_size=MIGRATION_BATCH_SIZE):
    """
    Merge ORM-managed rows from an uploaded SQLite backup into the local database.

    Existing local rows are skipped by primary/unique keys. The current database
    is not deleted, and the merge is rolled back if any table fails.
    """
    _validate_sqlite_backup_file(upload_path)

    source_engine = create_engine(f"sqlite:///{upload_path.as_posix()}", future=True)
    target_engine = create_engine(_absolute_sqlite_uri(require_exists=False), future=True)
    try:
        return _run_database_copy(source_engine, target_engine, batch_size)
    finally:
        source_engine.dispose()
        target_engine.dispose()


def _copy_model_batch(target_session, model_class, table, primary_key_columns, rows):
    """Bulk-copy a batch through ORM mappings while skipping duplicate PKs."""
    existing_primary_keys = _existing_primary_keys(
        target_session, model_class, primary_key_columns, rows
    )
    duplicate_unique_indexes = _is_duplicate_by_unique_key(
        target_session, model_class, table, rows
    )
    new_rows = [
        row
        for index, row in enumerate(rows)
        if (
            index not in duplicate_unique_indexes
            and _primary_key_identity(row, primary_key_columns)
            not in existing_primary_keys
        )
    ]

    if new_rows:
        target_session.bulk_insert_mappings(model_class, new_rows)
        target_session.flush()

    return len(new_rows), len(rows) - len(new_rows)


def is_mobile_request():
    user_agent = request.headers.get("User-Agent", "")
    mobile_pattern = r"Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile"
    return re.search(mobile_pattern, user_agent, re.IGNORECASE) is not None


def is_spa_fragment_request():
    return (
        request.headers.get("X-ChatFlick-SPA") == "1"
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
    )


def render_app_shell():
    is_user_verified = current_user.status not in [
        "UNVERIFIED",
        "BANNED",
        "BLOCKED",
        "RESTRICTED",
        "DEACTIVATED",
    ]
    mobile_accounts = AccountService.random_accounts()

    if is_mobile_request():
        return render_template(
            "mobile-home.html",
            is_user_verified=is_user_verified,
            accounts=mobile_accounts,
        )

    return render_template(
        "home.html",
        is_user_verified=is_user_verified,
    )


@main_bp.route("/admin/backup/sqlite-download", methods=["GET"])
@login_required
@verified_user
@only_admin
def download_sqlite_backup_route():
    """Admin-only route that downloads a consistent SQLite backup file."""
    try:
        backup_path = create_sqlite_backup_file()

        @after_this_request
        def cleanup_backup(response):
            try:
                backup_path.unlink(missing_ok=True)
            except OSError:
                current_app.logger.warning("Could not delete temp backup %s", backup_path)
            return response

        return send_file(
            backup_path,
            as_attachment=True,
            download_name=backup_path.name,
            mimetype="application/vnd.sqlite3",
        )
    except Exception as exc:
        current_app.logger.exception("SQLite backup download failed")
        return jsonify(
            {
                "status": "error",
                "message": "SQLite backup download failed.",
                "error": str(exc),
            }
        ), 500


@main_bp.route("/admin/restore/sqlite-upload", methods=["POST"])
@login_required
@verified_user
@only_admin
def restore_sqlite_upload_route():
    """Admin-only route that merges an uploaded SQLite backup into local DB."""
    uploaded_file = request.files.get("backup_file")
    if not uploaded_file or uploaded_file.filename == "":
        return jsonify(
            {
                "status": "error",
                "message": "No SQLite backup file was uploaded.",
            }
        ), 400

    filename = secure_filename(uploaded_file.filename)
    upload_path = Path(tempfile.gettempdir()) / f"chatflick-restore-{filename}"

    try:
        uploaded_file.save(upload_path)
        db.session.remove()
        summary = restore_sqlite_backup_to_local(upload_path)
        db.session.remove()
        return jsonify(
            {
                "status": "success",
                "message": "SQLite backup merged into the local database.",
                "data": summary,
            }
        )
    except Exception as exc:
        current_app.logger.exception("SQLite restore upload failed")
        return jsonify(
            {
                "status": "error",
                "message": "SQLite restore upload failed.",
                "error": str(exc),
            }
        ), 500
    finally:
        db.session.remove()
        try:
            upload_path.unlink(missing_ok=True)
        except OSError:
            current_app.logger.warning("Could not delete temp restore file %s", upload_path)

@main_bp.route("/")
def home():

    # If user already logged in
    if current_user.is_authenticated:
        return redirect(url_for("main.homepage"))

    # Otherwise show landing page
    return render_template("index.html")

@main_bp.route("/about")
def about():
    return render_template("about.html")

@main_bp.route("/privacy-policy")
def privacy_policy():
    return render_template("privacyPolicy.html")

@main_bp.route("/terms-of-service")
def terms_of_service():
    return render_template("termsOfService.html")


@main_bp.route("/offline")
def offline():
    """Offline fallback page served by the PWA service worker."""
    return render_template("offline.html")

@main_bp.route("/manifest.json")
def manifest_json():
    """Serve the install manifest from static/pwa/manifest.json."""
    response = send_from_directory(
        Path(current_app.static_folder) / "pwa",
        "manifest.json",
        mimetype="application/manifest+json",
    )
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@main_bp.route("/manifest.webmanifest")
def web_manifest():
    """Backward-compatible manifest URL for older templates or installed clients."""
    return manifest_json()


def _service_worker_response():
    """Serve the root PWA worker so its scope covers the whole Flask app."""
    service_worker_path = Path(current_app.static_folder) / "pwa" / "service-worker.js"
    script = service_worker_path.read_text(encoding="utf-8")
    firebase_config_script = (
        "Object.assign(FIREBASE_CONFIG, "
        f"{json.dumps(get_firebase_web_config())}"
        ");"
    )
    script = script.replace(
        "// __CHATFLICK_FIREBASE_CONFIG_INJECTION__",
        firebase_config_script,
    )
    response = make_response(script)
    response.headers["Content-Type"] = "application/javascript; charset=utf-8"
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@main_bp.route("/service-worker.js")
def service_worker():
    return _service_worker_response()


@main_bp.route("/firebase-messaging-sw.js")
def firebase_messaging_sw():
    """Legacy Firebase worker URL now serves the combined PWA worker."""
    return _service_worker_response()


@main_bp.route("/home", methods=["GET", "POST"])
@login_required
def homepage():
    return render_app_shell()


@main_bp.route("/explore")
@login_required
def explore():
    return render_app_shell()


@main_bp.route("/liked")
@login_required
def liked_posts():
    return render_app_shell()


@main_bp.route("/mobile-home", methods=["GET", "POST"])
@login_required
def mobile_homepage():
    is_user_verified = current_user.status in {"VERIFIED", "PENDING_PRO", "PRO", "ENTERPRISE"}
    mobile_accounts = AccountService.random_accounts()
    return render_template(
        "mobile-home.html",
        is_user_verified=is_user_verified,
        accounts=mobile_accounts,
    )
