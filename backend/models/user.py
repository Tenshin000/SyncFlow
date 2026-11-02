"""
SyncFlow – User Pydantic models (shared type definitions).
Note: the live auth flow uses schemas defined inline in backend/user.py.
      These models serve as a shared reference for future features (e.g. admin panels).
"""
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field


class UserBase(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    gender: Optional[str] = Field(default=None, description="User gender: Male, Female, or Other")
    username: str = Field(..., min_length=3, max_length=50, description="Unique login handle")
    date_of_birth: date = Field(..., description="Date of birth")
    is_admin: bool = Field(default=False, description="True if Project Manager or Admin")
    role: Optional[str] = Field(default=None, description="Free-text functional role")
    email: Optional[str] = Field(default=None, description="Contact email")
    mobile_phone: Optional[str] = Field(default=None, description="Mobile contact phone number")


class UserCreate(UserBase):
    password: str = Field(..., min_length=6, description="Plaintext password to be hashed with bcrypt")


class UserInDB(UserBase):
    id: Optional[str] = Field(default=None, alias="_id")
    password_hash: str = Field(..., description="Bcrypt salted password hash")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True


class UserPublic(UserBase):
    id: Optional[str] = Field(default=None, alias="_id")
    created_at: Optional[datetime] = None

    class Config:
        populate_by_name = True
