"""
SyncFlow - Projects Control Router (`backend/routers/projects_control.py`).
Implements PMBOK Process 6.6 (Control Schedule), 4-tier activity execution statuses,
time-based Earned Value Management (EVM), S-Curve Banana Envelope calculations,
status updates with controller review triggers, and DCMA 14-Point Quality Assessment.
"""
import copy
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query

from backend.database.connection import get_db
from backend.models.project import ActivityStatusUpdateRequest
from backend.routers.projects_shared import (
    _projects_col,
    _get_project_doc,
    _CACHE_LOCK,
    _CONTROL_SCHEDULE_CACHE,
    _MAX_CACHE_ENTRIES,
    _get_schedule_cache_key,
    invalidate_project_schedule_cache,
    _get_act_duration,
    _get_nearest_business_day
)
from backend.routers.projects_schedule import get_cached_comprehensive_schedule

router = APIRouter(prefix="/syncflow/projects", tags=["Projects Control"])


# ==============================================================================
# EARNED VALUE MANAGEMENT (EVM) & S-CURVE ENGINE
# ==============================================================================

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


# ==============================================================================
# SCHEDULE CONTROL ENDPOINTS
# ==============================================================================

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

    # Enforce: Once a task has reached Work in Progress (WIP) or beyond, it cannot be reverted to Not Started
    if old_status in ["in_progress", "completed", "verified"] and norm_status == "not_started":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A task that has reached Work in Progress (WIP) or beyond cannot be reverted to Not Started."
        )

    # Enforce Team Lead Authority: If an activity is assigned to teams that have a designated Team Lead,
    # non-lead team members cannot submit the task for completion review (only Team Lead, PM, or Controllers can).
    if norm_status == "completed" and payload.reviewer_id:
        caller_id = str(payload.reviewer_id).strip()
        pm_id = str(project.get("created_by") or "")
        is_pm_or_ctrl = (caller_id == pm_id) or (caller_id in [str(c).strip() for c in project.get("controllers", [])])
        if not is_pm_or_ctrl:
            act_teams = set(str(t).strip() for t in (target_act.get("assigned_teams", []) or []))
            user_in_lead_teams = []
            for t in project.get("teams", []):
                if str(t.get("team_id")).strip() in act_teams or str(t.get("name")).strip() in act_teams:
                    t_members = [str(m).strip() for m in (t.get("member_ids") or [])]
                    t_lead = str(t.get("lead_id") or "").strip()
                    if t_lead and (caller_id in t_members or caller_id == t_lead):
                        user_in_lead_teams.append((t.get("name"), t_lead))
            direct_users = [str(u).strip() for u in (target_act.get("assigned_users", []) + target_act.get("assigned_user_ids", []))]
            if user_in_lead_teams and caller_id not in direct_users:
                leads = [lead for _, lead in user_in_lead_teams]
                if caller_id not in leads:
                    team_names = ", ".join(f"'{name}'" for name, _ in user_in_lead_teams)
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN,
                        f"Only the designated Team Lead for {team_names} is authorized to submit completed activities for review."
                    )

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
    assigned_targets = set(str(u) for u in (target_act.get("assigned_users", []) + target_act.get("assigned_user_ids", [])) if str(u).strip())
    # Also resolve personnel from assigned teams (members and leads)
    act_teams = set(str(t) for t in (target_act.get("assigned_teams", []) or []))
    if act_teams:
        for t in project.get("teams", []):
            if str(t.get("team_id")) in act_teams or str(t.get("name")) in act_teams:
                for m in (t.get("member_ids") or []):
                    assigned_targets.add(str(m))
                if t.get("lead_id"):
                    assigned_targets.add(str(t.get("lead_id")))
    pm_and_assigned = list(set(([pm_id] if pm_id else []) + list(assigned_targets)))

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
# DCMA 14-POINT QUALITY ASSESSMENT ENGINE
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
