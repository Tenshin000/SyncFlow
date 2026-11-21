/**
 * SyncFlow Frontend - PM View 1: Plan Schedule Management (pm_view1_plan.js)
 * Implements:
 *  - Project charter scope description editing
 *  - Headcount statistics across teams, contributors, and controllers
 *  - Personnel & Controllers View Modal (read-only roster cards, lead badges)
 *  - Personnel & Controllers Edit Modal (teams builder, lead appointment, unassigned, controllers)
 */

import {
  fetchProjectDetail,
  updateProjectDescription,
  updateProjectPersonnel
} from "./api.js";
import { pmState, resolveUser, updateProjectPersonnelStats } from "./pm_workspace_state.js";

// =========================================================================
// MODULE SCOPE REFERENCES & CALLBACKS
// =========================================================================
let callbacks = {};

let draftTeams = [];
let draftUnassigned = [];
let draftControllers = [];

// DOM References
let planProjTitle = null;
let planStartDate = null;
let planCreatedDate = null;
let inputDescription = null;
let formDescription = null;
let btnSaveDescription = null;
let descSaveAlert = null;
let planPersonnelStats = null;
let btnOpenPersonnelModal = null;

let personnelModal = null;
let personnelModalTitle = null;
let btnClosePersonnelModal = null;
let btnDismissPersonnelModal = null;
let btnEditPersonnelModal = null;
let personnelViewContainer = null;
let personnelEditContainer = null;
let personnelViewFooter = null;
let personnelEditFooter = null;

let personnelControllersList = null;
let personnelTeamsList = null;
let personnelUnassignedList = null;

let personnelEditError = null;
let personnelEditSuccess = null;
let btnShowAddTeam = null;
let newTeamFormContainer = null;
let inputNewTeamName = null;
let btnConfirmAddTeam = null;
let btnCancelAddTeam = null;
let editTeamsList = null;

let selectAddIndividual = null;
let btnConfirmAddIndividual = null;
let editUnassignedList = null;

let selectAddController = null;
let btnConfirmAddController = null;
let editControllersList = null;

let btnCancelEditPersonnel = null;
let btnSaveEditPersonnel = null;

/**
 * Refreshes View 1 Plan Schedule Management overview banner, project metadata, and stats.
 */
export function renderPlanView() {
  const project = pmState.project;
  if (!project) return;
  const projectName = project.name || "Untitled Project";
  if (planProjTitle) planProjTitle.textContent = projectName;
  if (planStartDate) planStartDate.textContent = project.start_date || "Not set";
  if (planCreatedDate) planCreatedDate.textContent = project.created_at || "—";
  if (inputDescription) inputDescription.value = project.description || "";
  updateProjectPersonnelStats();
}

/**
 * Initializes View 1 Plan Schedule Management & Personnel Modal.
 */
export function initPlanScheduleManagement(user = null, isPM = null, cbs = {}) {
  if (typeof user === "object" && user !== null && !user.id && !user._id && !user.role) {
    // Called with callbacks as first arg
    cbs = user;
    user = null;
  }
  callbacks = { ...callbacks, ...cbs };

  // DOM Elements - View 1
  planProjTitle = document.getElementById("plan-proj-title");
  planStartDate = document.getElementById("plan-start-date");
  planCreatedDate = document.getElementById("plan-created-date");
  inputDescription = document.getElementById("input-plan-description");
  formDescription = document.getElementById("form-edit-description");
  btnSaveDescription = document.getElementById("btn-save-description");
  descSaveAlert = document.getElementById("desc-save-alert");
  planPersonnelStats = document.getElementById("plan-personnel-stats");
  btnOpenPersonnelModal = document.getElementById("btn-open-personnel-modal");

  // Personnel Modal Elements
  personnelModal = document.getElementById("personnel-modal");
  personnelModalTitle = document.getElementById("personnel-modal-title");
  btnClosePersonnelModal = document.getElementById("btn-close-personnel-modal");
  btnDismissPersonnelModal = document.getElementById("btn-dismiss-personnel-modal");
  btnEditPersonnelModal = document.getElementById("btn-edit-personnel-modal");

  personnelViewContainer = document.getElementById("personnel-view-container");
  personnelEditContainer = document.getElementById("personnel-edit-container");
  personnelViewFooter = document.getElementById("personnel-view-footer");
  personnelEditFooter = document.getElementById("personnel-edit-footer");

  personnelControllersList = document.getElementById("personnel-controllers-list");
  personnelTeamsList = document.getElementById("personnel-teams-list");
  personnelUnassignedList = document.getElementById("personnel-unassigned-list");

  // Edit Mode Elements
  personnelEditError = document.getElementById("personnel-edit-error");
  personnelEditSuccess = document.getElementById("personnel-edit-success");
  btnShowAddTeam = document.getElementById("btn-show-add-team");
  newTeamFormContainer = document.getElementById("new-team-form-container");
  inputNewTeamName = document.getElementById("input-new-team-name");
  btnConfirmAddTeam = document.getElementById("btn-confirm-add-team");
  btnCancelAddTeam = document.getElementById("btn-cancel-add-team");
  editTeamsList = document.getElementById("edit-teams-list");

  selectAddIndividual = document.getElementById("select-add-individual");
  btnConfirmAddIndividual = document.getElementById("btn-confirm-add-individual");
  editUnassignedList = document.getElementById("edit-unassigned-list");

  selectAddController = document.getElementById("select-add-controller");
  btnConfirmAddController = document.getElementById("btn-confirm-add-controller");
  editControllersList = document.getElementById("edit-controllers-list");

  btnCancelEditPersonnel = document.getElementById("btn-cancel-edit-personnel");
  btnSaveEditPersonnel = document.getElementById("btn-save-edit-personnel");

  // Populate Active Project Information
  renderPlanView();

  // Description Save Handler
  if (formDescription) {
    formDescription.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!btnSaveDescription) return;
      btnSaveDescription.disabled = true;
      btnSaveDescription.textContent = "Saving...";

      const newDesc = inputDescription ? inputDescription.value.trim() : "";
      const currentPid = pmState.projectId || (pmState.project ? (pmState.project.id || pmState.project._id) : null);
      const { data: updatedProj, error } = await updateProjectDescription(currentPid, newDesc);

      btnSaveDescription.disabled = false;
      btnSaveDescription.textContent = "Save Description";

      if (error) {
        alert(`Failed to update scope description: ${error}`);
        return;
      }

      if (pmState.project) pmState.project.description = newDesc;
      if (descSaveAlert) {
        descSaveAlert.style.display = "flex";
        setTimeout(() => {
          descSaveAlert.style.display = "none";
        }, 3500);
      }
    });
  }

  // Edit Personnel permission
  const currentUser = user || pmState.user || {};
  const project = pmState.project || {};
  const userIsPM = (isPM !== null && isPM !== undefined)
    ? Boolean(isPM)
    : (Boolean(currentUser.is_admin) || (currentUser.role && currentUser.role.trim() === "Project Manager") || (String(currentUser.id || currentUser._id) === String(project.created_by || "")));

  if (btnEditPersonnelModal) {
    btnEditPersonnelModal.style.display = userIsPM ? "inline-block" : "none";
  }

  // Wire Modal Buttons
  if (btnOpenPersonnelModal) {
    btnOpenPersonnelModal.addEventListener("click", async () => {
      btnOpenPersonnelModal.disabled = true;
      try {
        const { data: freshProject } = await fetchProjectDetail(pmState.projectId);
        if (freshProject) {
          pmState.project = freshProject;
          updateProjectPersonnelStats();
        }
      } catch (err) {
        console.warn("Could not refresh personnel:", err);
      } finally {
        btnOpenPersonnelModal.disabled = false;
      }
      renderPersonnelView();
      if (personnelModal) personnelModal.style.display = "flex";
    });
  }

  // Real-time listener for join approvals / personnel updates
  window.addEventListener("syncflow:project_updated", async () => {
    try {
      const { data: freshProject } = await fetchProjectDetail(pmState.projectId);
      if (freshProject) {
        pmState.project = freshProject;
        updateProjectPersonnelStats();
        if (personnelModal && personnelModal.style.display === "flex") {
          renderPersonnelView();
        }
      }
    } catch (err) {
      console.warn("Could not reload project after syncflow:project_updated:", err);
    }
  });

  if (btnEditPersonnelModal) {
    btnEditPersonnelModal.addEventListener("click", () => {
      initEditState();
      renderPersonnelEdit();
    });
  }

  if (btnCancelEditPersonnel) {
    btnCancelEditPersonnel.addEventListener("click", () => {
      renderPersonnelView();
    });
  }

  if (btnSaveEditPersonnel) {
    btnSaveEditPersonnel.addEventListener("click", handleSavePersonnel);
  }

  if (btnClosePersonnelModal) {
    btnClosePersonnelModal.addEventListener("click", () => {
      if (personnelModal) personnelModal.style.display = "none";
    });
  }

  if (btnDismissPersonnelModal) {
    btnDismissPersonnelModal.addEventListener("click", () => {
      if (personnelModal) personnelModal.style.display = "none";
    });
  }

  // Bind Add New Team Form handlers
  if (btnShowAddTeam) {
    btnShowAddTeam.addEventListener("click", () => {
      if (newTeamFormContainer) newTeamFormContainer.style.display = "block";
      if (inputNewTeamName) inputNewTeamName.focus();
    });
  }

  if (btnCancelAddTeam) {
    btnCancelAddTeam.addEventListener("click", () => {
      if (newTeamFormContainer) newTeamFormContainer.style.display = "none";
      if (inputNewTeamName) inputNewTeamName.value = "";
    });
  }

  if (btnConfirmAddTeam) {
    btnConfirmAddTeam.addEventListener("click", () => {
      const name = inputNewTeamName ? inputNewTeamName.value.trim() : "";
      if (!name) {
        alert("Please enter a name for the new team.");
        return;
      }
      draftTeams.push({
        team_id: `TEAM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: name,
        member_ids: [],
        lead_id: null
      });
      if (inputNewTeamName) inputNewTeamName.value = "";
      if (newTeamFormContainer) newTeamFormContainer.style.display = "none";
      renderEditTeams();
    });
  }

  // Bind Add Individual Contributor
  if (btnConfirmAddIndividual) {
    btnConfirmAddIndividual.addEventListener("click", () => {
      const uid = selectAddIndividual ? selectAddIndividual.value : "";
      if (!uid) return;
      if (!draftUnassigned.includes(uid)) {
        draftUnassigned.push(uid);
        renderEditUnassigned();
      }
    });
  }

  // Bind Appoint Controller
  if (btnConfirmAddController) {
    btnConfirmAddController.addEventListener("click", () => {
      const uid = selectAddController ? selectAddController.value : "";
      if (!uid) return;
      if (!draftControllers.includes(uid)) {
        draftControllers.push(uid);
        renderEditControllers();
        renderEditUnassigned();
      }
    });
  }
}

// =========================================================================
// PERSONNEL OVERVIEW TAB (READ-ONLY VIEW)
// =========================================================================

/**
 * Renders the read-only Personnel Overview tab.
 */
export function renderPersonnelView() {
  if (!personnelViewContainer) return;
  personnelViewContainer.style.display = "block";
  if (personnelEditContainer) personnelEditContainer.style.display = "none";
  if (personnelViewFooter) personnelViewFooter.style.display = "flex";
  if (personnelEditFooter) personnelEditFooter.style.display = "none";
  if (personnelModalTitle) personnelModalTitle.textContent = "Project Personnel & Team Assignments";

  const project = pmState.project;
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
        const isLead = t.lead_id && (String(t.lead_id) === String(m.id || m._id) || String(t.lead_id) === String(m.username));
        const ctrlTag = isCtrl ? `<span class="badge badge-green" style="margin-right: 6px;">🛡️ Controller</span>` : "";
        const leadTag = isLead ? `<span class="badge badge-amber" style="margin-right: 6px;">👑 Team Lead</span>` : "";
        const badge = `${leadTag}${ctrlTag}<span class="badge badge-blue">${t.name}</span>`;
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

// =========================================================================
// PERSONNEL EDIT MODE & CONTROLLERS CONFIGURATION
// =========================================================================

/**
 * Initializes deep copy of personnel configuration for editing.
 */
function initEditState() {
  const project = pmState.project;
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
export function renderPersonnelEdit() {
  if (!personnelViewContainer) return;
  personnelViewContainer.style.display = "none";
  if (personnelEditContainer) personnelEditContainer.style.display = "block";
  if (personnelViewFooter) personnelViewFooter.style.display = "none";
  if (personnelEditFooter) personnelEditFooter.style.display = "flex";
  if (personnelModalTitle) personnelModalTitle.textContent = "✏️ Edit Project Personnel & Teams";
  if (personnelEditError) personnelEditError.style.display = "none";
  if (personnelEditSuccess) personnelEditSuccess.style.display = "none";
  if (newTeamFormContainer) newTeamFormContainer.style.display = "none";
  if (inputNewTeamName) inputNewTeamName.value = "";

  renderEditTeams();
  renderEditUnassigned();
  renderEditControllers();
}

/**
 * Renders team configuration list with add/remove member controls.
 */
function renderEditTeams() {
  if (!editTeamsList) return;
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
    const availableToAdd = pmState.allUsers.filter(u => {
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
        const removedMid = draftTeams[tIdx].member_ids[mIdx];
        draftTeams[tIdx].member_ids.splice(mIdx, 1);
        if (draftTeams[tIdx].lead_id && String(draftTeams[tIdx].lead_id) === String(removedMid)) {
          draftTeams[tIdx].lead_id = null;
        }
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
  if (!editUnassignedList || !selectAddIndividual) return;
  const teamMemberIds = new Set();
  draftTeams.forEach(t => (t.member_ids || []).forEach(m => teamMemberIds.add(String(m))));
  const pmIdStr = String(pmState.project.created_by || "");
  const controllerSet = new Set(draftControllers);

  const availableForUnassigned = pmState.allUsers.filter(u => {
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
  if (!editControllersList || !selectAddController) return;
  const pmIdStr = String(pmState.project.created_by || "");
  const controllerSet = new Set(draftControllers);

  const availableToAppoint = pmState.allUsers.filter(u => {
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

/**
 * Persists updated team, contributor, and controller allocations to backend.
 */
async function handleSavePersonnel() {
  if (!btnSaveEditPersonnel) return;
  btnSaveEditPersonnel.disabled = true;
  btnSaveEditPersonnel.textContent = "Saving Changes...";
  if (personnelEditError) personnelEditError.style.display = "none";

  for (const t of draftTeams) {
    if (!t.name || !t.name.trim()) {
      if (personnelEditError) {
        personnelEditError.textContent = "All teams must have a non-empty name.";
        personnelEditError.style.display = "flex";
      }
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

  const { data: updatedProj, error } = await updateProjectPersonnel(pmState.projectId, payload);

  btnSaveEditPersonnel.disabled = false;
  btnSaveEditPersonnel.textContent = "💾 Save Changes";

  if (error || !updatedProj) {
    if (personnelEditError) {
      personnelEditError.textContent = error || "Failed to update project personnel. Please try again.";
      personnelEditError.style.display = "flex";
    }
    return;
  }

  pmState.project = updatedProj;
  updateProjectPersonnelStats();
  renderPersonnelView();
}
