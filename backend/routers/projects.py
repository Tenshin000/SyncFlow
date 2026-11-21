"""
SyncFlow - Projects API Facade Router (`backend/routers/projects.py`).
Aggregates and re-exports sub-routers:
  - backend.routers.projects_shared   (Helpers, cache, projections, and cycle detection)
  - backend.routers.projects_core     (Charter, description, personnel, search, join)
  - backend.routers.projects_wbs      (WBS, activities, dependencies, kickoff)
  - backend.routers.projects_schedule (CPM forward/backward passes, PERT, health, baselines)
  - backend.routers.projects_control  (EVM KPIs, S-Curve Banana Envelope, DCMA audit)
  - backend.routers.projects_timers   (Stopwatch tracking, time logs CRUD & reporting)

Maintains full backwards compatibility for all existing imports across the application.
"""
from fastapi import APIRouter

# Re-export all shared utilities and formatters
from backend.routers.projects_shared import (
    _projects_col,
    _get_project_doc,
    _CACHE_LOCK,
    _COMPREHENSIVE_SCHEDULE_CACHE,
    _CONTROL_SCHEDULE_CACHE,
    _MAX_CACHE_ENTRIES,
    _get_schedule_cache_key,
    invalidate_project_schedule_cache,
    _clean_wbs_item,
    _is_working_day,
    _add_working_days,
    _get_nearest_business_day,
    _parse_date,
    _fmt_dt,
    _get_act_duration,
    SUMMARY_PROJECTION,
    _format_summary,
    _format_detail,
    _detect_schedule_cycles
)

# Re-export core endpoints and processing helpers
from backend.routers.projects_core import (
    router as projects_core_router,
    list_projects,
    get_completed_activities,
    get_project,
    create_project,
    update_project_description,
    update_project_personnel,
    search_available_projects,
    join_project,
)

# Re-export WBS, activities, dependencies, and kickoff endpoints
from backend.routers.projects_wbs import (
    router as projects_wbs_router,
    _process_activities_payload,
    _process_wbs_node,
    _process_wbs_payload,
    update_project_wbs,
    update_project_deliverables,
    update_project_activities,
    delete_project,
    update_project_dependencies,
    kickoff_project
)

# Re-export schedule endpoints and CPM calculation functions
from backend.routers.projects_schedule import (
    router as projects_schedule_router,
    _evaluate_schedule_health,
    get_project_schedule_health,
    _calculate_comprehensive_schedule,
    get_cached_comprehensive_schedule,
    _calculate_pert_critical_path,
    get_project_schedule,
    update_project_schedule_settings,
    get_project_pert_analysis,
    create_project_baseline,
    list_project_baselines,
    delete_project_baseline
)

# Re-export control endpoints and EVM / DCMA functions
from backend.routers.projects_control import (
    router as projects_control_router,
    _calculate_control_schedule,
    get_cached_control_schedule,
    get_control_schedule,
    update_activity_execution_status,
    seed_realistic_activity_progress,
    get_dcma_quality_audit
)

# Re-export timer endpoints and assignment evaluation
from backend.routers.projects_timers import (
    router as projects_timers_router,
    _is_user_assigned_to_activity,
    start_activity_timer,
    stop_activity_timer,
    get_activity_time_logs,
    get_project_time_logs_summary,
    update_activity_time_log,
    delete_activity_time_log,
    get_user_project_time_logs
)

# Aggregate master router for backend/user.py inclusion
router = APIRouter()
router.include_router(projects_core_router)
router.include_router(projects_wbs_router)
router.include_router(projects_schedule_router)
router.include_router(projects_control_router)
router.include_router(projects_timers_router)
