"""
SyncFlow - Projects Schedule Router (`backend/routers/projects_schedule.py`).
Implements PMBOK Process 6.5 (Develop Schedule), Critical Path Method (CPM)
forward/backward passes, PERT Beta probability modeling, AON/AOA graph generation,
schedule health diagnostics, and Planned Baseline management.
"""
import copy
import math
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query

from backend.database.connection import get_db
from backend.models.project import (
    UpdateScheduleSettingsRequest,
    CreateBaselineRequest
)
from backend.routers.projects_shared import (
    _projects_col,
    _get_project_doc,
    _CACHE_LOCK,
    _COMPREHENSIVE_SCHEDULE_CACHE,
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
    _detect_schedule_cycles
)

router = APIRouter(prefix="/syncflow/projects", tags=["Projects Schedule"])


# ==============================================================================
# SCHEDULE HEALTH EVALUATION ENGINE
# ==============================================================================

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


# ==============================================================================
# CRITICAL PATH METHOD (CPM) & PERT CALCULATION ENGINE
# ==============================================================================

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
                "critical_ratio_pct": 0.0,
                "planned_start_date": start_date.strftime("%Y-%m-%d"),
                "planned_finish_date": start_date.strftime("%Y-%m-%d"),
                "planned_duration_days": 0.0,
                "imposed_deadline_days": 0.0,
                "imposed_deadline_date": start_date.strftime("%Y-%m-%d"),
                "project_float_days": 0.0,
                "project_float_calendar_days": 0,
                "project_float_status": "Aligned",
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

    # Project Float = Imposed Deadline - Planned Finish Date
    # Positive: project has schedule cushion before external milestone
    # Negative: project is in breach of deadline!
    project_float = round(imp_days - project_finish, 1)
    cal_days_gap = (imp_date - planned_finish_date).days if (imp_date and planned_finish_date) else int(project_float)

    if project_float > 0.05:
        p_float_status = "Positive Buffer"
    elif project_float < -0.05:
        p_float_status = "Negative Slack"
    else:
        p_float_status = "Aligned"

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
        "planned_finish_date": planned_finish_date.strftime("%Y-%m-%d") if planned_finish_date else "-",
        "planned_duration_days": round(project_finish, 1),
        "imposed_deadline_days": round(imp_days, 1),
        "imposed_deadline_date": imp_date.strftime("%Y-%m-%d") if imp_date else "-",
        "project_float_days": project_float,
        "project_float_calendar_days": cal_days_gap,
        "project_float_status": p_float_status,
        "near_critical_threshold_days": near_critical_threshold
    }

    return {
        "summary": summary_data,
        "critical_path_ids": critical_ids,
        "near_critical_ids": near_critical_ids,
        "expected_duration_mu": round(mu, 1),
        "variance_path": round(var_path, 2),
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


# ==============================================================================
# SCHEDULE ENDPOINTS
# ==============================================================================

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


# ==============================================================================
# PLANNED BASELINE ENDPOINTS
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
