"""
SyncFlow – Project & Team Pydantic Models.
Defines schemas for project creation, workspace management, and team reusability.
"""
from datetime import date, datetime
from enum import Enum
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field, field_validator


class TeamMemberModel(BaseModel):
    """Member within a team."""
    user_id: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None


class TeamModel(BaseModel):
    """Team definition within a project or PM team template library."""
    team_id: Optional[str] = Field(default=None, description="Unique team identifier, e.g. TEAM-ENG-1")
    name: str = Field(..., min_length=1, max_length=100, description="Team designation")
    member_ids: List[str] = Field(default_factory=list, description="Assigned User IDs")
    lead_id: Optional[str] = Field(default=None, description="Optional designated team lead user ID")
    created_by: Optional[str] = Field(default=None, description="PM user ID who created the team")
    created_at: Optional[datetime] = None


class CreateProjectRequest(BaseModel):
    """Payload for creating a new project from scratch."""
    name: str = Field(..., min_length=1, max_length=150, description="Project Name")
    description: Optional[str] = Field(default="", max_length=2000, description="Optional Project Scope")
    start_date: date = Field(..., description="Project start date (today or future)")
    created_by: str = Field(..., description="ID of Project Manager creator")
    assigned_user_ids: List[str] = Field(default_factory=list, description="IDs of individual users assigned")
    teams: List[TeamModel] = Field(default_factory=list, description="Teams configured for this project")
    controllers: List[str] = Field(default_factory=list, description="IDs of project controllers")
    open_participation: bool = Field(default=False, description="Whether users can join freely without PM approval")
    allow_multiteam: bool = Field(default=False, description="Whether members can be assigned to multiple teams simultaneously")

    @field_validator("start_date")
    @classmethod
    def validate_start_date(cls, v: date) -> date:
        today = date.today()
        if v < today:
            raise ValueError(f"Start Date cannot be in the past. Selected: {v}, Today: {today}")
        return v


class JoinProjectRequest(BaseModel):
    """Payload for a user requesting to join or directly joining a project."""
    user_id: str = Field(..., description="User ID requesting to join")


class UpdateProjectDescriptionRequest(BaseModel):
    """Payload for updating project scope / description in Plan Schedule Management."""
    description: str = Field(default="", max_length=3000, description="Updated project description")


class UpdateProjectPersonnelRequest(BaseModel):
    """Payload for updating teams, individual contributors, and controllers in Project Workspace."""
    teams: List[TeamModel] = Field(default_factory=list, description="Updated teams configured for this project")
    assigned_user_ids: List[str] = Field(default_factory=list, description="Updated individual contributor IDs")
    controllers: Optional[List[str]] = Field(default=None, description="Updated controller IDs")


class UpdateProjectActivitiesRequest(BaseModel):
    """Payload for updating WBS activities, tasks, and operations in Project Workspace."""
    activities: List[Dict[str, Any]] = Field(default_factory=list, description="Updated WBS activities hierarchy")


class UpdateProjectDeliverablesRequest(BaseModel):
    """Payload for updating WBS deliverables, sub-deliverables, and work packages."""
    deliverables: List[Dict[str, Any]] = Field(default_factory=list, description="Updated WBS deliverables hierarchy")


class UpdateProjectWbsRequest(BaseModel):
    """Payload for updating recursive WBS hierarchy (Major Deliverables -> Sub-deliverables -> Work Packages)."""
    wbs: List[Dict[str, Any]] = Field(default_factory=list, description="Updated recursive WBS tree")


class DependencyTypeEnum(str, Enum):
    FS = "FS"
    SS = "SS"
    FF = "FF"
    SF = "SF"


class DependencyModel(BaseModel):
    """Activity dependency / precedence relationship."""
    dependency_id: Optional[str] = None
    from_activity_id: str = Field(..., description="Predecessor Activity ID")
    to_activity_id: str = Field(..., description="Successor Activity ID")
    type: str = Field(default="FS", description="Relationship type: FS, SS, FF, SF")
    lag_days: float = Field(default=0.0, ge=0.0, description="Lag in days (strictly non-negative)")
    description: Optional[str] = Field(default="", description="Technical, operational, or managerial justification")


class UpdateProjectDependenciesRequest(BaseModel):
    """Payload for updating project dependencies and precedence relationships."""
    dependencies: List[DependencyModel] = Field(default_factory=list, description="Updated dependencies list")


class ProjectSummary(BaseModel):
    """Summary representation of a project for PM dashboard list/grid."""
    id: str
    name: str
    description: str
    start_date: Optional[str] = None
    created_by: Optional[str] = None
    teams_count: int = 0
    members_count: int = 0
    controllers_count: int = 0
    activities_count: int = 0
    deliverables_count: int = 0
    wbs_nodes_count: int = 0
    dependencies_count: int = 0
    open_participation: bool = False
    allow_multiteam: bool = False
    status: Optional[str] = "in_progress"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ScheduleSettingsModel(BaseModel):
    """Configuration and baseline targets for Develop Schedule process."""
    imposed_deadline_date: Optional[str] = Field(default=None, description="Externally imposed deadline date (YYYY-MM-DD)")
    imposed_deadline_days: Optional[float] = Field(default=None, description="Externally imposed target duration in days")
    near_critical_threshold_days: float = Field(default=25.0, ge=0.0, description="Float threshold (in days) to flag near-critical activities")
    diagram_mode: str = Field(default="aon", description="Default network diagram view: 'aon' (CPM) or 'aoa' (PERT)")
    notes: Optional[str] = Field(default="", description="PM notes on baseline schedule and critical path governance")


class UpdateScheduleSettingsRequest(BaseModel):
    """Payload for updating schedule baseline parameters and deadlines."""
    imposed_deadline_date: Optional[str] = None
    imposed_deadline_days: Optional[float] = None
    near_critical_threshold_days: Optional[float] = None
    diagram_mode: Optional[str] = None
    notes: Optional[str] = None


class ActivityStatusUpdateRequest(BaseModel):
    """Payload for updating an activity's execution and verification status in Control Schedule."""
    status: str = Field(..., description="One of: 'not_started', 'in_progress', 'completed', 'verified'")
    progress_pct: Optional[float] = Field(default=None, ge=0.0, le=100.0, description="Percentage of completion")
    actual_start_date: Optional[str] = Field(default=None, description="Actual start date YYYY-MM-DD")
    actual_finish_date: Optional[str] = Field(default=None, description="Actual completion date YYYY-MM-DD")
    verified_by: Optional[str] = Field(default=None, description="Controller ID or name who verified the activity")
    verified_date: Optional[str] = Field(default=None, description="Date YYYY-MM-DD when verified by Controller")
    reviewer_id: Optional[str] = Field(default=None, description="User ID performing the status change or controller review")
    description: Optional[str] = Field(default="", description="Mandatory notes or review feedback description")
    notes: Optional[str] = Field(default="", description="Variance notes, causes, or corrective actions")
    completion_proof: Optional[str] = Field(default=None, description="Text description of deliverable proof or completion evidence")
    verification_checklist: Optional[List[Dict[str, Any]]] = Field(default=None, description="Itemized acceptance checklist verified by Controller")


class CalendarSettingsModel(BaseModel):
    """Enterprise calendar and shift configuration."""
    working_days: List[int] = Field(default=[0, 1, 2, 3, 4], description="0=Mon, 1=Tue, ..., 4=Fri, 5=Sat, 6=Sun")
    holidays: List[str] = Field(default_factory=list, description="Statutory holidays and non-working dates (YYYY-MM-DD)")
    shift_hours_per_day: float = Field(default=8.0, gt=0.0, le=24.0, description="Standard working hours per day")
    calendar_name: str = Field(default="Standard 5-Day (Mon-Fri)", description="Descriptive calendar template label")




class CreateBaselineRequest(BaseModel):
    """Payload to freeze current schedule into an immutable baseline snapshot."""
    name: str = Field(..., min_length=1, max_length=120, description="Baseline name, e.g. Contract Baseline 0")
    description: Optional[str] = Field(default="", max_length=1000, description="Notes on baseline rationale or approval")







class ProjectDetail(BaseModel):
    """Complete project document representation."""
    id: str
    name: str
    description: str
    start_date: Optional[str] = None
    created_by: Optional[str] = None
    assigned_user_ids: List[str] = Field(default_factory=list)
    teams: List[Dict[str, Any]] = Field(default_factory=list)
    controllers: List[str] = Field(default_factory=list)
    open_participation: bool = False
    allow_multiteam: bool = False
    wbs: List[Dict[str, Any]] = Field(default_factory=list)
    deliverables: List[Dict[str, Any]] = Field(default_factory=list)
    activities: List[Dict[str, Any]] = Field(default_factory=list)
    dependencies: List[Dict[str, Any]] = Field(default_factory=list)
    schedule_settings: Optional[Dict[str, Any]] = None
    calendar_settings: Optional[Dict[str, Any]] = None
    baselines: List[Dict[str, Any]] = Field(default_factory=list)
    status: Optional[str] = "in_progress"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
