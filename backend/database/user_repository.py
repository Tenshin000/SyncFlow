from datetime import datetime
from typing import Dict, List, Optional
from bson import ObjectId
from backend.database.connection import get_db
from backend.auth.security import hash_password, verify_password


class UserRepository:
    """Data Access Object for the 'users' collection."""

    def __init__(self):
        self.db = get_db()
        self.collection = self.db["users"]

    def create_user(
        self,
        username: str,
        password: str,
        first_name: str,
        last_name: str,
        gender: Optional[str] = None,
        date_of_birth: datetime = None,
        is_admin: bool = False,
        role: str = "Developer",
        email: Optional[str] = None,
        mobile_phone: Optional[str] = None
    ) -> str:
        """Creates a new user record with hashed password."""
        user_doc = {
            "first_name": first_name.strip(),
            "last_name": last_name.strip(),
            "gender": gender,
            "username": username.strip().lower(),
            "password_hash": hash_password(password),
            "date_of_birth": date_of_birth,
            "is_admin": is_admin,
            "role": role,
            "email": email.strip() if email else None,
            "mobile_phone": mobile_phone.strip() if mobile_phone else None,
            "created_at": datetime.utcnow()
        }
        result = self.collection.insert_one(user_doc)
        return str(result.inserted_id)

    def get_by_username(self, username: str) -> Optional[Dict]:
        """Fetches a user document by username."""
        return self.collection.find_one({"username": username.strip().lower()})

    def get_by_id(self, user_id: str) -> Optional[Dict]:
        """Fetches a user document by ObjectId."""
        try:
            return self.collection.find_one({"_id": ObjectId(user_id)})
        except Exception:
            return None

    def authenticate(self, username: str, password: str) -> Optional[Dict]:
        """Validates credentials and returns the user document if valid."""
        user = self.get_by_username(username)
        if not user:
            return None
        if verify_password(password, user.get("password_hash", "")):
            return user
        return None

    def list_all(self) -> List[Dict]:
        """Returns all registered users (excluding password hashes)."""
        return list(self.collection.find({}, {"password_hash": 0}))
