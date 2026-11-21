/**
 * SyncFlow Frontend - PM Workspace View 6: Control Schedule Controller
 * PMBOK Process 6.6: Control Schedule.
 * Operational monitoring, task status updates (4 PMBOK colors),
 * Kanban board, controller checklist sign-off modal, and time log audits.
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import {
  fetchControlSchedule,
  updateActivityStatus,
  seedProjectProgress,
  fetchActivityTimeLogs
} from "./api.js";
import { pmState } from "./pm_workspace_state.js";
import {
  showTransientAlert,
  formatDurationSeconds,
  escapeHtml,
  CONTROLLER_CHECKLIST
} from "./utility.js";
import { renderControlTaskRowHtml } from "./pm_workspace_templates.js";
import { wireLegendToggle } from "./pm_view5_diagrams.js";
import { updateKickoffButtonsState } from "./pm_view5_schedule.js";
import {
  renderControlKpis,
  renderControlScurve,
  renderControlNetworkDiagram,
  initCtrlPdmControls,
  ctrlScurveState
} from "./pm_view6_evm_scurve.js";

// ==========================================
// VIEW STATE
// ==========================================
export const controlViewState = {
  currentControlModel: null,
  activeCtrlTab: "pdm",
  isControlInitialized: false
};

// ==========================================
// NOTIFICATION HELPER
// ==========================================
export function showCtrlAlert(msg, type = "success") {
  const ctrlAlertMsg = document.getElementById("ctrl-alert-msg");
  showTransientAlert(ctrlAlertMsg, msg, type, 3500);
}

// ==========================================
// OPERATIONAL TASKS TABLE
// ==========================================
/**
 * Renders operational tasks table with inline status toggles and time tracker inspector.
 */
export function renderControlTasksTable() {
  const ctrlTasksTableContainer = document.getElementById("ctrl-tasks-table-container");
  const ctrlFilterStatus = document.getElementById("ctrl-filter-status");
  const ctrlFilterCritical = document.getElementById("ctrl-filter-critical");
  const ctrlFilterSearch = document.getElementById("ctrl-filter-search");
  const ctrlFilterCount = document.getElementById("ctrl-filter-count");

  if (!ctrlTasksTableContainer || !controlViewState.currentControlModel) return;

  const rawActivities = controlViewState.currentControlModel.activities || [];
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
    // 4 status colors:
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
      const project = pmState.project;
      const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
      if (!projId || !actId) return;

      sel.disabled = true;
      try {
        const res = await updateActivityStatus(projId, actId, { status: newStatus });
        if (res.error) {
          showCtrlAlert("Failed to update status: " + res.error, "danger");
        } else {
          showCtrlAlert(`Updated ${actId} to ${newStatus.replace('_', ' ')} successfully!`, "success");
          controlViewState.currentControlModel = res.data;
          renderControlKpis(controlViewState.currentControlModel.kpis);
          renderControlNetworkDiagram(controlViewState.currentControlModel, openActivityStatusModal);
          renderControlScurve(controlViewState.currentControlModel.s_curve);
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

// ==========================================
// KANBAN BOARD
// ==========================================
/**
 * Renders 4-state operational Kanban board for real-time task progression.
 */
export function renderControlKanbanBoard() {
  const kanbanContainer = document.getElementById("ctrl-kanban-board-container");
  if (!kanbanContainer || !controlViewState.currentControlModel) return;

  const activities = controlViewState.currentControlModel.activities || [];
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

// ==========================================
// ACTIVITY STATUS MODAL
// ==========================================
/**
 * Opens detailed activity status update and controller verification sign-off modal.
 */
export function openActivityStatusModal(act) {
  const ctrlActivityModal = document.getElementById("ctrl-activity-modal");
  const ctrlModalActId = document.getElementById("ctrl-modal-act-id");
  const ctrlModalTitle = document.getElementById("ctrl-modal-title");
  const ctrlModalSub = document.getElementById("ctrl-modal-sub");
  const ctrlModalStatus = document.getElementById("ctrl-modal-status");
  const ctrlModalProgress = document.getElementById("ctrl-modal-progress");
  const ctrlModalProgVal = document.getElementById("ctrl-modal-prog-val");
  const ctrlModalActStart = document.getElementById("ctrl-modal-act-start");
  const ctrlModalActFinish = document.getElementById("ctrl-modal-act-finish");
  const ctrlModalVerifiedBy = document.getElementById("ctrl-modal-verified-by");
  const ctrlModalNotes = document.getElementById("ctrl-modal-notes");

  if (!ctrlActivityModal) return;

  if (ctrlModalActId) ctrlModalActId.value = act.activity_id;
  if (ctrlModalTitle) ctrlModalTitle.textContent = `✏️ Activity Execution: ${act.activity_id}`;
  if (ctrlModalSub) ctrlModalSub.textContent = `${act.name} (WP: ${act.work_package_id || "-"})`;

  if (ctrlModalStatus) {
    ctrlModalStatus.value = act.status || "not_started";

    // Once a task has reached WIP or beyond, it cannot be reverted to Not Started
    const notStartedOpt = ctrlModalStatus.querySelector('option[value="not_started"]');
    if (notStartedOpt) {
      if (act.status && act.status !== "not_started") {
        notStartedOpt.disabled = true;
        notStartedOpt.style.display = "none";
      } else {
        notStartedOpt.disabled = false;
        notStartedOpt.style.display = "";
      }
    }
  }

  if (ctrlModalProgress) ctrlModalProgress.value = act.progress_pct || 0;
  if (ctrlModalProgVal) ctrlModalProgVal.textContent = `${(act.progress_pct || 0).toFixed(0)}%`;

  if (ctrlModalActStart) ctrlModalActStart.value = act.actual_start_date || "";
  if (ctrlModalActFinish) ctrlModalActFinish.value = act.actual_finish_date || "";
  if (ctrlModalVerifiedBy) ctrlModalVerifiedBy.value = act.verified_by || "";
  if (ctrlModalNotes) ctrlModalNotes.value = act.notes || "";

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

  toggleModalVerifyGroup(ctrlModalStatus ? ctrlModalStatus.value : "not_started");
  ctrlActivityModal.style.display = "flex";
}

/**
 * Toggles visibility of controller verification fields based on chosen activity status.
 */
export function toggleModalVerifyGroup(status) {
  const ctrlModalVerifyGroup = document.getElementById("ctrl-modal-verify-group");
  const ctrlModalProgGroup = document.getElementById("ctrl-modal-prog-group");
  const proofGroup = document.getElementById("ctrl-modal-proof-group");

  if (ctrlModalVerifyGroup) {
    ctrlModalVerifyGroup.style.display = status === "verified" ? "block" : "none";
  }
  if (proofGroup) {
    proofGroup.style.display = (status === "completed" || status === "verified") ? "block" : "none";
  }
  if (ctrlModalProgGroup) {
    ctrlModalProgGroup.style.display = (status === "not_started" || status === "completed" || status === "verified") ? "none" : "block";
  }
}

// ==========================================
// TIME LOGS AUDIT MODAL
// ==========================================
/**
 * Opens PM Time Logs Audit modal to inspect time spent and contributor breakdown by task.
 */
export async function openControlTimeLogsModal(activityId = null) {
  const ctrlTimeLogsModal = document.getElementById("ctrl-time-logs-modal");
  const ctrlTimelogTaskSelect = document.getElementById("ctrl-timelog-task-select");
  if (!ctrlTimeLogsModal || !controlViewState.currentControlModel) return;

  const activities = controlViewState.currentControlModel.activities || [];
  if (activities.length === 0) {
    alert("No activities found in the project schedule.");
    return;
  }

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
export async function loadTaskTimeLogs(actId) {
  if (!controlViewState.currentControlModel) return;
  const activities = controlViewState.currentControlModel.activities || [];
  const act = activities.find(a => a.activity_id === actId);
  if (!act) return;

  const ctrlTimelogActTitle = document.getElementById("ctrl-timelog-act-title");
  const ctrlTimelogActSub = document.getElementById("ctrl-timelog-act-sub");
  const ctrlTimelogActStatusBadge = document.getElementById("ctrl-timelog-act-status-badge");
  const ctrlTimelogKpiTotalTime = document.getElementById("ctrl-timelog-kpi-total-time");
  const ctrlTimelogKpiSessions = document.getElementById("ctrl-timelog-kpi-sessions");
  const ctrlTimelogKpiContributors = document.getElementById("ctrl-timelog-kpi-contributors");
  const ctrlTimelogContributorsContainer = document.getElementById("ctrl-timelog-contributors-container");
  const ctrlTimelogSessionsContainer = document.getElementById("ctrl-timelog-sessions-container");

  if (ctrlTimelogActTitle) ctrlTimelogActTitle.textContent = `${act.name} (${act.activity_id})`;
  if (ctrlTimelogActSub) ctrlTimelogActSub.textContent = `WP: ${act.work_package_id || 'N/A'} | Planned Duration: ${act.duration}d | EV: ${act.ev_days.toFixed(1)}d`;
  
  let badgeClass = "badge-gray";
  let badgeText = "⚪ Not Started";
  if (act.status === "in_progress") { badgeClass = "badge-amber"; badgeText = "🟡 Work-in-Progress"; }
  else if (act.status === "completed") { badgeClass = "badge-green"; badgeText = "🟢 Completed (Review)"; }
  else if (act.status === "verified") { badgeClass = "badge-blue"; badgeText = "🔵 Verified & Controlled"; }
  if (ctrlTimelogActStatusBadge) {
    ctrlTimelogActStatusBadge.innerHTML = `<span class="badge ${badgeClass}" style="font-size: 0.82rem; padding: 4px 8px;">${badgeText}</span>`;
  }

  if (ctrlTimelogContributorsContainer) {
    ctrlTimelogContributorsContainer.innerHTML = `<p style="color: var(--muted); padding: 0.8rem 0; font-size: 0.85rem;">Loading contributor logs...</p>`;
  }
  if (ctrlTimelogSessionsContainer) {
    ctrlTimelogSessionsContainer.innerHTML = `<p style="color: var(--muted); padding: 0.8rem 0; font-size: 0.85rem;">Loading session logs...</p>`;
  }

  const project = pmState.project;
  const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
  const { data, error } = await fetchActivityTimeLogs(projId, actId);

  if (error || !data) {
    if (ctrlTimelogContributorsContainer) {
      ctrlTimelogContributorsContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load time logs: ${error || 'Unknown error'}</div>`;
    }
    if (ctrlTimelogSessionsContainer) {
      ctrlTimelogSessionsContainer.innerHTML = "";
    }
    return;
  }

  const totalSeconds = data.total_logged_seconds || 0;
  const logs = data.time_logs || [];
  const byUser = data.by_user || [];

  if (ctrlTimelogKpiTotalTime) ctrlTimelogKpiTotalTime.textContent = formatDurationSeconds(totalSeconds);
  if (ctrlTimelogKpiSessions) ctrlTimelogKpiSessions.textContent = logs.length;
  if (ctrlTimelogKpiContributors) ctrlTimelogKpiContributors.textContent = byUser.length;

  // Render Contributor Breakdown
  if (ctrlTimelogContributorsContainer) {
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
  }

  // Render Session History
  if (ctrlTimelogSessionsContainer) {
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
}

// ==========================================
// EVENT LISTENERS SETUP
// ==========================================
/**
 * Binds event listeners for Control Project status updates and S-Curve status date changes.
 */
export function setupControlEventListeners() {
  const ctrlStatusDate = document.getElementById("ctrl-status-date");
  const btnCtrlApplyDate = document.getElementById("btn-ctrl-apply-date");
  const btnCtrlToday = document.getElementById("btn-ctrl-today");
  const btnCtrlRefresh = document.getElementById("btn-ctrl-refresh");
  const btnCtrlSeedProgress = document.getElementById("btn-ctrl-seed-progress");

  const ctrlFilterSearch = document.getElementById("ctrl-filter-search");
  const ctrlFilterStatus = document.getElementById("ctrl-filter-status");
  const ctrlFilterCritical = document.getElementById("ctrl-filter-critical");

  const ctrlActivityModal = document.getElementById("ctrl-activity-modal");
  const ctrlActivityForm = document.getElementById("ctrl-activity-form");
  const ctrlModalActId = document.getElementById("ctrl-modal-act-id");
  const ctrlModalStatus = document.getElementById("ctrl-modal-status");
  const ctrlModalProgress = document.getElementById("ctrl-modal-progress");
  const ctrlModalProgVal = document.getElementById("ctrl-modal-prog-val");
  const ctrlModalActStart = document.getElementById("ctrl-modal-act-start");
  const ctrlModalActFinish = document.getElementById("ctrl-modal-act-finish");
  const ctrlModalVerifiedBy = document.getElementById("ctrl-modal-verified-by");
  const ctrlModalNotes = document.getElementById("ctrl-modal-notes");
  const btnCloseCtrlModal = document.getElementById("btn-close-ctrl-modal");
  const btnCancelCtrlModal = document.getElementById("btn-cancel-ctrl-modal");

  const btnOpenTimelogsModal = document.getElementById("btn-open-timelogs-modal");
  const ctrlTimeLogsModal = document.getElementById("ctrl-time-logs-modal");
  const btnCloseCtrlTimelogModal = document.getElementById("btn-close-ctrl-timelog-modal");
  const btnCancelCtrlTimelogModal = document.getElementById("btn-cancel-ctrl-timelog-modal");
  const ctrlTimelogTaskSelect = document.getElementById("ctrl-timelog-task-select");

  // 0. Segmented Sub-Tabs Switching (PDM Network Diagram, Kanban Board, S-Curve, Matrix)
  document.querySelectorAll(".ctrl-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      controlViewState.activeCtrlTab = targetTab;

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

      if (targetTab === "pdm") setTimeout(() => { if (ctrlScurveState.ctrlNetworkInstance) ctrlScurveState.ctrlNetworkInstance.fit({ animation: true }); }, 60);
      else if (targetTab === "kanban") renderControlKanbanBoard();
      else if (targetTab === "scurve" && controlViewState.currentControlModel) renderControlScurve(controlViewState.currentControlModel.s_curve);
    });
  });

  // Collapsible KPI & Status Color Legend Guide
  wireLegendToggle(document.getElementById("btn-toggle-ctrl-legend"), document.getElementById("ctrl-legend-content"), document.getElementById("ctrl-legend-chevron"));

  // PDM Network Zoom, Fit & Filter Controls
  initCtrlPdmControls(() => renderControlNetworkDiagram(controlViewState.currentControlModel, openActivityStatusModal));

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

      const project = pmState.project;
      const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
      try {
        const res = await seedProjectProgress(projId);
        if (res.error) {
          showCtrlAlert("Failed to seed progress: " + res.error, "danger");
        } else {
          showCtrlAlert("Realistic benchmark execution progress loaded successfully!", "success");
          controlViewState.currentControlModel = res.data;
          renderControlKpis(controlViewState.currentControlModel.kpis);
          renderControlNetworkDiagram(controlViewState.currentControlModel, openActivityStatusModal);
          renderControlKanbanBoard();
          renderControlScurve(controlViewState.currentControlModel.s_curve);
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
        if (ctrlModalProgress) ctrlModalProgress.value = 0;
        if (ctrlModalProgVal) ctrlModalProgVal.textContent = "0%";
      } else if (s === "completed" || s === "verified") {
        if (ctrlModalProgress) ctrlModalProgress.value = 100;
        if (ctrlModalProgVal) ctrlModalProgVal.textContent = "100%";
      } else if (s === "in_progress" && (ctrlModalProgress.value === "0" || ctrlModalProgress.value === "100")) {
        if (ctrlModalProgress) ctrlModalProgress.value = 50;
        if (ctrlModalProgVal) ctrlModalProgVal.textContent = "50%";
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
      if (ctrlActivityModal) ctrlActivityModal.style.display = "none";
    });
  }
  if (btnCancelCtrlModal) {
    btnCancelCtrlModal.addEventListener("click", () => {
      if (ctrlActivityModal) ctrlActivityModal.style.display = "none";
    });
  }

  // 7. Modal Form Submit Handler
  if (ctrlActivityForm) {
    ctrlActivityForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const actId = ctrlModalActId ? ctrlModalActId.value : null;
      const project = pmState.project;
      const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
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

      if (ctrlModalStatus && ctrlModalStatus.value === "verified" && !allChecked) {
        const warningEl = document.getElementById("ctrl-modal-checklist-warning");
        if (warningEl) warningEl.style.display = "block";
        alert("All verification checklist acceptance criteria must be checked before confirming Controlled status.");
        return;
      }

      const payload = {
        status: ctrlModalStatus ? ctrlModalStatus.value : "not_started",
        progress_pct: ctrlModalProgress ? (parseFloat(ctrlModalProgress.value) || 0.0) : 0.0,
        actual_start_date: ctrlModalActStart ? (ctrlModalActStart.value || null) : null,
        actual_finish_date: ctrlModalActFinish ? (ctrlModalActFinish.value || null) : null,
        verified_by: ctrlModalVerifiedBy ? (ctrlModalVerifiedBy.value.trim() || null) : null,
        notes: ctrlModalNotes ? (ctrlModalNotes.value.trim() || null) : null,
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
          if (ctrlActivityModal) ctrlActivityModal.style.display = "none";
          controlViewState.currentControlModel = res.data;
          renderControlKpis(controlViewState.currentControlModel.kpis);
          renderControlNetworkDiagram(controlViewState.currentControlModel, openActivityStatusModal);
          renderControlKanbanBoard();
          renderControlScurve(controlViewState.currentControlModel.s_curve);
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
      if (ctrlTimeLogsModal) ctrlTimeLogsModal.style.display = "none";
    });
  }
  if (btnCancelCtrlTimelogModal) {
    btnCancelCtrlTimelogModal.addEventListener("click", () => {
      if (ctrlTimeLogsModal) ctrlTimeLogsModal.style.display = "none";
    });
  }
  if (ctrlTimelogTaskSelect) {
    ctrlTimelogTaskSelect.addEventListener("change", (e) => {
      loadTaskTimeLogs(e.target.value);
    });
  }
}

// ==========================================
// MAIN VIEW RENDER DISPATCHER
// ==========================================
/**
 * Main render dispatcher for Section 5 Control Project (Operational Tracking, S-Curve, EVM).
 */
export async function renderControlScheduleView() {
  const project = pmState.project;
  if (!project) return;
  const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
  const ctrlStatusDate = document.getElementById("ctrl-status-date");
  const dateVal = ctrlStatusDate && ctrlStatusDate.value ? ctrlStatusDate.value : null;

  try {
    const res = await fetchControlSchedule(projId, dateVal);
    if (res.error || !res.data) {
      showCtrlAlert(res.error || "Failed to load control schedule model.", "danger");
      return;
    }

    controlViewState.currentControlModel = res.data;
    if (ctrlStatusDate && !ctrlStatusDate.value && controlViewState.currentControlModel.status_date) {
      ctrlStatusDate.value = controlViewState.currentControlModel.status_date;
    }

    renderControlKpis(controlViewState.currentControlModel.kpis);
    renderControlNetworkDiagram(controlViewState.currentControlModel, openActivityStatusModal);
    renderControlScurve(controlViewState.currentControlModel.s_curve);
    renderControlTasksTable();

    if (!controlViewState.isControlInitialized) {
      setupControlEventListeners();
      controlViewState.isControlInitialized = true;
    }
    updateKickoffButtonsState(controlViewState.currentControlModel.activities);
  } catch (err) {
    showCtrlAlert("Error loading Control Schedule: " + err.message, "danger");
  }
}

// Global hook for kickoff button refresh
window.refreshControlScheduleView = renderControlScheduleView;

// ==========================================
// INITIALIZATION
// ==========================================
export function initControlView() {
  // Event listeners are initialized when view is first rendered
}
