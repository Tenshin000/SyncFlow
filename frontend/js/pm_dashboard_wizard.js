/**
 * SyncFlow Frontend - Project Creation Wizard (pm_dashboard_wizard.js)
 * Manages the Two-Stage Project Creation Wizard:
 *  - Stage 1: Charter Definition (Name, Scope, Start Date, Governance Flags)
 *  - Stage 2: Personnel & Team Allocation (Dynamic Candidate Filtering, Team Leads, Unassigned, Controllers)
 */

import {
  createProject,
  fetchAllUsers,
  fetchReusableTeams
} from "./api.js";
import { formatDateYmd, escapeHtml } from "./utility.js";

/**
 * Initializes the Two-Stage Project Creation Wizard.
 * @param {string} pmId - The MongoDB ObjectId of the active Project Manager
 */
export function initProjectCreationWizard(pmId) {
  // DOM References: Modal & Controls
  const createModal = document.getElementById("create-project-modal");
  const btnOpenCreateModal = document.getElementById("btn-open-create-modal");
  const btnCloseCreateModal = document.getElementById("btn-close-create-modal");

  // DOM References: Wizard Stage 1
  const stage1Container = document.getElementById("stage-1-container");
  const stage2Container = document.getElementById("stage-2-container");
  const stage1Footer = document.getElementById("stage-1-footer-buttons");
  const stage2Footer = document.getElementById("stage-2-footer-buttons");
  const stepIndicator = document.getElementById("wizard-step-indicator");

  const inputProjName = document.getElementById("create-proj-name");
  const inputProjDesc = document.getElementById("create-proj-desc");
  const inputProjDate = document.getElementById("create-proj-date");
  const cbAllowMultiTeam = document.getElementById("cb-allow-multiteam");
  const govFeedbackSingle = document.getElementById("gov-feedback-single");
  const govFeedbackMulti = document.getElementById("gov-feedback-multi");
  const cbOpenParticipation = document.getElementById("cb-open-participation");
  const partFeedbackApproval = document.getElementById("part-feedback-approval");
  const partFeedbackOpen = document.getElementById("part-feedback-open");
  const stage1Error = document.getElementById("stage-1-error");

  const btnCancelStage1 = document.getElementById("btn-cancel-stage-1");
  const btnProceedStage2 = document.getElementById("btn-proceed-stage-2");

  // DOM References: Wizard Stage 2
  const btnBackToStage1 = document.getElementById("btn-back-to-stage-1");
  const stage2SummaryName = document.getElementById("stage2-summary-name");
  const stage2SummaryDate = document.getElementById("stage2-summary-date");
  const stage2SummaryBadge = document.getElementById("stage2-summary-badge");
  const stage2LockedGovBanner = document.getElementById("stage2-locked-gov-banner");
  const leadControllerName = document.getElementById("lead-controller-name");

  const inputTeamName = document.getElementById("team-name-input");
  const selectTeamRole = document.getElementById("team-role-filter");
  const btnAddAllFiltered = document.getElementById("btn-add-all-filtered");
  const teamCandidateContainer = document.getElementById("team-candidate-picker-container");
  const btnConfirmTeam = document.getElementById("btn-confirm-team");
  const btnCancelTeamEdit = document.getElementById("btn-cancel-team-edit");
  const teamBuilderFormCard = document.getElementById("team-builder-form-card");
  const teamEditingBanner = document.getElementById("team-editing-banner");
  const teamAddedBanner = document.getElementById("team-added-banner");
  const teamFormCardTitle = document.getElementById("team-form-card-title");
  const teamBuilderModeTag = document.getElementById("team-builder-mode-tag");
  const teamDraftCountBadge = document.getElementById("team-draft-count-badge");
  const configuredTeamsCountBadge = document.getElementById("configured-teams-count-badge");
  const teamFormHint = document.getElementById("team-form-hint");
  const wizardModalBody = document.getElementById("wizard-modal-body");
  const selectTeamLead = document.getElementById("team-lead-select");
  const configuredTeamsList = document.getElementById("configured-teams-list");
  const btnImportReusable = document.getElementById("btn-import-reusable-teams");

  const unassignedContainer = document.getElementById("unassigned-candidates-container");
  const controllersContainer = document.getElementById("controllers-picker-container");
  const controllersCountCaption = document.getElementById("controllers-count-caption");

  const rosterHealthSummary = document.getElementById("roster-health-summary");
  const totalPersonnelCount = document.getElementById("total-personnel-count");

  const btnCancelStage2 = document.getElementById("btn-cancel-stage-2");
  const btnInitProject = document.getElementById("btn-init-project");

  // Set default dates
  const todayStr = new Date().toISOString().split("T")[0];
  if (inputProjDate) {
    inputProjDate.value = todayStr;
    inputProjDate.min = todayStr;
  }

  // ============================================================================
  // WIZARD STATE
  // ============================================================================
  let wizardStage = 1;
  let allUsersCache = [];
  let configuredTeams = [];
  let unassignedUserIds = [];
  let designatedControllerIds = [pmId]; // PM is always automatically included
  let editingTeamIndex = null;
  let draftTeamMemberIds = [];

  // ============================================================================
  // MODAL VISIBILITY & RESET CONTROLS
  // ============================================================================

  function openCreateWizard() {
    wizardStage = 1;
    resetStage1Inputs();
    resetStage2Personnel();
    renderWizardStage();
    createModal.style.display = "flex";
  }

  function closeCreateWizard() {
    createModal.style.display = "none";
    resetStage1Inputs();
    resetStage2Personnel();
  }

  if (btnOpenCreateModal) btnOpenCreateModal.addEventListener("click", openCreateWizard);
  if (btnCloseCreateModal) btnCloseCreateModal.addEventListener("click", closeCreateWizard);
  if (btnCancelStage1) btnCancelStage1.addEventListener("click", closeCreateWizard);
  if (btnCancelStage2) btnCancelStage2.addEventListener("click", closeCreateWizard);

  function resetStage1Inputs() {
    if (inputProjName) inputProjName.value = "";
    if (inputProjDesc) inputProjDesc.value = "";
    if (inputProjDate) inputProjDate.value = todayStr;
    if (cbAllowMultiTeam) cbAllowMultiTeam.checked = false;
    if (govFeedbackSingle) govFeedbackSingle.style.display = "flex";
    if (govFeedbackMulti) govFeedbackMulti.style.display = "none";
    if (cbOpenParticipation) {
      cbOpenParticipation.checked = false;
      if (partFeedbackApproval) partFeedbackApproval.style.display = "flex";
      if (partFeedbackOpen) partFeedbackOpen.style.display = "none";
    }
    if (stage1Error) stage1Error.style.display = "none";
  }

  function resetStage2Personnel() {
    configuredTeams = [];
    unassignedUserIds = [];
    designatedControllerIds = [pmId];
    editingTeamIndex = null;
    draftTeamMemberIds = [];
    if (inputTeamName) inputTeamName.value = "";
    if (selectTeamRole) selectTeamRole.value = "";
    if (btnConfirmTeam) btnConfirmTeam.textContent = "+ Add Team to Project";
    if (btnCancelTeamEdit) btnCancelTeamEdit.style.display = "none";
    if (teamEditingBanner) teamEditingBanner.style.display = "none";
    if (teamAddedBanner) teamAddedBanner.style.display = "none";
    if (teamBuilderModeTag) {
      teamBuilderModeTag.textContent = "New Team Mode";
      teamBuilderModeTag.className = "badge badge-primary";
    }
    if (teamFormCardTitle) teamFormCardTitle.textContent = "🏢 Create a New Project Team";
    if (teamFormHint) teamFormHint.textContent = "Define team identity, select specialists from the dynamic roster, and assign an optional Team Lead.";
    if (teamBuilderFormCard) teamBuilderFormCard.style.borderColor = "var(--border-light)";
  }

  // Real-time Governance Feedback Toggles
  if (cbAllowMultiTeam) {
    cbAllowMultiTeam.addEventListener("change", () => {
      if (cbAllowMultiTeam.checked) {
        govFeedbackSingle.style.display = "none";
        govFeedbackMulti.style.display = "flex";
      } else {
        govFeedbackSingle.style.display = "flex";
        govFeedbackMulti.style.display = "none";
      }
    });
  }

  if (cbOpenParticipation) {
    cbOpenParticipation.addEventListener("change", () => {
      if (cbOpenParticipation.checked) {
        partFeedbackApproval.style.display = "none";
        partFeedbackOpen.style.display = "flex";
      } else {
        partFeedbackApproval.style.display = "flex";
        partFeedbackOpen.style.display = "none";
      }
    });
  }

  // ============================================================================
  // STAGE TRANSITIONS & VALIDATION
  // ============================================================================

  if (btnProceedStage2) {
    btnProceedStage2.addEventListener("click", async () => {
      const name = (inputProjName.value || "").trim();
      const desc = (inputProjDesc.value || "").trim();
      const sDate = inputProjDate.value;

      if (!name) {
        stage1Error.textContent = "Project Name is required.";
        stage1Error.style.display = "block";
        inputProjName.focus();
        return;
      }

      if (!desc) {
        stage1Error.textContent = "Project Scope & Description is required.";
        stage1Error.style.display = "block";
        inputProjDesc.focus();
        return;
      }

      if (!sDate) {
        stage1Error.textContent = "Planned Start Date is required.";
        stage1Error.style.display = "block";
        inputProjDate.focus();
        return;
      }

      stage1Error.style.display = "none";

      // Transition to Stage 2
      wizardStage = 2;
      renderWizardStage();

      // Fetch candidates roster if empty
      if (allUsersCache.length === 0) {
        teamCandidateContainer.innerHTML = `<p style="padding: 1.5rem; text-align: center; color: var(--muted);">Loading available personnel...</p>`;
        const { data: users, error } = await fetchAllUsers();
        if (error || !users) {
          teamCandidateContainer.innerHTML = `<p style="padding: 1.5rem; text-align: center; color: var(--danger);">Failed to load personnel roster: ${error}</p>`;
          return;
        }
        allUsersCache = users;
      }

      // Populate Dynamic Role Filter
      const roles = Array.from(new Set(allUsersCache.map(u => (u.role || "Member").trim()))).filter(Boolean).sort();
      selectTeamRole.innerHTML = `<option value="">-- All Roles (${allUsersCache.length} Specialists) --</option>` +
        roles.map(r => `<option value="${r}">${r}</option>`).join("");

      // Render Stage 2 Sections
      renderTeamBuilderSection();
      renderConfiguredTeamsList();
      renderUnassignedSection();
      renderControllersSection();
      updateRosterKPI();
    });
  }

  if (btnBackToStage1) {
    btnBackToStage1.addEventListener("click", () => {
      wizardStage = 1;
      renderWizardStage();
    });
  }

  function renderWizardStage() {
    if (wizardStage === 1) {
      stepIndicator.textContent = "Step 1 of 2: Define Project Charter & Policies";
      stage1Container.style.display = "block";
      stage1Footer.style.display = "flex";
      stage2Container.style.display = "none";
      stage2Footer.style.display = "none";
    } else {
      stepIndicator.textContent = "Step 2 of 2: Assemble Teams & Appoint Controllers";
      stage1Container.style.display = "none";
      stage1Footer.style.display = "none";
      stage2Container.style.display = "block";
      stage2Footer.style.display = "flex";

      // Stage 2 Header Banner Updates
      stage2SummaryName.textContent = inputProjName.value.trim() || "Untitled Project";
      stage2SummaryDate.textContent = inputProjDate.value || todayStr;
      const isMulti = cbAllowMultiTeam ? cbAllowMultiTeam.checked : false;
      const isOpen = cbOpenParticipation ? cbOpenParticipation.checked : false;

      stage2SummaryBadge.textContent = isMulti ? "Multi-Team Allocation Enabled" : "Strict Single-Team Allocation";
      stage2SummaryBadge.className = isMulti ? "badge badge-primary" : "badge badge-gray";

      stage2LockedGovBanner.innerHTML = `
        <strong>Active Project Policies:</strong> Team Mode: <em>${isMulti ? "Multi-Team (Shared Staff)" : "Single-Team (Exclusive Staff)"}</em> • Participation: <em>${isOpen ? "Open (Instant Self-Join)" : "Approval-Required (PM Confirmation)"}</em>
      `;
    }
  }

  // ============================================================================
  // TEAM BUILDER & DYNAMIC CANDIDATE FILTERING
  // ============================================================================

  function getGloballyBlockedIds() {
    const isMulti = cbAllowMultiTeam ? cbAllowMultiTeam.checked : false;
    const blocked = new Set();
    if (!isMulti) {
      configuredTeams.forEach((t, idx) => {
        if (editingTeamIndex !== null && idx === editingTeamIndex) return;
        (t.member_ids || []).forEach(mid => blocked.add(String(mid)));
      });
    }
    return blocked;
  }

  function renderTeamBuilderSection() {
    const isEditing = editingTeamIndex !== null;
    if (isEditing) {
      const targetTeam = configuredTeams[editingTeamIndex];
      inputTeamName.value = targetTeam.name;
      draftTeamMemberIds = [...(targetTeam.member_ids || [])];
      btnConfirmTeam.textContent = "💾 Save Team Changes";
      btnCancelTeamEdit.style.display = "inline-flex";
      teamEditingBanner.style.display = "block";
      teamAddedBanner.style.display = "none";
      teamFormCardTitle.textContent = `✏️ Edit Team: ${targetTeam.name}`;
      teamBuilderModeTag.textContent = "Edit Mode";
      teamBuilderModeTag.className = "badge badge-warning";
      teamFormHint.textContent = "Update team name, modify members, or re-assign team lead. Changes update upon saving.";
      teamBuilderFormCard.style.borderColor = "var(--primary)";
      renderTeamLeadOptions(targetTeam.lead_id);
    } else {
      inputTeamName.value = "";
      draftTeamMemberIds = [];
      btnConfirmTeam.textContent = "+ Add Team to Project";
      btnCancelTeamEdit.style.display = "none";
      teamEditingBanner.style.display = "none";
      teamFormCardTitle.textContent = "🏢 Create a New Project Team";
      teamBuilderModeTag.textContent = "New Team Mode";
      teamBuilderModeTag.className = "badge badge-primary";
      teamFormHint.textContent = "Define team identity, select specialists from the dynamic roster, and assign an optional Team Lead.";
      teamBuilderFormCard.style.borderColor = "var(--border-light)";
      renderTeamLeadOptions("");
    }
    teamDraftCountBadge.textContent = `${draftTeamMemberIds.length} Selected`;
    renderTeamCandidates();
  }

  function renderTeamLeadOptions(selectedLeadId = "") {
    if (draftTeamMemberIds.length === 0) {
      selectTeamLead.innerHTML = `<option value="">-- No Team Lead (Unassigned) --</option>`;
      selectTeamLead.disabled = true;
      return;
    }

    selectTeamLead.disabled = false;
    let optsHtml = `<option value="">-- No Team Lead (Unassigned) --</option>`;
    draftTeamMemberIds.forEach(uid => {
      const u = allUsersCache.find(x => String(x.id || x._id) === String(uid));
      if (u) {
        const uName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
        const isSel = String(selectedLeadId) === String(uid) ? "selected" : "";
        optsHtml += `<option value="${uid}" ${isSel}>👑 ${escapeHtml(uName)} (${escapeHtml(u.role || 'Member')})</option>`;
      }
    });
    selectTeamLead.innerHTML = optsHtml;
  }

  function renderTeamCandidates() {
    const roleFilter = (selectTeamRole.value || "").trim().toLowerCase();
    const blockedIds = getGloballyBlockedIds();

    const filteredUsers = allUsersCache.filter(u => {
      const uRole = (u.role || "Member").trim().toLowerCase();
      if (roleFilter && uRole !== roleFilter) return false;
      return true;
    });

    if (filteredUsers.length === 0) {
      teamCandidateContainer.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 2rem 1rem; text-align: center; color: var(--muted);">
          No specialists match the selected role filter.
        </div>
      `;
      btnAddAllFiltered.disabled = true;
      return;
    }

    const availableInFilter = filteredUsers.filter(u => !blockedIds.has(String(u.id || u._id)));
    btnAddAllFiltered.disabled = availableInFilter.length === 0;

    let cardsHtml = "";
    filteredUsers.forEach(u => {
      const uid = String(u.id || u._id);
      const isBlocked = blockedIds.has(uid);
      const isChecked = draftTeamMemberIds.includes(uid);
      const uName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
      const uRole = u.role || "Member";
      const uEmail = u.email || "—";

      let statusCaption = `<span style="color: var(--muted);">Available</span>`;
      let disabledAttr = "";
      let cardOpacity = "1.0";
      let cursorStyle = "pointer";

      if (isBlocked) {
        disabledAttr = "disabled";
        cardOpacity = "0.55";
        cursorStyle = "not-allowed";
        statusCaption = `<span style="color: var(--danger); font-weight: 600;">🔒 Assigned to another team</span>`;
      } else if (isChecked) {
        statusCaption = `<span style="color: var(--primary); font-weight: 700;">✅ Selected for this team</span>`;
      }

      cardsHtml += `
        <div class="team-candidate-card ${isChecked ? 'selected' : ''}" style="opacity: ${cardOpacity}; cursor: ${cursorStyle};" data-user-id="${uid}">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <input type="checkbox" class="cb-candidate" value="${uid}" ${isChecked ? 'checked' : ''} ${disabledAttr} style="margin-top: 3px; cursor: ${cursorStyle};">
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; color: var(--charcoal); font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(uName)}
              </div>
              <div style="font-size: 0.78rem; color: var(--primary); font-weight: 600;">
                ${escapeHtml(uRole)}
              </div>
              <div style="font-size: 0.74rem; color: var(--muted); margin-top: 2px;">
                ${escapeHtml(uEmail)}
              </div>
              <div style="font-size: 0.72rem; margin-top: 4px;">
                ${statusCaption}
              </div>
            </div>
          </div>
        </div>
      `;
    });

    teamCandidateContainer.innerHTML = cardsHtml;

    // Attach card click handlers
    teamCandidateContainer.querySelectorAll(".team-candidate-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return;
        const cb = card.querySelector(".cb-candidate");
        if (cb && !cb.disabled) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event("change"));
        }
      });
    });

    // Checkbox state tracking
    teamCandidateContainer.querySelectorAll(".cb-candidate").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const uid = e.target.value;
        if (e.target.checked) {
          if (!draftTeamMemberIds.includes(uid)) draftTeamMemberIds.push(uid);
        } else {
          draftTeamMemberIds = draftTeamMemberIds.filter(id => id !== uid);
        }
        teamDraftCountBadge.textContent = `${draftTeamMemberIds.length} Selected`;
        const currLead = selectTeamLead.value;
        renderTeamLeadOptions(currLead);
        renderTeamCandidates();
      });
    });
  }

  // Filter change listener
  if (selectTeamRole) {
    selectTeamRole.addEventListener("change", renderTeamCandidates);
  }

  // Add All Filtered handler
  if (btnAddAllFiltered) {
    btnAddAllFiltered.addEventListener("click", () => {
      const roleFilter = (selectTeamRole.value || "").trim().toLowerCase();
      const blockedIds = getGloballyBlockedIds();

      const candidatesToAdd = allUsersCache.filter(u => {
        const uRole = (u.role || "Member").trim().toLowerCase();
        if (roleFilter && uRole !== roleFilter) return false;
        const uid = String(u.id || u._id);
        return !blockedIds.has(uid);
      });

      candidatesToAdd.forEach(u => {
        const uid = String(u.id || u._id);
        if (!draftTeamMemberIds.includes(uid)) draftTeamMemberIds.push(uid);
      });

      teamDraftCountBadge.textContent = `${draftTeamMemberIds.length} Selected`;
      renderTeamLeadOptions(selectTeamLead.value);
      renderTeamCandidates();
    });
  }

  // Confirm Team (Add or Update)
  if (btnConfirmTeam) {
    btnConfirmTeam.addEventListener("click", () => {
      const tName = (inputTeamName.value || "").trim();
      if (!tName) {
        alert("Please enter a valid Team Name.");
        inputTeamName.focus();
        return;
      }

      // Check duplicate name
      const isDup = configuredTeams.some((t, idx) => {
        if (editingTeamIndex !== null && idx === editingTeamIndex) return false;
        return t.name.toLowerCase() === tName.toLowerCase();
      });
      if (isDup) {
        alert(`A team named "${tName}" has already been added to this project.`);
        inputTeamName.focus();
        return;
      }

      const teamLeadId = selectTeamLead && selectTeamLead.value ? selectTeamLead.value : null;

      if (editingTeamIndex !== null) {
        // Update existing team
        configuredTeams[editingTeamIndex].name = tName;
        configuredTeams[editingTeamIndex].member_ids = [...draftTeamMemberIds];
        configuredTeams[editingTeamIndex].lead_id = teamLeadId;
        editingTeamIndex = null;
      } else {
        // Add new team
        const newTeamId = `TEAM-${configuredTeams.length + 1}`;
        configuredTeams.push({
          team_id: newTeamId,
          name: tName,
          member_ids: [...draftTeamMemberIds],
          lead_id: teamLeadId
        });
      }

      // Feedback Banner
      teamAddedBanner.style.display = "block";
      teamAddedBanner.textContent = `✅ Team "${tName}" with ${draftTeamMemberIds.length} member(s) successfully added to project!`;
      setTimeout(() => {
        teamAddedBanner.style.display = "none";
      }, 4000);

      renderTeamBuilderSection();
      renderConfiguredTeamsList();
      renderUnassignedSection();
      updateRosterKPI();
    });
  }

  // Cancel edit handler
  if (btnCancelTeamEdit) {
    btnCancelTeamEdit.addEventListener("click", () => {
      editingTeamIndex = null;
      renderTeamBuilderSection();
      renderConfiguredTeamsList();
    });
  }

  // Import Reusable Teams Modal
  if (btnImportReusable) {
    btnImportReusable.addEventListener("click", async () => {
      const { data: teams, error } = await fetchReusableTeams(pmId);
      if (error || !teams || teams.length === 0) {
        alert("No saved reusable teams found in your library.");
        return;
      }

      const teamOptions = teams.map((t, idx) => `${idx + 1}. ${t.name} (${(t.member_ids || []).length} members)`).join("\n");
      const choice = prompt(`Select a reusable team to import (1 - ${teams.length}):\n\n${teamOptions}`);
      if (!choice) return;

      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < teams.length) {
        const selTeam = teams[idx];
        const newTeamId = `TEAM-${configuredTeams.length + 1}`;
        configuredTeams.push({
          team_id: newTeamId,
          name: selTeam.name,
          member_ids: [...(selTeam.member_ids || [])],
          lead_id: selTeam.lead_id || null
        });
        renderConfiguredTeamsList();
        renderTeamCandidates();
        updateRosterKPI();
      }
    });
  }

  // ============================================================================
  // CONFIGURED TEAMS ROSTER
  // ============================================================================

  function renderConfiguredTeamsList() {
    configuredTeamsCountBadge.textContent = `${configuredTeams.length} Configured`;

    if (configuredTeams.length === 0) {
      configuredTeamsList.innerHTML = `
        <div style="padding: 2.5rem 1rem; text-align: center; color: var(--muted); border: 1px dashed var(--border); border-radius: var(--radius-sm); background: #FAFBFD;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🏢</div>
          <div style="font-weight: 700; color: var(--charcoal);">No Teams Configured Yet</div>
          <div style="font-size: 0.85rem; margin-top: 4px;">Use the builder above or import from your Reusable Library.</div>
        </div>
      `;
      return;
    }

    let listHtml = "";
    configuredTeams.forEach((t, idx) => {
      const isEditing = editingTeamIndex === idx;
      let leadName = "None designated";
      if (t.lead_id) {
        const lu = allUsersCache.find(x => String(x.id || x._id) === String(t.lead_id));
        if (lu) leadName = `${lu.first_name || ''} ${lu.last_name || ''}`.trim() || lu.username;
      }

      let memberChips = "";
      if (t.member_ids && t.member_ids.length > 0) {
        t.member_ids.forEach(mid => {
          const u = allUsersCache.find(x => String(x.id || x._id) === String(mid));
          if (u) {
            const uName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
            const isLead = String(mid) === String(t.lead_id);
            memberChips += `
              <span class="badge ${isLead ? 'badge-primary' : 'badge-gray'}" style="font-size: 0.75rem; margin-right: 4px; margin-bottom: 4px;">
                ${isLead ? '👑 ' : ''}${escapeHtml(uName)}
              </span>
            `;
          }
        });
      } else {
        memberChips = `<span style="font-size: 0.8rem; color: var(--muted); font-style: italic;">No members (Placeholder Team)</span>`;
      }

      listHtml += `
        <div class="card" style="padding: 1.1rem 1.3rem; margin-bottom: 0.85rem; border: 1px solid ${isEditing ? 'var(--primary)' : 'var(--border)'}; background: ${isEditing ? 'var(--primary-light)' : '#FFFFFF'}; border-radius: var(--radius-sm);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--charcoal);">
                  🏢 ${escapeHtml(t.name)}
                </h4>
                <span class="badge badge-primary" style="font-size: 0.72rem;">${t.member_ids.length} Member(s)</span>
              </div>
              <div style="font-size: 0.82rem; color: var(--slate); margin-top: 4px;">
                <strong>Designated Lead:</strong> ${escapeHtml(leadName)}
              </div>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm btn-edit-team" data-team-index="${idx}" style="padding: 4px 10px; font-size: 0.78rem;">
                ✏️ Edit
              </button>
              <button class="btn btn-danger btn-sm btn-delete-team" data-team-index="${idx}" style="padding: 4px 10px; font-size: 0.78rem;">
                🗑️ Delete
              </button>
            </div>
          </div>
          <div style="margin-top: 0.85rem; display: flex; flex-wrap: wrap; align-items: center;">
            ${memberChips}
          </div>
        </div>
      `;
    });

    configuredTeamsList.innerHTML = listHtml;

    // Attach actions
    configuredTeamsList.querySelectorAll(".btn-edit-team").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-team-index"), 10);
        editingTeamIndex = idx;
        renderTeamBuilderSection();
        renderConfiguredTeamsList();
        teamBuilderFormCard.scrollIntoView({ behavior: "smooth" });
      });
    });

    configuredTeamsList.querySelectorAll(".btn-delete-team").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-team-index"), 10);
        const t = configuredTeams[idx];
        if (confirm(`Remove team "${t.name}" from this project configuration?`)) {
          if (editingTeamIndex === idx) editingTeamIndex = null;
          configuredTeams.splice(idx, 1);
          renderTeamBuilderSection();
          renderConfiguredTeamsList();
          renderUnassignedSection();
          updateRosterKPI();
        }
      });
    });
  }

  // ============================================================================
  // UNASSIGNED CONTRIBUTORS & CONTROLLERS
  // ============================================================================

  function renderUnassignedSection() {
    let itemsHtml = "";
    allUsersCache.forEach(u => {
      const uid = String(u.id || u._id);
      const isChecked = unassignedUserIds.includes(uid);
      const uName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
      itemsHtml += `
        <label style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-light); background: #FFFFFF; font-size: 0.82rem; cursor: pointer;">
          <input type="checkbox" class="cb-unassigned" value="${uid}" ${isChecked ? 'checked' : ''}>
          <span style="font-weight: 600; color: var(--charcoal);">${escapeHtml(uName)}</span>
          <span style="color: var(--muted); font-size: 0.75rem;">(${escapeHtml(u.role || 'Member')})</span>
        </label>
      `;
    });
    unassignedContainer.innerHTML = itemsHtml;

    unassignedContainer.querySelectorAll(".cb-unassigned").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const uid = e.target.value;
        if (e.target.checked) {
          if (!unassignedUserIds.includes(uid)) unassignedUserIds.push(uid);
        } else {
          unassignedUserIds = unassignedUserIds.filter(id => id !== uid);
        }
        updateRosterKPI();
      });
    });
  }

  function renderControllersSection() {
    let itemsHtml = "";
    allUsersCache.forEach(u => {
      const uid = String(u.id || u._id);
      const isPM = uid === String(pmId);
      const isChecked = designatedControllerIds.includes(uid) || isPM;
      const uName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;

      itemsHtml += `
        <label style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--border-light); background: ${isPM ? '#EFF6FF' : '#FFFFFF'}; font-size: 0.82rem; cursor: ${isPM ? 'default' : 'pointer'};">
          <input type="checkbox" class="cb-controller" value="${uid}" ${isChecked ? 'checked' : ''} ${isPM ? 'disabled' : ''}>
          <span style="font-weight: 700; color: ${isPM ? 'var(--primary)' : 'var(--charcoal)'};">
            ${escapeHtml(uName)} ${isPM ? '(Lead Controller / PM)' : ''}
          </span>
          <span style="color: var(--muted); font-size: 0.75rem;">(${escapeHtml(u.role || 'Controller')})</span>
        </label>
      `;
    });
    controllersContainer.innerHTML = itemsHtml;

    controllersContainer.querySelectorAll(".cb-controller").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const uid = e.target.value;
        if (e.target.checked) {
          if (!designatedControllerIds.includes(uid)) designatedControllerIds.push(uid);
        } else {
          designatedControllerIds = designatedControllerIds.filter(id => id !== uid);
        }
        // PM is always permanent
        if (!designatedControllerIds.includes(pmId)) designatedControllerIds.unshift(pmId);

        updateRosterKPI();
      });
    });
  }

  function updateRosterKPI() {
    const uniqueIds = new Set();
    uniqueIds.add(pmId); // PM always included

    configuredTeams.forEach(t => {
      (t.member_ids || []).forEach(mid => uniqueIds.add(String(mid)));
    });

    unassignedUserIds.forEach(uid => uniqueIds.add(String(uid)));
    designatedControllerIds.forEach(cid => uniqueIds.add(String(cid)));

    rosterHealthSummary.textContent = `🏢 ${configuredTeams.length} Teams • 👤 ${unassignedUserIds.length} Unassigned • 🛡️ ${designatedControllerIds.length} Controllers • ⭐ 1 PM`;
    totalPersonnelCount.textContent = uniqueIds.size;

    if (designatedControllerIds.length > 1) {
      controllersCountCaption.innerHTML = `✅ Total Designated Controllers: <strong>${designatedControllerIds.length}</strong> (⭐ 1 Lead PM + 🛡️ ${designatedControllerIds.length - 1} Additional)`;
    } else {
      controllersCountCaption.innerHTML = `ℹ️ Total Designated Controllers: <strong>1</strong> (⭐ 1 Lead PM)`;
    }
  }

  // ============================================================================
  // PROJECT SUBMISSION & INITIALIZATION
  // ============================================================================

  if (btnInitProject) {
    btnInitProject.addEventListener("click", async () => {
      // Check if user is currently editing a team without saving
      if (editingTeamIndex !== null) {
        const tName = inputTeamName.value.trim();
        if (tName) {
          configuredTeams[editingTeamIndex].name = tName;
          configuredTeams[editingTeamIndex].member_ids = [...draftTeamMemberIds];
          configuredTeams[editingTeamIndex].lead_id = selectTeamLead && selectTeamLead.value ? selectTeamLead.value : null;
          editingTeamIndex = null;
        }
      }

      // Check if user entered team details without clicking Add Team
      const pendingTeamName = (inputTeamName ? inputTeamName.value : "").trim();
      if (pendingTeamName) {
        const memberCount = draftTeamMemberIds.length;
        const addNow = confirm(
          `⚠️ Unsaved Team Notice:\n\n` +
          `You entered details for team "${pendingTeamName}" (${memberCount} member${memberCount === 1 ? '' : 's'} selected), but haven't clicked "Add Team to Project".\n\n` +
          `• Click OK to ADD "${pendingTeamName}" to your project now and proceed.\n` +
          `• Click CANCEL to review or discard this team.`
        );
        if (addNow) {
          const newTeamId = `TEAM-${configuredTeams.length + 1}`;
          configuredTeams.push({
            team_id: newTeamId,
            name: pendingTeamName,
            member_ids: [...draftTeamMemberIds],
            lead_id: selectTeamLead && selectTeamLead.value ? selectTeamLead.value : null
          });
          inputTeamName.value = "";
          draftTeamMemberIds = [];
          renderTeamBuilderSection();
          updateRosterKPI();
        } else {
          const proceedWithout = confirm(`Proceed and create the project WITHOUT adding "${pendingTeamName}"?`);
          if (!proceedWithout) {
            inputTeamName.focus();
            return;
          }
        }
      }

      btnInitProject.disabled = true;
      btnInitProject.textContent = "Initializing Project...";

      // Ensure PM is always in controllers and assigned_user_ids
      if (!designatedControllerIds.includes(pmId)) designatedControllerIds.unshift(pmId);

      const allAssigned = new Set(unassignedUserIds);
      allAssigned.add(pmId);
      configuredTeams.forEach(t => {
        (t.member_ids || []).forEach(mid => allAssigned.add(String(mid)));
        if (t.lead_id) allAssigned.add(String(t.lead_id));
      });
      designatedControllerIds.forEach(cid => allAssigned.add(String(cid)));

      const payload = {
        name: inputProjName.value.trim(),
        description: inputProjDesc.value.trim(),
        start_date: inputProjDate.value,
        created_by: pmId,
        assigned_user_ids: Array.from(allAssigned),
        teams: configuredTeams,
        controllers: designatedControllerIds,
        open_participation: cbOpenParticipation ? cbOpenParticipation.checked : false,
        allow_multiteam: cbAllowMultiTeam ? cbAllowMultiTeam.checked : false
      };

      const { data: createdProj, error } = await createProject(payload);

      btnInitProject.disabled = false;
      btnInitProject.textContent = "🚀 Initialize Project & Open Workspace";

      if (error || !createdProj) {
        alert(`Project Creation Failed: ${error || "Unknown error"}`);
        return;
      }

      // Success: save active project id and route to workspace
      sessionStorage.setItem("active_project_id", createdProj.id || createdProj._id);
      closeCreateWizard();
      window.location.href = "/project_manager/workspace.html";
    });
  }
}
