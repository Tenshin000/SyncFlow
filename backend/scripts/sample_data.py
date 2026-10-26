"""
Realistic seed data for Users, Teams, WBS Hierarchy (L1 -> L2 -> L3), and Dependencies.
"""
from datetime import datetime, date

SEED_USERS = [
    {
        "username": "pm_alice",
        "password": "Password123!",
        "first_name": "Alice",
        "last_name": "Vance",
        "date_of_birth": datetime(1988, 5, 14),
        "is_admin": True,
        "role": "Project Manager",
        "email": "alice.vance@company.com",
        "mobile_phone": "+1-555-0144"
    },
    {
        "username": "dev_bob",
        "password": "Password123!",
        "first_name": "Bob",
        "last_name": "Miller",
        "date_of_birth": datetime(1994, 9, 21),
        "is_admin": False,
        "role": "Developer",
        "email": "bob.miller@company.com",
        "mobile_phone": "+1-555-0178"
    },
    {
        "username": "ctrl_carol",
        "password": "Password123!",
        "first_name": "Carol",
        "last_name": "Danvers",
        "date_of_birth": datetime(1991, 12, 3),
        "is_admin": False,
        "role": "Project Controller",
        "email": "carol.danvers@company.com",
        "mobile_phone": "+1-555-0192"
    }
]


def build_sample_project(user_ids_by_username: dict) -> dict:
    """Constructs a complete project document with nested WBS and dependencies."""
    alice_id = user_ids_by_username.get("pm_alice", "USER-ALICE")
    bob_id = user_ids_by_username.get("dev_bob", "USER-BOB")
    carol_id = user_ids_by_username.get("ctrl_carol", "USER-CAROL")

    return {
        "name": "SyncFlow Schedule Management Platform",
        "description": "SyncFlow is an enterprise web application utilizing NLP and LLMs to automate Work Breakdown Structure creation and project network scheduling.",
        "created_by": alice_id,
        "teams": [
            {
                "team_id": "TEAM-ENG",
                "name": "Core Engineering Team",
                "member_ids": [bob_id, alice_id]
            },
            {
                "team_id": "TEAM-QA",
                "name": "Quality Assurance Team",
                "member_ids": [carol_id]
            }
        ],
        "activities": [
            {
                "activity_id": "ACT-1.0",
                "name": "Requirement Analysis & Architecture",
                "description": "Define business specifications, data schemas, and containerized runtime architecture.",
                "start_date": datetime(2026, 10, 12),
                "estimated_end_date": datetime(2026, 10, 16),
                "actual_end_date": None,
                "optimistic_time": 3.0,
                "most_likely_time": 5.0,
                "pessimistic_time": 8.0,
                "tasks": [
                    {
                        "task_id": "TSK-1.1",
                        "name": "Stakeholder Elicitation & NLP Scoping",
                        "description": "Gather requirements from project management team and establish Text-to-WBS criteria.",
                        "task_type": "Analysis",
                        "assigned_to": {
                            "type": "User",
                            "id": alice_id
                        },
                        "controller_id": carol_id,
                        "start_date": datetime(2026, 10, 12),
                        "estimated_end_date": datetime(2026, 10, 14),
                        "actual_end_date": datetime(2026, 10, 14),
                        "operations": [
                            {
                                "operation_id": "OP-1.1.1",
                                "name": "Conduct PM interviews",
                                "description": "Meet with lead project managers to document manual scheduling pain points.",
                                "assigned_to": {"type": "User", "id": alice_id},
                                "status": "Finished",
                                "link_type": "Sequential"
                            },
                            {
                                "operation_id": "OP-1.1.2",
                                "name": "Synthesize Project Charter templates",
                                "description": "Prepare realistic sample project charter inputs for LLM prompt testing.",
                                "assigned_to": {"type": "User", "id": alice_id},
                                "status": "Finished",
                                "link_type": "Sequential"
                            }
                        ]
                    },
                    {
                        "task_id": "TSK-1.2",
                        "name": "NoSQL Database & Container Architecture",
                        "description": "Design MongoDB document schema and Docker multi-service deployment.",
                        "task_type": "Architecture",
                        "assigned_to": {
                            "type": "Team",
                            "id": "TEAM-ENG"
                        },
                        "controller_id": carol_id,
                        "start_date": datetime(2026, 10, 14),
                        "estimated_end_date": datetime(2026, 10, 16),
                        "actual_end_date": None,
                        "operations": [
                            {
                                "operation_id": "OP-1.2.1",
                                "name": "Define MongoDB $jsonSchema validators",
                                "description": "Specify BSON schema constraints for users and projects collections.",
                                "assigned_to": {"type": "User", "id": bob_id},
                                "status": "Finished",
                                "link_type": "Parallel"
                            },
                            {
                                "operation_id": "OP-1.2.2",
                                "name": "Configure Docker Compose & Mongo Express",
                                "description": "Set up multi-container environment with persistent volume storage.",
                                "assigned_to": {"type": "User", "id": bob_id},
                                "status": "Work-in-Progress",
                                "link_type": "Parallel"
                            }
                        ]
                    }
                ]
            },
            {
                "activity_id": "ACT-2.0",
                "name": "Core Application & NLP Development",
                "description": "Implement Streamlit frontend, PyMongo repositories, and Gemini structured output parser.",
                "start_date": datetime(2026, 10, 17),
                "estimated_end_date": datetime(2026, 10, 24),
                "actual_end_date": None,
                "optimistic_time": 7.0,
                "most_likely_time": 10.0,
                "pessimistic_time": 16.0,
                "tasks": [
                    {
                        "task_id": "TSK-2.1",
                        "name": "Streamlit GUI & Visualizers",
                        "description": "Develop multi-phase UI views and Graphviz tree/network chart renderers.",
                        "task_type": "Frontend",
                        "assigned_to": {
                            "type": "User",
                            "id": bob_id
                        },
                        "controller_id": carol_id,
                        "start_date": datetime(2026, 10, 17),
                        "estimated_end_date": datetime(2026, 10, 21),
                        "actual_end_date": None,
                        "operations": [
                            {
                                "operation_id": "OP-2.1.1",
                                "name": "Build Plan & Define Activities GUI",
                                "description": "Create collapsible nested expanders for Activities, Tasks, Operations.",
                                "assigned_to": {"type": "User", "id": bob_id},
                                "status": "Not Started",
                                "link_type": "Sequential"
                            },
                            {
                                "operation_id": "OP-2.1.2",
                                "name": "Render Graphviz TB Tree and LR Precedence Network",
                                "description": "Dynamic DOT visualizers for hierarchy and dependency graph.",
                                "assigned_to": {"type": "User", "id": bob_id},
                                "status": "Not Started",
                                "link_type": "Parallel"
                            }
                        ]
                    },
                    {
                        "task_id": "TSK-2.2",
                        "name": "Text-to-WBS LLM Engine",
                        "description": "Build prompt pipeline with structured outputs enforcing MongoDB WBS schema.",
                        "task_type": "NLP/AI",
                        "assigned_to": {
                            "type": "User",
                            "id": bob_id
                        },
                        "controller_id": carol_id,
                        "start_date": datetime(2026, 10, 22),
                        "estimated_end_date": datetime(2026, 10, 24),
                        "actual_end_date": None,
                        "operations": [
                            {
                                "operation_id": "OP-2.2.1",
                                "name": "Implement Gemini/OpenAI Structured Output Call",
                                "description": "Send unstructured text charter with JSON schema to LLM API.",
                                "assigned_to": {"type": "User", "id": bob_id},
                                "status": "Not Started",
                                "link_type": "Sequential"
                            },
                            {
                                "operation_id": "OP-2.2.2",
                                "name": "Persist extracted WBS to MongoDB via atomic update",
                                "description": "Direct insertion of parsed JSON into active project document.",
                                "assigned_to": {"type": "User", "id": bob_id},
                                "status": "Not Started",
                                "link_type": "Sequential"
                            }
                        ]
                    }
                ]
            },
            {
                "activity_id": "ACT-3.0",
                "name": "Testing, Deployment & Documentation",
                "description": "Perform end-to-end user verification and draft academic project report.",
                "start_date": datetime(2026, 10, 24),
                "estimated_end_date": datetime(2026, 10, 26),
                "actual_end_date": None,
                "optimistic_time": 2.0,
                "most_likely_time": 3.0,
                "pessimistic_time": 5.0,
                "tasks": [
                    {
                        "task_id": "TSK-3.1",
                        "name": "Quality Validation & Report Writing",
                        "description": "Comprehensive functional testing and drafting the 6-12 page research paper.",
                        "task_type": "Documentation",
                        "assigned_to": {
                            "type": "Team",
                            "id": "TEAM-QA"
                        },
                        "controller_id": alice_id,
                        "start_date": datetime(2026, 10, 24),
                        "estimated_end_date": datetime(2026, 10, 26),
                        "actual_end_date": None,
                        "operations": [
                            {
                                "operation_id": "OP-3.1.1",
                                "name": "Validate Critical Path & PERT Calculations",
                                "description": "Verify calculation accuracy across cyclic/acyclic dependency tests.",
                                "assigned_to": {"type": "User", "id": carol_id},
                                "status": "Not Started",
                                "link_type": "Parallel"
                            },
                            {
                                "operation_id": "OP-3.1.2",
                                "name": "Compile 6-12 Page Academic Report & Slides",
                                "description": "Write Introduction, Process, and Results sections for final evaluation.",
                                "assigned_to": {"type": "User", "id": alice_id},
                                "status": "Not Started",
                                "link_type": "Sequential"
                            }
                        ]
                    }
                ]
            }
        ],
        "dependencies": [
            {
                "from_activity_id": "ACT-1.0",
                "to_activity_id": "ACT-2.0",
                "type": "Finish-to-Start (FS)"
            },
            {
                "from_activity_id": "ACT-2.0",
                "to_activity_id": "ACT-3.0",
                "type": "Finish-to-Start (FS)"
            }
        ]
    }
