/**
 * SyncFlow Frontend - Member Stopwatch & Time Tracking Controller (member_stopwatch.js)
 * Implements:
 *  - Trello-style live timer ticker and session persistence
 *  - Start / stop timer linked to assigned WIP activities
 *  - Edit timer modal (reallocating time or updating notes)
 *  - Delete timer modal / action
 */

import {
  startActivityTimer,
  stopActivityTimer,
  updateActivityTimeLog,
  deleteActivityTimeLog
} from "./api.js";
import { formatDurationSeconds, formatTimerDigits, escapeHtml } from "./utility.js";
import { memberState, isActAssignedForTimer } from "./member_workspace_state.js";

// =========================================================================
// MODULE SCOPE REFERENCES & CALLBACKS
// =========================================================================
let callbacks = {
  loadAgendaTasks: () => {}
};

// Stopwatch DOM Elements
let stopwatchWidgetContainer = null;
let stopwatchStatusBadge = null;
let stopwatchDigits = null;
let stopwatchLiveLabel = null;
let stopwatchTaskSelect = null;
let stopwatchNotes = null;
let btnStopwatchToggle = null;
let stopwatchMsgBanner = null;

// Edit Timer Modal DOM Elements
let editTimerModal = null;
let editTimerForm = null;
let editTimerLogId = null;
let editTimerSourceActId = null;
let editTimerDurationDisplay = null;
let editTimerTargetAct = null;
let editTimerNotes = null;
let btnCloseEditTimerModal = null;
let btnCancelEditTimerModal = null;

/**
 * Initializes the Stopwatch and Timer Management module.
 */
export function initMemberStopwatch(cbs) {
  callbacks = { ...callbacks, ...cbs };

  // DOM Elements - Stopwatch Widget
  stopwatchWidgetContainer = document.getElementById("stopwatch-widget-container");
  stopwatchStatusBadge = document.getElementById("stopwatch-status-badge");
  stopwatchDigits = document.getElementById("stopwatch-digits");
  stopwatchLiveLabel = document.getElementById("stopwatch-live-label");
  stopwatchTaskSelect = document.getElementById("stopwatch-task-select");
  stopwatchNotes = document.getElementById("stopwatch-notes");
  btnStopwatchToggle = document.getElementById("btn-stopwatch-toggle");
  stopwatchMsgBanner = document.getElementById("stopwatch-msg-banner");

  if (btnStopwatchToggle) {
    btnStopwatchToggle.addEventListener("click", () => {
      if (memberState.activeTimerState) {
        handleStopTimer();
      } else {
        const selId = stopwatchTaskSelect ? stopwatchTaskSelect.value : "";
        const notes = stopwatchNotes ? stopwatchNotes.value.trim() : "";
        handleStartTimer(selId, notes);
      }
    });
  }

  // DOM Elements - Edit Timer Modal
  editTimerModal = document.getElementById("edit-timer-modal");
  editTimerForm = document.getElementById("edit-timer-form");
  editTimerLogId = document.getElementById("edit-timer-log-id");
  editTimerSourceActId = document.getElementById("edit-timer-source-act-id");
  editTimerDurationDisplay = document.getElementById("edit-timer-duration-display");
  editTimerTargetAct = document.getElementById("edit-timer-target-act");
  editTimerNotes = document.getElementById("edit-timer-notes");
  btnCloseEditTimerModal = document.getElementById("btn-close-edit-timer-modal");
  btnCancelEditTimerModal = document.getElementById("btn-cancel-edit-timer-modal");

  if (btnCloseEditTimerModal) btnCloseEditTimerModal.addEventListener("click", closeEditTimerModal);
  if (btnCancelEditTimerModal) btnCancelEditTimerModal.addEventListener("click", closeEditTimerModal);

  if (editTimerForm) {
    editTimerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const logId = editTimerLogId.value;
      const sourceActId = editTimerSourceActId.value;
      const targetActId = editTimerTargetAct.value;
      const newNotes = editTimerNotes.value.trim();

      const saveBtn = document.getElementById("btn-save-edit-timer");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
      }

      const { data, error } = await updateActivityTimeLog(memberState.activeProjectId, sourceActId, logId, {
        user_id: memberState.userId,
        notes: newNotes,
        target_activity_id: targetActId
      });

      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Save Changes";
      }

      if (error) {
        alert(`Failed to update timer: ${error}`);
        return;
      }

      closeEditTimerModal();
      await callbacks.loadAgendaTasks();
    });
  }
}

// =========================================================================
// LIVE STOPWATCH TICKER & STATE MANAGEMENT
// =========================================================================

/**
 * Displays a transient status or error message within the stopwatch widget.
 */
export function showStopwatchMessage(text, type = "info") {
  if (!stopwatchMsgBanner) return;
  stopwatchMsgBanner.textContent = text;
  stopwatchMsgBanner.style.display = "block";
  if (type === "success") {
    stopwatchMsgBanner.style.background = "#DCFCE7";
    stopwatchMsgBanner.style.color = "#15803D";
    stopwatchMsgBanner.style.border = "1px solid #86EFAC";
  } else if (type === "danger") {
    stopwatchMsgBanner.style.background = "#FEE2E2";
    stopwatchMsgBanner.style.color = "#DC2626";
    stopwatchMsgBanner.style.border = "1px solid #FCA5A5";
  } else {
    stopwatchMsgBanner.style.background = "#EFF6FF";
    stopwatchMsgBanner.style.color = "#1E40AF";
    stopwatchMsgBanner.style.border = "1px solid #BFDBFE";
  }
  setTimeout(() => {
    if (stopwatchMsgBanner) stopwatchMsgBanner.style.display = "none";
  }, 6000);
}

/**
 * Populates stopwatch dropdown with activities currently in progress (WIP) and assigned to user
 * (considering Lead and Controller roles as assigned).
 */
export function updateStopwatchWipOptions(activities) {
  if (!stopwatchTaskSelect) return;
  const wipActs = (activities || []).filter(a => a.status === "in_progress" && isActAssignedForTimer(a));
  const currentVal = stopwatchTaskSelect.value;

  if (wipActs.length === 0) {
    stopwatchTaskSelect.innerHTML = `<option value="" disabled selected>⚠️ No activities assigned to you currently in progress (WIP) — start an activity first</option>`;
    if (!memberState.activeTimerState && btnStopwatchToggle) {
      btnStopwatchToggle.disabled = true;
    }
    return;
  }

  if (!memberState.activeTimerState && btnStopwatchToggle) {
    btnStopwatchToggle.disabled = false;
  }

  let opts = `<option value="">-- Select an In-Progress (WIP) Activity to Track --</option>`;
  wipActs.forEach(a => {
    const logged = a.total_logged_seconds ? ` (${formatDurationSeconds(a.total_logged_seconds)})` : "";
    opts += `<option value="${a.activity_id}">[${a.activity_id}] ${escapeHtml(a.name)}${logged}</option>`;
  });
  stopwatchTaskSelect.innerHTML = opts;

  if (memberState.activeTimerState && memberState.activeTimerState.activityId) {
    stopwatchTaskSelect.value = memberState.activeTimerState.activityId;
    stopwatchTaskSelect.disabled = true;
  } else if (currentVal && wipActs.some(a => a.activity_id === currentVal)) {
    stopwatchTaskSelect.value = currentVal;
  }
}

/**
 * Initiates local timer ticker updating stopwatch digital display every second.
 */
export function startStopwatchTicker(startTimeMs) {
  if (memberState.stopwatchTimerInterval) clearInterval(memberState.stopwatchTimerInterval);
  const updateTick = () => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000));
    if (stopwatchDigits) stopwatchDigits.textContent = formatTimerDigits(elapsedSec);
  };
  updateTick();
  memberState.stopwatchTimerInterval = setInterval(updateTick, 1000);
}

/**
 * Restores active stopwatch state from localStorage or checks backend timer status.
 */
export function restoreOrSyncActiveTimer() {
  try {
    const raw = localStorage.getItem("syncflow_active_timer");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && saved.projectId === memberState.activeProjectId) {
      memberState.activeTimerState = saved;
      if (stopwatchWidgetContainer) stopwatchWidgetContainer.classList.add("active-tracking");
      if (stopwatchStatusBadge) {
        stopwatchStatusBadge.textContent = "● TRACKING ACTIVE";
        stopwatchStatusBadge.style.background = "#DCFCE7";
        stopwatchStatusBadge.style.color = "#15803D";
      }
      if (stopwatchLiveLabel) stopwatchLiveLabel.style.display = "inline-flex";
      if (stopwatchTaskSelect) {
        stopwatchTaskSelect.value = saved.activityId;
        stopwatchTaskSelect.disabled = true;
      }
      if (stopwatchNotes && saved.notes) stopwatchNotes.value = saved.notes;
      if (btnStopwatchToggle) {
        btnStopwatchToggle.textContent = "⏹ Stop & Log Time";
        btnStopwatchToggle.className = "btn btn-danger";
        btnStopwatchToggle.disabled = false;
      }
      startStopwatchTicker(saved.startTimeMs);
    }
  } catch (e) {
    console.warn("Failed to restore timer from storage:", e);
  }
}

/**
 * Initiates a live timer for an assigned WIP activity via the backend API.
 */
export async function handleStartTimer(targetActivityId, optionalNotes = "") {
  if (!memberState.activeProjectId) {
    showStopwatchMessage("No active project selected.", "danger");
    return;
  }

  if (!targetActivityId) {
    showStopwatchMessage("⚠️ Before starting a timer, it must be linked to an Activity currently in progress (WIP).", "danger");
    return;
  }

  // Verify WIP status
  const allActs = (memberState.currentControlModel && memberState.currentControlModel.activities) || [];
  const act = allActs.find(a => a.activity_id === targetActivityId);
  if (!act || act.status !== "in_progress") {
    showStopwatchMessage(`⚠️ Activity [${targetActivityId}] is not in progress. Timers can only be run on WIP activities.`, "danger");
    return;
  }

  if (!isActAssignedForTimer(act)) {
    showStopwatchMessage("⚠️ The Activity to which you attach the timer must also be assigned to you. Otherwise, you cannot select it.", "danger");
    return;
  }

  const fn = memberState.user ? memberState.user.first_name || "" : "";
  const ln = memberState.user ? memberState.user.last_name || "" : "";
  const userName = `${fn} ${ln}`.trim() || (memberState.user ? memberState.user.username : "") || "Team Member";

  if (btnStopwatchToggle) {
    btnStopwatchToggle.disabled = true;
    btnStopwatchToggle.textContent = "Starting...";
  }

  const { data, error } = await startActivityTimer(memberState.activeProjectId, targetActivityId, {
    user_id: memberState.userId,
    user_name: userName,
    notes: optionalNotes
  });

  if (error) {
    if (btnStopwatchToggle) {
      btnStopwatchToggle.disabled = false;
      btnStopwatchToggle.textContent = "▶ Start Timer";
    }
    showStopwatchMessage(`Failed to start timer: ${error}`, "danger");
    return;
  }

  const now = Date.now();
  memberState.activeTimerState = {
    projectId: memberState.activeProjectId,
    activityId: targetActivityId,
    activityName: act.name,
    startTimeMs: now,
    notes: optionalNotes
  };

  try {
    localStorage.setItem("syncflow_active_timer", JSON.stringify(memberState.activeTimerState));
  } catch (e) {}

  if (stopwatchWidgetContainer) stopwatchWidgetContainer.classList.add("active-tracking");
  if (stopwatchStatusBadge) {
    stopwatchStatusBadge.textContent = "● TRACKING ACTIVE";
    stopwatchStatusBadge.style.background = "#DCFCE7";
    stopwatchStatusBadge.style.color = "#15803D";
  }
  if (stopwatchLiveLabel) stopwatchLiveLabel.style.display = "inline-flex";
  if (stopwatchTaskSelect) {
    stopwatchTaskSelect.value = targetActivityId;
    stopwatchTaskSelect.disabled = true;
  }
  if (btnStopwatchToggle) {
    btnStopwatchToggle.disabled = false;
    btnStopwatchToggle.textContent = "⏹ Stop & Log Time";
    btnStopwatchToggle.className = "btn btn-danger";
  }

  startStopwatchTicker(now);
  showStopwatchMessage(`⏱️ Timer started for [${targetActivityId}]! Tracking session live.`, "success");
}

/**
 * Stops active stopwatch timer, commits elapsed seconds, and refreshes project schedule.
 */
export async function handleStopTimer() {
  if (!memberState.activeTimerState || !memberState.activeProjectId) return;
  const elapsedSec = Math.max(1, Math.floor((Date.now() - memberState.activeTimerState.startTimeMs) / 1000));
  const fn = memberState.user ? memberState.user.first_name || "" : "";
  const ln = memberState.user ? memberState.user.last_name || "" : "";
  const userName = `${fn} ${ln}`.trim() || (memberState.user ? memberState.user.username : "") || "Team Member";
  const notes = (stopwatchNotes && stopwatchNotes.value.trim()) || memberState.activeTimerState.notes || "";

  if (btnStopwatchToggle) {
    btnStopwatchToggle.disabled = true;
    btnStopwatchToggle.textContent = "Saving session...";
  }

  const { data, error } = await stopActivityTimer(memberState.activeProjectId, memberState.activeTimerState.activityId, {
    user_id: memberState.userId,
    user_name: userName,
    duration_seconds: elapsedSec,
    notes: notes
  });

  if (memberState.stopwatchTimerInterval) {
    clearInterval(memberState.stopwatchTimerInterval);
    memberState.stopwatchTimerInterval = null;
  }
  try {
    localStorage.removeItem("syncflow_active_timer");
  } catch (e) {}

  const loggedActId = memberState.activeTimerState.activityId;
  memberState.activeTimerState = null;

  if (stopwatchWidgetContainer) stopwatchWidgetContainer.classList.remove("active-tracking");
  if (stopwatchStatusBadge) {
    stopwatchStatusBadge.textContent = "IDLE";
    stopwatchStatusBadge.style.background = "#F1F5F9";
    stopwatchStatusBadge.style.color = "#64748B";
  }
  if (stopwatchLiveLabel) stopwatchLiveLabel.style.display = "none";
  if (stopwatchDigits) stopwatchDigits.textContent = "00:00:00";
  if (stopwatchTaskSelect) stopwatchTaskSelect.disabled = false;
  if (stopwatchNotes) stopwatchNotes.value = "";
  if (btnStopwatchToggle) {
    btnStopwatchToggle.disabled = false;
    btnStopwatchToggle.textContent = "▶ Start Timer";
    btnStopwatchToggle.className = "btn btn-primary";
  }

  if (error) {
    showStopwatchMessage(`Session stopped with warning: ${error}`, "danger");
  } else {
    showStopwatchMessage(`✅ Successfully logged ${formatDurationSeconds(elapsedSec)} on [${loggedActId}]!`, "success");
  }

  await callbacks.loadAgendaTasks();
}

/**
 * Shortcut to select a task and immediately start tracking time on it.
 */
export async function selectAndStartTaskTimer(targetActId) {
  if (!memberState.currentControlModel) return;
  const act = (memberState.currentControlModel.activities || []).find(a => a.activity_id === targetActId);
  if (!act) return;

  if (act.status !== "in_progress") {
    alert(`⚠️ Cannot start timer on [${targetActId}]: Activity must be in progress (WIP). Current status is "${(act.status || '').replace('_', ' ')}".`);
    return;
  }

  if (!isActAssignedForTimer(act)) {
    alert(`⚠️ The Activity to which you attach the timer must also be assigned to you. Otherwise, you cannot select it.`);
    return;
  }

  if (memberState.activeTimerState) {
    if (memberState.activeTimerState.activityId === targetActId) {
      showStopwatchMessage(`⏱️ Timer is already tracking [${targetActId}].`, "info");
      if (stopwatchWidgetContainer) stopwatchWidgetContainer.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const confirmSwitch = confirm(`A timer is already active on [${memberState.activeTimerState.activityId}]. Stop it and switch to [${targetActId}]?`);
    if (!confirmSwitch) return;
    await handleStopTimer();
  }

  if (stopwatchTaskSelect) {
    stopwatchTaskSelect.value = targetActId;
  }
  await handleStartTimer(targetActId, stopwatchNotes ? stopwatchNotes.value.trim() : "");
  if (stopwatchWidgetContainer) {
    stopwatchWidgetContainer.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// =========================================================================
// EDIT & DELETE TIMER MODAL ACTIONS
// =========================================================================

/**
 * Opens modal dialog to update timer notes or reassign timer to another assigned WIP activity.
 */
export function openEditTimerModal(logId, actId) {
  if (!editTimerModal || !memberState.currentControlModel) return;
  const allActivities = memberState.currentControlModel.activities || [];
  const sourceAct = allActivities.find(a => a.activity_id === actId);
  if (!sourceAct) return;
  const log = (sourceAct.time_logs || []).find(l => l.log_id === logId);
  if (!log) return;

  if (editTimerLogId) editTimerLogId.value = logId;
  if (editTimerSourceActId) editTimerSourceActId.value = actId;
  if (editTimerDurationDisplay) editTimerDurationDisplay.value = formatDurationSeconds(log.duration_seconds || 0);
  if (editTimerNotes) editTimerNotes.value = log.notes || "";

  // Target activities must be assigned to user (including Lead and Controller roles) and in progress (WIP)
  const assignedWipActs = allActivities.filter(a => isActAssignedForTimer(a) && a.status === "in_progress");
  
  let opts = "";
  if (!assignedWipActs.some(a => a.activity_id === actId)) {
    opts += `<option value="${sourceAct.activity_id}">[${sourceAct.activity_id}] ${escapeHtml(sourceAct.name)} (Current Task - ${sourceAct.status ? sourceAct.status.replace('_', ' ') : ''})</option>`;
  }
  assignedWipActs.forEach(a => {
    opts += `<option value="${a.activity_id}">[${a.activity_id}] ${escapeHtml(a.name)} (WIP)</option>`;
  });

  if (editTimerTargetAct) {
    editTimerTargetAct.innerHTML = opts;
    editTimerTargetAct.value = actId;
  }

  editTimerModal.style.display = "flex";
}

/**
 * Closes the timer edit modal dialog.
 */
export function closeEditTimerModal() {
  if (editTimerModal) editTimerModal.style.display = "none";
}

/**
 * Deletes a user-generated timer log and deducts duration from the activity total.
 */
export async function handleDeleteTimer(logId, actId, durationSec) {
  const durStr = formatDurationSeconds(parseInt(durationSec, 10) || 0);
  const confirmed = confirm(`Are you sure you want to delete this timer log (${durStr} on [${actId}])? This will remove the recorded time from the activity.`);
  if (!confirmed) return;

  const { data, error } = await deleteActivityTimeLog(memberState.activeProjectId, actId, logId, memberState.userId);
  if (error) {
    alert(`Failed to delete timer: ${error}`);
    return;
  }

  await callbacks.loadAgendaTasks();
}
