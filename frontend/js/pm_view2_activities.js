/**
 * SyncFlow Frontend - PM View 2: Define Activities (pm_view2_activities.js)
 * Implements:
 *  - Work Package activities table view
 *  - Team and individual contributor assignment checkboxes
 *  - Controller designation for activities
 *  - Activity creation, milestone configuration, and editing modal
 */

import { pmState, resolveUser } from "./pm_workspace_state.js";
import {
  recalculateWbsNumbers,
  getAllWorkPackages,
  getWbsPath,
  findWbsNode,
  setWbsDirty,
  persistWbsAndActivities,
  switchWbsTab
} from "./pm_view2_wbs.js";

// =========================================================================
// MODULE SCOPE REFERENCES & STATE
// =========================================================================
let selectedActivityWpId = null;
let currentActSelectedTeams = new Set();
let currentActSelectedUsers = new Set();

// DOM References
let selectActivityWp = null;
let btnAddActivityItem = null;
let wpActivitiesBreadcrumb = null;
let wpActivitiesListContainer = null;

let activityModal = null;
let activityModalTitle = null;
let btnCloseActivityModal = null;
let btnCancelActivityModal = null;
let activityForm = null;
let activityEditMode = null;
let activityEditId = null;
let activityTargetWpId = null;
let activityModalError = null;
let inputActivityName = null;
let inputActivityDesc = null;
let selectActivityController = null;
let activityTeamsCheckboxes = null;
let activityUsersCheckboxes = null;

/**
 * Initializes View 2 Activities Tab and Modal Controllers.
 */
export function initActivitiesController() {
  selectActivityWp = document.getElementById("select-activity-wp");
  btnAddActivityItem = document.getElementById("btn-add-activity-item");
  wpActivitiesBreadcrumb = document.getElementById("wp-activities-breadcrumb");
  wpActivitiesListContainer = document.getElementById("wp-activities-list-container");

  activityModal = document.getElementById("activity-modal");
  activityModalTitle = document.getElementById("activity-modal-title");
  btnCloseActivityModal = document.getElementById("btn-close-activity-modal");
  btnCancelActivityModal = document.getElementById("btn-cancel-activity-modal");
  activityForm = document.getElementById("activity-form");
  activityEditMode = document.getElementById("activity-edit-mode");
  activityEditId = document.getElementById("activity-edit-id");
  activityTargetWpId = document.getElementById("activity-target-wp-id");
  activityModalError = document.getElementById("activity-modal-error");
  inputActivityName = document.getElementById("input-activity-name");
  inputActivityDesc = document.getElementById("input-activity-desc");
  selectActivityController = document.getElementById("select-activity-controller");
  activityTeamsCheckboxes = document.getElementById("activity-teams-checkboxes");
  activityUsersCheckboxes = document.getElementById("activity-users-checkboxes");

  if (selectActivityWp) {
    selectActivityWp.addEventListener("change", () => {
      selectedActivityWpId = selectActivityWp.value;
      renderDefineActivitiesTab();
    });
  }

  if (btnAddActivityItem) {
    btnAddActivityItem.addEventListener("click", () => {
      if (!selectedActivityWpId) {
        alert("Please select a Work Package first.");
        return;
      }
      openActivityModal({ mode: "add", targetWpId: selectedActivityWpId });
    });
  }

  if (btnCloseActivityModal) btnCloseActivityModal.addEventListener("click", closeActivityModal);
  if (btnCancelActivityModal) btnCancelActivityModal.addEventListener("click", closeActivityModal);

  if (activityForm) {
    activityForm.addEventListener("submit", handleActivityFormSubmit);
  }
}

export function setSelectedActivityWpId(wpId) {
  selectedActivityWpId = wpId;
}

// =========================================================================
// DEFINE ACTIVITIES TAB RENDERING
// =========================================================================

/**
 * Renders the Define Activities table grouped under corresponding Work Packages.
 */
export function renderDefineActivitiesTab() {
  if (!selectActivityWp || !wpActivitiesListContainer) return;
  recalculateWbsNumbers();
  const workPackages = getAllWorkPackages();
  const project = pmState.project;
  const projectName = project.name || "Untitled Project";

  if (workPackages.length === 0) {
    selectActivityWp.innerHTML = `<option value="">No Work Packages defined in WBS yet</option>`;
    if (wpActivitiesBreadcrumb) {
      wpActivitiesBreadcrumb.innerHTML = `<em>Please create at least one Work Package in the Project Builder before defining activities.</em>`;
    }
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
  if (path && path.length > 0 && wpActivitiesBreadcrumb) {
    let bHtml = `<span style="color: var(--charcoal); font-weight: 700;">📁 ${projectName}</span>`;
    path.forEach(pNode => {
      const isTarget = pNode.id === selectedActivityWpId;
      const icon = isTarget ? "📦" : "➔";
      bHtml += ` <span style="color: var(--muted); margin: 0 4px;">${icon}</span> <span style="${isTarget ? 'font-weight: 700; color: #047857;' : 'color: var(--slate);'}">[${pNode.wbs_number}] ${pNode.name}</span>`;
    });
    wpActivitiesBreadcrumb.innerHTML = bHtml;
  } else if (wpActivitiesBreadcrumb) {
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
        const targetAct = (pmState.project.activities || []).find(a => a.activity_id === aId);
        if (!targetAct) return;

        if (confirm(`Are you sure you want to delete activity "${targetAct.name}"?`)) {
          pmState.project.activities = pmState.project.activities.filter(a => a.activity_id !== aId);
          await persistWbsAndActivities(false);
          renderDefineActivitiesTab();
        }
      });
    });
  }
}

// =========================================================================
// ACTIVITY ASSIGNMENT CHECKBOXES & MODAL
// =========================================================================

/**
 * Renders team and individual user assignment checkboxes inside activity modal.
 */
export function renderActivityAssignmentCheckboxes() {
  if (!activityTeamsCheckboxes || !activityUsersCheckboxes) return;
  const project = pmState.project;

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

/**
 * Opens modal dialog to create or edit an operational activity.
 */
export function openActivityModal({ mode = "add", activityId = null, targetWpId = null }) {
  if (!activityModal) return;
  activityEditMode.value = mode;
  activityEditId.value = activityId || "";
  activityTargetWpId.value = targetWpId || selectedActivityWpId || "";
  if (activityModalError) activityModalError.style.display = "none";

  const project = pmState.project;
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
  if (selectActivityController) selectActivityController.innerHTML = ctrlOptions;

  const inputActivityIsMilestone = document.getElementById("input-activity-is-milestone");

  if (mode === "add") {
    if (activityModalTitle) activityModalTitle.textContent = `Add Activity to ${wpLabel}`;
    if (inputActivityName) inputActivityName.value = "";
    if (inputActivityDesc) inputActivityDesc.value = "";
    if (selectActivityController) selectActivityController.value = "";
    if (inputActivityIsMilestone) inputActivityIsMilestone.checked = false;
    currentActSelectedTeams = new Set();
    currentActSelectedUsers = new Set();
  } else {
    const act = (project.activities || []).find(a => a.activity_id === activityId);
    if (activityModalTitle) activityModalTitle.textContent = "Edit Activity";
    if (inputActivityName) inputActivityName.value = act ? (act.name || "") : "";
    if (inputActivityDesc) inputActivityDesc.value = act ? (act.description || "") : "";
    const actCid = act && act.controller_id ? String(act.controller_id) : "";
    const isLead = actCid === String(project.created_by);
    const isValidCid = isLead || (project.controllers || []).map(String).includes(actCid);
    if (selectActivityController) selectActivityController.value = isValidCid ? actCid : "";
    if (inputActivityIsMilestone) {
      inputActivityIsMilestone.checked = act ? Boolean(act.is_milestone || act.duration === 0) : false;
    }
    currentActSelectedTeams = new Set((act && act.assigned_teams ? act.assigned_teams : []).map(String));
    currentActSelectedUsers = new Set((act && act.assigned_users ? act.assigned_users : []).map(String));
  }

  renderActivityAssignmentCheckboxes();
  activityModal.style.display = "flex";
  if (inputActivityName) inputActivityName.focus();
}

/**
 * Closes the activity modal dialog.
 */
export function closeActivityModal() {
  if (activityModal) activityModal.style.display = "none";
}

async function handleActivityFormSubmit(e) {
  e.preventDefault();
  if (activityModalError) activityModalError.style.display = "none";

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

  if (!pmState.project.activities) pmState.project.activities = [];

  const assignedTeams = Array.from(currentActSelectedTeams);
  const assignedUsers = Array.from(currentActSelectedUsers);

  if (mode === "add") {
    const newActId = `ACT-${pmState.project.activities.length + 1}`;
    pmState.project.activities.push({
      activity_id: newActId,
      work_package_id: targetWp,
      name: name,
      description: description,
      controller_id: controllerId,
      assigned_teams: assignedTeams,
      assigned_users: assignedUsers,
      is_milestone: isMilestone,
      estimation_technique: isMilestone ? "milestone" : "three_point",
      duration: isMilestone ? 0.0 : 5.0,
      expected_time: isMilestone ? 0.0 : 5.0
    });
  } else {
    const aId = activityEditId.value;
    const act = pmState.project.activities.find(a => a.activity_id === aId);
    if (act) {
      act.name = name;
      act.description = description;
      act.controller_id = controllerId;
      act.assigned_teams = assignedTeams;
      act.assigned_users = assignedUsers;
      act.is_milestone = isMilestone;
      if (isMilestone) {
        act.estimation_technique = "milestone";
        act.duration = 0.0;
        act.expected_time = 0.0;
        act.optimistic = 0.0;
        act.most_likely = 0.0;
        act.pessimistic = 0.0;
      } else if (act.estimation_technique === "milestone") {
        act.estimation_technique = "three_point";
        act.duration = act.duration || 5.0;
        act.expected_time = act.expected_time || 5.0;
      }
    }
  }

  closeActivityModal();
  setWbsDirty(true);
  renderDefineActivitiesTab();
}
