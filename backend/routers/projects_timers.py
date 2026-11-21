"""
SyncFlow - Projects Timers & Time Logs Router (`backend/routers/projects_timers.py`).
Handles stopwatch sessions (start/stop) strictly bound to in-progress activities (WIP),
time-log CRUD operations, project time log summaries, and user personal tracker logs.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, status

from backend.database.connection import get_db
from backend.models.project import (
    StartTimerRequest,
    StopTimerRequest,
    UpdateTimeLogRequest
)
from backend.utility import build_id_query
from backend.routers.projects_shared import (
    _projects_col,
    _get_project_doc,
    invalidate_project_schedule_cache
)

router = APIRouter(prefix="/syncflow/projects", tags=["Projects Timers"])


# ==============================================================================
# ASSIGNMENT & PERMISSION EVALUATION
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


# ==============================================================================
# STOPWATCH TIMER SESSIONS
# ==============================================================================

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


# ==============================================================================
# TIME LOG AUDITING & REPORTING ENDPOINTS
# ==============================================================================

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
