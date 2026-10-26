"""
SyncFlow – Teams API Router (`/syncflow/teams`).
Handles saving, fetching, and reusing teams created by Project Managers across projects.
"""
from datetime import datetime
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.database.connection import get_db
from backend.utility import to_object_id, format_date

router = APIRouter(prefix="/syncflow/teams", tags=["Teams Library"])


class SaveTeamRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    member_ids: List[str] = Field(default_factory=list)
    created_by: str = Field(..., description="PM user ID")


class TeamResponse(BaseModel):
    team_id: str
    name: str
    member_ids: List[str]
    created_by: Optional[str] = None
    members_count: int = 0
    updated_at: Optional[str] = None


def _teams_collection():
    return get_db()["teams"]


def _format_team(doc: Dict[str, Any]) -> Dict[str, Any]:
    member_ids = [str(m) for m in doc.get("member_ids", [])]
    updated = doc.get("updated_at") or doc.get("created_at")
    return {
        "team_id": str(doc.get("team_id") or doc.get("_id")),
        "name": doc.get("name", "Unnamed Team"),
        "member_ids": member_ids,
        "created_by": str(doc.get("created_by") or ""),
        "members_count": len(member_ids),
        "updated_at": format_date(updated, "%Y-%m-%dT%H:%M:%S")
    }



@router.get("", response_model=List[TeamResponse])
def get_pm_teams(pm_id: Optional[str] = None):
    """
    Fetches reusable teams created by a specific Project Manager (or all teams if no pm_id specified).
    Also searches existing projects created by this PM to aggregate all unique historical teams.
    """
    db = get_db()
    col = _teams_collection()
    teams_dict = {}

    # 1. Fetch from standalone teams library collection
    query = {}
    if pm_id:
        query = {"$or": [{"created_by": pm_id}, {"created_by": {"$in": [ObjectId(pm_id)] if ObjectId.is_valid(pm_id) else []}}]}
    for doc in col.find(query):
        formatted = _format_team(doc)
        teams_dict[formatted["name"].lower().strip()] = formatted

    # 2. Also harvest historical teams from projects created by this PM
    proj_query = {}
    if pm_id:
        proj_query = {"$or": [{"created_by": pm_id}, {"created_by": ObjectId(pm_id) if ObjectId.is_valid(pm_id) else pm_id}]}
    for proj in db["projects"].find(proj_query):
        for team in proj.get("teams", []):
            name = team.get("name", "").strip()
            if not name:
                continue
            key = name.lower()
            if key not in teams_dict:
                m_ids = [str(m) for m in team.get("member_ids", [])]
                teams_dict[key] = {
                    "team_id": str(team.get("team_id") or f"TEAM-{abs(hash(name)) % 100000}"),
                    "name": name,
                    "member_ids": m_ids,
                    "created_by": pm_id or "",
                    "members_count": len(m_ids),
                    "updated_at": str(proj.get("updated_at", ""))
                }

    return list(teams_dict.values())


@router.post("", response_model=TeamResponse, status_code=201)
def save_team_to_library(payload: SaveTeamRequest):
    """
    Saves or updates a team template in the PM's reusable team library.
    """
    col = _teams_collection()
    now = datetime.utcnow()
    team_name = payload.name.strip()
    team_id = f"TEAM-{abs(hash(f'{team_name}_{payload.created_by}')) % 1000000}"

    doc = {
        "team_id": team_id,
        "name": team_name,
        "member_ids": [str(m) for m in payload.member_ids],
        "created_by": payload.created_by,
        "updated_at": now,
        "created_at": now
    }

    # Upsert by name + creator
    col.update_one(
        {"name": team_name, "created_by": payload.created_by},
        {"$set": doc},
        upsert=True
    )
    return _format_team(doc)
