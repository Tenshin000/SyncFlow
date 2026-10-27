"""
SyncFlow Backend - Shared Utility Module (`backend/utility.py`).
Houses reusable helpers for MongoDB ObjectIds, date/calendar calculations,
document sanitization, and PERT statistical mathematics across backend routers and models.
"""
import math
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple, Union
from bson import ObjectId


# 1. MONGODB OBJECTID & QUERY HELPERS
def to_object_id(val: Any) -> Any:
    """Converts a value to bson.ObjectId if valid, otherwise returns stripped string or None."""
    if val is None:
        return None
    if isinstance(val, ObjectId):
        return val
    s = str(val).strip()
    return ObjectId(s) if ObjectId.is_valid(s) else s


def build_id_query(val: Any, id_field: str = "_id") -> Dict[str, Any]:
    """Builds a MongoDB filter dictionary matching an ObjectId or string ID."""
    return {id_field: to_object_id(val)}


# 2. DATE PARSING, FORMATTING & WORKING CALENDAR HELPERS
def parse_date(date_val: Any) -> Optional[date]:
    """Safely parses a datetime.date from datetime, date, or ISO/YYYY-MM-DD string."""
    if not date_val:
        return None
    if isinstance(date_val, datetime):
        return date_val.date()
    if isinstance(date_val, date):
        return date_val
    if isinstance(date_val, str):
        try:
            return datetime.strptime(date_val.split("T")[0], "%Y-%m-%d").date()
        except Exception:
            return None
    return None


def format_date(val: Any, fmt: str = "%Y-%m-%d") -> str:
    """Safely formats a date or datetime object into a string."""
    if isinstance(val, (date, datetime)):
        return val.strftime(fmt)
    return str(val or "")


def is_working_day(d: date, working_days: Optional[List[int]] = None, holidays: Optional[List[str]] = None) -> bool:
    """Evaluates whether a calendar date is an active working day."""
    w_days = working_days if (working_days and len(working_days) > 0) else [0, 1, 2, 3, 4]
    h_days = set(holidays or [])
    if d.weekday() not in w_days:
        return False
    if d.strftime("%Y-%m-%d") in h_days:
        return False
    return True


def add_working_days(
    start_d: date,
    days: float,
    working_days: Optional[List[int]] = None,
    holidays: Optional[List[str]] = None
) -> date:
    """
    Advances start_d by `days` working days according to project calendar settings.
    If days == 0, advances to the first valid working day if starting on a non-working day.
    """
    w_days = working_days if (working_days and len(working_days) > 0) else [0, 1, 2, 3, 4]
    h_days = set(holidays or [])
    curr = start_d
    guard = 0
    while not is_working_day(curr, w_days, h_days) and guard < 365:
        curr += timedelta(days=1)
        guard += 1

    whole_days = int(math.floor(max(0.0, days)))
    added = 0
    guard = 0
    max_guard = max(whole_days * 10, 3650)
    while added < whole_days and guard < max_guard:
        curr += timedelta(days=1)
        guard += 1
        if is_working_day(curr, w_days, h_days):
            added += 1
    return curr


def get_nearest_business_day(
    base_dt: Optional[date] = None,
    calendar_settings: Optional[Dict[str, Any]] = None
) -> str:
    """Returns nearest active business day string in YYYY-MM-DD format."""
    if base_dt is None:
        base_dt = date.today()
    w_days = (calendar_settings and calendar_settings.get("working_days")) or [0, 1, 2, 3, 4]
    holidays = (calendar_settings and calendar_settings.get("holidays")) or []
    return add_working_days(base_dt, 0.0, w_days, holidays).strftime("%Y-%m-%d")


# 3. DOCUMENT & WBS SANITIZATION
def clean_mongo_doc(val: Any) -> Any:
    """Recursively serializes datetimes, dates, and ObjectIds to JSON-safe primitives."""
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, ObjectId):
        return str(val)
    if isinstance(val, dict):
        return {k: clean_mongo_doc(v) for k, v in val.items()}
    if isinstance(val, list):
        return [clean_mongo_doc(x) for x in val]
    return val


# 4. PERT STATISTICAL MATHEMATICS
def calculate_pert_statistics(
    optimistic: float,
    most_likely: float,
    pessimistic: float
) -> Tuple[float, float, float]:
    """
    Computes PERT Beta distribution values:
      Expected duration Te = (O + 4M + P) / 6
      Standard deviation sigma = (P - O) / 6
      Variance = sigma^2
    """
    opt = float(optimistic or 0.0)
    ml = float(most_likely or 0.0)
    pess = float(pessimistic or 0.0)
    te = round((opt + 4.0 * ml + pess) / 6.0, 2)
    sigma = round((pess - opt) / 6.0, 3)
    var = round(sigma ** 2, 4)
    return te, sigma, var
