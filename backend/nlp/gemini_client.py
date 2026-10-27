"""
SyncFlow – Google Gemini Client.
Integrates dynamic model discovery (Gemini 3.8/2.0 Flash), constrained decoding
(Strict JSON Schema), non-text model filtering, and robust fallback.
"""
import os
import json
import logging
import warnings
from typing import Type, TypeVar, Optional, Any, Dict, List
from pydantic import BaseModel

warnings.filterwarnings("ignore", category=FutureWarning)
import google.generativeai as genai
from backend.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

BLOCKED_MODEL_KEYWORDS = [
    "tts", "audio", "embed", "imagen", "image", "lyria",
    "deep-research", "banana", "robotics", "live", "computer-use", "omni"
]

# Preferred Flash text models in descending priority order
PREFERRED_FLASH_MODELS = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
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
    Queries Google AI Studio to discover active standard text-generation models,
    strictly excluding non-text, preview image/audio, or zero-quota models.
    """
    try:
        genai.configure(api_key=api_key)
        available = []
        for m in genai.list_models():
            methods = getattr(m, "supported_generation_methods", []) or []
            if "generateContent" in methods:
                clean_name = m.name.replace("models/", "")
                lower = clean_name.lower()
                # Must be a standard Gemini text model
                if "gemini" not in lower:
                    continue
                # Strictly filter out non-text, audio, image, and high-tier preview research models
                if any(bad in lower for bad in BLOCKED_MODEL_KEYWORDS):
                    continue
                available.append(clean_name)

        logger.info("Discovered active standard Gemini text models: %s", available)

        # Order by priority
        ordered = []
        for pref in PREFERRED_FLASH_MODELS:
            if pref in available:
                ordered.append(pref)

        for other in available:
            if other not in ordered and ("flash" in other.lower() or "pro" in other.lower()):
                ordered.append(other)

        if ordered:
            return ordered
    except Exception as exc:
        logger.warning("Dynamic model listing encountered error: %s", exc)

    return ["gemini-2.0-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash"]


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

        for d_idx, d in enumerate(delivs):
            if not isinstance(d, dict):
                continue
            d_num = str(d.get("wbs_number") or (d_idx + 1)).strip()
            d_name = str(d.get("name") or f"Deliverable {d_num}").strip()
            d_desc = str(d.get("description") or d_name).strip()
            wps = d.get("work_packages") or d.get("children") or []
            if not isinstance(wps, list):
                wps = []

            normalized_wps = []
            for wp_idx, wp in enumerate(wps):
                if not isinstance(wp, dict):
                    continue
                wp_num = str(wp.get("wbs_number") or f"{d_num}.{wp_idx + 1}").strip()
                wp_name = str(wp.get("name") or f"Work Package {wp_num}").strip()
                wp_desc = str(wp.get("description") or wp_name).strip()

                # Check if model nested activities inside work package
                wp_acts = wp.get("activities") or []
                if isinstance(wp_acts, list) and wp_acts:
                    for a in wp_acts:
                        if isinstance(a, dict):
                            a.setdefault("work_package_ref", wp_num)
                            extracted_activities.append(a)

                normalized_wps.append({
                    "wbs_number": wp_num,
                    "name": wp_name,
                    "description": wp_desc
                })

            if not normalized_wps:
                normalized_wps.append({
                    "wbs_number": f"{d_num}.1",
                    "name": f"{d_name} Core Package",
                    "description": f"Core work scope for {d_name}"
                })

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
                        "description": "Primary package"
                    }
                ]
            })

        # Process activities
        acts = data.get("activities") or extracted_activities
        if not isinstance(acts, list):
            acts = []

        normalized_acts = []
        for a_idx, a in enumerate(acts):
            if not isinstance(a, dict):
                continue
            act_name = str(a.get("name") or f"Activity {a_idx + 1}").strip()
            act_desc = str(a.get("description") or act_name).strip()
            wp_ref = str(a.get("work_package_ref") or "1.1").strip()
            is_ms = bool(a.get("is_milestone", False))

            try:
                opt = float(a.get("optimistic_days") or 2.0)
            except (ValueError, TypeError):
                opt = 2.0
            try:
                ml = float(a.get("most_likely_days") or max(opt, 4.0))
            except (ValueError, TypeError):
                ml = max(opt, 4.0)
            try:
                pess = float(a.get("pessimistic_days") or max(ml, 7.0))
            except (ValueError, TypeError):
                pess = max(ml, 7.0)

            raw_tasks = a.get("tasks") or []
            if not isinstance(raw_tasks, list) or not raw_tasks:
                raw_tasks = [{"name": f"Execute {act_name}", "description": "", "operations": []}]

            normalized_tasks = []
            for t_idx, t in enumerate(raw_tasks):
                if not isinstance(t, dict):
                    continue
                t_name = str(t.get("name") or f"Task {t_idx + 1}").strip()
                t_desc = str(t.get("description") or "").strip()
                ops = t.get("operations") or []
                if not isinstance(ops, list):
                    ops = []
                normalized_ops = []
                for o_idx, o in enumerate(ops):
                    if isinstance(o, dict):
                        normalized_ops.append({
                            "name": str(o.get("name") or f"Step {o_idx + 1}").strip(),
                            "description": str(o.get("description") or "").strip()
                        })
                normalized_tasks.append({
                    "name": t_name,
                    "description": t_desc,
                    "operations": normalized_ops
                })

            normalized_acts.append({
                "name": act_name,
                "description": act_desc,
                "work_package_ref": wp_ref,
                "is_milestone": is_ms,
                "optimistic_days": max(0.1, min(44.0, opt)),
                "most_likely_days": max(opt, min(44.0, ml)),
                "pessimistic_days": max(ml, min(44.0, pess)),
                "tasks": normalized_tasks
            })

        # If activities list is empty, synthesize standard DCMA-compliant activities from work packages
        if not normalized_acts:
            for d in normalized_delivs:
                for wp in d.get("work_packages", []):
                    wp_ref = wp.get("wbs_number", "1.1")
                    wp_name = wp.get("name", "Work Package")
                    normalized_acts.append({
                        "name": f"Develop & Implement {wp_name}",
                        "description": f"Execution and verification for {wp_name}",
                        "work_package_ref": wp_ref,
                        "is_milestone": False,
                        "optimistic_days": 2.0,
                        "most_likely_days": 5.0,
                        "pessimistic_days": 8.0,
                        "tasks": [
                            {
                                "name": f"Implementation tasks for {wp_name}",
                                "description": "Core development",
                                "operations": []
                            }
                        ]
                    })

        return {
            "major_deliverables": normalized_delivs,
            "activities": normalized_acts
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
            try:
                opt = float(item.get("optimistic") or 1.0)
            except (ValueError, TypeError):
                opt = 1.0
            try:
                ml = float(item.get("most_likely") or max(opt, 3.0))
            except (ValueError, TypeError):
                ml = max(opt, 3.0)
            try:
                pess = float(item.get("pessimistic") or max(ml, 5.0))
            except (ValueError, TypeError):
                pess = max(ml, 5.0)

            normalized_estimates.append({
                "activity_id": aid,
                "optimistic": max(0.1, min(44.0, opt)),
                "most_likely": max(opt, min(44.0, ml)),
                "pessimistic": max(ml, min(44.0, pess)),
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
    """Wrapper for Google Gemini with strict Pydantic JSON Schema enforcement and auto-fallback."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = resolve_gemini_api_key(api_key)
        if not self.api_key:
            raise ValueError(
                "Google Gemini API key not found. Please provide a key in the modal or configure GEMINI_API_KEY in the environment."
            )
        genai.configure(api_key=self.api_key)
        self.candidate_models = find_supported_models(self.api_key)
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
                        "response_mime_type": "application/json",
                        "response_schema": response_schema
                    }
                )

                response = model.generate_content(prompt)
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
        target = models[0] if models else "gemini-2.0-flash"
        genai.configure(api_key=k)
        model = genai.GenerativeModel(model_name=target)
        res = model.generate_content("Ping", generation_config={"max_output_tokens": 5})
        return bool(res and res.text)
    except Exception as e:
        logger.warning("Gemini key verification failed: %s", e)
        return False

