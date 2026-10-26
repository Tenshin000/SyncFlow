"""
MongoDB Database Initialization & Schema Provisioning Script.
Applies $jsonSchema validation rules, builds indexes, and seeds initial data.
"""
import sys
import logging
from pymongo.errors import CollectionInvalid, OperationFailure
from backend.database.connection import get_db, db_connection
from backend.database.validators import USERS_COLLECTION_VALIDATOR, PROJECTS_COLLECTION_VALIDATOR
from backend.database.user_repository import UserRepository
from backend.database.project_repository import ProjectRepository
from backend.scripts.sample_data import SEED_USERS, build_sample_project

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def setup_collections_and_validators(db):
    """Creates collections with $jsonSchema validation or updates existing schemas via collMod."""
    collections = {
        "users": USERS_COLLECTION_VALIDATOR,
        "projects": PROJECTS_COLLECTION_VALIDATOR
    }

    existing_collections = db.list_collection_names()

    for col_name, validator in collections.items():
        if col_name not in existing_collections:
            logger.info("Creating collection '%s' with $jsonSchema validation...", col_name)
            try:
                db.create_collection(
                    col_name,
                    validator=validator,
                    validationLevel="strict",
                    validationAction="error"
                )
                logger.info("Collection '%s' created successfully.", col_name)
            except CollectionInvalid:
                logger.warning("Collection '%s' already exists.", col_name)
        else:
            logger.info("Updating existing collection '%s' validator via collMod...", col_name)
            try:
                db.command({
                    "collMod": col_name,
                    "validator": validator,
                    "validationLevel": "strict",
                    "validationAction": "error"
                })
                logger.info("Validator updated for '%s'.", col_name)
            except OperationFailure as err:
                logger.warning("Could not apply collMod for '%s': %s", col_name, err)


def setup_indexes(db):
    """Configures performance and uniqueness indexes."""
    logger.info("Configuring MongoDB indexes...")
    # Unique username index for authentication
    db["users"].create_index("username", unique=True)
    db["users"].create_index("role")

    # Project indexes
    db["projects"].create_index("name", unique=True)
    db["projects"].create_index("created_at")
    db["projects"].create_index("activities.activity_id")
    logger.info("Indexes successfully created.")


def seed_database(db):
    """Inserts initial users and a comprehensive sample project with full WBS hierarchy."""
    import os
    import json
    from datetime import datetime

    user_repo = UserRepository()
    project_repo = ProjectRepository()

    user_ids = {}
    json_candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../docker/mongo-init/users.json")),
        "/docker-entrypoint-initdb.d/users.json",
        "/app/docker/mongo-init/users.json"
    ]
    users_json_path = next((p for p in json_candidates if os.path.exists(p)), None)

    if users_json_path:
        logger.info("Found users.json at %s. Seeding users from file...", users_json_path)
        with open(users_json_path, "r", encoding="utf-8") as f:
            json_users = json.load(f)

        seen_usernames = set()
        for idx, user_info in enumerate(json_users):
            raw_u = (user_info.get("username") or f"user_{idx+1}").strip().lower()
            username = raw_u
            counter = 2
            while username in seen_usernames:
                username = f"{raw_u}{counter}"
                counter += 1
            seen_usernames.add(username)

            # Parse date_of_birth
            raw_dob = user_info.get("date_of_birth")
            if isinstance(raw_dob, dict) and "$date" in raw_dob:
                date_str = raw_dob["$date"]
                dob = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            elif isinstance(raw_dob, str):
                dob = datetime.fromisoformat(raw_dob.replace("Z", "+00:00"))
            else:
                dob = datetime(1995, 1, 1)

            existing = user_repo.get_by_username(username)
            if existing:
                user_ids[username] = str(existing["_id"])
            else:
                new_id = user_repo.create_user(
                    username=username,
                    password=user_info.get("password", "Mhanz0_0"),
                    first_name=user_info.get("first_name", ""),
                    last_name=user_info.get("last_name", ""),
                    gender=user_info.get("gender"),
                    date_of_birth=dob,
                    is_admin=bool(user_info.get("is_admin", False)),
                    role=user_info.get("role", "Developer"),
                    email=user_info.get("email"),
                    mobile_phone=user_info.get("mobile_phone")
                )
                user_ids[username] = new_id
    else:
        logger.info("Seeding initial users from fallback SEED_USERS...")
        for user_info in SEED_USERS:
            existing = user_repo.get_by_username(user_info["username"])
            if existing:
                user_ids[user_info["username"]] = str(existing["_id"])
                logger.info("User '%s' already exists (ID: %s).", user_info["username"], existing["_id"])
            else:
                new_id = user_repo.create_user(
                    username=user_info["username"],
                    password=user_info["password"],
                    first_name=user_info["first_name"],
                    last_name=user_info["last_name"],
                    gender=user_info.get("gender"),
                    date_of_birth=user_info["date_of_birth"],
                    is_admin=user_info["is_admin"],
                    role=user_info["role"],
                    email=user_info["email"],
                    mobile_phone=user_info.get("mobile_phone")
                )
                user_ids[user_info["username"]] = new_id
                logger.info("Created user '%s' with ID: %s", user_info["username"], new_id)

    # Seed Sample Project
    sample_proj_data = build_sample_project(user_ids)
    existing_proj = project_repo.get_by_name(sample_proj_data["name"])

    if existing_proj:
        logger.info("Sample project '%s' already exists (ID: %s).", sample_proj_data["name"], existing_proj["_id"])
    else:
        proj_id = project_repo.create_project(sample_proj_data)
        logger.info("Sample project created successfully with ID: %s", proj_id)
        logger.info(
            "Project hierarchy inserted: %d Activities, %d Dependencies.",
            len(sample_proj_data["activities"]),
            len(sample_proj_data["dependencies"])
        )


def main():
    try:
        db = get_db()
        setup_collections_and_validators(db)
        setup_indexes(db)
        seed_database(db)
        logger.info("Database provisioning and seeding completed successfully!")
    except Exception as exc:
        logger.error("Initialization failed: %s", exc, exc_info=True)
        sys.exit(1)
    finally:
        db_connection.close()


if __name__ == "__main__":
    main()
