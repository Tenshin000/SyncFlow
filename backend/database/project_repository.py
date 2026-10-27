from datetime import datetime
from typing import Any, Dict, List, Optional
from bson import ObjectId
from backend.database.connection import get_db


class ProjectRepository:
    """
    Data Access Object for the 'projects' collection.
    Supports atomic WBS replacements (for LLM Text-to-WBS engine)
    and granular nested array updates via MongoDB arrayFilters.
    """
    def __init__(self):
        self.db = get_db()
        self.collection = self.db["projects"]

    def create_project(self, project_data: Dict[str, Any]) -> str:
        """
        Inserts a complete project document including all nested WBS levels
        (Activities -> Tasks -> Operations), Teams, and Dependencies in a single atomic write.
        """
        doc = dict(project_data)
        doc.setdefault("created_at", datetime.utcnow())
        doc.setdefault("updated_at", datetime.utcnow())
        doc.setdefault("teams", [])
        doc.setdefault("controllers", [])
        doc.setdefault("activities", [])
        doc.setdefault("dependencies", [])

        result = self.collection.insert_one(doc)
        return str(result.inserted_id)

    def get_by_id(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Fetches a project by its MongoDB ObjectId or string id."""
        try:
            query = {"_id": ObjectId(project_id)}
        except Exception:
            query = {"_id": project_id}
        return self.collection.find_one(query)

    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Fetches a project by its unique name."""
        return self.collection.find_one({"name": name})

    def list_all(self, projection: Optional[Dict[str, int]] = None) -> List[Dict[str, Any]]:
        """Returns all projects with optional field projection."""
        return list(self.collection.find({}, projection).sort("updated_at", -1))

    # LLM TEXT-TO-WBS ATOMIC UPDATE
    def update_wbs_and_dependencies(
        self,
        project_id: str,
        activities: List[Dict[str, Any]],
        dependencies: List[Dict[str, Any]]
    ) -> bool:
        """
        Single database atomic operation to replace the entire WBS hierarchy
        and dependencies when generated via the LLM Text-to-WBS engine.
        """
        try:
            filter_query = {"_id": ObjectId(project_id)}
        except Exception:
            filter_query = {"_id": project_id}

        update_query = {
            "$set": {
                "activities": activities,
                "dependencies": dependencies,
                "updated_at": datetime.utcnow()
            }
        }
        result = self.collection.update_one(filter_query, update_query)
        return result.modified_count > 0 or result.matched_count > 0

    # GRANULAR NESTED WBS MUTATIONS (Using MongoDB Array Operators)
    def add_activity(self, project_id: str, activity: Dict[str, Any]) -> bool:
        """Appends a new Level 1 Activity to the project."""
        try:
            filter_query = {"_id": ObjectId(project_id)}
        except Exception:
            filter_query = {"_id": project_id}

        activity.setdefault("tasks", [])
        result = self.collection.update_one(
            filter_query,
            {
                "$push": {"activities": activity},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )
        return result.modified_count > 0

    def add_task(self, project_id: str, activity_id: str, task: Dict[str, Any]) -> bool:
        """Appends a new Level 2 Task to a specific Activity using arrayFilters."""
        try:
            filter_query = {"_id": ObjectId(project_id)}
        except Exception:
            filter_query = {"_id": project_id}

        task.setdefault("operations", [])
        result = self.collection.update_one(
            filter_query,
            {
                "$push": {"activities.$[act].tasks": task},
                "$set": {"updated_at": datetime.utcnow()}
            },
            array_filters=[{"act.activity_id": activity_id}]
        )
        return result.modified_count > 0

    def add_operation(
        self,
        project_id: str,
        activity_id: str,
        task_id: str,
        operation: Dict[str, Any]
    ) -> bool:
        """Appends a new Level 3 Operation to a specific Task using nested arrayFilters."""
        try:
            filter_query = {"_id": ObjectId(project_id)}
        except Exception:
            filter_query = {"_id": project_id}

        result = self.collection.update_one(
            filter_query,
            {
                "$push": {"activities.$[act].tasks.$[tsk].operations": operation},
                "$set": {"updated_at": datetime.utcnow()}
            },
            array_filters=[
                {"act.activity_id": activity_id},
                {"tsk.task_id": task_id}
            ]
        )
        return result.modified_count > 0

    def add_dependency(self, project_id: str, dependency: Dict[str, Any]) -> bool:
        """Adds a project network dependency arrow, preventing duplicate links."""
        try:
            filter_query = {"_id": ObjectId(project_id)}
        except Exception:
            filter_query = {"_id": project_id}

        result = self.collection.update_one(
            filter_query,
            {
                "$addToSet": {"dependencies": dependency},
                "$set": {"updated_at": datetime.utcnow()}
            }
        )
        return result.modified_count > 0

    def delete_project(self, project_id: str) -> bool:
        """Removes a project document from the database."""
        try:
            filter_query = {"_id": ObjectId(project_id)}
        except Exception:
            filter_query = {"_id": project_id}

        result = self.collection.delete_one(filter_query)
        return result.deleted_count > 0
