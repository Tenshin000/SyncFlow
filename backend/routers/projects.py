"""
SyncFlow - Projects API Router (`/syncflow/projects`).
Handles Project Creation, Selection, PM Workspaces, and Plan Schedule Management updates.
"""
import copy
import math
import threading
import uuid
from collections import OrderedDict
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query, Body

from backend.database.connection import get_db
from backend.models.project import (
    CreateProjectRequest,
    UpdateProjectDescriptionRequest,
    UpdateProjectPersonnelRequest,
    UpdateProjectActivitiesRequest,
    UpdateProjectDeliverablesRequest,
    UpdateProjectWbsRequest,
    UpdateProjectDependenciesRequest,
    UpdateScheduleSettingsRequest,
    ActivityStatusUpdateRequest,
    DependencyModel,
    ProjectSummary,
    ProjectDetail,
    JoinProjectRequest,
    CalendarSettingsModel,
    CreateBaselineRequest,
    TimeLogEntry,
    StartTimerRequest,
    StopTimerRequest,
    UpdateTimeLogRequest
)
from backend.utility import (
    to_object_id,
    build_id_query,
    parse_date,
    format_date,
    is_working_day,
    add_working_days,
    get_nearest_business_day,
    clean_mongo_doc,
    calculate_pert_statistics,
)

router = APIRouter(prefix="/syncflow/projects", tags=["Projects Management"])


def _projects_col():
    """Returns the MongoDB 'projects' collection instance."""
    return get_db()["projects"]


def _get_project_doc(project_id: str, col=None) -> Dict[str, Any]:
    """Retrieves a project document by its ID or raises a 404 HTTPException if not found."""
    c = col if col is not None else _projects_col()
    doc = c.find_one(build_id_query(project_id))
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")
    return doc



# ------------------------------------------------------------------------------
# HIGH-PERFORMANCE IN-MEMORY CPM & CONTROL SCHEDULE CACHE
# ------------------------------------------------------------------------------
_CACHE_LOCK = threading.Lock()
_COMPREHENSIVE_SCHEDULE_CACHE = OrderedDict()
_CONTROL_SCHEDULE_CACHE = OrderedDict()
_MAX_CACHE_ENTRIES = 64


def _get_schedule_cache_key(project_doc: Dict[str, Any], **extra_params) -> str:
    """Generates an in-memory cache key based on project ID, updated_at timestamp, and calculation parameters."""
    pid = str(project_doc.get("_id", ""))
    upd = str(project_doc.get("updated_at", ""))
    extras = tuple(sorted((k, str(v)) for k, v in extra_params.items()))
    return f"{pid}:{upd}:{extras}"


def invalidate_project_schedule_cache(project_id: str):
    """Evicts all cached schedule variants for a specific project."""
    with _CACHE_LOCK:
        pid_prefix = f"{project_id}:"
        for k in list(_COMPREHENSIVE_SCHEDULE_CACHE.keys()):
            if k.startswith(pid_prefix):
                _COMPREHENSIVE_SCHEDULE_CACHE.pop(k, None)
        for k in list(_CONTROL_SCHEDULE_CACHE.keys()):
            if k.startswith(pid_prefix):
                _CONTROL_SCHEDULE_CACHE.pop(k, None)


_clean_wbs_item = clean_mongo_doc
_is_working_day = is_working_day
_add_working_days = add_working_days
_get_nearest_business_day = get_nearest_business_day



def _get_act_duration(act: Dict[str, Any]) -> float:
    """Returns activity duration in days, safely handling zero-duration milestones."""
    if act.get("is_milestone"):
        return 0.0
    val = act.get("duration")
    if val is not None:
        try:
            return max(0.0, float(val))
        except (ValueError, TypeError):
            pass
    val = act.get("expected_time")
    if val is not None:
        try:
            return max(0.0, float(val))
        except (ValueError, TypeError):
            pass
    return 5.0


# Efficient summary projection to avoid transferring large nested WBS trees and activities
SUMMARY_PROJECTION = {
    "name": 1,
    "description": 1,
    "start_date": 1,
    "created_by": 1,
    "teams": 1,
    "assigned_user_ids": 1,
    "controllers": 1,
    "open_participation": 1,
    "allow_multiteam": 1,
    "status": 1,
    "created_at": 1,
    "updated_at": 1,
    "activities.activity_id": 1,
    "deliverables.deliverable_id": 1,
    "wbs.id": 1,
    "dependencies.from_activity": 1
}


_fmt_dt = format_date



def _format_summary(doc: Dict[str, Any]) -> ProjectSummary:
    """Formats a MongoDB project document into a lightweight ProjectSummary model for dashboard listing."""
    teams, m_set = doc.get("teams", []), set(str(u) for u in doc.get("assigned_user_ids", []))
    for t in teams: m_set.update(str(m) for m in t.get("member_ids", []))
    return ProjectSummary(
        id=str(doc.get("_id", "")), name=doc.get("name", "Untitled Project"), description=doc.get("description", ""),
        start_date=_fmt_dt(doc.get("start_date")) or None, created_by=str(doc.get("created_by") or ""),
        teams_count=len(teams), members_count=len(m_set), controllers_count=len(doc.get("controllers", [])),
        activities_count=len(doc.get("activities", [])), deliverables_count=len(doc.get("deliverables", [])),
        wbs_nodes_count=len(doc.get("wbs", [])), dependencies_count=len(doc.get("dependencies", [])),
        open_participation=bool(doc.get("open_participation", False)), allow_multiteam=bool(doc.get("allow_multiteam", False)),
        status=str(doc.get("status") or "in_progress"), created_at=_fmt_dt(doc.get("created_at")), updated_at=_fmt_dt(doc.get("updated_at"))
    )


def _format_detail(doc: Dict[str, Any]) -> ProjectDetail:
    """Formats a full MongoDB project document into the comprehensive ProjectDetail model."""
    teams = [{"team_id": str(t.get("team_id") or ""), "name": t.get("name", ""), "member_ids": [str(m) for m in t.get("member_ids", [])], "lead_id": str(t.get("lead_id")) if t.get("lead_id") else None} for t in doc.get("teams", [])]
    return ProjectDetail(
        id=str(doc.get("_id", "")), name=doc.get("name", ""), description=doc.get("description", ""),
        start_date=_fmt_dt(doc.get("start_date")) or None, created_by=str(doc.get("created_by") or ""),
        assigned_user_ids=[str(u) for u in doc.get("assigned_user_ids", [])], teams=teams,
        controllers=[str(c) for c in doc.get("controllers", [])], open_participation=bool(doc.get("open_participation", False)),
        allow_multiteam=bool(doc.get("allow_multiteam", False)), wbs=[_clean_wbs_item(n) for n in doc.get("wbs", [])],
        deliverables=[_clean_wbs_item(d) for d in doc.get("deliverables", [])], activities=[_clean_wbs_item(a) for a in doc.get("activities", [])],
        dependencies=doc.get("dependencies", []), schedule_settings=doc.get("schedule_settings"),
        status=str(doc.get("status") or "in_progress"), created_at=_fmt_dt(doc.get("created_at"), "%Y-%m-%d %H:%M"), updated_at=_fmt_dt(doc.get("updated_at"), "%Y-%m-%d %H:%M")
    )


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
    for idx, t in enumerate(payload.teams):
        team_id = t.team_id or f"TEAM-{idx+1}"
        lead_id = str(t.lead_id) if t.lead_id else None
        team_entry = {
            "team_id": team_id,
            "name": t.name.strip(),
            "member_ids": [str(m) for m in t.member_ids],
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
        results.append(s_sum)

    return results


@router.post("/{project_id}/join")
def join_project(project_id: str, payload: JoinProjectRequest):
    """
    Handles a user's request to join a project.
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

    # Open Participation: join immediately, no PM notification
    if project.get("open_participation", False):
        col.update_one(
            q,
            {
                "$addToSet": {"assigned_user_ids": user_id},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )
        return {
            "status": "joined",
            "message": f"Successfully joined '{project.get('name')}'. You can now access your project tasks.",
            "project_id": project_id
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

    db["notifications"].insert_one({
        "project_id": str(project["_id"]),
        "project_name": proj_name,
        "title": f"Join Request: {u_name}",
        "message": f"{u_name} (@{user.get('username')}, {u_role}) requested to join project '{proj_name}'.",
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
            "status": "pending"
        },
        "created_at": now
    })

    return {
        "status": "pending",
        "message": f"Your request to join '{proj_name}' has been sent to the Project Manager for approval.",
        "project_id": project_id
    }


def _parse_date_or_none(val: Any) -> Optional[datetime]:
    """Parses a date representation into a datetime at midnight, or returns None if invalid."""
    d = parse_date(val)
    return datetime.combine(d, datetime.min.time()) if d else None


def _process_activities_payload(raw_activities: list) -> list:
    """
    Validates, normalizes, and computes durations and statistical parameters for an activity list.
    Supports Three-Point (Beta), Parametric, Analogous, and Single-Point estimation techniques,
    while preserving existing execution state and logged time trackers.
    """
    processed = []
    for a_idx, act in enumerate(raw_activities):
        act_id = str(act.get("activity_id") or f"ACT-{a_idx + 1}").strip()
        wp_id = str(act.get("work_package_id") or "").strip() or None
        name, desc = str(act.get("name") or f"Activity {a_idx + 1}").strip(), str(act.get("description") or "").strip() or None
        assigned_teams = [str(t).strip() for t in act.get("assigned_teams", []) if str(t).strip()]
        assigned_users = [str(u).strip() for u in act.get("assigned_users", []) if str(u).strip()]
        controller_id = str(act.get("controller_id") or "").strip() or None
        tech = str(act.get("estimation_technique") or "three_point").strip().lower()
        if tech not in ("three_point", "parametric", "analogous", "single_point"): tech = "three_point"

        def _flt(k, default=0.0):
            """Safely extracts a float value from the activity dictionary, returning a default on error or None."""
            try: return float(act.get(k)) if act.get(k) is not None else default
            except (ValueError, TypeError): return default

        a, m, b = _flt("optimistic", 3.0), _flt("most_likely", 5.0), _flt("pessimistic", 9.0)
        p_rate, p_qty = (_flt("parametric_rate", None) if act.get("parametric_rate") is not None else None), (_flt("parametric_quantity", None) if act.get("parametric_quantity") is not None else None)
        ana_actual_dur = _flt("analogous_actual_duration", None) if act.get("analogous_actual_duration") is not None else None
        is_milestone = bool(act.get("is_milestone"))

        if is_milestone:
            te = sigma = var = 0.0
        elif tech == "three_point":
            if a <= 0:
                a = 0.5
            if m <= a:
                m = round(a + max(1.0, round(a * 0.3, 1)), 1)
            if b <= m:
                b = round(m + max(1.5, round(m * 0.4, 1)), 1)
            te, sigma, var = calculate_pert_statistics(a, m, b)

        elif tech == "parametric":
            rate, qty = (p_rate if p_rate is not None else 0.8), (p_qty if p_qty is not None else m)
            te, sigma = round(rate * qty, 2), round(rate * qty * 0.1, 3)
            var = round(sigma ** 2, 4)
        elif tech == "analogous":
            dur_val = ana_actual_dur if ana_actual_dur is not None else _flt("duration", m)
            te, sigma = round(dur_val, 2), round(dur_val * 0.15, 3)
            var = round(sigma ** 2, 4)
        else:
            te, sigma, var = round(m, 2), 0.0, 0.0

        st = str(act.get("status") or "not_started").strip().lower()
        if st not in ["not_started", "in_progress", "completed", "verified"]: st = "not_started"

        processed.append({
            "activity_id": act_id, "work_package_id": wp_id, "name": name, "description": desc,
            "assigned_teams": assigned_teams, "assigned_users": assigned_users, "controller_id": controller_id,
            "is_milestone": is_milestone, "estimation_technique": tech,
            "optimistic": a if not is_milestone else 0.0, "most_likely": m if not is_milestone else 0.0, "pessimistic": b if not is_milestone else 0.0,
            "duration": te, "expected_time": te, "std_dev": sigma, "variance": var,
            "parametric_rate": p_rate, "parametric_quantity": p_qty,
            "analogous_project_id": str(act.get("analogous_project_id") or "").strip() or None,
            "analogous_project_name": str(act.get("analogous_project_name") or "").strip() or None,
            "analogous_activity_id": str(act.get("analogous_activity_id") or "").strip() or None,
            "analogous_activity_name": str(act.get("analogous_activity_name") or "").strip() or None,
            "analogous_actual_duration": ana_actual_dur,
            "analogous_controller_name": str(act.get("analogous_controller_name") or "").strip() or None,
            "analogous_approval_date": str(act.get("analogous_approval_date") or "").strip() or None,
            "analogous_source": str(act.get("analogous_source") or "").strip() or None,
            "estimation_notes": str(act.get("estimation_notes") or "").strip() or None,
            "status": st, "progress_pct": float(act.get("progress_pct") or 0.0),
            "actual_start_date": act.get("actual_start_date"), "actual_finish_date": act.get("actual_finish_date"),
            "verified_by": act.get("verified_by"), "verified_date": act.get("verified_date"),
            "completion_proof": act.get("completion_proof"), "verification_checklist": act.get("verification_checklist", []),
            "notes": act.get("notes") or "",
            "time_logs": act.get("time_logs", []),
            "active_timers": act.get("active_timers", []),
            "total_logged_seconds": int(act.get("total_logged_seconds", 0))
        })
    return processed


def _process_wbs_node(raw_node: Dict[str, Any], prefix: str, level: int) -> Dict[str, Any]:
    """Recursively processes and assigns canonical WBS codes and structural types to a tree node."""
    node_name = str(raw_node.get("name") or f"Element {prefix}").strip()
    node_desc = str(raw_node.get("description") or "").strip() or None
    raw_children = raw_node.get("children", [])
    
    # Level 2 is always Major Deliverable
    # Leaves (no children) are Work Packages
    # Intermediate nodes with children are Sub-deliverables
    raw_type = raw_node.get("type")
    if level == 2:
        node_type = "major_deliverable"
    elif raw_children:
        node_type = "sub_deliverable"
    elif raw_type == "sub_deliverable":
        node_type = "sub_deliverable"
    else:
        node_type = "work_package"

    node_id = str(raw_node.get("id") or "").strip()
    if not node_id:
        if node_type == "major_deliverable":
            node_id = f"DEL-{prefix}"
        elif node_type == "work_package":
            node_id = f"WP-{prefix}"
        else:
            node_id = f"SUB-{prefix}"

    children_processed = []
    if node_type != "work_package":
        for c_idx, child in enumerate(raw_children):
            child_prefix = f"{prefix}.{c_idx + 1}"
            children_processed.append(_process_wbs_node(child, child_prefix, level + 1))

    return {
        "id": node_id,
        "wbs_number": prefix,
        "name": node_name,
        "description": node_desc,
        "type": node_type,
        "children": children_processed
    }


def _process_wbs_payload(raw_wbs: list) -> list:
    """Processes an incoming raw WBS hierarchy array into standardized tree nodes."""
    processed = []
    for idx, node in enumerate(raw_wbs):
        prefix = str(idx + 1)
        processed.append(_process_wbs_node(node, prefix, level=2))
    return processed

@router.put("/{project_id}/wbs", response_model=ProjectDetail)
def update_project_wbs(project_id: str, payload: UpdateProjectWbsRequest):
    """Updates the canonical recursive Work Breakdown Structure (Deliverables -> Sub-deliverables -> Work Packages)."""
    col = _projects_col()
    query = build_id_query(project_id)
    processed = _process_wbs_payload(payload.wbs)
    updated = col.find_one_and_update(
        query,
        {"$set": {"wbs": processed, "updated_at": datetime.utcnow()}},
        return_document=True
    )
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")
    invalidate_project_schedule_cache(str(updated["_id"]))
    return _format_detail(updated)


@router.put("/{project_id}/deliverables", response_model=ProjectDetail)
def update_project_deliverables(project_id: str, payload: UpdateProjectDeliverablesRequest):
    """Compatibility endpoint mapping deliverables to canonical wbs."""
    return update_project_wbs(project_id, UpdateProjectWbsRequest(wbs=payload.deliverables))



@router.put("/{project_id}/activities", response_model=ProjectDetail)
def update_project_activities(project_id: str, payload: UpdateProjectActivitiesRequest):
    """
    Updates the Work Breakdown Structure activities, tasks, and operations with start and end dates.
    """
    col = _projects_col()
    query = build_id_query(project_id)


    processed = _process_activities_payload(payload.activities)
    updated = col.find_one_and_update(
        query,
        {
            "$set": {
                "activities": processed,
                "updated_at": datetime.utcnow()
            }
        },
        return_document=True
    )
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")
    invalidate_project_schedule_cache(str(updated["_id"]))
    return _format_detail(updated)


@router.delete("/{project_id}", status_code=200)
def delete_project(project_id: str):
    """
    Deletes a project document from the database by ID.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)
    result = col.delete_one({"_id": project["_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")
    return {"message": "Project deleted successfully.", "project_id": project_id}


def _detect_schedule_cycles(nodes: List[str], edges: List[Dict[str, Any]]) -> Optional[List[str]]:
    """
    Detects circular loops in the directed precedence network diagram using DFS.
    Returns the ordered path of the cycle (e.g. ['ACT-1', 'ACT-2', 'ACT-1']) if found, or None.
    """
    adj = {node: [] for node in nodes}
    for e in edges:
        u = str(e.get("from_activity_id") or e.get("from") or "").strip()
        v = str(e.get("to_activity_id") or e.get("to") or "").strip()
        if u and v and u in adj:
            adj[u].append(v)

    visited = {node: 0 for node in nodes}  # 0: unvisited, 1: visiting (recursion stack), 2: fully visited
    cycle_path = []

    def dfs(u: str, path: List[str]) -> bool:
        """Recursive helper that performs depth-first traversal to identify back-edges indicating cycles."""
        visited[u] = 1
        path.append(u)
        for v in adj.get(u, []):
            if visited.get(v) == 1:
                # Cycle found!
                idx = path.index(v)
                cycle_path.extend(path[idx:] + [v])
                return True
            elif visited.get(v) == 0:
                if dfs(v, path):
                    return True
        path.pop()
        visited[u] = 2
        return False

    for node in nodes:
        if visited.get(node) == 0:
            if dfs(node, []):
                return cycle_path
    return None


def _evaluate_schedule_health(activities: List[Dict[str, Any]], dependencies: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Evaluates project schedule health against PMBOK and critical path standards:
    - Dangling activities: Open Starts (no FS/SS predecessor) & Open Finishes (no FS/FF successor)
    - Strict logic types: FS, SS, FF, SF only
    - Non-negative lags (strictly >= 0)
    - Avoid Start-to-Finish (SF) bad practices
    - Excessive lags (> 2 days warning)
    - Excessive logic density (> 4 links per activity)
    - Redundant parallel links
    - Cycle detection
    """
    act_ids = [str(a.get("activity_id") or "") for a in activities if a.get("activity_id")]
    act_id_set = set(act_ids)

    has_start_anchor = set()
    has_finish_driver = set()
    logic_density = {aid: 0 for aid in act_ids}
    pair_seen = set()
    redundant_links = []
    sf_links = []
    excessive_lags = []
    invalid_links = []

    for dep in dependencies:
        from_id = str(dep.get("from_activity_id") or dep.get("from") or "").strip()
        to_id = str(dep.get("to_activity_id") or dep.get("to") or "").strip()
        raw_type = str(dep.get("type") or "FS").strip().upper()
        if "(" in raw_type and ")" in raw_type:
            raw_type = raw_type.split("(")[1].replace(")", "").strip()

        lag = float(dep.get("lag_days", 0) or 0)

        if from_id not in act_id_set or to_id not in act_id_set:
            invalid_links.append(f"Dependency links unknown activity: '{from_id}' -> '{to_id}'")
            continue

        pair_key = (from_id, to_id)
        if pair_key in pair_seen:
            redundant_links.append(f"Redundant link between '{from_id}' and '{to_id}'")
        else:
            pair_seen.add(pair_key)

        logic_density[from_id] = logic_density.get(from_id, 0) + 1
        logic_density[to_id] = logic_density.get(to_id, 0) + 1

        # Start anchor: incoming FS or SS
        if raw_type in ("FS", "SS"):
            has_start_anchor.add(to_id)

        # Finish driver: outgoing FS or FF
        if raw_type in ("FS", "FF"):
            has_finish_driver.add(from_id)

        # SF relationship tracking
        if raw_type == "SF":
            sf_links.append({
                "from": from_id,
                "to": to_id,
                "info": "Start-to-Finish (SF) logical relationship."
            })

        # Excessive lag (> 2 days)
        if lag > 2.0:
            excessive_lags.append({
                "from": from_id,
                "to": to_id,
                "lag_days": lag,
                "warning": f"Lag of {lag:g} days exceeds 2-day threshold. May indicate hidden duration or unmodeled work."
            })

    total_acts = len(act_ids)
    # Legitimate project boundary milestones (first activity starts project, last activity finishes project)
    project_start_id = act_ids[0] if total_acts > 0 else None
    project_end_id = act_ids[-1] if total_acts > 0 else None

    unanchored_starts = [aid for aid in act_ids if aid not in has_start_anchor] if total_acts > 1 else []
    unanchored_finishes = [aid for aid in act_ids if aid not in has_finish_driver] if total_acts > 1 else []

    # True dangling activities are intermediate unlinked nodes beyond project start and end
    dangling_starts = [aid for aid in unanchored_starts if aid != project_start_id]
    dangling_finishes = [aid for aid in unanchored_finishes if aid != project_end_id]
    excessive_density = [{"activity_id": aid, "count": cnt} for aid, cnt in logic_density.items() if cnt > 4]

    cycle_path = _detect_schedule_cycles(act_ids, dependencies)

    # Calculate overall health score (0 - 100)
    score = 100
    deductions = []

    if cycle_path:
        score = 0
        deductions.append("Critical circular logic detected (-100 pts)")
    else:
        # Deduct only for genuine dangling intermediate activities
        if len(dangling_starts) > 0:
            start_deduction = min(len(dangling_starts) * 10, 30)
            score -= start_deduction
            deductions.append(f"{len(dangling_starts)} unlinked start(s) (-{start_deduction} pts)")

        if len(dangling_finishes) > 0:
            finish_deduction = min(len(dangling_finishes) * 10, 30)
            score -= finish_deduction
            deductions.append(f"{len(dangling_finishes)} unlinked finish(es) (-{finish_deduction} pts)")

        if len(sf_links) > 0:
            sf_deduction = min(len(sf_links) * 5, 15)
            score -= sf_deduction
            deductions.append(f"{len(sf_links)} SF link(s) (-{sf_deduction} pts)")

        if len(excessive_lags) > 0:
            lag_deduction = min(len(excessive_lags) * 3, 15)
            score -= lag_deduction
            deductions.append(f"{len(excessive_lags)} high lag link(s) (-{lag_deduction} pts)")

        if len(excessive_density) > 0:
            density_deduction = min(len(excessive_density) * 2, 10)
            score -= density_deduction
            deductions.append(f"{len(excessive_density)} high density node(s) (-{density_deduction} pts)")

    score = max(0, min(100, score))

    return {
        "score": score,
        "is_healthy": score >= 80 and not cycle_path and len(dangling_starts) == 0 and len(dangling_finishes) == 0,
        "total_activities": total_acts,
        "total_dependencies": len(dependencies),
        "project_start": project_start_id,
        "project_end": project_end_id,
        "open_starts": dangling_starts,
        "open_finishes": dangling_finishes,
        "sf_links": sf_links,
        "excessive_lags": excessive_lags,
        "excessive_density": excessive_density,
        "redundant_links": redundant_links,
        "invalid_links": invalid_links,
        "cycle_path": cycle_path,
        "deductions": deductions
    }


@router.get("/{project_id}/schedule-health")
def get_project_schedule_health(project_id: str):
    """
    Evaluates and returns schedule network health diagnostics for the given project.
    """
    current = _get_project_doc(project_id)
    return _evaluate_schedule_health(current.get("activities", []), current.get("dependencies", []))


@router.put("/{project_id}/dependencies", response_model=ProjectDetail)
def update_project_dependencies(project_id: str, payload: UpdateProjectDependenciesRequest):
    """
    Updates the project precedence dependencies with full Schedule Health validation:
    - Rejects negative lags (strictly >= 0)
    - Rejects self-dependencies (from == to)
    - Rejects unknown activities
    - Rejects invalid relationship types (only FS, SS, FF, SF allowed)
    - Strictly blocks circular dependency loops
    """
    col = _projects_col()
    query = build_id_query(project_id)

    current = col.find_one(query, {"activities.activity_id": 1})
    if not current:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")

    activities = current.get("activities", [])
    valid_act_ids = {str(a.get("activity_id")) for a in activities if a.get("activity_id")}

    processed_deps = []
    edges_for_cycle = []

    for idx, dep in enumerate(payload.dependencies):
        from_id = dep.from_activity_id.strip()
        to_id = dep.to_activity_id.strip()

        # Rule 1: No self-dependency
        if from_id == to_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Invalid dependency: Activity '{from_id}' cannot precede itself."
            )

        # Rule 2: References must exist
        if from_id not in valid_act_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Predecessor activity '{from_id}' does not exist in this project."
            )
        if to_id not in valid_act_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Successor activity '{to_id}' does not exist in this project."
            )

        # Rule 3: Valid relationship type
        raw_type = dep.type.strip().upper()
        if "(" in raw_type and ")" in raw_type:
            raw_type = raw_type.split("(")[1].replace(")", "").strip()
        if raw_type not in ("FS", "SS", "FF", "SF"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Invalid relationship type '{dep.type}'. Only FS, SS, FF, and SF are permitted."
            )

        # Rule 4: Non-negative lag
        if dep.lag_days < 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Negative lag ({dep.lag_days}) is strictly prohibited. Lead time via negative lag is invalid logic."
            )

        dep_id = dep.dependency_id or f"DEP-{idx+1:03d}"
        processed_deps.append({
            "dependency_id": dep_id,
            "from_activity_id": from_id,
            "to_activity_id": to_id,
            "type": raw_type,
            "lag_days": float(dep.lag_days),
            "description": dep.description.strip() if dep.description else ""
        })
        edges_for_cycle.append({"from": from_id, "to": to_id})

    # Rule 5: Circular loop check
    act_list = list(valid_act_ids)
    cycle = _detect_schedule_cycles(act_list, edges_for_cycle)
    if cycle:
        cycle_str = " ➔ ".join(cycle)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Circular dependency detected: {cycle_str}. Circular logic loops are strictly forbidden in schedule precedence networks."
        )

    updated = col.find_one_and_update(
        query,
        {
            "$set": {
                "dependencies": processed_deps,
                "updated_at": datetime.utcnow()
            }
        },
        return_document=True
    )
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project '{project_id}' not found.")
    invalidate_project_schedule_cache(str(updated["_id"]))
    return _format_detail(updated)


_parse_date = parse_date



def _calculate_comprehensive_schedule(
    activities: list,
    dependencies: list,
    start_date_val: Any = None,
    imposed_deadline_date_val: Any = None,
    imposed_deadline_days_val: Optional[float] = None,
    near_critical_threshold: float = 25.0,
    calendar_settings: Optional[Dict[str, Any]] = None
):
    """
    Core Critical Path Method (CPM) and PERT Schedule Network Engine.
    Computes:
      1. Forward Pass (ES, EF) -> EF = ES + Duration
      2. Backward Pass (LF, LS) -> LS = LF - Duration
      3. Total Float (TF) = LF - EF = LS - ES
      4. Free Float (FF) = min_succ (allowed slack without delaying successor ES)
      5. Project Float = Imposed Deadline - Planned Finish Date
      6. Critical Path identification (TF <= 0.05)
      7. Near-Critical Paths identification (0 < TF <= near_critical_threshold)
      8. Activity-on-Node (AON) Network Model with CPM block attributes
      9. Activity-on-Arrow (AOA) PERT Event Network Model with Earliest (TE), Latest (TL), Slack, and Dummies
    """
    act_map = {a.get("activity_id"): a for a in activities if a.get("activity_id")}
    act_ids = list(act_map.keys())

    start_date = _parse_date(start_date_val) or date.today()

    if not act_ids:
        return {
            "summary": {
                "total_activities": 0,
                "critical_activities_count": 0,
                "near_critical_count": 0,
                "flexible_count": 0,
                "planned_start_date": start_date.strftime("%Y-%m-%d"),
                "planned_finish_date": start_date.strftime("%Y-%m-%d"),
                "planned_duration_days": 0.0,
                "project_float_days": 0.0,
                "project_float_status": "zero",
                "imposed_deadline_date": None,
                "imposed_deadline_days": 0.0,
                "near_critical_threshold_days": near_critical_threshold
            },
            "critical_path_ids": [],
            "near_critical_ids": [],
            "expected_duration_mu": 0.0,
            "variance_path": 0.0,
            "std_dev_path": 0.0,
            "confidence_levels": {"50": 0.0, "80": 0.0, "90": 0.0, "95": 0.0, "99": 0.0},
            "schedule": {},
            "activities_schedule": [],
            "aon_graph": {"nodes": [], "edges": []},
            "aoa_graph": {"events": [], "edges": []}
        }

    preds = {id_: [] for id_ in act_ids}
    succs = {id_: [] for id_ in act_ids}

    for dep in dependencies:
        u = (dep.get("from_activity_id") or dep.get("from") or "").strip()
        v = (dep.get("to_activity_id") or dep.get("to") or "").strip()
        raw_type = (dep.get("type") or "FS").strip().upper()
        if "(" in raw_type and ")" in raw_type:
            raw_type = raw_type.split("(")[1].replace(")", "").strip()
        lag = float(dep.get("lag_days") or 0.0)

        if u in act_map and v in act_map and u != v:
            succs[u].append({"to": v, "type": raw_type, "lag": lag})
            preds[v].append({"from": u, "type": raw_type, "lag": lag})

    # Forward pass: topological sort using Kahn's algorithm
    in_degree = {id_: len(preds[id_]) for id_ in act_ids}
    queue = [id_ for id_ in act_ids if in_degree[id_] == 0]
    top_order = []

    while queue:
        curr = queue.pop(0)
        top_order.append(curr)
        for edge in succs[curr]:
            nxt = edge["to"]
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    for id_ in act_ids:
        if id_ not in top_order:
            top_order.append(id_)

    # 1. Forward Pass: calculate Early Start (ES) and Early Finish (EF)
    es = {id_: 0.0 for id_ in act_ids}
    ef = {id_: 0.0 for id_ in act_ids}

    for u in top_order:
        d_u = _get_act_duration(act_map[u])
        max_es = 0.0
        for edge in preds[u]:
            p = edge["from"]
            rel = edge["type"]
            lag = edge["lag"]
            # Forward pass: calculate candidate Early Start based on relationship type and lag:
            # FS: ES_succ >= EF_pred + lag
            # SS: ES_succ >= ES_pred + lag
            # FF: EF_succ >= EF_pred + lag -> ES_succ >= EF_pred + lag - d_u
            # SF: EF_succ >= ES_pred + lag -> ES_succ >= ES_pred + lag - d_u
            if rel == "FS":
                candidate = ef[p] + lag
            elif rel == "SS":
                candidate = es[p] + lag
            elif rel == "FF":
                candidate = ef[p] + lag - d_u
            elif rel == "SF":
                candidate = es[p] + lag - d_u
            else:
                candidate = ef[p] + lag
            max_es = max(max_es, candidate)

        es[u] = max(0.0, max_es)
        ef[u] = es[u] + d_u

    project_finish = max(ef.values()) if ef else 0.0

    # 2. Backward Pass: calculate Late Finish (LF) and Late Start (LS)
    lf = {id_: project_finish for id_ in act_ids}
    ls = {id_: 0.0 for id_ in act_ids}

    rev_order = list(reversed(top_order))
    for u in rev_order:
        d_u = _get_act_duration(act_map[u])
        if succs[u]:
            min_lf = float("inf")
            for edge in succs[u]:
                s = edge["to"]
                rel = edge["type"]
                lag = edge["lag"]
                # Backward pass: calculate candidate Late Finish by inverting predecessor constraints:
                # FS: LF_pred <= LS_succ - lag
                # SS: LS_pred <= LS_succ - lag -> LF_pred <= LS_succ - lag + d_u
                # FF: LF_pred <= LF_succ - lag
                # SF: LS_pred <= LF_succ - lag -> LF_pred <= LF_succ - lag + d_u
                if rel == "FS":
                    candidate = ls[s] - lag
                elif rel == "SS":
                    candidate = ls[s] - lag + d_u
                elif rel == "FF":
                    candidate = lf[s] - lag
                elif rel == "SF":
                    candidate = lf[s] - lag + d_u
                else:
                    candidate = ls[s] - lag
                min_lf = min(min_lf, candidate)
            lf[u] = min(project_finish, min_lf)
        else:
            lf[u] = project_finish
        ls[u] = lf[u] - d_u

    # 3. Calculate Total Float (TF) = LF - EF = LS - ES
    tf = {id_: round(lf[id_] - ef[id_], 2) for id_ in act_ids}
    min_float = min(tf.values()) if tf else 0.0
    critical_ids = [id_ for id_ in act_ids if abs(tf[id_] - min_float) <= 0.05]

    # 4. Calculate Free Float (FF)
    # The maximum amount of time an activity can be delayed without affecting the ES of any successor.
    ff = {}
    for u in act_ids:
        tf_u = tf[u]
        d_u = _get_act_duration(act_map[u])
        if not succs[u]:
            ff[u] = tf_u
        else:
            min_slack = float("inf")
            for edge in succs[u]:
                s = edge["to"]
                rel = edge["type"]
                lag = edge["lag"]
                if rel == "FS":
                    slack = (es[s] - lag) - ef[u]
                elif rel == "SS":
                    slack = (es[s] - lag) - es[u]
                elif rel == "FF":
                    slack = (ef[s] - lag) - ef[u]
                elif rel == "SF":
                    slack = (ef[s] - lag) - es[u]
                else:
                    slack = (es[s] - lag) - ef[u]
                min_slack = min(min_slack, slack)
            ff[u] = round(max(0.0, min(min_slack, tf_u)), 2)

    # 5. Near-Critical Paths (0 < TF <= threshold)
    near_critical_ids = [
        id_ for id_ in act_ids
        if id_ not in critical_ids and 0.05 < tf[id_] <= near_critical_threshold
    ]

    # 6. Critical Path Statistical PERT Metrics
    mu = sum(float(act_map[cid].get("duration") or 5.0) for cid in critical_ids)
    var_path = sum(float(act_map[cid].get("variance") or 0.0) for cid in critical_ids)
    std_path = math.sqrt(var_path) if var_path > 0 else 0.0

    conf_50 = round(mu, 1)
    conf_80 = round(mu + 0.8416 * std_path, 1)
    conf_90 = round(mu + 1.2816 * std_path, 1)
    conf_95 = round(mu + 1.6449 * std_path, 1)
    conf_99 = round(mu + 2.3263 * std_path, 1)

    # 7. Dates and Project Float calculations (Respecting Project Calendar & Holidays)
    cal_working_days = (calendar_settings and calendar_settings.get("working_days")) or [0, 1, 2, 3, 4]
    cal_holidays = (calendar_settings and calendar_settings.get("holidays")) or []

    planned_finish_date = _add_working_days(start_date, project_finish, cal_working_days, cal_holidays)

    # Determine imposed deadline
    imp_date = _parse_date(imposed_deadline_date_val)
    if imp_date:
        imp_days = float((imp_date - start_date).days)
    elif imposed_deadline_days_val is not None and float(imposed_deadline_days_val) > 0:
        imp_days = float(imposed_deadline_days_val)
        imp_date = _add_working_days(start_date, imp_days, cal_working_days, cal_holidays)
    else:
        # Default target buffer: round up to next 50 or P90
        imp_days = round(conf_90 if conf_90 > project_finish else project_finish + 60.0, 1)
        imp_date = _add_working_days(start_date, imp_days, cal_working_days, cal_holidays)

    project_float_days = round(imp_days - project_finish, 2)
    if project_float_days > 0.05:
        pf_status = "positive"
    elif abs(project_float_days) <= 0.05:
        pf_status = "zero"
    else:
        pf_status = "negative"

    # 8. Detailed Schedule Rows for Activities Table and Gantt
    schedule_details, activities_schedule = {}, []
    for id_ in act_ids:
        act = act_map[id_]
        d_val, v_val = _get_act_duration(act), float(act.get("variance") or 0.0)
        is_crit, is_near_crit = id_ in critical_ids, id_ in near_critical_ids
        is_m = bool(act.get("is_milestone") or d_val == 0.0)
        es_d, ef_d, ls_d, lf_d = round(es[id_], 1), round(ef[id_], 1), round(ls[id_], 1), round(lf[id_], 1)
        tf_val, ff_val = tf[id_], ff[id_]
        es_date = _add_working_days(start_date, es_d, cal_working_days, cal_holidays).strftime("%Y-%m-%d")
        ef_date = _add_working_days(start_date, ef_d, cal_working_days, cal_holidays).strftime("%Y-%m-%d")
        ls_date = _add_working_days(start_date, ls_d, cal_working_days, cal_holidays).strftime("%Y-%m-%d")
        lf_date = _add_working_days(start_date, lf_d, cal_working_days, cal_holidays).strftime("%Y-%m-%d")

        row = {
            "activity_id": id_, "name": act.get("name", id_), "description": act.get("description", ""),
            "work_package_id": act.get("work_package_id", ""), "assigned_team": act.get("assigned_team", ""), "assigned_lead": act.get("assigned_lead", ""),
            "duration": d_val, "variance": v_val, "std_dev": round(math.sqrt(v_val), 2) if v_val > 0 else 0.0,
            "es": es_d, "ef": ef_d, "ls": ls_d, "lf": lf_d, "float": tf_val, "total_float": tf_val, "free_float": ff_val,
            "is_critical": is_crit, "is_near_critical": is_near_crit, "is_milestone": is_m,
            "completion_proof": act.get("completion_proof"), "verification_checklist": act.get("verification_checklist", []),
            "status_badge": "Milestone" if is_m else ("Critical" if is_crit else ("Near-Critical" if is_near_crit else "Flexible Buffer")),
            "early_start_date": es_date, "early_finish_date": ef_date, "late_start_date": ls_date, "late_finish_date": lf_date,
            "predecessors": [p["from"] for p in preds[id_]], "successors": [s["to"] for s in succs[id_]]
        }
        schedule_details[id_] = row
        activities_schedule.append(row)

    activities_schedule.sort(key=lambda r: (r["es"], r["activity_id"]))

    aon_nodes = []
    for id_ in act_ids:
        r = schedule_details[id_]
        is_m = bool(r.get("is_milestone") or r["duration"] == 0.0)
        cpm_lbl = f"[{id_}]\n{r['name'][:28]}\nES:{r['es']} | D:{r['duration']} | EF:{r['ef']}\nLS:{r['ls']} | TF:{r['total_float']} | LF:{r['lf']}"
        bg, border, font_c, bw, lbl = (
            ("#EDE9FE", "#7C3AED", "#5B21B6", 2.5, f"◆ [{id_}]\n{r['name'][:28]}\nMilestone (0d)\nDate: {r['early_start_date']}") if is_m else
            (("#FEE2E2", "#DC2626", "#7F1D1D", 3, cpm_lbl) if r["is_critical"] else
            (("#FEF3C7", "#D97706", "#78350F", 2, cpm_lbl) if r["is_near_critical"] else
            ("#F8FAFC", "#94A3B8", "#1E293B", 1.5, cpm_lbl)))
        )
        aon_nodes.append({
            "id": id_, "label": lbl,
            "title": f"<b>{id_}: {r['name']}</b><br>{'◆ Milestone (0 days)' if is_m else f'Duration: {r['duration']} d'}<br>ES: {r['es']} | EF: {r['ef']}<br>LS: {r['ls']} | LF: {r['lf']}<br>Total Float: {r['total_float']} d<br>Free Float: {r['free_float']} d<br>Status: {r['status_badge']}",
            "color": {"background": bg, "border": border, "highlight": {"background": "#FFFFFF", "border": border}},
            "borderWidth": bw, "shape": "diamond" if is_m else "box",
            "font": {"face": "monospace", "size": 11, "color": font_c, "align": "center"},
            "is_critical": r["is_critical"], "is_near_critical": r["is_near_critical"], "is_milestone": is_m,
            "cpm": {"es": r["es"], "ef": r["ef"], "ls": r["ls"], "lf": r["lf"], "d": r["duration"], "tf": r["total_float"], "ff": r["free_float"]}
        })

    aon_edges = []
    for edge_idx, dep in enumerate(dependencies, 1):
        u = (dep.get("from_activity_id") or dep.get("from") or "").strip()
        v = (dep.get("to_activity_id") or dep.get("to") or "").strip()
        raw_type = (dep.get("type") or "FS").strip().upper()
        if "(" in raw_type and ")" in raw_type: raw_type = raw_type.split("(")[1].replace(")", "").strip()
        lag = float(dep.get("lag_days") or 0.0)
        if u in act_map and v in act_map:
            is_edge_crit = schedule_details[u]["is_critical"] and schedule_details[v]["is_critical"] and (abs(schedule_details[v]["es"] - (schedule_details[u]["ef"] + lag)) <= 0.1)
            edge_label = raw_type if lag == 0 else f"{raw_type}+{lag:.0f}d"
            aon_edges.append({
                "id": f"AON-EDGE-{edge_idx}", "from": u, "to": v, "label": edge_label,
                "color": {"color": "#DC2626" if is_edge_crit else "#94A3B8", "highlight": "#DC2626" if is_edge_crit else "#2563EB"},
                "width": 3.0 if is_edge_crit else 1.5, "arrows": "to", "dashes": False, "is_critical": is_edge_crit
            })

    # 10. Activity-on-Arrow (AOA / PERT Network) Graph Model
    aoa_events, evt_counter = {}, 1
    def get_aoa_event(key, label, te_val, tl_val):
        """Creates or returns an AOA event node with Earliest Event Time (TE) and Latest Event Time (TL)."""
        nonlocal evt_counter
        if key not in aoa_events:
            slack_val = round(max(0.0, tl_val - te_val), 2)
            aoa_events[key] = {
                "id": evt_counter, "key": key, "label": f"Event {evt_counter}\nTE: {te_val:.1f}d\nTL: {tl_val:.1f}d",
                "name": label, "te": round(te_val, 1), "tl": round(tl_val, 1), "slack": slack_val, "is_critical": (slack_val <= 0.05),
                "early_date": (start_date + timedelta(days=int(round(te_val)))).strftime("%Y-%m-%d"),
                "late_date": (start_date + timedelta(days=int(round(tl_val)))).strftime("%Y-%m-%d")
            }
            evt_counter += 1
        return aoa_events[key]

    get_aoa_event("EVT_START", "Project Commencement", 0.0, 0.0)
    for id_ in act_ids:
        p_list = preds[id_]
        start_k = "EVT_START" if len(p_list) == 0 else (f"EVT_FIN_{p_list[0]['from']}" if len(p_list) == 1 else f"EVT_JOIN_{id_}")
        get_aoa_event(start_k, f"Ready: {act_map[id_].get('name', id_)}", es[id_], ls[id_])
        get_aoa_event(f"EVT_FIN_{id_}", f"Completed: {act_map[id_].get('name', id_)}", ef[id_], lf[id_])
    get_aoa_event("EVT_FINISH", "Final Project Delivery", project_finish, project_finish)

    def _aoa_arrow(a_id, from_id, to_id, label, title, name, act_id=None, dur=0.0, var=0.0, is_dummy=True, is_crit=False, is_near=False):
        """Builds an AOA arrow connecting two events, supporting both real activities and zero-duration dummy links."""
        c = "#DC2626" if is_crit else ("#D97706" if is_near else ("#94A3B8" if is_dummy else "#3B82F6"))
        w = 3.5 if is_crit else (2.5 if is_near else (2.0 if is_dummy and is_crit else (1.0 if is_dummy else 1.8)))
        return {
            "id": a_id, "from": from_id, "to": to_id, "label": label, "title": title,
            "activity_id": act_id, "name": name, "duration": dur, "variance": var,
            "is_dummy": is_dummy, "is_critical": is_crit, "is_near_critical": is_near,
            "color": {"color": c, "highlight": c}, "dashes": is_dummy, "width": w, "arrows": "to"
        }

    aoa_arrows, aoa_arrow_idx = [], 1
    for id_ in act_ids:
        p_list, fin_k = preds[id_], f"EVT_FIN_{id_}"
        if len(p_list) > 1:
            start_k = f"EVT_JOIN_{id_}"
            for p_edge in p_list:
                p_id = p_edge["from"]
                aoa_arrows.append(_aoa_arrow(
                    f"AOA-DUMMY-{aoa_arrow_idx}", aoa_events[f"EVT_FIN_{p_id}"]["id"], aoa_events[start_k]["id"],
                    "Dummy (0d)", f"<b>Dummy Link</b><br>From: {p_id} Finish<br>To: {id_} Join<br>Duration: 0 d",
                    f"Dummy Precedence ({p_id} → {id_})", is_crit=(schedule_details[p_id]["is_critical"] and schedule_details[id_]["is_critical"])
                ))
                aoa_arrow_idx += 1
        else:
            start_k = f"EVT_FIN_{p_list[0]['from']}" if len(p_list) == 1 else "EVT_START"

        r = schedule_details[id_]
        aoa_arrows.append(_aoa_arrow(
            f"AOA-ACT-{id_}", aoa_events[start_k]["id"], aoa_events[fin_k]["id"],
            f"{id_} (te={r['duration']:.0f}d)",
            f"<b>{id_}: {r['name']}</b><br>Expected Duration (te): {r['duration']} d<br>Variance (σ²): {r['variance']:.2f}<br>Total Float: {r['total_float']} d<br>Status: {r['status_badge']}",
            r["name"], act_id=id_, dur=r["duration"], var=r["variance"], is_dummy=False,
            is_crit=r["is_critical"], is_near=r["is_near_critical"]
        ))
        aoa_arrow_idx += 1

    for id_ in [i for i in act_ids if len(succs[i]) == 0]:
        aoa_arrows.append(_aoa_arrow(
            f"AOA-DUMMY-TERM-{id_}", aoa_events[f"EVT_FIN_{id_}"]["id"], aoa_events["EVT_FINISH"]["id"],
            "Dummy (0d)", f"<b>Dummy Link</b><br>Terminal link from {id_} to Project Finish<br>Duration: 0 d",
            f"Terminal Link ({id_} → Finish)", is_crit=schedule_details[id_]["is_critical"]
        ))
        aoa_arrow_idx += 1

    aoa_nodes_list = [{
        "id": ev["id"], "label": ev["label"],
        "title": f"<b>{ev['name']}</b><br>TE (Earliest): {ev['te']} d ({ev['early_date']})<br>TL (Latest): {ev['tl']} d ({ev['late_date']})<br>Slack: {ev['slack']} d<br>Critical Event: {'Yes' if ev['is_critical'] else 'No'}",
        "color": {"background": "#FEF2F2" if ev["is_critical"] else "#EFF6FF", "border": "#DC2626" if ev["is_critical"] else "#2563EB", "highlight": {"background": "#FFFFFF", "border": "#DC2626" if ev["is_critical"] else "#2563EB"}},
        "borderWidth": 2.5 if ev["is_critical"] else 1.5, "shape": "circle",
        "font": {"face": "monospace", "size": 10, "color": "#0F172A", "align": "center"},
        "is_critical": ev["is_critical"], "te": ev["te"], "tl": ev["tl"], "slack": ev["slack"]
    } for ev in aoa_events.values()]

    summary_data = {
        "total_activities": len(act_ids),
        "critical_activities_count": len(critical_ids),
        "near_critical_count": len(near_critical_ids),
        "flexible_count": len(act_ids) - len(critical_ids) - len(near_critical_ids),
        "critical_ratio_pct": round(len(critical_ids) / len(act_ids) * 100.0, 1) if act_ids else 0.0,
        "planned_start_date": start_date.strftime("%Y-%m-%d"),
        "planned_finish_date": planned_finish_date.strftime("%Y-%m-%d"),
        "planned_duration_days": round(project_finish, 1),
        "imposed_deadline_date": imp_date.strftime("%Y-%m-%d") if imp_date else None,
        "imposed_deadline_days": round(imp_days, 1),
        "project_float_days": project_float_days,
        "project_float_status": pf_status,
        "near_critical_threshold_days": near_critical_threshold,
        "critical_path_mu": round(mu, 1),
        "critical_path_sigma": round(std_path, 2),
        "critical_path_var": round(var_path, 2)
    }

    return {
        "summary": summary_data,
        "critical_path_ids": critical_ids,
        "near_critical_ids": near_critical_ids,
        "expected_duration_mu": round(mu, 2),
        "variance_path": round(var_path, 3),
        "std_dev_path": round(std_path, 2),
        "confidence_levels": {
            "50": conf_50,
            "80": conf_80,
            "90": conf_90,
            "95": conf_95,
            "99": conf_99
        },
        "schedule": schedule_details,
        "activities_schedule": activities_schedule,
        "aon_graph": {
            "nodes": aon_nodes,
            "edges": aon_edges
        },
        "aoa_graph": {
            "events": aoa_nodes_list,
            "edges": aoa_arrows
        }
    }


def get_cached_comprehensive_schedule(
    project_doc: Dict[str, Any],
    imposed_deadline_date_val: Any = None,
    imposed_deadline_days_val: Optional[float] = None,
    near_critical_threshold: float = 25.0,
    calendar_settings: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Retrieves CPM schedule from in-memory cache or computes & caches it atomically."""
    cal_settings = calendar_settings or project_doc.get("calendar_settings")
    key = _get_schedule_cache_key(
        project_doc,
        deadline_date=imposed_deadline_date_val,
        deadline_days=imposed_deadline_days_val,
        threshold=near_critical_threshold,
        cal_name=(cal_settings or {}).get("calendar_name")
    )
    with _CACHE_LOCK:
        if key in _COMPREHENSIVE_SCHEDULE_CACHE:
            _COMPREHENSIVE_SCHEDULE_CACHE.move_to_end(key)
            return copy.deepcopy(_COMPREHENSIVE_SCHEDULE_CACHE[key])

    activities = project_doc.get("activities", [])
    dependencies = project_doc.get("dependencies", [])
    start_date_val = project_doc.get("start_date")

    result = _calculate_comprehensive_schedule(
        activities=activities,
        dependencies=dependencies,
        start_date_val=start_date_val,
        imposed_deadline_date_val=imposed_deadline_date_val,
        imposed_deadline_days_val=imposed_deadline_days_val,
        near_critical_threshold=near_critical_threshold,
        calendar_settings=cal_settings
    )

    with _CACHE_LOCK:
        _COMPREHENSIVE_SCHEDULE_CACHE[key] = result
        if len(_COMPREHENSIVE_SCHEDULE_CACHE) > _MAX_CACHE_ENTRIES:
            _COMPREHENSIVE_SCHEDULE_CACHE.popitem(last=False)

    return copy.deepcopy(result)


def _calculate_pert_critical_path(activities: list, dependencies: list, project_doc: Optional[Dict[str, Any]] = None):
    """Backward compatibility wrapper for existing PERT beta estimation endpoints."""
    if project_doc:
        res = get_cached_comprehensive_schedule(project_doc)
    else:
        res = _calculate_comprehensive_schedule(activities, dependencies)
    return {
        "critical_path_ids": res["critical_path_ids"],
        "expected_duration_mu": res["expected_duration_mu"],
        "variance_path": res["variance_path"],
        "std_dev_path": res["std_dev_path"],
        "confidence_levels": res["confidence_levels"],
        "schedule": res["schedule"]
    }


@router.get("/{project_id}/schedule")
def get_project_schedule(
    project_id: str,
    imposed_deadline_days: Optional[float] = Query(None, description="Optional customer imposed deadline in days"),
    imposed_deadline_date: Optional[str] = Query(None, description="Optional customer imposed deadline date YYYY-MM-DD"),
    near_critical_threshold: Optional[float] = Query(None, description="Float threshold for near-critical tasks")
):
    """
    Develop Schedule Main Endpoint (PMBOK Process 6.5).
    Calculates the full CPM Schedule model, Free and Total Floats, Project Float,
    Activity-on-Node (CPM) and Activity-on-Arrow (PERT) network diagrams,
    and returns complete schedule matrix.
    """
    project = _get_project_doc(project_id)

    settings = project.get("schedule_settings") or {}
    eff_threshold = float(near_critical_threshold) if near_critical_threshold is not None else float(settings.get("near_critical_threshold_days", 25.0))
    if imposed_deadline_days is not None:
        eff_imp_days = imposed_deadline_days
        eff_imp_date = imposed_deadline_date  # None unless explicitly provided
    elif imposed_deadline_date is not None:
        eff_imp_date = imposed_deadline_date
        eff_imp_days = None
    else:
        eff_imp_days = settings.get("imposed_deadline_days")
        eff_imp_date = settings.get("imposed_deadline_date")

    schedule_model = get_cached_comprehensive_schedule(
        project_doc=project,
        imposed_deadline_date_val=eff_imp_date,
        imposed_deadline_days_val=eff_imp_days,
        near_critical_threshold=eff_threshold,
        calendar_settings=project.get("calendar_settings")
    )
    schedule_model["schedule_settings"] = settings
    schedule_model["calendar_settings"] = project.get("calendar_settings") or {
        "working_days": [0, 1, 2, 3, 4],
        "holidays": [],
        "shift_hours_per_day": 8.0,
        "calendar_name": "Standard 5-Day (Mon-Fri)"
    }
    schedule_model["baselines"] = project.get("baselines", [])
    return schedule_model


@router.post("/{project_id}/schedule-settings")
def update_project_schedule_settings(
    project_id: str,
    payload: UpdateScheduleSettingsRequest
):
    """
    Saves baseline schedule settings: externally imposed deadline date/days,
    near-critical threshold, notes, and default diagram mode into MongoDB.
    Merges with existing settings so partial updates preserve previous values.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)
    query = {"_id": project["_id"]}

    existing_settings = project.get("schedule_settings") or {}

    new_settings = {
        "imposed_deadline_date": payload.imposed_deadline_date if payload.imposed_deadline_date is not None else existing_settings.get("imposed_deadline_date"),
        "imposed_deadline_days": payload.imposed_deadline_days if payload.imposed_deadline_days is not None else existing_settings.get("imposed_deadline_days"),
        "near_critical_threshold_days": float(payload.near_critical_threshold_days) if payload.near_critical_threshold_days is not None else float(existing_settings.get("near_critical_threshold_days", 25.0)),
        "diagram_mode": payload.diagram_mode if payload.diagram_mode is not None else existing_settings.get("diagram_mode", "aon"),
        "notes": payload.notes if payload.notes is not None else existing_settings.get("notes", ""),
        "updated_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    }

    updated = col.find_one_and_update(
        query,
        {
            "$set": {
                "schedule_settings": new_settings,
                "updated_at": datetime.utcnow()
            }
        },
        return_document=True
    )
    invalidate_project_schedule_cache(str(updated["_id"]))

    activities = updated.get("activities", [])
    dependencies = updated.get("dependencies", [])
    start_date_val = updated.get("start_date")

    schedule_model = get_cached_comprehensive_schedule(
        project_doc=updated,
        imposed_deadline_date_val=new_settings["imposed_deadline_date"],
        imposed_deadline_days_val=new_settings["imposed_deadline_days"],
        near_critical_threshold=new_settings["near_critical_threshold_days"]
    )
    schedule_model["schedule_settings"] = new_settings
    return schedule_model


@router.get("/{project_id}/pert-analysis")
def get_project_pert_analysis(
    project_id: str,
    target_days: Optional[float] = Query(None, description="Optional target project duration in days")
):
    """
    Returns the PERT Beta Distribution Critical Path analysis,
    expected project duration (mu), path variance, standard deviation,
    confidence milestones, and the completion probability for a target deadline D.
    """
    project = _get_project_doc(project_id)

    activities = project.get("activities", [])
    dependencies = project.get("dependencies", [])

    analysis = _calculate_pert_critical_path(activities, dependencies, project_doc=project)

    if target_days is not None:
        mu = analysis["expected_duration_mu"]
        std = analysis["std_dev_path"]
        if std > 0:
            z = (target_days - mu) / std
            prob = 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
        else:
            z = 0.0
            prob = 1.0 if target_days >= mu else 0.0

        analysis["target_analysis"] = {
            "target_days": target_days,
            "z_value": round(z, 2),
            "probability_percentage": round(prob * 100.0, 1),
            "prob_raw": prob
        }

    return analysis


def _calculate_control_schedule(
    project_doc: Dict[str, Any],
    status_date_str: Optional[str] = None,
    base_schedule: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Control Schedule Model (PMBOK Process 6.6).
    Computes Leading and Lagging KPIs, 4-tier task execution statuses
    (Not Started [White], In-Progress [Yellow], Completed [Green], Verified [Blue]),
    and generates the PMBOK S-Curve with Early, Late, Actual, and Forecast envelopes.
    """
    activities = project_doc.get("activities", [])
    dependencies = project_doc.get("dependencies", [])
    start_date_val = project_doc.get("start_date")
    settings = project_doc.get("schedule_settings") or {}
    eff_threshold = float(settings.get("near_critical_threshold_days", 25.0))
    eff_imp_days = settings.get("imposed_deadline_days")
    eff_imp_date = settings.get("imposed_deadline_date")

    if base_schedule is None:
        base_schedule = get_cached_comprehensive_schedule(
            project_doc=project_doc,
            imposed_deadline_date_val=eff_imp_date,
            imposed_deadline_days_val=eff_imp_days,
            near_critical_threshold=eff_threshold,
            calendar_settings=project_doc.get("calendar_settings")
        )

    sched_map = base_schedule["schedule"]
    summary = base_schedule["summary"]
    total_planned_duration = summary["planned_duration_days"] or 1641.0
    start_date_obj = datetime.strptime(summary["planned_start_date"], "%Y-%m-%d").date()

    if status_date_str:
        try:
            status_d = datetime.strptime(status_date_str, "%Y-%m-%d").date()
        except Exception:
            status_d = date.today()
    else:
        status_d = date.today()

    status_day = max(0.0, float((status_d - start_date_obj).days))

    # Parse and categorize all activities into the 4 PMBOK status states:
    # 1. 'not_started' (White)
    # 2. 'in_progress' (Yellow)
    # 3. 'completed'   (Green)
    # 4. 'verified'    (Blue - Completed AND Verified by Controller)
    activities_control = []
    total_planned_effort = 0.0
    total_earned_effort = 0.0
    total_planned_pv_at_status = 0.0

    counts = {
        "not_started": 0,
        "in_progress": 0,
        "completed": 0,
        "verified": 0
    }

    for act in activities:
        act_id = act.get("activity_id")
        sched = sched_map.get(act_id, {})
        d_val = _get_act_duration(act)
        total_planned_effort += d_val

        raw_status = str(act.get("status") or "not_started").lower().strip()
        if raw_status in ["verified", "completed & verified", "completed and verified", "approved"]:
            norm_status = "verified"
            progress_pct = 100.0
        elif raw_status in ["completed", "finished", "done"]:
            norm_status = "completed"
            progress_pct = 100.0
        elif raw_status in ["in_progress", "work-in-progress", "started", "wip"]:
            norm_status = "in_progress"
            progress_pct = max(1.0, min(99.0, float(act.get("progress_pct") or 50.0)))
        else:
            norm_status = "not_started"
            progress_pct = 0.0

        counts[norm_status] += 1

        ev_days = d_val * (progress_pct / 100.0)
        total_earned_effort += ev_days

        es = float(sched.get("es", 0.0))
        ef = float(sched.get("ef", d_val))

        if status_day <= es:
            pv_days = 0.0
        elif status_day >= ef:
            pv_days = d_val
        else:
            pv_days = d_val * ((status_day - es) / max(0.1, ef - es))
        total_planned_pv_at_status += pv_days

        act_start = act.get("actual_start_date")
        act_finish = act.get("actual_finish_date")
        if norm_status in ["in_progress", "completed", "verified"] and not act_start:
            act_start = (start_date_obj + timedelta(days=round(es))).strftime("%Y-%m-%d")
        if norm_status in ["completed", "verified"] and not act_finish:
            act_finish = (start_date_obj + timedelta(days=round(ef))).strftime("%Y-%m-%d")

        # Start and Finish variance
        start_var = None
        finish_var = None
        if act_start and sched.get("early_start_date"):
            try:
                s_act = datetime.strptime(act_start, "%Y-%m-%d").date()
                s_plan = datetime.strptime(sched["early_start_date"], "%Y-%m-%d").date()
                start_var = (s_act - s_plan).days
            except Exception:
                pass
        if act_finish and sched.get("early_finish_date"):
            try:
                f_act = datetime.strptime(act_finish, "%Y-%m-%d").date()
                f_plan = datetime.strptime(sched["early_finish_date"], "%Y-%m-%d").date()
                finish_var = (f_act - f_plan).days
            except Exception:
                pass

        is_m = bool(act.get("is_milestone") or d_val == 0.0)
        activities_control.append({
            "activity_id": act_id,
            "work_package_id": act.get("work_package_id", ""),
            "name": act.get("name", ""),
            "description": act.get("description", ""),
            "status": norm_status,
            "progress_pct": progress_pct,
            "duration": d_val,
            "is_milestone": is_m,
            "completion_proof": act.get("completion_proof"),
            "verification_checklist": act.get("verification_checklist", []),
            "es": es,
            "ef": ef,
            "ls": sched.get("ls", 0.0),
            "lf": sched.get("lf", d_val),
            "total_float": sched.get("total_float", 0.0),
            "free_float": sched.get("free_float", 0.0),
            "is_critical": sched.get("is_critical", False),
            "is_near_critical": sched.get("is_near_critical", False),
            "planned_start_date": sched.get("early_start_date"),
            "planned_finish_date": sched.get("early_finish_date"),
            "actual_start_date": act_start,
            "actual_finish_date": act_finish,
            "start_variance_days": start_var,
            "finish_variance_days": finish_var,
            "controller_id": act.get("controller_id"),
            "verified_by": act.get("verified_by"),
            "verified_date": act.get("verified_date"),
            "ev_days": round(ev_days, 1),
            "pv_days": round(pv_days, 1),
            "sv_days": round(ev_days - pv_days, 1),
            "assigned_users": act.get("assigned_users", []),
            "assigned_teams": act.get("assigned_teams", []),
            "time_logs": act.get("time_logs", []),
            "total_logged_seconds": int(act.get("total_logged_seconds") or sum(int(l.get("duration_seconds", 0)) for l in act.get("time_logs", []))),
            "notes": act.get("notes", "")
        })

    total_acts = len(activities_control) or 1
    cum_ev_pct = round((total_earned_effort / max(1.0, total_planned_effort)) * 100.0, 1)
    cum_pv_pct = round((total_planned_pv_at_status / max(1.0, total_planned_effort)) * 100.0, 1)

    if total_planned_pv_at_status > 0:
        spi = round(total_earned_effort / total_planned_pv_at_status, 3)
    else:
        spi = 1.0

    sv_days = round(total_earned_effort - total_planned_pv_at_status, 1)

    # Leading Indicators:
    eac_days = round(total_planned_duration / max(0.1, spi), 1) if spi > 0 else total_planned_duration
    forecast_finish_date = (start_date_obj + timedelta(days=round(eac_days))).strftime("%Y-%m-%d")
    projected_slippage = round(eac_days - total_planned_duration, 1)

    # Critical path slippage:
    crit_acts = [a for a in activities_control if a["is_critical"]]
    crit_pv = sum(a["pv_days"] for a in crit_acts)
    crit_ev = sum(a["ev_days"] for a in crit_acts)
    crit_spi = round(crit_ev / crit_pv, 3) if crit_pv > 0 else 1.0
    crit_slippage = round((1.0 - crit_spi) * total_planned_duration * 0.4, 1) if crit_spi < 1.0 else 0.0

    # Buffer / Project float erosion:
    init_pf = summary.get("project_float_days", 0.0)
    rem_pf = round(init_pf - max(0.0, projected_slippage), 1)

    if spi >= 0.98 and projected_slippage <= 0:
        health_status = "ON_SCHEDULE"
        health_label = "On Schedule"
        health_badge = "emerald"
    elif spi >= 0.90 or projected_slippage <= 45:
        health_status = "CAUTION"
        health_label = "Caution — Schedule Slippage Detected"
        health_badge = "amber"
    else:
        health_status = "CRITICAL_DELAY"
        health_label = "Critical Delay Alert"
        health_badge = "danger"

    # S-Curve Construction:
    # 35 sampling steps across the project timeline
    max_days = max(total_planned_duration * 1.05, eac_days * 1.02, 1750.0)
    step = max(25.0, max_days / 32.0)
    timeline_days = []
    curr_t = 0.0
    while curr_t <= max_days:
        timeline_days.append(round(curr_t, 1))
        curr_t += step
    if timeline_days[-1] < max_days:
        timeline_days.append(round(max_days, 1))

    if status_day not in timeline_days and 0 <= status_day <= max_days:
        timeline_days.append(round(status_day, 1))
        timeline_days.sort()

    s_curve_points = []
    for t in timeline_days:
        t_date = (start_date_obj + timedelta(days=round(t))).strftime("%Y-%m-%d")
        pv_early_val = sum(
            0.0 if t <= a["es"] else (a["duration"] if t >= a["ef"] else a["duration"] * ((t - a["es"]) / max(0.1, a["ef"] - a["es"])))
            for a in activities_control
        )
        pv_late_val = sum(
            0.0 if t <= a["ls"] else (a["duration"] if t >= a["lf"] else a["duration"] * ((t - a["ls"]) / max(0.1, a["lf"] - a["ls"])))
            for a in activities_control
        )

        early_pct = round((pv_early_val / max(1.0, total_planned_effort)) * 100.0, 1)
        late_pct = round((pv_late_val / max(1.0, total_planned_effort)) * 100.0, 1)

        # Actual curve up to status_day
        if t <= status_day:
            if status_day > 0:
                act_pct = round((t / status_day) * cum_ev_pct, 1)
            else:
                act_pct = 0.0
        else:
            act_pct = None

        # Forecast curve from status_day to eac_days
        if t >= status_day and status_day < eac_days:
            rem_ratio = (t - status_day) / max(1.0, eac_days - status_day)
            f_pct = round(cum_ev_pct + rem_ratio * (100.0 - cum_ev_pct), 1)
            f_pct = min(100.0, max(cum_ev_pct, f_pct))
        elif t >= status_day:
            f_pct = 100.0
        else:
            f_pct = None

        s_curve_points.append({
            "day": t,
            "date": t_date,
            "pv_early_pct": min(100.0, early_pct),
            "pv_late_pct": min(100.0, late_pct),
            "actual_ev_pct": act_pct,
            "forecast_pct": f_pct
        })

    return {
        "status_date": status_d.strftime("%Y-%m-%d"),
        "status_day_offset": status_day,
        "kpis": {
            "health_status": health_status,
            "health_label": health_label,
            "health_badge": health_badge,
            "spi": spi,
            "schedule_variance_days": sv_days,
            "cumulative_ev_pct": cum_ev_pct,
            "cumulative_pv_pct": cum_pv_pct,
            "total_earned_effort_days": round(total_earned_effort, 1),
            "total_planned_effort_days": round(total_planned_effort, 1),
            "planned_duration_days": total_planned_duration,
            "planned_start_date": summary["planned_start_date"],
            "planned_finish_date": summary["planned_finish_date"],
            "eac_forecast_days": eac_days,
            "forecast_finish_date": forecast_finish_date,
            "projected_slippage_days": projected_slippage,
            "critical_path_slippage_days": crit_slippage,
            "project_float_remaining_days": rem_pf,
            "total_activities": total_acts,
            "status_counts": {
                "not_started": counts["not_started"],
                "not_started_pct": round(counts["not_started"] / total_acts * 100.0, 1),
                "in_progress": counts["in_progress"],
                "in_progress_pct": round(counts["in_progress"] / total_acts * 100.0, 1),
                "completed": counts["completed"],
                "completed_pct": round(counts["completed"] / total_acts * 100.0, 1),
                "verified": counts["verified"],
                "verified_pct": round(counts["verified"] / total_acts * 100.0, 1)
            }
        },
        "s_curve": {
            "points": s_curve_points,
            "status_day": status_day,
            "status_date": status_d.strftime("%Y-%m-%d"),
            "planned_duration": total_planned_duration,
            "eac_duration": eac_days
        },
        "activities": activities_control,
        "dependencies": dependencies
    }


def get_cached_control_schedule(
    project_doc: Dict[str, Any],
    status_date_str: Optional[str] = None,
    base_schedule: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Retrieves Control Schedule / S-Curve from cache or computes & caches it atomically."""
    eff_status_date = status_date_str or date.today().strftime("%Y-%m-%d")
    key = _get_schedule_cache_key(project_doc, status_date=eff_status_date)
    with _CACHE_LOCK:
        if key in _CONTROL_SCHEDULE_CACHE:
            _CONTROL_SCHEDULE_CACHE.move_to_end(key)
            return copy.deepcopy(_CONTROL_SCHEDULE_CACHE[key])

    result = _calculate_control_schedule(project_doc, status_date_str, base_schedule=base_schedule)

    with _CACHE_LOCK:
        _CONTROL_SCHEDULE_CACHE[key] = result
        if len(_CONTROL_SCHEDULE_CACHE) > _MAX_CACHE_ENTRIES:
            _CONTROL_SCHEDULE_CACHE.popitem(last=False)

    return copy.deepcopy(result)


@router.get("/{project_id}/control-schedule")
def get_control_schedule(
    project_id: str,
    status_date: Optional[str] = Query(None, description="Optional status date YYYY-MM-DD (defaults to today)")
):
    """
    Control Schedule Main Endpoint (PMBOK Process 6.6).
    Returns operational task statuses (4 states), Leading & Lagging KPIs,
    and cumulative S-Curve model data.
    """
    project = _get_project_doc(project_id)

    return get_cached_control_schedule(project, status_date)


@router.put("/{project_id}/activities/{activity_id}/status")
def update_activity_execution_status(
    project_id: str,
    activity_id: str,
    payload: ActivityStatusUpdateRequest
):
    """
    Updates an activity's status (not_started, in_progress, completed, verified),
    progress percentage, actual dates, and controller validation.
    Triggers controller review requests, PM notifications, and automatic successor activity start on nearest business day.
    """
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    target_act = next((a for a in activities if a.get("activity_id") == activity_id), None)
    if not target_act:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Activity '{activity_id}' not found in project.")

    old_status = target_act.get("status", "not_started")
    norm_status = payload.status.lower().strip()
    if norm_status not in ["not_started", "in_progress", "completed", "verified"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Status must be one of: 'not_started', 'in_progress', 'completed', 'verified'.")

    now = datetime.utcnow()
    now_date_str = now.strftime("%Y-%m-%d")
    pm_id = str(project.get("created_by") or "")
    proj_name = project.get("name", "Project")
    act_name = target_act.get("name", activity_id)

    target_act["status"] = norm_status
    if norm_status == "not_started":
        target_act["progress_pct"] = 0.0
        target_act["actual_start_date"] = target_act["actual_finish_date"] = target_act["verified_by"] = target_act["verified_date"] = None
    else:
        target_act["actual_start_date"] = payload.actual_start_date or target_act.get("actual_start_date") or now_date_str
        if norm_status == "in_progress":
            target_act["progress_pct"] = payload.progress_pct if payload.progress_pct is not None else (70.0 if old_status == "completed" else 50.0)
            target_act["actual_finish_date"] = target_act["verified_by"] = target_act["verified_date"] = None
        else:
            target_act["progress_pct"] = 100.0
            target_act["actual_finish_date"] = payload.actual_finish_date or now_date_str
            is_v = (norm_status == "verified")
            target_act["verified_by"] = (payload.verified_by or target_act.get("verified_by") or "Project Controller") if is_v else None
            target_act["verified_date"] = (payload.verified_date or now_date_str) if is_v else None

    if payload.description:
        target_act["notes"] = payload.description
    elif payload.notes is not None:
        target_act["notes"] = payload.notes

    if payload.completion_proof is not None:
        target_act["completion_proof"] = payload.completion_proof
    if payload.verification_checklist is not None:
        target_act["verification_checklist"] = payload.verification_checklist

    def _notify(title, msg, ntype, recipients, to_pm=False, sender_name="Team Member", data=None):
        """Creates and persists an in-app project notification for PM, Controllers, or assigned contributors."""
        db["notifications"].insert_one({
            "project_id": str(project["_id"]), "project_name": proj_name,
            "title": title, "message": msg, "type": ntype,
            "to_all": False, "to_pm": to_pm, "recipient_teams": [],
            "recipient_users": recipients, "sender_id": payload.reviewer_id,
            "sender_name": sender_name, "read_by": [], "deleted_by": [],
            "data": data or {}, "created_at": now
        })

    # Notification & Transition Logic
    assigned_targets = list({str(u) for u in (target_act.get("assigned_users", []) + target_act.get("assigned_user_ids", [])) if str(u).strip()})
    pm_and_assigned = list(set(([pm_id] if pm_id else []) + assigned_targets))

    if norm_status == "completed" and old_status != "completed":
        controllers = list({str(c) for c in (project.get("controllers", []) + ([target_act["controller_id"]] if target_act.get("controller_id") else []))})
        proof_text = target_act.get("completion_proof") or ""
        proof_sum = f" Deliverable Evidence: {proof_text[:120]}..." if len(proof_text) > 120 else (f" Deliverable Evidence: {proof_text}" if proof_text else "")
        if controllers:
            _notify(f"Review Requested: {act_name}", f"Activity '{act_name}' has been marked as complete and requires Controller verification.{proof_sum}", "review_request", controllers, data={"project_id": str(project["_id"]), "project_name": proj_name, "activity_id": activity_id, "activity_name": act_name, "status": "completed", "completion_proof": proof_text})
    elif norm_status == "in_progress" and old_status == "completed":
        fb = payload.description or payload.notes or "Controller requested revisions."
        _notify(f"Activity Returned to WIP: {act_name}", f"Controller returned activity '{act_name}' to WIP status (Yellow). Description: {fb}", "review_returned_wip", pm_and_assigned, to_pm=True, sender_name=payload.verified_by or "Project Controller", data={"project_id": str(project["_id"]), "project_name": proj_name, "activity_id": activity_id, "activity_name": act_name, "status": "in_progress", "feedback": fb})
    elif norm_status == "verified" and old_status != "verified":
        so = payload.description or payload.notes or "Controller verified and approved."
        _notify(f"Activity Verified (Controlled): {act_name}", f"Controller confirmed activity '{act_name}' as Controlled (Blue). Description: {so}", "review_confirmed", pm_and_assigned, to_pm=True, sender_name=payload.verified_by or "Project Controller", data={"project_id": str(project["_id"]), "project_name": proj_name, "activity_id": activity_id, "activity_name": act_name, "status": "verified", "notes": so})
        nb_day = _get_nearest_business_day()
        deps, act_m = project.get("dependencies", []), {a.get("activity_id"): a for a in activities}
        act_m[activity_id]["status"] = "verified"
        for s_id in [d.get("to_activity_id") for d in deps if d.get("from_activity_id") == activity_id]:
            s_act = act_m.get(s_id)
            if s_act and s_act.get("status", "not_started") in ["not_started", ""]:
                if all(act_m.get(pid, {}).get("status") in ["completed", "verified"] for pid in [d.get("from_activity_id") for d in deps if d.get("to_activity_id") == s_id]):
                    s_act.update({"status": "in_progress", "progress_pct": 15.0, "actual_start_date": nb_day})

    # Save all updated activities
    updated_proj = col.find_one_and_update(
        {"_id": project["_id"]},
        {
            "$set": {
                "activities": activities,
                "updated_at": now
            }
        },
        return_document=True
    )
    invalidate_project_schedule_cache(str(updated_proj["_id"]))
    return get_cached_control_schedule(updated_proj)


@router.post("/{project_id}/activities/seed-progress")
def seed_realistic_activity_progress(project_id: str):
    """
    Initializes a realistic benchmark progress state for the Videogame Project:
    - Pre-production (Concept & Vision) is Completed and Verified by Controller (Blue)
    - Initial Prototyping is Completed (Green)
    - Art Style Concept and Core Engine are In-Progress (Yellow)
    - Downstream activities are Not Yet Started (White)
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    now_str = datetime.utcnow().strftime("%Y-%m-%d")

    for act in activities:
        act_id = act.get("activity_id", "")
        # Concept & Vision (WP-1.1): Completed & Verified (Blue)
        if act_id in ["ACT-1.1.1", "ACT-1.1.2", "ACT-1.1.3", "ACT-1.1.4"]:
            act["status"] = "verified"
            act["progress_pct"] = 100.0
            act["actual_start_date"] = "2026-10-14"
            act["actual_finish_date"] = "2026-12-15"
            act["verified_by"] = "Emily Rodriguez (Creative Controller)"
            act["verified_date"] = "2026-12-18"
        # Prototyping (WP-1.2): Completed (Green)
        elif act_id in ["ACT-1.2.1", "ACT-1.2.2", "ACT-1.2.3"]:
            act["status"] = "completed"
            act["progress_pct"] = 100.0
            act["actual_start_date"] = "2026-12-20"
            act["actual_finish_date"] = "2027-03-10"
            act["verified_by"] = None
            act["verified_date"] = None
        # Art Style & Engine (WP-1.3, WP-2.1): In-Progress (Yellow)
        elif act_id in ["ACT-1.3.1", "ACT-1.3.2", "ACT-2.1.1"]:
            act["status"] = "in_progress"
            act["progress_pct"] = 65.0
            act["actual_start_date"] = "2027-03-15"
            act["actual_finish_date"] = None
            act["verified_by"] = None
            act["verified_date"] = None
        # Remaining: Not Started (White)
        else:
            act["status"] = "not_started"
            act["progress_pct"] = 0.0
            act["actual_start_date"] = None
            act["actual_finish_date"] = None
            act["verified_by"] = None
            act["verified_date"] = None

    updated_proj = col.find_one_and_update(
        {"_id": project["_id"]},
        {
            "$set": {
                "activities": activities,
                "updated_at": datetime.utcnow()
            }
        },
        return_document=True
    )
    invalidate_project_schedule_cache(str(updated_proj["_id"]))
    return get_cached_control_schedule(updated_proj)




# ==============================================================================
# ==============================================================================
# SINGLE PLANNED BASELINE SNAPSHOT & COMPARISON
# ==============================================================================

@router.post("/{project_id}/baselines")
def create_project_baseline(project_id: str, payload: CreateBaselineRequest, user_id: Optional[str] = Query(None)):
    """Freezes current CPM schedule into the single canonical Planned Baseline snapshot."""
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    cal = project.get("calendar_settings")
    sched = get_cached_comprehensive_schedule(
        project_doc=project,
        imposed_deadline_date_val=(project.get("schedule_settings") or {}).get("imposed_deadline_date"),
        imposed_deadline_days_val=(project.get("schedule_settings") or {}).get("imposed_deadline_days"),
        near_critical_threshold=float((project.get("schedule_settings") or {}).get("near_critical_threshold_days", 25.0)),
        calendar_settings=cal
    )

    creator_name = "Project Manager"
    if user_id:
        try:
            u = db["users"].find_one({"_id": ObjectId(user_id)})
            if u:
                creator_name = f"{u.get('first_name', '')} {u.get('last_name', '')}".strip() or u.get("name") or u.get("username") or "Project Manager"
        except Exception:
            pass

    act_snapshot = [
        {k: a.get(k) for k in [
            "activity_id", "name", "duration", "es", "ef", "ls", "lf",
            "total_float", "free_float", "early_start_date", "early_finish_date", "is_critical", "is_milestone"
        ]}
        for a in sched.get("activities_schedule", [])
    ]

    baseline_doc = {
        "id": "PLANNED_BASELINE",
        "baseline_id": "PLANNED_BASELINE",
        "name": payload.name.strip() or "Planned Baseline",
        "description": payload.description or "",
        "created_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "created_by": user_id or str(project.get("created_by", "")),
        "created_by_name": creator_name,
        "activities_count": len(act_snapshot),
        "planned_duration_days": (sched.get("summary") or {}).get("planned_duration_days", 0.0),
        "planned_finish_date": (sched.get("summary") or {}).get("planned_finish_date"),
        "activities_snapshot": act_snapshot,
        "snapshot": {
            "summary": sched.get("summary"),
            "critical_path_ids": sched.get("critical_path_ids", []),
            "activities": act_snapshot
        }
    }

    col.update_one({"_id": project["_id"]}, {"$set": {"planned_baseline": baseline_doc, "updated_at": datetime.utcnow()}})
    return baseline_doc


@router.get("/{project_id}/baselines")
def list_project_baselines(project_id: str):
    """Returns the single Planned Baseline snapshot for comparison."""
    doc = _get_project_doc(project_id)
    b = doc.get("planned_baseline") or (doc.get("baselines", [])[0] if doc.get("baselines") else None)
    return [b] if b else []


@router.delete("/{project_id}/baselines/{baseline_id}")
def delete_project_baseline(project_id: str, baseline_id: str, user_id: Optional[str] = Query(None)):
    """Clears the Planned Baseline snapshot."""
    col = _projects_col()
    project = _get_project_doc(project_id, col)

    col.update_one({"_id": project["_id"]}, {"$unset": {"planned_baseline": "", "baselines": ""}, "$set": {"updated_at": datetime.utcnow()}})
    return {"message": "Planned baseline cleared successfully."}



# ==============================================================================
# DCMA 14-POINT AUTOMATED SCHEDULE QUALITY DIAGNOSTIC
# ==============================================================================

@router.get("/{project_id}/schedule/dcma-quality")
def get_dcma_quality_audit(project_id: str):
    """
    Automated Defense Contract Management Agency (DCMA) 14-Point Assessment.
    Evaluates logic integrity, leads, lags, float distortion, duration thresholds,
    and returns itemized culprit activities for corrective action.
    """
    project = _get_project_doc(project_id)

    activities = project.get("activities", [])
    dependencies = project.get("dependencies", [])
    cal_settings = project.get("calendar_settings")

    sched = get_cached_comprehensive_schedule(
        project_doc=project,
        imposed_deadline_date_val=(project.get("schedule_settings") or {}).get("imposed_deadline_date"),
        imposed_deadline_days_val=(project.get("schedule_settings") or {}).get("imposed_deadline_days"),
        calendar_settings=cal_settings
    )

    ctrl = get_cached_control_schedule(project, base_schedule=sched)
    spi = float((ctrl.get("kpis") or {}).get("spi", 1.0))

    act_schedule = sched.get("activities_schedule", [])
    total_acts = len(act_schedule)

    if total_acts == 0:
        return {
            "score": 100,
            "grade": "A",
            "passed_count": 14,
            "warning_count": 0,
            "failed_count": 0,
            "metrics": []
        }

    preds_map = {a["activity_id"]: [] for a in act_schedule}
    succs_map = {a["activity_id"]: [] for a in act_schedule}

    total_deps = len(dependencies)
    lags_count = 0
    leads_count = 0
    fs_count = 0

    for d in dependencies:
        u = d.get("from_activity_id") or d.get("from")
        v = d.get("to_activity_id") or d.get("to")
        lag = float(d.get("lag_days") or 0.0)
        rel = (d.get("type") or "FS").upper().replace("(", "").replace(")", "").strip()

        if u in succs_map:
            succs_map[u].append(v)
        if v in preds_map:
            preds_map[v].append(u)

        if lag > 0:
            lags_count += 1
        elif lag < 0:
            leads_count += 1

        if rel == "FS":
            fs_count += 1

    # 1. Logic (Open ends)
    open_ends_culprits = []
    max_ef = max((a.get("ef", 0) for a in act_schedule), default=0)
    for a in act_schedule:
        aid = a["activity_id"]
        if total_acts > 1:
            has_no_pred = len(preds_map.get(aid, [])) == 0 and a.get("es", 0) > 0
            has_no_succ = len(succs_map.get(aid, [])) == 0 and a.get("ef", 0) < max_ef
            if has_no_pred or has_no_succ:
                reasons = []
                if has_no_pred: reasons.append("Missing predecessor (dangling start)")
                if has_no_succ: reasons.append("Missing successor (dangling finish)")
                open_ends_culprits.append({"activity_id": aid, "name": a["name"], "reason": ", ".join(reasons)})

    open_ends_pct = round((len(open_ends_culprits) / total_acts) * 100, 1)

    # 2. Leads (Negative Lags)
    leads_pct = round((leads_count / total_deps) * 100, 1) if total_deps > 0 else 0.0
    leads_culprits = [{"dependency": f"{d.get('from_activity_id')} -> {d.get('to_activity_id')}", "lag": d.get("lag_days")} for d in dependencies if float(d.get("lag_days") or 0.0) < 0]

    # 3. Lags (Positive Lags)
    lags_pct = round((lags_count / total_deps) * 100, 1) if total_deps > 0 else 0.0
    lags_culprits = [{"dependency": f"{d.get('from_activity_id')} -> {d.get('to_activity_id')}", "lag": d.get("lag_days")} for d in dependencies if float(d.get("lag_days") or 0.0) > 0]

    # 4. Relationship Types (>=90% FS)
    fs_pct = round((fs_count / total_deps) * 100, 1) if total_deps > 0 else 100.0
    non_fs_culprits = [{"dependency": f"{d.get('from_activity_id')} -> {d.get('to_activity_id')}", "type": d.get("type")} for d in dependencies if (d.get("type") or "FS").upper() != "FS"]

    # 5. Hard Constraints
    hard_constraints_culprits = []

    # 6. High Total Float (>44 days)
    high_float_culprits = [{"activity_id": a["activity_id"], "name": a["name"], "total_float": a["total_float"]} for a in act_schedule if a["total_float"] > 44.0]
    high_float_pct = round((len(high_float_culprits) / total_acts) * 100, 1)

    # 7. Negative Total Float (<0)
    neg_float_culprits = [{"activity_id": a["activity_id"], "name": a["name"], "total_float": a["total_float"]} for a in act_schedule if a["total_float"] < -0.05]
    neg_float_pct = round((len(neg_float_culprits) / total_acts) * 100, 1)

    # 8. High Duration Tasks (>44 days)
    high_dur_culprits = [{"activity_id": a["activity_id"], "name": a["name"], "duration": a["duration"]} for a in act_schedule if a["duration"] > 44.0 and not a.get("is_milestone")]
    high_dur_pct = round((len(high_dur_culprits) / total_acts) * 100, 1)

    # 9. Reverse Logic / Invalid Dates
    rev_logic_culprits = [{"activity_id": a["activity_id"], "name": a["name"], "es": a["es"], "ef": a["ef"]} for a in act_schedule if a["ef"] < a["es"]]
    rev_logic_pct = round((len(rev_logic_culprits) / total_acts) * 100, 1)

    # 10. Resource Loaded (>=95%)
    unassigned_culprits = [{"activity_id": a["activity_id"], "name": a["name"]} for a in activities if not a.get("assigned_users") and not a.get("assigned_teams") and not a.get("is_milestone")]
    res_loaded_pct = round(((total_acts - len(unassigned_culprits)) / total_acts) * 100, 1)

    # 11. Missed Tasks
    now_str = date.today().strftime("%Y-%m-%d")
    missed_culprits = [
        {"activity_id": a["activity_id"], "name": a["name"], "status": a.get("status"), "planned_finish": a.get("early_finish_date")}
        for a in act_schedule
        if a.get("status") not in ["completed", "verified"] and a.get("early_finish_date", "9999") < now_str
    ]
    missed_pct = round((len(missed_culprits) / total_acts) * 100, 1)

    # 12. Critical Path Continuity Test
    cp_ids = sched.get("critical_path_ids", [])
    has_cp = len(cp_ids) > 0
    cp_test_status = "pass" if has_cp else "fail"

    # 13. Critical Path Float Index (CFIX)
    cp_len = (sched.get("summary") or {}).get("planned_duration_days", 1.0)
    proj_float = (sched.get("summary") or {}).get("project_float_days", 0.0)
    cfix = round((cp_len + proj_float) / cp_len, 2) if cp_len > 0 else 1.0
    cfix_status = "pass" if cfix >= 0.95 else ("warning" if cfix >= 0.85 else "fail")

    # 14. Schedule Performance Index (SPI)
    spi_status = "pass" if spi >= 0.95 else ("warning" if spi >= 0.85 else "fail")

    def _m(m_id, name, desc, target, val, count, ratio, thresh, stat, culprits):
        """Builds a standardized DCMA diagnostic metric evaluation dictionary."""
        return {
            "id": m_id, "name": name, "description": desc, "target": target,
            "value": val, "count": count, "ratio_pct": ratio, "threshold_pct": thresh,
            "status": stat, "culprits": culprits
        }

    metrics = [
        _m(1, "1. Logic (Open Ends)", "Activities without predecessors or successors (excluding project start/end).", "< 5.0%", f"{open_ends_pct}% ({len(open_ends_culprits)} activities)", len(open_ends_culprits), open_ends_pct, 5.0, "pass" if open_ends_pct < 5.0 else ("warning" if open_ends_pct < 10.0 else "fail"), open_ends_culprits),
        _m(2, "2. Leads (Negative Lags)", "Precedence links with negative lag. Leads distort critical path calculation.", "0.0%", f"{leads_pct}% ({len(leads_culprits)} links)", len(leads_culprits), leads_pct, 0.0, "pass" if len(leads_culprits) == 0 else "fail", leads_culprits),
        _m(3, "3. Lags (Positive Lags)", "Precedence links with positive lag duration.", "< 5.0%", f"{lags_pct}% ({len(lags_culprits)} links)", len(lags_culprits), lags_pct, 5.0, "pass" if lags_pct <= 5.0 else ("warning" if lags_pct <= 10.0 else "fail"), lags_culprits),
        _m(4, "4. Relationship Types", "Predominance of Finish-to-Start (FS) relationships.", ">= 90.0% FS", f"{fs_pct}% FS ({total_deps - fs_count} non-FS links)", total_deps - fs_count, fs_pct, 90.0, "pass" if fs_pct >= 90.0 else ("warning" if fs_pct >= 80.0 else "fail"), non_fs_culprits),
        _m(5, "5. Hard Constraints", "Mandatory fixed date constraints overriding network flow.", "< 5.0%", "0.0% (0 hard constraints)", 0, 0.0, 5.0, "pass", []),
        _m(6, "6. High Total Float", "Activities with total float greater than 44 working days.", "< 5.0%", f"{high_float_pct}% ({len(high_float_culprits)} activities)", len(high_float_culprits), high_float_pct, 5.0, "pass" if high_float_pct <= 5.0 else ("warning" if high_float_pct <= 12.0 else "fail"), high_float_culprits),
        _m(7, "7. Negative Total Float", "Activities with negative float indicate the project will miss deadline.", "0.0%", f"{neg_float_pct}% ({len(neg_float_culprits)} activities)", len(neg_float_culprits), neg_float_pct, 0.0, "pass" if len(neg_float_culprits) == 0 else "fail", neg_float_culprits),
        _m(8, "8. High Duration Tasks", "Activities with planned duration exceeding 44 working days.", "< 5.0%", f"{high_dur_pct}% ({len(high_dur_culprits)} activities)", len(high_dur_culprits), high_dur_pct, 5.0, "pass" if high_dur_pct <= 5.0 else ("warning" if high_dur_pct <= 12.0 else "fail"), high_dur_culprits),
        _m(9, "9. Reverse Logic / Invalid Dates", "Activities where calculated finish precedes start date.", "0.0%", f"{rev_logic_pct}% ({len(rev_logic_culprits)} activities)", len(rev_logic_culprits), rev_logic_pct, 0.0, "pass" if len(rev_logic_culprits) == 0 else "fail", rev_logic_culprits),
        _m(10, "10. Resource Assignment Coverage", "Percentage of operational activities assigned to users or teams.", ">= 95.0%", f"{res_loaded_pct}% ({len(unassigned_culprits)} unassigned)", len(unassigned_culprits), res_loaded_pct, 95.0, "pass" if res_loaded_pct >= 95.0 else ("warning" if res_loaded_pct >= 80.0 else "fail"), unassigned_culprits),
        _m(11, "11. Missed Tasks", "Activities scheduled to complete before today that remain unfinished.", "0.0%", f"{missed_pct}% ({len(missed_culprits)} tasks missed)", len(missed_culprits), missed_pct, 0.0, "pass" if len(missed_culprits) == 0 else ("warning" if len(missed_culprits) <= 2 else "fail"), missed_culprits),
        _m(12, "12. Critical Path Continuity Test", "Validation of an uninterrupted critical path through the network.", "Continuous Critical Path", f"{len(cp_ids)} activities on Critical Path", 0 if has_cp else 1, 100.0 if has_cp else 0.0, 100.0, cp_test_status, [] if has_cp else [{"error": "No continuous critical path identified"}]),
        _m(13, "13. Critical Path Float Index (CFIX)", "Ratio of critical path duration plus project buffer to project duration.", ">= 1.00", f"{cfix:.2f}", 0 if cfix >= 0.95 else 1, round(cfix * 100, 1), 100.0, cfix_status, []),
        _m(14, "14. Schedule Performance Index (SPI)", "Earned Value SPI leading indicator of execution progress.", ">= 0.95", f"{spi:.2f}", 0 if spi >= 0.95 else 1, round(min(spi, 5.0) * 100, 1), 95.0, spi_status, [])
    ]

    passed_count = sum(1 for m in metrics if m["status"] == "pass")
    warn_count = sum(1 for m in metrics if m["status"] == "warning")
    failed_count = sum(1 for m in metrics if m["status"] == "fail")

    score = round(((passed_count * 1.0 + warn_count * 0.5) / len(metrics)) * 100.0)
    grade = "A" if score >= 90 else ("B" if score >= 80 else ("C" if score >= 70 else "D"))

    return {
        "score": score,
        "overall_score": score,
        "grade": grade,
        "letter_grade": grade,
        "passed_count": passed_count,
        "warning_count": warn_count,
        "failed_count": failed_count,
        "metrics": metrics
    }


# ==============================================================================
# TIME LOGS & TASK STOPWATCH (TRELLO-STYLE TIME TRACKING)
# ==============================================================================

def _is_user_assigned_to_activity(
    project: Dict[str, Any],
    act: Dict[str, Any],
    user_id: str,
    user_name: Optional[str] = None,
    db: Any = None
) -> bool:
    """
    Evaluates whether an activity is assigned to a user for timer tracking.
    Rules:
      1. Project Manager / Lead Controller (project.created_by) has supervisory access to all project activities.
      2. Direct individual assignment: user is in act.assigned_users or act.assigned_user_ids.
      3. Team membership & Team Lead on assigned teams: user is a member or designated lead_id
         of one of the teams assigned to THIS specific activity (act.assigned_teams).
      4. Appointed Activity Controller: user is an active controller in project.controllers
         AND is specifically designated as the controller for THIS activity (act.controller_id == user_id).
         Controllers do NOT get automatically assigned to activities overseen by other controllers.
      5. Completely unassigned activity: if no users, teams, or controller are assigned, open to project members.
    """
    clean_uid = str(user_id).strip()
    pm_id = str(project.get("created_by") or "").strip()

    # 1. Project Manager / Lead Controller has overall oversight
    if clean_uid and clean_uid == pm_id:
        return True

    # Check for system administrator privileges
    database = db if db is not None else get_db()
    try:
        user_doc = database["users"].find_one(build_id_query(clean_uid))
        if not user_doc:
            user_doc = database["users"].find_one({"username": clean_uid.lower()})
        if user_doc and bool(user_doc.get("is_admin")):
            return True
    except Exception:
        pass

    assigned_users = [str(u).strip() for u in (act.get("assigned_users", []) + act.get("assigned_user_ids", []))]
    assigned_teams = [str(t).strip() for t in act.get("assigned_teams", [])]
    project_controllers = [str(c).strip() for c in project.get("controllers", [])]
    act_controller_id = str(act.get("controller_id") or "").strip()

    # 2. Completely unassigned task allows project collaboration
    if not assigned_users and not assigned_teams and not act_controller_id:
        return True

    # 3. Direct individual assignment
    if clean_uid in assigned_users or (user_name and str(user_name).strip() in assigned_users):
        return True

    # 4. Team membership and Team Lead on assigned teams
    for tm in project.get("teams", []):
        t_id = str(tm.get("team_id") or "").strip()
        t_name = str(tm.get("name") or "").strip()
        if t_id in assigned_teams or t_name in assigned_teams:
            m_ids = [str(m).strip() for m in tm.get("member_ids", [])]
            lead_id = str(tm.get("lead_id") or "").strip()
            if clean_uid in m_ids:
                return True
            if lead_id and lead_id == clean_uid:
                return True

    # 5. Appointed Activity Controller:
    # Must be in project.controllers AND specifically appointed to this activity
    if clean_uid in project_controllers and act_controller_id and act_controller_id == clean_uid:
        return True

    return False


@router.post("/{project_id}/activities/{activity_id}/timer/start")
def start_activity_timer(project_id: str, activity_id: str, payload: StartTimerRequest):
    """
    Starts a live work timer linked strictly to an in-progress task (WIP).
    Rejects tasks that are not currently in_progress.
    """
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    target_act = next((a for a in activities if a.get("activity_id") == activity_id), None)
    if not target_act:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Activity '{activity_id}' not found in project.")

    status_str = str(target_act.get("status") or "not_started").lower().strip()
    if status_str != "in_progress":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Timers can only be started on tasks that are currently in progress (WIP). Current status is '{status_str}'."
        )

    # Verify that the activity is assigned to the user (considering Lead and Controller roles as assigned)
    user_id = str(payload.user_id).strip()
    user_name = (payload.user_name or "").strip() or "Team Member"
    if not _is_user_assigned_to_activity(project, target_act, user_id, user_name, db=db):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"The Activity to which you attach the timer must also be assigned to you. Otherwise, you cannot select it."
        )

    now_iso = datetime.utcnow().isoformat()

    active_timer_entry = {
        "user_id": user_id,
        "user_name": user_name,
        "start_time": now_iso,
        "notes": (payload.notes or "").strip()
    }

    # Store active timer on the activity (replacing any existing active timer for this user on this activity)
    col.update_one(
        {"_id": project["_id"], "activities.activity_id": activity_id},
        {
            "$pull": {"activities.$.active_timers": {"user_id": user_id}}
        }
    )
    col.update_one(
        {"_id": project["_id"], "activities.activity_id": activity_id},
        {
            "$push": {"activities.$.active_timers": active_timer_entry},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    invalidate_project_schedule_cache(str(project["_id"]))

    return {
        "message": f"Timer started for task {activity_id} ({target_act.get('name')})",
        "activity_id": activity_id,
        "activity_name": target_act.get("name", activity_id),
        "user_id": user_id,
        "user_name": user_name,
        "start_time": now_iso,
        "status": status_str
    }


@router.post("/{project_id}/activities/{activity_id}/timer/stop")
def stop_activity_timer(project_id: str, activity_id: str, payload: StopTimerRequest):
    """
    Stops the active timer for the user, calculates elapsed duration,
    and commits an immutable time log record.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    target_act = next((a for a in activities if a.get("activity_id") == activity_id), None)
    if not target_act:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Activity '{activity_id}' not found in project.")

    user_id = str(payload.user_id).strip()
    user_name = (payload.user_name or "").strip()
    now = datetime.utcnow()
    now_iso = now.isoformat()

    # Find active timer if exists
    active_timers = target_act.get("active_timers", [])
    user_timer = next((t for t in active_timers if t.get("user_id") == user_id), None)

    start_iso = user_timer.get("start_time") if user_timer else None
    calculated_duration = 0

    if payload.duration_seconds is not None and payload.duration_seconds > 0:
        calculated_duration = int(payload.duration_seconds)
    elif start_iso:
        try:
            start_dt = datetime.fromisoformat(start_iso)
            calculated_duration = max(1, int((now - start_dt).total_seconds()))
        except Exception:
            calculated_duration = 60
    else:
        calculated_duration = 60  # Default 1 minute if untracked

    if not start_iso:
        start_iso = (now - timedelta(seconds=calculated_duration)).isoformat()

    final_user_name = user_name or (user_timer.get("user_name") if user_timer else "Team Member")
    final_notes = (payload.notes or "").strip() or (user_timer.get("notes") if user_timer else "")

    log_entry = {
        "log_id": uuid.uuid4().hex[:12],
        "user_id": user_id,
        "user_name": final_user_name,
        "start_time": start_iso,
        "end_time": now_iso,
        "duration_seconds": calculated_duration,
        "notes": final_notes,
        "created_at": now_iso
    }

    current_logs = target_act.get("time_logs", [])
    new_total_seconds = sum(int(l.get("duration_seconds", 0)) for l in current_logs) + calculated_duration

    col.update_one(
        {"_id": project["_id"], "activities.activity_id": activity_id},
        {
            "$push": {"activities.$.time_logs": log_entry},
            "$set": {
                "activities.$.total_logged_seconds": new_total_seconds,
                "updated_at": now
            },
            "$pull": {"activities.$.active_timers": {"user_id": user_id}}
        }
    )
    invalidate_project_schedule_cache(str(project["_id"]))

    return {
        "message": f"Time logged successfully: {calculated_duration}s on task {activity_id}",
        "log": log_entry,
        "activity_id": activity_id,
        "total_logged_seconds": new_total_seconds
    }


@router.get("/{project_id}/activities/{activity_id}/time-logs")
def get_activity_time_logs(project_id: str, activity_id: str):
    """
    Returns the complete time tracking history for an activity:
    total duration, per-user aggregated spent time, and chronological session logs.
    Available for tasks in any status (not_started, in_progress, completed, verified).
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    target_act = next((a for a in activities if a.get("activity_id") == activity_id), None)
    if not target_act:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Activity '{activity_id}' not found in project.")

    logs = target_act.get("time_logs", [])
    total_seconds = sum(int(l.get("duration_seconds", 0)) for l in logs)

    # Aggregate by user
    user_totals = {}
    for l in logs:
        uid = str(l.get("user_id") or "unknown")
        uname = str(l.get("user_name") or "Team Member")
        dur = int(l.get("duration_seconds", 0))
        if uid not in user_totals:
            user_totals[uid] = {"user_id": uid, "user_name": uname, "total_seconds": 0, "session_count": 0}
        user_totals[uid]["total_seconds"] += dur
        user_totals[uid]["session_count"] += 1

    user_breakdown = list(user_totals.values())
    user_breakdown.sort(key=lambda u: u["total_seconds"], reverse=True)

    return {
        "project_id": str(project["_id"]),
        "project_name": project.get("name", "Project"),
        "activity_id": activity_id,
        "activity_name": target_act.get("name", activity_id),
        "status": target_act.get("status", "not_started"),
        "total_logged_seconds": total_seconds,
        "total_sessions": len(logs),
        "by_user": user_breakdown,
        "time_logs": sorted(logs, key=lambda x: x.get("created_at") or "", reverse=True),
        "logs": sorted(logs, key=lambda x: x.get("created_at") or "", reverse=True),
        "active_timers": target_act.get("active_timers", [])
    }


@router.get("/{project_id}/time-logs/summary")
def get_project_time_logs_summary(project_id: str):
    """
    Executive summary of time logged across all tasks in the project.
    Used by PM Control Project screen to view hours spent by task and by contributor.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    project_total_seconds = 0
    activity_summaries = []
    overall_user_totals = {}

    for act in activities:
        act_id = act.get("activity_id")
        logs = act.get("time_logs", [])
        act_seconds = sum(int(l.get("duration_seconds", 0)) for l in logs)
        project_total_seconds += act_seconds

        contributors = set()
        for l in logs:
            uid = str(l.get("user_id") or "unknown")
            uname = str(l.get("user_name") or "Team Member")
            dur = int(l.get("duration_seconds", 0))
            contributors.add(uid)

            if uid not in overall_user_totals:
                overall_user_totals[uid] = {"user_id": uid, "user_name": uname, "total_seconds": 0, "session_count": 0}
            overall_user_totals[uid]["total_seconds"] += dur
            overall_user_totals[uid]["session_count"] += 1

        activity_summaries.append({
            "activity_id": act_id,
            "name": act.get("name", act_id),
            "status": act.get("status", "not_started"),
            "total_logged_seconds": act_seconds,
            "session_count": len(logs),
            "contributors_count": len(contributors)
        })

    return {
        "project_id": str(project["_id"]),
        "project_name": project.get("name", "Project"),
        "total_project_seconds": project_total_seconds,
        "activities": activity_summaries,
        "by_user": sorted(list(overall_user_totals.values()), key=lambda u: u["total_seconds"], reverse=True)
    }


@router.put("/{project_id}/activities/{activity_id}/time-logs/{log_id}")
def update_activity_time_log(project_id: str, activity_id: str, log_id: str, payload: UpdateTimeLogRequest):
    """
    Updates a user-generated timer log:
    - Allows updating 'notes'.
    - Allows reassigning the associated task ('target_activity_id'), strictly enforcing that the
      target task must be in progress (WIP) and assigned to the user.
    - Duration cannot be changed.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)
    activities = project.get("activities", [])
    
    source_act = next((a for a in activities if a.get("activity_id") == activity_id), None)
    if not source_act:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Source activity '{activity_id}' not found.")
        
    source_logs = source_act.get("time_logs", [])
    target_log = next((l for l in source_logs if l.get("log_id") == log_id), None)
    if not target_log:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Timer log '{log_id}' not found on activity '{activity_id}'.")
        
    # Check ownership
    request_user_id = str(payload.user_id).strip()
    log_user_id = str(target_log.get("user_id") or "").strip()
    is_pm = str(project.get("created_by") or "") == request_user_id
    if log_user_id != request_user_id and not is_pm:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit timer logs that you generated.")

    # Update notes if provided
    if payload.notes is not None:
        target_log["notes"] = payload.notes.strip()

    # Reassign activity if target_activity_id is specified and distinct
    target_act_id = (payload.target_activity_id or "").strip()
    if target_act_id and target_act_id != activity_id:
        target_act = next((a for a in activities if a.get("activity_id") == target_act_id), None)
        if not target_act:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Target activity '{target_act_id}' not found.")
            
        target_status = str(target_act.get("status") or "not_started").lower().strip()
        if target_status != "in_progress":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot reassign timer to activity '{target_act_id}': Target activity must be in progress (WIP). Current status is '{target_status}'."
            )

        # Verify assignment constraint on target activity (considering Lead and Controller roles as assigned)
        if not _is_user_assigned_to_activity(project, target_act, request_user_id, target_log.get("user_name"), db=get_db()):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"The Activity to which you attach the timer must also be assigned to you. Otherwise, you cannot select it."
            )

        # Move the log entry from source to target
        log_duration = int(target_log.get("duration_seconds", 0))
        source_act["time_logs"] = [l for l in source_logs if l.get("log_id") != log_id]
        source_act["total_logged_seconds"] = max(0, int(source_act.get("total_logged_seconds", 0)) - log_duration)
        
        target_act_logs = target_act.get("time_logs", [])
        target_act_logs.append(target_log)
        target_act["time_logs"] = target_act_logs
        target_act["total_logged_seconds"] = int(target_act.get("total_logged_seconds", 0)) + log_duration

    col.update_one(
        {"_id": project["_id"]},
        {"$set": {"activities": activities, "updated_at": datetime.utcnow()}}
    )
    invalidate_project_schedule_cache(str(project["_id"]))

    return {
        "message": "Timer log updated successfully.",
        "log": target_log,
        "source_activity_id": activity_id,
        "target_activity_id": target_act_id or activity_id
    }


@router.delete("/{project_id}/activities/{activity_id}/time-logs/{log_id}")
def delete_activity_time_log(project_id: str, activity_id: str, log_id: str, user_id: str):
    """
    Deletes a user-generated timer log:
    - Removes the log from the activity's time_logs.
    - Decrements activity's total_logged_seconds accordingly.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)
    activities = project.get("activities", [])
    
    source_act = next((a for a in activities if a.get("activity_id") == activity_id), None)
    if not source_act:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Activity '{activity_id}' not found.")
        
    source_logs = source_act.get("time_logs", [])
    target_log = next((l for l in source_logs if l.get("log_id") == log_id), None)
    if not target_log:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Timer log '{log_id}' not found on activity '{activity_id}'.")
        
    request_user_id = str(user_id).strip()
    log_user_id = str(target_log.get("user_id") or "").strip()
    is_pm = str(project.get("created_by") or "") == request_user_id
    if log_user_id != request_user_id and not is_pm:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete timer logs that you generated.")

    log_duration = int(target_log.get("duration_seconds", 0))
    source_act["time_logs"] = [l for l in source_logs if l.get("log_id") != log_id]
    source_act["total_logged_seconds"] = max(0, int(source_act.get("total_logged_seconds", 0)) - log_duration)

    col.update_one(
        {"_id": project["_id"]},
        {"$set": {"activities": activities, "updated_at": datetime.utcnow()}}
    )
    invalidate_project_schedule_cache(str(project["_id"]))

    return {
        "message": f"Timer log '{log_id}' deleted successfully.",
        "activity_id": activity_id,
        "deducted_seconds": log_duration,
        "remaining_logged_seconds": source_act["total_logged_seconds"]
    }


@router.get("/{project_id}/my-time-logs")
def get_user_project_time_logs(project_id: str, user_id: str):
    """
    Returns all time tracking logs generated by a specific user across all project activities.
    Used for the member's Trackers screen.
    """
    col = _projects_col()
    project = _get_project_doc(project_id, col)
    activities = project.get("activities", [])
    clean_uid = str(user_id).strip()

    user_logs = []
    for act in activities:
        act_id = act.get("activity_id")
        act_name = act.get("name", act_id)
        act_status = act.get("status", "not_started")
        for l in act.get("time_logs", []):
            if str(l.get("user_id") or "").strip() == clean_uid:
                entry = dict(l)
                entry["activity_id"] = act_id
                entry["activity_name"] = act_name
                entry["activity_status"] = act_status
                user_logs.append(entry)

    user_logs.sort(key=lambda x: x.get("start_time") or x.get("created_at") or "", reverse=True)
    return {
        "project_id": str(project["_id"]),
        "user_id": clean_uid,
        "total_trackers": len(user_logs),
        "total_duration_seconds": sum(int(l.get("duration_seconds", 0)) for l in user_logs),
        "logs": user_logs
    }





