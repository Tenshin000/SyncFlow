"""
SyncFlow - Projects Shared Utilities & Caching Layer (`backend/routers/projects_shared.py`).
Contains common MongoDB helpers, in-memory LRU cache, document formatters,
cycle detection DFS algorithm, and utility wrappers shared across project sub-routers.
"""
import copy
import math
import threading
from collections import OrderedDict
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import HTTPException, status

from backend.database.connection import get_db
from backend.models.project import ProjectSummary, ProjectDetail
from backend.utility import (
    build_id_query,
    parse_date,
    format_date,
    is_working_day,
    add_working_days,
    get_nearest_business_day,
    clean_mongo_doc,
    calculate_pert_statistics
)


# ==============================================================================
# DATABASE COLLECTION ACCESSORS
# ==============================================================================

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


# ==============================================================================
# IN-MEMORY LRU SCHEDULE CACHE
# ==============================================================================

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


# Aliases for utility functions
_clean_wbs_item = clean_mongo_doc
_is_working_day = is_working_day
_add_working_days = add_working_days
_get_nearest_business_day = get_nearest_business_day
_parse_date = parse_date
_fmt_dt = format_date


# ==============================================================================
# ACTIVITY HELPERS
# ==============================================================================

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


# ==============================================================================
# DOCUMENT PROJECTIONS & FORMATTERS
# ==============================================================================

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


def _format_summary(doc: Dict[str, Any]) -> ProjectSummary:
    """
    Formats a MongoDB project document into a lightweight ProjectSummary model.
    Aggregates distinct participating member counts across both direct assignments
    and configured team rosters for executive dashboard cards.
    """
    teams = doc.get("teams", [])
    members_set = set(str(u) for u in doc.get("assigned_user_ids", []))
    for t in teams:
        members_set.update(str(m) for m in t.get("member_ids", []))

    return ProjectSummary(
        id=str(doc.get("_id", "")),
        name=doc.get("name", "Untitled Project"),
        description=doc.get("description", ""),
        start_date=_fmt_dt(doc.get("start_date")) or None,
        created_by=str(doc.get("created_by") or ""),
        teams_count=len(teams),
        members_count=len(members_set),
        controllers_count=len(doc.get("controllers", [])),
        activities_count=len(doc.get("activities", [])),
        deliverables_count=len(doc.get("deliverables", [])),
        wbs_nodes_count=len(doc.get("wbs", [])),
        dependencies_count=len(doc.get("dependencies", [])),
        open_participation=bool(doc.get("open_participation", False)),
        allow_multiteam=bool(doc.get("allow_multiteam", False)),
        status=str(doc.get("status") or "in_progress"),
        created_at=_fmt_dt(doc.get("created_at")),
        updated_at=_fmt_dt(doc.get("updated_at"))
    )


def _format_detail(doc: Dict[str, Any]) -> ProjectDetail:
    """
    Formats a full MongoDB project document into the comprehensive ProjectDetail model.
    Maintains clean serialization for WBS trees, deliverables, activities, CPM dependencies,
    and assigned team rosters with designated Team Leads.
    """
    teams = [
        {
            "team_id": str(t.get("team_id") or ""),
            "name": t.get("name", ""),
            "member_ids": [str(m) for m in t.get("member_ids", [])],
            "lead_id": str(t.get("lead_id")) if t.get("lead_id") else None
        }
        for t in doc.get("teams", [])
    ]
    return ProjectDetail(
        id=str(doc.get("_id", "")),
        name=doc.get("name", ""),
        description=doc.get("description", ""),
        start_date=_fmt_dt(doc.get("start_date")) or None,
        created_by=str(doc.get("created_by") or ""),
        assigned_user_ids=[str(u) for u in doc.get("assigned_user_ids", [])],
        teams=teams,
        controllers=[str(c) for c in doc.get("controllers", [])],
        open_participation=bool(doc.get("open_participation", False)),
        allow_multiteam=bool(doc.get("allow_multiteam", False)),
        wbs=[_clean_wbs_item(n) for n in doc.get("wbs", [])],
        deliverables=[_clean_wbs_item(d) for d in doc.get("deliverables", [])],
        activities=[_clean_wbs_item(a) for a in doc.get("activities", [])],
        dependencies=doc.get("dependencies", []),
        schedule_settings=doc.get("schedule_settings"),
        status=str(doc.get("status") or "in_progress"),
        created_at=_fmt_dt(doc.get("created_at"), "%Y-%m-%d %H:%M"),
        updated_at=_fmt_dt(doc.get("updated_at"), "%Y-%m-%d %H:%M")
    )


# ==============================================================================
# TOPOLOGICAL INTEGRITY & CYCLE DETECTION
# ==============================================================================

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
