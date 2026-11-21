/**
 * SyncFlow Frontend - Member Workspace Shared State (member_workspace_state.js)
 * Centralizes reactive state, user directory cache, and activity permission evaluators.
 */

import { fetchAllUsers } from "./api.js";
import { getUserActivityPermission as getUserActivityPermissionUtil } from "./utility.js";

// =========================================================================
// SHARED MEMBER WORKSPACE STATE
// =========================================================================
export const memberState = {
  rawUser: null,
  user: null,
  userId: null,
  userRole: "",
  isController: false,
  participatingProjects: [],
  allSearchProjects: [],
  activeProjectId: null,
  activeProject: null,
  currentControlModel: null,
  currentSearchFilter: "all",
  bellCtrl: null,
  agendaFilter: "active",
  agendaViewMode: "table",
  allUsers: [],
  userMap: new Map(),
  activeTimerState: null, // { projectId, activityId, activityName, startTimeMs, notes }
  stopwatchTimerInterval: null
};

// =========================================================================
// USER RESOLUTION & ROSTER CACHE
// =========================================================================

/**
 * Resolves a user object by ID, username, or display name from cached roster.
 */
export function resolveUser(uidOrHandle) {
  const key = String(uidOrHandle || "");
  if (memberState.userMap.has(key)) return memberState.userMap.get(key);
  const byUn = memberState.allUsers.find(u => u.username === key);
  if (byUn) return byUn;
  return {
    first_name: "Contributor",
    last_name: key,
    role: "Member",
    email: "—",
    username: key
  };
}

/**
 * Fetches and caches project/system users for resolving activity staff names.
 * Maps both ID and username for instantaneous O(1) roster lookups.
 */
export async function ensureUsersLoaded() {
  if (memberState.userMap.size > 0) return;
  try {
    const res = await fetchAllUsers();
    if (res && res.data) {
      memberState.allUsers = res.data;
      memberState.allUsers.forEach(u => {
        const uid = String(u.id || u._id || "");
        if (uid) memberState.userMap.set(uid, u);
        if (u.username) memberState.userMap.set(u.username, u);
      });
    }
  } catch (err) {
    console.warn("Could not load users map:", err);
  }
}

// =========================================================================
// ACTIVITY & CONTROLLER PERMISSION HELPERS
// =========================================================================

/**
 * Determines whether the current user holds controller permissions for the project or activity.
 * If an activity is provided, only the Project Manager (Lead Controller) or the specifically appointed
 * controller for that activity holds controller permissions.
 */
export function isUserController(act = null) {
  const isLeadPM = Boolean(memberState.activeProject && String(memberState.activeProject.created_by) === String(memberState.userId)) || Boolean(memberState.user && memberState.user.is_admin);
  const isProjController = Boolean(memberState.activeProject && (memberState.activeProject.controllers || []).map(String).includes(String(memberState.userId)));

  if (act) {
    if (isLeadPM) return true;
    return isProjController && String(act.controller_id || "") === String(memberState.userId);
  }
  return isLeadPM || isProjController;
}

export function getUserActivityPermission(act) {
  return getUserActivityPermissionUtil(act, memberState.user, memberState.activeProject);
}

/**
 * Evaluates whether an activity is assigned to the current user directly, via team membership, or as appointed Controller.
 * Integrates the Controller as an active member of the activity staff.
 */
export function isActAssignedToUser(act) {
  if (!act) return false;

  // 1. Appointed Controller for this activity (Controller is part of the activity staff)
  if (isUserController(act)) {
    return true;
  }

  // 2. Direct individual assignment
  const assignedUsers = (act.assigned_users || []).map(String);
  if (assignedUsers.includes(String(memberState.userId)) || (memberState.user.username && assignedUsers.includes(memberState.user.username))) {
    return true;
  }
  const myTeamIds = new Set();
  if (memberState.activeProject && memberState.activeProject.teams) {
    memberState.activeProject.teams.forEach(t => {
      const mIds = (t.member_ids || []).map(String);
      const isLead = String(t.lead_id || "") === String(memberState.userId);
      if (mIds.includes(String(memberState.userId)) || isLead) {
        myTeamIds.add(String(t.team_id || ""));
        myTeamIds.add(String(t.name || ""));
      }
    });
  }
  const assignedTeams = (act.assigned_teams || []).map(String);
  for (const t of assignedTeams) {
    if (myTeamIds.has(t)) return true;
  }
  return false;
}

/**
 * Evaluates whether an activity is assigned to the current user for timer tracking.
 * Considers direct individual assignment, assigned team membership/lead, appointed activity controller, or PM.
 */
export function isActAssignedForTimer(act) {
  if (!act) return false;

  // 1. Direct individual assignment
  const assignedUsers = (act.assigned_users || []).map(String);
  if (assignedUsers.includes(String(memberState.userId)) || (memberState.user.username && assignedUsers.includes(memberState.user.username))) {
    return true;
  }

  // 2. Team membership & Team Lead on assigned teams
  if (memberState.activeProject && memberState.activeProject.teams) {
    const assignedTeams = (act.assigned_teams || []).map(String);
    for (const t of memberState.activeProject.teams) {
      const tId = String(t.team_id || "");
      const tName = String(t.name || "");
      if (assignedTeams.includes(tId) || assignedTeams.includes(tName)) {
        const mIds = (t.member_ids || []).map(String);
        if (mIds.includes(String(memberState.userId))) return true;
        if (t.lead_id && String(t.lead_id) === String(memberState.userId)) return true;
      }
    }
  }

  // 3. Appointed Activity Controller or PM / Lead Controller
  if (isUserController(act)) {
    return true;
  }

  // 4. Open collaboration if task is completely unassigned
  if (!assignedUsers.length && !(act.assigned_teams || []).length && !act.controller_id) {
    return true;
  }

  return false;
}
