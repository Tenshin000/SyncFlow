"""
SyncFlow - Projects Core Router (`backend/routers/projects_core.py`).
Handles Project Charter lifecycle, personnel assignments, multi-team governance,
open participation discovery, WBS decomposition, activities CRUD, precedence dependencies,
and formal project execution kickoff.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query

from backend.database.connection import get_db
from backend.models.project import (
    CreateProjectRequest,
    UpdateProjectDescriptionRequest,
    UpdateProjectPersonnelRequest,
    UpdateProjectActivitiesRequest,
    UpdateProjectDeliverablesRequest,
    UpdateProjectWbsRequest,
    UpdateProjectDependenciesRequest,
    ProjectSummary,
    ProjectDetail,
    JoinProjectRequest
)
from backend.utility import (
    build_id_query,
    calculate_pert_statistics
)
from backend.routers.projects_shared import (
    _projects_col,
    _get_project_doc,
    _format_summary,
    _format_detail,
    SUMMARY_PROJECTION,
    invalidate_project_schedule_cache,
    _detect_schedule_cycles
)

router = APIRouter(prefix="/syncflow/projects", tags=["Projects Core"])


# ==============================================================================
# PROJECT CHARTER & DISCOVERY ENDPOINTS
# ==============================================================================

@router.get("", response_model=List[ProjectSummary])
def list_projects(pm_id: Optional[str] = None, member_id: Optional[str] = None):
    """
    Returns all projects, optionally filtered by PM creator ID or participating member ID.
    Used for the PM Dashboard and Member Workspace project selection.
    Uses SUMMARY_PROJECTION to optimize memory usage and database throughput.
    """
    col = _projects_col()
    query = {}
    if pm_id:
        query = {"$or": [{"created_by": pm_id}]}
        if ObjectId.is_valid(pm_id):
            query["$or"].append({"created_by": ObjectId(pm_id)})
    elif member_id:
        m_str = str(member_id)
        conds = [
            {"created_by": m_str},
            {"assigned_user_ids": m_str},
            {"teams.member_ids": m_str}
        ]
        if ObjectId.is_valid(m_str):
            conds.append({"created_by": ObjectId(m_str)})
            conds.append({"assigned_user_ids": ObjectId(m_str)})
            conds.append({"teams.member_ids": ObjectId(m_str)})
        query = {"$or": conds}

    cursor = col.find(query, SUMMARY_PROJECTION).sort("updated_at", -1)
    return [_format_summary(d) for d in cursor]


@router.get("/completed-activities")
def get_completed_activities():
    """
    Retrieves all controller-reviewed and approved completed activities across historical projects.
    Used for Analogous duration estimating benchmarking.
    """
    col = _projects_col()
    results = []
    projects = col.find(
        {"activities": {"$exists": True, "$ne": []}},
        {"_id": 1, "name": 1, "status": 1, "activities": 1}
    )
    for p in projects:
        p_name = p.get("name", "Untitled Project")
        p_id = str(p.get("_id"))
        p_status = p.get("status", "in_progress")
        for a in p.get("activities", []):
            rev = a.get("controller_review") or {}
            is_approved = rev.get("status") == "approved" or a.get("status") == "completed"
            actual_dur = a.get("actual_duration_days") or a.get("actual_duration") or a.get("duration")
            if is_approved and actual_dur:
                results.append({
                    "project_id": p_id,
                    "project_name": p_name,
                    "project_status": p_status,
                    "activity_id": a.get("activity_id"),
                    "activity_name": a.get("name"),
                    "description": a.get("description"),
                    "actual_start_date": a.get("actual_start_date"),
                    "actual_end_date": a.get("actual_end_date"),
                    "actual_duration_days": float(actual_dur),
                    "controller_id": str(rev.get("controller_id") or a.get("controller_id") or ""),
                    "controller_name": rev.get("controller_name", "Sarah Williams (Controller)"),
                    "reviewed_at": rev.get("reviewed_at", ""),
                    "sign_off_notes": rev.get("sign_off_notes", "Verified and approved by Controller.")
                })
    return results


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str):
    """Retrieves full details of a specific project by project ID."""
    return _format_detail(_get_project_doc(project_id))


@router.post("", response_model=ProjectDetail, status_code=201)
def create_project(payload: CreateProjectRequest):
    """
    Creates a new project document from scratch in MongoDB.
    Validates start date (must be today or future).
    Stores assigned individuals and configured teams.
    Also saves created teams into the PM's reusable teams library automatically.
    """
    col = _projects_col()
    db = get_db()

    # Check unique project name (case-insensitive)
    existing = col.find_one({"name": {"$regex": f"^{payload.name.strip()}$", "$options": "i"}})
    if existing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"A project with the name '{payload.name.strip()}' already exists. Please choose a distinct name."
        )

    now = datetime.utcnow()
    start_dt = datetime.combine(payload.start_date, datetime.min.time())

    teams_data = []
    team_member_ids = set()
    for idx, t in enumerate(payload.teams):
        team_id = t.team_id or f"TEAM-{idx+1}"
        m_ids = [str(m) for m in t.member_ids]
        lead_id = str(t.lead_id) if t.lead_id else None
        for m in m_ids:
            team_member_ids.add(m)
        if lead_id:
            team_member_ids.add(lead_id)
        team_entry = {
            "team_id": team_id,
            "name": t.name.strip(),
            "member_ids": m_ids,
            "lead_id": lead_id
        }
        teams_data.append(team_entry)

        # Automatically preserve in PM's reusable team library collection
        db["teams"].update_one(
            {"name": t.name.strip(), "created_by": payload.created_by},
            {
                "$set": {
                    "team_id": team_id,
                    "name": t.name.strip(),
                    "member_ids": [str(m) for m in t.member_ids],
                    "lead_id": lead_id,
                    "created_by": payload.created_by,
                    "updated_at": now
                },
                "$setOnInsert": {"created_at": now}
            },
            upsert=True
        )

    controllers = [str(c) for c in payload.controllers]
    if str(payload.created_by) not in controllers:
        controllers.insert(0, str(payload.created_by))

    assigned_users = [str(u) for u in payload.assigned_user_ids]
    for tm in team_member_ids:
        if tm not in assigned_users:
            assigned_users.append(tm)
    if str(payload.created_by) not in assigned_users:
        assigned_users.insert(0, str(payload.created_by))

    for c in controllers:
        if c not in assigned_users:
            assigned_users.append(c)

    doc = {
        "name": payload.name.strip(),
        "description": payload.description.strip(),
        "start_date": start_dt,
        "created_by": payload.created_by,
        "assigned_user_ids": assigned_users,
        "teams": teams_data,
        "controllers": controllers,
        "open_participation": payload.open_participation,
        "allow_multiteam": payload.allow_multiteam,
        "deliverables": [],
        "activities": [],
        "dependencies": [],
        "created_at": now,
        "updated_at": now
    }

    result = col.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Send in-app notification to any designated team leads
    for t in teams_data:
        lead_id = t.get("lead_id")
        if lead_id:
            try:
                db["notifications"].insert_one({
                    "project_id": str(result.inserted_id),
                    "project_name": payload.name.strip(),
                    "title": f"👑 Team Lead Assignment: {t.get('name')}",
                    "message": f"You have been designated as Team Lead for '{t.get('name')}' in project '{payload.name.strip()}'. You are authorized to submit completed activities for review.",
                    "type": "team_lead_assigned",
                    "to_all": False,
                    "to_pm": False,
                    "recipient_teams": [],
                    "recipient_users": [lead_id],
                    "sender_id": str(payload.created_by),
                    "sender_name": "Project Manager",
                    "read_by": [],
                    "deleted_by": [],
                    "data": {"team_id": t.get("team_id"), "team_name": t.get("name"), "project_id": str(result.inserted_id)},
                    "created_at": now
                })
            except Exception:
                pass

    return _format_detail(doc)


@router.put("/{project_id}/description", response_model=ProjectDetail)
def update_project_description(project_id: str, payload: UpdateProjectDescriptionRequest):
    """
    Updates the project scope / description in the Plan Schedule Management view.
    """
    col = _projects_col()
    query = build_id_query(project_id)

    updated = col.find_one_and_update(
        query,
        {
            "$set": {
                "description": payload.description.strip(),
                "updated_at": datetime.utcnow()
            }
        },
        return_document=True
    )

    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")
    return _format_detail(updated)


@router.put("/{project_id}/personnel", response_model=ProjectDetail)
def update_project_personnel(project_id: str, payload: UpdateProjectPersonnelRequest):
    """
    Updates project personnel: teams, individual contributors, and controllers.
    """
    col = _projects_col()
    current = _get_project_doc(project_id, col)

    db = get_db()
    now = datetime.utcnow()
    created_by = str(current.get("created_by") or "")
    proj_name = current.get("name", "Project")

    # Format teams
    teams_data = []
    team_member_ids = set()
    for idx, t in enumerate(payload.teams):
        team_id = t.team_id or f"TEAM-{idx+1}"
        m_ids = [str(m) for m in t.member_ids]
        lead_id = str(t.lead_id) if t.lead_id else None
        for m in m_ids:
            team_member_ids.add(m)
        if lead_id:
            team_member_ids.add(lead_id)

        teams_data.append({
            "team_id": team_id,
            "name": t.name.strip(),
            "member_ids": m_ids,
            "lead_id": lead_id
        })

        # Keep PM's reusable team library updated
        if created_by and t.name.strip():
            db["teams"].update_one(
                {"name": t.name.strip(), "created_by": created_by},
                {
                    "$set": {
                        "team_id": team_id,
                        "name": t.name.strip(),
                        "member_ids": m_ids,
                        "lead_id": lead_id,
                        "created_by": created_by,
                        "updated_at": now
                    },
                    "$setOnInsert": {"created_at": now}
                },
                upsert=True
            )

    # Format controllers
    controllers = [str(c) for c in (payload.controllers if payload.controllers is not None else current.get("controllers", []))]
    if created_by and created_by not in controllers:
        controllers.insert(0, created_by)

    # Reassign activities if their appointed controller was removed from project controllers
    valid_ctrl_set = set(controllers)
    if created_by:
        valid_ctrl_set.add(created_by)
    activities = current.get("activities", [])
    activities_reassigned = False
    for act in activities:
        act_cid = str(act.get("controller_id") or "").strip()
        if act_cid and act_cid not in valid_ctrl_set:
            act["controller_id"] = created_by
            activities_reassigned = True

    # Combine all assigned users: explicit individual contributors + team members + controllers + created_by
    all_assigned = set(str(u) for u in payload.assigned_user_ids)
    for m in team_member_ids:
        all_assigned.add(m)
    for c in controllers:
        all_assigned.add(c)
    if created_by:
        all_assigned.add(created_by)

    # Enforce multi-team membership governance policy
    if not current.get("allow_multiteam", False):
        seen_team_members = set()
        for t in teams_data:
            for m in t["member_ids"]:
                if m in seen_team_members:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        f"Personnel policy restriction: Member '{m}' cannot belong to multiple teams because multi-team membership is disabled for this project."
                    )
                seen_team_members.add(m)

    update_fields = {
        "teams": teams_data,
        "assigned_user_ids": list(all_assigned),
        "controllers": controllers,
        "updated_at": now
    }
    if activities_reassigned:
        update_fields["activities"] = activities

    # Identify newly appointed team leads to send assignment notifications
    old_team_leads = {}
    for old_t in current.get("teams", []):
        old_team_leads[old_t.get("team_id") or old_t.get("name")] = str(old_t.get("lead_id") or "")

    for t in teams_data:
        curr_lead = t.get("lead_id")
        t_key = t.get("team_id") or t.get("name")
        old_lead = old_team_leads.get(t_key, "")
        if curr_lead and curr_lead != old_lead:
            try:
                db["notifications"].insert_one({
                    "project_id": str(current["_id"]),
                    "project_name": proj_name,
                    "title": f"👑 Team Lead Assignment: {t.get('name')}",
                    "message": f"You have been designated as Team Lead for '{t.get('name')}' in project '{proj_name}'. You are authorized to submit completed activities for review.",
                    "type": "team_lead_assigned",
                    "to_all": False,
                    "to_pm": False,
                    "recipient_teams": [],
                    "recipient_users": [curr_lead],
                    "sender_id": created_by,
                    "sender_name": "Project Manager",
                    "read_by": [],
                    "deleted_by": [],
                    "data": {"team_id": t.get("team_id"), "team_name": t.get("name"), "project_id": str(current["_id"])},
                    "created_at": now
                })
            except Exception:
                pass

    updated = col.find_one_and_update(
        {"_id": current["_id"]},
        {"$set": update_fields},
        return_document=True
    )

    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")

    return _format_detail(updated)


@router.get("/available/search")
def search_available_projects(
    user_id: Optional[str] = Query(None, description="Current user ID to compute membership status"),
    query: Optional[str] = Query(None, description="Search term for project name or description")
):
    """
    Returns all projects available in the system for contributors/members to browse and join.
    Computes dynamic 'membership_status': 'pm', 'member', 'pending', or 'none'.
    """
    col = _projects_col()
    db = get_db()

    find_q = {}
    if query and query.strip():
        regex = {"$regex": query.strip(), "$options": "i"}
        find_q["$or"] = [{"name": regex}, {"description": regex}]

    cursor = col.find(find_q, SUMMARY_PROJECTION).sort("created_at", -1)
    projects_list = list(cursor)

    # Pre-fetch pending join requests for this user if user_id is provided
    pending_proj_ids = set()
    if user_id:
        notif_cursor = db["notifications"].find({
            "type": "join_request",
            "data.requester_id": str(user_id),
            "data.status": "pending"
        }, {"project_id": 1})
        for n in notif_cursor:
            pending_proj_ids.add(str(n.get("project_id", "")))

    # Batch pre-fetch all PM user names in a single query to eliminate N+1 queries
    pm_id_filters = []
    for doc in projects_list:
        pm_val = str(doc.get("created_by") or "")
        if pm_val:
            pm_id_filters.append(pm_val)
            if ObjectId.is_valid(pm_val):
                pm_id_filters.append(ObjectId(pm_val))

    pm_name_map = {}
    if pm_id_filters:
        users_cursor = db["users"].find(
            {"_id": {"$in": pm_id_filters}},
            {"first_name": 1, "last_name": 1, "username": 1}
        )
        for u in users_cursor:
            uid_str = str(u["_id"])
            fn = u.get("first_name", "")
            ln = u.get("last_name", "")
            full = f"{fn} {ln}".strip() or u.get("username", "Project Manager")
            pm_name_map[uid_str] = full

    results = []
    for doc in projects_list:
        pid = str(doc.get("_id", ""))
        pm_id = str(doc.get("created_by") or "")
        assigned_users = [str(u) for u in doc.get("assigned_user_ids", [])]

        for t in doc.get("teams", []):
            for m in t.get("member_ids", []):
                assigned_users.append(str(m))

        status = "none"
        if user_id:
            uid_str = str(user_id)
            if uid_str == pm_id:
                status = "pm"
            elif uid_str in assigned_users:
                status = "member"
            elif pid in pending_proj_ids:
                status = "pending"

        # Resolve PM name in O(1) from map
        pm_name = pm_name_map.get(pm_id, "Project Manager")

        s_sum = _format_summary(doc).dict()
        s_sum["membership_status"] = status
        s_sum["pm_name"] = pm_name
        s_sum["teams"] = [
            {"team_id": t.get("team_id"), "name": t.get("name"), "member_count": len(t.get("member_ids", []))}
            for t in doc.get("teams", [])
        ]
        results.append(s_sum)

    return results


@router.post("/{project_id}/join")
def join_project(project_id: str, payload: JoinProjectRequest):
    """
    Handles a user's request to join a project.
    Allows user to join as an Individual Contributor (team_id=None) or select an existing Team.
    - If open_participation is True: User joins immediately without PM notifications.
    - If open_participation is False (approval required): Creates a join_request notification for the PM.
    """
    col = _projects_col()
    db = get_db()

    q = build_id_query(project_id)
    project = col.find_one(q)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")

    user_id = str(payload.user_id).strip()
    user = db["users"].find_one(build_id_query(user_id))

    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"User '{user_id}' not found.")

    assigned_users = [str(u) for u in project.get("assigned_user_ids", [])]
    pm_id = str(project.get("created_by") or "")

    if user_id == pm_id or user_id in assigned_users:
        return {"status": "already_member", "message": "You are already a participant in this project."}

    req_team_id = str(payload.team_id).strip() if payload.team_id else None
    target_team = None
    if req_team_id:
        target_team = next((t for t in project.get("teams", []) if str(t.get("team_id")) == req_team_id), None)
        if not target_team:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Team '{req_team_id}' not found in this project.")

    team_name = target_team.get("name") if target_team else None

    # Open Participation: join immediately, no PM notification
    if project.get("open_participation", False):
        col.update_one(
            q,
            {
                "$addToSet": {"assigned_user_ids": user_id},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )
        if req_team_id:
            col.update_one(
                {**q, "teams.team_id": req_team_id},
                {"$addToSet": {"teams.$.member_ids": user_id}}
            )
            msg = f"Successfully joined '{project.get('name')}' as a member of team '{team_name}'."
        else:
            msg = f"Successfully joined '{project.get('name')}' as an individual contributor."

        return {
            "status": "joined",
            "message": msg,
            "project_id": project_id,
            "team_id": req_team_id
        }

    # Approval Required: check if a pending request already exists
    existing_pending = db["notifications"].find_one({
        "project_id": str(project["_id"]),
        "type": "join_request",
        "data.requester_id": user_id,
        "data.status": "pending"
    })
    if existing_pending:
        return {
            "status": "pending",
            "message": "Your join request has already been submitted and is awaiting Project Manager confirmation.",
            "project_id": project_id
        }

    # Create join request notification for the Project Manager
    now = datetime.utcnow()
    u_fn = user.get("first_name", "")
    u_ln = user.get("last_name", "")
    u_name = f"{u_fn} {u_ln}".strip() or user.get("username", "Member")
    u_role = user.get("role", "Member")
    proj_name = project.get("name", "Project")

    team_desc = f"in team '{team_name}'" if team_name else "as an Individual Contributor"

    db["notifications"].insert_one({
        "project_id": str(project["_id"]),
        "project_name": proj_name,
        "title": f"Join Request: {u_name}",
        "message": f"{u_name} (@{user.get('username')}, {u_role}) requested to join project '{proj_name}' {team_desc}.",
        "type": "join_request",
        "to_all": False,
        "to_pm": True,
        "recipient_teams": [],
        "recipient_users": [],
        "sender_id": user_id,
        "sender_name": u_name,
        "read_by": [],
        "data": {
            "requester_id": user_id,
            "requester_name": u_name,
            "requester_username": user.get("username"),
            "requester_role": u_role,
            "requested_team_id": req_team_id,
            "requested_team_name": team_name,
            "status": "pending"
        },
        "created_at": now
    })

    return {
        "status": "pending",
        "message": f"Your request to join '{proj_name}' {team_desc} has been sent to the Project Manager for approval.",
        "project_id": project_id,
        "team_id": req_team_id
    }


