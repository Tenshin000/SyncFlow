"""
SyncFlow – Notification Models.
Defines schemas for project-level notifications, recipient targeting, and join actions.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field


class NotificationTypeEnum(str, Enum):
    JOIN_REQUEST = "join_request"
    JOIN_APPROVED = "join_approved"
    JOIN_REJECTED = "join_rejected"
    REVIEW_REQUEST = "review_request"
    REVIEW_CONFIRMED = "review_confirmed"
    REVIEW_RETURNED_WIP = "review_returned_wip"


ALLOWED_NOTIFICATION_TYPES = {
    NotificationTypeEnum.JOIN_REQUEST.value,
    NotificationTypeEnum.JOIN_APPROVED.value,
    NotificationTypeEnum.JOIN_REJECTED.value,
    NotificationTypeEnum.REVIEW_REQUEST.value,
    NotificationTypeEnum.REVIEW_CONFIRMED.value,
    NotificationTypeEnum.REVIEW_RETURNED_WIP.value,
}


class CreateNotificationRequest(BaseModel):
    """Payload to create a new project-level notification."""
    project_id: str = Field(..., description="ID of the project this notification is tied to")
    project_name: Optional[str] = Field(default=None, description="Cached name of the project")
    title: str = Field(..., min_length=1, max_length=200, description="Short notification title")
    message: str = Field(..., min_length=1, max_length=1000, description="Notification message body")
    type: str = Field(default=NotificationTypeEnum.JOIN_REQUEST.value, description="Notification category/type")
    to_all: bool = Field(default=False, description="Send to all project participants")
    to_pm: bool = Field(default=False, description="Target specifically the Project Manager")
    recipient_teams: List[str] = Field(default_factory=list, description="Target team IDs or designations")
    recipient_users: List[str] = Field(default_factory=list, description="Target individual user IDs")
    sender_id: Optional[str] = Field(default=None, description="Sender user ID or 'system'")
    sender_name: Optional[str] = Field(default=None, description="Display name of sender")
    data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Custom payload (e.g. join request details)")


class NotificationActionRequest(BaseModel):
    """Payload to accept or reject an interactive notification (e.g. project join request)."""
    user_id: str = Field(..., description="User ID performing the action (must be PM)")
    action: str = Field(..., description="Action to perform: 'approve' or 'reject'")


class MarkReadRequest(BaseModel):
    """Payload to mark notifications as read."""
    user_id: str = Field(..., description="User ID marking the notification")
    project_id: Optional[str] = Field(default=None, description="Optional project filter")


class NotificationResponse(BaseModel):
    """Formatted notification response model."""
    id: str
    project_id: str
    project_name: str
    title: str
    message: str
    type: str
    to_all: bool
    to_pm: bool
    recipient_teams: List[str] = Field(default_factory=list)
    recipient_users: List[str] = Field(default_factory=list)
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    is_read: bool = False
    created_at: str
    data: Dict[str, Any] = Field(default_factory=dict)
