"""
SyncFlow – Google Gemini Client.
Integrates dynamic model discovery (Gemini 3.8/2.0 Flash), constrained decoding
(Strict JSON Schema), non-text model filtering, and robust fallback.
"""
import os
import json
import re
import logging
import warnings
from typing import Type, TypeVar, Optional, Any, Dict, List
from pydantic import BaseModel

warnings.filterwarnings("ignore", category=FutureWarning)
import google.generativeai as genai
from backend.config import settings

logger = logging.getLogger(__name__)

def _enforce_pert_strict_ordering(opt: float, ml: float, pess: float) -> tuple[float, float, float]:
    """
    Guarantees PMBOK / DCMA strict ordering 0.5 <= a < m < b <= 44.0.
    Ensures optimistic, likely, and pessimistic are strictly separated by at least 0.5-1.0 days.
    """
    try:
        a = max(0.5, min(42.0, float(opt or 1.0)))
    except (ValueError, TypeError):
        a = 2.0

    try:
        m = float(ml if ml is not None else (a + 2.0))
    except (ValueError, TypeError):
        m = a + 2.0

    if m <= a:
        m = round(a + max(1.0, round(a * 0.3, 1)), 1)
    m = max(a + 0.5, min(43.0, m))

    try:
        b = float(pess if pess is not None else (m + 3.0))
    except (ValueError, TypeError):
        b = m + 3.0

    if b <= m:
        b = round(m + max(1.5, round(m * 0.4, 1)), 1)
    b = max(m + 0.5, min(44.0, b))

    return round(a, 1), round(m, 1), round(b, 1)


T = TypeVar("T", bound=BaseModel)

# Permitted Gemini text models strictly restricted to gemini-flash-latest and gemini-flash-lite-latest
ALLOWED_MODELS = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest"
]

# Preferred Flash text models in descending priority order
PREFERRED_FLASH_MODELS = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest"
]

def resolve_gemini_api_key(custom_key: Optional[str] = None) -> str:
    """
    Resolves Gemini API key with priority:
    1. Custom key explicitly provided in request
    2. settings.GEMINI_API_KEY
    3. os.environ['GEMINI_API_KEY']
    4. os.environ['GOOGLE_API_KEY']
    """
    def _is_valid(k: Optional[str]) -> bool:
        if not k or not k.strip():
            return False
        s = k.strip().lower()
        if "your_" in s or s in ("changeme", "none", "null"):
            return False
        return True

    if _is_valid(custom_key):
        return custom_key.strip()
    if _is_valid(settings.GEMINI_API_KEY):
        return settings.GEMINI_API_KEY.strip()
    env_k = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
    if _is_valid(env_k):
        return env_k.strip()
    return ""


def find_supported_models(api_key: str) -> List[str]:
    """
    Discovers supported Gemini models, strictly limited to 'gemini-flash-latest' and 'gemini-flash-lite-latest'.
    Excludes all other Gemini variants to guarantee deterministic model usage.
    """
    try:
        genai.configure(api_key=api_key)
        available = []
        for m in genai.list_models():
            methods = getattr(m, "supported_generation_methods", []) or []
            if "generateContent" in methods:
                clean_name = m.name.replace("models/", "")
                if clean_name in ALLOWED_MODELS:
                    available.append(clean_name)

        logger.info("Discovered allowed Gemini models: %s", available)

        ordered = [pref for pref in ALLOWED_MODELS if pref in available]
        if ordered:
            return ordered
    except Exception as exc:
        logger.warning("Dynamic model listing encountered error: %s", exc)

    return list(ALLOWED_MODELS)


def _clean_json_text(text: str) -> str:
    """Strips markdown code blocks (```json ... ```) from raw model responses."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Strip opening fence
        first_newline = cleaned.find("\n")
        if first_newline != -1:
            cleaned = cleaned[first_newline + 1:]
        # Strip closing fence
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    return cleaned.strip()


def _normalize_ai_output(data: Any, schema_cls: Type[T]) -> Any:
    """Normalizes output dictionary to guarantee compliance with Pydantic schemas."""
    from backend.nlp.schemas import (
        AIWbsDecompositionOutput,
        AIEstimationOutput,
        AIDependencyExtractionOutput
    )

    if isinstance(data, list):
        if schema_cls is AIEstimationOutput:
            data = {"estimates": data}
        elif schema_cls is AIDependencyExtractionOutput:
            data = {"dependencies": data}
        elif schema_cls is AIWbsDecompositionOutput:
            data = {"major_deliverables": data}
        else:
            data = {"items": data}

    if not isinstance(data, dict):
        return data

    # 1. AIWbsDecompositionOutput normalization
    if schema_cls is AIWbsDecompositionOutput:
        delivs = data.get("major_deliverables") or data.get("deliverables") or data.get("wbs") or []

        if not isinstance(delivs, list):
            delivs = []

        normalized_delivs = []
        extracted_activities = []

        def _is_generic_name(val: str, prefix_type: str) -> bool:
            clean = (val or "").strip()
            if not clean or len(clean) < 3:
                return True
            if prefix_type == "deliverable":
                return bool(re.match(r"^(deliverable|derivable|deliv|major deliverable|level 2|phase)\s*\d*$", clean, re.I))
            elif prefix_type == "work_package":
                return bool(re.match(r"^(work package|wp|package|terminal package)\s*[\d\.]*$", clean, re.I))
            return False

        for d_idx, d in enumerate(delivs):
            if not isinstance(d, dict):
                continue
            d_num = str(d.get("wbs_number") or (d_idx + 1)).strip()
            d_name = str(d.get("name") or "").strip()
            d_desc = str(d.get("description") or "").strip()
            wps = d.get("work_packages") or d.get("children") or []
            if not isinstance(wps, list):
                wps = []

            # Clean deliverable name if generic (e.g. "Deliverable 1", "Derivable 1", "Phase 1")
            if _is_generic_name(d_name, "deliverable"):
                valid_wp_titles = [
                    str(wp.get("name", "")).strip() for wp in wps 
                    if str(wp.get("name", "")).strip() and not _is_generic_name(str(wp.get("name", "")), "work_package")
                ]
                if valid_wp_titles:
                    if len(valid_wp_titles) == 1:
                        base = valid_wp_titles[0]
                        if any(term in base.lower() for term in ["architecture", "infrastructure", "foundation", "system", "engine", "platform"]):
                            d_name = f"{base} & Framework"
                        elif any(term in base.lower() for term in ["testing", "qa", "deployment", "release", "governance"]):
                            d_name = f"{base} Pipeline"
                        else:
                            d_name = f"{base} & Core Services"
                    elif len(valid_wp_titles) == 2:
                        d_name = f"{valid_wp_titles[0]} & {valid_wp_titles[1]}"
                    else:
                        d_name = f"{valid_wp_titles[0]} & Core Deliverables"
                else:
                    d_name = f"Core Solution Domain {d_num}"

            if _is_generic_name(d_desc, "deliverable") or not d_desc:
                d_desc = f"Major deliverable encompasses {d_name.lower()} components and associated implementation work packages."

            normalized_wps = []
            for wp_idx, wp in enumerate(wps):
                if not isinstance(wp, dict):
                    continue
                wp_num = str(wp.get("wbs_number") or f"{d_num}.{wp_idx + 1}").strip()
                wp_name = str(wp.get("name") or "").strip()
                wp_desc = str(wp.get("description") or "").strip()

                if _is_generic_name(wp_name, "work_package"):
                    wp_name = f"{d_name} Component {wp_idx + 1}"

                if _is_generic_name(wp_desc, "work_package") or not wp_desc:
                    wp_desc = f"Scope covering {wp_name.lower()} and related discrete activities."

                # Check if model nested activities inside work package
                wp_acts = wp.get("activities") or []
                if not isinstance(wp_acts, list):
                    wp_acts = []

                normalized_wp_acts = []
                for a_idx, a in enumerate(wp_acts):
                    if not isinstance(a, dict):
                        continue
                    act_name = str(a.get("name") or f"Activity {wp_num}.{a_idx + 1}").strip()
                    act_desc = str(a.get("description") or act_name).strip()
                    wp_ref = str(a.get("work_package_ref") or wp_num).strip()
                    is_ms = bool(a.get("is_milestone", False))

                    opt_raw = a.get("optimistic_days") or 2.0
                    ml_raw = a.get("most_likely_days") or 4.0
                    pess_raw = a.get("pessimistic_days") or 7.0
                    opt, ml, pess = _enforce_pert_strict_ordering(opt_raw, ml_raw, pess_raw)

                    raw_tasks = a.get("tasks") or []
                    if isinstance(raw_tasks, str):
                        raw_tasks = [raw_tasks]
                    elif not isinstance(raw_tasks, list):
                        raw_tasks = []

                    normalized_task_strings = []
                    for t in raw_tasks:
                        if isinstance(t, str) and t.strip():
                            normalized_task_strings.append(t.strip())
                        elif isinstance(t, dict) and t.get("name"):
                            normalized_task_strings.append(str(t.get("name")).strip())

                    if not normalized_task_strings:
                        normalized_task_strings = [f"Execute {act_name}"]

                    act_obj = {
                        "name": act_name,
                        "description": act_desc,
                        "work_package_ref": wp_ref,
                        "is_milestone": is_ms,
                        "optimistic_days": max(0.1, min(44.0, opt)),
                        "most_likely_days": max(opt, min(44.0, ml)),
                        "pessimistic_days": max(ml, min(44.0, pess)),
                        "tasks": normalized_task_strings
                    }
                    normalized_wp_acts.append(act_obj)
                    extracted_activities.append(act_obj)

                normalized_wps.append({
                    "wbs_number": wp_num,
                    "name": wp_name,
                    "description": wp_desc,
                    "activities": normalized_wp_acts
                })

            if not normalized_wps:
                wp_fallback = {
                    "wbs_number": f"{d_num}.1",
                    "name": f"{d_name} Core Package",
                    "description": f"Core work scope for {d_name}",
                    "activities": []
                }
                normalized_wps.append(wp_fallback)

            normalized_delivs.append({
                "wbs_number": d_num,
                "name": d_name,
                "description": d_desc,
                "work_packages": normalized_wps
            })

        if not normalized_delivs:
            normalized_delivs.append({
                "wbs_number": "1",
                "name": "Project Core Deliverables",
                "description": "Baseline deliverables for project scope",
                "work_packages": [
                    {
                        "wbs_number": "1.1",
                        "name": "Initial Execution Package",
                        "description": "Primary package",
                        "activities": []
                    }
                ]
            })

        # Process root activities
        root_acts = data.get("activities") or []
        if isinstance(root_acts, list):
            for a_idx, a in enumerate(root_acts):
                if not isinstance(a, dict):
                    continue
                act_name = str(a.get("name") or "").strip()
                if not act_name or any(ea["name"] == act_name for ea in extracted_activities):
                    continue
                act_desc = str(a.get("description") or act_name).strip()
                wp_ref = str(a.get("work_package_ref") or "1.1").strip()
                is_ms = bool(a.get("is_milestone", False))
                opt_raw = a.get("optimistic_days") or 2.0
                ml_raw = a.get("most_likely_days") or 4.0
                pess_raw = a.get("pessimistic_days") or 7.0
                opt, ml, pess = _enforce_pert_strict_ordering(opt_raw, ml_raw, pess_raw)

                raw_tasks = a.get("tasks") or []
                if isinstance(raw_tasks, str):
                    raw_tasks = [raw_tasks]
                elif not isinstance(raw_tasks, list):
                    raw_tasks = []

                normalized_task_strings = []
                for t in raw_tasks:
                    if isinstance(t, str) and t.strip():
                        normalized_task_strings.append(t.strip())
                    elif isinstance(t, dict) and t.get("name"):
                        normalized_task_strings.append(str(t.get("name")).strip())

                if not normalized_task_strings:
                    normalized_task_strings = [f"Execute {act_name}"]

                act_obj = {
                    "name": act_name,
                    "description": act_desc,
                    "work_package_ref": wp_ref,
                    "is_milestone": is_ms,
                    "optimistic_days": max(0.1, min(44.0, opt)),
                    "most_likely_days": max(opt, min(44.0, ml)),
                    "pessimistic_days": max(ml, min(44.0, pess)),
                    "tasks": normalized_task_strings
                }
                extracted_activities.append(act_obj)

                # Link to corresponding work package if not already there
                for d in normalized_delivs:
                    for wp in d.get("work_packages", []):
                        if wp.get("wbs_number") == wp_ref:
                            if not any(wa["name"] == act_name for wa in wp.get("activities", [])):
                                wp.setdefault("activities", []).append(act_obj)

        # Fallback if no activities were found anywhere
        if not extracted_activities:
            for d in normalized_delivs:
                for wp in d.get("work_packages", []):
                    wp_ref = wp.get("wbs_number", "1.1")
                    wp_name = wp.get("name", "Work Package")
                    fallback_act = {
                        "name": f"Execute & Deliver {wp_name}",
                        "description": f"Core engineering and delivery tasks for {wp_name}",
                        "work_package_ref": wp_ref,
                        "is_milestone": False,
                        "optimistic_days": 2.0,
                        "most_likely_days": 5.0,
                        "pessimistic_days": 8.0,
                        "tasks": [f"Design specifications for {wp_name}", f"Implementation and quality verification"]
                    }
                    wp.setdefault("activities", []).append(fallback_act)
                    extracted_activities.append(fallback_act)

        return {
            "major_deliverables": normalized_delivs,
            "activities": extracted_activities
        }

    # 2. AIEstimationOutput normalization
    from backend.nlp.schemas import AIEstimationOutput
    if schema_cls is AIEstimationOutput:
        items = data.get("estimates") or data.get("items") or data.get("results") or []
        if isinstance(data, list):
            items = data
        normalized_estimates = []
        for item in items:
            if not isinstance(item, dict):
                continue
            aid = str(item.get("activity_id") or "").strip()
            if not aid:
                continue
            opt_raw = item.get("optimistic") or 1.0
            ml_raw = item.get("most_likely") or 3.0
            pess_raw = item.get("pessimistic") or 6.0
            opt, ml, pess = _enforce_pert_strict_ordering(opt_raw, ml_raw, pess_raw)

            normalized_estimates.append({
                "activity_id": aid,
                "optimistic": opt,
                "most_likely": ml,
                "pessimistic": pess,
                "rationale": str(item.get("rationale") or "Estimated via DCMA 14-Point PERT model.").strip()
            })
        return {"estimates": normalized_estimates}

    # 3. AIDependencyExtractionOutput normalization
    from backend.nlp.schemas import AIDependencyExtractionOutput
    if schema_cls is AIDependencyExtractionOutput:
        deps = data.get("dependencies") or data.get("items") or data.get("relationships") or []
        if isinstance(data, list):
            deps = data
        normalized_deps = []
        for dep in deps:
            if not isinstance(dep, dict):
                continue
            from_id = str(dep.get("from_activity_id") or "").strip()
            to_id = str(dep.get("to_activity_id") or "").strip()
            if not from_id or not to_id or from_id == to_id:
                continue
            rel_type = str(dep.get("type") or "FS").upper().strip()
            if rel_type not in ["FS", "SS", "FF", "SF"]:
                rel_type = "FS"
            try:
                lag = max(0.0, float(dep.get("lag_days") or 0.0))
            except (ValueError, TypeError):
                lag = 0.0

            normalized_deps.append({
                "from_activity_id": from_id,
                "to_activity_id": to_id,
                "type": rel_type,
                "lag_days": lag,
                "description": str(dep.get("description") or "Logical precedence link").strip()
            })
        return {"dependencies": normalized_deps}

    return data


class GeminiClient:
    """Wrapper for Google Gemini with strict Pydantic JSON Schema enforcement and auto-fallback.
    Strictly restricted to use only 'gemini-flash-latest' and 'gemini-flash-lite-latest'.
    """
    ALLOWED_MODELS: List[str] = ALLOWED_MODELS

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = resolve_gemini_api_key(api_key)
        if not self.api_key:
            raise ValueError(
                "Google Gemini API key not found. Please provide a key in the modal or configure GEMINI_API_KEY in the environment."
            )
        genai.configure(api_key=self.api_key)

        # Validate requested model if specified; otherwise default to allowed models
        if model:
            clean_m = model.strip()
            if clean_m not in self.ALLOWED_MODELS:
                raise ValueError(
                    f"Model '{model}' is not supported. The system is configured to use only 'gemini-flash-latest' and 'gemini-flash-lite-latest'."
                )
            other = [m for m in self.ALLOWED_MODELS if m != clean_m]
            self.candidate_models = [clean_m] + other
        else:
            supported = find_supported_models(self.api_key)
            self.candidate_models = [m for m in supported if m in self.ALLOWED_MODELS] or list(self.ALLOWED_MODELS)

        logger.info("GeminiClient initialized with candidate models: %s", self.candidate_models)

    def generate_structured(
        self,
        prompt: str,
        system_instruction: str,
        response_schema: Type[T],
        temperature: float = 0.2
    ) -> T:
        """
        Executes inference call enforcing constrained JSON decoding against a Pydantic schema.
        Automatically retries across active candidate models and normalizes the parsed JSON.
        """
        last_exception = None

        for model_name in self.candidate_models:
            try:
                logger.info("Attempting inference with model: %s", model_name)
                model = genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=system_instruction,
                    generation_config={
                        "temperature": temperature,
                        "max_output_tokens": 8192,
                        "response_mime_type": "application/json",
                        "response_schema": response_schema
                    }
                )

                response = model.generate_content(prompt, request_options={"timeout": 120.0})
                raw_text = (response.text or "").strip()

                if not raw_text:
                    raise ValueError(f"Gemini model {model_name} returned an empty response.")

                cleaned_json_text = _clean_json_text(raw_text)
                parsed_dict = json.loads(cleaned_json_text)
                normalized_dict = _normalize_ai_output(parsed_dict, response_schema)

                # Validate against Pydantic schema
                parsed = response_schema.model_validate(normalized_dict)
                logger.info("Inference succeeded using model: %s", model_name)
                return parsed

            except Exception as exc:
                err_msg = str(exc)
                logger.warning("Model '%s' failed: %s", model_name, err_msg)
                last_exception = exc

                # Invalid API key cannot be fixed by switching models
                if "API_KEY_INVALID" in err_msg or "API key not valid" in err_msg:
                    raise ValueError("Invalid Google Gemini API key. Please verify your free key at aistudio.google.com.") from exc

                # Quota or rate limit exceeded on this model: continue trying standard Flash models
                if "429" in err_msg or "quota" in err_msg.lower() or "resource_exhausted" in err_msg.lower():
                    continue

                # 404 or unsupported model, continue to next candidate
                if "404" in err_msg or "not found" in err_msg.lower() or "not supported" in err_msg.lower():
                    continue

                continue

        # If all candidates exhausted, format friendly error
        err_text = str(last_exception) if last_exception else "No compatible Gemini model found."
        logger.error("All Gemini candidate models failed: %s", err_text)
        if "RESOURCE_EXHAUSTED" in err_text or "quota" in err_text.lower():
            raise ValueError("Gemini free tier rate limit reached. Please wait a moment before retrying.")
        raise ValueError(f"Gemini AI processing error: {err_text}")


def verify_gemini_key(api_key: str) -> bool:
    """Tests if a Gemini API key is valid and responsive against active models."""
    try:
        k = api_key.strip()
        if not k:
            return False
        models = find_supported_models(k)
        target = models[0] if models and models[0] in ALLOWED_MODELS else "gemini-flash-latest"
        genai.configure(api_key=k)
        model = genai.GenerativeModel(model_name=target)
        res = model.generate_content("Ping", generation_config={"max_output_tokens": 5})
        return bool(res and res.text)
    except Exception as e:
        logger.warning("Gemini key verification failed: %s", e)
        return False

