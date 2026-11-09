"""Pydantic request and response schemas for projects, WBS, and schedules."""
from datetime import date, datetime
from enum import Enum
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field, field_validator


class TeamMemberModel(BaseModel):
    user_id: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    email: Optional[str] = None


class TeamModel(BaseModel):
    team_id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=100)
    member_ids: List[str] = Field(default_factory=list)
    lead_id: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = Field(default="", max_length=2000)
    start_date: date
    created_by: str
    assigned_user_ids: List[str] = Field(default_factory=list)
    teams: List[TeamModel] = Field(default_factory=list)
    controllers: List[str] = Field(default_factory=list)
    open_participation: bool = False
    allow_multiteam: bool = False

    @field_validator("start_date")
    @classmethod
    def validate_start_date(cls, v: date) -> date:
        today = date.today()
        if v < today:
            raise ValueError(f"Start date cannot be in the past ({v} < {today})")
        return v


class JoinProjectRequest(BaseModel):
    user_id: str
    team_id: Optional[str] = None


class UpdateProjectDescriptionRequest(BaseModel):
    description: str = Field(default="", max_length=3000)


class UpdateProjectPersonnelRequest(BaseModel):
    teams: List[TeamModel] = Field(default_factory=list)
    assigned_user_ids: List[str] = Field(default_factory=list)
    controllers: Optional[List[str]] = None


class UpdateProjectActivitiesRequest(BaseModel):
    activities: List[Dict[str, Any]] = Field(default_factory=list)


class UpdateProjectDeliverablesRequest(BaseModel):
    deliverables: List[Dict[str, Any]] = Field(default_factory=list)


class UpdateProjectWbsRequest(BaseModel):
    wbs: List[Dict[str, Any]] = Field(default_factory=list)


class DependencyTypeEnum(str, Enum):
    FS = "FS"
    SS = "SS"
    FF = "FF"
    SF = "SF"


class DependencyModel(BaseModel):
    dependency_id: Optional[str] = None
    from_activity_id: str
    to_activity_id: str
    type: str = "FS"
    lag_days: float = Field(default=0.0, ge=0.0)
    description: Optional[str] = ""


class UpdateProjectDependenciesRequest(BaseModel):
    dependencies: List[DependencyModel] = Field(default_factory=list)


class ProjectSummary(BaseModel):
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
    imposed_deadline_date: Optional[str] = None
    imposed_deadline_days: Optional[float] = None
    near_critical_threshold_days: float = Field(default=25.0, ge=0.0)
    diagram_mode: str = "aon"
    notes: Optional[str] = ""


class UpdateScheduleSettingsRequest(BaseModel):
    imposed_deadline_date: Optional[str] = None
    imposed_deadline_days: Optional[float] = None
    near_critical_threshold_days: Optional[float] = None
    diagram_mode: Optional[str] = None
    notes: Optional[str] = None


class ActivityStatusUpdateRequest(BaseModel):
    status: str
    progress_pct: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    actual_start_date: Optional[str] = None
    actual_finish_date: Optional[str] = None
    verified_by: Optional[str] = None
    verified_date: Optional[str] = None
    reviewer_id: Optional[str] = None
    description: Optional[str] = ""
    notes: Optional[str] = ""
    completion_proof: Optional[str] = None
    verification_checklist: Optional[List[Dict[str, Any]]] = None


class CalendarSettingsModel(BaseModel):
    working_days: List[int] = Field(default=[0, 1, 2, 3, 4])
    holidays: List[str] = Field(default_factory=list)
    shift_hours_per_day: float = Field(default=8.0, gt=0.0, le=24.0)
    calendar_name: str = "Standard 5-Day (Mon-Fri)"


class CreateBaselineRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default="", max_length=1000)


class TimeLogEntry(BaseModel):
    log_id: str
    user_id: str
    user_name: Optional[str] = "Team Member"
    start_time: str
    end_time: str
    duration_seconds: int = Field(default=0, ge=0)
    notes: Optional[str] = ""
    created_at: Optional[str] = None


class StartTimerRequest(BaseModel):
    user_id: str
    user_name: Optional[str] = ""
    notes: Optional[str] = ""


class StopTimerRequest(BaseModel):
    user_id: str
    user_name: Optional[str] = ""
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = ""


class UpdateTimeLogRequest(BaseModel):
    user_id: str
    notes: Optional[str] = None
    target_activity_id: Optional[str] = None


class ProjectDetail(BaseModel):
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
