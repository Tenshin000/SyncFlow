/**
 * SyncFlow Frontend - Member Operational Agenda & Kanban Board (member_agenda.js)
 * Implements:
 *  - Operational Agenda table & Kanban execution perspectives
 *  - Filtering by WIP, active, completed, or all activities
 *  - Personal time logs management screen
 *  - Integration with member_modals.js and member_stopwatch.js
 */

import {
  fetchProjectDetail,
  fetchControlSchedule
} from "./api.js";
import { getStatusBadge, formatDurationSeconds, escapeHtml } from "./utility.js";
import {
  memberState,
  ensureUsersLoaded,
  isUserController,
  isActAssignedToUser,
  isActAssignedForTimer,
  getUserActivityPermission
} from "./member_workspace_state.js";
import {
  openControllerReviewModal,
  openMemberCompletionModal,
  openMemberActivityModal
} from "./member_modals.js";

// =========================================================================
// MODULE SCOPE REFERENCES & CALLBACKS
// =========================================================================
let callbacks = {
  switchMainView: () => {},
  refreshSidebarBadge: () => {},
  renderInpageProjectPills: () => {},
  loadParticipatingProjects: () => {},
  updateStopwatchWipOptions: () => {},
  restoreOrSyncActiveTimer: () => {},
  selectAndStartTaskTimer: () => {},
  openEditTimerModal: () => {},
  handleDeleteTimer: () => {}
};

// Agenda DOM Elements
let agendaTasksContainer = null;
let kpiAgendaTotal = null;
let kpiAgendaWip = null;
let kpiAgendaFinished = null;
let kpiAgendaNotStarted = null;
let btnAgendaViewTable = null;
let btnAgendaViewKanban = null;
let agendaTasksContainerEl = null;
let agendaKanbanContainerEl = null;

/**
 * Initializes the Agenda table, Kanban views, and event listeners.
 */
export function initMemberAgenda(cbs) {
  callbacks = { ...callbacks, ...cbs };

  // DOM Elements - Agenda & KPIs
  agendaTasksContainer = document.getElementById("agenda-tasks-container");
  kpiAgendaTotal = document.getElementById("kpi-agenda-total");
  kpiAgendaWip = document.getElementById("kpi-agenda-wip");
  kpiAgendaFinished = document.getElementById("kpi-agenda-finished");
  kpiAgendaNotStarted = document.getElementById("kpi-agenda-not-started");
  const btnRefreshAgenda = document.getElementById("btn-refresh-agenda");
  if (btnRefreshAgenda) btnRefreshAgenda.addEventListener("click", () => loadAgendaTasks());

  btnAgendaViewTable = document.getElementById("btn-agenda-view-table");
  btnAgendaViewKanban = document.getElementById("btn-agenda-view-kanban");
  agendaTasksContainerEl = document.getElementById("agenda-tasks-container");
  agendaKanbanContainerEl = document.getElementById("agenda-kanban-container");

  if (btnAgendaViewTable && btnAgendaViewKanban) {
    btnAgendaViewTable.addEventListener("click", () => {
      memberState.agendaViewMode = "table";
      btnAgendaViewTable.classList.remove("btn-secondary");
      btnAgendaViewTable.classList.add("btn-primary");
      btnAgendaViewTable.style.fontWeight = "700";
      btnAgendaViewKanban.classList.remove("btn-primary");
      btnAgendaViewKanban.classList.add("btn-secondary");
      btnAgendaViewKanban.style.fontWeight = "600";
      if (agendaTasksContainerEl) agendaTasksContainerEl.style.display = "block";
      if (agendaKanbanContainerEl) agendaKanbanContainerEl.style.display = "none";
    });

    btnAgendaViewKanban.addEventListener("click", () => {
      memberState.agendaViewMode = "kanban";
      btnAgendaViewKanban.classList.remove("btn-secondary");
      btnAgendaViewKanban.classList.add("btn-primary");
      btnAgendaViewKanban.style.fontWeight = "700";
      btnAgendaViewTable.classList.remove("btn-primary");
      btnAgendaViewTable.classList.add("btn-secondary");
      btnAgendaViewTable.style.fontWeight = "600";
      if (agendaTasksContainerEl) agendaTasksContainerEl.style.display = "none";
      if (agendaKanbanContainerEl) agendaKanbanContainerEl.style.display = "block";
      if (memberState.currentControlModel) {
        const activities = memberState.currentControlModel.activities || [];
        const userIsCtrl = isUserController();
        const ctrlActs = userIsCtrl ? activities.filter(a => isUserController(a)) : [];
        const myActs = activities.filter(a => isActAssignedToUser(a));
        renderAgendaKanbanBoard(myActs, ctrlActs);
      }
    });
  }
}

// =========================================================================
// ASSIGNED TASKS PAGE & SCHEDULE DATA LOADER
// =========================================================================

/**
 * Main loader for Member Workspace: fetches project schedule, activities, and time trackers.
 */
export async function loadAssignedTasksPage() {
  if (!memberState.activeProjectId) {
    if (memberState.participatingProjects.length > 0) {
      memberState.activeProjectId = memberState.participatingProjects[0].id;
      sessionStorage.setItem("active_project_id", memberState.activeProjectId);
    } else {
      await callbacks.loadParticipatingProjects();
    }
  }

  if (!memberState.activeProjectId) {
    if (agendaTasksContainer) {
      agendaTasksContainer.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--muted);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📂</div>
          <h4>No Project Selected</h4>
          <p style="font-size: 0.9rem; margin-top: 4px;">Please select one of your projects from the Projects tab to view your assigned tasks.</p>
          <button id="btn-goto-projects-tab-tasks" class="btn btn-primary" style="margin-top: 10px;">📁 Go to Projects</button>
        </div>
      `;
      const btnGo = document.getElementById("btn-goto-projects-tab-tasks");
      if (btnGo) btnGo.addEventListener("click", () => callbacks.switchMainView("projects"));
    }
    return;
  }

  if (!memberState.activeProject || memberState.activeProject.id !== memberState.activeProjectId) {
    const { data: pDetail } = await fetchProjectDetail(memberState.activeProjectId);
    if (pDetail) memberState.activeProject = pDetail;
  }

  callbacks.renderInpageProjectPills();
  await loadAgendaTasks();
}

/**
 * Loads and categorizes tasks assigned to the user into operational states.
 */
export async function loadAgendaTasks() {
  if (!memberState.activeProjectId) return;
  if (agendaTasksContainer) {
    agendaTasksContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 1.5rem 0;">Loading activities...</p>`;
  }

  await ensureUsersLoaded();

  const { data: ctrlData, error } = await fetchControlSchedule(memberState.activeProjectId);
  if (error || !ctrlData) {
    if (agendaTasksContainer) {
      agendaTasksContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load schedule: ${error}</div>`;
    }
    return;
  }

  memberState.currentControlModel = ctrlData;
  const activities = ctrlData.activities || [];

  const userIsCtrl = isUserController();
  const ctrlActivities = userIsCtrl ? activities.filter(a => isUserController(a)) : [];
  const myAssignedActivities = activities.filter(a => isActAssignedToUser(a));

  updateAgendaKPIs(myAssignedActivities);
  callbacks.updateStopwatchWipOptions(activities);
  callbacks.restoreOrSyncActiveTimer();
  renderAgendaActivities(ctrlActivities, myAssignedActivities);
}

/**
 * Updates agenda summary counter cards (WIP, Completed, Verified, Total Assigned).
 */
export function updateAgendaKPIs(assignedActs) {
  const total = assignedActs.length;
  const wip = assignedActs.filter(a => a.status === "in_progress").length;
  const fin = assignedActs.filter(a => a.status === "completed" || a.status === "verified").length;
  const ns = assignedActs.filter(a => a.status === "not_started").length;

  if (kpiAgendaTotal) kpiAgendaTotal.textContent = total;
  if (kpiAgendaWip) kpiAgendaWip.textContent = wip;
  if (kpiAgendaFinished) kpiAgendaFinished.textContent = fin;
  if (kpiAgendaNotStarted) kpiAgendaNotStarted.textContent = ns;
}

// =========================================================================
// AGENDA TABLE VIEW RENDERING
// =========================================================================

/**
 * Generates HTML table row markup for an assigned activity in the Agenda list view.
 */
export function renderAgendaRow(act, isControllerFlag) {
  const actId = act.activity_id;
  const status = act.status || "not_started";
  const sv = act.sv_days !== undefined ? act.sv_days : 0;
  const perm = getUserActivityPermission(act);
  const isCtrl = isControllerFlag !== undefined && isControllerFlag !== null ? isControllerFlag : Boolean(perm.isController && !perm.canComplete);

  let actionCell = `
    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
      <button type="button" class="btn btn-sm btn-outline-secondary btn-member-open-modal" data-act-id="${actId}" style="font-weight: 600; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
        📋 Details
      </button>
      ${status === "in_progress" && isActAssignedForTimer(act) ? `
        <button type="button" class="btn btn-sm btn-outline-primary btn-track-time-task" data-act-id="${actId}" style="font-weight: 700; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Link and start timer on this WIP task">
          ⏱️ Track Time
        </button>
      ` : ''}
  `;
  if (isCtrl) {
    if (status === "completed") {
      actionCell += `
        <button type="button" class="btn btn-sm btn-warning btn-ctrl-return-wip" data-act-id="${actId}" style="background: #F59E0B; color: #FFFFFF; border: none; font-weight: 700; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
          🔙 Return to WIP
        </button>
        <button type="button" class="btn btn-sm btn-primary btn-ctrl-confirm-verified" data-act-id="${actId}" style="background: #2563EB; color: #FFFFFF; border: none; font-weight: 700; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
          🔵 Confirm Review Complete
        </button>
      `;
    } else if (status === "verified") {
      actionCell += `<span style="font-size: 0.8rem; color: #2563EB; font-weight: 600;">✓ Verified (${act.verified_by || 'Controller'})</span>`;
    } else {
      actionCell += `<span style="font-size: 0.8rem; color: var(--muted);">Monitoring Execution</span>`;
    }
  } else {
    if (status === "in_progress") {
      actionCell += perm.isViewOnly
        ? `<span class="badge badge-amber" title="Your team has a designated lead who has authority to submit completion requests" style="cursor: help;">👁️ View-Only (${perm.reason})</span>`
        : `<button type="button" class="btn btn-sm btn-outline-success btn-member-mark-complete" data-act-id="${actId}" style="font-weight: 700; padding: 4px 10px; border-radius: 4px; border: 1.5px solid #16A34A; color: #15803D; background: #DCFCE7; cursor: pointer;">✅ Mark Complete</button>`;
    } else if (status === "completed") {
      actionCell += `<span style="font-size: 0.82rem; color: #15803D; font-weight: 700;">⏳ Awaiting Review</span>`;
    } else if (status === "verified") {
      actionCell += `<span style="font-size: 0.82rem; color: #1D4ED8; font-weight: 700;">🔵 Controlled</span>`;
    } else {
      actionCell += `<span style="font-size: 0.8rem; color: var(--muted);">Predecessor Work Pending</span>`;
    }
  }
  actionCell += `</div>`;

  return `
    <tr>
      <td><a href="javascript:void(0)" class="btn-member-open-modal" data-act-id="${actId}" style="font-weight: 700; color: var(--primary); text-decoration: underline;">${actId}</a></td>
      <td>
        <strong><a href="javascript:void(0)" class="btn-member-open-modal" data-act-id="${actId}" style="color: inherit; text-decoration: none;">${act.name}</a></strong>
        ${perm.isController ? `<span class="badge badge-blue" style="margin-left: 4px; font-size: 0.7rem;">🛡️ Controller</span>` : ''}
        ${!isCtrl && perm.isLead ? `<span class="badge badge-amber" style="margin-left: 4px; font-size: 0.7rem;">👑 Team Lead</span>` : ''}
        <div style="font-size: 0.75rem; margin-top: 3px;">
          <span class="time-log-badge ${(act.total_logged_seconds || 0) > 0 ? 'has-time' : ''}" title="Total time tracked on this task">
            ⏱️ ${formatDurationSeconds(act.total_logged_seconds || 0)}
          </span>
        </div>
      </td>
      <td>${act.duration}d</td>
      <td>${getStatusBadge(status)}</td>
      <td style="color: ${sv >= 0 ? '#15803D' : '#DC2626'}; font-weight: 700;">${sv >= 0 ? '+' : ''}${sv.toFixed(1)}d</td>
      <td>${actionCell}</td>
    </tr>
  `;
}

/**
 * Renders the filterable activities list, including the My Trackers time management screen.
 */
export function renderAgendaActivities(ctrlActivities, myAssignedActivities) {
  let containerHtml = "";

  // 1. Controller Review Queue (if user is Controller)
  if (ctrlActivities.length > 0) {
    const ctrlRows = ctrlActivities.map(act => renderAgendaRow(act, true)).join("");
    containerHtml += `
      <div style="background: #EFF6FF; border: 1.5px solid #93C5FD; border-radius: var(--radius-md); padding: 1.2rem; margin-bottom: 1.8rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.4rem;">
          <span style="font-size: 1.4rem;">🛡️</span>
          <h3 style="margin: 0; font-size: 1.15rem; color: #1E40AF; font-weight: 700;">
            Controller Review &amp; Sign-Off Queue (${ctrlActivities.length} Assigned Activities)
          </h3>
        </div>
        <p style="margin: 0 0 1rem 0; font-size: 0.88rem; color: #1E3A8A; line-height: 1.45;">
          As appointed Controller, review completed activity deliverables and either sign off as Controlled (Verified) or return to WIP.
        </p>
        <div class="table-responsive">
          <table class="data-table" style="background: #FFFFFF;">
            <thead>
              <tr>
                <th style="width: 100px;">ID</th>
                <th>Activity &amp; Staff</th>
                <th style="width: 80px;">Plan (d)</th>
                <th style="width: 130px;">Status</th>
                <th style="width: 90px;">SV (days)</th>
                <th style="width: 260px;">Controller Actions</th>
              </tr>
            </thead>
            <tbody>
              ${ctrlRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 2. Personal Assigned Operational Activities
  containerHtml += `
    <div style="margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 8px;">
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--charcoal); font-weight: 700;">
          📋 My Assigned Activities (${myAssignedActivities.length})
        </h3>
        <div class="agenda-filter-buttons" style="display: flex; gap: 6px;">
          <button type="button" class="btn btn-sm btn-filter-agenda ${memberState.agendaFilter === 'all' ? 'active' : ''}" data-filter="all">All (${myAssignedActivities.length})</button>
          <button type="button" class="btn btn-sm btn-filter-agenda ${memberState.agendaFilter === 'wip' ? 'active' : ''}" data-filter="wip">WIP (${myAssignedActivities.filter(a => a.status === 'in_progress').length})</button>
          <button type="button" class="btn btn-sm btn-filter-agenda ${memberState.agendaFilter === 'active' ? 'active' : ''}" data-filter="active">Active (${myAssignedActivities.filter(a => a.status === 'not_started' || a.status === 'in_progress').length})</button>
          <button type="button" class="btn btn-sm btn-filter-agenda ${memberState.agendaFilter === 'completed' ? 'active' : ''}" data-filter="completed">Completed (${myAssignedActivities.filter(a => a.status === 'completed' || a.status === 'verified').length})</button>
        </div>
      </div>
  `;

  let filteredActs = myAssignedActivities;
  if (memberState.agendaFilter === "wip") {
    filteredActs = myAssignedActivities.filter(a => a.status === "in_progress");
  } else if (memberState.agendaFilter === "active") {
    filteredActs = myAssignedActivities.filter(a => a.status === "not_started" || a.status === "in_progress");
  } else if (memberState.agendaFilter === "completed") {
    filteredActs = myAssignedActivities.filter(a => a.status === "completed" || a.status === "verified");
  }

  if (filteredActs.length === 0) {
    containerHtml += `
      <div style="background: #FFFFFF; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 2rem; text-align: center; color: var(--muted);">
        No activities found matching filter "${memberState.agendaFilter}".
      </div>
    </div>`;
  } else {
    const rows = filteredActs.map(act => renderAgendaRow(act)).join("");
    containerHtml += `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 100px;">ID</th>
              <th>Activity &amp; Staff</th>
              <th style="width: 80px;">Plan (d)</th>
              <th style="width: 130px;">Status</th>
              <th style="width: 90px;">SV (days)</th>
              <th style="width: 250px;">Member Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // 3. Time Trackers Management Screen
  const allActs = (memberState.currentControlModel && memberState.currentControlModel.activities) || [];
  const myTimeLogs = [];
  allActs.forEach(act => {
    (act.time_logs || []).forEach(log => {
      if (String(log.user_id) === String(memberState.userId) || (memberState.user && log.user_name && log.user_name.includes(memberState.user.first_name))) {
        myTimeLogs.push({ ...log, activity_id: act.activity_id, activity_name: act.name, activity_status: act.status });
      }
    });
  });

  const totalUserSeconds = myTimeLogs.reduce((acc, curr) => acc + (curr.duration_seconds || 0), 0);

  containerHtml += `
    <div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.2rem; margin-top: 1.8rem; box-shadow: var(--shadow-sm);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.3rem;">⏱️</span>
          <h3 style="margin: 0; font-size: 1.15rem; color: var(--charcoal); font-weight: 700;">
            My Time Trackers &amp; Audit Logs (${myTimeLogs.length} Sessions)
          </h3>
        </div>
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary); background: var(--primary-light); padding: 4px 10px; border-radius: 6px; border: 1px solid var(--primary-border);">
          Total Logged: ${formatDurationSeconds(totalUserSeconds)}
        </div>
      </div>
      <p style="margin: 0 0 1rem 0; font-size: 0.85rem; color: var(--slate);">
        Review, reallocate, or correct past stopwatch timer sessions recorded on your assigned WIP tasks.
      </p>
  `;

  if (myTimeLogs.length === 0) {
    containerHtml += `
      <div style="padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.85rem; border: 1px dashed var(--border); border-radius: var(--radius-sm);">
        No time logs recorded yet. Use the live stopwatch above or the "⏱️ Track Time" button on an assigned WIP activity to record your sessions.
      </div>
    </div>`;
  } else {
    myTimeLogs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    let logRows = "";
    myTimeLogs.forEach(log => {
      const logDate = log.created_at ? log.created_at.split("T")[0] : "—";
      const durDisplay = formatDurationSeconds(log.duration_seconds || 0);
      const notes = log.notes || "—";
      logRows += `
        <tr>
          <td><code style="font-weight: 700; color: var(--primary);">${log.activity_id}</code></td>
          <td><strong>${escapeHtml(log.activity_name)}</strong></td>
          <td style="font-weight: 700; color: #1E40AF;">⏱️ ${durDisplay}</td>
          <td>${logDate}</td>
          <td style="font-size: 0.82rem; color: var(--slate); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(notes)}">${escapeHtml(notes)}</td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="btn btn-xs btn-outline-primary btn-edit-timer-log" data-log-id="${log.log_id}" data-act-id="${log.activity_id}">✏️ Edit</button>
              <button type="button" class="btn btn-xs btn-outline-danger btn-delete-timer-log" data-log-id="${log.log_id}" data-act-id="${log.activity_id}" data-dur="${log.duration_seconds}">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    });

    containerHtml += `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 100px;">Task ID</th>
              <th>Activity Name</th>
              <th style="width: 110px;">Duration</th>
              <th style="width: 100px;">Date</th>
              <th>Notes</th>
              <th style="width: 110px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${logRows}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  if (agendaTasksContainer) {
    agendaTasksContainer.innerHTML = containerHtml;
  }

  // Attach event handlers to dynamic buttons
  attachDynamicAgendaListeners(ctrlActivities, myAssignedActivities);

  // Update Kanban board if visible
  renderAgendaKanbanBoard(myAssignedActivities, ctrlActivities);
}

function attachDynamicAgendaListeners(ctrlActivities, myAssignedActivities) {
  if (!agendaTasksContainer) return;

  // Filter Buttons
  agendaTasksContainer.querySelectorAll(".btn-filter-agenda").forEach(btn => {
    btn.addEventListener("click", () => {
      memberState.agendaFilter = btn.getAttribute("data-filter");
      renderAgendaActivities(ctrlActivities, myAssignedActivities);
    });
  });

  // Details Modal
  agendaTasksContainer.querySelectorAll(".btn-member-open-modal").forEach(btn => {
    btn.addEventListener("click", () => {
      const aid = btn.getAttribute("data-act-id");
      const allActs = (memberState.currentControlModel && memberState.currentControlModel.activities) || [];
      const act = allActs.find(a => a.activity_id === aid);
      if (act) openMemberActivityModal(act);
    });
  });

  // Track Time Shortcut Button
  agendaTasksContainer.querySelectorAll(".btn-track-time-task").forEach(btn => {
    btn.addEventListener("click", () => {
      const aid = btn.getAttribute("data-act-id");
      if (aid) callbacks.selectAndStartTaskTimer(aid);
    });
  });

  // Mark Complete (Member evidence modal)
  agendaTasksContainer.querySelectorAll(".btn-member-mark-complete").forEach(btn => {
    btn.addEventListener("click", () => {
      const aid = btn.getAttribute("data-act-id");
      const allActs = (memberState.currentControlModel && memberState.currentControlModel.activities) || [];
      const act = allActs.find(a => a.activity_id === aid);
      if (act) openMemberCompletionModal(act);
    });
  });

  // Controller Actions
  agendaTasksContainer.querySelectorAll(".btn-ctrl-confirm-verified").forEach(btn => {
    btn.addEventListener("click", () => {
      const aid = btn.getAttribute("data-act-id");
      const allActs = (memberState.currentControlModel && memberState.currentControlModel.activities) || [];
      const act = allActs.find(a => a.activity_id === aid);
      if (act) openControllerReviewModal(act, "verified");
    });
  });

  agendaTasksContainer.querySelectorAll(".btn-ctrl-return-wip").forEach(btn => {
    btn.addEventListener("click", () => {
      const aid = btn.getAttribute("data-act-id");
      const allActs = (memberState.currentControlModel && memberState.currentControlModel.activities) || [];
      const act = allActs.find(a => a.activity_id === aid);
      if (act) openControllerReviewModal(act, "in_progress");
    });
  });

  // Time Tracker Edit & Delete Buttons
  agendaTasksContainer.querySelectorAll(".btn-edit-timer-log").forEach(btn => {
    btn.addEventListener("click", () => {
      const logId = btn.getAttribute("data-log-id");
      const actId = btn.getAttribute("data-act-id");
      callbacks.openEditTimerModal(logId, actId);
    });
  });

  agendaTasksContainer.querySelectorAll(".btn-delete-timer-log").forEach(btn => {
    btn.addEventListener("click", () => {
      const logId = btn.getAttribute("data-log-id");
      const actId = btn.getAttribute("data-act-id");
      const dur = btn.getAttribute("data-dur");
      callbacks.handleDeleteTimer(logId, actId, dur);
    });
  });
}

// =========================================================================
// KANBAN BOARD EXECUTION PERSPECTIVE
// =========================================================================

/**
 * Renders interactive Kanban board with 4 columns: Not Started, WIP, Awaiting Review, Verified.
 */
export function renderAgendaKanbanBoard(myAssignedActivities, ctrlActivities) {
  const kanbanContainer = document.getElementById("agenda-kanban-container");
  if (!kanbanContainer) return;

  const allRelevantMap = new Map();
  (myAssignedActivities || []).forEach(a => allRelevantMap.set(a.activity_id, a));
  (ctrlActivities || []).forEach(a => allRelevantMap.set(a.activity_id, a));
  const allActivities = Array.from(allRelevantMap.values());

  const cols = {
    not_started: { title: "⚪ Not Started", class: "kanban-col-not-started", acts: [] },
    in_progress: { title: "🟡 Work-in-Progress", class: "kanban-col-in-progress", acts: [] },
    completed:   { title: "🟢 Completed (Awaiting Review)", class: "kanban-col-completed", acts: [] },
    verified:    { title: "🔵 Controlled & Verified", class: "kanban-col-verified", acts: [] }
  };

  allActivities.forEach(a => {
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
        const perm = getUserActivityPermission(a);

        let actionBtn = `
          <div style="display: flex; gap: 4px; align-items: center; justify-content: flex-end; flex-wrap: wrap;">
            <button type="button" class="btn btn-xs btn-outline-secondary btn-kanban-details" data-act-id="${a.activity_id}" style="font-weight: 600; cursor: pointer;">📋 Details</button>
        `;
        if (a.status === "in_progress") {
          if (isActAssignedForTimer(a)) {
            actionBtn += `<button type="button" class="btn btn-xs btn-outline-primary btn-kanban-track-time" data-act-id="${a.activity_id}">⏱️ Track</button>`;
          }
          if (perm.isViewOnly) {
            actionBtn += `<span class="badge badge-amber" style="font-size: 0.72rem;">👁️ View-Only</span>`;
          } else {
            actionBtn += `<button type="button" class="btn btn-xs btn-outline-success btn-kanban-complete" data-act-id="${a.activity_id}">✅ Complete</button>`;
          }
        } else if (a.status === "completed") {
          if (perm.isController) {
            actionBtn += `<button type="button" class="btn btn-xs btn-primary btn-kanban-review" data-act-id="${a.activity_id}">🛡️ Review</button>`;
          } else {
            actionBtn += `<span class="badge badge-green" style="font-size: 0.72rem;">⏳ In Review</span>`;
          }
        }
        actionBtn += `</div>`;

        boardHtml += `
          <div class="kanban-card status-${key}" data-act-id="${a.activity_id}" style="cursor: pointer;" title="Click card to open task timer and details">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
              <code style="font-weight: 700; font-size: 0.78rem; color: ${isMilestone ? '#7C3AED' : 'inherit'};">
                ${isMilestone ? '◆ ' : ''}${a.activity_id}
              </code>
              ${perm.isController ? `<span class="badge badge-blue" style="font-size: 0.65rem; padding: 1px 4px;">🛡️ Controller</span>` : (!perm.isController && perm.isLead ? `<span class="badge badge-amber" style="font-size: 0.65rem; padding: 1px 4px;">👑 Team Lead</span>` : '')}
            </div>
            <div class="kanban-card-title">${escapeHtml(a.name)}</div>
            <div style="font-size: 0.75rem; color: var(--muted);">WP: ${a.work_package_id || 'N/A'}</div>

            ${a.completion_proof ? `
              <div style="margin-top: 6px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 4px; padding: 4px 6px; font-size: 0.72rem; color: #475569; display: flex; align-items: center; gap: 4px;">
                <span>📝</span> <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(a.completion_proof)}</span>
              </div>
            ` : ''}

            <div class="kanban-card-meta">
              <span>⏱️ ${isMilestone ? '0d (Milestone)' : `${a.duration}d`}</span>
              <span class="time-log-badge ${(a.total_logged_seconds || 0) > 0 ? 'has-time' : ''}">⏱️ ${formatDurationSeconds(a.total_logged_seconds || 0)}</span>
              <span style="font-weight: 700; color: ${svColor};">SV: ${svStr}</span>
            </div>
            ${actionBtn ? `<div style="margin-top: 8px;">${actionBtn}</div>` : ''}
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

  // Attach card click listener (open activity modal with task timer)
  kanbanContainer.querySelectorAll(".kanban-card").forEach(card => {
    card.addEventListener("click", () => {
      const aid = card.getAttribute("data-act-id");
      const act = allActivities.find(x => x.activity_id === aid);
      if (act) openMemberActivityModal(act);
    });
  });

  // Attach details button listener
  kanbanContainer.querySelectorAll(".btn-kanban-details").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const aid = btn.getAttribute("data-act-id");
      const act = allActivities.find(x => x.activity_id === aid);
      if (act) openMemberActivityModal(act);
    });
  });

  // Attach kanban track time button listener
  kanbanContainer.querySelectorAll(".btn-kanban-track-time").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const aid = btn.getAttribute("data-act-id");
      if (aid) callbacks.selectAndStartTaskTimer(aid);
    });
  });

  // Attach card action listeners
  kanbanContainer.querySelectorAll(".btn-kanban-complete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const aid = btn.getAttribute("data-act-id");
      const act = allActivities.find(x => x.activity_id === aid);
      if (act) openMemberCompletionModal(act);
    });
  });

  kanbanContainer.querySelectorAll(".btn-kanban-review").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const aid = btn.getAttribute("data-act-id");
      const act = allActivities.find(x => x.activity_id === aid);
      if (act) openControllerReviewModal(act, "verified");
    });
  });
}
