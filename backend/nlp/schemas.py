"""
SyncFlow – AI NLP Pydantic Schemas.
Defines strict schemas for Gemini 1.5 Flash constrained decoding and API request/response contracts.
Note: Models used with Gemini's response_schema must NOT use Field constraints like default, ge, le,
as Google's protobuf Schema rejects those fields.
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# ── Level 3 & Level 2 Schemas (Constrained Decoding) ─────────────────────────
class AIOperationItem(BaseModel):
    name: str = Field(description="Level 3 operation title")
    description: str = Field(description="Brief operational step description")


class AITaskItem(BaseModel):
    name: str = Field(description="Level 2 task title")
    description: str = Field(description="Task scope description")
    operations: List[AIOperationItem] = Field(description="Level 3 operations")


# ── Text-to-WBS Extraction Schemas ──────────────────────────────────────────
class AIActivityItem(BaseModel):
    name: str = Field(description="Concise activity name, imperative verb + noun (e.g., 'Develop Physics Engine')")
    description: str = Field(description="Activity detailed work description")
    work_package_ref: str = Field(description="WBS reference code, e.g. '1.1' or '2.1'")
    is_milestone: bool = Field(description="True if zero-duration milestone gate, false otherwise")
    optimistic_days: float = Field(description="Optimistic duration (a) in business days (DCMA Metric 6: <= 44.0)")
    most_likely_days: float = Field(description="Most likely duration (m) in business days (DCMA Metric 6: <= 44.0)")
    pessimistic_days: float = Field(description="Pessimistic duration (b) in business days (DCMA Metric 6: <= 44.0)")
    tasks: List[AITaskItem] = Field(description="Child tasks breaking down the activity")


class AIWorkPackageItem(BaseModel):
    wbs_number: str = Field(description="Hierarchical numbering relative to deliverable, e.g. '1.1'")
    name: str = Field(description="Work Package title")
    description: str = Field(description="Scope covered by this work package")


class AIDeliverableItem(BaseModel):
    wbs_number: str = Field(description="Major Deliverable numbering, e.g. '1'")
    name: str = Field(description="Major Deliverable title")
    description: str = Field(description="Major Deliverable summary")
    work_packages: List[AIWorkPackageItem] = Field(description="Child work packages")


class AIWbsDecompositionOutput(BaseModel):
    major_deliverables: List[AIDeliverableItem] = Field(description="List of major deliverables")
    activities: List[AIActivityItem] = Field(description="List of discrete activities mapped to work packages")


# ── DCMA 14-Point PERT Duration Estimation Schemas ───────────────────────────
class AIEstimateItem(BaseModel):
    activity_id: str = Field(description="Target Activity ID")
    optimistic: float = Field(description="Optimistic duration (a) in business days (DCMA Metric 6: <= 44.0)")
    most_likely: float = Field(description="Most likely duration (m) in business days (DCMA Metric 6: <= 44.0)")
    pessimistic: float = Field(description="Pessimistic duration (b) in business days (DCMA Metric 6: <= 44.0)")
    rationale: str = Field(description="Technical & risk rationale compliant with DCMA 14-Point")


class AIEstimationOutput(BaseModel):
    estimates: List[AIEstimateItem] = Field(description="Itemized estimates for target activities")


# ── Precedence Dependency Extraction Schemas ────────────────────────────────
class AIDependencyItem(BaseModel):
    from_activity_id: str = Field(description="Predecessor Activity ID")
    to_activity_id: str = Field(description="Successor Activity ID")
    type: str = Field(description="Relationship type: FS (predominantly), SS, FF, SF")
    lag_days: float = Field(description="Lag in days (DCMA Metric 2: non-negative)")
    description: str = Field(description="Logical or technical rationale for this dependency")


class AIDependencyExtractionOutput(BaseModel):
    dependencies: List[AIDependencyItem] = Field(description="List of extracted precedence dependencies")


# ── API Request Bodies ───────────────────────────────────────────────────────
class TextToWBSRequest(BaseModel):
    scope_text: str = Field(..., min_length=10, description="Unstructured project scope, notes, or charter narrative")
    custom_prompt: Optional[str] = Field(default="", description="Optional PM custom instructions or focus areas")
    mode: str = Field(default="merge", description="'merge' (append & preserve) or 'replace' (recreate fresh)")
    api_key: Optional[str] = Field(default=None, description="Optional custom Gemini API key provided by PM")


class EstimateDurationsRequest(BaseModel):
    custom_prompt: Optional[str] = Field(default="", description="Optional PM guidance on complexity or resource speed")
    target_activity_ids: Optional[List[str]] = Field(default=None, description="Specific activity IDs to estimate (defaults to missing/all)")
    api_key: Optional[str] = Field(default=None, description="Optional custom Gemini API key provided by PM")


class ExtractDependenciesRequest(BaseModel):
    narrative_text: Optional[str] = Field(default="", description="Optional narrative describing activity order or handoffs")
    workflow_narrative: Optional[str] = Field(default="", description="Alias for narrative_text")
    custom_prompt: Optional[str] = Field(default="", description="Optional PM instructions for dependency generation")
    api_key: Optional[str] = Field(default=None, description="Optional custom Gemini API key provided by PM")

    def get_narrative(self) -> str:
        return (self.workflow_narrative or self.narrative_text or "").strip()
