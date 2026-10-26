"""
SyncFlow – Notifications API Router (`/syncflow/notifications`).
Handles project-scoped notifications, recipient resolution, unread tracking,
and interactive actions (e.g. project join request approvals).
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query

from backend.database.connection import get_db
from backend.models.notification import (
    ALLOWED_NOTIFICATION_TYPES,
    CreateNotificationRequest,
    NotificationActionRequest,
    MarkReadRequest,
    NotificationResponse
)
from backend.utility import to_object_id, build_id_query, format_date



router = APIRouter(prefix="/syncflow/notifications", tags=["Project Notifications"])


def _notifications_col():
    return get_db()["notifications"]


def _projects_col():
    return get_db()["projects"]


def _users_col():
    return get_db()["users"]


def _format_notification(doc: Dict[str, Any], current_user_id: str) -> NotificationResponse:
    nid = str(doc.get("_id", ""))
    read_by = [str(u) for u in doc.get("read_by", [])]
    is_read = current_user_id in read_by

    c_at_str = format_date(doc.get("created_at"), "%Y-%m-%d %H:%M:%S")

    return NotificationResponse(

        id=nid,
        project_id=str(doc.get("project_id", "")),
        project_name=doc.get("project_name", "Project"),
        title=doc.get("title", ""),
        message=doc.get("message", ""),
        type=doc.get("type", "general"),
        to_all=bool(doc.get("to_all", False)),
        to_pm=bool(doc.get("to_pm", False)),
        recipient_teams=[str(t) for t in doc.get("recipient_teams", [])],
        recipient_users=[str(u) for u in doc.get("recipient_users", [])],
        sender_id=str(doc.get("sender_id")) if doc.get("sender_id") else None,
        sender_name=doc.get("sender_name"),
        is_read=is_read,
        created_at=c_at_str,
        data=doc.get("data", {})
    )


def _user_can_receive(doc: Dict[str, Any], user_id: str, project_doc: Dict[str, Any]) -> bool:
    """Evaluates whether a notification is directed to the given user."""
    # 1. Target all project participants
    if doc.get("to_all"):
        return True

    # 2. Targeted specifically to PM
    pm_id = str(project_doc.get("created_by", ""))
    if doc.get("to_pm") and str(user_id) == pm_id:
        return True

    # 3. Direct user recipient
    rec_users = [str(u) for u in doc.get("recipient_users", [])]
    if str(user_id) in rec_users:
        return True

    # 4. Target teams within project
    rec_teams = set(str(t) for t in doc.get("recipient_teams", []))
    if rec_teams:
        for team in project_doc.get("teams", []):
            team_id = str(team.get("team_id") or "")
            team_name = str(team.get("name") or "")
            if (team_id in rec_teams or team_name in rec_teams) and str(user_id) in [str(m) for m in team.get("member_ids", [])]:
                return True

    return False


@router.post("", response_model=NotificationResponse, status_code=201)
def create_notification(payload: CreateNotificationRequest):
    """
    Creates a new project-level notification log entry in the database.
    """
    notif_col = _notifications_col()
    proj_col = _projects_col()

    # Verify project exists
    q = build_id_query(payload.project_id)
    project = proj_col.find_one(q)

    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{payload.project_id}' not found.")

    proj_name = payload.project_name or project.get("name", "Project")

    ntype = payload.type.strip()
    if ntype not in ALLOWED_NOTIFICATION_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Notification type '{ntype}' is not allowed. Permitted types: {list(ALLOWED_NOTIFICATION_TYPES)}"
        )

    doc = {
        "project_id": str(project["_id"]),
        "project_name": proj_name,
        "title": payload.title.strip(),
        "message": payload.message.strip(),
        "type": ntype,
        "to_all": payload.to_all,
        "to_pm": payload.to_pm,
        "recipient_teams": [str(t) for t in payload.recipient_teams],
        "recipient_users": [str(u) for u in payload.recipient_users],
        "sender_id": payload.sender_id,
        "sender_name": payload.sender_name,
        "read_by": [],
        "deleted_by": [],
        "data": payload.data or {},
        "created_at": datetime.utcnow()
    }

    res = notif_col.insert_one(doc)
    doc["_id"] = res.inserted_id

    sender_id_str = str(payload.sender_id or "")
    return _format_notification(doc, sender_id_str)


@router.get("", response_model=List[NotificationResponse])
def get_notifications(
    user_id: str = Query(..., description="User ID for recipient evaluation"),
    project_id: Optional[str] = Query(None, description="Optional project ID filter")
):
    """
    Retrieves all visible notifications for the given user, optionally filtered by project.
    Notifications act as project-scoped logs with read/unread tracking.
    Notifications remain in database even if deleted; deleted_by filters per user.
    """
    notif_col = _notifications_col()
    proj_col = _projects_col()

    # Pre-fetch relevant projects with narrow projection (recipient filtering only)
    proj_projection = {
        "_id": 1,
        "name": 1,
        "created_by": 1,
        "assigned_user_ids": 1,
        "teams": 1,
        "controllers": 1
    }
    if project_id:
        q = build_id_query(project_id)
        p_docs = list(proj_col.find(q, proj_projection))

    else:
        # Match projects where user is PM, member, or controller
        m_str = str(user_id)
        conds = [
            {"created_by": m_str},
            {"assigned_user_ids": m_str},
            {"teams.member_ids": m_str},
            {"controllers": m_str}
        ]
        if ObjectId.is_valid(m_str):
            conds.append({"created_by": ObjectId(m_str)})
            conds.append({"assigned_user_ids": ObjectId(m_str)})
            conds.append({"teams.member_ids": ObjectId(m_str)})
            conds.append({"controllers": ObjectId(m_str)})
        p_docs = list(proj_col.find({"$or": conds}, proj_projection))

    proj_map = {str(p["_id"]): p for p in p_docs}

    # Query filter: must not have been soft-deleted by this user and type must be allowed
    base_filter = {
        "deleted_by": {"$ne": str(user_id)},
        "type": {"$in": list(ALLOWED_NOTIFICATION_TYPES)}
    }
    if project_id:
        base_filter["project_id"] = str(project_id)

    cursor = notif_col.find(base_filter).sort("created_at", -1)

    results = []
    for doc in cursor:
        p_id = str(doc.get("project_id", ""))
        p_doc = proj_map.get(p_id)
        if (p_doc and _user_can_receive(doc, user_id, p_doc)) or str(user_id) in [str(u) for u in doc.get("recipient_users", [])]:
            results.append(_format_notification(doc, user_id))

    return results


@router.get("/unread-count")
def get_unread_count(
    user_id: str = Query(..., description="User ID"),
    project_id: Optional[str] = Query(None, description="Optional project filter")
):
    """
    Returns the count of unread notifications for a user (used for Facebook-style badge counters).
    Highly optimized: queries unread notifications directly and bypasses full response serialization.
    """
    notif_col = _notifications_col()
    proj_col = _projects_col()

    proj_projection = {
        "_id": 1,
        "name": 1,
        "created_by": 1,
        "assigned_user_ids": 1,
        "teams": 1,
        "controllers": 1
    }
    if project_id:
        q = build_id_query(project_id)
        p_docs = list(proj_col.find(q, proj_projection))

    else:
        m_str = str(user_id)
        conds = [
            {"created_by": m_str},
            {"assigned_user_ids": m_str},
            {"teams.member_ids": m_str},
            {"controllers": m_str}
        ]
        if ObjectId.is_valid(m_str):
            conds.append({"created_by": ObjectId(m_str)})
            conds.append({"assigned_user_ids": ObjectId(m_str)})
            conds.append({"teams.member_ids": ObjectId(m_str)})
            conds.append({"controllers": ObjectId(m_str)})
        p_docs = list(proj_col.find({"$or": conds}, proj_projection))

    proj_map = {str(p["_id"]): p for p in p_docs}

    base_filter = {
        "deleted_by": {"$ne": str(user_id)},
        "read_by": {"$ne": str(user_id)},
        "type": {"$in": list(ALLOWED_NOTIFICATION_TYPES)}
    }
    if project_id:
        base_filter["project_id"] = str(project_id)

    cursor = notif_col.find(base_filter, {
        "project_id": 1,
        "to_all": 1,
        "to_pm": 1,
        "recipient_teams": 1,
        "recipient_users": 1,
        "type": 1
    })

    unread_count = 0
    u_str = str(user_id)
    for doc in cursor:
        p_id = str(doc.get("project_id", ""))
        p_doc = proj_map.get(p_id)
        if (p_doc and _user_can_receive(doc, u_str, p_doc)) or u_str in [str(u) for u in doc.get("recipient_users", [])]:
            unread_count += 1

    return {"unread_count": unread_count}


@router.put("/{notification_id}/read")
def mark_notification_read(notification_id: str, user_id: str = Query(..., description="User ID marking as read")):
    """
    Marks a notification as read by adding the user ID to the read_by array.
    The notification remains in the system log for future review.
    """
    notif_col = _notifications_col()
    q = build_id_query(notification_id)

    res = notif_col.update_one(q, {"$addToSet": {"read_by": str(user_id)}})
    if res.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Notification '{notification_id}' not found.")

    return {"message": "Notification marked as read.", "notification_id": notification_id, "is_read": True}


@router.put("/mark-all-read")
def mark_all_read(payload: MarkReadRequest):
    """
    Marks all notifications visible to the user as read.
    """
    notifications = get_notifications(user_id=payload.user_id, project_id=payload.project_id)
    if not notifications:
        return {"message": "No notifications to mark as read.", "count": 0}

    n_ids = [to_object_id(n.id) for n in notifications if not n.is_read]

    if n_ids:
        _notifications_col().update_many(
            {"_id": {"$in": n_ids}},
            {"$addToSet": {"read_by": str(payload.user_id)}}
        )

    return {"message": "All notifications marked as read.", "count": len(n_ids)}


@router.post("/{notification_id}/action")
def handle_notification_action(notification_id: str, payload: NotificationActionRequest):
    """
    Processes interactive notification actions (e.g. approving or rejecting a project join request).
    Enforces that only the Project Manager of the project can accept or reject new members.
    """
    notif_col = _notifications_col()
    proj_col = _projects_col()
    users_col = _users_col()

    # Find notification
    nq = build_id_query(notification_id)
    notif = notif_col.find_one(nq)
    if not notif:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Notification '{notification_id}' not found.")

    project_id = str(notif.get("project_id", ""))
    pq = build_id_query(project_id)
    project = proj_col.find_one(pq)

    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Associated project not found.")

    # PM authorization check
    pm_id = str(project.get("created_by", ""))
    if str(payload.user_id) != pm_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the designated Project Manager can confirm or reject project membership requests."
        )

    action = payload.action.strip().lower()
    if action not in ["approve", "reject"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Action must be either 'approve' or 'reject'.")

    notif_data = notif.get("data") or {}
    requester_id = str(notif_data.get("requester_id") or notif.get("sender_id") or "")
    requester_name = notif_data.get("requester_name") or "Team Member"
    project_name = project.get("name", "Project")

    now = datetime.utcnow()

    if action == "approve":
        # 1. Add user to assigned_user_ids in project
        proj_col.update_one(
            pq,
            {
                "$addToSet": {"assigned_user_ids": requester_id},
                "$set": {"updated_at": now}
            }
        )

        # 2. Update notification status to approved
        notif_data["status"] = "approved"
        notif_data["reviewed_by"] = payload.user_id
        notif_data["reviewed_at"] = now.isoformat()

        notif_col.update_one(
            nq,
            {
                "$set": {"data": notif_data, "updated_at": now},
                "$addToSet": {"read_by": str(payload.user_id)}
            }
        )

        # 3. Send confirmation notification to the requester
        notif_col.insert_one({
            "project_id": project_id,
            "project_name": project_name,
            "title": "Project Join Request Approved 🎉",
            "message": f"Your request to join project '{project_name}' has been approved by the Project Manager. You can now access your project workspace.",
            "type": "join_approved",
            "to_all": False,
            "to_pm": False,
            "recipient_teams": [],
            "recipient_users": [requester_id],
            "sender_id": str(payload.user_id),
            "sender_name": "Project Manager",
            "read_by": [],
            "data": {"project_id": project_id, "project_name": project_name, "status": "approved"},
            "created_at": now
        })

        return {
            "message": f"Join request for '{requester_name}' has been approved.",
            "status": "approved",
            "user_id": requester_id
        }

    else:
        # Reject join request
        notif_data["status"] = "rejected"
        notif_data["reviewed_by"] = payload.user_id
        notif_data["reviewed_at"] = now.isoformat()

        notif_col.update_one(
            nq,
            {
                "$set": {"data": notif_data, "updated_at": now},
                "$addToSet": {"read_by": str(payload.user_id)}
            }
        )

        # Send rejection notification to the requester
        notif_col.insert_one({
            "project_id": project_id,
            "project_name": project_name,
            "title": "Project Join Request Declined",
            "message": f"Your request to join project '{project_name}' was not accepted by the Project Manager.",
            "type": "join_rejected",
            "to_all": False,
            "to_pm": False,
            "recipient_teams": [],
            "recipient_users": [requester_id],
            "sender_id": str(payload.user_id),
            "sender_name": "Project Manager",
            "read_by": [],
            "data": {"project_id": project_id, "project_name": project_name, "status": "rejected"},
            "created_at": now
        })

        return {
            "message": f"Join request for '{requester_name}' has been declined.",
            "status": "rejected",
            "user_id": requester_id
        }


@router.delete("/{notification_id}")
def delete_notification(notification_id: str, user_id: str = Query(..., description="User ID requesting deletion")):
    """
    Soft-deletes a notification for the requesting user by adding user_id to the deleted_by array.
    Notifications remain permanently preserved in MongoDB, but will no longer appear for this user.
    """
    notif_col = _notifications_col()
    nq = build_id_query(notification_id)


    notif = notif_col.find_one(nq)
    if not notif:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Notification '{notification_id}' not found.")

    notif_col.update_one(nq, {"$addToSet": {"deleted_by": str(user_id)}})
    return {"message": "Notification removed from view.", "notification_id": notification_id}
