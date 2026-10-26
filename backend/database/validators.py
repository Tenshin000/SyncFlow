"""
MongoDB JSON Schema Validation Rules.
Defines $jsonSchema specifications for the 'users' and 'projects' collections.
"""

ASSIGNMENT_TYPES = ["User", "Team"]

OPERATION_STATUSES = ["Not Started", "Work-in-Progress", "Finished"]

OPERATION_LINK_TYPES = ["Sequential", "Parallel"]

DEPENDENCY_TYPES = [
    "Finish-to-Start (FS)",
    "Start-to-Finish (SF)",
    "Start-to-Start (SS)",
    "Finish-to-Finish (FF)",
    "NULL",
]

# ==============================================================================
# 1. USERS COLLECTION VALIDATOR SCHEMA
# ==============================================================================
USERS_COLLECTION_VALIDATOR = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["first_name", "last_name", "date_of_birth", "is_admin", "username", "password_hash"],
        "additionalProperties": True,
        "properties": {
            "_id": {
                "bsonType": "objectId"
            },
            "username": {
                "bsonType": "string",
                "description": "Unique username used for authentication"
            },
            "password_hash": {
                "bsonType": "string",
                "description": "Bcrypt hashed password"
            },
            "first_name": {
                "bsonType": "string",
                "description": "User first name (required string)"
            },
            "last_name": {
                "bsonType": "string",
                "description": "User last name (required string)"
            },
            "gender": {
                "bsonType": ["string", "null"],
                "enum": ["Male", "Female", "Other", None],
                "description": "User gender designation (Male, Female, Other)"
            },
            "date_of_birth": {
                "bsonType": "date",
                "description": "User date of birth (required Date)"
            },
            "is_admin": {
                "bsonType": "bool",
                "description": "True if the user is a Project Manager/Admin"
            },
            "email": {
                "bsonType": ["string", "null"],
                "description": "Optional contact email address"
            },
            "mobile_phone": {
                "bsonType": ["string", "null"],
                "description": "Optional contact mobile phone number (E.164 or national format)"
            },
            "created_at": {
                "bsonType": "date",
                "description": "Timestamp of account creation"
            }
        }
    }
}

# ==============================================================================
# 2. PROJECTS COLLECTION VALIDATOR SCHEMA
# ==============================================================================
PROJECTS_COLLECTION_VALIDATOR = {
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["name", "description", "activities", "dependencies"],
        "additionalProperties": True,
        "properties": {
            "_id": {
                "bsonType": "objectId"
            },
            "name": {
                "bsonType": "string",
                "description": "Project title (required string)"
            },
            "description": {
                "bsonType": "string",
                "description": "Project charter / scope statement (required string)"
            },
            "created_by": {
                "bsonType": ["objectId", "string", "null"],
                "description": "Reference to the User who created the project"
            },
            "start_date": {
                "bsonType": ["date", "null"],
                "description": "Planned project start date"
            },
            "created_at": {
                "bsonType": "date"
            },
            "updated_at": {
                "bsonType": "date"
            },
            "assigned_user_ids": {
                "bsonType": "array",
                "description": "List of all User IDs individually participating in the project",
                "items": {
                    "bsonType": ["objectId", "string"]
                }
            },
            # TEAMS ARRAY
            "teams": {
                "bsonType": "array",
                "description": "Teams assigned to the project",
                "items": {
                    "bsonType": "object",
                    "required": ["team_id", "name", "member_ids"],
                    "properties": {
                        "team_id": {
                            "bsonType": ["string", "objectId"],
                            "description": "Unique identifier for the team"
                        },
                        "name": {
                            "bsonType": "string",
                            "description": "Team designation / department name"
                        },
                        "member_ids": {
                            "bsonType": "array",
                            "description": "List of User ObjectIds or String IDs participating in this team",
                            "items": {
                                "bsonType": ["objectId", "string"]
                            }
                        }
                    }
                }
            },
            # CONTROLLERS ARRAY
            "controllers": {
                "bsonType": "array",
                "description": "List of User ObjectIds or String IDs designated as project controllers",
                "items": {
                    "bsonType": ["objectId", "string"]
                }
            },
            # WBS LEVEL 1: ACTIVITIES
            "activities": {
                "bsonType": "array",
                "description": "Level 1 of WBS: Major project phases or deliverables",
                "items": {
                    "bsonType": "object",
                    "required": ["activity_id", "name", "tasks"],
                    "properties": {
                        "activity_id": {
                            "bsonType": ["string", "objectId"],
                            "description": "Unique identifier for Activity (e.g. ACT-1.0)"
                        },
                        "name": {
                            "bsonType": "string",
                            "description": "Activity name"
                        },
                        "description": {
                            "bsonType": ["string", "null"],
                            "description": "Activity scope summary"
                        },
                        "start_date": {
                            "bsonType": ["date", "null"],
                            "description": "Planned start date"
                        },
                        "estimated_end_date": {
                            "bsonType": ["date", "null"],
                            "description": "Planned finish date"
                        },
                        "actual_end_date": {
                            "bsonType": ["date", "null"],
                            "description": "Actual completion date (nullable)"
                        },
                        "optimistic_time": {
                            "bsonType": ["double", "int", "long", "null"],
                            "description": "PERT Optimistic time (O)"
                        },
                        "most_likely_time": {
                            "bsonType": ["double", "int", "long", "null"],
                            "description": "PERT Most Likely time (M)"
                        },
                        "pessimistic_time": {
                            "bsonType": ["double", "int", "long", "null"],
                            "description": "PERT Pessimistic time (P)"
                        },
                        # WBS LEVEL 2: TASKS
                        "tasks": {
                            "bsonType": "array",
                            "description": "Level 2 of WBS: Work packages subordinate to Activity",
                            "items": {
                                "bsonType": "object",
                                "required": ["task_id", "name", "operations"],
                                "properties": {
                                    "task_id": {
                                        "bsonType": ["string", "objectId"],
                                        "description": "Unique identifier for Task (e.g. TSK-1.1)"
                                    },
                                    "name": {
                                        "bsonType": "string",
                                        "description": "Task name"
                                    },
                                    "description": {
                                        "bsonType": ["string", "null"],
                                        "description": "Task details"
                                    },
                                    "task_type": {
                                        "bsonType": ["string", "null"],
                                        "description": "Classification (e.g. Engineering, Documentation)"
                                    },
                                    "assigned_to": {
                                        "bsonType": ["object", "null"],
                                        "description": "Polymorphic reference to User or Team",
                                        "properties": {
                                            "type": {
                                                "enum": ASSIGNMENT_TYPES,
                                                "description": "Either 'User' or 'Team'"
                                            },
                                            "id": {
                                                "bsonType": ["objectId", "string"],
                                                "description": "Target User or Team identifier"
                                            }
                                        }
                                    },
                                    "controller_id": {
                                        "bsonType": ["objectId", "string", "null"],
                                        "description": "Reference to the User who reviews and validates completion"
                                    },
                                    "start_date": {
                                        "bsonType": ["date", "null"],
                                        "description": "Planned start date"
                                    },
                                    "estimated_end_date": {
                                        "bsonType": ["date", "null"],
                                        "description": "Estimated finish date"
                                    },
                                    "actual_end_date": {
                                        "bsonType": ["date", "null"],
                                        "description": "Actual finish date (nullable)"
                                    },
                                    # WBS LEVEL 3: OPERATIONS
                                    "operations": {
                                        "bsonType": "array",
                                        "description": "Level 3 of WBS: Discrete execution steps",
                                        "items": {
                                            "bsonType": "object",
                                            "required": ["operation_id", "name", "status", "link_type"],
                                            "properties": {
                                                "operation_id": {
                                                    "bsonType": ["string", "objectId"],
                                                    "description": "Unique identifier for Operation (e.g. OP-1.1.1)"
                                                },
                                                "name": {
                                                    "bsonType": "string",
                                                    "description": "Operation action name"
                                                },
                                                "description": {
                                                    "bsonType": ["string", "null"],
                                                    "description": "Step instruction"
                                                },
                                                "assigned_to": {
                                                    "bsonType": ["object", "null"],
                                                    "description": "Polymorphic reference to User or Team",
                                                    "properties": {
                                                        "type": {
                                                            "enum": ASSIGNMENT_TYPES
                                                        },
                                                        "id": {
                                                            "bsonType": ["objectId", "string"]
                                                        }
                                                    }
                                                },
                                                "status": {
                                                    "enum": OPERATION_STATUSES,
                                                    "description": "Execution status"
                                                },
                                                "link_type": {
                                                    "enum": OPERATION_LINK_TYPES,
                                                    "description": "Sequence relation within the task"
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            # DEPENDENCIES (PROJECT NETWORK LOGIC)
            "dependencies": {
                "bsonType": "array",
                "description": "Precedence links between Activities",
                "items": {
                    "bsonType": "object",
                    "required": ["from_activity_id", "to_activity_id", "type"],
                    "properties": {
                        "from_activity_id": {
                            "bsonType": ["string", "objectId"],
                            "description": "Source Activity identifier"
                        },
                        "to_activity_id": {
                            "bsonType": ["string", "objectId"],
                            "description": "Destination Activity identifier"
                        },
                        "type": {
                            "enum": DEPENDENCY_TYPES,
                            "description": "Dependency relationship type"
                        }
                    }
                }
            }
        }
    }
}
