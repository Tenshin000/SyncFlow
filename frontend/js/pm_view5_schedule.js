/**
 * SyncFlow Frontend - PM Workspace View 5: Develop Schedule Controller
 * PMBOK Process 6.5: Develop Schedule.
 * Kick-off transition, CPM KPIs, Float Matrix table, and Gantt chart timeline.
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import {
  fetchProjectSchedule,
  updateProjectScheduleSettings,
  kickoffProject,
  fetchProjectDetail
} from "./api.js";
import { pmState } from "./pm_workspace_state.js";
import { renderScheduleMatrixRowHtml } from "./pm_workspace_templates.js";
import { showTransientAlert } from "./utility.js";
import {
  diagramsState,
  renderAonNetwork,
  renderAoaNetwork,
  loadProjectBaselines,
  initBaselineControls,
  renderDcmaQualityAudit,
  wireLegendToggle,
  wireNetworkZoomControls
} from "./pm_view5_diagrams.js";

// ==========================================
// VIEW STATE
// ==========================================
export const scheduleViewState = {
  currentScheduleModel: null,
  activeSchedTab: "aon",
  isScheduleInitialized: false,
  isThresholdUserModified: false
};

// ==========================================
// NOTIFICATION HELPER
// ==========================================
export function showSchedAlert(msg, type = "success") {
  const schedAlertMsg = document.getElementById("sched-alert-msg");
  showTransientAlert(schedAlertMsg, msg, type, 4000);
}

// ==========================================
// PROJECT KICK-OFF & WIP TRANSITION LOGIC
// ==========================================
export function updateKickoffButtonsState(controlActivities = null) {
  const btnV5 = document.getElementById("btn-kickoff-project");
  const btnV6 = document.getElementById("btn-ctrl-kickoff-project");
  const bannerV5 = document.getElementById("sched-kickoff-container");

  const project = pmState.project || {};
  const acts = controlActivities || project.activities || [];
  const hasStartedTasks = acts.some(a => a.status === "in_progress" || a.status === "completed" || a.status === "verified");
  const totalActs = acts.length;

  [btnV5, btnV6].forEach(btn => {
    if (!btn) return;
    if (totalActs === 0) {
      btn.disabled = true;
      btn.classList.add("disabled");
      btn.style.opacity = "0.65";
      btn.style.cursor = "not-allowed";
      btn.title = "Please create and sequence activities before starting the project.";
      btn.innerHTML = "🚀 Start Project (No Activities)";
    } else if (hasStartedTasks) {
      btn.disabled = true;
      btn.classList.add("disabled");
      btn.style.opacity = "0.65";
      btn.style.cursor = "not-allowed";
      btn.title = "Project has already commenced: initial tasks are in WIP or completed.";
      btn.innerHTML = "✅ Project Already In Progress (WIP)";
    } else {
      btn.disabled = false;
      btn.classList.remove("disabled");
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
      btn.title = "Begin initial project activities and transition them to WIP.";
      btn.innerHTML = "🚀 Start Project (Begin Initial Tasks)";
    }
  });

  if (bannerV5) {
    const hintEl = bannerV5.querySelector(".kickoff-hint-text");
    if (hintEl) {
      if (hasStartedTasks) {
        hintEl.innerHTML = "<strong>Status: Active.</strong> Initial task(s) have commenced. Project execution is actively monitored under Process 6 (Control Schedule).";
      } else {
        hintEl.innerHTML = "Ready to start? Kick off to activate initial zero-predecessor tasks into <strong>Work in Progress (WIP)</strong>.";
      }
    }
  }
}

export async function handleKickoffProject() {
  const project = pmState.project || {};
  const acts = project.activities || [];
  if (acts.length === 0) {
    alert("Cannot start project: No activities have been defined yet. Please create and sequence activities first.");
    return;
  }

  const confirmed = confirm(
    "🚀 Start Project Execution?\n\n" +
    "This will kick off the project and immediately transition all initial activities (activities with no uncompleted predecessors) into 'Work in Progress' (WIP).\n\n" +
    "Members and Controllers will be able to start tracking time and recording deliverables. Continue?"
  );
  if (!confirmed) return;

  const btnV5 = document.getElementById("btn-kickoff-project");
  const btnV6 = document.getElementById("btn-ctrl-kickoff-project");
  if (btnV5) { btnV5.disabled = true; btnV5.innerHTML = "⏳ Starting Project..."; }
  if (btnV6) { btnV6.disabled = true; btnV6.innerHTML = "⏳ Starting Project..."; }

  try {
    const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
    const { data, error } = await kickoffProject(projId);
    if (error) {
      alert("Failed to start project: " + error);
      updateKickoffButtonsState();
      return;
    }

    const initNames = (data.initial_activities || []).map(a => `${a.activity_id}: ${a.name}`).join("\n• ");
    alert(
      "🚀 Project successfully kicked off!\n\n" +
      "The following initial task(s) have been moved to WIP (Work in Progress):\n• " +
      (initNames || "Initial CPM tasks") +
      "\n\nYou can track and control execution in '6. Control Schedule'."
    );

    // Refresh project details
    const { data: freshProject } = await fetchProjectDetail(projId);
    if (freshProject) pmState.project = freshProject;

    // Refresh schedule models and control schedule
    await renderScheduleView();
    if (typeof window.refreshControlScheduleView === "function") {
      await window.refreshControlScheduleView();
    }

    updateKickoffButtonsState();
  } catch (err) {
    alert("Error starting project: " + err.message);
    updateKickoffButtonsState();
  }
}

// ==========================================
// SCHEDULE SUMMARY KPIS
// ==========================================
/**
 * Renders Critical Path duration, project float, and flexible activities KPI cards.
 */
export function renderScheduleKpis(summary) {
  if (!summary) return;

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

  const schedInputImposedDate = document.getElementById("sched-input-imposed-date");
  const schedInputImposedDays = document.getElementById("sched-input-imposed-days");
  const schedSliderNearCrit = document.getElementById("sched-slider-near-crit");
  const schedNearCritValDisplay = document.getElementById("sched-near-crit-val-display");
  const schedMatrixCount = document.getElementById("sched-matrix-count");

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

// ==========================================
// SCHEDULE MATRIX TABLE
// ==========================================
/**
 * Renders comprehensive CPM mathematical table (ES, EF, LS, LF, TF, FF, Dates).
 */
export function renderScheduleMatrix() {
  const schedMatrixTableContainer = document.getElementById("sched-matrix-table-container");
  const schedMatrixSearch = document.getElementById("sched-matrix-search");
  const schedMatrixStatusFilter = document.getElementById("sched-matrix-status-filter");
  const schedMatrixFilteredCount = document.getElementById("sched-matrix-filtered-count");

  if (!schedMatrixTableContainer || !scheduleViewState.currentScheduleModel) return;

  const searchStr = (schedMatrixSearch ? schedMatrixSearch.value : "").trim().toLowerCase();
  const statusFilter = schedMatrixStatusFilter ? schedMatrixStatusFilter.value : "all";

  const allActivities = scheduleViewState.currentScheduleModel.activities_schedule || [];
  const filtered = allActivities.filter(act => {
    const matchesSearch = !searchStr ||
      (act.activity_id && act.activity_id.toLowerCase().includes(searchStr)) ||
      (act.name && act.name.toLowerCase().includes(searchStr)) ||
      (act.work_package_id && act.work_package_id.toLowerCase().includes(searchStr));

    let matchesStatus = true;
    if (statusFilter === "critical") matchesStatus = act.is_critical;
    else if (statusFilter === "near_critical") matchesStatus = act.is_near_critical;
    else if (statusFilter === "flexible") matchesStatus = !act.is_critical && !act.is_near_critical;

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

// ==========================================
// GANTT CHART TIMELINE
// ==========================================
/**
 * Renders interactive Gantt chart displaying early/late spans and milestone diamonds.
 */
export function renderScheduleGantt() {
  const schedGanttContainer = document.getElementById("sched-gantt-container");
  const ganttBaselineLegend = document.getElementById("gantt-baseline-legend");
  if (!schedGanttContainer || !scheduleViewState.currentScheduleModel) return;

  const allActivities = scheduleViewState.currentScheduleModel.activities_schedule || [];
  const totalDays = scheduleViewState.currentScheduleModel.summary.planned_duration_days || 1641;
  const maxTimelineDays = Math.max(totalDays * 1.05, (scheduleViewState.currentScheduleModel.summary.imposed_deadline_days || totalDays) * 1.02);

  const isDualBar = Boolean(diagramsState.selectedBaselineData && diagramsState.selectedBaselineData.length > 0);
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
    const baseAct = isDualBar ? diagramsState.selectedBaselineMap[r.activity_id] : null;
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

// ==========================================
// ACTIVE TAB DISPATCHER
// ==========================================
/**
 * Dispatches rendering of active tab (AON Network, AOA Network, Matrix, Gantt, DCMA Quality).
 */
export function renderActiveSchedTab() {
  const tabKey = scheduleViewState.activeSchedTab;
  if (tabKey === "aon") {
    renderAonNetwork(scheduleViewState.currentScheduleModel);
  } else if (tabKey === "aoa") {
    renderAoaNetwork(scheduleViewState.currentScheduleModel);
  } else if (tabKey === "matrix") {
    renderScheduleMatrix();
  } else if (tabKey === "gantt") {
    renderScheduleGantt();
  } else if (tabKey === "dcma") {
    renderDcmaQualityAudit();
  }
}

// ==========================================
// EVENT LISTENERS SETUP
// ==========================================
/**
 * Sets up event listeners for schedule recalculations, baseline freezing, and tab switching.
 */
export function setupScheduleEventListeners() {
  const btnToggleSchedLegend = document.getElementById("btn-toggle-sched-legend");
  const schedLegendContent = document.getElementById("sched-legend-content");
  const schedLegendChevron = document.getElementById("sched-legend-chevron");

  const schedTabButtons = document.querySelectorAll(".sched-tab-btn");
  const schedTabPanes = document.querySelectorAll(".sched-tab-pane");
  const schedPaneAon = document.getElementById("sched-pane-aon");
  const schedPaneAoa = document.getElementById("sched-pane-aoa");
  const schedPaneMatrix = document.getElementById("sched-pane-matrix");
  const schedPaneGantt = document.getElementById("sched-pane-gantt");

  const schedAonFilterMode = document.getElementById("sched-aon-filter-mode");
  const btnAonZoomIn = document.getElementById("btn-aon-zoom-in");
  const btnAonZoomOut = document.getElementById("btn-aon-zoom-out");
  const btnAonFit = document.getElementById("btn-aon-fit");

  const schedAoaFilterMode = document.getElementById("sched-aoa-filter-mode");
  const btnAoaZoomIn = document.getElementById("btn-aoa-zoom-in");
  const btnAoaZoomOut = document.getElementById("btn-aoa-zoom-out");
  const btnAoaFit = document.getElementById("btn-aoa-fit");

  const schedMatrixSearch = document.getElementById("sched-matrix-search");
  const schedMatrixStatusFilter = document.getElementById("sched-matrix-status-filter");

  const schedSliderNearCrit = document.getElementById("sched-slider-near-crit");
  const schedNearCritValDisplay = document.getElementById("sched-near-crit-val-display");
  const schedThresholdSavedPill = document.getElementById("sched-threshold-saved-pill");
  const schedInputImposedDate = document.getElementById("sched-input-imposed-date");
  const schedInputImposedDays = document.getElementById("sched-input-imposed-days");

  const btnRecalculateSchedule = document.getElementById("btn-recalculate-schedule");
  const btnSaveScheduleSettings = document.getElementById("btn-save-schedule-settings");
  const schedSaveStatus = document.getElementById("sched-save-status");

  wireLegendToggle(btnToggleSchedLegend, schedLegendContent, schedLegendChevron);

  // Tab switching
  schedTabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabKey = btn.getAttribute("data-tab");
      scheduleViewState.activeSchedTab = tabKey;
      schedTabButtons.forEach(b => {
        const isAct = b === btn;
        b.classList.toggle("active", isAct);
        b.style.color = isAct ? "var(--primary)" : "var(--slate)";
        b.style.borderBottom = isAct ? "3px solid var(--primary)" : "3px solid transparent";
        b.style.fontWeight = isAct ? "700" : "600";
      });
      schedTabPanes.forEach(pane => { pane.style.display = "none"; });
      const paneMap = {
        aon: schedPaneAon,
        aoa: schedPaneAoa,
        matrix: schedPaneMatrix,
        gantt: schedPaneGantt,
        dcma: document.getElementById("sched-pane-dcma")
      };
      if (paneMap[tabKey]) paneMap[tabKey].style.display = "block";
      if (tabKey === "aon") {
        renderAonNetwork(scheduleViewState.currentScheduleModel);
        setTimeout(() => { if (diagramsState.aonNetworkInstance) diagramsState.aonNetworkInstance.fit(); }, 100);
      } else if (tabKey === "aoa") {
        renderAoaNetwork(scheduleViewState.currentScheduleModel);
        setTimeout(() => { if (diagramsState.aoaNetworkInstance) diagramsState.aoaNetworkInstance.fit(); }, 100);
      } else if (tabKey === "matrix") {
        renderScheduleMatrix();
      } else if (tabKey === "gantt") {
        renderScheduleGantt();
      } else if (tabKey === "dcma") {
        renderDcmaQualityAudit();
      }
    });
  });

  if (schedAonFilterMode) {
    schedAonFilterMode.addEventListener("change", () => renderAonNetwork(scheduleViewState.currentScheduleModel));
  }
  wireNetworkZoomControls(() => diagramsState.aonNetworkInstance, btnAonZoomIn, btnAonZoomOut, btnAonFit);

  if (schedAoaFilterMode) {
    schedAoaFilterMode.addEventListener("change", () => renderAoaNetwork(scheduleViewState.currentScheduleModel));
  }
  wireNetworkZoomControls(() => diagramsState.aoaNetworkInstance, btnAoaZoomIn, btnAoaZoomOut, btnAoaFit);

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
      const project = pmState.project;
      const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
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
      scheduleViewState.isThresholdUserModified = false;
      renderScheduleView();
    });
  }

  // Imposed Deadline Date & Days synchronization
  if (schedInputImposedDate) {
    schedInputImposedDate.addEventListener("change", (e) => {
      const dateStr = e.target.value;
      if (!dateStr || !scheduleViewState.currentScheduleModel) return;
      const start = new Date(scheduleViewState.currentScheduleModel.summary.planned_start_date);
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
      if (isNaN(days) || !scheduleViewState.currentScheduleModel) return;
      const start = new Date(scheduleViewState.currentScheduleModel.summary.planned_start_date);
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
      const project = pmState.project;
      if (!project) return;
      const payload = {
        imposed_deadline_date: schedInputImposedDate ? schedInputImposedDate.value : null,
        imposed_deadline_days: schedInputImposedDays && schedInputImposedDays.value ? parseFloat(schedInputImposedDays.value) : null,
        near_critical_threshold_days: schedSliderNearCrit ? parseFloat(schedSliderNearCrit.value) : 25.0,
        diagram_mode: scheduleViewState.activeSchedTab,
        notes: "Schedule baseline locked."
      };

      const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
      const res = await updateProjectScheduleSettings(projId, payload);
      if (res.error) {
        showSchedAlert("Failed to save schedule baseline: " + res.error, "danger");
      } else {
        if (res.data && res.data.schedule_settings) {
          project.schedule_settings = res.data.schedule_settings;
        }
        scheduleViewState.isThresholdUserModified = false;
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

  // Kick-off buttons
  const btnKickoffV5 = document.getElementById("btn-kickoff-project");
  if (btnKickoffV5) btnKickoffV5.addEventListener("click", handleKickoffProject);

  const btnKickoffV6 = document.getElementById("btn-ctrl-kickoff-project");
  if (btnKickoffV6) btnKickoffV6.addEventListener("click", handleKickoffProject);

  initBaselineControls(renderScheduleGantt);
}

// ==========================================
// MAIN VIEW RENDER DISPATCHER
// ==========================================
export async function renderScheduleView() {
  const project = pmState.project;
  if (!project) return;

  const schedSliderNearCrit = document.getElementById("sched-slider-near-crit");
  const schedInputImposedDays = document.getElementById("sched-input-imposed-days");
  const schedInputImposedDate = document.getElementById("sched-input-imposed-date");

  const params = {};
  if (scheduleViewState.isThresholdUserModified && schedSliderNearCrit) {
    params.near_critical_threshold = parseFloat(schedSliderNearCrit.value) || 25;
  }
  const impDaysVal = schedInputImposedDays && schedInputImposedDays.value ? parseFloat(schedInputImposedDays.value) : null;
  const impDateVal = schedInputImposedDate && schedInputImposedDate.value ? schedInputImposedDate.value : null;
  if (impDaysVal !== null) params.imposed_deadline_days = impDaysVal;
  if (impDateVal !== null) params.imposed_deadline_date = impDateVal;

  try {
    const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
    const result = await fetchProjectSchedule(projId, params);

    if (result.error || !result.data) {
      showSchedAlert(result.error || "Failed to load schedule model.", "danger");
      return;
    }

    scheduleViewState.currentScheduleModel = result.data;
    renderScheduleKpis(scheduleViewState.currentScheduleModel.summary);
    await loadProjectBaselines();
    renderActiveSchedTab();

    if (!scheduleViewState.isScheduleInitialized) {
      setupScheduleEventListeners();
      scheduleViewState.isScheduleInitialized = true;
    }
    updateKickoffButtonsState();
  } catch (err) {
    showSchedAlert("Error calculating schedule: " + err.message, "danger");
  }
}

// ==========================================
// INITIALIZATION
// ==========================================
export function initScheduleView() {
  updateKickoffButtonsState();
}
