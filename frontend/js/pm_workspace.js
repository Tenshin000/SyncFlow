/**
 * SyncFlow Frontend - Project Manager Workspace Controller (pm_workspace.js)
 * Controls the 6 PMBOK process views, Plan Schedule Management,
 * Personnel modal with Controllers, and Vis-Network graph visualizations.
 */

import {
  fetchProjectDetail,
  updateProjectDescription,
  fetchAllUsers,
  updateProjectPersonnel,
  updateProjectDeliverables,
  updateProjectActivities,
  updateProjectWbs,
  updateProjectDependencies,
  fetchScheduleHealth,
  fetchPertAnalysis,
  fetchCompletedActivities,
  fetchProjectSchedule,
  updateProjectScheduleSettings,
  fetchControlSchedule,
  updateActivityStatus,
  seedProjectProgress,
  createBaseline,
  fetchBaselines,
  deleteBaseline,
  fetchDcmaQuality,
  aiGenerateWbs,
  aiEstimateDurations,
  aiExtractDependencies,
  fetchActivityTimeLogs,
  fetchProjectTimeLogsSummary
} from "./api.js";
import { requireAuth, logout } from "./auth.js";
import { renderWbsTree, renderNetworkDiagram } from "./visualizations.js";
import { initNotificationBell } from "./notifications.js";
import {
  renderDcmaScoreCardHtml,
  renderDcmaCardHtml,
  renderScheduleMatrixRowHtml,
  renderEstimateRowHtml,
  renderControlTaskRowHtml
} from "./pm_workspace_templates.js";
import {
  round,
  getWorkPackageMap,
  formatDateYmd,
  escapeHtml,
  CONTROLLER_CHECKLIST,
  formatDurationSeconds,
  showTransientAlert
} from "./utility.js";


document.addEventListener("DOMContentLoaded", async () => {
  const user = requireAuth();
  if (!user) return;

  const projectId = sessionStorage.getItem("active_project_id");
  if (!projectId) {
    window.location.href = "/project_manager/dashboard.html";
    return;
  }

  // Mount project notification bell scoped to this project
  initNotificationBell("#pm-workspace-notification-bell-container", user, projectId);

  // UI Elements
  const sidebarProjName = document.getElementById("sidebar-proj-name");
  const navContainer = document.getElementById("workspace-nav");
  const headerSubtitle = document.getElementById("workspace-header-subtitle");
  const userBadge = document.getElementById("workspace-user-badge");
  const btnReturnDashboard = document.getElementById("btn-return-dashboard");
  const btnLogout = document.getElementById("btn-workspace-logout");

  // View Sections
  const view1Plan = document.getElementById("view-1-plan");
  const view2Wbs = document.getElementById("view-2-wbs");
  const view3Sequence = document.getElementById("view-3-sequence");
  const view4Estimate = document.getElementById("view-4-estimate");
  const view5Schedule = document.getElementById("view-5-schedule");
  const view6Control = document.getElementById("view-6-control");
  const viewPlaceholder = document.getElementById("view-placeholder");
  const placeholderTitle = document.getElementById("placeholder-title");
  const placeholderDesc = document.getElementById("placeholder-desc");

  // View 1 Elements
  const planProjTitle = document.getElementById("plan-proj-title");
  const planStartDate = document.getElementById("plan-start-date");
  const planCreatedDate = document.getElementById("plan-created-date");
  const inputDescription = document.getElementById("input-plan-description");
  const formDescription = document.getElementById("form-edit-description");
  const btnSaveDescription = document.getElementById("btn-save-description");
  const descSaveAlert = document.getElementById("desc-save-alert");
  const planPersonnelStats = document.getElementById("plan-personnel-stats");
  const btnOpenPersonnelModal = document.getElementById("btn-open-personnel-modal");

  // Personnel Modal Elements
  const personnelModal = document.getElementById("personnel-modal");
  const personnelModalTitle = document.getElementById("personnel-modal-title");
  const btnClosePersonnelModal = document.getElementById("btn-close-personnel-modal");
  const btnDismissPersonnelModal = document.getElementById("btn-dismiss-personnel-modal");
  const btnEditPersonnelModal = document.getElementById("btn-edit-personnel-modal");

  const personnelViewContainer = document.getElementById("personnel-view-container");
  const personnelEditContainer = document.getElementById("personnel-edit-container");
  const personnelViewFooter = document.getElementById("personnel-view-footer");
  const personnelEditFooter = document.getElementById("personnel-edit-footer");

  const personnelControllersList = document.getElementById("personnel-controllers-list");
  const personnelTeamsList = document.getElementById("personnel-teams-list");
  const personnelUnassignedList = document.getElementById("personnel-unassigned-list");

  // Edit Mode Elements
  const personnelEditError = document.getElementById("personnel-edit-error");
  const personnelEditSuccess = document.getElementById("personnel-edit-success");
  const btnShowAddTeam = document.getElementById("btn-show-add-team");
  const newTeamFormContainer = document.getElementById("new-team-form-container");
  const inputNewTeamName = document.getElementById("input-new-team-name");
  const btnConfirmAddTeam = document.getElementById("btn-confirm-add-team");
  const btnCancelAddTeam = document.getElementById("btn-cancel-add-team");
  const editTeamsList = document.getElementById("edit-teams-list");

  const selectAddIndividual = document.getElementById("select-add-individual");
  const btnConfirmAddIndividual = document.getElementById("btn-confirm-add-individual");
  const editUnassignedList = document.getElementById("edit-unassigned-list");

  const selectAddController = document.getElementById("select-add-controller");
  const btnConfirmAddController = document.getElementById("btn-confirm-add-controller");
  const editControllersList = document.getElementById("edit-controllers-list");

  const btnCancelEditPersonnel = document.getElementById("btn-cancel-edit-personnel");
  const btnSaveEditPersonnel = document.getElementById("btn-save-edit-personnel");

  // Visualization Canvases
  const wbsCanvas = document.getElementById("wbs-network-canvas");
  const wbsBreakdown = document.getElementById("wbs-breakdown-container");
  const pdmCanvas = document.getElementById("pdm-network-canvas");
  const pdmDependencies = document.getElementById("pdm-dependencies-container");

  // View 3 Elements (Sequence Activities)
  const btnOpenAddDependency = document.getElementById("btn-open-add-dependency");
  const btnSaveDependencies = document.getElementById("btn-save-dependencies");
  const seqAlertMsg = document.getElementById("seq-alert-msg");
  const seqSaveStatus = document.getElementById("seq-save-status");

  const healthStatusIndicator = document.getElementById("health-status-indicator");
  const healthQuickSummary = document.getElementById("health-quick-summary");
  const btnToggleHealthDetails = document.getElementById("btn-toggle-health-details");
  const scheduleHealthDrawer = document.getElementById("schedule-health-drawer");
  const healthDiagnosticsDetails = document.getElementById("health-diagnostics-details");

  const tabBtnDiagram = document.getElementById("tab-btn-diagram");
  const tabBtnTable = document.getElementById("tab-btn-table");
  const seqPaneDiagram = document.getElementById("seq-pane-diagram");
  const seqPaneTable = document.getElementById("seq-pane-table");
  const seqDepsBadgeCount = document.getElementById("seq-deps-badge-count");
  const diagramToolbar = document.getElementById("diagram-toolbar");

  const btnCanvasZoomIn = document.getElementById("btn-canvas-zoom-in");
  const btnCanvasZoomOut = document.getElementById("btn-canvas-zoom-out");
  const btnCanvasFit = document.getElementById("btn-canvas-fit");

  // Dependency Modal Elements
  const dependencyModal = document.getElementById("dependency-modal");
  const dependencyModalTitle = document.getElementById("dependency-modal-title");
  const btnCloseDependencyModal = document.getElementById("btn-close-dependency-modal");
  const btnCancelDependencyModal = document.getElementById("btn-cancel-dependency-modal");
  const dependencyForm = document.getElementById("dependency-form");
  const dependencyModalAlert = document.getElementById("dependency-modal-alert");
  const selectDepPredecessor = document.getElementById("select-dep-predecessor");
  const selectDepType = document.getElementById("select-dep-type");
  const selectDepSuccessor = document.getElementById("select-dep-successor");
  const inputDepLag = document.getElementById("input-dep-lag");
  const inputDepDesc = document.getElementById("input-dep-desc");
  const depTypeExplanation = document.getElementById("dep-type-explanation");
  const dependencyEditIndex = document.getElementById("dependency-edit-index");

  let networkInstance = null;
  let hasUnsavedDependencies = false;
  let activeSeqTab = "diagram";

  userBadge.innerHTML = `
    <div style="background: var(--primary-light); border: 1px solid var(--primary-border); padding: 5px 14px; border-radius: 20px; font-weight: 700; color: var(--primary); font-size: 0.85rem;">
      👤 ${user.first_name || 'User'} (${user.role || 'Member'})
    </div>
  `;

  // Fetch project and users cache
  const [projectResult, usersResult] = await Promise.all([
    fetchProjectDetail(projectId),
    fetchAllUsers()
  ]);

  if (projectResult.error || !projectResult.data) {
    alert(`Failed to load project workspace: ${projectResult.error || "Project not found."}`);
    window.location.href = "/project_manager/dashboard.html";
    return;
  }

  let project = projectResult.data;
  const allUsers = usersResult.data || [];
  const userMap = new Map();
  allUsers.forEach(u => userMap.set(String(u.id || u._id), u));

  /**
 * Resolves a user object by ID, username, or display name from cached project roster.
 */
function resolveUser(uidOrHandle) {
    const key = String(uidOrHandle);
    if (userMap.has(key)) return userMap.get(key);
    // Search by username
    const byUn = allUsers.find(u => u.username === key);
    if (byUn) return byUn;
    return {
      first_name: "Contributor",
      last_name: key,
      role: "Member",
      email: "—",
      username: key
    };
  }

  // Populate Active Project Information
  const projectName = project.name || "Untitled Project";
  sidebarProjName.textContent = projectName;
  planProjTitle.textContent = projectName;
  planStartDate.textContent = project.start_date || "Not set";
  planCreatedDate.textContent = project.created_at || "—";
  inputDescription.value = project.description || "";

  // Helper to re-calculate stats
  /**
 * Recalculates and updates headcount statistics for teams, individual members, and controllers.
 */
function updateProjectPersonnelStats() {
    const teams = project.teams || [];
    const assignedUsers = project.assigned_user_ids || [];
    const distinctPersonnel = new Set(assignedUsers.map(String));
    teams.forEach(t => (t.member_ids || []).forEach(m => distinctPersonnel.add(String(m))));
    if (project.created_by) distinctPersonnel.add(String(project.created_by));
    planPersonnelStats.textContent = `Configured Teams: ${teams.length} • Total Allocated Contributors: ${distinctPersonnel.size}`;
  }
  updateProjectPersonnelStats();

  // Description Save Handler
  formDescription.addEventListener("submit", async (e) => {
    e.preventDefault();
    btnSaveDescription.disabled = true;
    btnSaveDescription.textContent = "Saving...";

    const newDesc = inputDescription.value.trim();
    const { data: updatedProj, error } = await updateProjectDescription(projectId, newDesc);

    btnSaveDescription.disabled = false;
    btnSaveDescription.textContent = "Save Description";

    if (error) {
      alert(`Failed to update scope description: ${error}`);
      return;
    }

    project.description = newDesc;
    descSaveAlert.style.display = "flex";
    setTimeout(() => {
      descSaveAlert.style.display = "none";
    }, 3500);
  });

  
  // PERSONNEL & CONTROLLERS MODAL: VIEW & EDIT IMPLEMENTATION
  
  const isPM = Boolean(user.is_admin) || (user.role && user.role.trim() === "Project Manager") || (String(user.id || user._id) === String(project.created_by || ""));
  if (btnEditPersonnelModal) {
    btnEditPersonnelModal.style.display = isPM ? "inline-block" : "none";
  }

  /**
 * Renders the read-only Personnel Overview tab (Section 1).
 */
function renderPersonnelView() {
    personnelViewContainer.style.display = "block";
    personnelEditContainer.style.display = "none";
    personnelViewFooter.style.display = "flex";
    personnelEditFooter.style.display = "none";
    personnelModalTitle.textContent = "Project Personnel & Team Assignments";

    const controllers = project.controllers || [];
    const teams = project.teams || [];
    const assignedUsers = project.assigned_user_ids || [];
    const pmId = String(project.created_by || "");
    const controllerSet = new Set(controllers.map(c => String(c)));

    // 1. Render Controllers
    if (controllers.length === 0) {
      personnelControllersList.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted);">No controllers designated.</p>`;
    } else {
      const resolvedControllers = controllers.map(cId => resolveUser(cId));
      resolvedControllers.sort((a, b) => {
        const aIsPM = String(a.id || a._id) === pmId;
        const bIsPM = String(b.id || b._id) === pmId;
        if (aIsPM && !bIsPM) return -1;
        if (!aIsPM && bIsPM) return 1;
        return (a.last_name || "").localeCompare(b.last_name || "");
      });

      let ctrlHtml = "";
      resolvedControllers.forEach(c => {
        const isLeadPM = String(c.id || c._id) === pmId;
        const cIdStr = String(c.id || c._id || c.username);
        const inTeams = [];
        teams.forEach(t => {
          if ((t.member_ids || []).map(String).includes(cIdStr)) {
            inTeams.push(t.name);
          }
        });

        let badge;
        if (isLeadPM) {
          badge = `<span class="badge badge-green">Lead Controller (PM)</span>`;
        } else if (inTeams.length > 0) {
          badge = `<span class="badge badge-blue">Controller • Member of ${inTeams.join(', ')}</span>`;
        } else {
          badge = `<span class="badge badge-blue">Independent Controller</span>`;
        }
        ctrlHtml += renderPersonCard(c, badge);
      });
      personnelControllersList.innerHTML = ctrlHtml;
    }

    // 2. Render Teams (Controllers assigned to teams appear within the team)
    const teamMemberIds = new Set();
    if (teams.length === 0) {
      personnelTeamsList.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted);">No teams configured for this project.</p>`;
    } else {
      let teamsHtml = "";
      teams.forEach(t => {
        const mIds = t.member_ids || [];
        const resolvedMembers = mIds.map(mId => {
          teamMemberIds.add(String(mId));
          return resolveUser(mId);
        });
        resolvedMembers.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));

        let membersCards = "";
        resolvedMembers.forEach(m => {
          const mIdStr = String(m.id || m._id || m.username);
          const isCtrl = controllerSet.has(mIdStr);
          const ctrlTag = isCtrl ? `<span class="badge badge-green" style="margin-right: 6px;">🛡️ Controller</span>` : "";
          const badge = `${ctrlTag}<span class="badge badge-blue">${t.name}</span>`;
          membersCards += renderPersonCard(m, badge);
        });

        const leadUser = t.lead_id ? resolveUser(t.lead_id) : null;
        const leadBadge = leadUser
          ? `<span class="badge badge-amber" style="margin-left: 8px;">👑 Lead: ${leadUser.first_name || ""} ${leadUser.last_name || ""}</span>`
          : "";

        teamsHtml += `
          <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 0.9rem 1.1rem; margin-bottom: 0.8rem;">
            <div style="font-weight: 700; color: var(--charcoal); margin-bottom: 0.5rem; font-size: 0.95rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;">
              <span>🏢 ${t.name} (${resolvedMembers.length} Members)</span>
              ${leadBadge}
            </div>
            ${membersCards || `<p style="font-size: 0.85rem; color: var(--muted);">No members assigned.</p>`}
          </div>
        `;
      });
      personnelTeamsList.innerHTML = teamsHtml;
    }

    // 3. Render Unassigned Individuals (Controllers NOT on teams must NOT show up here)
    const unassignedUsers = [];
    assignedUsers.forEach(uId => {
      const uIdStr = String(uId);
      // Exclude team members, exclude PM, and exclude controllers
      if (!teamMemberIds.has(uIdStr) && uIdStr !== pmId && !controllerSet.has(uIdStr)) {
        unassignedUsers.push(resolveUser(uIdStr));
      }
    });

    unassignedUsers.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));

    if (unassignedUsers.length === 0) {
      personnelUnassignedList.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted);">No unassigned individual contributors.</p>`;
    } else {
      let unassignedHtml = "";
      unassignedUsers.forEach(u => {
        const badge = `<span class="badge badge-gray">Individual</span>`;
        unassignedHtml += renderPersonCard(u, badge);
      });
      personnelUnassignedList.innerHTML = unassignedHtml;
    }
  }

  /**
 * Generates HTML card markup for a user profile in the personnel roster.
 */
function renderPersonCard(u, badgeHtml) {
    const fn = u.first_name || "";
    const ln = u.last_name || "";
    const un = u.username || "";
    const role = u.role || "Member";
    const email = u.email || "—";

    return `
      <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin-bottom: 0.45rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <div>
          <strong style="color: var(--charcoal); font-size: 0.92rem;">${ln}, ${fn}</strong>
          <span style="color: var(--muted); font-size: 0.82rem; margin-left: 6px;">(@${un})</span>
          <div style="color: var(--slate); font-size: 0.82rem; margin-top: 1px;">
            Role: <strong>${role}</strong> • Email: <code>${email}</code>
          </div>
        </div>
        <div>${badgeHtml}</div>
      </div>
    `;
  }

  // EDIT MODE STATE & RENDERING
  let draftTeams = [];
  let draftUnassigned = [];
  let draftControllers = [];

  /**
 * Initializes deep copy of personnel configuration for editing.
 */
function initEditState() {
    draftTeams = (project.teams || []).map(t => ({
      team_id: t.team_id || `TEAM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: t.name || "",
      member_ids: [...(t.member_ids || [])].map(String),
      lead_id: t.lead_id ? String(t.lead_id) : null
    }));

    const teamMemberIds = new Set();
    draftTeams.forEach(t => (t.member_ids || []).forEach(m => teamMemberIds.add(String(m))));

    draftControllers = [...(project.controllers || [])].map(String);
    const controllerSet = new Set(draftControllers);
    const pmIdStr = String(project.created_by || "");

    draftUnassigned = (project.assigned_user_ids || [])
      .map(String)
      .filter(uId => !teamMemberIds.has(uId) && uId !== pmIdStr && !controllerSet.has(uId));
  }

  /**
 * Renders interactive personnel editing interface for teams, contributors, and controllers.
 */
function renderPersonnelEdit() {
    personnelViewContainer.style.display = "none";
    personnelEditContainer.style.display = "block";
    personnelViewFooter.style.display = "none";
    personnelEditFooter.style.display = "flex";
    personnelModalTitle.textContent = "✏️ Edit Project Personnel & Teams";
    personnelEditError.style.display = "none";
    personnelEditSuccess.style.display = "none";
    newTeamFormContainer.style.display = "none";
    inputNewTeamName.value = "";

    renderEditTeams();
    renderEditUnassigned();
    renderEditControllers();
  }

  /**
 * Renders team configuration list with add/remove member controls.
 */
function renderEditTeams() {
    if (draftTeams.length === 0) {
      editTeamsList.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted);">No teams currently configured. Click 'Add New Team' above to create one.</p>`;
      return;
    }

    let html = "";
    draftTeams.forEach((t, tIdx) => {
      const memberIds = t.member_ids || [];

      let memberRows = "";
      memberIds.forEach((mId, mIdx) => {
        const u = resolveUser(mId);
        memberRows += `
          <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 0.5rem 0.85rem; margin-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="font-size: 0.86rem;">
              <strong>${u.last_name || ""}, ${u.first_name || ""}</strong> (@${u.username || ""}) • <span style="color: var(--muted);">${u.role || "Member"}</span>
            </div>
            <button type="button" class="btn-remove-team-member btn btn-secondary btn-sm" data-team-idx="${tIdx}" data-member-idx="${mIdx}" title="Remove member from team" style="color: #DC2626; padding: 2px 8px; font-size: 0.8rem;">
              ✕ Remove
            </button>
          </div>
        `;
      });

      // Filter users not already in this specific team
      const availableToAdd = allUsers.filter(u => {
        const uId = String(u.id || u._id);
        return !memberIds.includes(uId);
      });

      let addOptions = `<option value="">Select user to add to ${t.name}...</option>`;
      availableToAdd.forEach(u => {
        addOptions += `<option value="${u.id || u._id}">${u.last_name}, ${u.first_name} (@${u.username}) - ${u.role || "Member"}</option>`;
      });

      let leadOptions = `<option value="">(None / No Team Lead)</option>`;
      memberIds.forEach(mId => {
        const u = resolveUser(mId);
        const isSel = String(t.lead_id || "") === String(mId) ? "selected" : "";
        leadOptions += `<option value="${mId}" ${isSel}>👑 ${u.last_name || ""}, ${u.first_name || ""} (@${u.username || ""})</option>`;
      });

      html += `
        <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; gap: 10px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
              <span style="font-weight: 700; font-size: 0.95rem; color: var(--charcoal);">Team Name:</span>
              <input type="text" class="input-team-rename" data-team-idx="${tIdx}" value="${t.name}" style="flex: 1; max-width: 280px; padding: 0.4rem 0.65rem; font-size: 0.9rem; font-weight: 600;">
            </div>
            <button type="button" class="btn-delete-team btn btn-danger btn-sm" data-team-idx="${tIdx}" style="background-color: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5;">
              🗑️ Delete Team
            </button>
          </div>

          <div style="margin-bottom: 0.8rem;">
            <label style="font-size: 0.82rem; color: var(--muted); margin-bottom: 4px;">Members (${memberIds.length}):</label>
            ${memberRows || `<p style="font-size: 0.82rem; color: var(--muted); margin: 0.4rem 0;">No members in this team.</p>`}
          </div>

          <div style="margin-bottom: 0.8rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #FFFFFF; border: 1px solid var(--border-light); padding: 0.5rem 0.8rem; border-radius: 4px;">
            <span style="font-size: 0.82rem; font-weight: 700; color: var(--charcoal);">👑 Designated Team Lead:</span>
            <select class="select-team-lead" data-team-idx="${tIdx}" style="flex: 1; min-width: 200px; padding: 0.35rem 0.6rem; font-size: 0.85rem; border: 1.5px solid var(--border); border-radius: 4px;">
              ${leadOptions}
            </select>
          </div>

          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <select class="select-team-add-member" data-team-idx="${tIdx}" style="flex: 1; min-width: 200px; padding: 0.45rem 0.65rem; font-size: 0.85rem;">
              ${addOptions}
            </select>
            <button type="button" class="btn-confirm-team-add-member btn btn-secondary btn-sm" data-team-idx="${tIdx}">
              ➕ Add Member
            </button>
          </div>
        </div>
      `;
    });

    editTeamsList.innerHTML = html;

    // Bind team lead change
    editTeamsList.querySelectorAll(".select-team-lead").forEach(sel => {
      sel.addEventListener("change", () => {
        const idx = parseInt(sel.getAttribute("data-team-idx"), 10);
        if (draftTeams[idx]) {
          draftTeams[idx].lead_id = sel.value ? sel.value : null;
        }
      });
    });

    // Bind rename
    editTeamsList.querySelectorAll(".input-team-rename").forEach(inp => {
      inp.addEventListener("input", () => {
        const idx = parseInt(inp.getAttribute("data-team-idx"), 10);
        if (draftTeams[idx]) draftTeams[idx].name = inp.value;
      });
    });

    // Bind remove member from team
    editTeamsList.querySelectorAll(".btn-remove-team-member").forEach(btn => {
      btn.addEventListener("click", () => {
        const tIdx = parseInt(btn.getAttribute("data-team-idx"), 10);
        const mIdx = parseInt(btn.getAttribute("data-member-idx"), 10);
        if (draftTeams[tIdx]) {
          draftTeams[tIdx].member_ids.splice(mIdx, 1);
          renderEditTeams();
          renderEditUnassigned();
          renderEditControllers();
        }
      });
    });

    // Bind delete team
    editTeamsList.querySelectorAll(".btn-delete-team").forEach(btn => {
      btn.addEventListener("click", () => {
        const tIdx = parseInt(btn.getAttribute("data-team-idx"), 10);
        if (draftTeams[tIdx]) {
          draftTeams.splice(tIdx, 1);
          renderEditTeams();
          renderEditUnassigned();
          renderEditControllers();
        }
      });
    });

    // Bind add member to team
    editTeamsList.querySelectorAll(".btn-confirm-team-add-member").forEach(btn => {
      btn.addEventListener("click", () => {
        const tIdx = parseInt(btn.getAttribute("data-team-idx"), 10);
        const sel = editTeamsList.querySelector(`.select-team-add-member[data-team-idx="${tIdx}"]`);
        if (!sel || !sel.value) return;
        const uid = sel.value;
        if (draftTeams[tIdx] && !draftTeams[tIdx].member_ids.includes(uid)) {
          draftTeams[tIdx].member_ids.push(uid);
          // If this user was in unassigned, remove them from unassigned
          const unassignedIdx = draftUnassigned.indexOf(uid);
          if (unassignedIdx !== -1) draftUnassigned.splice(unassignedIdx, 1);
          renderEditTeams();
          renderEditUnassigned();
          renderEditControllers();
        }
      });
    });
  }

  /**
 * Renders individual contributor assignment list in personnel editor.
 */
function renderEditUnassigned() {
    const teamMemberIds = new Set();
    draftTeams.forEach(t => (t.member_ids || []).forEach(m => teamMemberIds.add(String(m))));
    const pmIdStr = String(project.created_by || "");
    const controllerSet = new Set(draftControllers);

    const availableForUnassigned = allUsers.filter(u => {
      const uid = String(u.id || u._id);
      return !teamMemberIds.has(uid) && !draftUnassigned.includes(uid) && uid !== pmIdStr && !controllerSet.has(uid);
    });

    let optionsHtml = `<option value="">Select contributor to add...</option>`;
    availableForUnassigned.forEach(u => {
      optionsHtml += `<option value="${u.id || u._id}">${u.last_name}, ${u.first_name} (@${u.username}) - ${u.role || "Member"}</option>`;
    });
    selectAddIndividual.innerHTML = optionsHtml;

    if (draftUnassigned.length === 0) {
      editUnassignedList.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); margin: 0.4rem 0;">No unassigned individual contributors.</p>`;
      return;
    }

    let html = "";
    draftUnassigned.forEach((uId, idx) => {
      const u = resolveUser(uId);
      html += `
        <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 0.65rem 0.9rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="font-size: 0.88rem;">
            <strong>${u.last_name || ""}, ${u.first_name || ""}</strong> (@${u.username || ""}) • <span>${u.role || "Member"}</span>
          </div>
          <button type="button" class="btn-remove-unassigned btn btn-secondary btn-sm" data-idx="${idx}" title="Remove individual contributor from project" style="color: #DC2626; padding: 2px 8px; font-size: 0.8rem;">
            🗑️ Remove
          </button>
        </div>
      `;
    });

    editUnassignedList.innerHTML = html;

    editUnassignedList.querySelectorAll(".btn-remove-unassigned").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        draftUnassigned.splice(idx, 1);
        renderEditUnassigned();
      });
    });
  }

  /**
 * Renders project controller designation checkboxes in personnel editor.
 */
function renderEditControllers() {
    const pmIdStr = String(project.created_by || "");
    const controllerSet = new Set(draftControllers);

    const availableToAppoint = allUsers.filter(u => {
      const uid = String(u.id || u._id);
      return !controllerSet.has(uid);
    });

    let optionsHtml = `<option value="">Select project member to appoint as controller...</option>`;
    availableToAppoint.forEach(u => {
      optionsHtml += `<option value="${u.id || u._id}">${u.last_name}, ${u.first_name} (@${u.username}) - ${u.role || "Member"}</option>`;
    });
    selectAddController.innerHTML = optionsHtml;

    let html = "";
    draftControllers.forEach((cId, idx) => {
      const u = resolveUser(cId);
      const isLeadPM = String(cId) === pmIdStr;

      const inTeams = [];
      draftTeams.forEach(t => {
        if ((t.member_ids || []).map(String).includes(String(cId))) {
          inTeams.push(t.name);
        }
      });
      const teamInfo = inTeams.length > 0 ? ` • Team: ${inTeams.join(', ')}` : " • Independent Controller";

      html += `
        <div style="background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 0.65rem 0.9rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="font-size: 0.88rem;">
            ${isLeadPM ? "⭐ " : "🛡️ "}<strong>${u.last_name || ""}, ${u.first_name || ""}</strong> (@${u.username || ""}) • <span>${u.role || "Member"}</span> <span style="color: var(--muted); font-size: 0.82rem;">${teamInfo}</span>
          </div>
          ${isLeadPM 
            ? `<span class="badge badge-green" style="font-size: 0.78rem;">Lead PM</span>`
            : `<button type="button" class="btn-remove-controller btn btn-secondary btn-sm" data-idx="${idx}" title="Remove controller designation" style="color: #DC2626; padding: 2px 8px; font-size: 0.8rem;">
                🗑️ Remove
              </button>`
          }
        </div>
      `;
    });

    editControllersList.innerHTML = html;

    editControllersList.querySelectorAll(".btn-remove-controller").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        draftControllers.splice(idx, 1);
        renderEditControllers();
        renderEditUnassigned();
      });
    });
  }

  // Bind Add New Team Form handlers
  btnShowAddTeam.addEventListener("click", () => {
    newTeamFormContainer.style.display = "block";
    inputNewTeamName.focus();
  });

  btnCancelAddTeam.addEventListener("click", () => {
    newTeamFormContainer.style.display = "none";
    inputNewTeamName.value = "";
  });

  btnConfirmAddTeam.addEventListener("click", () => {
    const name = inputNewTeamName.value.trim();
    if (!name) {
      alert("Please enter a name for the new team.");
      return;
    }
    draftTeams.push({
      team_id: `TEAM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: name,
      member_ids: []
    });
    inputNewTeamName.value = "";
    newTeamFormContainer.style.display = "none";
    renderEditTeams();
  });

  // Bind Add Individual Contributor
  btnConfirmAddIndividual.addEventListener("click", () => {
    const uid = selectAddIndividual.value;
    if (!uid) return;
    if (!draftUnassigned.includes(uid)) {
      draftUnassigned.push(uid);
      renderEditUnassigned();
    }
  });

  // Bind Appoint Controller
  btnConfirmAddController.addEventListener("click", () => {
    const uid = selectAddController.value;
    if (!uid) return;
    if (!draftControllers.includes(uid)) {
      draftControllers.push(uid);
      renderEditControllers();
      renderEditUnassigned();
    }
  });

  // Modal Buttons
  btnOpenPersonnelModal.addEventListener("click", () => {
    renderPersonnelView();
    personnelModal.style.display = "flex";
  });

  btnEditPersonnelModal.addEventListener("click", () => {
    initEditState();
    renderPersonnelEdit();
  });

  btnCancelEditPersonnel.addEventListener("click", () => {
    renderPersonnelView();
  });

  btnSaveEditPersonnel.addEventListener("click", async () => {
    btnSaveEditPersonnel.disabled = true;
    btnSaveEditPersonnel.textContent = "Saving Changes...";
    personnelEditError.style.display = "none";

    // Validate team names
    for (const t of draftTeams) {
      if (!t.name || !t.name.trim()) {
        personnelEditError.textContent = "All teams must have a non-empty name.";
        personnelEditError.style.display = "flex";
        btnSaveEditPersonnel.disabled = false;
        btnSaveEditPersonnel.textContent = "💾 Save Changes";
        return;
      }
    }

    const payload = {
      teams: draftTeams,
      assigned_user_ids: draftUnassigned,
      controllers: draftControllers
    };

    const { data: updatedProj, error } = await updateProjectPersonnel(projectId, payload);

    btnSaveEditPersonnel.disabled = false;
    btnSaveEditPersonnel.textContent = "💾 Save Changes";

    if (error || !updatedProj) {
      personnelEditError.textContent = error || "Failed to update project personnel. Please try again.";
      personnelEditError.style.display = "flex";
      return;
    }

    project = updatedProj;
    updateProjectPersonnelStats();
    renderPersonnelView();
  });

  btnClosePersonnelModal.addEventListener("click", () => {
    personnelModal.style.display = "none";
  });

  btnDismissPersonnelModal.addEventListener("click", () => {
    personnelModal.style.display = "none";
  });

  
  // SIDEBAR NAVIGATION ROUTING
  const processTitles = {
    1: "Plan Schedule Management — Policies, Procedures & Governance",
    2: "Define Activities — Work Breakdown Structure & Work Package Activities",
    3: "Sequence Activities — Project Schedule Network Diagram & Logic Dependencies",
    4: "Estimate Activity Duration — PERT / CPM Estimation",
    5: "Develop Schedule — Critical Path (CPM), PERT Events (AOA), Float Matrix & Gantt",
    6: "Control Schedule — Operational Monitoring & Variance Analysis"
  };

  const navItems = navContainer.querySelectorAll(".sidebar-nav-item");

  /**
 * Switches active workspace section (1: Plan, 2: Scope/WBS, 3: Sequence, 4: Estimate, 5: Control).
 */
function switchView(viewIndex) {
    try {
      sessionStorage.setItem("syncflow_active_view", String(viewIndex));
    } catch {}

    navItems.forEach(item => item.classList.remove("active"));
    const activeItem = navContainer.querySelector(`[data-view="${viewIndex}"]`);
    if (activeItem) activeItem.classList.add("active");

    headerSubtitle.textContent = processTitles[viewIndex] || "Schedule Management";

    // Hide all
    view1Plan.style.display = "none";
    view2Wbs.style.display = "none";
    view3Sequence.style.display = "none";
    view4Estimate.style.display = "none";
    if (view5Schedule) view5Schedule.style.display = "none";
    if (view6Control) view6Control.style.display = "none";
    viewPlaceholder.style.display = "none";

    try {
      if (viewIndex === 1) {
        view1Plan.style.display = "block";
      } else if (viewIndex === 2) {
        view2Wbs.style.display = "block";
        renderWbsView();
      } else if (viewIndex === 3) {
        view3Sequence.style.display = "block";
        renderSequenceView();
      } else if (viewIndex === 4) {
        view4Estimate.style.display = "block";
        renderEstimateView();
      } else if (viewIndex === 5) {
        if (view5Schedule) view5Schedule.style.display = "block";
        renderScheduleView();
      } else if (viewIndex === 6) {
        if (view6Control) view6Control.style.display = "block";
        renderControlScheduleView();
      } else {
        viewPlaceholder.style.display = "block";
        placeholderTitle.textContent = activeItem ? activeItem.textContent : "";
      }
    } catch (viewErr) {
      console.error(`[SyncFlow] Failed to render view ${viewIndex}:`, viewErr);
    }
  }

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const idx = parseInt(item.getAttribute("data-view"), 10);
      switchView(idx);
    });
  });


  
  // VIEW 2: DEFINE ACTIVITIES & WBS (WORK BREAKDOWN STRUCTURE)
  
  let activeWbsTab = "builder";
  let selectedActivityWpId = null;
  let hasUnsavedWbsChanges = false;

  // View 2 DOM References
  const wbsSaveStatus = document.getElementById("wbs-save-status");
  const wbsAlertMsg = document.getElementById("wbs-alert-msg");
  const btnAddActivityTop = document.getElementById("btn-add-activity-top");
  const btnSaveWbsActivities = document.getElementById("btn-save-wbs-activities");
  const wbsTabButtons = document.querySelectorAll(".wbs-tab-btn");
  const wbsCardsContainer = document.getElementById("wbs-cards-container");

  const tabPanes = {
    tree: document.getElementById("tab-pane-wbs-tree"),
    builder: document.getElementById("tab-pane-wbs-builder"),
    activities: document.getElementById("tab-pane-wbs-activities")
  };

  // Define Activities Tab DOM References
  const selectActivityWp = document.getElementById("select-activity-wp");
  const btnAddActivityItem = document.getElementById("btn-add-activity-item");
  const wpActivitiesBreadcrumb = document.getElementById("wp-activities-breadcrumb");
  const wpActivitiesListContainer = document.getElementById("wp-activities-list-container");

  // WBS Modal References
  const wbsModal = document.getElementById("wbs-element-modal");
  const wbsModalTitle = document.getElementById("wbs-modal-title");
  const btnCloseWbsModal = document.getElementById("btn-close-wbs-modal");
  const btnCancelWbsModal = document.getElementById("btn-cancel-wbs-modal");
  const wbsElementForm = document.getElementById("wbs-element-form");
  const wbsEditMode = document.getElementById("wbs-edit-mode");
  const wbsNodeId = document.getElementById("wbs-node-id");
  const wbsParentId = document.getElementById("wbs-parent-id");
  const groupWbsType = document.getElementById("group-wbs-type");
  const selectWbsType = document.getElementById("select-wbs-type");
  const groupParentElement = document.getElementById("group-parent-element");
  const selectParentElement = document.getElementById("select-parent-element");
  const inputWbsName = document.getElementById("input-wbs-name");
  const inputWbsDesc = document.getElementById("input-wbs-desc");

  // Activity Modal References
  const activityModal = document.getElementById("activity-modal");
  const activityModalTitle = document.getElementById("activity-modal-title");
  const btnCloseActivityModal = document.getElementById("btn-close-activity-modal");
  const btnCancelActivityModal = document.getElementById("btn-cancel-activity-modal");
  const activityForm = document.getElementById("activity-form");
  const activityEditMode = document.getElementById("activity-edit-mode");
  const activityEditId = document.getElementById("activity-edit-id");
  const activityTargetWpId = document.getElementById("activity-target-wp-id");
  const activityModalError = document.getElementById("activity-modal-error");
  const inputActivityName = document.getElementById("input-activity-name");
  const inputActivityDesc = document.getElementById("input-activity-desc");
  const selectActivityController = document.getElementById("select-activity-controller");
  const activityTeamsCheckboxes = document.getElementById("activity-teams-checkboxes");
  const activityUsersCheckboxes = document.getElementById("activity-users-checkboxes");

  let currentActSelectedTeams = new Set();
  let currentActSelectedUsers = new Set();

  // Initial structure normalization: Only migrate if wbs is undefined/null (never if already an array or emptied by user)
  if (project.wbs === undefined || project.wbs === null) {
    if (project.deliverables && project.deliverables.length > 0) {
      project.wbs = project.deliverables.map((d, dIdx) => {
        const dNum = `${dIdx + 1}`;
        const subs = (d.sub_deliverables || []).map((s, sIdx) => {
          const sNum = `${dNum}.${sIdx + 1}`;
          const wps = (s.work_packages || []).map((w, wIdx) => ({
            id: w.work_package_id || `WP-${sNum}.${wIdx + 1}`,
            wbs_number: `${sNum}.${wIdx + 1}`,
            name: w.name || `Work Package ${sNum}.${wIdx + 1}`,
            description: w.description || null,
            type: "work_package",
            children: []
          }));
          return {
            id: s.sub_deliverable_id || `SUB-${sNum}`,
            wbs_number: sNum,
            name: s.name || `Sub-deliverable ${sNum}`,
            description: s.description || null,
            type: wps.length > 0 ? "sub_deliverable" : "work_package",
            children: wps
          };
        });
        return {
          id: d.deliverable_id || `DEL-${dNum}`,
          wbs_number: dNum,
          name: d.name || `Major Deliverable ${dNum}`,
          description: d.description || null,
          type: "major_deliverable",
          children: subs
        };
      });
    } else {
      project.wbs = [];
    }
  }
  if (!project.activities) {
    project.activities = [];
  }

  // Persistent auto-save helper for WBS and Activities
  /**
 * Persists WBS tree and activity modifications to the MongoDB backend.
 */
async function persistWbsAndActivities(showFeedback = true) {
    recalculateWbsNumbers();
    if (showFeedback && btnSaveWbsActivities) {
      btnSaveWbsActivities.disabled = true;
      btnSaveWbsActivities.textContent = "Saving to Database...";
    }
    try {
      const [wbsRes, actRes] = await Promise.all([
        updateProjectWbs(projectId, project.wbs),
        updateProjectActivities(projectId, project.activities)
      ]);
      if (wbsRes && wbsRes.data) {
        project.wbs = wbsRes.data.wbs || project.wbs;
        project.deliverables = wbsRes.data.deliverables || project.deliverables;
      }
      if (actRes && actRes.data) {
        project.activities = actRes.data.activities || project.activities;
      }
      setWbsDirty(false);
      return true;
    } catch (err) {
      console.error("Failed to persist WBS/activities:", err);
      setWbsDirty(true);
      return false;
    } finally {
      if (showFeedback && btnSaveWbsActivities) {
        btnSaveWbsActivities.disabled = false;
        btnSaveWbsActivities.textContent = "💾 Save All Changes";
      }
    }
  }


  // Recursive auto-numbering of WBS nodes
  /**
 * Recursively recomputes canonical hierarchical numbering for WBS nodes (e.g. 1.1, 1.2.1).
 */
function recalculateWbsNumbers(nodes = project.wbs, prefix = "") {
    if (!nodes || !Array.isArray(nodes)) return;
    nodes.forEach((node, idx) => {
      const num = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
      node.wbs_number = num;

      const hasChildren = node.children && Array.isArray(node.children) && node.children.length > 0;

      if (!prefix) {
        node.type = "major_deliverable";
      } else if (hasChildren) {
        node.type = "sub_deliverable";
      } else if (node.type !== "sub_deliverable") {
        node.type = "work_package";
      }

      if (!node.id) {
        if (node.type === "major_deliverable") node.id = `DEL-${num}`;
        else if (node.type === "work_package") node.id = `WP-${num}`;
        else node.id = `SUB-${num}`;
      }

      if (hasChildren && node.type !== "work_package") {
        recalculateWbsNumbers(node.children, num);
      } else {
        node.children = [];
      }
    });
  }

  // Find node by ID
  /**
 * Recursively locates a WBS node by its ID.
 */
function findWbsNode(id, nodes = project.wbs) {
    if (!nodes) return null;
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children && n.children.length > 0) {
        const found = findWbsNode(id, n.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Find parent and index of a node
  /**
 * Recursively locates the parent node of a specified WBS node ID.
 */
function findWbsParent(id, nodes = project.wbs, parent = null) {
    if (!nodes) return null;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        return { parent, index: i, node: nodes[i] };
      }
      if (nodes[i].children && nodes[i].children.length > 0) {
        const res = findWbsParent(id, nodes[i].children, nodes[i]);
        if (res) return res;
      }
    }
    return null;
  }

  // Get all container nodes (Major Deliverables & Sub-deliverables)
  /**
 * Collects all intermediate container nodes (Major Deliverables and Sub-deliverables).
 */
function getAllWbsContainers(nodes = project.wbs, list = []) {
    if (!nodes) return list;
    nodes.forEach(n => {
      if (n.type === "major_deliverable" || n.type === "sub_deliverable" || (n.children && n.children.length > 0)) {
        list.push(n);
        if (n.children && n.children.length > 0) {
          getAllWbsContainers(n.children, list);
        }
      }
    });
    return list;
  }

  // Get all leaf Work Packages
  /**
 * Collects all leaf Work Package nodes eligible for activity assignment.
 */
function getAllWorkPackages(nodes = project.wbs, list = []) {
    if (!nodes) return list;
    nodes.forEach(n => {
      const isLeaf = !n.children || n.children.length === 0 || n.type === "work_package";
      if (isLeaf && n.type === "work_package") {
        list.push(n);
      } else if (n.children && n.children.length > 0) {
        getAllWorkPackages(n.children, list);
      } else if (isLeaf) {
        list.push(n);
      }
    });
    return list;
  }

  // Get breadcrumb path for a node
  /**
 * Computes breadcrumb hierarchy path leading to a specified WBS node.
 */
function getWbsPath(id, nodes = project.wbs, currentPath = []) {
    if (!nodes) return null;
    for (const n of nodes) {
      const pathWithCurrent = [...currentPath, n];
      if (n.id === id) return pathWithCurrent;
      if (n.children && n.children.length > 0) {
        const found = getWbsPath(id, n.children, pathWithCurrent);
        if (found) return found;
      }
    }
    return null;
  }

  // Mark changes dirty / saved
  /**
 * Toggles unsaved changes state and shows/hides the pending save banner.
 */
function setWbsDirty(isDirty) {
    hasUnsavedWbsChanges = isDirty;
    if (wbsSaveStatus) {
      if (isDirty) {
        wbsSaveStatus.textContent = "Unsaved Changes";
        wbsSaveStatus.className = "badge badge-amber";
        wbsSaveStatus.style.display = "inline-block";
      } else {
        wbsSaveStatus.textContent = "All Changes Saved";
        wbsSaveStatus.className = "badge badge-emerald";
        wbsSaveStatus.style.display = "inline-block";
      }
    }
  }

  // Tab switching
  /**
 * Switches between WBS Tree hierarchy view and Define Activities tab.
 */
function switchWbsTab(tabName) {
    activeWbsTab = tabName;
    wbsTabButtons.forEach(btn => {
      if (btn.getAttribute("data-tab") === tabName) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    Object.keys(tabPanes).forEach(k => {
      if (tabPanes[k]) {
        tabPanes[k].style.display = (k === tabName) ? "block" : "none";
      }
    });

    if (tabName === "tree") {
      renderWbsTree(wbsCanvas, projectName, project.wbs, userMap, project.teams);
    } else if (tabName === "builder") {
      renderStructuredBuilder();
    } else if (tabName === "activities") {
      renderDefineActivitiesTab();
    }
  }

  wbsTabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchWbsTab(tab);
    });
  });

  // Recursive renderer for arbitrary depth WBS nodes
  /**
 * Recursively generates HTML tree node markup for structured WBS elements.
 */
function renderWbsNodeHtml(node, depth = 0) {
    const isLeaf = !node.children || node.children.length === 0 || node.type === "work_package";
    const num = node.wbs_number || "";

    if (depth === 0) {
      // Level 2: Major Deliverable
      let childrenHtml = "";
      if (node.children && node.children.length > 0) {
        childrenHtml = node.children.map(child => renderWbsNodeHtml(child, depth + 1)).join("");
      }

      return `
        <div class="wbs-activity-card" data-node-id="${node.id}" style="background: #FFFFFF; border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: var(--radius-sm); padding: 1.1rem 1.3rem; margin-bottom: 1.1rem; box-shadow: var(--shadow-sm);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 0.8rem; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 260px;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                <span class="badge badge-blue" style="font-weight: 700; font-size: 0.82rem;">Level 2: Major Deliverable [${num}]</span>
                <h4 style="margin: 0; font-size: 1.1rem; color: var(--charcoal);">${node.name}</h4>
              </div>
              ${node.description ? `<p style="margin: 2px 0 6px 0; font-size: 0.84rem; color: var(--muted);">${node.description}</p>` : ""}
              <div style="font-size: 0.82rem; color: var(--slate);">
                <strong>${(node.children || []).length} Elements inside</strong>
              </div>
            </div>
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-sub" data-parent-id="${node.id}" style="padding: 4px 10px; font-size: 0.8rem;">
                ➕ Add Sub-deliverable
              </button>
              <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-wp" data-parent-id="${node.id}" style="padding: 4px 10px; font-size: 0.8rem;">
                ➕ Add Work Package
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-wbs-edit-node" data-node-id="${node.id}" style="padding: 4px 8px; font-size: 0.8rem;" title="Edit Element">
                ✏️
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-wbs-del-node" data-node-id="${node.id}" style="padding: 4px 8px; font-size: 0.8rem; color: #DC2626;" title="Delete Element">
                🗑️
              </button>
            </div>
          </div>

          <!-- Children container -->
          <div style="padding-left: 0.9rem; border-left: 2px dashed #93C5FD; margin-top: 0.6rem;">
            ${childrenHtml || `<p style="font-size: 0.82rem; color: var(--muted); margin: 6px 0;">No elements in this deliverable. Click '+ Add Sub-deliverable' or '+ Add Work Package' to decompose this outcome.</p>`}
          </div>
        </div>
      `;
    }

    if (!isLeaf) {
      // Intermediate Node: Sub-deliverable (at any depth >= 1)
      let childrenHtml = "";
      if (node.children && node.children.length > 0) {
        childrenHtml = node.children.map(child => renderWbsNodeHtml(child, depth + 1)).join("");
      }

      return `
        <div class="wbs-sub-card" data-node-id="${node.id}" style="background: #F8FAFC; border: 1px solid var(--border-light); border-left: 3px solid #6366F1; border-radius: var(--radius-sm); padding: 0.9rem 1.1rem; margin-bottom: 0.8rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 240px;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                <span class="badge" style="background: #EEF2FF; color: #4F46E5; font-weight: 700; font-size: 0.78rem;">Sub-deliverable [${num}]</span>
                <strong style="color: var(--charcoal); font-size: 0.95rem;">${node.name}</strong>
              </div>
              ${node.description ? `<p style="margin: 2px 0 4px 0; font-size: 0.82rem; color: var(--muted);">${node.description}</p>` : ""}
              <div style="font-size: 0.8rem; color: var(--slate);">
                <span>${(node.children || []).length} Elements inside</span>
              </div>
            </div>
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-sub" data-parent-id="${node.id}" style="padding: 3px 8px; font-size: 0.76rem;">
                ➕ Sub-deliverable
              </button>
              <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-wp" data-parent-id="${node.id}" style="padding: 3px 8px; font-size: 0.76rem;">
                ➕ Work Package
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-wbs-edit-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem;" title="Edit Element">
                ✏️
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-wbs-del-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem; color: #DC2626;" title="Delete Element">
                🗑️
              </button>
            </div>
          </div>

          <!-- Children container -->
          <div style="padding-left: 0.8rem; border-left: 2px dashed #CBD5E1; margin-top: 0.6rem;">
            ${childrenHtml || `<p style="font-size: 0.78rem; color: var(--muted); margin: 4px 0;">No child elements. Click '+ Sub-deliverable' to group further, or '+ Work Package' to define a work package.</p>`}
          </div>
        </div>
      `;
    }

    // Terminal Node: Work Package (Leaf)
    const wpActs = (project.activities || []).filter(a => a.work_package_id === node.id);

    return `
      <div class="wbs-wp-card" data-node-id="${node.id}" style="background: #FFFFFF; border: 1px solid #A7F3D0; border-left: 3px solid #10B981; border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin-bottom: 0.6rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 220px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
              <span class="badge" style="background: #ECFDF5; color: #047857; font-weight: 700; font-size: 0.76rem;">Work Package [${num}]</span>
              <strong style="color: var(--charcoal); font-size: 0.9rem;">${node.name}</strong>
              <span class="badge ${wpActs.length > 0 ? 'badge-blue' : 'badge-slate'}" style="font-size: 0.74rem;">
                📝 ${wpActs.length} Activities
              </span>
            </div>
            ${node.description ? `<p style="margin: 2px 0 0 0; font-size: 0.8rem; color: var(--muted);">${node.description}</p>` : ""}
          </div>
          <div style="display: flex; gap: 5px; align-items: center;">
            <button type="button" class="btn btn-primary btn-sm btn-goto-activities" data-wp-id="${node.id}" style="padding: 3px 10px; font-size: 0.76rem;" title="Define concrete activities for this Work Package">
              📝 Define Activities (${wpActs.length})
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-wbs-edit-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem;" title="Edit Work Package">
              ✏️
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-wbs-del-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem; color: #DC2626;" title="Delete Work Package">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Render Project Builder View (Tab 1)
  /**
 * Renders the complete structured WBS tree hierarchy view.
 */
function renderStructuredBuilder() {
    recalculateWbsNumbers();
    const deliverables = project.wbs || [];

    let deliverablesHtml = "";
    if (deliverables.length === 0) {
      deliverablesHtml = `
        <div style="background: #F8FAFC; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 2.5rem 1.5rem; text-align: center; color: var(--muted); margin: 0.5rem 0;">
          <div style="font-size: 2.2rem; margin-bottom: 0.4rem;">📦</div>
          <h4 style="color: var(--charcoal); margin-bottom: 0.3rem;">No Major Deliverables Created Yet</h4>
          <p style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 1.2rem auto; line-height: 1.5;">
            Decompose this project into Level 2 Major Deliverables (the primary components and outcomes).
          </p>
          <button type="button" class="btn btn-primary btn-sm btn-builder-add-act-container">
            ➕ Add First Major Deliverable (Level 2)
          </button>
        </div>
      `;
    } else {
      deliverablesHtml = deliverables.map(d => renderWbsNodeHtml(d, 0)).join("");
    }

    // Outer Container: Level 1 (Project) - Non-editable container box holding all levels
    const projectContainerHtml = `
      <div class="wbs-project-container-card" style="background: #FFFFFF; border: 2px solid #202938; border-radius: var(--radius-md); padding: 1.4rem 1.6rem; box-shadow: var(--shadow-sm); margin-bottom: 1.5rem;">
        
        <!-- Level 1 Project Header (Non-editable Container) -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 1.2rem; border-bottom: 2px solid var(--border-light); padding-bottom: 1rem; flex-wrap: wrap;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
              <span class="badge" style="background: #202938; color: #FFFFFF; font-weight: 700; font-size: 0.85rem; padding: 4px 10px;">
                Level 1: Project
              </span>
              <h3 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: #202938;">
                ${projectName}
              </h3>
            </div>
            <div style="font-size: 0.85rem; color: var(--slate); margin-top: 5px;">
              <span>Major Deliverables: <strong>${deliverables.length}</strong></span>
              ${project.description ? `<p style="margin: 6px 0 0 0; font-size: 0.84rem; color: var(--muted); line-height: 1.4;">${project.description}</p>` : ""}
            </div>
          </div>
          <div>
            <button type="button" class="btn btn-primary btn-sm btn-builder-add-act-container">
              ➕ Add Major Deliverable (Level 2)
            </button>
          </div>
        </div>

        <!-- Inner Container holding Level 2 Major Deliverables -->
        <div class="wbs-activities-list">
          ${deliverablesHtml}
        </div>
      </div>
    `;

    wbsCardsContainer.innerHTML = projectContainerHtml;

    // Attach container Add Major Deliverable listeners
    wbsCardsContainer.querySelectorAll(".btn-builder-add-act-container").forEach(btn => {
      btn.addEventListener("click", () => {
        openWbsModal({ mode: "add", presetType: "major_deliverable" });
      });
    });

    // Attach Add Sub-deliverable listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-add-sub").forEach(btn => {
      btn.addEventListener("click", () => {
        const parentId = btn.getAttribute("data-parent-id");
        openWbsModal({ mode: "add", parentId: parentId, presetType: "sub_deliverable" });
      });
    });

    // Attach Add Work Package listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-add-wp").forEach(btn => {
      btn.addEventListener("click", () => {
        const parentId = btn.getAttribute("data-parent-id");
        openWbsModal({ mode: "add", parentId: parentId, presetType: "work_package" });
      });
    });

    // Attach Edit Element listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-edit-node").forEach(btn => {
      btn.addEventListener("click", () => {
        const nodeId = btn.getAttribute("data-node-id");
        openWbsModal({ mode: "edit", nodeId: nodeId });
      });
    });

    // Attach Delete Element listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-del-node").forEach(btn => {
      btn.addEventListener("click", async () => {
        const nodeId = btn.getAttribute("data-node-id");
        const nodeInfo = findWbsParent(nodeId);
        if (!nodeInfo) return;

        const node = nodeInfo.node;
        if (confirm(`Are you sure you want to delete "${node.name}" (${node.wbs_number}) and all its nested sub-elements?`)) {
          // Collect all work package IDs to be removed to purge orphaned activities
          const removedWpIds = new Set();
          /**
 * Collects all Work Package IDs contained within a WBS subtree.
 */
function collectWpIds(n) {
            if (!n) return;
            if (n.type === "work_package" || !n.children || n.children.length === 0) {
              if (n.id) removedWpIds.add(n.id);
            }
            if (n.children && Array.isArray(n.children)) {
              n.children.forEach(collectWpIds);
            }
          }
          collectWpIds(node);

          if (!nodeInfo.parent) {
            // Top-level Major Deliverable
            project.wbs.splice(nodeInfo.index, 1);
          } else {
            // Child element
            nodeInfo.parent.children.splice(nodeInfo.index, 1);
            // If parent now has no children and isn't major deliverable, mark as work_package
            if (nodeInfo.parent.children.length === 0 && nodeInfo.parent.type !== "major_deliverable") {
              nodeInfo.parent.type = "work_package";
            }
          }

          // Clean up activities belonging to deleted work packages
          if (removedWpIds.size > 0 && Array.isArray(project.activities)) {
            project.activities = project.activities.filter(a => !removedWpIds.has(a.work_package_id));
          }

          // Persist deletion directly to database so it survives page reloads
          await persistWbsAndActivities(false);
          renderStructuredBuilder();
        }
      });
    });


    // Attach Goto Activities buttons on Work Packages
    wbsCardsContainer.querySelectorAll(".btn-goto-activities").forEach(btn => {
      btn.addEventListener("click", () => {
        const wpId = btn.getAttribute("data-wp-id");
        selectedActivityWpId = wpId;
        switchWbsTab("activities");
      });
    });
  }

  // WBS Modal Helper
  /**
   * Opens modal dialog to create or edit a WBS Deliverable, Sub-deliverable, or Work Package.
   */
  function openWbsModal({ mode = "add", nodeId = null, parentId = null, presetType = "sub_deliverable" }) {
    wbsEditMode.value = mode;
    wbsNodeId.value = nodeId || "";
    wbsParentId.value = parentId || "";

    const containers = getAllWbsContainers();

    if (mode === "add") {
      selectWbsType.disabled = false;
      selectWbsType.value = presetType;

      if (presetType === "major_deliverable") {
        wbsModalTitle.textContent = "Add Major Deliverable (Level 2)";
        groupParentElement.style.display = "none";
      } else {
        wbsModalTitle.textContent = presetType === "work_package" ? "Add Work Package (Terminal Leaf)" : "Add Sub-deliverable (Intermediate Node)";
        groupParentElement.style.display = "block";

        let optHtml = "";
        containers.forEach(c => {
          const isSelected = c.id === parentId;
          optHtml += `<option value="${c.id}" ${isSelected ? "selected" : ""}>[${c.wbs_number}] ${c.name}</option>`;
        });
        selectParentElement.innerHTML = optHtml;
      }

      inputWbsName.value = "";
      inputWbsDesc.value = "";
    } else {
      // Edit mode
      const node = findWbsNode(nodeId);
      if (!node) return;

      wbsModalTitle.textContent = `Edit Element [${node.wbs_number}]`;
      selectWbsType.value = node.type || "sub_deliverable";
      selectWbsType.disabled = true;
      groupParentElement.style.display = "none";

      inputWbsName.value = node.name || "";
      inputWbsDesc.value = node.description || "";
    }

    // Toggle parent container dropdown based on type selection in add mode
    selectWbsType.onchange = () => {
      const curType = selectWbsType.value;
      if (curType === "major_deliverable") {
        groupParentElement.style.display = "none";
      } else {
        groupParentElement.style.display = "block";
        if (selectParentElement.children.length === 0) {
          let optHtml = "";
          containers.forEach(c => {
            optHtml += `<option value="${c.id}">[${c.wbs_number}] ${c.name}</option>`;
          });
          selectParentElement.innerHTML = optHtml;
        }
      }
    };

    wbsModal.style.display = "flex";
    inputWbsName.focus();
  }

  /**
 * Closes the WBS element modal dialog.
 */
function closeWbsModal() {
    wbsModal.style.display = "none";
  }
  btnCloseWbsModal.addEventListener("click", closeWbsModal);
  btnCancelWbsModal.addEventListener("click", closeWbsModal);

  // WBS Element Form Submit
  wbsElementForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const mode = wbsEditMode.value;
    const name = inputWbsName.value.trim();
    if (!name) return;
    const description = inputWbsDesc.value.trim() || null;
    const elemType = selectWbsType.value;

    if (mode === "add") {
      if (elemType === "major_deliverable") {
        const nextNum = `${project.wbs.length + 1}`;
        project.wbs.push({
          id: `DEL-${nextNum}`,
          wbs_number: nextNum,
          name: name,
          description: description,
          type: "major_deliverable",
          children: []
        });
      } else {
        const targetParentId = selectParentElement.value || wbsParentId.value;
        const parentNode = findWbsNode(targetParentId);
        if (!parentNode) {
          alert("Please select a parent deliverable/container.");
          return;
        }
        if (!parentNode.children) parentNode.children = [];
        parentNode.type = (parentNode.type === "major_deliverable") ? "major_deliverable" : "sub_deliverable";

        const childNum = `${parentNode.wbs_number}.${parentNode.children.length + 1}`;
        const newId = (elemType === "work_package") ? `WP-${childNum}` : `SUB-${childNum}`;
        parentNode.children.push({
          id: newId,
          wbs_number: childNum,
          name: name,
          description: description,
          type: elemType,
          children: []
        });
      }
    } else {
      // Edit
      const editId = wbsNodeId.value;
      const node = findWbsNode(editId);
      if (node) {
        node.name = name;
        node.description = description;
      }
    }

    closeWbsModal();
    setWbsDirty(true);
    recalculateWbsNumbers();
    switchWbsTab(activeWbsTab);
  });

  // Top toolbar Add Major Deliverable button
  if (btnAddActivityTop) {
    btnAddActivityTop.addEventListener("click", () => {
      openWbsModal({ mode: "add", presetType: "major_deliverable" });
    });
  }
  
  // TAB 3: DEFINE ACTIVITIES (PER WORK PACKAGE)
  /**
 * Renders the Define Activities table grouped under corresponding Work Packages.
 */
function renderDefineActivitiesTab() {
    recalculateWbsNumbers();
    const workPackages = getAllWorkPackages();

    if (workPackages.length === 0) {
      selectActivityWp.innerHTML = `<option value="">No Work Packages defined in WBS yet</option>`;
      wpActivitiesBreadcrumb.innerHTML = `<em>Please create at least one Work Package in the Project Builder before defining activities.</em>`;
      wpActivitiesListContainer.innerHTML = `
        <div style="background: #F8FAFC; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 3rem 1.5rem; text-align: center; color: var(--muted);">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📦</div>
          <h4 style="color: var(--charcoal); margin-bottom: 0.4rem;">No Work Packages Available</h4>
          <p style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 1.2rem auto; line-height: 1.5;">
            In a WBS, activities represent the concrete actions that produce a Work Package. Decompose your deliverables down to Work Packages first.
          </p>
          <button type="button" class="btn btn-primary btn-sm btn-switch-to-builder">
            🏗️ Switch to Project Builder
          </button>
        </div>
      `;
      const btnSwitch = wpActivitiesListContainer.querySelector(".btn-switch-to-builder");
      if (btnSwitch) btnSwitch.addEventListener("click", () => switchWbsTab("builder"));
      return;
    }

    // Populate Work Packages Select
    if (!selectedActivityWpId || !workPackages.some(wp => wp.id === selectedActivityWpId)) {
      selectedActivityWpId = workPackages[0].id;
    }

    let wpOptionsHtml = "";
    workPackages.forEach(wp => {
      const wpActs = (project.activities || []).filter(a => a.work_package_id === wp.id);
      const isSel = wp.id === selectedActivityWpId;
      wpOptionsHtml += `<option value="${wp.id}" ${isSel ? "selected" : ""}>[${wp.wbs_number}] ${wp.name} (${wpActs.length} activities)</option>`;
    });
    selectActivityWp.innerHTML = wpOptionsHtml;

    // Render Breadcrumb Path
    const path = getWbsPath(selectedActivityWpId);
    if (path && path.length > 0) {
      let bHtml = `<span style="color: var(--charcoal); font-weight: 700;">📁 ${projectName}</span>`;
      path.forEach(pNode => {
        const isTarget = pNode.id === selectedActivityWpId;
        const icon = isTarget ? "📦" : "➔";
        bHtml += ` <span style="color: var(--muted); margin: 0 4px;">${icon}</span> <span style="${isTarget ? 'font-weight: 700; color: #047857;' : 'color: var(--slate);'}">[${pNode.wbs_number}] ${pNode.name}</span>`;
      });
      wpActivitiesBreadcrumb.innerHTML = bHtml;
    } else {
      wpActivitiesBreadcrumb.textContent = "Work Package Selected";
    }

    // Render Activities List for selected Work Package
    const wpActivities = (project.activities || []).filter(a => a.work_package_id === selectedActivityWpId);

    if (wpActivities.length === 0) {
      wpActivitiesListContainer.innerHTML = `
        <div style="background: #FFFFFF; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 2.5rem 1.5rem; text-align: center; color: var(--muted);">
          <div style="font-size: 2rem; margin-bottom: 0.4rem;">📝</div>
          <h4 style="color: var(--charcoal); margin-bottom: 0.3rem;">No Activities Defined for this Work Package</h4>
          <p style="font-size: 0.86rem; max-width: 440px; margin: 0 auto 1.2rem auto; line-height: 1.5;">
            Define the concrete actions, tasks, and operations required to produce this Work Package.
          </p>
          <button type="button" class="btn btn-primary btn-sm btn-inline-add-act">
            ➕ Add First Activity
          </button>
        </div>
      `;
      const btnInline = wpActivitiesListContainer.querySelector(".btn-inline-add-act");
      if (btnInline) {
        btnInline.addEventListener("click", () => openActivityModal({ mode: "add", targetWpId: selectedActivityWpId }));
      }
    } else {
      let actRowsHtml = "";
      wpActivities.forEach((act) => {
        // Appointed Controller badge
        let ctrlHtml = `<span style="font-size: 0.8rem; color: #DC2626; font-weight: 600;">⚠️ No controller appointed</span>`;
        if (act.controller_id) {
          const ctrlIdStr = String(act.controller_id);
          const isLead = ctrlIdStr === String(project.created_by);
          const isValidCtrl = isLead || (project.controllers || []).map(String).includes(ctrlIdStr);
          if (isValidCtrl) {
            const ctrlUser = resolveUser(act.controller_id);
            ctrlHtml = `<span class="badge" style="background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; font-weight: 700; font-size: 0.78rem;">${isLead ? '⭐' : '🛡️'} Controller: ${ctrlUser.last_name || ""}, ${ctrlUser.first_name || ""} (@${ctrlUser.username || ""})</span>`;
          } else {
            ctrlHtml = `<span class="badge" style="background: #FEF2F2; color: #B91C1C; border: 1px solid #FECACA; font-weight: 700; font-size: 0.78rem;">⚠️ Controller Not in Project (Reassign Needed)</span>`;
          }
        }

        // Assigned Teams badges
        let teamsBadges = "";
        if (act.assigned_teams && act.assigned_teams.length > 0) {
          act.assigned_teams.forEach(tId => {
            const t = (project.teams || []).find(tm => String(tm.team_id) === String(tId));
            const tName = t ? t.name : tId;
            teamsBadges += `<span class="badge" style="background: #F1F5F9; color: #334155; border: 1px solid #CBD5E1; font-weight: 600; font-size: 0.78rem;">🏢 ${tName}</span> `;
          });
        }

        // Assigned Individuals badges
        let usersBadges = "";
        if (act.assigned_users && act.assigned_users.length > 0) {
          act.assigned_users.forEach(uId => {
            const u = resolveUser(uId);
            usersBadges += `<span class="badge" style="background: #F8FAFC; color: #475569; border: 1px solid #E2E8F0; font-weight: 600; font-size: 0.78rem;">👤 ${u.first_name || ""} ${u.last_name || ""}</span> `;
          });
        }

        let assignmentDisplay = "";
        if (teamsBadges || usersBadges) {
          assignmentDisplay = `
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
              <span style="font-size: 0.78rem; font-weight: 700; color: var(--slate);">Assigned:</span>
              ${teamsBadges}
              ${usersBadges}
            </div>
          `;
        } else {
          assignmentDisplay = `
            <div style="margin-top: 5px; font-size: 0.78rem; color: #D97706;">
              ⚠️ No teams or individuals assigned yet. Click Edit to assign personnel.
            </div>
          `;
        }

        actRowsHtml += `
          <div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1rem 1.2rem; margin-bottom: 0.8rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; box-shadow: var(--shadow-sm);">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px;">
                <strong style="color: var(--charcoal); font-size: 1.05rem;">${act.name}</strong>
                ${ctrlHtml}
              </div>
              ${act.description ? `<p style="margin: 3px 0 6px 0; font-size: 0.85rem; color: var(--muted); line-height: 1.4;">${act.description}</p>` : ""}
              ${assignmentDisplay}
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <button type="button" class="btn btn-secondary btn-sm btn-edit-activity" data-act-id="${act.activity_id}" style="padding: 4px 10px; font-size: 0.8rem;" title="Edit Activity">
                ✏️ Edit
              </button>
              <button type="button" class="btn btn-secondary btn-sm btn-del-activity" data-act-id="${act.activity_id}" style="padding: 4px 10px; font-size: 0.8rem; color: #DC2626;" title="Delete Activity">
                🗑️
              </button>
            </div>
          </div>
        `;
      });

      wpActivitiesListContainer.innerHTML = `
        <div style="margin-bottom: 0.8rem; font-size: 0.86rem; color: var(--slate); font-weight: 600;">
          Total Activities for this Work Package: ${wpActivities.length}
        </div>
        <div>
          ${actRowsHtml}
        </div>
      `;

      // Attach Edit Activity listeners
      wpActivitiesListContainer.querySelectorAll(".btn-edit-activity").forEach(btn => {
        btn.addEventListener("click", () => {
          const aId = btn.getAttribute("data-act-id");
          openActivityModal({ mode: "edit", activityId: aId, targetWpId: selectedActivityWpId });
        });
      });

      // Attach Delete Activity listeners
      wpActivitiesListContainer.querySelectorAll(".btn-del-activity").forEach(btn => {
        btn.addEventListener("click", async () => {
          const aId = btn.getAttribute("data-act-id");
          const targetAct = (project.activities || []).find(a => a.activity_id === aId);
          if (!targetAct) return;

          if (confirm(`Are you sure you want to delete activity "${targetAct.name}"?`)) {
            project.activities = project.activities.filter(a => a.activity_id !== aId);
            await persistWbsAndActivities(false);
            renderDefineActivitiesTab();
          }
        });
      });

    }
  }

  // Work Package dropdown change
  selectActivityWp.addEventListener("change", () => {
    selectedActivityWpId = selectActivityWp.value;
    renderDefineActivitiesTab();
  });

  // Add Activity button handler
  btnAddActivityItem.addEventListener("click", () => {
    if (!selectedActivityWpId) {
      alert("Please select a Work Package first.");
      return;
    }
    openActivityModal({ mode: "add", targetWpId: selectedActivityWpId });
  });

  // Helper to dynamically render assignment checkboxes
  /**
 * Renders team and individual user assignment checkboxes inside activity modal.
 */
function renderActivityAssignmentCheckboxes() {
    // 1. Determine members in currently selected teams
    const membersInSelectedTeams = new Set();
    (project.teams || []).forEach(t => {
      if (currentActSelectedTeams.has(String(t.team_id))) {
        (t.member_ids || []).forEach(m => membersInSelectedTeams.add(String(m)));
      }
    });

    // Remove any user who is now part of an assigned team
    membersInSelectedTeams.forEach(mId => {
      currentActSelectedUsers.delete(mId);
    });

    // 2. Render Teams checkboxes
    const teams = project.teams || [];
    if (teams.length === 0) {
      activityTeamsCheckboxes.innerHTML = `<span style="font-size: 0.82rem; color: var(--muted);">No teams configured for this project.</span>`;
    } else {
      let teamsHtml = "";
      teams.forEach(t => {
        const isChecked = currentActSelectedTeams.has(String(t.team_id));
        teamsHtml += `
          <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer; font-size: 0.86rem; color: var(--charcoal);">
            <input type="checkbox" class="chk-act-team" value="${t.team_id}" ${isChecked ? "checked" : ""}>
            <span><strong>${t.name}</strong> <span style="color: var(--muted); font-size: 0.8rem;">(${(t.member_ids || []).length} members)</span></span>
          </label>
        `;
      });
      activityTeamsCheckboxes.innerHTML = teamsHtml;

      activityTeamsCheckboxes.querySelectorAll(".chk-act-team").forEach(chk => {
        chk.addEventListener("change", () => {
          const tId = chk.value;
          if (chk.checked) {
            currentActSelectedTeams.add(tId);
          } else {
            currentActSelectedTeams.delete(tId);
          }
          renderActivityAssignmentCheckboxes();
        });
      });
    }

    // 3. Render Individuals checkboxes
    const allProjectUserIds = new Set();
    (project.assigned_user_ids || []).forEach(u => allProjectUserIds.add(String(u)));
    (project.teams || []).forEach(t => {
      (t.member_ids || []).forEach(m => allProjectUserIds.add(String(m)));
    });
    if (project.created_by) allProjectUserIds.add(String(project.created_by));

    const userList = Array.from(allProjectUserIds).map(uid => resolveUser(uid));
    userList.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));

    if (userList.length === 0) {
      activityUsersCheckboxes.innerHTML = `<span style="font-size: 0.82rem; color: var(--muted);">No contributors found for this project.</span>`;
    } else {
      let usersHtml = "";
      userList.forEach(u => {
        const uid = String(u.id || u._id);
        const isPartOfSelectedTeam = membersInSelectedTeams.has(uid);
        const isChecked = currentActSelectedUsers.has(uid);

        if (isPartOfSelectedTeam) {
          const inTeamNames = [];
          (project.teams || []).forEach(t => {
            if (currentActSelectedTeams.has(String(t.team_id)) && (t.member_ids || []).map(String).includes(uid)) {
              inTeamNames.push(t.name);
            }
          });
          usersHtml += `
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.84rem; color: var(--muted); opacity: 0.65; cursor: not-allowed;" title="Cannot select separately because this contributor is already in team: ${inTeamNames.join(', ')}">
              <input type="checkbox" disabled>
              <span>${u.last_name || ""}, ${u.first_name || ""} (@${u.username || ""}) <span class="badge badge-slate" style="font-size: 0.72rem;">Part of: ${inTeamNames.join(', ')}</span></span>
            </label>
          `;
        } else {
          usersHtml += `
            <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer; font-size: 0.86rem; color: var(--charcoal);">
              <input type="checkbox" class="chk-act-user" value="${uid}" ${isChecked ? "checked" : ""}>
              <span><strong>${u.last_name || ""}, ${u.first_name || ""}</strong> (@${u.username || ""}) • <span>${u.role || "Member"}</span></span>
            </label>
          `;
        }
      });
      activityUsersCheckboxes.innerHTML = usersHtml;

      activityUsersCheckboxes.querySelectorAll(".chk-act-user").forEach(chk => {
        chk.addEventListener("change", () => {
          const uid = chk.value;
          if (chk.checked) {
            currentActSelectedUsers.add(uid);
          } else {
            currentActSelectedUsers.delete(uid);
          }
        });
      });
    }
  }

  // Activity Modal helpers
  /**
   * Opens modal dialog to create or edit an operational activity.
   */
  function openActivityModal({ mode = "add", activityId = null, targetWpId = null }) {
    activityEditMode.value = mode;
    activityEditId.value = activityId || "";
    activityTargetWpId.value = targetWpId || selectedActivityWpId || "";
    activityModalError.style.display = "none";

    const wp = findWbsNode(activityTargetWpId.value);
    const wpLabel = wp ? `[${wp.wbs_number}] ${wp.name}` : "Selected Work Package";

    // Populate Controllers Dropdown
    const controllerSet = new Set();
    if (project.created_by) controllerSet.add(String(project.created_by));
    (project.controllers || []).forEach(c => controllerSet.add(String(c)));

    let ctrlOptions = `<option value="">Select an appointed project controller...</option>`;
    controllerSet.forEach(cId => {
      const u = resolveUser(cId);
      const isLeadPM = String(cId) === String(project.created_by);
      ctrlOptions += `<option value="${cId}">
        ${isLeadPM ? "⭐ " : "🛡️ "}${u.last_name || ""}, ${u.first_name || ""} (@${u.username || ""}) — ${isLeadPM ? "Lead PM / Controller" : "Controller"}
      </option>`;
    });
    selectActivityController.innerHTML = ctrlOptions;

    if (mode === "add") {
      activityModalTitle.textContent = `Add Activity to ${wpLabel}`;
      inputActivityName.value = "";
      inputActivityDesc.value = "";
      selectActivityController.value = "";
      const inputActivityIsMilestone = document.getElementById("input-activity-is-milestone");
      if (inputActivityIsMilestone) inputActivityIsMilestone.checked = false;
      currentActSelectedTeams = new Set();
      currentActSelectedUsers = new Set();
    } else {
      const act = (project.activities || []).find(a => a.activity_id === activityId);
      activityModalTitle.textContent = "Edit Activity";
      inputActivityName.value = act ? (act.name || "") : "";
      inputActivityDesc.value = act ? (act.description || "") : "";
      const actCid = act && act.controller_id ? String(act.controller_id) : "";
      const isLead = actCid === String(project.created_by);
      const isValidCid = isLead || (project.controllers || []).map(String).includes(actCid);
      selectActivityController.value = isValidCid ? actCid : "";
      const inputActivityIsMilestone = document.getElementById("input-activity-is-milestone");
      if (inputActivityIsMilestone) {
        inputActivityIsMilestone.checked = act ? Boolean(act.is_milestone || act.duration === 0) : false;
      }
      currentActSelectedTeams = new Set((act && act.assigned_teams ? act.assigned_teams : []).map(String));
      currentActSelectedUsers = new Set((act && act.assigned_users ? act.assigned_users : []).map(String));
    }

    renderActivityAssignmentCheckboxes();
    activityModal.style.display = "flex";
    inputActivityName.focus();
  }

  /**
 * Closes the activity modal dialog.
 */
function closeActivityModal() {
    activityModal.style.display = "none";
  }
  btnCloseActivityModal.addEventListener("click", closeActivityModal);
  btnCancelActivityModal.addEventListener("click", closeActivityModal);

  // Activity Form submit
  activityForm.addEventListener("submit", (e) => {
    e.preventDefault();
    activityModalError.style.display = "none";

    const mode = activityEditMode.value;
    const name = inputActivityName.value.trim();
    if (!name) return;
    const description = inputActivityDesc.value.trim() || null;
    const targetWp = activityTargetWpId.value;
    const controllerId = selectActivityController.value;
    const inputActivityIsMilestone = document.getElementById("input-activity-is-milestone");
    const isMilestone = Boolean(inputActivityIsMilestone && inputActivityIsMilestone.checked);

    if (!controllerId) {
      activityModalError.textContent = "Please appoint a Controller for this task from the project controllers list.";
      activityModalError.style.display = "block";
      return;
    }

    if (currentActSelectedTeams.size === 0 && currentActSelectedUsers.size === 0) {
      activityModalError.textContent = "Please assign at least one team, one individual, or a combination of both.";
      activityModalError.style.display = "block";
      return;
    }

    if (!project.activities) project.activities = [];

    const assignedTeams = Array.from(currentActSelectedTeams);
    const assignedUsers = Array.from(currentActSelectedUsers);

    if (mode === "add") {
      const newActId = `ACT-${project.activities.length + 1}`;
      project.activities.push({
        activity_id: newActId,
        work_package_id: targetWp,
        name: name,
        description: description,
        controller_id: controllerId,
        assigned_teams: assignedTeams,
        assigned_users: assignedUsers,
        is_milestone: isMilestone,
        duration: isMilestone ? 0.0 : 5.0,
        expected_time: isMilestone ? 0.0 : 5.0
      });
    } else {
      const aId = activityEditId.value;
      const act = project.activities.find(a => a.activity_id === aId);
      if (act) {
        act.name = name;
        act.description = description;
        act.controller_id = controllerId;
        act.assigned_teams = assignedTeams;
        act.assigned_users = assignedUsers;
        act.is_milestone = isMilestone;
        if (isMilestone) {
          act.duration = 0.0;
          act.expected_time = 0.0;
          act.optimistic = 0.0;
          act.most_likely = 0.0;
          act.pessimistic = 0.0;
        }
      }
    }

    closeActivityModal();
    setWbsDirty(true);
    renderDefineActivitiesTab();
  });

  // Save All Changes button (Saves both WBS and Activities)
  btnSaveWbsActivities.addEventListener("click", async () => {
    const success = await persistWbsAndActivities(true);
    if (success && wbsAlertMsg) {
      wbsAlertMsg.textContent = "✓ Work Breakdown Structure and Activities saved successfully to database.";
      wbsAlertMsg.style.display = "block";
      setTimeout(() => {
        wbsAlertMsg.style.display = "none";
      }, 3500);
      switchWbsTab(activeWbsTab);
    }
  });


  // Initial call when switching to View 2
  /**
 * Main render dispatcher for Section 2 (Scope & Work Breakdown Structure).
 */
function renderWbsView() {
    recalculateWbsNumbers();
    switchWbsTab(activeWbsTab || "builder");
  }

  
  // VIEW 3: SEQUENCE ACTIVITIES & SCHEDULE HEALTH ENGINE
  // Cycle detection on client-side graph
  /**
 * Client-side DFS cycle detector identifying circular precedence loops.
 */
function detectScheduleCyclesClient(nodeIds, edges) {
    const adj = {};
    nodeIds.forEach(id => { adj[id] = []; });
    edges.forEach(e => {
      const u = (e.from_activity_id || e.from || "").trim();
      const v = (e.to_activity_id || e.to || "").trim();
      if (u && v && adj[u]) {
        adj[u].push(v);
      }
    });

    const visited = {};
    nodeIds.forEach(id => { visited[id] = 0; });
    const cyclePath = [];

    /**
     * Recursive depth-first search helper detecting back-edges in precedence network.
     */
    function dfs(u, path) {
      visited[u] = 1;
      path.push(u);
      for (const v of (adj[u] || [])) {
        if (visited[v] === 1) {
          const idx = path.indexOf(v);
          cyclePath.push(...path.slice(idx), v);
          return true;
        } else if (visited[v] === 0) {
          if (dfs(v, path)) return true;
        }
      }
      path.pop();
      visited[u] = 2;
      return false;
    }

    for (const id of nodeIds) {
      if (visited[id] === 0) {
        if (dfs(id, [])) return cyclePath;
      }
    }
    return null;
  }

  // Client-side Schedule Health Evaluation Engine
  /**
 * Evaluates schedule network health metrics, dangling nodes, and redundant links in browser.
 */
function evaluateScheduleHealthClient(activities, dependencies) {
    const actIds = (activities || []).map(a => a.activity_id).filter(Boolean);
    const actIdSet = new Set(actIds);

    const hasStartAnchor = new Set();
    const hasFinishDriver = new Set();
    const logicDensity = {};
    actIds.forEach(id => { logicDensity[id] = 0; });

    const pairSeen = new Set();
    const redundantLinks = [];
    const sfLinks = [];
    const excessiveLags = [];
    const invalidLinks = [];

    (dependencies || []).forEach(dep => {
      const fromId = (dep.from_activity_id || dep.from || "").trim();
      const toId = (dep.to_activity_id || dep.to || "").trim();
      let rawType = (dep.type || "FS").trim().toUpperCase();
      if (rawType.includes("(") && rawType.includes(")")) {
        rawType = rawType.split("(")[1].replace(")", "").trim();
      }
      const lag = parseFloat(dep.lag_days || 0);

      if (!actIdSet.has(fromId) || !actIdSet.has(toId)) {
        invalidLinks.push(`Dependency links unknown activity: '${fromId}' ➔ '${toId}'`);
        return;
      }

      const pairKey = `${fromId}->${toId}`;
      if (pairSeen.has(pairKey)) {
        redundantLinks.push(`Duplicate link between '${fromId}' and '${toId}'`);
      } else {
        pairSeen.add(pairKey);
      }

      logicDensity[fromId] = (logicDensity[fromId] || 0) + 1;
      logicDensity[toId] = (logicDensity[toId] || 0) + 1;

      // Start anchor: predecessor must be FS or SS
      if (rawType === "FS" || rawType === "SS") {
        hasStartAnchor.add(toId);
      }

      // Finish driver: successor must be FS or FF
      if (rawType === "FS" || rawType === "FF") {
        hasFinishDriver.add(fromId);
      }

      // SF link
      if (rawType === "SF") {
        sfLinks.push({ from: fromId, to: toId });
      }

      // Excessive lag (> 2 days)
      if (lag > 2.0) {
        excessiveLags.push({
          from: fromId,
          to: toId,
          lag_days: lag,
          warning: `Lag of ${lag} days exceeds 2-day threshold.`
        });
      }
    });

    const totalActs = actIds.length;
    const projectStartId = totalActs > 0 ? actIds[0] : null;
    const projectEndId = totalActs > 0 ? actIds[totalActs - 1] : null;

    const unanchoredStarts = totalActs > 1 ? actIds.filter(id => !hasStartAnchor.has(id)) : [];
    const unanchoredFinishes = totalActs > 1 ? actIds.filter(id => !hasFinishDriver.has(id)) : [];

    // True dangling activities exclude the project start milestone and project end milestone
    const danglingStarts = unanchoredStarts.filter(id => id !== projectStartId);
    const danglingFinishes = unanchoredFinishes.filter(id => id !== projectEndId);

    const excessiveDensity = Object.entries(logicDensity)
      .filter(([id, cnt]) => cnt > 4)
      .map(([id, cnt]) => ({ activity_id: id, count: cnt }));

    const cyclePath = detectScheduleCyclesClient(actIds, dependencies || []);

    // Calculate score
    let score = 100;
    const deductions = [];

    if (cyclePath) {
      score = 0;
      deductions.push("Circular logic loop detected (-100 pts)");
    } else {
      if (danglingStarts.length > 0) {
        const startDeduction = Math.min(danglingStarts.length * 10, 30);
        score -= startDeduction;
        deductions.push(`${danglingStarts.length} unlinked start(s) (-${startDeduction} pts)`);
      }

      if (danglingFinishes.length > 0) {
        const finishDeduction = Math.min(danglingFinishes.length * 10, 30);
        score -= finishDeduction;
        deductions.push(`${danglingFinishes.length} unlinked finish(es) (-${finishDeduction} pts)`);
      }

      if (excessiveLags.length > 0) {
        const lagDeduction = Math.min(excessiveLags.length * 3, 15);
        score -= lagDeduction;
        deductions.push(`${excessiveLags.length} high lag link(s) > 2d (-${lagDeduction} pts)`);
      }

      if (excessiveDensity.length > 0) {
        const densityDeduction = Math.min(excessiveDensity.length * 2, 10);
        score -= densityDeduction;
        deductions.push(`${excessiveDensity.length} high logic density activity(ies) (-${densityDeduction} pts)`);
      }
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      is_healthy: score >= 80 && !cyclePath && danglingStarts.length === 0 && danglingFinishes.length === 0,
      total_activities: totalActs,
      total_dependencies: (dependencies || []).length,
      project_start: projectStartId,
      project_end: projectEndId,
      open_starts: danglingStarts,
      open_finishes: danglingFinishes,
      sf_links: sfLinks,
      excessive_lags: excessiveLags,
      excessive_density: excessiveDensity,
      redundant_links: redundantLinks,
      invalid_links: invalidLinks,
      cycle_path: cyclePath,
      deductions
    };
  }

  // Open Add/Edit Precedence Dependency Modal helper
  window.openAddDependencyFor = function(activityId, role) {
    openAddDependencyModal(-1);
    if (role === 'successor') {
      selectDepSuccessor.value = activityId;
    } else if (role === 'predecessor') {
      selectDepPredecessor.value = activityId;
    }
    validateDependencyModalInput();
  };

  // Render Clean Schedule Health Status Bar & Detailed Diagnostic Guidance
  /**
 * Renders schedule health score, diagnostic indicators, and actionable error alerts.
 */
function renderScheduleHealthUI(health) {
    if (!health) return;

    const activities = project.activities || [];
    const actMap = {};
    activities.forEach(a => { actMap[a.activity_id] = a.name; });

    if (health.cycle_path) {
      healthStatusIndicator.className = "badge badge-rose";
      healthStatusIndicator.innerHTML = `⛔ Logic Loop Detected (0%)`;
      healthQuickSummary.innerHTML = `Circular dependency: <strong>${health.cycle_path.join(' ➔ ')}</strong>`;
      scheduleHealthDrawer.style.display = "block";
      btnToggleHealthDetails.textContent = "Diagnostics ▴";
    } else if (health.is_healthy) {
      healthStatusIndicator.className = "badge badge-emerald";
      healthStatusIndicator.innerHTML = `✅ Complete Workflow (100%)`;
      healthQuickSummary.textContent = `${health.total_activities} Activities • ${health.total_dependencies} Dependencies • Clean flow from Entry (${health.project_start || 'Start'}) to Exit (${health.project_end || 'Finish'})`;
    } else {
      healthStatusIndicator.className = "badge badge-amber";
      healthStatusIndicator.innerHTML = `⚠️ Schedule Health: ${health.score}%`;
      const issueCount = health.open_starts.length + health.open_finishes.length;
      healthQuickSummary.textContent = `${health.total_activities} Activities • ${health.total_dependencies} Dependencies • ${issueCount} unlinked task(s) found`;
    }

    // Diagnostics Drawer Details
    const findings = [];

    // 1. Critical: Circular Dependency Loop
    if (health.cycle_path) {
      const loopStr = health.cycle_path.map(id => `<strong>${id}</strong> (${actMap[id] || 'Activity'})`).join(" ➔ ");
      findings.push(`
        <div class="diagnostic-card critical">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #991B1B;">
              ⛔ Critical Blocker: Circular Precedence Loop Detected
            </div>
            <span class="badge badge-rose" style="font-size: 0.72rem;">Score: 0% (Fatal)</span>
          </div>
          <div style="font-size: 0.85rem; color: #7F1D1D; margin-bottom: 0.6rem;">
            <strong>Detected Cycle:</strong> ${loopStr}
          </div>
          <div style="font-size: 0.84rem; color: #450A0A; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #FECACA; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is this issue?</strong> The schedule network contains an infinite dependency loop where an activity depends on itself through a chain of predecessors. A schedule must be a strict Directed Acyclic Graph (DAG).
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> A circular loop causes infinite recursion during forward and backward passes. It makes it mathematically impossible to calculate Early Dates, Late Dates, or Total Float, invalidating the entire project schedule.
            </div>
            <div>
              <strong>• How to Resolve:</strong>
              <ol style="margin: 0.3rem 0 0 1.2rem; padding: 0;">
                <li>Identify which dependency creates the reverse link in the cycle above.</li>
                <li>Switch to the <strong>Dependencies List</strong> tab, locate that dependency, and delete or re-route it to a downstream task.</li>
              </ol>
            </div>
          </div>
        </div>
      `);
    }

    // 2. Open Start Activities (Dangling Predecessor Link)
    if (health.open_starts.length > 0) {
      const taskListHtml = health.open_starts.map(id => `
        <li style="display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px dashed #FDE68A;">
          <div>
            <strong style="color: #92400E;">${id}</strong>: ${actMap[id] || 'Activity'}
          </div>
          <button type="button" class="btn btn-outline-primary btn-xs" onclick="openAddDependencyFor('${id}', 'successor')" title="Link predecessor for ${id}">
            ➕ Anchor with Predecessor
          </button>
        </li>
      `).join("");

      findings.push(`
        <div class="diagnostic-card warning">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #92400E;">
              ⏳ Open Start Activities (${health.open_starts.length} task(s) unanchored)
            </div>
            <span class="badge badge-amber" style="font-size: 0.72rem;">Logic Integrity</span>
          </div>
          <div style="font-size: 0.84rem; color: #78350F; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #FDE68A; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is an "Open Start"?</strong> An activity has no incoming predecessor link (neither <code>Finish-to-Start [FS]</code> nor <code>Start-to-Start [SS]</code>) to anchor when it can begin. In project management standards (PMBOK and DCMA 14-Point Assessment), only the initial project kick-off milestone should begin without a predecessor.
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> Without a predecessor, the scheduling engine assumes the task can start immediately on Day 1 of the project. This produces <em>artificial float</em> (unrealistic excess buffer) that conceals real project bottlenecks and distorts the true Critical Path.
            </div>
            <div>
              <strong>• How to Resolve:</strong>
              <ol style="margin: 0.3rem 0 0 1.2rem; padding: 0;">
                <li>Identify which prior work package or milestone produces the inputs needed for each task below.</li>
                <li>Click <strong>"➕ Anchor with Predecessor"</strong> beside each task to open the dependency form with the task preselected as successor, and select its predecessor.</li>
              </ol>
            </div>
          </div>
          <div style="font-size: 0.82rem; color: #92400E; font-weight: 700; margin-bottom: 0.25rem;">Affected Tasks:</div>
          <ul style="list-style: none; padding: 0; margin: 0; background: #FFFFFF; border: 1px solid #FDE68A; border-radius: 4px; padding: 0.4rem 0.8rem; font-size: 0.84rem;">
            ${taskListHtml}
          </ul>
        </div>
      `);
    }

    // 3. Open Finish Activities (Dangling Successor Link)
    if (health.open_finishes.length > 0) {
      const taskListHtml = health.open_finishes.map(id => `
        <li style="display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px dashed #FDE68A;">
          <div>
            <strong style="color: #92400E;">${id}</strong>: ${actMap[id] || 'Activity'}
          </div>
          <button type="button" class="btn btn-outline-primary btn-xs" onclick="openAddDependencyFor('${id}', 'predecessor')" title="Link successor for ${id}">
            ➕ Connect to Successor
          </button>
        </li>
      `).join("");

      findings.push(`
        <div class="diagnostic-card warning">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #92400E;">
              🏁 Open Finish Activities (${health.open_finishes.length} task(s) unconstrained)
            </div>
            <span class="badge badge-amber" style="font-size: 0.72rem;">Logic Integrity</span>
          </div>
          <div style="font-size: 0.84rem; color: #78350F; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #FDE68A; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is an "Open Finish"?</strong> An activity has no outgoing successor link (neither <code>Finish-to-Start [FS]</code> nor <code>Finish-to-Finish [FF]</code>) that is constrained by its completion. Only the final project delivery milestone should have an unconstrained finish.
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> If a task has no successor, any delays or cost overruns occurring in this task will never propagate downstream to affect the project end date. The task effectively "falls off" the critical path, blinding management to real delivery risks.
            </div>
            <div>
              <strong>• How to Resolve:</strong>
              <ol style="margin: 0.3rem 0 0 1.2rem; padding: 0;">
                <li>Determine which subsequent task or phase milestone depends on the completion of each task below.</li>
                <li>Click <strong>"➕ Connect to Successor"</strong> beside each task to open the dependency form with the task preselected as predecessor, and select its successor.</li>
              </ol>
            </div>
          </div>
          <div style="font-size: 0.82rem; color: #92400E; font-weight: 700; margin-bottom: 0.25rem;">Affected Tasks:</div>
          <ul style="list-style: none; padding: 0; margin: 0; background: #FFFFFF; border: 1px solid #FDE68A; border-radius: 4px; padding: 0.4rem 0.8rem; font-size: 0.84rem;">
            ${taskListHtml}
          </ul>
        </div>
      `);
    }

    // 4. Excessive Lags (> 2 days)
    if (health.excessive_lags.length > 0) {
      findings.push(`
        <div class="diagnostic-card info">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #0369A1;">
              ℹ️ High Lag Offset (&gt; 2 working days — ${health.excessive_lags.length} link(s))
            </div>
            <span class="badge badge-blue" style="font-size: 0.72rem;">Best Practice</span>
          </div>
          <div style="font-size: 0.84rem; color: #0C4A6E; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #BAE6FD; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is this issue?</strong> Dependencies contain lag offsets exceeding 2 days (${health.excessive_lags.map(l => `${l.from} ➔ ${l.to} [${l.lag_days}d]`).join("; ")}).
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> DCMA 14-Point schedule health standards caution against long positive lags because they frequently represent unmodeled work, invisible waiting periods (e.g. curing time, review cycles), or artificial padding that evades progress tracking.
            </div>
            <div>
              <strong>• How to Resolve:</strong> If the delay represents active work, review periods, or vendor transit, convert the lag into a distinct activity node in the WBS instead of an invisible offset.
            </div>
          </div>
        </div>
      `);
    }

    // 5. Perfect Clean Workflow
    if (findings.length === 0) {
      findings.push(`
        <div class="diagnostic-card success">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.6rem;">
            <span style="font-size: 1.25rem;">✅</span>
            <div style="font-weight: 700; font-size: 0.98rem; color: #166534;">
              Continuous, Defect-Free Precedence Network (100% Health Score)
            </div>
          </div>
          <p style="margin: 0 0 0.6rem 0; font-size: 0.85rem; color: #14532D; line-height: 1.5;">
            The project schedule meets all DCMA 14-point and PMBOK network integrity requirements:
          </p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 0.5rem;">
            <div style="background: #FFFFFF; padding: 0.7rem 0.9rem; border-radius: 4px; border: 1px solid #BBF7D0;">
              <span style="font-size: 0.72rem; color: #15803D; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Initial Entry Milestone</span><br>
              <strong style="color: #14532D; font-size: 0.9rem;">${health.project_start || 'Start'}</strong>
              <div style="font-size: 0.78rem; color: #4B5563;">${actMap[health.project_start] || 'Project Start'}</div>
            </div>
            <div style="background: #FFFFFF; padding: 0.7rem 0.9rem; border-radius: 4px; border: 1px solid #BBF7D0;">
              <span style="font-size: 0.72rem; color: #15803D; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Final Exit Milestone</span><br>
              <strong style="color: #14532D; font-size: 0.9rem;">${health.project_end || 'Finish'}</strong>
              <div style="font-size: 0.78rem; color: #4B5563;">${actMap[health.project_end] || 'Project Completion'}</div>
            </div>
            <div style="background: #FFFFFF; padding: 0.7rem 0.9rem; border-radius: 4px; border: 1px solid #BBF7D0;">
              <span style="font-size: 0.72rem; color: #15803D; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Topology Status</span><br>
              <strong style="color: #14532D; font-size: 0.9rem;">Validated DAG</strong>
              <div style="font-size: 0.78rem; color: #4B5563;">0 loops • 0 open ends • 0 negative lags</div>
            </div>
          </div>
        </div>
      `);
    }

    healthDiagnosticsDetails.innerHTML = findings.join("");
  }

  // Toggle Health Diagnostics Drawer
  btnToggleHealthDetails.addEventListener("click", () => {
    const isHidden = scheduleHealthDrawer.style.display === "none";
    scheduleHealthDrawer.style.display = isHidden ? "block" : "none";
    btnToggleHealthDetails.textContent = isHidden ? "Diagnostics ▴" : "Diagnostics ▾";
  });

  // Tab switching between Diagram and Table
  /**
 * Switches between Precedence Diagramming Method (PDM) Network and Dependency Table tabs.
 */
function switchSeqTab(tab) {
    activeSeqTab = tab;
    if (tab === "diagram") {
      tabBtnDiagram.classList.add("active");
      tabBtnDiagram.style.color = "var(--primary)";
      tabBtnDiagram.style.borderBottom = "3px solid var(--primary)";
      tabBtnDiagram.style.fontWeight = "700";

      tabBtnTable.classList.remove("active");
      tabBtnTable.style.color = "var(--slate)";
      tabBtnTable.style.borderBottom = "3px solid transparent";
      tabBtnTable.style.fontWeight = "600";

      seqPaneDiagram.style.display = "block";
      seqPaneTable.style.display = "none";
      diagramToolbar.style.display = "flex";

      if (networkInstance) {
        setTimeout(() => { networkInstance.fit({ animation: true }); }, 50);
      }
    } else {
      tabBtnTable.classList.add("active");
      tabBtnTable.style.color = "var(--primary)";
      tabBtnTable.style.borderBottom = "3px solid var(--primary)";
      tabBtnTable.style.fontWeight = "700";

      tabBtnDiagram.classList.remove("active");
      tabBtnDiagram.style.color = "var(--slate)";
      tabBtnDiagram.style.borderBottom = "3px solid transparent";
      tabBtnDiagram.style.fontWeight = "600";

      seqPaneDiagram.style.display = "none";
      seqPaneTable.style.display = "block";
      diagramToolbar.style.display = "none";
    }
  }

  tabBtnDiagram.addEventListener("click", () => switchSeqTab("diagram"));
  tabBtnTable.addEventListener("click", () => switchSeqTab("table"));

  // Real-time In-Modal Validation
  /**
 * Validates precedence relationship inputs, preventing self-dependencies and negative lags.
 */
function validateDependencyModalInput() {
    const fromId = selectDepPredecessor.value;
    const toId = selectDepSuccessor.value;
    const rawType = selectDepType.value;
    const lag = parseFloat(inputDepLag.value || 0);
    const editIdx = parseInt(dependencyEditIndex.value, 10);

    const submitBtn = dependencyForm.querySelector('button[type="submit"]');

    const descriptions = {
      FS: "Finish-to-Start (FS): Predecessor must finish before Successor can start.",
      SS: "Start-to-Start (SS): Successor starts after Predecessor starts.",
      FF: "Finish-to-Finish (FF): Successor finishes after Predecessor finishes.",
      SF: "Start-to-Finish (SF): Successor cannot finish until Predecessor has started."
    };
    depTypeExplanation.textContent = descriptions[rawType] || "";

    const errors = [];
    const warnings = [];

    if (fromId && toId && fromId === toId) {
      errors.push(`Predecessor and successor cannot be the same activity ('${fromId}').`);
    }

    if (isNaN(lag) || lag < 0) {
      errors.push(`Negative lag (${lag} days) is prohibited.`);
    }

    if (fromId && toId && fromId !== toId) {
      const currentDeps = project.dependencies || [];
      const isDuplicate = currentDeps.some((d, idx) => {
        if (editIdx >= 0 && idx === editIdx) return false;
        const dFrom = d.from_activity_id || d.from;
        const dTo = d.to_activity_id || d.to;
        return dFrom === fromId && dTo === toId;
      });
      if (isDuplicate) {
        warnings.push(`A dependency between '${fromId}' and '${toId}' already exists.`);
      }

      // Cycle simulation
      const simulatedEdges = currentDeps
        .filter((_, idx) => editIdx < 0 || idx !== editIdx)
        .map(d => ({ from: d.from_activity_id || d.from, to: d.to_activity_id || d.to }));
      simulatedEdges.push({ from: fromId, to: toId });

      const actIds = (project.activities || []).map(a => a.activity_id).filter(Boolean);
      const cycle = detectScheduleCyclesClient(actIds, simulatedEdges);
      if (cycle) {
        errors.push(`Circular loop detected: ${cycle.join(' ➔ ')}.`);
      }
    }

    if (errors.length > 0) {
      dependencyModalAlert.className = "alert-box alert-danger";
      dependencyModalAlert.style.display = "block";
      dependencyModalAlert.innerHTML = `<strong>Error:</strong> ${errors.join("<br>")}`;
      submitBtn.disabled = true;
      return false;
    } else if (warnings.length > 0) {
      dependencyModalAlert.className = "alert-box alert-warning";
      dependencyModalAlert.style.display = "block";
      dependencyModalAlert.innerHTML = `<strong>Notice:</strong> ${warnings.join("<br>")}`;
      submitBtn.disabled = false;
      return true;
    } else {
      dependencyModalAlert.style.display = "none";
      submitBtn.disabled = false;
      return true;
    }
  }

  // Open Dependency Modal
  /**
 * Opens modal dialog to create or modify an activity precedence dependency.
 */
function openAddDependencyModal(editIdx = -1) {
    dependencyEditIndex.value = editIdx;
    const activities = project.activities || [];

    selectDepPredecessor.innerHTML = '<option value="">Select predecessor activity...</option>' +
      activities.map(a => `<option value="${a.activity_id}">📌 ${a.activity_id}: ${a.name}</option>`).join('');

    selectDepSuccessor.innerHTML = '<option value="">Select successor activity...</option>' +
      activities.map(a => `<option value="${a.activity_id}">📌 ${a.activity_id}: ${a.name}</option>`).join('');

    const submitBtn = dependencyForm.querySelector('button[type="submit"]');

    if (editIdx >= 0 && project.dependencies && project.dependencies[editIdx]) {
      const dep = project.dependencies[editIdx];
      dependencyModalTitle.textContent = "Edit Precedence Dependency";
      selectDepPredecessor.value = dep.from_activity_id || dep.from || "";
      selectDepSuccessor.value = dep.to_activity_id || dep.to || "";
      
      let rawType = dep.type || "FS";
      if (rawType.includes("(") && rawType.includes(")")) {
        rawType = rawType.split("(")[1].replace(")", "").trim();
      }
      selectDepType.value = rawType;
      inputDepLag.value = dep.lag_days !== undefined ? dep.lag_days : 0;
      inputDepDesc.value = dep.description || "";
      submitBtn.textContent = "💾 Update Dependency";
    } else {
      dependencyModalTitle.textContent = "Add Precedence Dependency";
      selectDepPredecessor.value = "";
      selectDepSuccessor.value = "";
      selectDepType.value = "FS";
      inputDepLag.value = 0;
      inputDepDesc.value = "";
      submitBtn.textContent = "➕ Add Dependency";
    }

    validateDependencyModalInput();
    dependencyModal.style.display = "flex";
  }

  /**
 * Closes the precedence dependency modal dialog.
 */
function closeDependencyModal() {
    dependencyModal.style.display = "none";
    dependencyModalAlert.style.display = "none";
  }

  btnCloseDependencyModal.addEventListener("click", closeDependencyModal);
  btnCancelDependencyModal.addEventListener("click", closeDependencyModal);
  btnOpenAddDependency.addEventListener("click", () => openAddDependencyModal(-1));

  selectDepPredecessor.addEventListener("change", validateDependencyModalInput);
  selectDepSuccessor.addEventListener("change", validateDependencyModalInput);
  selectDepType.addEventListener("change", validateDependencyModalInput);
  inputDepLag.addEventListener("input", validateDependencyModalInput);

  dependencyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateDependencyModalInput()) return;

    const fromId = selectDepPredecessor.value;
    const toId = selectDepSuccessor.value;
    const type = selectDepType.value;
    const lag = parseFloat(inputDepLag.value || 0);
    const desc = inputDepDesc.value.trim();
    const editIdx = parseInt(dependencyEditIndex.value, 10);

    if (!project.dependencies) project.dependencies = [];

    const depPayload = {
      dependency_id: editIdx >= 0 ? (project.dependencies[editIdx].dependency_id || `DEP-${editIdx+1}`) : `DEP-${project.dependencies.length+1}`,
      from_activity_id: fromId,
      to_activity_id: toId,
      type: type,
      lag_days: lag,
      description: desc
    };

    if (editIdx >= 0) {
      project.dependencies[editIdx] = depPayload;
    } else {
      project.dependencies.push(depPayload);
    }

    hasUnsavedDependencies = true;
    closeDependencyModal();
    renderSequenceView();

    seqSaveStatus.textContent = "Unsaved Changes";
    seqSaveStatus.className = "badge badge-amber";
    seqSaveStatus.style.display = "inline-block";
  });

  // Canvas Controls
  btnCanvasZoomIn.addEventListener("click", () => {
    if (networkInstance) {
      const scale = networkInstance.getScale();
      networkInstance.moveTo({ scale: scale * 1.3, animation: true });
    }
  });

  btnCanvasZoomOut.addEventListener("click", () => {
    if (networkInstance) {
      const scale = networkInstance.getScale();
      networkInstance.moveTo({ scale: scale * 0.7, animation: true });
    }
  });

  btnCanvasFit.addEventListener("click", () => {
    if (networkInstance) {
      networkInstance.fit({ animation: true });
    }
  });

  // Save Dependencies Action
  btnSaveDependencies.addEventListener("click", async () => {
    btnSaveDependencies.disabled = true;
    btnSaveDependencies.innerHTML = `⏳ Saving...`;
    seqAlertMsg.style.display = "none";

    try {
      const res = await updateProjectDependencies(project.id, project.dependencies || []);
      if (res.error) {
        seqAlertMsg.className = "alert alert-danger";
        seqAlertMsg.textContent = `Failed to save: ${res.error}`;
        seqAlertMsg.style.display = "block";
      } else {
        project = res.data;
        hasUnsavedDependencies = false;
        seqAlertMsg.className = "alert alert-success";
        seqAlertMsg.textContent = "✓ Dependencies saved successfully!";
        seqAlertMsg.style.display = "block";
        seqSaveStatus.textContent = "Saved";
        seqSaveStatus.className = "badge badge-emerald";
        seqSaveStatus.style.display = "inline-block";
        setTimeout(() => {
          seqAlertMsg.style.display = "none";
        }, 3000);
        renderSequenceView();
      }
    } catch (err) {
      seqAlertMsg.className = "alert alert-danger";
      seqAlertMsg.textContent = `Error: ${err.message}`;
      seqAlertMsg.style.display = "block";
    } finally {
      btnSaveDependencies.disabled = false;
      btnSaveDependencies.innerHTML = `💾 Save Dependencies`;
    }
  });

  // Auto-generate realistic logical sequence helper
  /**
 * Automatically synthesizes sequential Finish-to-Start (FS) links connecting unlinked activities.
 */
function autoGenerateLogicalSequence() {
    const activities = project.activities || [];
    if (activities.length < 2) {
      alert("At least 2 activities are required.");
      return;
    }

    if (project.dependencies && project.dependencies.length > 0) {
      if (!confirm("This will link all activities in continuous sequential order. Proceed?")) {
        return;
      }
    }

    const newDeps = [];
    for (let i = 0; i < activities.length - 1; i++) {
      newDeps.push({
        dependency_id: `DEP-${String(i + 1).padStart(3, "0")}`,
        from_activity_id: activities[i].activity_id,
        to_activity_id: activities[i + 1].activity_id,
        type: "FS",
        lag_days: 0,
        description: `Sequential handoff from ${activities[i].activity_id} to ${activities[i+1].activity_id}`
      });
    }

    project.dependencies = newDeps;
    hasUnsavedDependencies = true;
    renderSequenceView();

    seqSaveStatus.textContent = "Unsaved Changes";
    seqSaveStatus.className = "badge badge-amber";
    seqSaveStatus.style.display = "inline-block";
  }

  // Delete single dependency
  window.deleteSequenceDependency = function(index) {
    if (!project.dependencies || !project.dependencies[index]) return;
    const dep = project.dependencies[index];
    if (confirm(`Delete dependency ${dep.from_activity_id || dep.from} ➔ ${dep.to_activity_id || dep.to}?`)) {
      project.dependencies.splice(index, 1);
      hasUnsavedDependencies = true;
      renderSequenceView();
      seqSaveStatus.textContent = "Unsaved Changes";
      seqSaveStatus.className = "badge badge-amber";
      seqSaveStatus.style.display = "inline-block";
    }
  };

  // Edit single dependency
  window.editSequenceDependency = function(index) {
    openAddDependencyModal(index);
  };

  // Main Render Sequence View
  /**
 * Main render dispatcher for Section 3 (Sequence Activities / Precedence Diagramming).
 */
function renderSequenceView() {
    const activities = project.activities || [];
    const dependencies = project.dependencies || [];

    // Update dependencies count badge
    if (seqDepsBadgeCount) {
      seqDepsBadgeCount.textContent = dependencies.length;
    }

    // 1. Evaluate schedule health on client
    const health = evaluateScheduleHealthClient(activities, dependencies);
    renderScheduleHealthUI(health);

    // 2. Render vis-network interactive diagram
    networkInstance = renderNetworkDiagram(pdmCanvas, activities, dependencies, health);

    // 3. Render Dependencies Table
    if (dependencies.length > 0) {
      const actMap = {};
      activities.forEach(a => { actMap[a.activity_id] = a.name; });

      let tableHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 10px;">
          <h4 style="margin: 0; font-size: 1.05rem; color: var(--charcoal);">
            Activity Dependencies (${dependencies.length})
          </h4>
          <button type="button" id="btn-re-sequence-logic" class="btn btn-outline-primary btn-sm" style="font-weight: 600;">
            ⚡ Auto-Sequence All Activities
          </button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width: 30%;">Predecessor (From)</th>
                <th style="width: 15%;">Type</th>
                <th style="width: 30%;">Successor (To)</th>
                <th style="width: 10%;">Lag</th>
                <th style="width: 15%; text-align: center;">Actions</th>
              </tr>
            </thead>
            <tbody>
      `;

      dependencies.forEach((d, idx) => {
        const fromId = d.from_activity_id || d.from || "—";
        const toId = d.to_activity_id || d.to || "—";
        const fromName = actMap[fromId] || "";
        const toName = actMap[toId] || "";

        let rawType = d.type || "FS";
        if (rawType.includes("(") && rawType.includes(")")) {
          rawType = rawType.split("(")[1].replace(")", "").trim();
        }

        const lag = parseFloat(d.lag_days || 0);

        let typeBadge = `<span class="badge badge-blue">FS</span>`;
        if (rawType === "SS") {
          typeBadge = `<span class="badge" style="background:#EDE9FE; color:#6D28D9; border: 1px solid #DDD6FE;">SS</span>`;
        } else if (rawType === "FF") {
          typeBadge = `<span class="badge" style="background:#CFFAFE; color:#0E7490; border: 1px solid #A5F3FC;">FF</span>`;
        } else if (rawType === "SF") {
          typeBadge = `<span class="badge" style="background:#FEF2F2; color:#DC2626; border: 1px solid #FECACA;">SF</span>`;
        }

        tableHtml += `
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--charcoal); font-size: 0.88rem;">${fromId}</div>
              <div style="font-size: 0.8rem; color: var(--slate);">${fromName}</div>
            </td>
            <td>${typeBadge}</td>
            <td>
              <div style="font-weight: 700; color: var(--charcoal); font-size: 0.88rem;">${toId}</div>
              <div style="font-size: 0.8rem; color: var(--slate);">${toName}</div>
            </td>
            <td style="font-weight: 600; color: var(--slate);">${lag > 0 ? `+${lag}d` : '0d'}</td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 6px; justify-content: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="editSequenceDependency(${idx})" title="Edit">
                  ✏️
                </button>
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteSequenceDependency(${idx})" title="Delete">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      });

      tableHtml += `</tbody></table></div>`;
      pdmDependencies.innerHTML = tableHtml;

      const btnReSeq = document.getElementById("btn-re-sequence-logic");
      if (btnReSeq) {
        btnReSeq.addEventListener("click", autoGenerateLogicalSequence);
      }
    } else {
      pdmDependencies.innerHTML = `
        <div style="background: #FFFFFF; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 2.5rem; text-align: center;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔗</div>
          <h4 style="margin: 0; color: var(--charcoal);">No Precedence Dependencies Yet</h4>
          <p style="font-size: 0.88rem; color: var(--slate); max-width: 450px; margin: 0.4rem auto 1.2rem auto;">
            Connect tasks to establish a logical workflow across the project.
          </p>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary" onclick="document.getElementById('btn-open-add-dependency').click()">
              ➕ Add First Dependency
            </button>
            <button type="button" id="btn-seed-standard-dependencies" class="btn btn-outline-primary">
              ⚡ Auto-Sequence All Activities
            </button>
          </div>
        </div>
      `;

      const btnSeed = document.getElementById("btn-seed-standard-dependencies");
      if (btnSeed) {
        btnSeed.addEventListener("click", autoGenerateLogicalSequence);
      }
    }

    // Restore active tab
    switchSeqTab(activeSeqTab);
  }

  
  // VIEW 4: ESTIMATE ACTIVITY DURATION (PERT BETA DISTRIBUTION & SIMULATOR)
  
  let hasUnsavedEstimates = false;
  let activePertAnalysis = null;
  let currentTargetD = null;

  // View 4 DOM Elements
  const estimateSaveStatus = document.getElementById("estimate-save-status");
  const estimateAlertMsg = document.getElementById("estimate-alert-msg");
  const btnSeedPertDefaults = document.getElementById("btn-seed-pert-defaults");
  const btnSaveDurationEstimates = document.getElementById("btn-save-duration-estimates");

  // Executive Top Banner Simulator Elements
  const pertMuDisplay = document.getElementById("pert-mu-display");
  const pertSigmaDisplay = document.getElementById("pert-sigma-display");
  const pertCpCount = document.getElementById("pert-cp-count");
  const pertVarDisplay = document.getElementById("pert-var-display");
  const pertProbBadge = document.getElementById("pert-prob-badge");
  const pertZBadge = document.getElementById("pert-z-badge");
  const pertTargetSlider = document.getElementById("pert-target-slider");
  const pertTargetInput = document.getElementById("pert-target-input");
  const pertNarrativeInsight = document.getElementById("pert-narrative-insight");

  // Presets
  const presetP50Val = document.getElementById("preset-p50-val");
  const presetP80Val = document.getElementById("preset-p80-val");
  const presetP90Val = document.getElementById("preset-p90-val");
  const presetP95Val = document.getElementById("preset-p95-val");
  const presetP99Val = document.getElementById("preset-p99-val");
  const presetButtons = document.querySelectorAll(".btn-pert-preset");

  // Filter Elements
  const estimateSearchInput = document.getElementById("estimate-search-input");
  const estimateWpFilter = document.getElementById("estimate-wp-filter");
  const estimateTechFilter = document.getElementById("estimate-tech-filter");
  const estimateCpOnlyFilter = document.getElementById("estimate-cp-only-filter");
  const estimateTableContainer = document.getElementById("estimate-table-container");

  // Analogous Modal Elements & State
  const analogousModal = document.getElementById("analogous-modal");
  const btnCloseAnalogousModal = document.getElementById("btn-close-analogous-modal");
  const btnCancelAnalogousModal = document.getElementById("btn-cancel-analogous-modal");
  const analogousActivitiesList = document.getElementById("analogous-activities-list");
  const analogousLoadingSpinner = document.getElementById("analogous-loading-spinner");
  let currentAnalogousTargetAid = null;
  let completedActivitiesCache = null;

  /**
 * Opens modal to search and select historical completed activities for analogous duration benchmarking.
 */
async function openAnalogousPicker(aid) {
    currentAnalogousTargetAid = aid;
    if (analogousModal) analogousModal.style.display = "flex";
    if (analogousLoadingSpinner) analogousLoadingSpinner.style.display = "block";
    if (analogousActivitiesList) {
      analogousActivitiesList.style.display = "none";
      analogousActivitiesList.innerHTML = "";
    }

    try {
      if (!completedActivitiesCache) {
        const res = await fetchCompletedActivities();
        if (res.error) throw new Error(res.error);
        completedActivitiesCache = res.data || [];
      }

      if (analogousLoadingSpinner) analogousLoadingSpinner.style.display = "none";
      if (analogousActivitiesList) analogousActivitiesList.style.display = "block";

      if (!completedActivitiesCache || completedActivitiesCache.length === 0) {
        analogousActivitiesList.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; color: var(--slate);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">📜</div>
            <p style="font-weight: 700; margin: 0; color: var(--charcoal);">No Verified Completed Activities Available</p>
            <p style="font-size: 0.85rem; color: var(--muted); margin-top: 4px;">
              Only past activities formally reviewed, verified, and signed off by a Project Controller qualify for analogous benchmarking.
            </p>
          </div>
        `;
        return;
      }

      const byProject = {};
      completedActivitiesCache.forEach(item => {
        const pName = item.project_name || "Historical Project";
        if (!byProject[pName]) byProject[pName] = [];
        byProject[pName].push(item);
      });

      const targetAct = (project.activities || []).find(a => a.activity_id === aid);
      const currentBenchmarkId = targetAct ? targetAct.analogous_activity_id : null;

      let listHtml = "";
      for (const [projName, acts] of Object.entries(byProject)) {
        listHtml += `
          <div style="margin-bottom: 1.5rem; background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="background: #F1F5F9; padding: 10px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 700; color: var(--charcoal); font-size: 0.92rem;">
                📁 ${projName}
              </span>
              <span class="badge badge-emerald" style="font-size: 0.72rem; padding: 3px 8px;">
                ✓ Completed & Certified
              </span>
            </div>
            <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        `;

        acts.forEach(act => {
          const actDur = act.actual_duration_days || 0;
          const reviewDate = act.reviewed_at ? act.reviewed_at.split('T')[0] : (act.actual_end_date || '—');
          const isSelected = currentBenchmarkId && act.activity_id === currentBenchmarkId;

          listHtml += `
            <div style="border: 1px solid ${isSelected ? '#3B82F6' : 'var(--border-light)'}; background: ${isSelected ? '#EFF6FF' : '#FAFAFA'}; border-radius: 6px; padding: 12px; display: flex; justify-content: space-between; align-items: flex-start; gap: 14px;">
              <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <strong style="color: var(--charcoal); font-size: 0.9rem;">${act.activity_name}</strong>
                  <span class="badge badge-secondary" style="font-size: 0.7rem; font-family: monospace;">${act.activity_id}</span>
                </div>
                <div style="font-size: 0.8rem; color: var(--slate); margin-bottom: 6px; line-height: 1.35;">
                  ${act.description || ''}
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.75rem; color: var(--muted); align-items: center;">
                  <span>📅 Dates: <strong>${act.actual_start_date || '—'}</strong> ➔ <strong>${act.actual_end_date || '—'}</strong></span>
                  <span>⏱️ Actual Duration: <strong style="color: #0F172A; font-size: 0.85rem;">${actDur} days</strong></span>
                </div>
                <div style="margin-top: 6px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; color: #15803D;">
                  🛡️ <strong>Controller Review:</strong> Approved by <strong>${act.controller_name || 'Sarah Williams'}</strong> on ${reviewDate}
                  ${act.sign_off_notes ? `<div style="font-style: italic; color: #166534; margin-top: 2px;">"${act.sign_off_notes}"</div>` : ''}
                </div>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 140px;">
                <div style="font-size: 1.25rem; font-weight: 800; color: #1E293B; font-family: monospace;">
                  ${actDur} <span style="font-size: 0.75rem; color: var(--muted); font-weight: 600;">days</span>
                </div>
                <button type="button" class="btn btn-sm ${isSelected ? 'btn-outline-primary' : 'btn-primary'} btn-pick-analogous" data-act-id="${act.activity_id}">
                  ${isSelected ? '✓ Current' : '🎯 Select'}
                </button>
              </div>
            </div>
          `;
        });

        listHtml += `
            </div>
          </div>
        `;
      }

      analogousActivitiesList.innerHTML = listHtml;

      analogousActivitiesList.querySelectorAll(".btn-pick-analogous").forEach(btn => {
        btn.addEventListener("click", () => {
          const pastActId = btn.getAttribute("data-act-id");
          const selectedBenchmark = completedActivitiesCache.find(x => x.activity_id === pastActId);
          if (selectedBenchmark && currentAnalogousTargetAid) {
            applyAnalogousBenchmark(currentAnalogousTargetAid, selectedBenchmark);
          }
        });
      });

    } catch (err) {
      if (analogousLoadingSpinner) analogousLoadingSpinner.style.display = "none";
      if (analogousActivitiesList) {
        analogousActivitiesList.style.display = "block";
        analogousActivitiesList.innerHTML = `
          <div class="alert alert-danger" style="margin: 1rem 0;">
            Failed to load completed activities: ${err.message}
          </div>
        `;
      }
    }
  }

  /**
 * Closes historical analogous benchmark picker modal.
 */
function closeAnalogousModal() {
    if (analogousModal) analogousModal.style.display = "none";
    currentAnalogousTargetAid = null;
  }

  /**
 * Calculates Te and variance for an activity based on chosen estimation technique.
 */
function applyActivityDurationCalc(act, tech, { a, m, b, rate, qty, dur } = {}) {
    act.estimation_technique = tech;
    let te = 0, sigma = 0;
    if (tech === "three_point") {
      act.optimistic = a; act.most_likely = m; act.pessimistic = b;
      te = round((a + 4 * m + b) / 6, 2);
      sigma = round((b - a) / 6, 3);
    } else if (tech === "parametric") {
      act.parametric_rate = rate; act.parametric_quantity = qty;
      te = round(rate * qty, 2);
      sigma = round(te * 0.1, 3);
    } else if (tech === "analogous") {
      te = dur || act.duration || 75.0;
      sigma = round(te * 0.15, 3);
    } else {
      te = m !== undefined ? m : (dur !== undefined ? dur : (act.duration || 35.0));
      sigma = 0;
    }
    act.duration = act.expected_time = te;
    act.std_dev = sigma;
    act.variance = round(sigma * sigma, 4);
  }

  /**
 * Applies historical benchmark duration and metadata to an activity.
 */
function applyAnalogousBenchmark(aid, benchmark) {
    const act = (project.activities || []).find(a => a.activity_id === aid);
    if (!act) return;

    const actualDays = parseFloat(benchmark.actual_duration_days || 75.0);
    applyActivityDurationCalc(act, "analogous", { dur: actualDays });
    act.most_likely = actualDays;
    act.optimistic = round(actualDays * 0.65, 1);
    act.pessimistic = round(actualDays * 1.55, 1);
    Object.assign(act, {
      analogous_project_id: benchmark.project_id,
      analogous_project_name: benchmark.project_name,
      analogous_activity_id: benchmark.activity_id,
      analogous_activity_name: benchmark.activity_name,
      analogous_actual_duration: actualDays,
      analogous_controller_name: benchmark.controller_name,
      analogous_approval_date: benchmark.reviewed_at ? benchmark.reviewed_at.split('T')[0] : (benchmark.actual_end_date || ''),
      analogous_source: `${benchmark.project_name}: ${benchmark.activity_name}`
    });

    hasUnsavedEstimates = true;
    estimateSaveStatus.textContent = "Unsaved Changes";
    estimateSaveStatus.className = "badge badge-amber";
    estimateSaveStatus.style.display = "inline-block";

    closeAnalogousModal();
    renderEstimateTable();
    updatePertSimulator();
  }

  if (btnCloseAnalogousModal) btnCloseAnalogousModal.addEventListener("click", closeAnalogousModal);
  if (btnCancelAnalogousModal) btnCancelAnalogousModal.addEventListener("click", closeAnalogousModal);
  if (analogousModal) {
    analogousModal.addEventListener("click", (e) => {
      if (e.target === analogousModal) closeAnalogousModal();
    });
  }

  // Error Function erf(x) using Abramowitz & Stegun 7.1.26
  /**
 * Numerical approximation of Gauss error function for PERT probability calculation.
 */
function erf(x) {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return sign * y;
  }

  // Standard Normal Cumulative Distribution Function
  /**
 * Evaluates standard normal cumulative distribution function for Z-score.
 */
function normalCdf(z) {
    return 0.5 * (1.0 + erf(z / Math.SQRT2));
  }

  // High-Speed Client CPM and PERT Beta Path Computation
  /**
 * Client-side CPM/PERT schedule engine computing ES, EF, LS, LF, and critical path.
 */
function computePertScheduleClient(activities, dependencies) {
    const actMap = {};
    (activities || []).forEach(a => {
      if (a.activity_id) actMap[a.activity_id] = a;
    });
    const actIds = Object.keys(actMap);
    if (actIds.length === 0) {
      return {
        criticalPathIds: [],
        mu: 0,
        varPath: 0,
        stdPath: 0,
        confidenceLevels: { 50: 0, 80: 0, 90: 0, 95: 0, 99: 0 },
        schedule: {}
      };
    }

    const preds = {};
    const succs = {};
    actIds.forEach(id => { preds[id] = []; succs[id] = []; });

    (dependencies || []).forEach(dep => {
      const u = (dep.from_activity_id || dep.from || "").trim();
      const v = (dep.to_activity_id || dep.to || "").trim();
      let rawType = (dep.type || "FS").trim().toUpperCase();
      if (rawType.includes("(") && rawType.includes(")")) {
        rawType = rawType.split("(")[1].replace(")", "").trim();
      }
      const lag = parseFloat(dep.lag_days || 0.0);

      if (actMap[u] && actMap[v] && u !== v) {
        succs[u].push({ to: v, type: rawType, lag });
        preds[v].push({ from: u, type: rawType, lag });
      }
    });

    // Topological Sort
    const inDegree = {};
    actIds.forEach(id => { inDegree[id] = preds[id].length; });
    const queue = actIds.filter(id => inDegree[id] === 0);
    const topOrder = [];

    while (queue.length > 0) {
      const curr = queue.shift();
      topOrder.push(curr);
      succs[curr].forEach(edge => {
        inDegree[edge.to]--;
        if (inDegree[edge.to] === 0) {
          queue.push(edge.to);
        }
      });
    }

    actIds.forEach(id => {
      if (!topOrder.includes(id)) topOrder.push(id);
    });

    // Forward Pass
    const es = {}, ef = {};
    actIds.forEach(id => { es[id] = ef[id] = 0.0; });

    topOrder.forEach(u => {
      const d_u = parseFloat(actMap[u].duration || actMap[u].expected_time || 5.0);
      let maxEs = 0.0;
      preds[u].forEach(({ from: p, type: rel, lag }) => {
        const cand = rel === "SS" ? es[p] + lag
                   : rel === "FF" ? ef[p] + lag - d_u
                   : rel === "SF" ? es[p] + lag - d_u
                   : ef[p] + lag;
        if (cand > maxEs) maxEs = cand;
      });
      es[u] = Math.max(0.0, maxEs);
      ef[u] = es[u] + d_u;
    });

    const projectFinish = Math.max(0.0, ...actIds.map(id => ef[id] || 0));

    // Backward Pass
    const lf = {}, ls = {};
    actIds.forEach(id => { lf[id] = projectFinish; ls[id] = 0.0; });

    [...topOrder].reverse().forEach(u => {
      const d_u = parseFloat(actMap[u].duration || actMap[u].expected_time || 5.0);
      let minLf = succs[u].length > 0 ? Infinity : projectFinish;
      succs[u].forEach(({ to: s, type: rel, lag }) => {
        const cand = rel === "SS" ? ls[s] - lag + d_u
                   : rel === "FF" ? lf[s] - lag
                   : rel === "SF" ? lf[s] - lag + d_u
                   : ls[s] - lag;
        if (cand < minLf) minLf = cand;
      });
      lf[u] = Math.min(projectFinish, minLf);
      ls[u] = lf[u] - d_u;
    });

    // Float & Critical Path Identification
    const tf = {};
    let minFloat = Infinity;
    actIds.forEach(id => {
      const f = parseFloat((lf[id] - ef[id]).toFixed(2));
      tf[id] = f;
      if (f < minFloat) minFloat = f;
    });

    const criticalPathIds = actIds.filter(id => Math.abs(tf[id] - minFloat) <= 0.05);
    let mu = 0.0, varPath = 0.0;
    criticalPathIds.forEach(cid => {
      mu += parseFloat(actMap[cid].duration || actMap[cid].expected_time || 5.0);
      varPath += parseFloat(actMap[cid].variance || 0.0);
    });
    const stdPath = varPath > 0 ? Math.sqrt(varPath) : 0.0;

    const schedule = {};
    actIds.forEach(id => {
      schedule[id] = {
        es: parseFloat(es[id].toFixed(1)), ef: parseFloat(ef[id].toFixed(1)),
        ls: parseFloat(ls[id].toFixed(1)), lf: parseFloat(lf[id].toFixed(1)),
        float: tf[id], isCritical: criticalPathIds.includes(id)
      };
    });

    return {
      criticalPathIds,
      mu: parseFloat(mu.toFixed(2)),
      varPath: parseFloat(varPath.toFixed(3)),
      stdPath: parseFloat(stdPath.toFixed(2)),
      confidenceLevels: {
        50: parseFloat(mu.toFixed(1)),
        80: parseFloat((mu + 0.8416 * stdPath).toFixed(1)),
        90: parseFloat((mu + 1.2816 * stdPath).toFixed(1)),
        95: parseFloat((mu + 1.6449 * stdPath).toFixed(1)),
        99: parseFloat((mu + 2.3263 * stdPath).toFixed(1))
      },
      schedule
    };
  }

  let activePertPreset = null;

  /**
 * Sets active confidence level preset (50%, 80%, 90%, 95%, 99%) in PERT simulator.
 */
function setActivePertPreset(probOrNull) {
    activePertPreset = probOrNull;
    presetButtons.forEach(btn => {
      const p = parseInt(btn.getAttribute("data-prob"), 10);
      const isAct = probOrNull !== null && p === probOrNull;
      btn.classList.toggle("active", isAct);
      btn.style.background = isAct ? "rgba(56, 189, 248, 0.25)" : "rgba(255, 255, 255, 0.1)";
      btn.style.color = isAct ? "#38BDF8" : "#FFFFFF";
      btn.style.borderColor = isAct ? "rgba(56, 189, 248, 0.5)" : "rgba(255, 255, 255, 0.2)";
      btn.style.fontWeight = isAct ? "700" : "normal";
    });
  }

  // Update Top Banner PERT Simulator
  /**
 * Simulates completion probability for target project duration using Beta distribution parameters.
 */
function updatePertSimulator(targetD, explicitProb = undefined) {
    if (!activePertAnalysis) return;
    const { mu, stdPath, varPath, criticalPathIds, confidenceLevels } = activePertAnalysis;

    if (targetD === undefined || targetD === null) {
      targetD = (activePertPreset !== null && confidenceLevels?.[activePertPreset] !== undefined)
        ? confidenceLevels[activePertPreset] : (currentTargetD !== null ? currentTargetD : mu);
    }
    currentTargetD = targetD;

    pertMuDisplay.textContent = `${mu.toFixed(1)} d`;
    pertSigmaDisplay.textContent = `± ${stdPath.toFixed(1)} d (σ)`;
    pertCpCount.textContent = `${criticalPathIds.length} / ${(project.activities || []).length}`;
    pertVarDisplay.textContent = `${varPath.toFixed(1)} d²`;

    const presetMap = { 50: presetP50Val, 80: presetP80Val, 90: presetP90Val, 95: presetP95Val, 99: presetP99Val };
    Object.entries(presetMap).forEach(([p, el]) => {
      if (el && confidenceLevels[p] !== undefined) el.textContent = `${confidenceLevels[p].toFixed(1)}d`;
    });

    if (explicitProb !== undefined) {
      setActivePertPreset(explicitProb);
    } else {
      const matched = [50, 80, 90, 95, 99].find(p => confidenceLevels?.[p] !== undefined && Math.abs(confidenceLevels[p] - targetD) < 0.15);
      setActivePertPreset(matched ?? null);
    }

    const z = stdPath > 0 ? (targetD - mu) / stdPath : 0.0;
    const prob = stdPath > 0 ? normalCdf(z) : (targetD >= mu ? 1.0 : 0.0);
    const probPct = (prob * 100).toFixed(1);

    pertProbBadge.textContent = `${probPct}%`;
    pertProbBadge.style.color = prob >= 0.90 ? "#4ADE80" : prob >= 0.75 ? "#38BDF8" : prob >= 0.50 ? "#FBBF24" : "#F87171";

    const sign = z >= 0 ? "+" : "";
    pertZBadge.textContent = `Z = ${sign}${z.toFixed(2)} (${targetD >= mu ? 'Buffer' : 'Tight'})`;
    pertTargetSlider.value = pertTargetInput.value = targetD;

    const riskAdvisory = prob >= 0.95 ? "High assurance client-ready commitment with robust risk mitigation buffer."
      : prob >= 0.80 ? "Balanced management buffer in line with standard industry practices."
      : prob >= 0.50 ? "Even-odds estimation (50% likelihood of overrunning deadline)."
      : "Aggressive high-risk schedule with significant likelihood of delay.";

    pertNarrativeInsight.innerHTML = `
      With target <strong>D = ${targetD.toFixed(1)} days</strong> (${sign}${z.toFixed(2)} standard deviations from expected μ = ${mu.toFixed(1)}d),
      there is a <strong>${probPct}% probability</strong> of completing critical path deliverables on or before this deadline. <em>${riskAdvisory}</em>
    `;
  }

  // Render Smart Estimation Table
  /**
 * Renders interactive Three-Point, Parametric, and Analogous duration estimation matrix.
 */
function renderEstimateTable() {
    const activities = project.activities || [];
    const dependencies = project.dependencies || [];
    const wpMap = getWorkPackageMap(project);

    // Recompute CPM
    activePertAnalysis = computePertScheduleClient(activities, dependencies);

    // Populate WP Filter options if not populated
    if (estimateWpFilter && estimateWpFilter.options.length <= 1) {
      const distinctWps = new Set();
      activities.forEach(a => { if (a.work_package_id) distinctWps.add(a.work_package_id); });
      Array.from(distinctWps).sort().forEach(wpId => {
        const opt = document.createElement("option");
        opt.value = wpId;
        opt.textContent = `${wpId}: ${wpMap[wpId] || 'Work Package'}`;
        estimateWpFilter.appendChild(opt);
      });
    }

    const searchQuery = (estimateSearchInput ? estimateSearchInput.value : "").trim().toLowerCase();
    const wpFilterVal = estimateWpFilter ? estimateWpFilter.value : "";
    const techFilterVal = estimateTechFilter ? estimateTechFilter.value : "";
    const cpOnly = estimateCpOnlyFilter ? estimateCpOnlyFilter.checked : false;

    // Filter activities
    const filtered = activities.filter(a => {
      if (searchQuery) {
        const text = `${a.activity_id} ${a.name} ${a.description || ''}`.toLowerCase();
        if (!text.includes(searchQuery)) return false;
      }
      if (wpFilterVal && a.work_package_id !== wpFilterVal) return false;
      const tech = (a.estimation_technique || "three_point").toLowerCase();
      if (techFilterVal && tech !== techFilterVal) return false;
      const isCrit = activePertAnalysis.criticalPathIds.includes(a.activity_id);
      if (cpOnly && !isCrit) return false;
      return true;
    });

    if (filtered.length === 0) {
      estimateTableContainer.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: var(--slate);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
          <p style="margin: 0; font-weight: 600;">No activities match the active filter criteria.</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th style="width: 28%;">Activity & Path Status</th>
              <th style="width: 14%;">Technique</th>
              <th style="width: 32%;">Estimation Inputs (a, m, b / Rate × Qty)</th>
              <th style="width: 13%; text-align: right;">Expected (te)</th>
              <th style="width: 13%; text-align: center;">Uncertainty (σ)</th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach(act => {
      const aid = act.activity_id;
      const isMilestone = Boolean(act.is_milestone);
      const isCrit = activePertAnalysis.criticalPathIds.includes(aid);
      const sched = activePertAnalysis.schedule[aid] || { float: 0 };
      const wpName = wpMap[act.work_package_id] || act.work_package_id || "Work Package";
      const tech = (act.estimation_technique || "three_point").toLowerCase();

      const a = act.optimistic !== undefined ? act.optimistic : 3.0;
      const m = act.most_likely !== undefined ? act.most_likely : 5.0;
      const b = act.pessimistic !== undefined ? act.pessimistic : 9.0;
      const te = isMilestone ? 0.0 : (act.duration !== undefined ? act.duration : round((a + 4*m + b)/6, 2));
      const sigma = isMilestone ? 0.0 : (act.std_dev !== undefined ? act.std_dev : round((b - a)/6, 2));
      const varVal = isMilestone ? 0.0 : (act.variance !== undefined ? act.variance : round(sigma*sigma, 3));

      const pathBadge = isCrit
        ? `<span class="badge badge-rose" style="font-size: 0.72rem; padding: 2px 7px;">🔥 Critical Path (Float: 0d)</span>`
        : `<span class="badge badge-secondary" style="font-size: 0.72rem; padding: 2px 7px;">⚪ Float: ${sched.float}d</span>`;

      // Inputs based on technique
      let inputsHtml = "";
      if (isMilestone) {
        inputsHtml = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge badge-indigo" style="font-size: 0.78rem; padding: 4px 10px;">🎯 Milestone Gate (Fixed Duration: 0.00 d)</span>
          </div>
        `;
      } else if (tech === "three_point") {
        const isInvalid = !(a > 0 && a < m && m < b);
        let errDesc = "";
        if (a <= 0) errDesc = "Opt (a) must be > 0";
        else if (a >= m && m >= b) errDesc = "Opt (a) < Likely (m) < Pess (b) violated";
        else if (a >= m) errDesc = `Opt (a=${a}) ≥ Likely (m=${m})`;
        else if (m >= b) errDesc = `Likely (m=${m}) ≥ Pess (b=${b})`;

        inputsHtml = `
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <div style="display: flex; flex-direction: column;">
                <span style="font-size: 0.68rem; color: #15803D; font-weight: 700;">Opt (a)</span>
                <input type="number" step="0.5" min="0.1" value="${a}" class="form-control pert-input-a" data-id="${aid}" style="width: 70px; padding: 3px 6px; font-size: 0.82rem; text-align: center; ${isInvalid && (a <= 0 || a >= m) ? 'border-color: #EF4444; background: #FEF2F2;' : ''}" title="Optimistic Duration">
              </div>
              <div style="display: flex; flex-direction: column;">
                <span style="font-size: 0.68rem; color: #1D4ED8; font-weight: 700;">Likely (m)</span>
                <input type="number" step="0.5" min="0.1" value="${m}" class="form-control pert-input-m" data-id="${aid}" style="width: 70px; padding: 3px 6px; font-size: 0.82rem; text-align: center; font-weight: 700; ${isInvalid && (m <= a || m >= b) ? 'border-color: #EF4444; background: #FEF2F2;' : ''}" title="Most Likely Duration">
              </div>
              <div style="display: flex; flex-direction: column;">
                <span style="font-size: 0.68rem; color: #B91C1C; font-weight: 700;">Pess (b)</span>
                <input type="number" step="0.5" min="0.1" value="${b}" class="form-control pert-input-b" data-id="${aid}" style="width: 70px; padding: 3px 6px; font-size: 0.82rem; text-align: center; ${isInvalid && (b <= m) ? 'border-color: #EF4444; background: #FEF2F2;' : ''}" title="Pessimistic Duration">
              </div>
            </div>
            <div class="pert-err-msg-${aid}" style="font-size: 0.72rem; color: #DC2626; font-weight: 700; display: ${isInvalid ? 'block' : 'none'};">
              ⚠️ Violation: Strict ordering required: Opt (a) &lt; Likely (m) &lt; Pess (b) ${errDesc ? `(${errDesc})` : ''}
            </div>
          </div>
        `;
      } else if (tech === "parametric") {
        const rate = act.parametric_rate !== undefined && act.parametric_rate !== null ? act.parametric_rate : 1.0;
        const qty = act.parametric_quantity !== undefined && act.parametric_quantity !== null ? act.parametric_quantity : m;
        inputsHtml = `
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.68rem; color: var(--slate); font-weight: 700;">Rate (d/unit)</span>
              <input type="number" step="0.05" min="0.01" value="${rate}" class="form-control pert-input-prate" data-id="${aid}" style="width: 80px; padding: 3px 6px; font-size: 0.82rem; text-align: center;">
            </div>
            <span style="margin-top: 14px; font-weight: 700; color: var(--slate);">×</span>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.68rem; color: var(--slate); font-weight: 700;">Units Qty</span>
              <input type="number" step="1" min="1" value="${qty}" class="form-control pert-input-pqty" data-id="${aid}" style="width: 80px; padding: 3px 6px; font-size: 0.82rem; text-align: center;">
            </div>
          </div>
        `;
      } else if (tech === "analogous") {
        if (act.analogous_activity_id && act.analogous_actual_duration) {
          inputsHtml = `
            <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 6px 10px; font-size: 0.78rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-weight: 700; color: #166534; font-size: 0.78rem;">📁 ${act.analogous_project_name || 'Historical Project'}</span>
                <button type="button" class="btn btn-sm btn-outline-primary btn-open-analogous-picker" data-id="${aid}" style="padding: 1px 7px; font-size: 0.72rem; line-height: 1.2;">
                  🔄 Change
                </button>
              </div>
              <div style="font-weight: 600; color: #14532D; margin-bottom: 2px;">
                ${act.analogous_activity_name} <span style="font-family: monospace; font-size: 0.72rem; color: #166534;">(${act.analogous_activity_id})</span>
              </div>
              <div style="color: #15803D; font-size: 0.72rem;">
                🛡️ Verified: <strong>${act.analogous_controller_name || 'Sarah Williams'}</strong> on ${act.analogous_approval_date || '—'}
              </div>
            </div>
          `;
        } else {
          inputsHtml = `
            <div style="display: flex; align-items: center;">
              <button type="button" class="btn btn-sm btn-outline-primary btn-open-analogous-picker" data-id="${aid}" style="padding: 6px 12px; font-size: 0.8rem; font-weight: 600; border-style: dashed; width: 100%;">
                📜 Select Completed Activity (Controller-Approved)...
              </button>
            </div>
          `;
        }
      } else {
        // Single-Point
        inputsHtml = `
          <div style="display: flex; gap: 6px; align-items: center;">
            <div style="display: flex; flex-direction: column; width: 90px;">
              <span style="font-size: 0.68rem; color: var(--slate); font-weight: 700;">Single Duration</span>
              <input type="number" step="0.5" min="0.5" value="${m}" class="form-control pert-input-m" data-id="${aid}" style="padding: 3px 6px; font-size: 0.82rem; text-align: center; font-weight: 700;">
            </div>
          </div>
        `;
      }

      // Uncertainty color
      let sigmaBadgeColor = "#16A34A"; // Low
      if (sigma > 2.5) sigmaBadgeColor = "#DC2626"; // High
      else if (sigma > 1.2) sigmaBadgeColor = "#D97706"; // Medium

      html += renderEstimateRowHtml({ aid, act, wpName, tech, inputsHtml, te, sigma, varVal, isCrit, pathBadge, sigmaBadgeColor });
    });

    html += `</tbody></table></div>`;
    estimateTableContainer.innerHTML = html;

    // Attach row events
    bindEstimateTableEvents();
  }

  // Row Event Listeners
  /**
 * Binds live input recalculation listeners across duration estimation fields.
 */
function bindEstimateTableEvents() {
    const activities = project.activities || [];

    // Technique Selector change
    estimateTableContainer.querySelectorAll(".pert-select-tech").forEach(sel => {
      sel.addEventListener("change", () => {
        const aid = sel.getAttribute("data-id");
        const act = activities.find(a => a.activity_id === aid);
        if (act) {
          act.estimation_technique = sel.value;
          hasUnsavedEstimates = true;
          estimateSaveStatus.textContent = "Unsaved Changes";
          estimateSaveStatus.className = "badge badge-amber";
          estimateSaveStatus.style.display = "inline-block";
          if (sel.value === "analogous" && !act.analogous_activity_id) {
            renderEstimateTable();
            updatePertSimulator();
            openAnalogousPicker(aid);
            return;
          }
          renderEstimateTable();
          updatePertSimulator();
        }
      });
    });

    // Analogous Benchmark Pickers
    estimateTableContainer.querySelectorAll(".btn-open-analogous-picker").forEach(btn => {
      btn.addEventListener("click", () => {
        const aid = btn.getAttribute("data-id");
        if (aid) openAnalogousPicker(aid);
      });
    });

    // Helper to carefully parse numeric input with both dot and comma support
    const parsePertNum = (str, fallback) => {
      if (str === null || str === undefined) return fallback;
      const s = String(str).replace(",", ".").trim();
      if (s === "") return fallback;
      const n = parseFloat(s);
      return isNaN(n) ? fallback : n;
    };

    // Helper to recalculate a single row
    /**
 * Recalculates expected duration and risk standard deviation for a modified table row.
 */
function updateRowValues(aid) {
      const act = (project.activities || []).find(a => a.activity_id === aid);
      const row = estimateTableContainer.querySelector(`tr[data-row-id="${aid}"]`);
      if (!act || !row) return;

      if (act.is_milestone) {
        row.classList.remove("row-invalid-estimate");
        delete act.has_validation_error;
        return;
      }

      const tech = (act.estimation_technique || "three_point").toLowerCase();
      const inA = row.querySelector(".pert-input-a"), inM = row.querySelector(".pert-input-m"), inB = row.querySelector(".pert-input-b");
      const inRate = row.querySelector(".pert-input-prate"), inQty = row.querySelector(".pert-input-pqty");

      const a = inA ? parsePertNum(inA.value, act.optimistic || 1.0) : (act.optimistic || 1.0);
      const m = inM ? parsePertNum(inM.value, act.most_likely || 2.0) : (act.most_likely || 2.0);
      const b = inB ? parsePertNum(inB.value, act.pessimistic || 3.0) : (act.pessimistic || 3.0);

      // Strict Ordering Check: Opt (a) < Likely (m) < Pess (b)
      if (tech === "three_point") {
        const errDiv = row.querySelector(`.pert-err-msg-${aid}`);
        const isValid = (a > 0 && a < m && m < b);

        if (!isValid) {
          row.classList.add("row-invalid-estimate");
          const setInpErr = (inp, cond) => { if (inp) { inp.style.borderColor = cond ? "#EF4444" : ""; inp.style.background = cond ? "#FEF2F2" : ""; } };
          setInpErr(inA, a <= 0 || a >= m);
          setInpErr(inM, m <= a || m >= b);
          setInpErr(inB, b <= m);

          const reason = a <= 0 ? "Optimistic (a) must be strictly positive (> 0)"
            : (a >= m && m >= b) ? `Opt (a=${a}) ≥ Likely (m=${m}) ≥ Pess (b=${b})`
            : (a >= m) ? `Opt (a=${a}) must be strictly less than Likely (m=${m})`
            : `Likely (m=${m}) must be strictly less than Pess (b=${b})`;

          if (errDiv) { errDiv.innerHTML = `⚠️ <strong>Violation:</strong> ${reason}`; errDiv.style.display = "block"; }
          const teCell = row.querySelector(`.cell-te-${aid}`);
          if (teCell) teCell.innerHTML = `<span style="color: #DC2626;" title="${reason}">⚠️ Error</span>`;
          const sigmaCell = row.querySelector(`.cell-sigma-${aid}`);
          if (sigmaCell) sigmaCell.innerHTML = `<span style="color: #DC2626; font-size: 0.72rem; font-weight: 700;">Invalid a &lt; m &lt; b</span>`;
          const varCell = row.querySelector(`.cell-var-${aid}`);
          if (varCell) varCell.textContent = `—`;

          act.optimistic = a; act.most_likely = m; act.pessimistic = b;
          act.has_validation_error = true;
          estimateSaveStatus.textContent = "Fix Validation Errors";
          estimateSaveStatus.className = "badge badge-rose";
          estimateSaveStatus.style.display = "inline-block";
          btnSaveDurationEstimates.disabled = true;
          return;
        }

        row.classList.remove("row-invalid-estimate");
        [inA, inM, inB].forEach(inp => { if (inp) { inp.style.borderColor = ""; inp.style.background = ""; } });
        if (errDiv) errDiv.style.display = "none";
        delete act.has_validation_error;
        applyActivityDurationCalc(act, "three_point", { a, m, b });
      } else if (tech === "parametric") {
        applyActivityDurationCalc(act, "parametric", {
          rate: inRate ? parsePertNum(inRate.value, 0.8) : 0.8,
          qty: inQty ? parsePertNum(inQty.value, m) : m
        });
      } else if (tech === "analogous") {
        applyActivityDurationCalc(act, "analogous", { dur: act.analogous_actual_duration || act.duration || 75.0 });
      } else {
        applyActivityDurationCalc(act, "single", { dur: inM ? parsePertNum(inM.value, 35.0) : (act.duration || 35.0) });
      }

      // Update row cell displays
      const teCell = row.querySelector(`.cell-te-${aid}`);
      if (teCell) teCell.textContent = (act.duration || 0).toFixed(1);
      const sigmaCell = row.querySelector(`.cell-sigma-${aid}`);
      if (sigmaCell) sigmaCell.textContent = `± ${(act.std_dev || 0).toFixed(1)}d`;
      const varCell = row.querySelector(`.cell-var-${aid}`);
      if (varCell) varCell.textContent = `σ²: ${(act.variance || 0).toFixed(2)}`;

      const hasAnyInvalid = estimateTableContainer.querySelector(".row-invalid-estimate") !== null;
      btnSaveDurationEstimates.disabled = hasAnyInvalid;
      estimateSaveStatus.textContent = hasAnyInvalid ? "Fix Validation Errors" : "Unsaved Changes";
      estimateSaveStatus.className = `badge ${hasAnyInvalid ? "badge-rose" : "badge-amber"}`;
      estimateSaveStatus.style.display = "inline-block";
      if (!hasAnyInvalid) hasUnsavedEstimates = true;

      // Recompute CPM client-side and update top banner live!
      activePertAnalysis = computePertScheduleClient(project.activities || [], project.dependencies || []);
      updatePertSimulator();
    }

    // Attach direct listeners on every input
    estimateTableContainer.querySelectorAll("input").forEach(inp => {
      ["input", "change", "blur", "keyup"].forEach(evt => {
        inp.addEventListener(evt, () => {
          const aid = inp.getAttribute("data-id");
          if (aid) updateRowValues(aid);
        });
      });
    });

    // Delegated container listener to guarantee capturing all edits
    estimateTableContainer.oninput = (e) => {
      const inp = e.target.closest("input");
      if (inp && inp.getAttribute("data-id")) {
        updateRowValues(inp.getAttribute("data-id"));
      }
    };
    estimateTableContainer.onchange = (e) => {
      const inp = e.target.closest("input");
      if (inp && inp.getAttribute("data-id")) {
        updateRowValues(inp.getAttribute("data-id"));
      }
    };
  }

  // Filter Listeners
  if (estimateSearchInput) estimateSearchInput.addEventListener("input", renderEstimateTable);
  if (estimateWpFilter) estimateWpFilter.addEventListener("change", renderEstimateTable);
  if (estimateTechFilter) estimateTechFilter.addEventListener("change", renderEstimateTable);
  if (estimateCpOnlyFilter) estimateCpOnlyFilter.addEventListener("change", renderEstimateTable);

  // Slider & Target Input listeners
  pertTargetSlider.addEventListener("input", () => {
    const dVal = parseFloat(pertTargetSlider.value);
    pertTargetInput.value = dVal;
    updatePertSimulator(dVal);
  });

  pertTargetInput.addEventListener("input", () => {
    const dVal = parseFloat(pertTargetInput.value);
    if (!isNaN(dVal)) {
      pertTargetSlider.value = dVal;
      updatePertSimulator(dVal);
    }
  });

  // Presets Buttons
  presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const prob = parseInt(btn.getAttribute("data-prob"), 10);
      if (activePertAnalysis && activePertAnalysis.confidenceLevels && activePertAnalysis.confidenceLevels[prob]) {
        const targetVal = activePertAnalysis.confidenceLevels[prob];
        setActivePertPreset(prob);
        updatePertSimulator(targetVal, prob);
      } else {
        setActivePertPreset(prob);
      }
    });
  });

  // Reset Standard Realistic PERT Baseline (4-Year Lifecycle > 1,461 Days)
  const STANDARD_PERT_BASELINE = {
    // 1. Pre-production (~310 days)
    "ACT-1.1.1": { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" },
    "ACT-1.1.2": { opt: 30.0, likely: 50.0, pess: 80.0, tech: "three_point" },
    "ACT-1.1.3": { opt: 25.0, likely: 45.0, pess: 75.0, tech: "three_point" },
    "ACT-1.2.1": { opt: 45.0, likely: 75.0, pess: 120.0, tech: "three_point" },
    "ACT-1.2.2": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
    "ACT-1.3.1": { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" },
    "ACT-1.3.2": { opt: 30.0, likely: 50.0, pess: 85.0, tech: "three_point" },
    "ACT-1.4.1": { opt: 15.0, likely: 30.0, pess: 50.0, tech: "three_point" },
    "ACT-1.4.2": { opt: 10.0, likely: 15.0, pess: 30.0, tech: "three_point" },

    // 2. Production (~550 days)
    "ACT-2.1.1": { opt: 110.0, likely: 180.0, pess: 280.0, tech: "three_point" },
    "ACT-2.1.2": { opt: 80.0, likely: 130.0, pess: 200.0, tech: "three_point" },
    "ACT-2.2.1": { opt: 90.0, likely: 150.0, pess: 240.0, tech: "three_point" },
    "ACT-2.2.2": { opt: 75.0, likely: 124.0, pess: 190.0, tech: "parametric", p_rate: 0.8, p_qty: 155.0 },
    "ACT-2.3.1": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
    "ACT-2.3.2": { opt: 50.0, likely: 80.0, pess: 130.0, tech: "three_point" },
    "ACT-2.4.1": { opt: 40.0, likely: 65.0, pess: 110.0, tech: "three_point" },
    "ACT-2.4.2": { opt: 30.0, likely: 50.0, pess: 85.0, tech: "three_point" },

    // 3. Alpha (~160 days)
    "ACT-3.1.1": { opt: 30.0, likely: 50.0, pess: 80.0, tech: "three_point" },
    "ACT-3.1.2": { opt: 15.0, likely: 25.0, pess: 45.0, tech: "three_point" },
    "ACT-3.2.1": { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" },
    "ACT-3.2.2": { opt: 25.0, likely: 45.0, pess: 75.0, tech: "three_point" },

    // 4. Beta (~280 days)
    "ACT-4.1.1": {
      opt: 45.0, likely: 75.0, pess: 120.0, tech: "analogous", duration: 75.0,
      analogous_project_id: "6acf99990001aaaaaaaa0001",
      analogous_project_name: "Legacy Fantasy RPG: Realms of Aethelgard",
      analogous_activity_id: "PAST-ACT-105",
      analogous_activity_name: "Multi-Language Text & Voice Localization Integration",
      analogous_actual_duration: 75.0,
      analogous_controller_name: "Sarah Williams (Controller)",
      analogous_approval_date: "2023-06-18"
    },
    "ACT-4.1.2": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
    "ACT-4.2.1": { opt: 40.0, likely: 70.0, pess: 110.0, tech: "three_point" },
    "ACT-4.2.2": { opt: 30.0, likely: 50.0, pess: 85.0, tech: "three_point" },

    // 5. Gold (~135 days)
    "ACT-5.1.1": { opt: 25.0, likely: 40.0, pess: 70.0, tech: "three_point" },
    "ACT-5.1.2": { opt: 15.0, likely: 25.0, pess: 40.0, tech: "three_point" },
    "ACT-5.2.1": {
      opt: 50.0, likely: 80.0, pess: 130.0, tech: "analogous", duration: 80.0,
      analogous_project_id: "6acf99990001aaaaaaaa0001",
      analogous_project_name: "Legacy Fantasy RPG: Realms of Aethelgard",
      analogous_activity_id: "PAST-ACT-106",
      analogous_activity_name: "First-Party Console Compliance Certification (TRC & XR)",
      analogous_actual_duration: 80.0,
      analogous_controller_name: "Sarah Williams (Controller)",
      analogous_approval_date: "2024-01-22"
    },
    "ACT-5.2.2": { opt: 30.0, likely: 50.0, pess: 90.0, tech: "three_point" },

    // 6. Launch (~70 days)
    "ACT-6.1.1": { opt: 15.0, likely: 25.0, pess: 45.0, tech: "three_point" },
    "ACT-6.1.2": { opt: 10.0, likely: 15.0, pess: 30.0, tech: "three_point" },
    "ACT-6.2.1": { opt: 5.0, likely: 8.0, pess: 15.0, tech: "three_point" },
    "ACT-6.2.2": { opt: 25.0, likely: 40.0, pess: 65.0, tech: "three_point" },

    // 7. Management and Control
    "ACT-7.1.1": { opt: 120.0, likely: 200.0, pess: 320.0, tech: "three_point" },
    "ACT-7.1.2": { opt: 80.0, likely: 140.0, pess: 220.0, tech: "three_point" },
    "ACT-7.2.1": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
    "ACT-7.2.2": { opt: 50.0, likely: 80.0, pess: 130.0, tech: "three_point" },
    "ACT-7.3.1": { opt: 35.0, likely: 60.0, pess: 95.0, tech: "three_point" },
    "ACT-7.3.2": { opt: 25.0, likely: 45.0, pess: 75.0, tech: "three_point" },
    "ACT-7.4.1": { opt: 40.0, likely: 65.0, pess: 110.0, tech: "three_point" },
    "ACT-7.4.2": { opt: 35.0, likely: 55.0, pess: 90.0, tech: "three_point" }
  };

  btnSeedPertDefaults.addEventListener("click", () => {
    if (!confirm("Reset all activity duration estimates to the standard realistic PERT baseline (4-Year Lifecycle)?")) return;

    (project.activities || []).forEach(act => {
      const cfg = STANDARD_PERT_BASELINE[act.activity_id] || { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" };
      const tech = cfg.tech || "three_point";
      applyActivityDurationCalc(act, tech, {
        a: cfg.opt, m: cfg.likely, b: cfg.pess,
        rate: cfg.p_rate || 0.8, qty: cfg.p_qty || cfg.likely,
        dur: cfg.duration || cfg.likely || 75.0
      });
      if (tech === "analogous") {
        Object.assign(act, {
          analogous_project_id: cfg.analogous_project_id,
          analogous_project_name: cfg.analogous_project_name,
          analogous_activity_id: cfg.analogous_activity_id,
          analogous_activity_name: cfg.analogous_activity_name,
          analogous_actual_duration: cfg.analogous_actual_duration || act.duration,
          analogous_controller_name: cfg.analogous_controller_name,
          analogous_approval_date: cfg.analogous_approval_date,
          analogous_source: cfg.analogous_project_name ? `${cfg.analogous_project_name}: ${cfg.analogous_activity_name}` : null
        });
      }
    });

    hasUnsavedEstimates = true;
    estimateSaveStatus.textContent = "Unsaved Changes";
    estimateSaveStatus.className = "badge badge-amber";
    estimateSaveStatus.style.display = "inline-block";
    renderEstimateView();
  });

  /**
   * Scans all rendered estimation table rows and synchronizes live user inputs into project.activities.
   */
  function syncAllEstimateInputsFromDom() {
    const rows = estimateTableContainer.querySelectorAll("tr[data-row-id]");
    const parseNum = (str, fallback) => {
      if (str === null || str === undefined) return fallback;
      const s = String(str).replace(",", ".").trim();
      if (s === "") return fallback;
      const n = parseFloat(s);
      return isNaN(n) ? fallback : n;
    };

    rows.forEach(row => {
      const aid = row.getAttribute("data-row-id");
      const act = (project.activities || []).find(a => a.activity_id === aid);
      if (!act) return;

      if (act.is_milestone) {
        act.optimistic = 0.0;
        act.most_likely = 0.0;
        act.pessimistic = 0.0;
        act.duration = 0.0;
        act.expected_time = 0.0;
        act.std_dev = 0.0;
        act.variance = 0.0;
        return;
      }

      const techSel = row.querySelector(".pert-select-tech");
      const tech = (techSel ? techSel.value : (act.estimation_technique || "three_point")).toLowerCase();
      act.estimation_technique = tech;

      const inA = row.querySelector(".pert-input-a");
      const inM = row.querySelector(".pert-input-m");
      const inB = row.querySelector(".pert-input-b");
      const inRate = row.querySelector(".pert-input-prate");
      const inQty = row.querySelector(".pert-input-pqty");

      if (tech === "three_point") {
        const a = inA ? parseNum(inA.value, act.optimistic || 1.0) : (act.optimistic || 1.0);
        const m = inM ? parseNum(inM.value, act.most_likely || 2.0) : (act.most_likely || 2.0);
        const b = inB ? parseNum(inB.value, act.pessimistic || 3.0) : (act.pessimistic || 3.0);
        applyActivityDurationCalc(act, "three_point", { a, m, b });
      } else if (tech === "parametric") {
        const rate = inRate ? parseNum(inRate.value, act.parametric_rate || 0.8) : (act.parametric_rate || 0.8);
        const qty = inQty ? parseNum(inQty.value, act.parametric_quantity || 1.0) : (act.parametric_quantity || 1.0);
        applyActivityDurationCalc(act, "parametric", { rate, qty });
      } else if (tech === "analogous") {
        const dur = parseNum(act.analogous_actual_duration, act.duration || 10.0);
        applyActivityDurationCalc(act, "analogous", { dur });
      } else {
        const dur = inM ? parseNum(inM.value, act.most_likely || act.duration || 5.0) : (act.duration || 5.0);
        applyActivityDurationCalc(act, "single", { dur });
      }
    });
  }

  // Save Duration Estimates
  btnSaveDurationEstimates.addEventListener("click", async () => {
    estimateAlertMsg.style.display = "none";

    // 1. Force synchronize all live DOM input table values into project.activities
    syncAllEstimateInputsFromDom();

    // 2. Strict Pre-save Check: Opt (a) < Likely (m) < Pess (b)
    const invalidList = [];
    (project.activities || []).forEach(act => {
      if (act.is_milestone) return;
      const tech = (act.estimation_technique || "three_point").toLowerCase();
      if (tech === "three_point") {
        const a = parseFloat(act.optimistic);
        const m = parseFloat(act.most_likely);
        const b = parseFloat(act.pessimistic);
        if (isNaN(a) || isNaN(m) || isNaN(b) || a <= 0 || a >= m || m >= b) {
          invalidList.push({ id: act.activity_id, name: act.name, a, m, b });
        }
      }
    });

    if (invalidList.length > 0) {
      estimateAlertMsg.className = "alert alert-danger";
      const details = invalidList.map(item => `<li><strong>${item.id}</strong> (${item.name}): Opt (a=${item.a}) &lt; Likely (m=${item.m}) &lt; Pess (b=${item.b}) violated</li>`).join("");
      estimateAlertMsg.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 4px;">⛔ Cannot save duration estimates: Invalid Three-Point values detected!</div>
        <div style="font-size: 0.85rem; margin-bottom: 6px;">The PMBOK Three-Point (Beta) distribution strictly requires <code>Opt (a) &lt; Likely (m) &lt; Pess (b)</code>. Please correct the highlighted entries:</div>
        <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem;">${details}</ul>
      `;
      estimateAlertMsg.style.display = "block";
      estimateSaveStatus.textContent = "Fix Validation Errors";
      estimateSaveStatus.className = "badge badge-rose";
      return;
    }

    btnSaveDurationEstimates.disabled = true;
    btnSaveDurationEstimates.innerHTML = `⏳ Saving...`;

    try {
      const res = await updateProjectActivities(project.id, project.activities || []);
      if (res.error) {
        estimateAlertMsg.className = "alert alert-danger";
        estimateAlertMsg.textContent = `Failed to save duration estimates: ${res.error}`;
        estimateAlertMsg.style.display = "block";
      } else {
        project = res.data;
        hasUnsavedEstimates = false;
        estimateSaveStatus.textContent = "Saved";
        estimateSaveStatus.className = "badge badge-emerald";
        estimateSaveStatus.style.display = "inline-block";
        estimateAlertMsg.className = "alert alert-success";
        estimateAlertMsg.textContent = "✓ Activity duration estimates saved successfully to database!";
        estimateAlertMsg.style.display = "block";
        setTimeout(() => {
          estimateAlertMsg.style.display = "none";
        }, 3000);
        renderEstimateView();
      }
    } catch (err) {
      estimateAlertMsg.className = "alert alert-danger";
      estimateAlertMsg.textContent = `Error: ${err.message}`;
      estimateAlertMsg.style.display = "block";
    } finally {
      btnSaveDurationEstimates.disabled = false;
      btnSaveDurationEstimates.innerHTML = `💾 Save Duration Estimates`;
    }
  });

  // Main Render Estimate View function
  /**
 * Main render dispatcher for Section 4 (Estimate Activity Durations).
 */
function renderEstimateView() {
    const activities = project.activities || [];
    const dependencies = project.dependencies || [];

    // Ensure activities have baseline estimates if missing
    let missingEstimates = false;
    activities.forEach(act => {
      if (act.duration === undefined || act.optimistic === undefined) {
        missingEstimates = true;
        const cfg = STANDARD_PERT_BASELINE[act.activity_id] || { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" };
        act.estimation_technique = cfg.tech || "three_point";
        act.optimistic = cfg.opt;
        act.most_likely = cfg.likely;
        act.pessimistic = cfg.pess;

        if (act.estimation_technique === "three_point") {
          act.duration = parseFloat(((cfg.opt + 4.0 * cfg.likely + cfg.pess) / 6.0).toFixed(2));
          act.expected_time = act.duration;
          act.std_dev = parseFloat(((cfg.pess - cfg.opt) / 6.0).toFixed(3));
          act.variance = parseFloat((act.std_dev * act.std_dev).toFixed(4));
        } else if (act.estimation_technique === "parametric") {
          act.parametric_rate = cfg.p_rate || 0.8;
          act.parametric_quantity = cfg.p_qty || cfg.likely;
          act.duration = parseFloat((act.parametric_rate * act.parametric_quantity).toFixed(2));
          act.expected_time = act.duration;
          act.std_dev = parseFloat((act.duration * 0.1).toFixed(3));
          act.variance = parseFloat((act.std_dev * act.std_dev).toFixed(4));
        } else if (act.estimation_technique === "analogous") {
          act.duration = cfg.duration || cfg.likely || 75.0;
          act.expected_time = act.duration;
          act.std_dev = parseFloat((act.duration * 0.15).toFixed(3));
          act.variance = parseFloat((act.std_dev * act.std_dev).toFixed(4));
          act.analogous_project_id = cfg.analogous_project_id;
          act.analogous_project_name = cfg.analogous_project_name;
          act.analogous_activity_id = cfg.analogous_activity_id;
          act.analogous_activity_name = cfg.analogous_activity_name;
          act.analogous_actual_duration = cfg.analogous_actual_duration || act.duration;
          act.analogous_controller_name = cfg.analogous_controller_name;
          act.analogous_approval_date = cfg.analogous_approval_date;
          act.analogous_source = cfg.analogous_project_name ? `${cfg.analogous_project_name}: ${cfg.analogous_activity_name}` : null;
        } else {
          act.duration = cfg.likely;
          act.expected_time = act.duration;
          act.std_dev = 0;
          act.variance = 0;
        }
      }
    });

    // 1. Compute CPM and PERT path
    activePertAnalysis = computePertScheduleClient(activities, dependencies);

    // 2. Adjust slider range based on mu and sigma
    const mu = activePertAnalysis.mu;
    const std = activePertAnalysis.stdPath;
    const minD = Math.max(10, Math.floor(mu - 3.5 * std));
    const maxD = Math.ceil(mu + 4.0 * std);

    pertTargetSlider.min = minD;
    pertTargetSlider.max = maxD;
    pertTargetSlider.step = 0.5;

    if (currentTargetD === null || currentTargetD < minD || currentTargetD > maxD) {
      currentTargetD = mu;
    }

    // 3. Update simulator UI
    updatePertSimulator(currentTargetD);

    // Auto-correct any legacy values that violate strict a < m < b
    activities.forEach(act => {
      if (act.is_milestone) return;
      const tech = (act.estimation_technique || "three_point").toLowerCase();
      if (tech === "three_point") {
        let a = parseFloat(act.optimistic);
        let m = parseFloat(act.most_likely);
        let b = parseFloat(act.pessimistic);
        if (!isNaN(a) && !isNaN(m) && !isNaN(b)) {
          let adjusted = false;
          if (a <= 0) { a = 1.0; adjusted = true; }
          if (m <= a) { m = round(a + Math.max(1.0, a * 0.3), 1); adjusted = true; }
          if (b <= m) { b = round(m + Math.max(1.5, m * 0.4), 1); adjusted = true; }
          if (adjusted) {
            act.optimistic = a;
            act.most_likely = m;
            act.pessimistic = b;
            act.duration = act.expected_time = round((a + 4.0 * m + b) / 6.0, 2);
            act.std_dev = round((b - a) / 6.0, 3);
            act.variance = round(act.std_dev * act.std_dev, 4);
          }
        }
      }
    });

    // 4. Render Table
    renderEstimateTable();
  }


  
  // VIEW 5: DEVELOP SCHEDULE CONTROLLER
  

  // View 5 DOM Elements
  const btnRecalculateSchedule = document.getElementById("btn-recalculate-schedule");
  const btnSaveScheduleSettings = document.getElementById("btn-save-schedule-settings");
  const schedAlertMsg = document.getElementById("sched-alert-msg");
  const schedSaveStatus = document.getElementById("sched-save-status");

  // KPI elements
  const kpiSchedDuration = document.getElementById("kpi-sched-duration");
  const kpiSchedDates = document.getElementById("kpi-sched-dates");
  const kpiSchedVariance = document.getElementById("kpi-sched-variance");
  const kpiSchedCpCount = document.getElementById("kpi-sched-cp-count");
  const kpiSchedCpPct = document.getElementById("kpi-sched-cp-pct");
  const kpiSchedNearCritCount = document.getElementById("kpi-sched-near-crit-count");
  const kpiSchedNearCritSub = document.getElementById("kpi-sched-near-crit-sub");
  const kpiSchedPfCard = document.getElementById("kpi-sched-pf-card");
  const kpiSchedProjectFloat = document.getElementById("kpi-sched-project-float");
  const kpiSchedPfDesc = document.getElementById("kpi-sched-pf-desc");
  const projectFloatBadge = document.getElementById("project-float-badge");

  // Deadline & Threshold controls
  const schedInputImposedDate = document.getElementById("sched-input-imposed-date");
  const schedInputImposedDays = document.getElementById("sched-input-imposed-days");
  const schedSliderNearCrit = document.getElementById("sched-slider-near-crit");
  const schedNearCritValDisplay = document.getElementById("sched-near-crit-val-display");
  const schedThresholdSavedPill = document.getElementById("sched-threshold-saved-pill");

  // Legend Guide Controls
  const btnToggleSchedLegend = document.getElementById("btn-toggle-sched-legend");
  const schedLegendContent = document.getElementById("sched-legend-content");
  const schedLegendChevron = document.getElementById("sched-legend-chevron");

  // Tabs & Panes
  const schedTabButtons = document.querySelectorAll(".sched-tab-btn");
  const schedTabPanes = document.querySelectorAll(".sched-tab-pane");
  const schedPaneAon = document.getElementById("sched-pane-aon");
  const schedPaneAoa = document.getElementById("sched-pane-aoa");
  const schedPaneMatrix = document.getElementById("sched-pane-matrix");
  const schedPaneGantt = document.getElementById("sched-pane-gantt");

  // AON Elements
  const aonNetworkCanvas = document.getElementById("aon-network-canvas");
  const schedAonFilterMode = document.getElementById("sched-aon-filter-mode");
  const btnAonZoomIn = document.getElementById("btn-aon-zoom-in");
  const btnAonZoomOut = document.getElementById("btn-aon-zoom-out");
  const btnAonFit = document.getElementById("btn-aon-fit");

  // AOA Elements
  const aoaNetworkCanvas = document.getElementById("aoa-network-canvas");
  const schedAoaFilterMode = document.getElementById("sched-aoa-filter-mode");
  const btnAoaZoomIn = document.getElementById("btn-aoa-zoom-in");
  const btnAoaZoomOut = document.getElementById("btn-aoa-zoom-out");
  const btnAoaFit = document.getElementById("btn-aoa-fit");

  // Matrix Elements
  const schedMatrixTableContainer = document.getElementById("sched-matrix-table-container");
  const schedMatrixSearch = document.getElementById("sched-matrix-search");
  const schedMatrixStatusFilter = document.getElementById("sched-matrix-status-filter");
  const schedMatrixCount = document.getElementById("sched-matrix-count");
  const schedMatrixFilteredCount = document.getElementById("sched-matrix-filtered-count");

  // Gantt Elements & Multi-Baseline Tracking
  const schedGanttContainer = document.getElementById("sched-gantt-container");
  const selectCompareBaseline = document.getElementById("select-compare-baseline");
  const btnFreezeBaseline = document.getElementById("btn-freeze-baseline");
  const ganttBaselineLegend = document.getElementById("gantt-baseline-legend");
  let projectBaselinesList = [];
  let selectedBaselineData = null;
  let selectedBaselineMap = {};

  // State
  let currentScheduleModel = null;
  let activeSchedTab = "aon";
  let aonNetworkInstance = null;
  let aoaNetworkInstance = null;
  let isScheduleInitialized = false;
  let isThresholdUserModified = false;

  /**
 * Main render dispatcher for Section 4 Develop Schedule (CPM, Floats, AON, AOA, Gantt, DCMA).
 */
async function renderScheduleView() {
    if (!project) return;

    const params = {};
    if (isThresholdUserModified && schedSliderNearCrit) {
      params.near_critical_threshold = parseFloat(schedSliderNearCrit.value) || 25;
    }
    const impDaysVal = schedInputImposedDays && schedInputImposedDays.value ? parseFloat(schedInputImposedDays.value) : null;
    const impDateVal = schedInputImposedDate && schedInputImposedDate.value ? schedInputImposedDate.value : null;
    if (impDaysVal !== null) params.imposed_deadline_days = impDaysVal;
    if (impDateVal !== null) params.imposed_deadline_date = impDateVal;

    try {
      const projId = (project && (project.id || project._id)) || projectId;
      const result = await fetchProjectSchedule(projId, params);

      if (result.error || !result.data) {
        showSchedAlert(result.error || "Failed to load schedule model.", "danger");
        return;
      }

      currentScheduleModel = result.data;
      renderScheduleKpis(currentScheduleModel.summary);
      await loadProjectBaselines();
      renderActiveSchedTab();

      if (!isScheduleInitialized) {
        setupScheduleEventListeners();
        isScheduleInitialized = true;
      }
    } catch (err) {
      showSchedAlert("Error calculating schedule: " + err.message, "danger");
    }
  }

  /**
 * Displays a transient notification alert in the Develop Schedule view.
 */
function showSchedAlert(msg, type = "success") {
    showTransientAlert(schedAlertMsg, msg, type, 4000);
  }


  /**
 * Renders Critical Path duration, project float, and flexible activities KPI cards.
 */
function renderScheduleKpis(summary) {
    if (!summary) return;

    if (kpiSchedDuration) {
      kpiSchedDuration.textContent = `${summary.planned_duration_days.toLocaleString()} d`;
    }
    if (kpiSchedDates) {
      kpiSchedDates.textContent = `${summary.planned_start_date} ➔ ${summary.planned_finish_date}`;
    }
    if (kpiSchedVariance) {
      kpiSchedVariance.textContent = `σ = ± ${summary.critical_path_sigma} d (PERT Risk)`;
    }
    if (kpiSchedCpCount) {
      kpiSchedCpCount.textContent = `${summary.critical_activities_count} / ${summary.total_activities}`;
    }
    if (kpiSchedCpPct) {
      kpiSchedCpPct.textContent = `${summary.critical_ratio_pct}% of project activities`;
    }
    if (kpiSchedNearCritCount) {
      kpiSchedNearCritCount.textContent = `${summary.near_critical_count} / ${summary.total_activities}`;
    }
    if (kpiSchedNearCritSub) {
      kpiSchedNearCritSub.textContent = `Float ≤ ${summary.near_critical_threshold_days}d (Monitored Risk)`;
    }

    // Project Float Display
    const pfDays = summary.project_float_days;
    const pfStatus = summary.project_float_status;

    if (kpiSchedProjectFloat) {
      kpiSchedProjectFloat.textContent = pfDays >= 0 ? `+ ${pfDays.toFixed(1)} d` : `${pfDays.toFixed(1)} d`;
    }

    if (kpiSchedPfCard && kpiSchedPfDesc && projectFloatBadge) {
      if (pfStatus === "positive") {
        kpiSchedPfCard.style.background = "rgba(16, 185, 129, 0.12)";
        kpiSchedPfCard.style.borderColor = "rgba(16, 185, 129, 0.3)";
        kpiSchedProjectFloat.style.color = "#34D399";
        kpiSchedPfDesc.textContent = "Contingency buffer ahead of deadline";
        kpiSchedPfDesc.style.color = "#D1FAE5";
        projectFloatBadge.style.background = "#065F46";
        projectFloatBadge.style.color = "#A7F3D0";
        projectFloatBadge.style.borderColor = "#059669";
        projectFloatBadge.innerHTML = `● Contingency Buffer: +${pfDays.toFixed(1)} Days`;
      } else if (pfStatus === "zero") {
        kpiSchedPfCard.style.background = "rgba(59, 130, 246, 0.12)";
        kpiSchedPfCard.style.borderColor = "rgba(59, 130, 246, 0.3)";
        kpiSchedProjectFloat.style.color = "#60A5FA";
        kpiSchedPfDesc.textContent = "Exact on-time delivery commitment";
        kpiSchedPfDesc.style.color = "#DBEAFE";
        projectFloatBadge.style.background = "#1E40AF";
        projectFloatBadge.style.color = "#BFDBFE";
        projectFloatBadge.style.borderColor = "#2563EB";
        projectFloatBadge.innerHTML = `● Exact Target: 0.0 Days Float`;
      } else {
        kpiSchedPfCard.style.background = "rgba(239, 68, 68, 0.14)";
        kpiSchedPfCard.style.borderColor = "rgba(239, 68, 68, 0.35)";
        kpiSchedProjectFloat.style.color = "#F87171";
        kpiSchedPfDesc.textContent = "Schedule slippage! Compression required";
        kpiSchedPfDesc.style.color = "#FEE2E2";
        projectFloatBadge.style.background = "#991B1B";
        projectFloatBadge.style.color = "#FECACA";
        projectFloatBadge.style.borderColor = "#DC2626";
        projectFloatBadge.innerHTML = `⚠️ Slippage Alert: ${pfDays.toFixed(1)} Days Deficit`;
      }
    }

    if (schedInputImposedDate && summary.imposed_deadline_date && !schedInputImposedDate.value) {
      schedInputImposedDate.value = summary.imposed_deadline_date;
    }
    if (schedInputImposedDays && summary.imposed_deadline_days && !schedInputImposedDays.value) {
      schedInputImposedDays.value = summary.imposed_deadline_days;
    }
    if (schedSliderNearCrit && summary.near_critical_threshold_days !== undefined) {
      schedSliderNearCrit.value = summary.near_critical_threshold_days;
      if (schedNearCritValDisplay) {
        schedNearCritValDisplay.textContent = `${summary.near_critical_threshold_days} days`;
      }
    }
    if (schedMatrixCount) {
      schedMatrixCount.textContent = summary.total_activities;
    }
  }

  /**
 * Dispatches rendering of active tab (AON Network, AOA Network, Matrix, Gantt, DCMA Quality).
 */
function renderActiveSchedTab() {
    if (activeSchedTab === "aon") {
      renderAonNetwork();
    } else if (activeSchedTab === "aoa") {
      renderAoaNetwork();
    } else if (activeSchedTab === "matrix") {
      renderScheduleMatrix();
    } else if (activeSchedTab === "gantt") {
      renderScheduleGantt();
    } else if (activeSchedTab === "dcma") {
      renderDcmaQualityAudit();
    }
  }

  // Tab 1: AON (CPM Network)
  /**
 * Renders Activity-on-Node (AON) Precedence Diagram with CPM blocks and red critical path.
 */
function renderAonNetwork() {
    if (!aonNetworkCanvas || !currentScheduleModel) return;

    const filterMode = schedAonFilterMode ? schedAonFilterMode.value : "all";
    const rawNodes = currentScheduleModel.aon_graph.nodes || [];
    const rawEdges = currentScheduleModel.aon_graph.edges || [];

    let filteredNodes = rawNodes;
    if (filterMode === "critical") {
      filteredNodes = rawNodes.filter(n => n.is_critical);
    } else if (filterMode === "near_critical") {
      filteredNodes = rawNodes.filter(n => n.is_critical || n.is_near_critical);
    }

    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = rawEdges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

    const data = {
      nodes: new vis.DataSet(filteredNodes),
      edges: new vis.DataSet(filteredEdges)
    };

    const options = {
      layout: {
        hierarchical: {
          direction: "LR",
          sortMethod: "directed",
          levelSeparation: 260,
          nodeSpacing: 130,
          shakeTowards: "roots"
        }
      },
      physics: {
        hierarchicalRepulsion: {
          nodeDistance: 130,
          springLength: 100
        }
      },
      interaction: {
        hover: true,
        tooltipDelay: 150,
        zoomView: true,
        dragView: true
      }
    };

    if (aonNetworkInstance) {
      aonNetworkInstance.destroy();
    }
    aonNetworkInstance = new vis.Network(aonNetworkCanvas, data, options);
    aonNetworkCanvas._visNetwork = aonNetworkInstance;
    if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
    window.SyncFlowNetworks["aon-network-canvas"] = aonNetworkInstance;
  }

  // Tab 2: AOA (PERT Network)
  /**
 * Renders Activity-on-Arrow (AOA / PERT) Event Network with TE/TL dates and dummy arrows.
 */
function renderAoaNetwork() {
    if (!aoaNetworkCanvas || !currentScheduleModel) return;

    const filterMode = schedAoaFilterMode ? schedAoaFilterMode.value : "all";
    const rawEvents = currentScheduleModel.aoa_graph.events || [];
    const rawArrows = currentScheduleModel.aoa_graph.edges || [];

    let filteredArrows = rawArrows;
    let filteredEvents = rawEvents;

    if (filterMode === "critical") {
      filteredArrows = rawArrows.filter(a => a.is_critical);
      const usedEventIds = new Set();
      filteredArrows.forEach(a => {
        usedEventIds.add(a.from);
        usedEventIds.add(a.to);
      });
      filteredEvents = rawEvents.filter(e => usedEventIds.has(e.id));
    }

    const data = {
      nodes: new vis.DataSet(filteredEvents),
      edges: new vis.DataSet(filteredArrows)
    };

    const options = {
      layout: {
        hierarchical: {
          direction: "LR",
          sortMethod: "directed",
          levelSeparation: 220,
          nodeSpacing: 110,
          shakeTowards: "roots"
        }
      },
      physics: {
        hierarchicalRepulsion: {
          nodeDistance: 120,
          springLength: 90
        }
      },
      interaction: {
        hover: true,
        tooltipDelay: 150,
        zoomView: true,
        dragView: true
      }
    };

    if (aoaNetworkInstance) {
      aoaNetworkInstance.destroy();
    }
    aoaNetworkInstance = new vis.Network(aoaNetworkCanvas, data, options);
    aoaNetworkCanvas._visNetwork = aoaNetworkInstance;
    if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
    window.SyncFlowNetworks["aoa-network-canvas"] = aoaNetworkInstance;
  }

  // Tab 3: Schedule Matrix
  /**
 * Renders comprehensive CPM mathematical table (ES, EF, LS, LF, TF, FF, Dates).
 */
function renderScheduleMatrix() {
    if (!schedMatrixTableContainer || !currentScheduleModel) return;

    const searchStr = (schedMatrixSearch ? schedMatrixSearch.value : "").trim().toLowerCase();
    const statusFilter = schedMatrixStatusFilter ? schedMatrixStatusFilter.value : "";

    const allActivities = currentScheduleModel.activities_schedule || [];
    const filtered = allActivities.filter(act => {
      // Search filter
      const matchesSearch = !searchStr ||
        act.activity_id.toLowerCase().includes(searchStr) ||
        act.name.toLowerCase().includes(searchStr) ||
        (act.assigned_team && act.assigned_team.toLowerCase().includes(searchStr)) ||
        (act.work_package_id && act.work_package_id.toLowerCase().includes(searchStr));

      // Status filter
      let matchesStatus = true;
      if (statusFilter === "critical") {
        matchesStatus = act.is_critical;
      } else if (statusFilter === "near_critical") {
        matchesStatus = act.is_near_critical;
      } else if (statusFilter === "flexible") {
        matchesStatus = !act.is_critical && !act.is_near_critical;
      }

      return matchesSearch && matchesStatus;
    });

    if (schedMatrixFilteredCount) {
      schedMatrixFilteredCount.textContent = filtered.length;
    }

    if (filtered.length === 0) {
      schedMatrixTableContainer.innerHTML = `
        <div style="padding: 2.5rem; text-align: center; color: var(--muted);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
          <h4>No activities match the selected filters</h4>
          <p style="font-size: 0.88rem;">Try clearing your search term or selecting 'All Statuses'.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="sched-matrix-table">
        <thead>
          <tr>
            <th>Activity ID</th>
            <th>Activity Name</th>
            <th style="text-align: right;">Duration</th>
            <th style="text-align: right;">ES</th>
            <th style="text-align: right;">EF</th>
            <th style="text-align: right;">LS</th>
            <th style="text-align: right;">LF</th>
            <th style="text-align: right;">Total Float</th>
            <th style="text-align: right;">Free Float</th>
            <th>Planned Dates</th>
            <th>Schedule Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    filtered.forEach(r => {
      let rowClass = "";
      let badgeHtml = "";

      if (r.is_critical) {
        rowClass = "critical-row";
        badgeHtml = `<span class="badge-critical">🔥 Critical Path</span>`;
      } else if (r.is_near_critical) {
        rowClass = "near-critical-row";
        badgeHtml = `<span class="badge-near-critical">⚠️ Near-Critical</span>`;
      } else {
        badgeHtml = `<span class="badge-flexible">🟢 Flexible Buffer</span>`;
      }

      html += renderScheduleMatrixRowHtml(r, rowClass, badgeHtml);
    });

    html += `
        </tbody>
      </table>
    `;

    schedMatrixTableContainer.innerHTML = html;
  }

  // Tab 4: Schedule Timeline & Gantt 
  /**
 * Renders interactive Gantt chart displaying early/late spans and milestone diamonds.
 */
function renderScheduleGantt() {
    if (!schedGanttContainer || !currentScheduleModel) return;

    const allActivities = currentScheduleModel.activities_schedule || [];
    const totalDays = currentScheduleModel.summary.planned_duration_days || 1641;
    const maxTimelineDays = Math.max(totalDays * 1.05, (currentScheduleModel.summary.imposed_deadline_days || totalDays) * 1.02);

    const isDualBar = Boolean(selectedBaselineData && selectedBaselineData.length > 0);
    if (ganttBaselineLegend) ganttBaselineLegend.style.display = isDualBar ? "flex" : "none";

    // Timeline grid ticks (every 200 days)
    const tickStep = 200;
    const ticks = [];
    for (let d = 0; d <= maxTimelineDays; d += tickStep) {
      ticks.push(d);
    }
    if (ticks[ticks.length - 1] < maxTimelineDays) {
      ticks.push(Math.ceil(maxTimelineDays));
    }

    let html = `
      <div class="gantt-chart-wrapper">
        <div class="gantt-grid-header">
          <div class="gantt-task-label">Project Activity</div>
          <div style="flex: 1; display: flex; position: relative;">
    `;

    ticks.forEach(t => {
      const leftPct = (t / maxTimelineDays) * 100;
      html += `
        <div style="position: absolute; left: ${leftPct}%; transform: translateX(-50%); font-family: monospace;">
          Day ${t}
        </div>
      `;
    });

    html += `
          </div>
        </div>
        <div style="display: flex; flex-direction: column;">
    `;

    allActivities.forEach(r => {
      const isMilestone = Boolean(r.is_milestone || r.duration === 0);
      const leftPct = (r.es / maxTimelineDays) * 100;
      const widthPct = Math.max(0.6, (r.duration / maxTimelineDays) * 100);
      const floatLeftPct = leftPct + widthPct;
      const floatWidthPct = Math.max(0, (r.total_float / maxTimelineDays) * 100);

      const barColor = r.is_critical ? "#EF4444" : (r.is_near_critical ? "#F59E0B" : "#3B82F6");

      // Baseline comparison calculations
      const baseAct = isDualBar ? selectedBaselineMap[r.activity_id] : null;
      let slippageBadge = "";
      let baseBarHtml = "";

      if (baseAct) {
        const baseIsMilestone = Boolean(baseAct.is_milestone || baseAct.duration === 0);
        const baseLeftPct = (baseAct.es / maxTimelineDays) * 100;
        const baseWidthPct = Math.max(0.6, (baseAct.duration / maxTimelineDays) * 100);
        const slippageDays = (r.ef !== undefined && baseAct.ef !== undefined) ? Math.round(r.ef - baseAct.ef) : 0;

        if (slippageDays > 0) {
          slippageBadge = `<span style="font-size: 0.7rem; font-weight: 700; color: #DC2626; background: #FEE2E2; padding: 1px 5px; border-radius: 3px; margin-left: 4px;">+${slippageDays}d</span>`;
        } else if (slippageDays < 0) {
          slippageBadge = `<span style="font-size: 0.7rem; font-weight: 700; color: #059669; background: #D1FAE5; padding: 1px 5px; border-radius: 3px; margin-left: 4px;">${slippageDays}d</span>`;
        } else {
          slippageBadge = `<span style="font-size: 0.7rem; font-weight: 600; color: #64748B; background: #F1F5F9; padding: 1px 5px; border-radius: 3px; margin-left: 4px;">0d</span>`;
        }

        if (baseIsMilestone) {
          baseBarHtml = `
            <div class="gantt-milestone-diamond-baseline"
                 style="left: calc(${baseLeftPct}% - 6px);"
                 title="[Baseline] ◆ Milestone: ${baseAct.activity_id} - ${baseAct.name}&#10;ES: Day ${baseAct.es}&#10;Date: ${baseAct.early_start_date}">
            </div>
          `;
        } else {
          baseBarHtml = `
            <div class="gantt-bar-baseline"
                 style="left: ${baseLeftPct}%; width: ${baseWidthPct}%;"
                 title="[Baseline] ${baseAct.activity_id}&#10;Duration: ${baseAct.duration}d&#10;ES: Day ${baseAct.es} (${baseAct.early_start_date})&#10;EF: Day ${baseAct.ef} (${baseAct.early_finish_date})">
              ${baseAct.duration >= 30 ? `${baseAct.duration.toFixed(0)}d` : ""}
            </div>
          `;
        }
      }

      html += `
        <div class="gantt-task-row ${isDualBar ? 'dual-bar-active' : ''}">
          <div class="gantt-task-label" title="${r.activity_id}: ${r.name}">
            <code style="font-size: 0.78rem; font-weight: 700; color: ${isMilestone ? '#7C3AED' : (r.is_critical ? '#DC2626' : 'inherit')};">${isMilestone ? '◆ ' : ''}${r.activity_id}</code>
            <span style="font-size: 0.82rem; margin-left: 4px;">${r.name}${isMilestone ? ' <em style="color:#7C3AED; font-size:0.75rem;">(Milestone)</em>' : ''}</span>
            ${slippageBadge}
          </div>
          <div class="gantt-timeline-area">
            ${isMilestone ? `
              <div class="gantt-milestone-diamond"
                   style="left: calc(${leftPct}% - 7px);"
                   title="◆ Milestone: ${r.activity_id} - ${r.name}&#10;Date: ${r.early_start_date} (Day ${r.es})&#10;Duration: 0 days&#10;Total Float: ${r.total_float}d">
              </div>
            ` : `
              <!-- Early Duration Bar -->
              <div class="gantt-bar-early"
                   style="left: ${leftPct}%; width: ${widthPct}%; background-color: ${barColor};"
                   title="${r.activity_id}: ${r.name}&#10;Duration: ${r.duration}d&#10;ES: Day ${r.es} (${r.early_start_date})&#10;EF: Day ${r.ef} (${r.early_finish_date})&#10;Total Float: ${r.total_float}d&#10;Free Float: ${r.free_float}d">
                ${r.duration >= 30 ? `${r.duration.toFixed(0)}d` : ""}
              </div>

              <!-- Total Float Extension -->
              ${r.total_float > 0 ? `
                <div class="gantt-bar-float"
                     style="left: ${floatLeftPct}%; width: ${floatWidthPct}%;"
                     title="Total Float: ${r.total_float}d (can delay up to Day ${r.lf} without affecting project completion)">
                </div>
              ` : ""}
            `}
            ${baseBarHtml}
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    schedGanttContainer.innerHTML = html;
  }

  /**
 * Wires collapsible diagram legend toggle behavior.
 */
function wireLegendToggle(btn, content, chevron) {
    if (!btn || !content) return;
    btn.addEventListener("click", () => {
      const isHidden = content.style.display === "none" || !content.style.display;
      content.style.display = isHidden ? "block" : "none";
      if (chevron) chevron.textContent = isHidden ? "Collapse Guide ▴" : "Expand Guide ▾";
    });
  }

  /**
 * Wires interactive zoom in, zoom out, and fit-view controls for vis-network graph.
 */
function wireNetworkZoomControls(instanceFn, btnIn, btnOut, btnFit) {
    if (btnIn) btnIn.addEventListener("click", () => { const inst = instanceFn(); if (inst) inst.moveTo({ scale: inst.getScale() * 1.25, animation: true }); });
    if (btnOut) btnOut.addEventListener("click", () => { const inst = instanceFn(); if (inst) inst.moveTo({ scale: inst.getScale() * 0.8, animation: true }); });
    if (btnFit) btnFit.addEventListener("click", () => { const inst = instanceFn(); if (inst) inst.fit({ animation: true }); });
  }

  //  Event Listeners for Develop Schedule 
  /**
 * Sets up event listeners for schedule recalculations, baseline freezing, and tab switching.
 */
function setupScheduleEventListeners() {
    wireLegendToggle(btnToggleSchedLegend, schedLegendContent, schedLegendChevron);

    // Tab switching
    schedTabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const tabKey = btn.getAttribute("data-tab");
        activeSchedTab = tabKey;
        schedTabButtons.forEach(b => {
          const isAct = b === btn;
          b.classList.toggle("active", isAct);
          b.style.color = isAct ? "var(--primary)" : "var(--slate)";
          b.style.borderBottom = isAct ? "3px solid var(--primary)" : "3px solid transparent";
          b.style.fontWeight = isAct ? "700" : "600";
        });
        schedTabPanes.forEach(pane => { pane.style.display = "none"; });
        const paneMap = { aon: schedPaneAon, aoa: schedPaneAoa, matrix: schedPaneMatrix, gantt: schedPaneGantt, dcma: document.getElementById("sched-pane-dcma") };
        if (paneMap[tabKey]) paneMap[tabKey].style.display = "block";
        if (tabKey === "aon") { renderAonNetwork(); setTimeout(() => aonNetworkInstance?.fit(), 100); }
        else if (tabKey === "aoa") { renderAoaNetwork(); setTimeout(() => aoaNetworkInstance?.fit(), 100); }
        else if (tabKey === "matrix") renderScheduleMatrix();
        else if (tabKey === "gantt") renderScheduleGantt();
        else if (tabKey === "dcma") renderDcmaQualityAudit();
      });
    });

    if (schedAonFilterMode) schedAonFilterMode.addEventListener("change", () => renderAonNetwork());
    wireNetworkZoomControls(() => aonNetworkInstance, btnAonZoomIn, btnAonZoomOut, btnAonFit);

    if (schedAoaFilterMode) schedAoaFilterMode.addEventListener("change", () => renderAoaNetwork());
    wireNetworkZoomControls(() => aoaNetworkInstance, btnAoaZoomIn, btnAoaZoomOut, btnAoaFit);

    // Matrix search and status filters
    if (schedMatrixSearch) {
      schedMatrixSearch.addEventListener("input", () => renderScheduleMatrix());
    }
    if (schedMatrixStatusFilter) {
      schedMatrixStatusFilter.addEventListener("change", () => renderScheduleMatrix());
    }

    // Near-Critical Threshold Slider (with instant persistence)
    if (schedSliderNearCrit) {
      schedSliderNearCrit.addEventListener("input", (e) => {
        const val = e.target.value;
        if (schedNearCritValDisplay) {
          schedNearCritValDisplay.textContent = `${val} days`;
        }
      });
      schedSliderNearCrit.addEventListener("change", async (e) => {
        const newThresh = parseFloat(e.target.value) || 25;
        const projId = (project && (project.id || project._id)) || projectId;
        if (projId) {
          try {
            const res = await updateProjectScheduleSettings(projId, {
              near_critical_threshold_days: newThresh
            });
            if (res && res.data && res.data.schedule_settings) {
              if (project) project.schedule_settings = res.data.schedule_settings;
            }
            if (schedThresholdSavedPill) {
              schedThresholdSavedPill.style.display = "inline-block";
              setTimeout(() => {
                schedThresholdSavedPill.style.display = "none";
              }, 2500);
            }
          } catch (err) {
            console.warn("Failed to auto-save near-critical threshold:", err);
          }
        }
        isThresholdUserModified = false;
        renderScheduleView();
      });
    }

    // Imposed Deadline Date & Days synchronization
    if (schedInputImposedDate) {
      schedInputImposedDate.addEventListener("change", (e) => {
        const dateStr = e.target.value;
        if (!dateStr || !currentScheduleModel) return;
        const start = new Date(currentScheduleModel.summary.planned_start_date);
        const target = new Date(dateStr);
        const diffDays = Math.round((target - start) / (1000 * 60 * 60 * 24));
        if (schedInputImposedDays) {
          schedInputImposedDays.value = diffDays;
        }
        renderScheduleView();
      });
    }

    if (schedInputImposedDays) {
      schedInputImposedDays.addEventListener("change", (e) => {
        const days = parseFloat(e.target.value);
        if (isNaN(days) || !currentScheduleModel) return;
        const start = new Date(currentScheduleModel.summary.planned_start_date);
        const target = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
        if (schedInputImposedDate) {
          schedInputImposedDate.value = target.toISOString().split("T")[0];
        }
        renderScheduleView();
      });
    }

    // Recalculate button
    if (btnRecalculateSchedule) {
      btnRecalculateSchedule.addEventListener("click", () => {
        renderScheduleView();
      });
    }

    // Save baseline schedule settings
    if (btnSaveScheduleSettings) {
      btnSaveScheduleSettings.addEventListener("click", async () => {
        if (!project) return;
        const payload = {
          imposed_deadline_date: schedInputImposedDate ? schedInputImposedDate.value : null,
          imposed_deadline_days: schedInputImposedDays && schedInputImposedDays.value ? parseFloat(schedInputImposedDays.value) : null,
          near_critical_threshold_days: schedSliderNearCrit ? parseFloat(schedSliderNearCrit.value) : 25.0,
          diagram_mode: activeSchedTab,
          notes: "Schedule baseline locked."
        };

        const projId = (project && (project.id || project._id)) || projectId;
        const res = await updateProjectScheduleSettings(projId, payload);
        if (res.error) {
          showSchedAlert("Failed to save schedule baseline: " + res.error, "danger");
        } else {
          if (res.data && res.data.schedule_settings) {
            if (project) project.schedule_settings = res.data.schedule_settings;
          }
          isThresholdUserModified = false;
          showSchedAlert("Baseline Schedule model saved successfully!", "success");
          if (schedSaveStatus) {
            schedSaveStatus.style.display = "inline-block";
            setTimeout(() => { schedSaveStatus.style.display = "none"; }, 3000);
          }
          if (schedThresholdSavedPill) {
            schedThresholdSavedPill.style.display = "inline-block";
            setTimeout(() => { schedThresholdSavedPill.style.display = "none"; }, 2500);
          }
          renderScheduleView();
        }
      });
    }
  }

  // Baseline Management & Freeze Events 
  /**
 * Loads Planned Baseline snapshot and renders variance comparisons against current schedule.
 */
async function loadProjectBaselines() {
    if (!selectCompareBaseline) return;
    const projId = (project && (project.id || project._id)) || projectId;
    const { data: baselines, error } = await fetchBaselines(projId);
    if (!error && baselines) {
      projectBaselinesList = baselines;
      let optHtml = `<option value="">None (Current CPM Schedule)</option>`;
      baselines.forEach(b => {
        const dStr = b.created_at ? b.created_at.split('T')[0] : 'Frozen';
        optHtml += `<option value="${b.id || b._id}">${b.name} (${dStr})</option>`;
      });
      selectCompareBaseline.innerHTML = optHtml;
    }
  }

  if (selectCompareBaseline && !selectCompareBaseline._hasListener) {
    selectCompareBaseline._hasListener = true;
    selectCompareBaseline.addEventListener("change", () => {
      const bId = selectCompareBaseline.value;
      if (!bId) {
        selectedBaselineData = null;
        selectedBaselineMap = {};
      } else {
        const found = projectBaselinesList.find(b => (b.id || b._id) === bId);
        if (found) {
          selectedBaselineData = found.activities_snapshot || [];
          selectedBaselineMap = {};
          selectedBaselineData.forEach(a => { selectedBaselineMap[a.activity_id] = a; });
        }
      }
      renderScheduleGantt();
    });
  }

  if (btnFreezeBaseline && !btnFreezeBaseline._hasListener) {
    btnFreezeBaseline._hasListener = true;
    btnFreezeBaseline.addEventListener("click", async () => {
      const defaultName = `Baseline ${projectBaselinesList.length} - ${new Date().toISOString().split("T")[0]}`;
      const name = window.prompt("Enter name for this schedule baseline snapshot:", defaultName);
      if (!name) return;
      const description = window.prompt("Optional description / contract revision justification:", "Approved schedule freeze");
      const projId = (project && (project.id || project._id)) || projectId;
      btnFreezeBaseline.disabled = true;
      btnFreezeBaseline.textContent = "⏳ Freezing...";
      const { data: created, error } = await createBaseline(projId, {
        name,
        description: description || "",
        created_by: user.id || user._id
      });
      btnFreezeBaseline.disabled = false;
      btnFreezeBaseline.textContent = "🔒 Freeze Current Baseline";
      if (error || !created) {
        showSchedAlert(`Failed to freeze baseline: ${error || "Unknown error"}`, "danger");
        return;
      }
      showSchedAlert(`Schedule baseline "${name}" successfully frozen and archived!`, "success");
      await loadProjectBaselines();
      if (selectCompareBaseline) {
        selectCompareBaseline.value = created.id || created._id;
        selectCompareBaseline.dispatchEvent(new Event("change"));
      }
    });
  }

  // Tab 5: DCMA 14-Point Automated Schedule Quality Diagnostic 
  /**
 * Fetches automated DCMA 14-Point Quality Assessment and renders scorecard and metric cards.
 */
async function renderDcmaQualityAudit() {
    const dcmaContainer = document.getElementById("dcma-audit-container");
    if (!dcmaContainer) return;
    dcmaContainer.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: var(--muted);"><span style="font-size: 1.5rem;">⚙️</span><br>Running DCMA 14-Point Automated Schedule Quality Diagnostic...</div>`;

    const projId = (project && (project.id || project._id)) || projectId;
    const { data: dcma, error } = await fetchDcmaQuality(projId);

    if (error || !dcma) {
      dcmaContainer.innerHTML = `<div class="alert-box alert-danger">Failed to execute DCMA 14-Point Diagnostic: ${error || "Unknown error"}</div>`;
      return;
    }

    const score = Number(dcma.overall_score || 0).toFixed(0);
    const grade = dcma.letter_grade || "C";
    const gradeColor = grade === "A" ? "#059669" : (grade === "B" ? "#2563EB" : (grade === "C" ? "#D97706" : "#DC2626"));
    const metrics = dcma.metrics || [];

    const passCount = metrics.filter(m => m.status === "pass").length;
    const warnCount = metrics.filter(m => m.status === "warning").length;
    const failCount = metrics.filter(m => m.status === "fail").length;

    let cardsHtml = "";
    metrics.forEach(m => {
      const statusPillClass = m.status === "pass" ? "dcma-pill-pass" : (m.status === "warning" ? "dcma-pill-warning" : "dcma-pill-fail");
      const statusLabel = m.status === "pass" ? "✓ PASS" : (m.status === "warning" ? "⚠️ WARNING" : "❌ FAIL");
      
      let culpritsHtml = "";
      if (m.culprits && m.culprits.length > 0) {
        const chips = m.culprits.map(c => {
          let label = "";
          let tooltip = "";
          if (typeof c === "object" && c !== null) {
            label = c.activity_id || c.dependency || c.name || c.error || "Issue";
            tooltip = c.name 
              ? `${c.activity_id ? c.activity_id + ': ' : ''}${c.name}${c.reason ? ' (' + c.reason + ')' : ''}${c.total_float !== undefined ? ' (Float: ' + c.total_float + 'd)' : ''}${c.duration !== undefined ? ' (Duration: ' + c.duration + 'd)' : ''}`
              : (c.dependency ? `${c.dependency}${c.lag !== undefined ? ' (Lag: ' + c.lag + 'd)' : ''}${c.type ? ' (Type: ' + c.type + ')' : ''}` : label);
          } else {
            label = String(c);
            tooltip = label;
          }
          const safeLabel = String(label).replace(/"/g, '&quot;');
          const safeTooltip = String(tooltip).replace(/"/g, '&quot;');
          return `<span style="font-size: 0.72rem; background: #FEE2E2; color: #DC2626; padding: 2px 6px; border-radius: 4px; font-weight: 700; cursor: help;" title="${safeTooltip}">${safeLabel}</span>`;
        }).join(" ");
        culpritsHtml = `
          <div style="margin-top: 8px; border-top: 1px dashed var(--border-light); padding-top: 6px;">
            <span style="font-size: 0.72rem; color: var(--muted); font-weight: 600; display: block; margin-bottom: 2px;">Culprit Activities:</span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">${chips}</div>
          </div>
        `;
      }

      const violationsCount = m.count !== undefined ? m.count : (m.culprits ? m.culprits.length : 0);
      const ratioDisplay = m.ratio_pct !== undefined ? `${m.ratio_pct}%` : (m.value || "0%");
      const thresholdDisplay = m.threshold_pct !== undefined ? `${m.threshold_pct}%` : (m.target || "N/A");

      cardsHtml += renderDcmaCardHtml({ m, statusPillClass, statusLabel, violationsCount, ratioDisplay, thresholdDisplay, culpritsHtml });
    });

    dcmaContainer.innerHTML = renderDcmaScoreCardHtml({ score, grade, gradeColor, passCount, warnCount, failCount, cardsHtml });
  }


  // VIEW 6: CONTROL SCHEDULE (PMBOK PROCESS 6.6)
  // Operational Monitoring, Task Execution Statuses (4 PMBOK colors),
  // Leading & Lagging Indicators, and Interactive S-Curve (Envelope & Progress)

  // State
  let currentControlModel = null;
  let scurveChartInstance = null;
  let isControlInitialized = false;

  // View 6 DOM References
  const ctrlStatusDate = document.getElementById("ctrl-status-date");
  const btnCtrlApplyDate = document.getElementById("btn-ctrl-apply-date");
  const btnCtrlToday = document.getElementById("btn-ctrl-today");
  const btnCtrlSeedProgress = document.getElementById("btn-ctrl-seed-progress");
  const btnCtrlRefresh = document.getElementById("btn-ctrl-refresh");
  const ctrlAlertMsg = document.getElementById("ctrl-alert-msg");

  // Executive Overview Banner
  const ctrlCardHealth = document.getElementById("ctrl-card-health");
  const ctrlHealthBadge = document.getElementById("ctrl-health-badge");
  const ctrlHealthSub = document.getElementById("ctrl-health-sub");
  const ctrlKpiSpi = document.getElementById("ctrl-kpi-spi");
  const ctrlSpiDesc = document.getElementById("ctrl-spi-desc");
  const ctrlKpiSv = document.getElementById("ctrl-kpi-sv");
  const ctrlKpiEvPct = document.getElementById("ctrl-kpi-ev-pct");
  const ctrlKpiPvPct = document.getElementById("ctrl-kpi-pv-pct");
  const ctrlKpiForecastDate = document.getElementById("ctrl-kpi-forecast-date");
  const ctrlKpiSlippageSub = document.getElementById("ctrl-kpi-slippage-sub");

  // Leading Indicators
  const ctrlLeadEacDays = document.getElementById("ctrl-lead-eac-days");
  const ctrlLeadCpSlippage = document.getElementById("ctrl-lead-cp-slippage");
  const ctrlLeadSpiVelocity = document.getElementById("ctrl-lead-spi-velocity");
  const ctrlLeadPfRem = document.getElementById("ctrl-lead-pf-rem");

  // Lagging Indicators & 4 Status Distribution
  const ctrlBarNotStarted = document.getElementById("ctrl-bar-not-started");
  const ctrlBarInProgress = document.getElementById("ctrl-bar-in-progress");
  const ctrlBarCompleted = document.getElementById("ctrl-bar-completed");
  const ctrlBarVerified = document.getElementById("ctrl-bar-verified");
  const ctrlCountNotStarted = document.getElementById("ctrl-count-not-started");
  const ctrlCountInProgress = document.getElementById("ctrl-count-in-progress");
  const ctrlCountCompleted = document.getElementById("ctrl-count-completed");
  const ctrlCountVerified = document.getElementById("ctrl-count-verified");
  const ctrlLagEvEffort = document.getElementById("ctrl-lag-ev-effort");
  const ctrlLagPvEffort = document.getElementById("ctrl-lag-pv-effort");
  const ctrlLagTotalEffort = document.getElementById("ctrl-lag-total-effort");

  // S-Curve Elements
  const ctrlScurveCanvas = document.getElementById("control-scurve-canvas");
  const ctrlScurveSvg = document.getElementById("control-scurve-svg");

  // View 6 Execution Network Diagram Elements
  const ctrlPdmCanvas = document.getElementById("ctrl-pdm-network-canvas");
  const ctrlPdmFilterMode = document.getElementById("ctrl-pdm-filter-mode");
  const btnCtrlPdmZoomIn = document.getElementById("btn-ctrl-pdm-zoom-in");
  const btnCtrlPdmZoomOut = document.getElementById("btn-ctrl-pdm-zoom-out");
  const btnCtrlPdmFit = document.getElementById("btn-ctrl-pdm-fit");
  let ctrlNetworkInstance = null;
  let activeCtrlTab = "pdm";

  // Task Matrix Elements
  const ctrlTasksTableContainer = document.getElementById("ctrl-tasks-table-container");
  const ctrlFilterSearch = document.getElementById("ctrl-filter-search");
  const ctrlFilterStatus = document.getElementById("ctrl-filter-status");
  const ctrlFilterCritical = document.getElementById("ctrl-filter-critical");
  const ctrlFilterCount = document.getElementById("ctrl-filter-count");

  // Modal Elements
  const ctrlActivityModal = document.getElementById("ctrl-activity-modal");
  const ctrlActivityForm = document.getElementById("ctrl-activity-form");
  const ctrlModalTitle = document.getElementById("ctrl-modal-title");
  const ctrlModalSub = document.getElementById("ctrl-modal-sub");
  const btnCloseCtrlModal = document.getElementById("btn-close-ctrl-modal");
  const btnCancelCtrlModal = document.getElementById("btn-cancel-ctrl-modal");
  const ctrlModalActId = document.getElementById("ctrl-modal-act-id");
  const ctrlModalStatus = document.getElementById("ctrl-modal-status");
  const ctrlModalProgGroup = document.getElementById("ctrl-modal-prog-group");
  const ctrlModalProgress = document.getElementById("ctrl-modal-progress");
  const ctrlModalProgVal = document.getElementById("ctrl-modal-prog-val");
  const ctrlModalActStart = document.getElementById("ctrl-modal-act-start");
  const ctrlModalActFinish = document.getElementById("ctrl-modal-act-finish");
  const ctrlModalVerifyGroup = document.getElementById("ctrl-modal-verify-group");
  const ctrlModalVerifiedBy = document.getElementById("ctrl-modal-verified-by");
  const ctrlModalNotes = document.getElementById("ctrl-modal-notes");

  // Control Time Logs & Contributor Breakdown Modal Elements
  const btnOpenTimelogsModal = document.getElementById("btn-open-timelogs-modal");
  const ctrlTimeLogsModal = document.getElementById("ctrl-time-logs-modal");
  const btnCloseCtrlTimelogModal = document.getElementById("btn-close-ctrl-timelog-modal");
  const btnCancelCtrlTimelogModal = document.getElementById("btn-cancel-ctrl-timelog-modal");
  const ctrlTimelogTaskSelect = document.getElementById("ctrl-timelog-task-select");
  const ctrlTimelogActTitle = document.getElementById("ctrl-timelog-act-title");
  const ctrlTimelogActSub = document.getElementById("ctrl-timelog-act-sub");
  const ctrlTimelogActStatusBadge = document.getElementById("ctrl-timelog-act-status-badge");
  const ctrlTimelogKpiTotalTime = document.getElementById("ctrl-timelog-kpi-total-time");
  const ctrlTimelogKpiSessions = document.getElementById("ctrl-timelog-kpi-sessions");
  const ctrlTimelogKpiContributors = document.getElementById("ctrl-timelog-kpi-contributors");
  const ctrlTimelogContributorsContainer = document.getElementById("ctrl-timelog-contributors-container");
  const ctrlTimelogSessionsContainer = document.getElementById("ctrl-timelog-sessions-container");

  /**
 * Main render dispatcher for Section 5 Control Project (Operational Tracking, S-Curve, EVM).
 */
async function renderControlScheduleView() {
    if (!project) return;
    const projId = (project && (project.id || project._id)) || projectId;
    const dateVal = ctrlStatusDate && ctrlStatusDate.value ? ctrlStatusDate.value : null;

    try {
      const res = await fetchControlSchedule(projId, dateVal);
      if (res.error || !res.data) {
        showCtrlAlert(res.error || "Failed to load control schedule model.", "danger");
        return;
      }

      currentControlModel = res.data;
      if (ctrlStatusDate && !ctrlStatusDate.value && currentControlModel.status_date) {
        ctrlStatusDate.value = currentControlModel.status_date;
      }

      renderControlKpis(currentControlModel.kpis);
      renderControlNetworkDiagram();
      renderControlScurve(currentControlModel.s_curve);
      renderControlTasksTable();

      if (!isControlInitialized) {
        setupControlEventListeners();
        isControlInitialized = true;
      }
    } catch (err) {
      showCtrlAlert("Error loading Control Schedule: " + err.message, "danger");
    }
  }

  /**
 * Displays a transient notification alert in the Control Project view.
 */
function showCtrlAlert(msg, type = "success") {
    showTransientAlert(ctrlAlertMsg, msg, type, 3500);
  }


  /**
 * Renders operational execution KPIs (SPI, SV, Completed, Verified) in Section 5.
 */
function renderControlKpis(kpis) {
    if (!kpis) return;

    // 1. Overall Health Badge & Summary Card
    if (ctrlHealthBadge && ctrlCardHealth) {
      if (kpis.health_status === "ON_SCHEDULE") {
        ctrlCardHealth.style.borderLeftColor = "#10B981";
        ctrlHealthBadge.style.background = "#D1FAE5";
        ctrlHealthBadge.style.color = "#065F46";
        ctrlHealthBadge.style.borderColor = "#10B981";
        ctrlHealthBadge.textContent = "● On Schedule";
        if (ctrlHealthSub) ctrlHealthSub.textContent = "Within acceptable float tolerances";
      } else if (kpis.health_status === "CAUTION") {
        ctrlCardHealth.style.borderLeftColor = "#F59E0B";
        ctrlHealthBadge.style.background = "#FEF3C7";
        ctrlHealthBadge.style.color = "#92400E";
        ctrlHealthBadge.style.borderColor = "#F59E0B";
        ctrlHealthBadge.textContent = "⚠️ Schedule Slippage Warning";
        if (ctrlHealthSub) ctrlHealthSub.textContent = "Work velocity lagging planned early dates";
      } else {
        ctrlCardHealth.style.borderLeftColor = "#EF4444";
        ctrlHealthBadge.style.background = "#FEE2E2";
        ctrlHealthBadge.style.color = "#991B1B";
        ctrlHealthBadge.style.borderColor = "#EF4444";
        ctrlHealthBadge.textContent = "🚨 Critical Schedule Delay";
        if (ctrlHealthSub) ctrlHealthSub.textContent = "Contract deadline or critical path threatened";
      }
    }

    // 2. SPI & SV
    if (ctrlKpiSpi) {
      ctrlKpiSpi.textContent = kpis.spi.toFixed(2);
      ctrlKpiSpi.style.color = kpis.spi >= 1.0 ? "#16A34A" : (kpis.spi >= 0.90 ? "#D97706" : "#DC2626");
    }
    if (ctrlSpiDesc) {
      const spiDiff = ((kpis.spi - 1.0) * 100).toFixed(1);
      ctrlSpiDesc.textContent = kpis.spi >= 1.0 ? `+${spiDiff}% Ahead of target velocity` : `${spiDiff}% Velocity deficit`;
    }

    if (ctrlKpiSv) {
      const sv = kpis.schedule_variance_days;
      ctrlKpiSv.textContent = sv >= 0 ? `+${sv.toFixed(1)} d` : `${sv.toFixed(1)} d`;
      ctrlKpiSv.style.color = sv >= 0 ? "#16A34A" : (sv >= -30 ? "#D97706" : "#DC2626");
    }

    // 3. Cumulative Progress %
    if (ctrlKpiEvPct) {
      ctrlKpiEvPct.textContent = `${kpis.cumulative_ev_pct}%`;
    }
    if (ctrlKpiPvPct) {
      ctrlKpiPvPct.textContent = `Planned: ${kpis.cumulative_pv_pct}% at status date`;
    }

    // 4. Forecast Finish & Slippage
    if (ctrlKpiForecastDate) {
      ctrlKpiForecastDate.textContent = kpis.forecast_finish_date;
    }
    if (ctrlKpiSlippageSub) {
      const slip = kpis.projected_slippage_days;
      ctrlKpiSlippageSub.textContent = slip <= 0 ? `On-time or ${Math.abs(slip).toFixed(0)}d early` : `⚠️ ${slip.toFixed(0)}d Projected Slippage`;
      ctrlKpiSlippageSub.style.color = slip <= 0 ? "#16A34A" : "#DC2626";
    }

    // 5. Leading Indicators Group
    if (ctrlLeadEacDays) {
      ctrlLeadEacDays.textContent = `${kpis.eac_forecast_days.toLocaleString()} days`;
    }
    if (ctrlLeadCpSlippage) {
      if (kpis.critical_path_slippage_days <= 0) {
        ctrlLeadCpSlippage.textContent = "0.0 d (Critical Path Fully Preserved)";
        ctrlLeadCpSlippage.style.color = "#16A34A";
      } else {
        ctrlLeadCpSlippage.textContent = `⚠️ ${kpis.critical_path_slippage_days.toFixed(1)} d critical path slippage`;
        ctrlLeadCpSlippage.style.color = "#DC2626";
      }
    }
    if (ctrlLeadSpiVelocity) {
      ctrlLeadSpiVelocity.textContent = `${kpis.spi.toFixed(2)}x (${kpis.spi >= 1.0 ? 'Ahead of Schedule' : 'Lagging Plan'})`;
    }
    if (ctrlLeadPfRem) {
      const pfRem = kpis.project_float_remaining_days;
      ctrlLeadPfRem.textContent = pfRem >= 0 ? `+${pfRem.toFixed(1)} days contingency` : `${pfRem.toFixed(1)} days buffer deficit`;
      ctrlLeadPfRem.style.color = pfRem >= 0 ? "#2563EB" : "#DC2626";
    }

    // 6. Lagging Indicators & 4 Status Distribution (White, Yellow, Green, Blue)
    const counts = kpis.status_counts || {};
    if (ctrlCountNotStarted) {
      ctrlCountNotStarted.textContent = `${counts.not_started || 0} (${counts.not_started_pct || 0}%)`;
    }
    if (ctrlCountInProgress) {
      ctrlCountInProgress.textContent = `${counts.in_progress || 0} (${counts.in_progress_pct || 0}%)`;
    }
    if (ctrlCountCompleted) {
      ctrlCountCompleted.textContent = `${counts.completed || 0} (${counts.completed_pct || 0}%)`;
    }
    if (ctrlCountVerified) {
      ctrlCountVerified.textContent = `${counts.verified || 0} (${counts.verified_pct || 0}%)`;
    }

    if (ctrlBarNotStarted) ctrlBarNotStarted.style.width = `${counts.not_started_pct || 0}%`;
    if (ctrlBarInProgress) ctrlBarInProgress.style.width = `${counts.in_progress_pct || 0}%`;
    if (ctrlBarCompleted) ctrlBarCompleted.style.width = `${counts.completed_pct || 0}%`;
    if (ctrlBarVerified) ctrlBarVerified.style.width = `${counts.verified_pct || 0}%`;

    if (ctrlLagEvEffort) ctrlLagEvEffort.textContent = `${kpis.total_earned_effort_days.toLocaleString()} d`;
    if (ctrlLagPvEffort) ctrlLagPvEffort.textContent = `${((kpis.cumulative_pv_pct / 100) * kpis.total_planned_effort_days).toFixed(1)} d`;
    if (ctrlLagTotalEffort) ctrlLagTotalEffort.textContent = `${kpis.total_planned_effort_days.toLocaleString()} d`;
  }

  //  S-Curve Rendering (Chart.js with Resilient SVG Fallback) ─
  /**
 * Renders PMBOK S-Curve progression chart with Early, Late, Actual, and Forecast curves.
 */
function renderControlScurve(scurveData) {
    if (!scurveData || !scurveData.points || scurveData.points.length === 0) return;

    const points = scurveData.points;
    const labels = points.map(p => `Day ${Math.round(p.day)} (${p.date})`);
    const earlyData = points.map(p => p.pv_early_pct);
    const lateData = points.map(p => p.pv_late_pct);
    const actualData = points.map(p => p.actual_ev_pct);
    const forecastData = points.map(p => p.forecast_pct);

    if (typeof Chart !== "undefined" && ctrlScurveCanvas) {
      if (ctrlScurveSvg) ctrlScurveSvg.style.display = "none";
      ctrlScurveCanvas.style.display = "block";

      if (scurveChartInstance) {
        scurveChartInstance.destroy();
      }

      const ctx = ctrlScurveCanvas.getContext("2d");
      scurveChartInstance = new Chart(ctx, {
        type: "line",
        data: {
          labels: labels,
          datasets: [
            {
              label: "Early Dates Curve (PV Early)",
              data: earlyData,
              borderColor: "#2563EB",
              backgroundColor: "rgba(37, 99, 235, 0.08)",
              borderWidth: 2.5,
              tension: 0.28,
              pointRadius: 0,
              pointHoverRadius: 5,
              fill: false
            },
            {
              label: "Late Dates Curve (PV Late)",
              data: lateData,
              borderColor: "#EA580C",
              backgroundColor: "rgba(37, 99, 235, 0.08)",
              borderWidth: 2.5,
              tension: 0.28,
              pointRadius: 0,
              pointHoverRadius: 5,
              fill: "-1" // Fills the Banana Envelope between Early and Late!
            },
            {
              label: "Actual Progress (EV)",
              data: actualData,
              borderColor: "#16A34A",
              backgroundColor: "#22C55E",
              borderWidth: 3.5,
              tension: 0.2,
              pointRadius: 4,
              pointHoverRadius: 6,
              fill: false
            },
            {
              label: "Forecast Trajectory",
              data: forecastData,
              borderColor: "#9333EA",
              backgroundColor: "transparent",
              borderWidth: 2,
              borderDash: [6, 6],
              tension: 0.1,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: "index",
            intersect: false
          },
          plugins: {
            legend: {
              display: false // Using our custom legend pills for cleaner UI
            },
            tooltip: {
              backgroundColor: "#1E293B",
              padding: 10,
              callbacks: {
                label: function(context) {
                  let val = context.parsed.y;
                  if (val === null || val === undefined) return null;
                  return `${context.dataset.label}: ${val.toFixed(1)}%`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: "#F1F5F9" },
              ticks: { maxTicksLimit: 9, font: { size: 10 } }
            },
            y: {
              min: 0,
              max: 100,
              grid: { color: "#E2E8F0" },
              ticks: {
                callback: function(value) { return value + "%"; },
                stepSize: 20,
                font: { size: 11, weight: "bold" }
              },
              title: {
                display: true,
                text: "Cumulative Progress (%)",
                font: { size: 11, weight: "bold" }
              }
            }
          }
        }
      });
    } else {
      // SVG Fallback renderer
      renderScurveSvg(points, scurveData.status_day);
    }
  }

  /**
 * Generates SVG graph markup for the PMBOK cumulative S-Curve.
 */
function renderScurveSvg(points, statusDay) {
    if (!ctrlScurveSvg) return;
    if (ctrlScurveCanvas) ctrlScurveCanvas.style.display = "none";
    ctrlScurveSvg.style.display = "block";

    const width = 860;
    const height = 340;
    const padding = { top: 20, right: 30, bottom: 40, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxDay = points[points.length - 1].day || 1750;

    /**
     * Maps project day offset to SVG X coordinate.
     */
    function getX(d) { return padding.left + (d / maxDay) * chartW; }

    /**
     * Maps percentage completion to SVG Y coordinate.
     */
    function getY(pct) { return padding.top + chartH - ((pct || 0) / 100) * chartH; }

    let earlyPath = "";
    let latePath = "";
    let actualPath = "";
    let forecastPath = "";

    points.forEach((p, i) => {
      const x = getX(p.day);
      const ye = getY(p.pv_early_pct);
      const yl = getY(p.pv_late_pct);
      earlyPath += (i === 0 ? `M ${x} ${ye}` : ` L ${x} ${ye}`);
      latePath += (i === 0 ? `M ${x} ${yl}` : ` L ${x} ${yl}`);

      if (p.actual_ev_pct !== null && p.actual_ev_pct !== undefined) {
        const ya = getY(p.actual_ev_pct);
        actualPath += (actualPath === "" ? `M ${x} ${ya}` : ` L ${x} ${ya}`);
      }
      if (p.forecast_pct !== null && p.forecast_pct !== undefined) {
        const yf = getY(p.forecast_pct);
        forecastPath += (forecastPath === "" ? `M ${x} ${yf}` : ` L ${x} ${yf}`);
      }
    });

    let svgHtml = `
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%; font-family: sans-serif;">
        <!-- Grid lines -->
        ${[0, 20, 40, 60, 80, 100].map(pct => {
          const y = getY(pct);
          return `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
            <text x="${padding.left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#64748B">${pct}%</text>
          `;
        }).join('')}

        <!-- Early Curve -->
        <path d="${earlyPath}" fill="none" stroke="#2563EB" stroke-width="2.5" />
        <!-- Late Curve -->
        <path d="${latePath}" fill="none" stroke="#EA580C" stroke-width="2.5" />
        <!-- Forecast Trajectory -->
        ${forecastPath ? `<path d="${forecastPath}" fill="none" stroke="#9333EA" stroke-width="2" stroke-dasharray="6,6" />` : ''}
        <!-- Actual EV Curve -->
        ${actualPath ? `<path d="${actualPath}" fill="none" stroke="#16A34A" stroke-width="3.5" />` : ''}

        <!-- Status Date Vertical Line -->
        ${statusDay ? `
          <line x1="${getX(statusDay)}" y1="${padding.top}" x2="${getX(statusDay)}" y2="${height - padding.bottom}" stroke="#DC2626" stroke-width="1.5" stroke-dasharray="4,4" />
          <text x="${getX(statusDay)}" y="${padding.top - 5}" font-size="10" font-weight="bold" fill="#DC2626" text-anchor="middle">Status Date</text>
        ` : ''}

        <!-- X-axis baseline -->
        <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#94A3B8" stroke-width="1.5" />
        <text x="${padding.left}" y="${height - 12}" font-size="11" fill="#64748B">Day 0</text>
        <text x="${width - padding.right}" y="${height - 12}" font-size="11" text-anchor="end" fill="#64748B">Day ${Math.round(maxDay)}</text>
      </svg>
    `;
    ctrlScurveSvg.innerHTML = svgHtml;
  }

  //  Activity Execution Network Diagram (4-Color Status) ─
  /**
 * Renders 4-tier task execution network graph (White, Yellow, Green, Blue).
 */
function renderControlNetworkDiagram() {
    if (!ctrlPdmCanvas || !currentControlModel) return;

    if (typeof vis === "undefined" || !vis.Network) {
      ctrlPdmCanvas.innerHTML = `
        <div style="padding: 2.5rem; text-align: center; color: var(--danger);">
          Visualization library (vis-network) failed to load.
        </div>
      `;
      return;
    }

    const rawActivities = currentControlModel.activities || [];
    const rawDependencies = currentControlModel.dependencies || (project && project.dependencies) || [];
    const filterMode = ctrlPdmFilterMode ? ctrlPdmFilterMode.value : "all";

    // Filter activities if needed
    const visibleActivities = rawActivities.filter(a => {
      if (filterMode === "all") return true;
      if (filterMode === "critical") return Boolean(a.is_critical);
      return a.status === filterMode;
    });

    const visibleActIds = new Set(visibleActivities.map(a => a.activity_id));

    // Construct vis-network nodes
    const nodes = [];
    visibleActivities.forEach(act => {
      const actId = act.activity_id;
      const progress = act.progress_pct !== undefined ? act.progress_pct : 0;
      const sv = act.sv_days !== undefined ? act.sv_days : 0;
      const shortName = act.name && act.name.length > 25 ? act.name.substring(0, 23) + "..." : (act.name || "Activity");

      // PMBOK Execution Colors specified by user:
      // White: Not started
      // Yellow: WIP (Work in Progress)
      // Green: Completed
      // Blue: Completed & Verified by Controller
      const isMilestone = Boolean(act.is_milestone || act.duration === 0);
      let bgColor = "#FFFFFF";
      let borderColor = "#64748B";
      let textColor = "#1E293B";
      let borderWidth = 2;
      let statusIcon = "⚪";
      let statusLabel = "Not Started";
      let shapeType = isMilestone ? "diamond" : "box";

      if (act.status === "in_progress") {
        bgColor = "#FEF08A";
        borderColor = "#CA8A04";
        textColor = "#713F12";
        borderWidth = 2.5;
        statusIcon = "🟡";
        statusLabel = "WIP";
      } else if (act.status === "completed") {
        bgColor = "#DCFCE7";
        borderColor = "#16A34A";
        textColor = "#14532D";
        borderWidth = 2.5;
        statusIcon = "🟢";
        statusLabel = "Completed";
      } else if (act.status === "verified") {
        bgColor = "#DBEAFE";
        borderColor = "#2563EB";
        textColor = "#1E40AF";
        borderWidth = 3;
        statusIcon = "🔵";
        statusLabel = "Verified";
      } else if (isMilestone) {
        bgColor = "#EDE9FE";
        borderColor = "#7C3AED";
        textColor = "#5B21B6";
      }

      // Box node label
      const svStr = sv >= 0 ? `+${sv.toFixed(1)}d` : `${sv.toFixed(1)}d`;
      const mPrefix = isMilestone ? "◆ " : "";
      const planStr = isMilestone ? "Milestone (0d)" : `Plan: ${act.duration.toFixed(0)}d`;
      const nodeLabel = `${statusIcon} ${mPrefix}[${actId}]\n${shortName}\n${statusLabel}\n${planStr} | SV: ${svStr}`;

      // Box tooltip
      const tooltip = `Activity: ${actId} ${isMilestone ? '(Milestone)' : ''}
Name: ${act.name}
Work Package: ${act.work_package_id || 'N/A'}
Status: ${statusLabel} (${progress.toFixed(0)}%)
Planned: ${act.planned_start_date || '-'} ➔ ${act.planned_finish_date || '-'}
Actual: ${act.actual_start_date || 'Not Started'} ➔ ${act.actual_finish_date || 'Ongoing'}
Duration: ${act.duration.toFixed(1)}d | EV: ${act.ev_days.toFixed(1)}d | SV: ${svStr}
Controller Sign-off: ${act.status === 'verified' ? (act.verified_by || 'Verified') : 'Pending'}
${act.is_critical ? '🔥 CRITICAL PATH ACTIVITY' : (act.is_near_critical ? '⚠️ NEAR-CRITICAL' : '')}
(Click node to update execution status & sign-off)`;

      nodes.push({
        id: actId,
        label: nodeLabel,
        title: tooltip,
        color: {
          background: bgColor,
          border: borderColor,
          highlight: {
            background: bgColor,
            border: act.is_critical ? "#DC2626" : "#2563EB"
          }
        },
        font: {
          color: textColor,
          size: 11,
          bold: true,
          face: "Inter, Segoe UI, sans-serif"
        },
        shape: shapeType,
        borderWidth: borderWidth,
        margin: 10,
        shadow: act.is_critical ? {
          enabled: true,
          color: "rgba(239, 68, 68, 0.4)",
          size: 8,
          x: 0,
          y: 0
        } : {
          enabled: true,
          color: "rgba(0, 0, 0, 0.06)",
          size: 4,
          x: 2,
          y: 2
        }
      });
    });

    // Construct vis-network edges
    const edges = [];
    rawDependencies.forEach(dep => {
      const fromId = dep.from_activity_id || dep.from;
      const toId = dep.to_activity_id || dep.to;

      if (visibleActIds.has(fromId) && visibleActIds.has(toId)) {
        let depType = dep.type || "FS";
        if (depType.includes("(") && depType.includes(")")) {
          depType = depType.split("(")[1].replace(")", "").trim();
        } else {
          depType = depType.trim().toUpperCase();
        }

        const lag = parseFloat(dep.lag_days || 0);
        let edgeColor = "#3B82F6";
        let dashes = false;

        if (depType === "SS") {
          edgeColor = "#7C3AED";
        } else if (depType === "FF") {
          edgeColor = "#0891B2";
        } else if (depType === "SF") {
          edgeColor = "#DC2626";
          dashes = [5, 5];
        }

        let edgeLabel = depType;
        if (lag > 0) edgeLabel = `${depType} +${lag}d`;

        edges.push({
          from: fromId,
          to: toId,
          label: ` ${edgeLabel} `,
          font: {
            color: edgeColor,
            size: 10,
            bold: true,
            align: "horizontal",
            background: "#FFFFFF",
            strokeWidth: 0
          },
          color: { color: edgeColor, highlight: "#2563EB" },
          width: depType === "SF" ? 2.5 : 2,
          dashes: dashes,
          arrows: { to: { enabled: true, scaleFactor: 0.85 } }
        });
      }
    });

    const data = {
      nodes: new vis.DataSet(nodes),
      edges: new vis.DataSet(edges)
    };

    const options = {
      layout: {
        hierarchical: {
          enabled: edges.length > 0,
          direction: "LR",
          sortMethod: "directed",
          levelSeparation: 260,
          nodeSpacing: 110,
          treeSpacing: 160
        }
      },
      physics: false,
      nodes: {
        margin: 10,
        widthConstraint: { minimum: 150, maximum: 220 }
      },
      edges: {
        smooth: { type: "cubicBezier", forceDirection: "horizontal", roundness: 0.3 }
      },
      interaction: {
        hover: true,
        zoomView: true,
        dragView: true,
        selectable: true
      }
    };

    if (ctrlNetworkInstance) {
      try {
        ctrlNetworkInstance.destroy();
      } catch (e) {
        // ignore
      }
      ctrlNetworkInstance = null;
    }

    ctrlPdmCanvas.innerHTML = "";
    ctrlNetworkInstance = new vis.Network(ctrlPdmCanvas, data, options);
    ctrlPdmCanvas._visNetwork = ctrlNetworkInstance;
    if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
    window.SyncFlowNetworks["ctrl-pdm-network-canvas"] = ctrlNetworkInstance;

    // Node click handler: opens execution update modal
    ctrlNetworkInstance.on("click", (params) => {
      if (params.nodes && params.nodes.length > 0) {
        const clickedId = params.nodes[0];
        const act = rawActivities.find(a => a.activity_id === clickedId);
        if (act) {
          openActivityStatusModal(act);
        }
      }
    });
  }

  //  Task Operational Execution & Verification Table ─
  /**
 * Renders operational tasks table with inline status toggles and time tracker inspector.
 */
function renderControlTasksTable() {
    if (!ctrlTasksTableContainer || !currentControlModel) return;

    const rawActivities = currentControlModel.activities || [];
    const statusFilter = ctrlFilterStatus ? ctrlFilterStatus.value : "all";
    const critFilter = ctrlFilterCritical ? ctrlFilterCritical.value : "all";
    const searchVal = ctrlFilterSearch ? ctrlFilterSearch.value.trim().toLowerCase() : "";

    const filtered = rawActivities.filter(a => {
      // 1. Status Filter (4 PMBOK categories)
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      // 2. Critical Path Filter
      if (critFilter === "critical" && !a.is_critical) return false;
      if (critFilter === "near_critical" && !a.is_near_critical) return false;
      if (critFilter === "flexible" && (a.is_critical || a.is_near_critical)) return false;
      // 3. Search Query
      if (searchVal) {
        const text = `${a.activity_id} ${a.name} ${a.work_package_id || ''} ${a.verified_by || ''}`.toLowerCase();
        if (!text.includes(searchVal)) return false;
      }
      return true;
    });

    if (ctrlFilterCount) {
      ctrlFilterCount.textContent = filtered.length;
    }

    if (filtered.length === 0) {
      ctrlTasksTableContainer.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--muted);">
          <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔍</div>
          <h4>No activities match the current filters.</h4>
          <p style="font-size: 0.88rem;">Adjust your status or critical path criteria above.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table class="table" style="font-size: 0.85rem; width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #F8FAFC; border-bottom: 2px solid var(--border);">
            <th style="padding: 10px 8px; text-align: left;">Execution Status</th>
            <th style="padding: 10px 8px; text-align: left;">Activity ID &amp; Name</th>
            <th style="padding: 10px 8px; text-align: center;">CPM Path</th>
            <th style="padding: 10px 8px; text-align: right;">Planned Dates</th>
            <th style="padding: 10px 8px; text-align: right;">Actual Dates</th>
            <th style="padding: 10px 8px; width: 140px;">Completion %</th>
            <th style="padding: 10px 8px; text-align: right;">EV / PV</th>
            <th style="padding: 10px 8px; text-align: right;">Variance (SV)</th>
            <th style="padding: 10px 8px;">Controller Sign-off</th>
            <th style="padding: 10px 8px; text-align: center;">Operational Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    filtered.forEach(a => {
      // Exact 4 status colors specified by prompt:
      // White: Not started
      // Yellow: Work-in-progress (begun)
      // Green: Completed
      // Blue: Completed & Verified by Controller
      let statusPillClass = "status-pill-not-started";
      let statusIcon = "⚪";
      let statusText = "Not Started";

      if (a.status === "in_progress") {
        statusPillClass = "status-pill-in-progress";
        statusIcon = "🟡";
        statusText = "Work-in-Progress";
      } else if (a.status === "completed") {
        statusPillClass = "status-pill-completed";
        statusIcon = "🟢";
        statusText = "Completed";
      } else if (a.status === "verified") {
        statusPillClass = "status-pill-verified";
        statusIcon = "🔵";
        statusText = "Completed & Verified";
      }

      const cpBadge = a.is_critical 
        ? `<span class="badge" style="background: #FEE2E2; color: #DC2626; border: 1px solid #FCA5A5; font-size: 0.7rem;">🔥 Critical</span>`
        : (a.is_near_critical 
            ? `<span class="badge" style="background: #FEF3C7; color: #D97706; border: 1px solid #FCD34D; font-size: 0.7rem;">⚠️ Near-Crit</span>` 
            : `<span class="badge" style="background: #EFF6FF; color: #2563EB; border: 1px solid #BFDBFE; font-size: 0.7rem;">Flexible</span>`);

      const svColor = a.sv_days >= 0 ? "#16A34A" : (a.sv_days >= -10 ? "#D97706" : "#DC2626");

      html += renderControlTaskRowHtml(a, statusPillClass, statusIcon, statusText, cpBadge, svColor);
    });

    html += `
        </tbody>
      </table>
    `;

    ctrlTasksTableContainer.innerHTML = html;

    // Attach inline status select change listeners
    ctrlTasksTableContainer.querySelectorAll(".ctrl-row-status-select").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        const actId = e.target.getAttribute("data-act-id");
        const newStatus = e.target.value;
        const projId = (project && (project.id || project._id)) || projectId;
        if (!projId || !actId) return;

        sel.disabled = true;
        try {
          const res = await updateActivityStatus(projId, actId, { status: newStatus });
          if (res.error) {
            showCtrlAlert("Failed to update status: " + res.error, "danger");
          } else {
            showCtrlAlert(`Updated ${actId} to ${newStatus.replace('_', ' ')} successfully!`, "success");
            currentControlModel = res.data;
            renderControlKpis(currentControlModel.kpis);
            renderControlNetworkDiagram();
            renderControlScurve(currentControlModel.s_curve);
            renderControlTasksTable();
          }
        } catch (err) {
          showCtrlAlert("Error updating status: " + err.message, "danger");
        } finally {
          sel.disabled = false;
        }
      });
    });

    // Attach Edit Details modal buttons
    ctrlTasksTableContainer.querySelectorAll(".btn-edit-act-ctrl").forEach(btn => {
      btn.addEventListener("click", () => {
        const actId = btn.getAttribute("data-act-id");
        const act = rawActivities.find(x => x.activity_id === actId);
        if (!act) return;
        openActivityStatusModal(act);
      });
    });

    // Attach Time Logs modal buttons
    ctrlTasksTableContainer.querySelectorAll(".btn-view-act-timelogs").forEach(btn => {
      btn.addEventListener("click", () => {
        const actId = btn.getAttribute("data-act-id");
        if (!actId) return;
        openControlTimeLogsModal(actId);
      });
    });
  }

  //  PMBOK Execution Kanban Board ─
  /**
 * Renders 4-state operational Kanban board for real-time task progression.
 */
function renderControlKanbanBoard() {
    const kanbanContainer = document.getElementById("ctrl-kanban-board-container");
    if (!kanbanContainer || !currentControlModel) return;

    const activities = currentControlModel.activities || [];
    const cols = {
      not_started: { title: "⚪ Not Started", class: "kanban-col-not-started", acts: [] },
      in_progress: { title: "🟡 Work-in-Progress", class: "kanban-col-in-progress", acts: [] },
      completed:   { title: "🟢 Completed (Pending Review)", class: "kanban-col-completed", acts: [] },
      verified:    { title: "🔵 Controlled & Verified", class: "kanban-col-verified", acts: [] }
    };

    activities.forEach(a => {
      const st = a.status || "not_started";
      if (cols[st]) cols[st].acts.push(a);
      else cols["not_started"].acts.push(a);
    });

    let boardHtml = `<div class="kanban-board">`;
    for (const [key, col] of Object.entries(cols)) {
      boardHtml += `
        <div class="kanban-column">
          <div class="kanban-column-header ${col.class}">
            <span>${col.title}</span>
            <span class="kanban-col-count">${col.acts.length}</span>
          </div>
          <div class="kanban-column-body" data-status="${key}">
      `;

      if (col.acts.length === 0) {
        boardHtml += `<div style="text-align: center; color: var(--muted); font-size: 0.8rem; padding: 2rem 0.5rem;">No tasks</div>`;
      } else {
        col.acts.forEach(a => {
          const isMilestone = Boolean(a.is_milestone || a.duration === 0);
          const sv = a.sv_days !== undefined ? a.sv_days : 0;
          const svStr = sv >= 0 ? `+${sv.toFixed(1)}d` : `${sv.toFixed(1)}d`;
          const svColor = sv >= 0 ? "#16A34A" : "#DC2626";

          boardHtml += `
            <div class="kanban-card status-${key}" data-act-id="${a.activity_id}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                <code style="font-weight: 700; font-size: 0.78rem; color: ${isMilestone ? '#7C3AED' : 'inherit'};">
                  ${isMilestone ? '◆ ' : ''}${a.activity_id}
                </code>
                ${a.is_critical ? `<span class="badge-critical" style="font-size: 0.68rem; padding: 1px 5px;">🔥 CP</span>` : ''}
              </div>
              <div class="kanban-card-title">${a.name}</div>
              <div style="font-size: 0.75rem; color: var(--muted);">WP: ${a.work_package_id || 'N/A'}</div>

              ${a.completion_proof ? `
                <div style="margin-top: 6px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 4px 6px; font-size: 0.72rem; color: #475569; display: flex; align-items: center; gap: 4px;">
                  <span>📝</span> <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${a.completion_proof}</span>
                </div>
              ` : ''}

              <div class="kanban-card-meta">
                <span>⏱️ ${isMilestone ? '0d (Milestone)' : `${a.duration}d`}</span>
                <span style="font-weight: 700; color: ${svColor};">SV: ${svStr}</span>
              </div>
            </div>
          `;
        });
      }

      boardHtml += `
          </div>
        </div>
      `;
    }
    boardHtml += `</div>`;

    kanbanContainer.innerHTML = boardHtml;

    // Attach card click handlers
    kanbanContainer.querySelectorAll(".kanban-card").forEach(card => {
      card.addEventListener("click", () => {
        const aid = card.getAttribute("data-act-id");
        const act = activities.find(x => x.activity_id === aid);
        if (act) openActivityStatusModal(act);
      });
    });
  }

  //  Open Modal for Detailed Execution & Controller Verification ─
  /**
 * Opens detailed activity status update and controller verification sign-off modal.
 */
function openActivityStatusModal(act) {
    if (!ctrlActivityModal) return;

    ctrlModalActId.value = act.activity_id;
    ctrlModalTitle.textContent = `✏️ Activity Execution: ${act.activity_id}`;
    ctrlModalSub.textContent = `${act.name} (WP: ${act.work_package_id || "-"})`;

    ctrlModalStatus.value = act.status || "not_started";
    ctrlModalProgress.value = act.progress_pct || 0;
    ctrlModalProgVal.textContent = `${(act.progress_pct || 0).toFixed(0)}%`;

    ctrlModalActStart.value = act.actual_start_date || "";
    ctrlModalActFinish.value = act.actual_finish_date || "";
    ctrlModalVerifiedBy.value = act.verified_by || "";
    ctrlModalNotes.value = act.notes || "";

    const proofInput = document.getElementById("ctrl-modal-completion-proof");
    if (proofInput) proofInput.value = act.completion_proof || "";

    // Render structured verification checklist
    const checklistContainer = document.getElementById("ctrl-modal-checklist-container");
    const warningEl = document.getElementById("ctrl-modal-checklist-warning");
    if (warningEl) warningEl.style.display = "none";

    if (checklistContainer) {
      const savedChecklist = act.verification_checklist || [];
      const savedMap = {};
      savedChecklist.forEach(item => { savedMap[item.id] = Boolean(item.checked); });

      let chkHtml = "";
      CONTROLLER_CHECKLIST.forEach((crit) => {
        const isChecked = savedMap[crit.id] !== undefined ? savedMap[crit.id] : (act.status === "verified");
        chkHtml += `
          <label class="checklist-item">
            <input type="checkbox" class="ctrl-chk-item" data-id="${crit.id}" ${isChecked ? "checked" : ""}>
            <span>${crit.text}</span>
          </label>
        `;
      });
      checklistContainer.innerHTML = chkHtml;
    }

    toggleModalVerifyGroup(ctrlModalStatus.value);
    ctrlActivityModal.style.display = "flex";
  }

  /**
 * Toggles visibility of controller verification fields based on chosen activity status.
 */
function toggleModalVerifyGroup(status) {
    if (ctrlModalVerifyGroup) {
      ctrlModalVerifyGroup.style.display = status === "verified" ? "block" : "none";
    }
    const proofGroup = document.getElementById("ctrl-modal-proof-group");
    if (proofGroup) {
      proofGroup.style.display = (status === "completed" || status === "verified") ? "block" : "none";
    }
    if (ctrlModalProgGroup) {
      ctrlModalProgGroup.style.display = (status === "not_started" || status === "completed" || status === "verified") ? "none" : "block";
    }
  }

  //  PM Control Time Logs Modal Controller 
  /**
 * Opens PM Time Logs Audit modal to inspect time spent and contributor breakdown by task.
 */
async function openControlTimeLogsModal(activityId = null) {
    if (!ctrlTimeLogsModal || !currentControlModel) return;
    const activities = currentControlModel.activities || [];
    if (activities.length === 0) {
      alert("No activities found in the project schedule.");
      return;
    }

    // Populate dropdown with ALL tasks (whether completed, under review, or in progress or not started)
    ctrlTimelogTaskSelect.innerHTML = activities.map(a => {
      const statusIcon = a.status === 'verified' ? '🔵 Verified' : (a.status === 'completed' ? '🟢 Completed' : (a.status === 'in_progress' ? '🟡 In Progress' : '⚪ Not Started'));
      const timeStr = a.total_logged_seconds ? ` (${formatDurationSeconds(a.total_logged_seconds)})` : '';
      return `<option value="${a.activity_id}">[${a.activity_id}] ${escapeHtml(a.name)} — ${statusIcon}${timeStr}</option>`;
    }).join("");

    const targetId = activityId || activities[0].activity_id;
    ctrlTimelogTaskSelect.value = targetId;

    await loadTaskTimeLogs(targetId);
    ctrlTimeLogsModal.style.display = "flex";
  }

  /**
 * Loads and displays logged sessions and contributor breakdown for a specific task.
 */
async function loadTaskTimeLogs(actId) {
    if (!currentControlModel) return;
    const activities = currentControlModel.activities || [];
    const act = activities.find(a => a.activity_id === actId);
    if (!act) return;

    // Set meta banner
    ctrlTimelogActTitle.textContent = `${act.name} (${act.activity_id})`;
    ctrlTimelogActSub.textContent = `WP: ${act.work_package_id || 'N/A'} | Planned Duration: ${act.duration}d | EV: ${act.ev_days.toFixed(1)}d`;
    
    let badgeClass = "badge-gray";
    let badgeText = "⚪ Not Started";
    if (act.status === "in_progress") { badgeClass = "badge-amber"; badgeText = "🟡 Work-in-Progress"; }
    else if (act.status === "completed") { badgeClass = "badge-green"; badgeText = "🟢 Completed (Review)"; }
    else if (act.status === "verified") { badgeClass = "badge-blue"; badgeText = "🔵 Verified & Controlled"; }
    ctrlTimelogActStatusBadge.innerHTML = `<span class="badge ${badgeClass}" style="font-size: 0.82rem; padding: 4px 8px;">${badgeText}</span>`;

    // Loading state for tables
    ctrlTimelogContributorsContainer.innerHTML = `<p style="color: var(--muted); padding: 0.8rem 0; font-size: 0.85rem;">Loading contributor logs...</p>`;
    ctrlTimelogSessionsContainer.innerHTML = `<p style="color: var(--muted); padding: 0.8rem 0; font-size: 0.85rem;">Loading session logs...</p>`;

    const projId = (project && (project.id || project._id)) || projectId;
    const { data, error } = await fetchActivityTimeLogs(projId, actId);

    if (error || !data) {
      ctrlTimelogContributorsContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load time logs: ${error || 'Unknown error'}</div>`;
      ctrlTimelogSessionsContainer.innerHTML = "";
      return;
    }

    const totalSeconds = data.total_logged_seconds || 0;
    const logs = data.time_logs || [];
    const byUser = data.by_user || [];

    // Update KPI cards
    ctrlTimelogKpiTotalTime.textContent = formatDurationSeconds(totalSeconds);
    ctrlTimelogKpiSessions.textContent = logs.length;
    ctrlTimelogKpiContributors.textContent = byUser.length;

    // Render Contributor Breakdown
    if (byUser.length === 0) {
      ctrlTimelogContributorsContainer.innerHTML = `
        <div style="background: #F8FAFC; border: 1px dashed var(--border); border-radius: 4px; padding: 1.2rem; text-align: center; color: var(--muted); font-size: 0.85rem;">
          No contributors have logged time on this task yet.
        </div>
      `;
    } else {
      let contribRows = byUser.map(u => {
        const pct = totalSeconds > 0 ? ((u.total_seconds / totalSeconds) * 100).toFixed(1) : "0.0";
        return `
          <tr style="border-bottom: 1px solid var(--border-light);">
            <td style="padding: 8px; font-weight: 700; color: var(--charcoal);">👤 ${escapeHtml(u.user_name || u.user_id)}</td>
            <td style="padding: 8px; text-align: right; font-family: monospace; font-weight: 700; color: #2563EB;">${formatDurationSeconds(u.total_seconds)}</td>
            <td style="padding: 8px; text-align: center;">${u.session_count} session${u.session_count !== 1 ? 's' : ''}</td>
            <td style="padding: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="flex: 1; height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden;">
                  <div style="width: ${pct}%; height: 100%; background: #2563EB;"></div>
                </div>
                <span style="font-size: 0.76rem; font-weight: 700; min-width: 40px; text-align: right;">${pct}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join("");

      ctrlTimelogContributorsContainer.innerHTML = `
        <table class="table" style="font-size: 0.82rem; width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #F1F5F9; border-bottom: 1px solid var(--border);">
              <th style="padding: 6px 8px; text-align: left;">Team Member</th>
              <th style="padding: 6px 8px; text-align: right;">Total Duration</th>
              <th style="padding: 6px 8px; text-align: center;">Sessions</th>
              <th style="padding: 6px 8px; width: 180px;">Share of Task Time</th>
            </tr>
          </thead>
          <tbody>${contribRows}</tbody>
        </table>
      `;
    }

    // Render Session History
    if (logs.length === 0) {
      ctrlTimelogSessionsContainer.innerHTML = `
        <div style="background: #F8FAFC; border: 1px dashed var(--border); border-radius: 4px; padding: 1.2rem; text-align: center; color: var(--muted); font-size: 0.85rem;">
          No session history recorded yet. Timers logged by team members will appear here chronologically.
        </div>
      `;
    } else {
      let sessionRows = logs.map(l => {
        const dateStr = l.start_time ? new Date(l.start_time).toLocaleString() : (l.created_at || '-');
        return `
          <tr style="border-bottom: 1px solid var(--border-light);">
            <td style="padding: 6px 8px; font-size: 0.78rem; font-family: monospace; color: var(--muted);">${dateStr}</td>
            <td style="padding: 6px 8px; font-weight: 600; color: var(--charcoal);">${escapeHtml(l.user_name || l.user_id)}</td>
            <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 700; color: #16A34A;">${formatDurationSeconds(l.duration_seconds)}</td>
            <td style="padding: 6px 8px; font-size: 0.8rem; color: var(--slate);">${escapeHtml(l.notes || "-")}</td>
          </tr>
        `;
      }).reverse().join("");

      ctrlTimelogSessionsContainer.innerHTML = `
        <table class="table" style="font-size: 0.82rem; width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #F1F5F9; border-bottom: 1px solid var(--border);">
              <th style="padding: 6px 8px; text-align: left;">Logged At</th>
              <th style="padding: 6px 8px; text-align: left;">Team Member</th>
              <th style="padding: 6px 8px; text-align: right;">Duration</th>
              <th style="padding: 6px 8px; text-align: left;">Work Notes</th>
            </tr>
          </thead>
          <tbody>${sessionRows}</tbody>
        </table>
      `;
    }
  }

  //  Setup Control Schedule Event Listeners 
  /**
 * Binds event listeners for Control Project status updates and S-Curve status date changes.
 */
function setupControlEventListeners() {
    // 0. Segmented Sub-Tabs Switching (PDM Network Diagram, Kanban Board, S-Curve, Matrix)
    document.querySelectorAll(".ctrl-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        activeCtrlTab = targetTab;

        document.querySelectorAll(".ctrl-tab-btn").forEach(b => {
          const isActive = b.getAttribute("data-tab") === targetTab;
          b.classList.toggle("active", isActive);
          b.style.fontWeight = isActive ? "700" : "600";
          b.style.color = isActive ? "var(--primary)" : "var(--slate)";
          b.style.borderBottom = isActive ? "3px solid var(--primary)" : "3px solid transparent";
        });

        ["pdm", "kanban", "scurve", "matrix"].forEach(t => {
          const p = document.getElementById(`ctrl-pane-${t}`);
          if (p) p.style.display = targetTab === t ? "block" : "none";
        });

        if (targetTab === "pdm") setTimeout(() => ctrlNetworkInstance?.fit({ animation: true }), 60);
        else if (targetTab === "kanban") renderControlKanbanBoard();
        else if (targetTab === "scurve" && currentControlModel) renderControlScurve(currentControlModel.s_curve);
      });
    });

    // 0b. Collapsible KPI & Status Color Legend Guide
    wireLegendToggle(document.getElementById("btn-toggle-ctrl-legend"), document.getElementById("ctrl-legend-content"), document.getElementById("ctrl-legend-chevron"));

    // 0c. PDM Network Zoom, Fit & Filter Controls
    wireNetworkZoomControls(() => ctrlNetworkInstance, btnCtrlPdmZoomIn, btnCtrlPdmZoomOut, btnCtrlPdmFit);
    if (ctrlPdmFilterMode) ctrlPdmFilterMode.addEventListener("change", () => renderControlNetworkDiagram());

    // 1. Status Date Change & Apply
    if (btnCtrlApplyDate) {
      btnCtrlApplyDate.addEventListener("click", () => renderControlScheduleView());
    }
    if (btnCtrlToday) {
      btnCtrlToday.addEventListener("click", () => {
        if (ctrlStatusDate) {
          ctrlStatusDate.value = new Date().toISOString().split("T")[0];
        }
        renderControlScheduleView();
      });
    }

    // 2. Refresh Button
    if (btnCtrlRefresh) {
      btnCtrlRefresh.addEventListener("click", () => renderControlScheduleView());
    }

    // 3. Seed Realistic Benchmark Progress Button
    if (btnCtrlSeedProgress) {
      btnCtrlSeedProgress.addEventListener("click", async () => {
        if (!confirm("This will initialize a realistic execution progression across the 41 activities (Concept & Vision Verified [Blue], Prototyping Completed [Green], Art & Engine In-Progress [Yellow], downstream Not Started [White]) to demonstrate Control Schedule & S-Curve tracking. Proceed?")) {
          return;
        }

        const projId = (project && (project.id || project._id)) || projectId;
        try {
          const res = await seedProjectProgress(projId);
          if (res.error) {
            showCtrlAlert("Failed to seed progress: " + res.error, "danger");
          } else {
            showCtrlAlert("Realistic benchmark execution progress loaded successfully!", "success");
            currentControlModel = res.data;
            renderControlKpis(currentControlModel.kpis);
            renderControlNetworkDiagram();
            renderControlKanbanBoard();
            renderControlScurve(currentControlModel.s_curve);
            renderControlTasksTable();
          }
        } catch (err) {
          showCtrlAlert("Error seeding progress: " + err.message, "danger");
        }
      });
    }

    // 4. Filters
    if (ctrlFilterSearch) {
      ctrlFilterSearch.addEventListener("input", () => renderControlTasksTable());
    }
    if (ctrlFilterStatus) {
      ctrlFilterStatus.addEventListener("change", () => renderControlTasksTable());
    }
    if (ctrlFilterCritical) {
      ctrlFilterCritical.addEventListener("change", () => renderControlTasksTable());
    }

    // 5. Modal Status & Progress Range Listeners
    if (ctrlModalStatus) {
      ctrlModalStatus.addEventListener("change", (e) => {
        const s = e.target.value;
        toggleModalVerifyGroup(s);
        if (s === "not_started") {
          ctrlModalProgress.value = 0;
          ctrlModalProgVal.textContent = "0%";
        } else if (s === "completed" || s === "verified") {
          ctrlModalProgress.value = 100;
          ctrlModalProgVal.textContent = "100%";
        } else if (s === "in_progress" && (ctrlModalProgress.value === "0" || ctrlModalProgress.value === "100")) {
          ctrlModalProgress.value = 50;
          ctrlModalProgVal.textContent = "50%";
        }
      });
    }

    if (ctrlModalProgress) {
      ctrlModalProgress.addEventListener("input", (e) => {
        if (ctrlModalProgVal) ctrlModalProgVal.textContent = `${e.target.value}%`;
      });
    }

    // 6. Modal Close Buttons
    if (btnCloseCtrlModal) {
      btnCloseCtrlModal.addEventListener("click", () => {
        ctrlActivityModal.style.display = "none";
      });
    }
    if (btnCancelCtrlModal) {
      btnCancelCtrlModal.addEventListener("click", () => {
        ctrlActivityModal.style.display = "none";
      });
    }

    // 7. Modal Form Submit Handler
    if (ctrlActivityForm) {
      ctrlActivityForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const actId = ctrlModalActId.value;
        const projId = (project && (project.id || project._id)) || projectId;
        if (!actId || !projId) return;

        const proofInput = document.getElementById("ctrl-modal-completion-proof");
        const completionProof = proofInput ? proofInput.value.trim() : null;

        // Collect verification checklist
        const checklistItems = [];
        let allChecked = true;
        document.querySelectorAll(".ctrl-chk-item").forEach(chk => {
          const cid = chk.getAttribute("data-id");
          const crit = CONTROLLER_CHECKLIST.find(c => c.id === cid) || { text: cid };
          const isChk = chk.checked;
          if (!isChk) allChecked = false;
          checklistItems.push({ id: cid, text: crit.text, checked: isChk });
        });

        if (ctrlModalStatus.value === "verified" && !allChecked) {
          const warningEl = document.getElementById("ctrl-modal-checklist-warning");
          if (warningEl) warningEl.style.display = "block";
          alert("All verification checklist acceptance criteria must be checked before confirming Controlled status.");
          return;
        }

        const payload = {
          status: ctrlModalStatus.value,
          progress_pct: parseFloat(ctrlModalProgress.value) || 0.0,
          actual_start_date: ctrlModalActStart.value || null,
          actual_finish_date: ctrlModalActFinish.value || null,
          verified_by: ctrlModalVerifiedBy.value.trim() || null,
          notes: ctrlModalNotes.value.trim() || null,
          completion_proof: completionProof,
          verification_checklist: checklistItems
        };

        const submitBtn = document.getElementById("btn-save-ctrl-modal");
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Saving...";
        }

        try {
          const res = await updateActivityStatus(projId, actId, payload);
          if (res.error) {
            showCtrlAlert("Failed to save activity status: " + res.error, "danger");
          } else {
            showCtrlAlert(`Activity ${actId} updated successfully!`, "success");
            ctrlActivityModal.style.display = "none";
            currentControlModel = res.data;
            renderControlKpis(currentControlModel.kpis);
            renderControlNetworkDiagram();
            renderControlKanbanBoard();
            renderControlScurve(currentControlModel.s_curve);
            renderControlTasksTable();
          }
        } catch (err) {
          showCtrlAlert("Error saving status: " + err.message, "danger");
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "💾 Save & Update Schedule Model";
          }
        }
      });
    }

    // 8. Control Time Logs Modal Listeners
    if (btnOpenTimelogsModal) {
      btnOpenTimelogsModal.addEventListener("click", () => openControlTimeLogsModal());
    }
    if (btnCloseCtrlTimelogModal) {
      btnCloseCtrlTimelogModal.addEventListener("click", () => {
        ctrlTimeLogsModal.style.display = "none";
      });
    }
    if (btnCancelCtrlTimelogModal) {
      btnCancelCtrlTimelogModal.addEventListener("click", () => {
        ctrlTimeLogsModal.style.display = "none";
      });
    }
    if (ctrlTimelogTaskSelect) {
      ctrlTimelogTaskSelect.addEventListener("change", (e) => {
        loadTaskTimeLogs(e.target.value);
      });
    }
  }


  // Action Buttons
  btnReturnDashboard.addEventListener("click", () => {
    sessionStorage.removeItem("active_project_id");
    window.location.href = "/project_manager/dashboard.html";
  });

  // Protect against accidental loss of unsaved changes on reload/navigate
  window.addEventListener("beforeunload", (e) => {
    if (typeof hasUnsavedWbsChanges !== "undefined" && hasUnsavedWbsChanges) {
      e.preventDefault();
      e.returnValue = "You have unsaved changes in your Work Breakdown Structure. Are you sure you want to leave?";
      return e.returnValue;
    }
  });

  btnLogout.addEventListener("click", () => {
    logout();
  });

  // Restore remembered view or open initial view (safely after all view components, variables, and listeners are fully initialized)
  const initialView = parseInt(sessionStorage.getItem("syncflow_active_view") || new URLSearchParams(window.location.search).get("view") || "1", 10);
  switchView(initialView);
});



