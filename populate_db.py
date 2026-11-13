#!/usr/bin/env python3
"""SyncFlow Database Population Script.

Populates the MongoDB database by importing initial documents from:
- users.json -> 'users' collection
- projects.json -> 'projects' collection
- notifications.json -> 'notifications' collection

Handles MongoDB Extended JSON BSON deserialization ($oid -> ObjectId, $date -> datetime)
and password hashing compliance for the MongoDB schema validator.
"""
import os
import sys
import json
import argparse
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from bson import ObjectId
from pymongo import MongoClient

# Pre-computed bcrypt hash for seed accounts with password "Mhanz0_0"
DEFAULT_BCRYPT_HASH = "$2b$12$b6XxCOm1IjPbHetAGTvHmeFbwyMKOjuZo0PDCmaILVws0klJw2CGS"
BASE_USER_OID_HEX = 0x6acfb05eb1e16744cbcd064f

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DOCKER_INIT_DIR = os.path.join(PROJECT_ROOT, "docker", "mongo-init")


def _find_file(filename: str) -> str:
    """Searches for a JSON file across candidate search paths."""
    candidates = [
        os.path.join(DOCKER_INIT_DIR, filename),
        os.path.join(PROJECT_ROOT, filename),
        os.path.join("/docker-entrypoint-initdb.d", filename),
        os.path.join("/app/docker/mongo-init", filename),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    raise FileNotFoundError(f"Could not find '{filename}' in candidate paths: {candidates}")


def _get_mongo_uri() -> str:
    """Resolves MongoDB URI from environment or config, adjusting for host execution."""
    uri = os.environ.get("MONGO_URI")
    if not uri:
        env_file = os.path.join(PROJECT_ROOT, "docker", "public.env")
        if os.path.isfile(env_file):
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("MONGO_URI="):
                        uri = line.split("=", 1)[1].strip()
                        break

    if not uri:
        uri = "mongodb://syncflow_admin:syncflow_password123@localhost:27017/syncflow_db?authSource=admin"

    # If running on host machine, change internal docker host 'mongodb:27017' to 'localhost:27017'
    if "@mongodb:" in uri:
        # Check if running inside container by checking /.dockerenv
        if not os.path.exists("/.dockerenv"):
            uri = uri.replace("@mongodb:", "@localhost:")

    return uri


def revive_bson(val: Any) -> Any:
    """Recursively converts MongoDB Extended JSON objects ($oid, $date) to native BSON types."""
    if val is None or isinstance(val, (int, float, str, bool, bytes)):
        return val

    if isinstance(val, list):
        return [revive_bson(item) for item in val]

    if isinstance(val, dict):
        # ObjectId
        if len(val) == 1 and "$oid" in val:
            return ObjectId(val["$oid"])

        # ISODate / DateTime
        if len(val) == 1 and "$date" in val:
            date_val = val["$date"]
            if isinstance(date_val, (int, float)):
                # Milliseconds timestamp
                return datetime.fromtimestamp(date_val / 1000.0, tz=timezone.utc)
            if isinstance(date_val, str):
                cleaned = date_val.replace("Z", "+00:00")
                try:
                    return datetime.fromisoformat(cleaned)
                except ValueError:
                    return datetime.now(timezone.utc)

        # General dictionary recursion
        return {k: revive_bson(v) for k, v in val.items()}

    return val


def _prepare_user_doc(doc: Dict[str, Any], idx: int, seen_usernames: set) -> Dict[str, Any]:
    """Ensures user document satisfies the MongoDB $jsonSchema validator constraints."""
    # Ensure _id is an ObjectId
    if "_id" not in doc or not isinstance(doc["_id"], ObjectId):
        doc["_id"] = ObjectId(f"{BASE_USER_OID_HEX + idx:024x}")

    # Disambiguate unique username if duplicate found
    raw_u = str(doc.get("username", "") or f"user_{idx + 1}").strip().lower()
    final_u = raw_u
    counter = 2
    while final_u in seen_usernames:
        final_u = f"{raw_u}{counter}"
        counter += 1
    seen_usernames.add(final_u)
    doc["username"] = final_u

    # Handle password hashing
    if "password_hash" not in doc or not doc["password_hash"]:
        plain_pwd = doc.pop("password", "Mhanz0_0")
        if plain_pwd == "Mhanz0_0":
            doc["password_hash"] = DEFAULT_BCRYPT_HASH
        else:
            try:
                import bcrypt
                doc["password_hash"] = bcrypt.hashpw(plain_pwd.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")
            except Exception:
                doc["password_hash"] = DEFAULT_BCRYPT_HASH
    else:
        doc.pop("password", None)

    # Ensure required date types
    if "date_of_birth" in doc and not isinstance(doc["date_of_birth"], datetime):
        doc["date_of_birth"] = datetime(1995, 1, 1, tzinfo=timezone.utc)

    if "created_at" in doc and not isinstance(doc["created_at"], datetime):
        doc["created_at"] = datetime.now(timezone.utc)

    if "updated_at" not in doc or not isinstance(doc["updated_at"], datetime):
        doc["updated_at"] = doc.get("created_at") or datetime.now(timezone.utc)

    # Clean strings
    doc["first_name"] = str(doc.get("first_name", "")).strip()
    doc["last_name"] = str(doc.get("last_name", "")).strip()
    doc["is_admin"] = bool(doc.get("is_admin", False))

    return doc


def populate_collection(db, collection_name: str, file_path: str, clean: bool = False) -> int:
    """Loads a JSON file and populates the given collection."""
    print(f"\n[-] Processing '{collection_name}' from: {os.path.basename(file_path)}")
    with open(file_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    if not isinstance(raw_data, list):
        raise ValueError(f"Expected JSON array in {file_path}, got {type(raw_data)}")

    col = db[collection_name]

    if clean:
        deleted = col.delete_many({})
        print(f"    Cleaned existing {deleted.deleted_count} documents from '{collection_name}'.")

    seen_usernames = set()
    imported_count = 0
    for idx, item in enumerate(raw_data):
        doc = revive_bson(item)
        if collection_name == "users":
            doc = _prepare_user_doc(doc, idx, seen_usernames)

        # Upsert document by _id to ensure idempotency
        doc_id = doc.get("_id")
        if doc_id:
            col.replace_one({"_id": doc_id}, doc, upsert=True)
        else:
            col.insert_one(doc)
        imported_count += 1

    print(f"    Successfully imported {imported_count} documents into '{collection_name}'.")
    return imported_count


def populate_database(mongo_uri: Optional[str] = None, clean: bool = False) -> None:
    """Main database population routine."""
    print("=" * 65)
    print("           SYNCFLOW DATABASE POPULATION TOOL")
    print("=" * 65)

    uri = mongo_uri or _get_mongo_uri()
    # Mask password for display
    display_uri = uri
    if "@" in uri:
        prefix, host_part = uri.split("@", 1)
        scheme_user = prefix.split(":")[0] + "://***:***"
        display_uri = f"{scheme_user}@{host_part}"

    print(f"Connecting to MongoDB: {display_uri}")
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db_name = client.get_default_database().name if client.get_default_database() is not None else "syncflow_db"
        db = client[db_name]
        print(f"Connected to database: '{db.name}'")
    except Exception as exc:
        print(f"\n[ERROR] Failed to connect to MongoDB: {exc}")
        print("Please ensure MongoDB container is running ('docker compose up -d').")
        sys.exit(1)

    # 1. Users
    users_path = _find_file("users.json")
    user_count = populate_collection(db, "users", users_path, clean=clean)

    # 2. Projects
    projects_path = _find_file("projects.json")
    project_count = populate_collection(db, "projects", projects_path, clean=clean)

    # 3. Notifications
    notifs_path = _find_file("notifications.json")
    notif_count = populate_collection(db, "notifications", notifs_path, clean=clean)

    print("\n" + "=" * 65)
    print("Database population completed successfully:")
    print(f"  - Users collection:         {user_count} documents")
    print(f"  - Projects collection:      {project_count} documents (with complete WBS & activities)")
    print(f"  - Notifications collection: {notif_count} documents")
    print("=" * 65 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Populate SyncFlow MongoDB collections from JSON files.")
    parser.add_argument("--clean", action="store_true", help="Clean/empty collections before importing.")
    parser.add_argument("--uri", type=str, default=None, help="Custom MongoDB connection URI.")
    args = parser.parse_args()

    populate_database(mongo_uri=args.uri, clean=args.clean)


if __name__ == "__main__":
    main()
