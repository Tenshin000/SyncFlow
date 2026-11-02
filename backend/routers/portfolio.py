"""
SyncFlow – Multi-Project Executive Portfolio Router (`/syncflow/portfolio`).
Provides enterprise-wide aggregate health, Schedule Variance (SV),
Schedule Performance Index (SPI), milestone completion, and critical delay diagnostics.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query

from backend.database.connection import get_db
from backend.routers.projects import _calculate_control_schedule, _calculate_comprehensive_schedule
from backend.utility import build_id_query

router = APIRouter(prefix="/syncflow/portfolio", tags=["Executive Portfolio"])


def _projects_col():
    return get_db()["projects"]


def _users_col():
    return get_db()["users"]


@router.get("/dashboard")
def get_portfolio_dashboard(user_id: Optional[str] = Query(None)):
    """
    Returns aggregate executive dashboard metrics across all accessible projects.
    Computes total portfolio PV, EV, SV, overall SPI, cross-project health matrices,
    milestone progress, and critical delay alerts.
    """
    col = _projects_col()
    users_col = _users_col()

    # Determine requesting user's role
    current_user = users_col.find_one(build_id_query(user_id)) if user_id else None


    is_pm = bool(current_user and current_user.get("role") == "Project Manager")

    # Fetch projects: if PM, all projects; otherwise projects user participates in
    query = {}
    if not is_pm and user_id:
        query = {
            "$or": [
                {"created_by": user_id},
                {"assigned_user_ids": user_id},
                {"controllers": user_id},
                {"teams.member_ids": user_id},
                {"teams.lead_id": user_id}
            ]
        }

    projects_cursor = col.find(query).sort("created_at", -1)
    projects_list = list(projects_cursor)

    portfolio_pv = 0.0
    portfolio_ev = 0.0
    total_activities_count = 0
    total_milestones_count = 0
    total_milestones_completed = 0

    status_totals = {
        "not_started": 0,
        "in_progress": 0,
        "completed": 0,
        "verified": 0
    }

    health_totals = {
        "on_track": 0,
        "at_risk": 0,
        "critical": 0
    }

    project_summaries = []
    critical_alerts = []

    for proj in projects_list:
        pid = str(proj["_id"])
        p_name = proj.get("name", "Untitled Project")
        p_desc = proj.get("description", "")
        p_start = proj.get("start_date", "-")

        # Compute or fetch control schedule
        try:
            ctrl = _calculate_control_schedule(proj)
            kpis = ctrl.get("kpis", {})
            activities = ctrl.get("activities", [])
        except Exception:
            kpis = {"pv_days": 0.0, "ev_days": 0.0, "sv_days": 0.0, "spi": 1.0}
            activities = proj.get("activities", [])

        pv = round(float(kpis.get("pv_days", 0.0)), 1)
        ev = round(float(kpis.get("ev_days", 0.0)), 1)
        sv = round(float(kpis.get("sv_days", 0.0)), 1)
        spi = round(float(kpis.get("spi", 1.0)), 2)

        portfolio_pv += pv
        portfolio_ev += ev

        # Activity & Milestone metrics
        p_status_counts = {"not_started": 0, "in_progress": 0, "completed": 0, "verified": 0}
        p_milestones_total = 0
        p_milestones_done = 0
        p_crit_slipping = 0

        for a in activities:
            st = a.get("status", "not_started")
            if st not in p_status_counts:
                st = "not_started"
            p_status_counts[st] += 1
            status_totals[st] += 1
            total_activities_count += 1

            is_m = bool(a.get("is_milestone") or a.get("duration") == 0)
            if is_m:
                p_milestones_total += 1
                total_milestones_count += 1
                if st == "verified":
                    p_milestones_done += 1
                    total_milestones_completed += 1

            if a.get("is_critical") and (a.get("sv_days", 0.0) < -0.5 or (st == "in_progress" and a.get("sv_days", 0.0) < 0)):
                p_crit_slipping += 1

        total_p_acts = len(activities)
        verified_count = p_status_counts["verified"]
        pct_complete = round((verified_count / total_p_acts) * 100.0, 1) if total_p_acts > 0 else 0.0

        # Health Classification
        if spi < 0.85 or sv < -15.0 or p_crit_slipping >= 2:
            health = "critical"
            health_totals["critical"] += 1
            critical_alerts.append({
                "project_id": pid,
                "project_name": p_name,
                "severity": "high",
                "message": f"Critical schedule slippage: SPI is {spi:.2f} (SV: {sv:+.1f}d), with {p_crit_slipping} critical path activities delayed."
            })
        elif spi < 0.95 or sv < -3.0 or p_crit_slipping > 0:
            health = "at_risk"
            health_totals["at_risk"] += 1
            critical_alerts.append({
                "project_id": pid,
                "project_name": p_name,
                "severity": "medium",
                "message": f"Schedule warning: SPI is {spi:.2f} (SV: {sv:+.1f}d). Monitor upcoming critical path handoffs."
            })
        else:
            health = "on_track"
            health_totals["on_track"] += 1

        project_summaries.append({
            "project_id": pid,
            "name": p_name,
            "description": p_desc,
            "start_date": p_start,
            "health": health,
            "pv_days": pv,
            "ev_days": ev,
            "sv_days": sv,
            "spi": spi,
            "progress_pct": pct_complete,
            "total_activities": total_p_acts,
            "status_counts": p_status_counts,
            "milestones_total": p_milestones_total,
            "milestones_completed": p_milestones_done,
            "critical_slipping_count": p_crit_slipping
        })

    # Portfolio-wide aggregates
    portfolio_sv = round(portfolio_ev - portfolio_pv, 1)
    portfolio_spi = round(portfolio_ev / portfolio_pv, 2) if portfolio_pv > 0 else 1.0

    return {
        "portfolio_summary": {
            "total_projects": len(projects_list),
            "total_activities": total_activities_count,
            "portfolio_pv_days": round(portfolio_pv, 1),
            "portfolio_ev_days": round(portfolio_ev, 1),
            "portfolio_sv_days": portfolio_sv,
            "portfolio_spi": portfolio_spi,
            "status_totals": status_totals,
            "health_totals": health_totals,
            "milestones": {
                "total": total_milestones_count,
                "completed": total_milestones_completed,
                "pct": round((total_milestones_completed / total_milestones_count) * 100.0, 1) if total_milestones_count > 0 else 0.0
            }
        },
        "critical_alerts": critical_alerts,
        "projects": project_summaries
    }
