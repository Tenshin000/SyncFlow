import logging
from typing import Optional
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from backend.config import settings

logger = logging.getLogger(__name__)


class DatabaseConnection:
    """Singleton MongoDB Client Connection Manager."""
    
    _instance: Optional["DatabaseConnection"] = None
    _client: Optional[MongoClient] = None
    _db: Optional[Database] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DatabaseConnection, cls).__new__(cls)
        return cls._instance

    def connect(self, uri: Optional[str] = None) -> Database:
        """Establishes or returns the existing MongoDB database connection."""
        if self._db is not None:
            return self._db

        connection_uri = uri or settings.MONGO_URI
        try:
            logger.info("Connecting to MongoDB at: %s", connection_uri.split("@")[-1])
            self._client = MongoClient(
                connection_uri,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                maxPoolSize=50,
                minPoolSize=10
            )
            # Verify connectivity
            self._client.admin.command("ping")
            self._db = self._client[settings.MONGO_INITDB_DATABASE]
            self._ensure_indexes(self._db)
            logger.info("Successfully connected to MongoDB database: %s", settings.MONGO_INITDB_DATABASE)
            return self._db
        except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
            logger.error("Failed to connect to MongoDB: %s", str(exc))
            raise ConnectionError(f"Could not connect to MongoDB server: {exc}") from exc

    def _ensure_indexes(self, db: Database) -> None:
        """Creates and ensures performance indexes on all collections."""
        try:
            # Users
            db["users"].create_index("username", unique=True, background=True)
            db["users"].create_index("email", unique=True, background=True)
            db["users"].create_index("role", background=True)

            # Projects
            db["projects"].create_index("name", unique=True, background=True)
            db["projects"].create_index("created_by", background=True)
            db["projects"].create_index("assigned_user_ids", background=True)
            db["projects"].create_index("teams.member_ids", background=True)
            db["projects"].create_index("teams.lead_id", background=True)
            db["projects"].create_index("controllers", background=True)
            db["projects"].create_index("status", background=True)
            db["projects"].create_index([("created_at", -1)], background=True)
            db["projects"].create_index([("updated_at", -1)], background=True)

            # Notifications
            db["notifications"].create_index([("created_at", -1)], background=True)
            db["notifications"].create_index([("project_id", 1), ("created_at", -1)], background=True)
            db["notifications"].create_index([("recipient_users", 1), ("created_at", -1)], background=True)
            db["notifications"].create_index("deleted_by", background=True)
            db["notifications"].create_index("read_by", background=True)
            db["notifications"].create_index("type", background=True)
            db["notifications"].create_index("to_all", background=True)
            db["notifications"].create_index("to_pm", background=True)
            db["notifications"].create_index([("data.requester_id", 1), ("data.status", 1)], background=True)

            # Reusable Teams Library

            db["teams"].create_index([("name", 1), ("created_by", 1)], background=True)
        except Exception as e:
            logger.warning("Index initialization notice: %s", e)

    def get_database(self) -> Database:
        """Returns the active database instance, connecting if necessary."""
        if self._db is None:
            return self.connect()
        return self._db

    def is_healthy(self) -> bool:
        """Checks if MongoDB connection is active and responsive."""
        try:
            if self._client is None:
                self.connect()
            self._client.admin.command("ping")
            return True
        except Exception:
            return False

    def close(self):
        """Closes the MongoDB connection pool."""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None
            logger.info("MongoDB connection closed.")


db_connection = DatabaseConnection()


def get_db() -> Database:
    """Helper function to obtain the active MongoDB database."""
    return db_connection.get_database()
