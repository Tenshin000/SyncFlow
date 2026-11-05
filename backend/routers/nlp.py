"""
SyncFlow - AI NLP Router (`/syncflow/projects/{id}/nlp`).
Exposes Google Gemini Flash Text-to-WBS decomposition, DCMA 14-Point PERT estimating,
and Precedence Dependency Extraction with strict JSON Schema constrained decoding.
"""
import re
from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status, Query, Body

from backend.database.connection import get_db
from backend.routers.projects import (
    _projects_col,
    _get_project_doc,
    _format_detail,
    invalidate_project_schedule_cache,
    _detect_schedule_cycles
)
from backend.utility import calculate_pert_statistics

from backend.nlp.gemini_client import (
    GeminiClient,
    resolve_gemini_api_key,
    verify_gemini_key,
    _enforce_pert_strict_ordering
)
from backend.nlp.schemas import (
    TextToWBSRequest,
    EstimateDurationsRequest,
    ExtractDependenciesRequest,
    AIWbsDecompositionOutput,
    AIEstimationOutput,
    AIDependencyExtractionOutput
)
from backend.nlp.prompts import (
    WBS_SYSTEM_INSTRUCTION,
    ESTIMATION_SYSTEM_INSTRUCTION,
    DEPENDENCY_SYSTEM_INSTRUCTION,
    build_wbs_prompt,
    build_estimation_prompt,
    build_dependency_prompt
)

router = APIRouter(prefix="/syncflow", tags=["AI & NLP Engine"])


# ==============================================================================
# KEY VERIFICATION & AVAILABLE MODELS ENDPOINTS
# ==============================================================================
@router.get("/nlp/models")
def get_available_models():
    """Returns the strictly allowed Google Gemini models ('gemini-flash-latest' and 'gemini-flash-lite-latest')."""
    return {
        "models": ["gemini-flash-latest", "gemini-flash-lite-latest"],
        "default": "gemini-flash-latest"
    }


@router.post("/nlp/verify-key")
def check_api_key(payload: Dict[str, Any] = Body(...)):
    """Verifies whether the provided or configured Gemini API key is valid."""
    key = payload.get("api_key")
    resolved = resolve_gemini_api_key(key)
    if not resolved:
        return {"valid": False, "message": "No Google Gemini API key found."}

    is_valid = verify_gemini_key(resolved)
    return {
        "valid": is_valid,
        "message": "API key verified successfully with Google Gemini (gemini-flash-latest / gemini-flash-lite-latest)." if is_valid else "Invalid or restricted API key."
    }


# ==============================================================================
# 1. TEXT-TO-WBS DECOMPOSITION
# ==============================================================================
@router.post("/projects/{project_id}/nlp/text-to-wbs")
def generate_wbs_from_text(project_id: str, payload: TextToWBSRequest):
    """
    Ingests unstructured project charter/scope text, decomposes it into a multi-tier WBS
    (Deliverables -> Work Packages -> Activities -> Tasks -> Operations),
    validates the output using constrained decoding, and inserts it into MongoDB.
    Supports 'merge' (smart append with sequential IDs) and 'replace' modes.
    """
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    if payload.model and payload.model not in ["gemini-flash-latest", "gemini-flash-lite-latest"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Model '{payload.model}' is not supported. The system is strictly configured to use only 'gemini-flash-latest' and 'gemini-flash-lite-latest'."
        )

    if payload.model and payload.model not in ["gemini-flash-latest", "gemini-flash-lite-latest"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Model '{payload.model}' is not supported. The system is strictly configured to use only 'gemini-flash-latest' and 'gemini-flash-lite-latest'."
        )

    proj_name = project.get("name", "Project")
    proj_desc = project.get("description", "")
    existing_wbs = project.get("wbs", [])
    existing_acts = project.get("activities", [])
    existing_deliverables = project.get("deliverables", [])

    # 1. Build context-rich prompt and invoke Gemini Flash with strict schema
    try:
        client = GeminiClient(payload.api_key, model=payload.model)
        prompt = build_wbs_prompt(
            project_name=proj_name,
            project_description=proj_desc,
            scope_text=payload.scope_text,
            custom_prompt=payload.custom_prompt,
            existing_wbs=existing_wbs if payload.mode == "merge" else None
        )
        ai_output: AIWbsDecompositionOutput = client.generate_structured(
            prompt=prompt,
            system_instruction=WBS_SYSTEM_INSTRUCTION,
            response_schema=AIWbsDecompositionOutput,
            temperature=0.2
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    # 2. Smart ID Generation & Merge Strategy
    now = datetime.utcnow()
    mode = payload.mode.lower().strip()

    if mode == "merge" and (existing_wbs or existing_acts):
        # Calculate max deliverable index
        max_del_num = 0
        for d in existing_wbs:
            w_str = str(d.get("wbs_number", "")).split(".")[-1]
            try:
                max_del_num = max(max_del_num, int(w_str))
            except ValueError:
                pass
        del_offset = max(max_del_num, len(existing_wbs))

        new_wbs = list(existing_wbs)
        new_deliverables = list(existing_deliverables)
        new_activities = list(existing_acts)
    else:
        # Replace mode or starting fresh on empty project
        del_offset = 0
        new_wbs = []
        new_deliverables = []
        new_activities = []

    # Map AI deliverables and work packages to clean database schemas
    wp_id_map = {}
    total_new_acts = 0

    for d_idx, d_item in enumerate(ai_output.major_deliverables):
        del_num = del_offset + d_idx + 1
        del_id = f"DEL-{del_num}"
        del_name = d_item.name.strip()
        del_desc = d_item.description.strip()

        # Guardrail against generic deliverable titles (e.g. "Deliverable 1", "Derivable 1")
        if not del_name or re.match(r"^(deliverable|derivable|deliv|major deliverable|level 2|phase)\s*\d*$", del_name, re.I):
            wp_names = [
                wp.name.strip() for wp in d_item.work_packages 
                if wp.name and not re.match(r"^(work package|wp|package)\s*[\d\.]*$", wp.name, re.I)
            ]
            if wp_names:
                del_name = f"{wp_names[0]} & Core Services" if len(wp_names) == 1 else f"{wp_names[0]} & {wp_names[1]}"
            else:
                del_name = f"Core Solution Domain {del_num}"

        if not del_desc or re.match(r"^(deliverable|derivable|deliv|phase)\s*\d*$", del_desc, re.I):
            del_desc = f"Major deliverable encompasses {del_name.lower()} components and associated implementation work packages."

        wp_children = []
        sub_deliverable_wps = []

        for wp_idx, wp_item in enumerate(d_item.work_packages):
            wp_num = f"{del_num}.{wp_idx + 1}"
            wp_id = f"WP-{wp_num}"
            wp_name = wp_item.name.strip()
            wp_desc = wp_item.description.strip()

            wp_id_map[wp_item.wbs_number] = wp_id
            wp_id_map[wp_num] = wp_id
            wp_id_map[str(wp_idx + 1)] = wp_id

            wp_children.append({
                "id": wp_id,
                "wbs_number": wp_num,
                "name": wp_name,
                "description": wp_desc,
                "type": "work_package",
                "children": []
            })

            sub_deliverable_wps.append({
                "work_package_id": wp_id,
                "name": wp_name,
                "description": wp_desc
            })

        new_wbs.append({
            "id": del_id,
            "wbs_number": str(del_num),
            "name": del_name,
            "description": del_desc,
            "type": "major_deliverable",
            "children": wp_children
        })

        new_deliverables.append({
            "deliverable_id": del_id,
            "name": del_name,
            "description": del_desc,
            "sub_deliverables": [
                {
                    "sub_deliverable_id": f"SUB-{del_num}.1",
                    "name": f"{del_name} Core Packages",
                    "work_packages": sub_deliverable_wps
                }
            ]
        })

    # Map AI activities and compute DCMA-compliant PERT parameters
    # Collect all activities from both work packages and root level
    all_activities_source = []
    seen_act_names = set()

    for d_item in ai_output.major_deliverables:
        for wp_item in d_item.work_packages:
            wp_num = wp_item.wbs_number
            for act in getattr(wp_item, "activities", []) or []:
                act_name = act.name.strip()
                if act_name not in seen_act_names:
                    seen_act_names.add(act_name)
                    if not getattr(act, "work_package_ref", None):
                        act.work_package_ref = wp_num
                    all_activities_source.append(act)

    for act in ai_output.activities or []:
        act_name = act.name.strip()
        if act_name not in seen_act_names:
            seen_act_names.add(act_name)
            all_activities_source.append(act)

    for a_idx, act_item in enumerate(all_activities_source):
        # Resolve work package ID
        wp_ref = (act_item.work_package_ref or "").strip()
        matched_wp = wp_id_map.get(wp_ref)
        if not matched_wp and wp_id_map:
            matched_wp = list(wp_id_map.values())[a_idx % len(wp_id_map)]
        else:
            matched_wp = matched_wp or f"WP-{del_offset + 1}.1"

        clean_wp_suffix = matched_wp.replace("WP-", "")
        act_id = f"ACT-{clean_wp_suffix}.{a_idx + 1}"

        opt, ml, pess = _enforce_pert_strict_ordering(
            act_item.optimistic_days,
            act_item.most_likely_days,
            act_item.pessimistic_days
        )
        exp_d, std_dev, var = calculate_pert_statistics(opt, ml, pess)

        # Build child tasks and operations
        formatted_tasks = []
        raw_tasks = getattr(act_item, "tasks", []) or []
        for t_idx, t_item in enumerate(raw_tasks):
            t_id = f"TASK-{act_id}-{t_idx + 1}"
            if isinstance(t_item, str):
                t_name = t_item.strip()
                t_desc = f"Execution step: {t_name}"
                ops = [
                    {
                        "operation_id": f"OP-{t_id}-1",
                        "name": f"Perform {t_name}",
                        "description": "Standard operational step",
                        "status": "Not Started"
                    }
                ]
            elif hasattr(t_item, "name"):
                t_name = t_item.name.strip()
                t_desc = getattr(t_item, "description", "").strip() or f"Execution step: {t_name}"
                raw_ops = getattr(t_item, "operations", []) or []
                ops = [
                    {
                        "operation_id": f"OP-{t_id}-{o_idx + 1}",
                        "name": getattr(o, "name", str(o)).strip(),
                        "description": getattr(o, "description", "").strip(),
                        "status": "Not Started"
                    }
                    for o_idx, o in enumerate(raw_ops)
                ]
            elif isinstance(t_item, dict):
                t_name = str(t_item.get("name") or f"Task {t_idx + 1}").strip()
                t_desc = str(t_item.get("description") or f"Execution step: {t_name}").strip()
                raw_ops = t_item.get("operations") or []
                ops = [
                    {
                        "operation_id": f"OP-{t_id}-{o_idx + 1}",
                        "name": (o.get("name") if isinstance(o, dict) else str(o)).strip(),
                        "description": (o.get("description") if isinstance(o, dict) else "").strip(),
                        "status": "Not Started"
                    }
                    for o_idx, o in enumerate(raw_ops)
                ]
            else:
                t_name = str(t_item).strip()
                t_desc = ""
                ops = []

            if not ops:
                ops = [
                    {
                        "operation_id": f"OP-{t_id}-1",
                        "name": f"Perform {t_name}",
                        "description": "Standard operational step",
                        "status": "Not Started"
                    }
                ]

            formatted_tasks.append({
                "task_id": t_id,
                "name": t_name,
                "description": t_desc,
                "status": "not_started",
                "operations": ops
            })

        if not formatted_tasks:
            t_id = f"TASK-{act_id}-1"
            formatted_tasks.append({
                "task_id": t_id,
                "name": f"Execution of {act_item.name.strip()}",
                "description": act_item.description.strip(),
                "status": "not_started",
                "operations": [
                    {
                        "operation_id": f"OP-{t_id}-1",
                        "name": f"Implementation of {act_item.name.strip()}",
                        "description": "Core technical execution",
                        "status": "Not Started"
                    }
                ]
            })

        new_activities.append({
            "activity_id": act_id,
            "work_package_id": matched_wp,
            "name": act_item.name.strip(),
            "description": act_item.description.strip(),
            "is_milestone": act_item.is_milestone,
            "estimation_technique": "three_point",
            "optimistic": opt,
            "most_likely": ml,
            "pessimistic": pess,
            "duration": exp_d if not act_item.is_milestone else 0.0,
            "expected_time": exp_d if not act_item.is_milestone else 0.0,
            "std_dev": std_dev,
            "variance": var,
            "status": "not_started",
            "progress_pct": 0.0,
            "assigned_teams": [],
            "assigned_users": [],
            "tasks": formatted_tasks,
            "notes": f"Generated via Google Gemini Flash (DCMA 14-Point Compliant: a={opt}d, m={ml}d, b={pess}d)."
        })
        total_new_acts += 1

    # 3. Atomic Database Update & Cache Eviction
    update_data = {
        "wbs": new_wbs,
        "deliverables": new_deliverables,
        "activities": new_activities,
        "updated_at": now
    }
    if mode == "replace":
        update_data["dependencies"] = []

    updated = col.find_one_and_update(
        {"_id": project["_id"]},
        {"$set": update_data},
        return_document=True
    )

    invalidate_project_schedule_cache(str(updated["_id"]))

    return _format_detail(updated)


# ==============================================================================
# 2. DCMA 14-POINT DURATION ESTIMATION
# ==============================================================================
@router.post("/projects/{project_id}/nlp/estimate-durations")
def estimate_activity_durations(project_id: str, payload: EstimateDurationsRequest):
    """
    Evaluates project activities lacking durations or PERT parameters,
    uses Gemini 1.5 Flash with constrained decoding to compute DCMA 14-Point compliant
    (a, m, b) estimates (<= 44 business days, beta distribution), and updates MongoDB.
    """
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    if payload.model and payload.model not in ["gemini-flash-latest", "gemini-flash-lite-latest"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Model '{payload.model}' is not supported. The system is strictly configured to use only 'gemini-flash-latest' and 'gemini-flash-lite-latest'."
        )

    activities = project.get("activities", [])
    if not activities:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Project has no activities to estimate.")

    # Filter target activities
    targets = []
    target_ids = set(payload.target_activity_ids or [])
    for act in activities:
        aid = act.get("activity_id")
        if target_ids:
            if aid in target_ids:
                targets.append(act)
        else:
            # Automatic mode: select activities with missing or default durations
            opt = act.get("optimistic")
            pess = act.get("pessimistic")
            dur = act.get("duration")
            if not opt or not pess or dur in [None, 0.0, 5.0]:
                targets.append(act)

    if not targets:
        # If all activities are already estimated, estimate all as requested
        targets = activities

    try:
        client = GeminiClient(payload.api_key, model=payload.model)
        prompt = build_estimation_prompt(
            project_name=project.get("name", "Project"),
            project_description=project.get("description", ""),
            activities=targets,
            custom_prompt=payload.custom_prompt
        )
        ai_output: AIEstimationOutput = client.generate_structured(
            prompt=prompt,
            system_instruction=ESTIMATION_SYSTEM_INSTRUCTION,
            response_schema=AIEstimationOutput,
            temperature=0.2
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    # Update activities in-memory and enforce DCMA constraints
    estimates_map = {e.activity_id: e for e in ai_output.estimates}
    updated_count = 0

    for act in activities:
        aid = act.get("activity_id")
        est = estimates_map.get(aid)
        if est:
            opt, ml, pess = _enforce_pert_strict_ordering(est.optimistic, est.most_likely, est.pessimistic)
            exp_d, std_dev, var = calculate_pert_statistics(opt, ml, pess)


            act["estimation_technique"] = "three_point"
            act["optimistic"] = opt
            act["most_likely"] = ml
            act["pessimistic"] = pess
            act["duration"] = exp_d if not act.get("is_milestone") else 0.0
            act["expected_time"] = exp_d if not act.get("is_milestone") else 0.0
            act["std_dev"] = std_dev
            act["variance"] = var
            act["notes"] = f"DCMA 14-Point PERT Estimate: {est.rationale.strip()}"
            updated_count += 1

    now = datetime.utcnow()
    updated = col.find_one_and_update(
        {"_id": project["_id"]},
        {
            "$set": {
                "activities": activities,
                "updated_at": now
            }
        },
        return_document=True
    )

    invalidate_project_schedule_cache(str(updated["_id"]))

    return {
        "success": True,
        "message": f"Successfully calculated DCMA-compliant PERT estimates for {updated_count} activities.",
        "estimated_count": updated_count,
        "project": _format_detail(updated)
    }


# ==============================================================================
# 3. PRECEDENCE DEPENDENCY EXTRACTION
# ==============================================================================
@router.post("/projects/{project_id}/nlp/extract-dependencies")
def extract_project_dependencies(project_id: str, payload: ExtractDependenciesRequest):
    """
    Extracts precedence relationships (FS, SS, FF, SF) and non-negative lags between activities
    using Gemini 1.5 Flash, validates against circular loops via Kahn's algorithm, and updates MongoDB.
    """
    col = _projects_col()
    db = get_db()
    project = _get_project_doc(project_id, col)

    if payload.model and payload.model not in ["gemini-flash-latest", "gemini-flash-lite-latest"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Model '{payload.model}' is not supported. The system is strictly configured to use only 'gemini-flash-latest' and 'gemini-flash-lite-latest'."
        )

    activities = project.get("activities", [])
    if len(activities) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least 2 activities are required to establish dependencies.")

    valid_act_ids = {str(a.get("activity_id")) for a in activities if a.get("activity_id")}

    try:
        client = GeminiClient(payload.api_key, model=payload.model)
        prompt = build_dependency_prompt(
            project_name=project.get("name", "Project"),
            project_description=project.get("description", ""),
            activities=activities,
            narrative_text=payload.get_narrative(),
            custom_prompt=payload.custom_prompt
        )
        ai_output: AIDependencyExtractionOutput = client.generate_structured(
            prompt=prompt,
            system_instruction=DEPENDENCY_SYSTEM_INSTRUCTION,
            response_schema=AIDependencyExtractionOutput,
            temperature=0.2
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    # Validate extracted dependencies
    validated_deps = []
    edges_for_cycle_check = []
    seen_pairs = set()

    for idx, dep in enumerate(ai_output.dependencies):
        u = dep.from_activity_id.strip()
        v = dep.to_activity_id.strip()

        # Rule 1: No self-dependencies
        if u == v:
            continue

        # Rule 2: References must exist in project
        if u not in valid_act_ids or v not in valid_act_ids:
            continue

        # Rule 3: Avoid duplicate edges
        pair = (u, v)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        rel_type = dep.type.strip().upper()
        if rel_type not in ["FS", "SS", "FF", "SF"]:
            rel_type = "FS"

        lag = max(0.0, float(dep.lag_days))

        validated_deps.append({
            "dependency_id": f"DEP-{idx+1:03d}",
            "from_activity_id": u,
            "to_activity_id": v,
            "type": rel_type,
            "lag_days": lag,
            "description": dep.description.strip() or f"Logical dependency {u} -> {v} ({rel_type})"
        })
        edges_for_cycle_check.append({"from": u, "to": v})

    # Rule 4: Cycle detection
    cycle = _detect_schedule_cycles(list(valid_act_ids), edges_for_cycle_check)
    if cycle:
        cycle_str = " -> ".join(cycle)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Precedence logic error: AI generated a circular loop ({cycle_str}). Please adjust your prompt and retry."
        )

    now = datetime.utcnow()
    updated = col.find_one_and_update(
        {"_id": project["_id"]},
        {
            "$set": {
                "dependencies": validated_deps,
                "updated_at": now
            }
        },
        return_document=True
    )

    invalidate_project_schedule_cache(str(updated["_id"]))

    return {
        "success": True,
        "message": f"Successfully extracted and validated {len(validated_deps)} precedence relationships.",
        "dependencies_count": len(validated_deps),
        "dependencies": validated_deps,
        "project": _format_detail(updated)
    }
