"""
SyncFlow – User Management & Authentication API (FastAPI + MongoDB).
All user CRUD and auth endpoints live under `/syncflow/user`.
"""
import re
from datetime import date, datetime
from typing import Any, Optional
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from backend.auth.security import hash_password, verify_password
from backend.database.connection import get_db
from backend.utility import build_id_query, format_date


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SyncFlow API",
    description="SyncFlow Schedule Management – backend services",
    version="1.0.0",
    docs_url="/syncflow/docs",
    openapi_url="/syncflow/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/syncflow/user", tags=["User & Authentication"])

# ── Helpers ────────────────────────────────────────────────────────────────────
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


def _check_email(email: str) -> str:
    cleaned = email.strip().lower()
    if not _EMAIL_RE.match(cleaned):
        raise ValueError("Invalid email address format.")
    return cleaned


def _check_dob(dob: date) -> date:
    today = date.today()
    if dob > today:
        raise ValueError("Date of birth cannot be in the future.")
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if age > 130:
        raise ValueError("User cannot be older than 130 years on registration date.")
    return dob


def _collection():
    return get_db()["users"]


# ── Schemas ────────────────────────────────────────────────────────────────────
class SignupRequest(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    gender: str = Field(..., description="User gender: Male, Female, or Other")
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    confirm_password: str = Field(..., min_length=6)
    date_of_birth: date
    email: str
    mobile_phone: Optional[str] = None
    is_project_manager: bool = False
    role: Optional[str] = None

    @field_validator("gender")
    @classmethod
    def val_gender(cls, v: str) -> str:
        clean = (v or "").strip().title()
        if clean not in ["Male", "Female", "Other"]:
            raise ValueError("Gender must be 'Male', 'Female', or 'Other'.")
        return clean

    @field_validator("email")
    @classmethod
    def val_email(cls, v: str) -> str:
        return _check_email(v)

    @field_validator("date_of_birth")
    @classmethod
    def val_dob(cls, v: date) -> date:
        return _check_dob(v)


class LoginRequest(BaseModel):
    identifier: Optional[str] = None
    username: Optional[str] = None
    password: str = Field(..., min_length=1)

    @model_validator(mode="before")
    @classmethod
    def populate_identifier(cls, values: Any) -> Any:
        if isinstance(values, dict):
            ident = values.get("identifier") or values.get("username")
            if not ident:
                raise ValueError("Identifier or username is required.")
            values["identifier"] = str(ident)
        return values


class UpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    gender: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None
    mobile_phone: Optional[str] = None
    date_of_birth: Optional[date] = None


class UserProfile(BaseModel):
    id: str
    first_name: str
    last_name: str
    gender: Optional[str] = None
    username: str
    role: str
    is_admin: bool
    email: str
    mobile_phone: Optional[str] = None
    date_of_birth: str
    created_at: str


# ── Document formatter ─────────────────────────────────────────────────────────
def _fmt(doc: dict[str, Any]) -> dict[str, Any]:
    dob = doc.get("date_of_birth")
    created = doc.get("created_at")
    return {
        "id": str(doc["_id"]),
        "first_name": doc.get("first_name", ""),
        "last_name": doc.get("last_name", ""),
        "gender": doc.get("gender"),
        "username": doc.get("username", ""),
        "role": doc.get("role", ""),
        "is_admin": bool(doc.get("is_admin", False)),
        "email": doc.get("email", ""),
        "mobile_phone": doc.get("mobile_phone"),
        "date_of_birth": format_date(dob),
        "created_at": format_date(created, "%Y-%m-%dT%H:%M:%S") if isinstance(created, (date, datetime)) else str(created or ""),
    }



# ── CRUD ───────────────────────────────────────────────────────────────────────
def create_user(data: SignupRequest) -> dict[str, Any]:
    if data.password != data.confirm_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Passwords do not match.")

    if data.is_project_manager:
        role, is_admin = "Project Manager", True
    else:
        role = (data.role or "").strip()
        is_admin = False

    col = _collection()
    username = data.username.strip().lower()
    email = data.email  # already cleaned by validator

    # Single query: check duplicates
    if col.find_one({"$or": [{"username": username}, {"email": email}]}):
        # Determine which field conflicts
        if col.find_one({"username": username}):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Username '{data.username}' is already taken.")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Email '{data.email}' is already registered.")

    now = datetime.utcnow()
    doc = {
        "first_name": data.first_name.strip(),
        "last_name": data.last_name.strip(),
        "gender": data.gender,
        "username": username,
        "password_hash": hash_password(data.password),
        "date_of_birth": datetime.combine(data.date_of_birth, datetime.min.time()),
        "is_admin": is_admin,
        "role": role,
        "email": email,
        "mobile_phone": data.mobile_phone.strip() if data.mobile_phone else None,
        "created_at": now,
        "updated_at": now,
    }
    result = col.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _fmt(doc)


def authenticate_user(data: LoginRequest) -> dict[str, Any]:
    identifier = (data.identifier or data.username or "").strip().lower()
    doc = _collection().find_one({"$or": [{"username": identifier}, {"email": identifier}]})
    if not doc or not verify_password(data.password, doc.get("password_hash", "")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials.")
    return _fmt(doc)


def get_user(user_id: str) -> Optional[dict[str, Any]]:
    col = _collection()
    doc = col.find_one(build_id_query(user_id))
    if not doc:
        doc = col.find_one({"username": user_id.lower().strip()})
    return _fmt(doc) if doc else None










def list_users() -> list[dict[str, Any]]:
    return [_fmt(d) for d in _collection().find().sort("created_at", -1)]


def update_user(user_id: str, data: UpdateRequest) -> Optional[dict[str, Any]]:
    col = _collection()
    try:
        oid = ObjectId(user_id)
        current = col.find_one({"_id": oid})
    except Exception:
        current = col.find_one({"_id": user_id})
        oid = user_id

    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User document not found.")

    patch: dict[str, Any] = {"updated_at": datetime.utcnow()}

    if data.first_name is not None:
        fn = data.first_name.strip()
        if not fn:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "First Name cannot be empty.")
        patch["first_name"] = fn

    if data.last_name is not None:
        ln = data.last_name.strip()
        if not ln:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Last Name cannot be empty.")
        patch["last_name"] = ln

    if data.gender is not None:
        gen = data.gender.strip().title()
        if gen not in ["Male", "Female", "Other"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Gender must be 'Male', 'Female', or 'Other'.")
        patch["gender"] = gen

    # 1. Username uniqueness check
    if data.username is not None:
        u_clean = data.username.strip().lower()
        if not u_clean or len(u_clean) < 3:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username must be at least 3 characters long.")
        duplicate_u = col.find_one({"_id": {"$ne": current["_id"]}, "username": u_clean})
        if duplicate_u:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Username '{data.username.strip()}' is already taken.")
        patch["username"] = u_clean

    # 2. Email uniqueness check
    if data.email is not None:
        clean_email = _check_email(data.email)
        duplicate_email = col.find_one({"_id": {"$ne": current["_id"]}, "email": clean_email})
        if duplicate_email:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Email '{data.email.strip()}' is already registered by another user.")
        patch["email"] = clean_email

    # 3. Governance / Role rules
    current_is_pm = bool(current.get("is_admin", False)) or (current.get("role", "").strip().lower() == "project manager")
    if data.role is not None:
        new_role = data.role.strip()
        if current_is_pm:
            # Cannot change role at all if already Project Manager
            if new_role.lower() != current.get("role", "").strip().lower() and new_role.lower() != "project manager":
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Project Managers cannot change their governance role.")
        else:
            # Cannot change role to Project Manager unless already holding that role
            if new_role.lower() == "project manager":
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your role to 'Project Manager' unless you already hold that role.")
            # Controller role is assigned exclusively by the Project Manager; users cannot self-assign this role
            if new_role.lower() == "controller" and current.get("role", "").strip().lower() != "controller":
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "The role of 'Controller' is assigned exclusively by the Project Manager; users cannot self-assign this role.")
            patch["role"] = new_role

    if data.mobile_phone is not None:
        patch["mobile_phone"] = data.mobile_phone.strip() or None

    if data.date_of_birth is not None:
        dob = _check_dob(data.date_of_birth)
        patch["date_of_birth"] = datetime.combine(dob, datetime.min.time())

    doc = col.find_one_and_update({"_id": current["_id"]}, {"$set": patch}, return_document=True)
    return _fmt(doc) if doc else None


def delete_user(user_id: str) -> bool:
    try:
        return _collection().delete_one(build_id_query(user_id)).deleted_count > 0
    except Exception:
        return False



# ── Routes ─────────────────────────────────────────────────────────────────────
@router.post("/signup", response_model=UserProfile, status_code=201)
def signup(payload: SignupRequest):
    try:
        return create_user(payload)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/login", response_model=UserProfile)
def login(payload: LoginRequest):
    return authenticate_user(payload)


@router.get("", response_model=list[UserProfile])
def get_all():
    return list_users()


@router.get("/{user_id}", response_model=UserProfile)
def get_one(user_id: str):
    user = get_user(user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return user


@router.get("/{user_id}/profile", response_model=UserProfile)
def get_profile(user_id: str):
    user = get_user(user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return user






@router.put("/{user_id}", response_model=UserProfile)
def update(user_id: str, payload: UpdateRequest):
    updated = update_user(user_id, payload)
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return updated


@router.delete("/{user_id}", status_code=200)
def delete(user_id: str):
    if not delete_user(user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return {"message": "User deleted.", "user_id": user_id}


# Health check & router registration
@app.get("/syncflow/health")
def health():
    return {"status": "ok", "service": "SyncFlow API", "timestamp": datetime.utcnow().isoformat()}


from backend.routers.projects import router as projects_router
from backend.routers.teams import router as teams_router
from backend.routers.notifications import router as notifications_router
from backend.routers.portfolio import router as portfolio_router
from backend.routers.nlp import router as nlp_router

app.include_router(router)
app.include_router(projects_router)
app.include_router(teams_router)
app.include_router(notifications_router)
app.include_router(portfolio_router)
app.include_router(nlp_router)


