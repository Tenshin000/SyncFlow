/**
 * SyncFlow Frontend - Project Manager Workspace Shared State (pm_workspace_state.js)
 * Centralizes reactive state, project document, roster map, and user resolution.
 */

// =========================================================================
// SHARED PM WORKSPACE STATE
// =========================================================================
export const pmState = {
  user: null,
  projectId: null,
  project: null,
  allUsers: [],
  userMap: new Map(),
  activeView: 1,
  activeWbsTab: "builder",
  activeSeqTab: "diagram",
  hasUnsavedWbsChanges: false,
  hasUnsavedDependencies: false,
  currentSchedule: null,
  currentControlModel: null,
  bellCtrl: null
};

/**
 * Resolves a user object by ID, username, or display name from cached project roster.
 */
export function resolveUser(uidOrHandle) {
  const key = String(uidOrHandle);
  if (pmState.userMap.has(key)) return pmState.userMap.get(key);
  // Search by username
  const byUn = pmState.allUsers.find(u => u.username === key);
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
 * Recalculates and updates headcount statistics for teams, individual members, and controllers.
 */
export function updateProjectPersonnelStats() {
  const planPersonnelStats = document.getElementById("plan-personnel-stats");
  if (!planPersonnelStats || !pmState.project) return;
  const teams = pmState.project.teams || [];
  const assignedUsers = pmState.project.assigned_user_ids || [];
  const distinctPersonnel = new Set(assignedUsers.map(String));
  teams.forEach(t => (t.member_ids || []).forEach(m => distinctPersonnel.add(String(m))));
  if (pmState.project.created_by) distinctPersonnel.add(String(pmState.project.created_by));
  planPersonnelStats.textContent = `Configured Teams: ${teams.length} • Total Allocated Contributors: ${distinctPersonnel.size}`;
}
