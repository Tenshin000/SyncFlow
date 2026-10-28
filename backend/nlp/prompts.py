"""
SyncFlow – Gemini Flash Prompt Engineering & DCMA Guardrails.
Constructs precision prompts with context injection, few-shot examples, and DCMA 14-point audit compliance.
"""
from typing import Dict, Any, List, Optional

WBS_SYSTEM_INSTRUCTION = """You are an elite PMI-certified Project Management Professional (PMP) and Work Breakdown Structure (WBS) architect.
Your objective is to ingest unstructured project charter narratives, scopes, and notes, and decompose them into a formal, PMBOK-compliant Work Breakdown Structure.

CRITICAL WBS PRINCIPLES:
1. 100% RULE: The WBS must cover 100% of the work defined by the project scope, without gaps or out-of-scope work.
2. MUTUALLY EXCLUSIVE: Elements at the same hierarchy level must not overlap.
3. HIERARCHY: Major Deliverable (Level 1, noun phrase) -> Work Package (Level 2, concrete deliverable) -> Activities (Level 3, Action Verb + Object).
4. SIZING & DCMA COMPLIANCE: Work packages and activities must be manageable chunks. Activity durations MUST NOT exceed 44 business days (DCMA Metric 6).
5. PERT THREE-POINT ESTIMATES: Provide realistic values: optimistic (a), most likely (m), and pessimistic (b) in business days strictly enforcing STRICT INEQUALITY: 0.5 <= a < m < b <= 44.0. Never set optimistic and most likely to the same value (a and m must NEVER be identical; keep at least 1.0 day difference).
6. Return purely valid JSON strictly matching the requested schema. Do not wrap in markdown or prose.
"""

ESTIMATION_SYSTEM_INSTRUCTION = """You are a Defense Contract Management Agency (DCMA) 14-Point Schedule Quality Diagnostic Auditor and PERT estimating expert.
Your mission is to evaluate project activities and calculate realistic, defense-grade 3-point PERT duration estimates (Optimistic 'a', Most Likely 'm', Pessimistic 'b').

DCMA 14-POINT AUDIT GUARDRAILS:
1. METRIC 6 (HIGH DURATION): No activity duration (expected or pessimistic) should exceed 44 business days. High duration activities distort the critical path.
2. METRIC 7 (ZERO DURATION): Durations must be strictly greater than 0, unless the activity is a true milestone gate.
3. BETA DISTRIBUTION INTEGRITY: Always enforce STRICT INEQUALITY 0.5 <= a < m < b <= 44.0. Optimistic and most likely must NEVER be identical (strictly a < m < b with at least 1.0 day between each estimate).
4. Provide a defensible, professional engineering rationale explaining risk factors, uncertainties, and complexity.
5. Return purely valid JSON matching the requested schema.
"""

DEPENDENCY_SYSTEM_INSTRUCTION = """You are a Critical Path Method (CPM) Network Precedence Scheduling Engineer.
Your task is to analyze project activities and narrative descriptions to construct a complete, cycle-free Precedence Diagram Method (PDM) network.

CPM & DCMA 14-POINT AUDIT GUARDRAILS:
1. METRIC 1 (LOGIC): Establish clear logical dependencies. Avoid dangling activities.
2. METRIC 2 (LEADS): Negative lags are STRICTLY FORBIDDEN. All lag_days must be >= 0.
3. METRIC 3 (LAGS): Minimize lags. Lags must not exceed 5 business days without physical/curing justification.
4. METRIC 4 (RELATIONSHIP TYPES): At least 90% of relationships should be Finish-to-Start (FS). Use SS, FF, or SF only when technically justified.
5. NO CYCLIC LOOPS: A precedence path must never loop back to an earlier activity.
6. STRICT ACTIVITY ID REFERENCES: You MUST only connect activity IDs that exist in the provided list. Do not invent activity IDs.
7. Return purely valid JSON matching the requested schema.
"""


def build_wbs_prompt(
    project_name: str,
    project_description: str,
    scope_text: str,
    custom_prompt: Optional[str] = None,
    existing_wbs: Optional[List[Dict[str, Any]]] = None
) -> str:
    """Builds the comprehensive context prompt for Text-to-WBS generation."""
    existing_summary = ""
    if existing_wbs:
        nodes = []
        for d in existing_wbs:
            nodes.append(f"- Deliverable {d.get('wbs_number', '')}: {d.get('name', '')}")
            for c in d.get("children", []):
                nodes.append(f"  * Work Package {c.get('wbs_number', '')}: {c.get('name', '')}")
        existing_summary = "\nEXISTING WBS NODES IN PROJECT (Preserve logic and append harmoniously):\n" + "\n".join(nodes[:20])

    prompt = f"""PROJECT CONTEXT:
Project Title: {project_name}
Project Overview: {project_description or 'No overview provided.'}
{existing_summary}

UNSTRUCTURED PROJECT SCOPE / CHARTER TEXT TO DECOMPOSE:
\"\"\"
{scope_text.strip()}
\"\"\"
"""
    if custom_prompt and custom_prompt.strip():
        prompt += f"""
PROJECT MANAGER SPECIFIC INSTRUCTIONS:
\"\"\"
{custom_prompt.strip()}
\"\"\"
"""

    prompt += """
TASK:
Decompose the scope into 2 to 4 Major Deliverables.
Each Major Deliverable must contain 1 to 3 Work Packages.
Each Work Package must directly contain 1 to 3 discrete, concrete Activities (PMBOK Level 3).

CRITICAL REQUIREMENTS:
1. MAJOR DELIVERABLE TITLES: MUST be descriptive, domain-specific PMBOK Level 1 noun phrases reflecting the actual scope (e.g., "System Architecture & Infrastructure Foundation", "Core Scheduling Engine & Logic Services", "User Interface & Interactive Gantt Views", "Quality Assurance & Production Release").
   STRICT REQUIREMENT: NEVER use generic numbered names like "Deliverable 1", "Deliverable 2", "Derivable 1", "Phase 1", or "Major Deliverable 1". Every deliverable MUST have a real, meaningful, professional name based on the project scope!
2. WORK PACKAGE TITLES: MUST be concrete Level 2 component titles (e.g., "API Gateway & Security Services", "Relational Database Schema & Persistence", "Interactive Gantt Chart Component"). NEVER use generic numbered names like "Work Package 1.1".
3. ACTIVITY NAMES: MUST be specific, action-oriented verb + noun phrases (e.g., 'Architect Relational Schema & Indices', 'Develop OAuth2 Authentication & Session Middleware', 'Build Real-time WebSocket Gateway', 'Conduct System Integration & Load Testing'). Never generate generic placeholders or repetitive stubs.
4. Provide realistic DCMA 14-point 3-point duration estimates in business days:
   - optimistic_days (a)
   - most_likely_days (m)
   - pessimistic_days (b)
   - Must strictly satisfy: 0.5 <= a < m < b <= 44.0 days. Ensure a < m < b with at least 1.0 day difference between them (e.g. a=2.0, m=4.0, b=7.0). Never set a and m to the same value.
5. For each activity, include 1 to 3 concise execution task steps in the "tasks" array (e.g., ["Define schema contracts", "Write migration scripts"]).
6. Every work package MUST have its "activities" list populated.

REQUIRED JSON STRUCTURE:
{
  "major_deliverables": [
    {
      "wbs_number": "1",
      "name": "System Architecture & Security Foundation",
      "description": "Core infrastructure, database persistence models, and authentication services",
      "work_packages": [
        {
          "wbs_number": "1.1",
          "name": "Database & Data Access Layer",
          "description": "Relational schemas, migrations, and repository implementations",
          "activities": [
            {
              "name": "Design Relational Schema & Migration Pipeline",
              "description": "Model database entities, foreign key relationships, and automated migration scripts",
              "work_package_ref": "1.1",
              "is_milestone": false,
              "optimistic_days": 2.0,
              "most_likely_days": 4.0,
              "pessimistic_days": 7.0,
              "tasks": [
                "Draft entity relationship diagrams",
                "Implement database migration scripts",
                "Execute schema validation tests"
              ]
            }
          ]
        }
      ]
    },
    {
      "wbs_number": "2",
      "name": "Core Scheduling Engine & Algorithms",
      "description": "Critical path calculation engine, calendar models, and schedule analysis services",
      "work_packages": [
        {
          "wbs_number": "2.1",
          "name": "Critical Path Method (CPM) Processing",
          "description": "Forward/backward pass calculation, slack analysis, and topological sorting",
          "activities": [
            {
              "name": "Implement Forward and Backward Pass Algorithm",
              "description": "Calculate early start/finish and late start/finish dates across precedence network",
              "work_package_ref": "2.1",
              "is_milestone": false,
              "optimistic_days": 3.0,
              "most_likely_days": 5.0,
              "pessimistic_days": 8.0,
              "tasks": [
                "Implement topological sorter",
                "Code forward pass early dates calculation",
                "Code backward pass late dates calculation"
              ]
            }
          ]
        }
      ]
    }
  ],
  "activities": []
}
Output strictly valid JSON matching the schema.
"""
    return prompt



def build_estimation_prompt(
    project_name: str,
    project_description: str,
    activities: List[Dict[str, Any]],
    custom_prompt: Optional[str] = None
) -> str:
    """Builds the context prompt for DCMA 14-Point PERT duration estimating."""
    act_lines = []
    for a in activities:
        aid = a.get("activity_id")
        name = a.get("name", "Unnamed")
        desc = a.get("description", "")
        curr_d = a.get("duration", "Not set")
        act_lines.append(f"- ID: {aid} | Name: '{name}' | Description: '{desc}' | Current Duration: {curr_d}")

    prompt = f"""PROJECT CONTEXT:
Project Title: {project_name}
Project Overview: {project_description or 'No overview provided.'}

ACTIVITIES REQUIRING ESTIMATION (Count: {len(activities)}):
{chr(10).join(act_lines)}
"""

    if custom_prompt and custom_prompt.strip():
        prompt += f"""
PROJECT MANAGER GUIDANCE:
\"\"\"
{custom_prompt.strip()}
\"\"\"
"""

    prompt += """
TASK:
Provide realistic 3-point PERT estimates enforcing strict inequality:
- optimistic (a): Best-case business days (strictly a < m, min 0.5)
- most_likely (m): Normal expected business days (strictly a < m < b)
- pessimistic (b): Worst-case business days including risks (strictly m < b <= 44.0 days)
- rationale: Technical risk justification
"""
    return prompt


def build_dependency_prompt(
    project_name: str,
    project_description: str,
    activities: List[Dict[str, Any]],
    narrative_text: Optional[str] = None,
    custom_prompt: Optional[str] = None
) -> str:
    """Builds the context prompt for CPM precedence relationship extraction."""
    act_lines = []
    for a in activities:
        aid = a.get("activity_id")
        name = a.get("name", "Unnamed")
        wp = a.get("work_package_id", "")
        act_lines.append(f"- ID: {aid} | Name: '{name}' | Work Package: '{wp}'")

    prompt = f"""PROJECT CONTEXT:
Project Title: {project_name}
Project Overview: {project_description or 'No overview provided.'}

AVAILABLE PROJECT ACTIVITIES (You may ONLY connect these IDs):
{chr(10).join(act_lines)}
"""

    if narrative_text and narrative_text.strip():
        prompt += f"""
SCOPE / HANDOFF NARRATIVE:
\"\"\"
{narrative_text.strip()}
\"\"\"
"""

    if custom_prompt and custom_prompt.strip():
        prompt += f"""
PROJECT MANAGER SCHEDULING INSTRUCTIONS:
\"\"\"
{custom_prompt.strip()}
\"\"\"
"""

    prompt += """
TASK:
Extract logical precedence dependencies connecting these activities into a coherent CPM network.
- Predominantly use 'FS' (Finish-to-Start)
- Set lag_days >= 0 (no negative lags)
- Ensure every activity except start/finish gates has predecessors and successors
- Never produce circular loops
- Reference only valid activity IDs from the list above.
"""
    return prompt
