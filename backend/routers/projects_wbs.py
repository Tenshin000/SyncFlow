"""
SyncFlow - Projects WBS, Activities, Dependencies & Kickoff Router (`backend/routers/projects_wbs.py`).
Handles WBS tree structure, deliverables, activities CRUD, precedence dependencies with
cycle detection, and initial activity kickoff.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status

from backend.database.connection import get_db
from backend.models.project import (
    UpdateProjectWbsRequest,
    UpdateProjectDeliverablesRequest,
    UpdateProjectActivitiesRequest,
    UpdateProjectDependenciesRequest,
    ProjectDetail
)
from backend.utility import (
    build_id_query,
    calculate_pert_statistics
)
from backend.routers.projects_shared import (
    _projects_col,
    _get_project_doc,
    _clean_wbs_item,
    _format_detail,
    _detect_schedule_cycles,
    invalidate_project_schedule_cache
)

router = APIRouter(prefix="/syncflow/projects", tags=["projects"])

# ==============================================================================
# WORK BREAKDOWN STRUCTURE (WBS) & ACTIVITIES CRUD
# ==============================================================================

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
        if tech not in ("three_point", "parametric", "analogous", "single_point", "milestone"): tech = "three_point"

        def _flt(k, default=0.0):
            """Safely extracts a float value from the activity dictionary, returning a default on error or None."""
            try: return float(act.get(k)) if act.get(k) is not None else default
            except (ValueError, TypeError): return default

        a, m, b = _flt("optimistic", 3.0), _flt("most_likely", 5.0), _flt("pessimistic", 9.0)
        p_rate, p_qty = (_flt("parametric_rate", None) if act.get("parametric_rate") is not None else None), (_flt("parametric_quantity", None) if act.get("parametric_quantity") is not None else None)
        ana_actual_dur = _flt("analogous_actual_duration", None) if act.get("analogous_actual_duration") is not None else None
        is_milestone = bool(act.get("is_milestone") or tech == "milestone")

        if is_milestone:
            tech = "milestone"
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



# ==============================================================================
# PDM PRECEDENCE DEPENDENCIES CRUD
# ==============================================================================
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
        cycle_str = " âž” ".join(cycle)
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

from backend.routers.projects_shared import _parse_date

# ==============================================================================
# PROJECT KICKOFF & WIP TRANSITION
# ==============================================================================
@router.post("/{project_id}/kickoff")
def kickoff_project(project_id: str):
    """
    Officially starts project execution.
    Transitions initial activities (activities with in-degree 0 in the CPM network,
    or the first sequential activity) from 'not_started' to 'in_progress' (WIP).
    Sets their actual_start_date to today.
    Once a task is in WIP, it cannot be reverted to not_started.
    """
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    activities = project.get("activities", [])
    if not activities:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Project has no activities to kick off.")

    # Check if already kicked off
    already_wip_or_done = [a for a in activities if a.get("status") in ["in_progress", "completed", "verified"]]
    if already_wip_or_done:
        return {
            "status": "already_started",
            "message": "Project execution has already begun.",
            "kicked_off_activities": [a.get("activity_id") for a in already_wip_or_done],
            "project": _format_detail(project)
        }

    # Find initial activities using CPM dependencies (predecessors)
    dependencies = project.get("dependencies", [])
    has_preds = set()
    for dep in dependencies:
        to_id = str(dep.get("to_activity_id") or dep.get("to") or "").strip()
        if to_id:
            has_preds.add(to_id)

    initial_acts = [a for a in activities if a.get("activity_id") not in has_preds]
    if not initial_acts:
        initial_acts = [activities[0]]

    now = datetime.utcnow()
    now_date_str = now.strftime("%Y-%m-%d")
    kicked_off_ids = []

    for a in initial_acts:
        a["status"] = "in_progress"
        if not a.get("actual_start_date"):
            a["actual_start_date"] = now_date_str
        if not a.get("progress_pct") or a.get("progress_pct") == 0:
            a["progress_pct"] = 5.0
        kicked_off_ids.append(a.get("activity_id"))

    updated = col.find_one_and_update(
        {"_id": project["_id"]},
        {"$set": {"activities": activities, "status": "in_progress", "updated_at": now}},
        return_document=True
    )

    invalidate_project_schedule_cache(str(project["_id"]))

    pm_id = str(project.get("created_by") or "")
    proj_name = project.get("name", "Project")
    db["notifications"].insert_one({
        "project_id": str(project["_id"]),
        "project_name": proj_name,
        "title": f"ðŸš€ Project Kicked Off: {proj_name}",
        "message": f"Project execution has officially started! Initial task(s) [{', '.join(kicked_off_ids)}] moved to Work in Progress (WIP).",
        "type": "project_update",
        "to_all": True,
        "to_pm": True,
        "recipient_teams": [],
        "recipient_users": [],
        "sender_id": pm_id,
        "sender_name": "Project Manager",
        "read_by": [],
        "data": {
            "event": "project_kickoff",
            "kicked_off_activities": kicked_off_ids
        },
        "created_at": now
    })

    return {
        "status": "started",
        "message": f"Project successfully started! Activity/activities {', '.join(kicked_off_ids)} moved to Work in Progress (WIP).",
        "kicked_off_activities": kicked_off_ids,
        "project": _format_detail(updated)
    }
