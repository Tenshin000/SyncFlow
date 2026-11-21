/**
 * SyncFlow Frontend - Member Modals (member_modals.js)
 * Implements execution and review dialogs:
 *  - Controller Review & Sign-Off Modal (verification checklist, signoff, return to WIP)
 *  - Member Deliverable Completion Proof Modal (submitting deliverables and requesting review)
 *  - Member Activity Details Modal (execution details, schedule variance, progress slider)
 */

import { updateActivityStatus } from "./api.js";
import { escapeHtml, CONTROLLER_CHECKLIST } from "./utility.js";
import {
  memberState,
  resolveUser,
  isUserController
} from "./member_workspace_state.js";

// =========================================================================
// MODULE SCOPE REFERENCES & CALLBACKS
// =========================================================================
let callbacks = {
  loadAgendaTasks: () => {},
  refreshSidebarBadge: () => {}
};

// Controller Review Modal Elements
let controllerReviewModal = null;
let btnCloseReviewModal = null;
let btnCancelReviewModal = null;
let controllerReviewForm = null;
let modalReviewTitle = null;
let modalReviewSubtitle = null;
let modalReviewInfo = null;
let modalReviewAction = null;
let modalReviewDescription = null;
let selectedReviewAct = null;

// Member Completion Proof Modal Elements
let memberCompletionModal = null;
let btnCloseCompleteModal = null;
let btnCancelCompleteModal = null;
let memberCompletionForm = null;
let modalCompleteTitle = null;
let modalCompleteSubtitle = null;
let modalCompleteInfo = null;
let inputCompletionProof = null;
let selectedCompleteAct = null;

// Member Activity Detail Modal Elements
let memberActivityModal = null;
let memberActivityForm = null;
let btnCloseModal = null;
let btnCancelModal = null;
let modalActId = null;
let modalActNameDisplay = null;
let modalActInfoDisplay = null;
let modalActStatus = null;
let modalOptVerified = null;
let modalActProgressRange = null;
let modalActProgressNum = null;
let modalActStartDate = null;
let modalActFinishDate = null;
let modalControllerSignoffBox = null;
let modalSignoffCheck = null;
let modalSignoffUser = null;
let selectedModalAct = null;

/**
 * Initializes the Modal dialog controllers and event handlers.
 */
export function initMemberModals(cbs) {
  callbacks = { ...callbacks, ...cbs };

  // DOM Elements - Controller Review Modal
  controllerReviewModal = document.getElementById("controller-review-modal");
  btnCloseReviewModal = document.getElementById("btn-close-review-modal");
  btnCancelReviewModal = document.getElementById("btn-cancel-review-modal");
  controllerReviewForm = document.getElementById("controller-review-form");
  modalReviewTitle = document.getElementById("modal-review-title");
  modalReviewSubtitle = document.getElementById("modal-review-subtitle");
  modalReviewInfo = document.getElementById("modal-review-info");
  modalReviewAction = document.getElementById("modal-review-action");
  modalReviewDescription = document.getElementById("modal-review-description");

  if (btnCloseReviewModal) btnCloseReviewModal.addEventListener("click", closeControllerReviewModal);
  if (btnCancelReviewModal) btnCancelReviewModal.addEventListener("click", closeControllerReviewModal);
  if (controllerReviewForm) controllerReviewForm.addEventListener("submit", handleControllerReviewSubmit);

  // DOM Elements - Member Completion Proof Modal
  memberCompletionModal = document.getElementById("member-completion-modal");
  btnCloseCompleteModal = document.getElementById("btn-close-complete-modal");
  btnCancelCompleteModal = document.getElementById("btn-cancel-complete-modal");
  memberCompletionForm = document.getElementById("member-completion-form");
  modalCompleteTitle = document.getElementById("modal-complete-title");
  modalCompleteSubtitle = document.getElementById("modal-complete-subtitle");
  modalCompleteInfo = document.getElementById("modal-complete-info");
  inputCompletionProof = document.getElementById("input-completion-proof");

  if (btnCloseCompleteModal) btnCloseCompleteModal.addEventListener("click", closeMemberCompletionModal);
  if (btnCancelCompleteModal) btnCancelCompleteModal.addEventListener("click", closeMemberCompletionModal);
  if (memberCompletionForm) memberCompletionForm.addEventListener("submit", handleMemberCompletionSubmit);

  // DOM Elements - Member Activity Detail Modal
  memberActivityModal = document.getElementById("member-activity-modal");
  memberActivityForm = document.getElementById("member-activity-form");
  btnCloseModal = document.getElementById("btn-close-member-modal");
  btnCancelModal = document.getElementById("btn-cancel-member-modal");
  modalActId = document.getElementById("modal-act-id");
  modalActNameDisplay = document.getElementById("modal-act-name-display");
  modalActInfoDisplay = document.getElementById("modal-act-info-display");
  modalActStatus = document.getElementById("modal-act-status");
  modalOptVerified = document.getElementById("modal-opt-verified");
  modalActProgressRange = document.getElementById("modal-act-progress-range");
  modalActProgressNum = document.getElementById("modal-act-progress-num");
  modalActStartDate = document.getElementById("modal-act-start-date");
  modalActFinishDate = document.getElementById("modal-act-finish-date");
  modalControllerSignoffBox = document.getElementById("modal-controller-signoff-box");
  modalSignoffCheck = document.getElementById("modal-signoff-check");
  modalSignoffUser = document.getElementById("modal-signoff-user");

  if (btnCloseModal) btnCloseModal.addEventListener("click", closeMemberActivityModal);
  if (btnCancelModal) btnCancelModal.addEventListener("click", closeMemberActivityModal);

  if (!memberState.isController && modalOptVerified) {
    modalOptVerified.disabled = true;
    modalOptVerified.textContent = "🔵 Completed & Verified (Requires Controller Role)";
  }

  if (modalActProgressRange) {
    modalActProgressRange.addEventListener("input", () => {
      if (modalActProgressNum) modalActProgressNum.textContent = `${modalActProgressRange.value}%`;
      const val = parseInt(modalActProgressRange.value, 10);
      if (val === 0) {
        if (modalActStatus) modalActStatus.value = "not_started";
      } else if (val === 100) {
        if (selectedModalAct && isUserController(selectedModalAct) && modalSignoffCheck && modalSignoffCheck.checked) {
          if (modalActStatus) modalActStatus.value = "verified";
        } else {
          if (modalActStatus) modalActStatus.value = "completed";
        }
      } else {
        if (modalActStatus) modalActStatus.value = "in_progress";
      }
    });
  }

  if (modalActStatus) {
    modalActStatus.addEventListener("change", () => {
      const val = modalActStatus.value;
      if (val === "not_started") {
        if (modalActProgressRange) modalActProgressRange.value = 0;
      } else if (val === "completed" || val === "verified") {
        if (modalActProgressRange) modalActProgressRange.value = 100;
      } else if (val === "in_progress" && parseInt(modalActProgressRange.value, 10) === 0) {
        if (modalActProgressRange) modalActProgressRange.value = 50;
      }
      if (modalActProgressNum && modalActProgressRange) {
        modalActProgressNum.textContent = `${modalActProgressRange.value}%`;
      }
    });
  }

  if (memberActivityForm) {
    memberActivityForm.addEventListener("submit", handleMemberActivitySubmit);
  }
}

// =========================================================================
// CONTROLLER REVIEW MODAL
// =========================================================================

/**
 * Opens the Controller Review & Sign-Off modal dialog.
 */
export function openControllerReviewModal(act, defaultAction = "verified") {
  selectedReviewAct = act;
  if (modalReviewTitle) modalReviewTitle.textContent = `🛡️ Controller Review: ${act.name}`;
  if (modalReviewSubtitle) modalReviewSubtitle.textContent = act.activity_id;
  if (modalReviewInfo) {
    let teamsDisplay = (act.assigned_teams || []).join(", ") || "None";
    if (memberState.activeProject && memberState.activeProject.teams && act.assigned_teams && act.assigned_teams.length > 0) {
      teamsDisplay = act.assigned_teams.map(tId => {
        const tm = memberState.activeProject.teams.find(t => String(t.team_id) === String(tId) || String(t.name) === String(tId));
        return tm ? tm.name : tId;
      }).join(", ");
    }
    let usersDisplay = (act.assigned_users || []).join(", ") || "None";
    if (act.assigned_users && act.assigned_users.length > 0) {
      usersDisplay = act.assigned_users.map(uId => {
        const u = resolveUser(uId);
        return u.username ? `${u.first_name || ""} ${u.last_name || ""} (@${u.username})`.trim() : uId;
      }).join(", ");
    }
    let ctrlDisplay = "None appointed";
    if (act.controller_id) {
      const cu = resolveUser(act.controller_id);
      ctrlDisplay = cu.username ? `${cu.first_name || ""} ${cu.last_name || ""} (@${cu.username})`.trim() : act.controller_id;
    }

    modalReviewInfo.innerHTML = `
      <strong>Activity:</strong> ${escapeHtml(act.name)} (${act.activity_id})<br>
      <strong>Plan Duration:</strong> ${act.duration} days | <strong>Status:</strong> 🟢 Completed (Awaiting Controller Review)<br>
      <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #BFDBFE;">
        <strong>Activity Staff:</strong><br>
        &bull; <strong>Assigned Teams:</strong> ${teamsDisplay} | <strong>Contributors:</strong> ${usersDisplay}<br>
        &bull; <strong>Appointed Controller:</strong> ${ctrlDisplay}
      </div>
    `;
  }

  // Display Member Deliverable Evidence Proof
  const proofContainer = document.getElementById("modal-review-proof-container");
  const proofTextEl = document.getElementById("modal-review-proof-text");
  if (proofContainer && proofTextEl) {
    if (act.completion_proof && act.completion_proof.trim()) {
      proofTextEl.textContent = act.completion_proof;
      proofContainer.style.display = "block";
    } else {
      proofContainer.style.display = "none";
    }
  }

  // Populate Structured Verification Checklist
  const chkContainer = document.getElementById("modal-review-checklist-items");
  const chkWarning = document.getElementById("modal-review-checklist-warning");
  if (chkWarning) chkWarning.style.display = "none";

  if (chkContainer) {
    const savedChecklist = act.verification_checklist || [];
    const savedMap = {};
    savedChecklist.forEach(item => { savedMap[item.id] = Boolean(item.checked); });

    let chkHtml = "";
    CONTROLLER_CHECKLIST.forEach(crit => {
      const isChecked = savedMap[crit.id] !== undefined ? savedMap[crit.id] : (act.status === "verified");
      chkHtml += `
        <label class="checklist-item">
          <input type="checkbox" class="ctrl-review-chk-item" data-id="${crit.id}" ${isChecked ? "checked" : ""}>
          <span>${crit.text}</span>
        </label>
      `;
    });
    chkContainer.innerHTML = chkHtml;
  }

  if (modalReviewAction) modalReviewAction.value = defaultAction;
  if (modalReviewDescription) modalReviewDescription.value = "";
  if (controllerReviewModal) controllerReviewModal.style.display = "flex";
}

/**
 * Closes the Controller Review modal dialog.
 */
export function closeControllerReviewModal() {
  if (controllerReviewModal) controllerReviewModal.style.display = "none";
  selectedReviewAct = null;
}

async function handleControllerReviewSubmit(e) {
  e.preventDefault();
  if (!selectedReviewAct || !memberState.activeProjectId) return;

  const action = modalReviewAction.value;
  const desc = modalReviewDescription.value.trim();
  if (!desc) {
    alert("Please provide mandatory review notes / feedback for the Project Manager.");
    return;
  }

  // Check checklist criteria if verifying
  const checklistItems = [];
  let allChecked = true;
  document.querySelectorAll(".ctrl-review-chk-item").forEach(chk => {
    const cid = chk.getAttribute("data-id");
    const crit = CONTROLLER_CHECKLIST.find(c => c.id === cid) || { text: cid };
    const isChk = chk.checked;
    if (!isChk) allChecked = false;
    checklistItems.push({ id: cid, text: crit.text, checked: isChk });
  });

  if (action === "verified" && !allChecked) {
    const warningEl = document.getElementById("modal-review-checklist-warning");
    if (warningEl) warningEl.style.display = "block";
    alert("All verification checklist acceptance criteria must be checked before confirming Controlled status.");
    return;
  }

  const payload = {
    status: action,
    reviewer_id: memberState.userId,
    description: desc,
    verification_checklist: checklistItems
  };

  const fn = memberState.user ? memberState.user.first_name || "" : "";
  const ln = memberState.user ? memberState.user.last_name || "" : "";
  if (action === "verified") {
    payload.verified_by = `${fn} ${ln} (Controller)`.trim();
    payload.verified_date = new Date().toISOString().split("T")[0];
  }

  const { error } = await updateActivityStatus(memberState.activeProjectId, selectedReviewAct.activity_id, payload);
  if (error) {
    alert(`Failed to save controller review decision: ${error}`);
    return;
  }

  alert(action === "verified"
    ? "Activity confirmed as Controlled & Verified (Blue)! Subsequent activities have begun on the nearest business day."
    : "Activity returned to WIP (Yellow). Notification sent to the Project Manager and assigned team.");

  closeControllerReviewModal();
  await callbacks.loadAgendaTasks();
  callbacks.refreshSidebarBadge();
  if (memberState.bellCtrl) memberState.bellCtrl.refresh();
}

// =========================================================================
// MEMBER COMPLETION PROOF MODAL
// =========================================================================

/**
 * Opens the Task Completion & Deliverable Evidence modal dialog.
 */
export function openMemberCompletionModal(act) {
  selectedCompleteAct = act;
  if (modalCompleteTitle) modalCompleteTitle.textContent = `✅ Mark Complete: ${act.name}`;
  if (modalCompleteSubtitle) modalCompleteSubtitle.textContent = act.activity_id;
  if (modalCompleteInfo) {
    modalCompleteInfo.innerHTML = `
      <strong>Activity ID:</strong> ${act.activity_id}<br>
      <strong>Name:</strong> ${escapeHtml(act.name)}<br>
      <strong>Plan Duration:</strong> ${act.duration}d | <strong>Current Status:</strong> 🟡 Work-in-Progress (WIP)
    `;
  }
  if (inputCompletionProof) inputCompletionProof.value = act.completion_proof || "";
  if (memberCompletionModal) memberCompletionModal.style.display = "flex";
  if (inputCompletionProof) inputCompletionProof.focus();
}

/**
 * Closes the Task Completion modal dialog.
 */
export function closeMemberCompletionModal() {
  if (memberCompletionModal) memberCompletionModal.style.display = "none";
  selectedCompleteAct = null;
}

async function handleMemberCompletionSubmit(e) {
  e.preventDefault();
  if (!selectedCompleteAct || !memberState.activeProjectId) return;

  const proofText = inputCompletionProof.value.trim();
  if (!proofText) {
    alert("Please describe the deliverables completed or provide verification evidence.");
    return;
  }

  const submitBtn = document.getElementById("btn-submit-complete");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
  }

  try {
    const { error } = await updateActivityStatus(memberState.activeProjectId, selectedCompleteAct.activity_id, {
      status: "completed",
      reviewer_id: memberState.userId,
      completion_proof: proofText
    });

    if (error) {
      alert(`Failed to submit activity for review: ${error}`);
      return;
    }

    alert(`Activity '${selectedCompleteAct.name}' marked complete with evidence! Controller has been notified.`);
    closeMemberCompletionModal();
    await callbacks.loadAgendaTasks();
    callbacks.refreshSidebarBadge();
    if (memberState.bellCtrl) memberState.bellCtrl.refresh();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "🚀 Submit Deliverable & Request Review";
    }
  }
}

// =========================================================================
// MEMBER ACTIVITY DETAIL MODAL
// =========================================================================

/**
 * Opens read-only activity detail modal dialog.
 */
export function openMemberActivityModal(act) {
  selectedModalAct = act;
  if (modalActId) modalActId.textContent = act.activity_id;
  if (modalActNameDisplay) modalActNameDisplay.textContent = act.name || "Activity Execution";

  let teamsDisplay = "None";
  if (act.assigned_teams && act.assigned_teams.length > 0) {
    teamsDisplay = act.assigned_teams.map(tId => {
      const tm = memberState.activeProject && memberState.activeProject.teams ? memberState.activeProject.teams.find(t => String(t.team_id) === String(tId) || String(t.name) === String(tId)) : null;
      return tm ? tm.name : tId;
    }).join(", ");
  }
  let usersDisplay = "None";
  if (act.assigned_users && act.assigned_users.length > 0) {
    usersDisplay = act.assigned_users.map(uId => {
      const u = resolveUser(uId);
      return u.username ? `${u.first_name || ""} ${u.last_name || ""} (@${u.username})`.trim() : uId;
    }).join(", ");
  }
  let ctrlDisplay = "None appointed";
  if (act.controller_id) {
    const cu = resolveUser(act.controller_id);
    ctrlDisplay = cu.username ? `${cu.first_name || ""} ${cu.last_name || ""} (@${cu.username})`.trim() : act.controller_id;
  }

  if (modalActInfoDisplay) {
    modalActInfoDisplay.innerHTML = `
      <strong>Activity:</strong> ${escapeHtml(act.name)} (${act.activity_id})<br>
      <strong>Duration:</strong> ${act.duration} days | <strong>Planned ES/EF:</strong> Day ${act.es || 0} → Day ${act.ef || act.duration}<br>
      <strong>Schedule Variance:</strong> ${act.sv_days !== undefined ? (act.sv_days >= 0 ? '+' : '') + act.sv_days.toFixed(1) + 'd' : '0.0d'}<br>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 0.86rem;">
        <strong style="color: var(--charcoal);">👥 Activity Staff:</strong><br>
        &bull; <strong>Assigned Teams:</strong> ${teamsDisplay}<br>
        &bull; <strong>Contributors:</strong> ${usersDisplay}<br>
        &bull; <strong>Appointed Controller:</strong> ${ctrlDisplay}
      </div>
    `;
  }

  if (modalActStatus) modalActStatus.value = act.status || "not_started";
  if (modalActProgressRange) modalActProgressRange.value = act.progress_pct || 0;
  if (modalActProgressNum) modalActProgressNum.textContent = `${act.progress_pct || 0}%`;
  if (modalActStartDate) modalActStartDate.value = act.actual_start_date || "";
  if (modalActFinishDate) modalActFinishDate.value = act.actual_finish_date || "";

  const fn = memberState.user ? memberState.user.first_name || "" : "";
  const ln = memberState.user ? memberState.user.last_name || "" : "";
  const isActController = isUserController(act);
  if (isActController && modalControllerSignoffBox) {
    modalControllerSignoffBox.style.display = "block";
    if (modalSignoffUser) modalSignoffUser.textContent = `Sign-off as Controller: ${fn} ${ln}`;
    if (modalSignoffCheck) modalSignoffCheck.checked = act.status === "verified";
  } else if (modalControllerSignoffBox) {
    modalControllerSignoffBox.style.display = "none";
  }

  if (memberActivityModal) memberActivityModal.style.display = "flex";
}

/**
 * Closes the activity detail modal dialog.
 */
export function closeMemberActivityModal() {
  if (memberActivityModal) memberActivityModal.style.display = "none";
  selectedModalAct = null;
}

async function handleMemberActivitySubmit(e) {
  e.preventDefault();
  if (!selectedModalAct || !memberState.activeProjectId) return;

  const payload = {
    status: modalActStatus ? modalActStatus.value : "not_started",
    progress_pct: modalActProgressRange ? parseFloat(modalActProgressRange.value) : 0,
    actual_start_date: (modalActStartDate && modalActStartDate.value) || null,
    actual_finish_date: (modalActFinishDate && modalActFinishDate.value) || null
  };

  const fn = memberState.user ? memberState.user.first_name || "" : "";
  const ln = memberState.user ? memberState.user.last_name || "" : "";
  if (selectedModalAct && isUserController(selectedModalAct) && modalSignoffCheck && modalSignoffCheck.checked && payload.status === "verified") {
    payload.verified_by = `${fn} ${ln} (Controller)`.trim();
    payload.verified_date = new Date().toISOString().split("T")[0];
  }

  const { error } = await updateActivityStatus(memberState.activeProjectId, selectedModalAct.activity_id, payload);
  if (error) {
    alert(`Failed to save activity execution state: ${error}`);
    return;
  }

  closeMemberActivityModal();
  await callbacks.loadAgendaTasks();
}
