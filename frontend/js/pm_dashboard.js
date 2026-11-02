/**
 * SyncFlow Frontend – Project Manager Dashboard & Two-Stage Project Creation Wizard
 * High-performance Vanilla JavaScript implementation replacing Streamlit UI.
 */

import {
  fetchProjects,
  fetchAllUsers,
  createProject,
  fetchReusableTeams,
  fetchUserProfile,
  deleteProject,
  fetchPortfolioDashboard
} from "./api.js";
import { requireAuth, renderProfileSidebar, setLoggedUser } from "./auth.js";
import { initNotificationBell } from "./notifications.js";

document.addEventListener("DOMContentLoaded", async () => {
  const user = requireAuth("pm");
  if (!user) return;

  const pmId = String(user.id || user._id);
  const pmFn = user.first_name || "Project";
  const pmLn = user.last_name || "Manager";

  // Elements
  const sidebarEl = document.getElementById("pm-profile-sidebar");
  const pmHeaderBadge = document.getElementById("pm-header-badge");
  const projectsContainer = document.getElementById("projects-container");
  const btnOpenCreateModal = document.getElementById("btn-open-create-modal");
  const createModal = document.getElementById("create-project-modal");
  const btnCloseCreateModal = document.getElementById("btn-close-create-modal");

  // Delete Project Confirmation Modal Elements
  const deleteModal = document.getElementById("delete-project-modal");
  const deleteModalProjName = document.getElementById("delete-modal-project-name");
  const deleteModalError = document.getElementById("delete-modal-error");
  const btnCloseDeleteModal = document.getElementById("btn-close-delete-modal");
  const btnCancelDelete = document.getElementById("btn-cancel-delete");
  const btnConfirmDelete = document.getElementById("btn-confirm-delete");
  let projectToDelete = null;

  // Wizard Stage 1 Elements
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

  // Wizard Stage 2 Elements
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
  inputProjDate.value = todayStr;
  inputProjDate.min = todayStr;

  // Sync latest PM profile
  const { data: freshProfile } = await fetchUserProfile(pmId);
  const activeUser = freshProfile || user;
  if (freshProfile) setLoggedUser(freshProfile);

  pmHeaderBadge.innerHTML = `
    <div style="background: var(--primary-light); border: 1px solid var(--primary-border); padding: 5px 14px; border-radius: 20px; font-weight: 700; color: var(--primary); font-size: 0.85rem;">
      ⭐ ${pmFn} ${pmLn} (Project Manager)
    </div>
  `;

  // Render profile sidebar
  renderProfileSidebar(sidebarEl, activeUser, (updated) => {
    pmHeaderBadge.innerHTML = `
      <div style="background: var(--primary-light); border: 1px solid var(--primary-border); padding: 5px 14px; border-radius: 20px; font-weight: 700; color: var(--primary); font-size: 0.85rem;">
        ⭐ ${updated.first_name || pmFn} ${updated.last_name || pmLn} (Project Manager)
      </div>
    `;
  });

  // Mount project notification bell
  initNotificationBell("#pm-notification-bell-container", activeUser, null);

  function openProjectWorkspace(projId) {
    if (projId) {
      sessionStorage.setItem("active_project_id", projId);
      window.location.href = "/project_manager/workspace.html";
    }
  }

  function renderProjectCard(p) {
    const pid = p.id || p._id;
    const pName = p.name || "Untitled Project";
    const escapedName = pName.replace(/"/g, '&quot;');
    return `
      <div class="project-card">
        <div class="project-card-header">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <h3 class="project-card-title">${pName}</h3>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="badge badge-blue">Active</span>
              <button type="button" class="project-trash-btn" data-proj-id="${pid}" data-proj-name="${escapedName}" title="Delete project" aria-label="Delete project">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          </div>
          <p class="project-card-desc">${p.description || "No charter description provided."}</p>
        </div>
        <div>
          <div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 0.5rem;">
            📅 Planned Start: <strong>${p.start_date || "Not set"}</strong>
          </div>
          <div class="project-card-stats">
            <span>🏢 ${p.teams_count || 0} Teams</span>
            <span>👥 ${p.members_count || 0} Members</span>
            <span>🛡️ ${p.controllers_count || 1} Ctrl</span>
          </div>
          <div style="margin-top: 1rem;">
            <button class="btn btn-outline-primary btn-block btn-open-workspace" data-proj-id="${pid}">
              ⚡ Open Workspace →
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Load Projects Portfolio
  async function loadPortfolio() {
    projectsContainer.innerHTML = `<p style="color: var(--muted); padding: 2rem 0; text-align: center;">Loading project portfolio...</p>`;
    const { data: projects, error } = await fetchProjects(pmId);

    if (error) {
      projectsContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load project portfolio: ${error}</div>`;
      return;
    }

    if (!projects || projects.length === 0) {
      projectsContainer.innerHTML = `
        <div style="background: #FFFFFF; border: 1px dashed var(--border); border-radius: var(--radius-md); padding: 3rem 2rem; text-align: center; margin-top: 1rem;">
          <div style="font-size: 2.8rem; margin-bottom: 0.6rem;">📂</div>
          <h4 style="margin: 0 0 0.4rem 0; color: var(--charcoal); font-size: 1.2rem;">No Projects Initiated Yet</h4>
          <p style="margin: 0 0 1.4rem 0; color: var(--muted); font-size: 0.92rem;">
            You haven't created any schedule management projects yet. Get started by clicking the button below.
          </p>
          <button id="btn-first-project" class="btn btn-primary" style="padding: 0.75rem 1.6rem;">
            🚀 Create Your First Project
          </button>
        </div>
      `;
      const btnFirst = document.getElementById("btn-first-project");
      if (btnFirst) btnFirst.addEventListener("click", openCreateWizard);
      return;
    }

    projectsContainer.innerHTML = `<div class="project-grid">${projects.map(renderProjectCard).join("")}</div>`;

    projectsContainer.querySelectorAll(".btn-open-workspace").forEach(btn => {
      btn.addEventListener("click", () => openProjectWorkspace(btn.getAttribute("data-proj-id")));
    });

    projectsContainer.querySelectorAll(".project-trash-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteConfirmation(btn.getAttribute("data-proj-id"), btn.getAttribute("data-proj-name") || "this project");
      });
    });
  }

  function openDeleteConfirmation(projId, projName) {
    projectToDelete = { id: projId, name: projName };
    if (deleteModalProjName) deleteModalProjName.textContent = `"${projName}"`;
    if (deleteModalError) {
      deleteModalError.style.display = "none";
      deleteModalError.textContent = "";
    }
    if (btnConfirmDelete) {
      btnConfirmDelete.disabled = false;
      btnConfirmDelete.textContent = "Delete";
    }
    if (deleteModal) deleteModal.style.display = "flex";
  }

  function closeDeleteConfirmation() {
    projectToDelete = null;
    if (deleteModal) deleteModal.style.display = "none";
  }

  if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener("click", closeDeleteConfirmation);
  if (btnCancelDelete) btnCancelDelete.addEventListener("click", closeDeleteConfirmation);

  if (btnConfirmDelete) {
    btnConfirmDelete.addEventListener("click", async () => {
      if (!projectToDelete) return;

      btnConfirmDelete.disabled = true;
      btnConfirmDelete.textContent = "Deleting...";
      if (deleteModalError) deleteModalError.style.display = "none";

      const { data, error } = await deleteProject(projectToDelete.id);

      if (error) {
        btnConfirmDelete.disabled = false;
        btnConfirmDelete.textContent = "Delete";
        if (deleteModalError) {
          deleteModalError.textContent = error || "Failed to delete project. Please try again.";
          deleteModalError.style.display = "flex";
        }
        return;
      }

      if (sessionStorage.getItem("active_project_id") === projectToDelete.id) {
        sessionStorage.removeItem("active_project_id");
      }

      closeDeleteConfirmation();
      await loadPortfolio();
      await loadExecutivePortfolio();
    });
  }

  // ── Multi-Project Executive Portfolio Overview ─────────────────────────────
  const portfolioContainer = document.getElementById("portfolio-dashboard-container");

  async function loadExecutivePortfolio() {
    if (!portfolioContainer) return;
    portfolioContainer.innerHTML = `<div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; text-align: center; color: var(--muted); font-size: 0.88rem;">📊 Loading Executive Portfolio Overview...</div>`;
    const { data: pf, error } = await fetchPortfolioDashboard(pmId);
    if (error || !pf) {
      portfolioContainer.innerHTML = "";
      return;
    }
    const kpis = pf.portfolio_kpis || {};
    const health = pf.health_distribution || {};
    const alerts = pf.critical_delay_alerts || [];
    const projects = pf.projects || [];

    if (!kpis.total_projects || kpis.total_projects === 0) {
      portfolioContainer.innerHTML = "";
      return;
    }

    const spiVal = (kpis.portfolio_spi !== undefined && kpis.portfolio_spi !== null) ? Number(kpis.portfolio_spi).toFixed(2) : "1.00";
    const spiColor = Number(spiVal) >= 1.0 ? "#059669" : (Number(spiVal) >= 0.85 ? "#D97706" : "#DC2626");

    let alertsHtml = "";
    if (alerts && alerts.length > 0) {
      const alertItems = alerts.map(a => `
        <div style="font-size: 0.82rem; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
          <span>🚨</span> <strong>${a.project_name}:</strong> Activity <code>${a.activity_id}</code> ("${a.activity_name}") is critical / delayed (${a.slippage_days ? a.slippage_days + 'd slippage' : a.negative_float + 'd negative float'}).
        </div>
      `).join("");
      alertsHtml = `
        <div class="portfolio-alert-banner">
          <div style="font-weight: 700; font-size: 0.88rem; display: flex; align-items: center; gap: 6px;">
            <span>⚠️</span> Executive Alert: Critical Schedule Delay Detected in ${alerts.length} Project Activity(s)
          </div>
          <div style="margin-top: 4px;">${alertItems}</div>
        </div>
      `;
    }

    let matrixRows = "";
    if (projects.length > 0) {
      matrixRows = projects.map(p => {
        const dotClass = p.health === "on_track" ? "dot-green" : (p.health === "at_risk" ? "dot-amber" : "dot-red");
        const healthLabel = p.health === "on_track" ? "On Track" : (p.health === "at_risk" ? "At Risk" : "Critical Delay");
        const pSpi = Number(p.spi !== undefined && p.spi !== null ? p.spi : 1.0).toFixed(2);
        const pSpiColor = Number(pSpi) >= 1.0 ? "#059669" : (Number(pSpi) >= 0.85 ? "#D97706" : "#DC2626");
        const msRate = p.milestones ? (p.milestones.completion_rate || 0) : 0;
        return `
          <tr>
            <td style="font-weight: 700; color: var(--charcoal); padding: 8px 10px;">${p.name}</td>
            <td style="padding: 8px 10px;">
              <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.82rem;">
                <span class="health-dot ${dotClass}"></span>
                ${healthLabel}
              </span>
            </td>
            <td style="font-size: 0.84rem; padding: 8px 10px;">${Number(p.pv || 0).toFixed(1)} d</td>
            <td style="font-size: 0.84rem; font-weight: 600; color: #059669; padding: 8px 10px;">${Number(p.ev || 0).toFixed(1)} d</td>
            <td style="font-size: 0.84rem; font-weight: 600; color: ${Number(p.sv || 0) < 0 ? '#DC2626' : '#059669'}; padding: 8px 10px;">${Number(p.sv || 0).toFixed(1)} d</td>
            <td style="font-weight: 700; color: ${pSpiColor}; padding: 8px 10px;">${pSpi}</td>
            <td style="padding: 8px 10px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div style="flex: 1; min-width: 60px; height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden;">
                  <div style="width: ${msRate}%; height: 100%; background: #2563EB;"></div>
                </div>
                <span style="font-size: 0.76rem; color: var(--slate); font-weight: 600;">${p.milestones ? p.milestones.completed : 0}/${p.milestones ? p.milestones.total : 0} (${msRate}%)</span>
              </div>
            </td>
            <td style="padding: 8px 10px;">
              <button class="btn btn-outline-primary btn-sm btn-portfolio-jump" data-proj-id="${p.project_id}" style="padding: 2px 8px; font-size: 0.78rem;">
                Open →
              </button>
            </td>
          </tr>
        `;
      }).join("");
    }

    portfolioContainer.innerHTML = `
      <div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.3rem 1.5rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.1rem; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.3rem;">📊</span>
            <div>
              <h3 style="margin: 0; font-size: 1.15rem; color: var(--charcoal);">Multi-Project Executive Portfolio Overview</h3>
              <p style="margin: 0; font-size: 0.8rem; color: var(--muted);">Cross-project PMBOK EVM health matrix, aggregate schedule variance, and delay monitoring</p>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem; font-weight: 600;">
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="health-dot dot-green"></span> ${health.on_track || 0} On Track</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="health-dot dot-amber"></span> ${health.at_risk || 0} At Risk</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span class="health-dot dot-red"></span> ${health.critical || 0} Critical</span>
          </div>
        </div>

        ${alertsHtml}

        <div class="portfolio-stat-grid" style="margin-bottom: 1.2rem;">
          <div class="portfolio-kpi-card"><span class="portfolio-kpi-title">Active Projects</span><span class="portfolio-kpi-val" style="color: var(--primary);">${kpis.total_projects || 0}</span><span class="portfolio-kpi-sub">Portfolio Initiatives</span></div>
          <div class="portfolio-kpi-card"><span class="portfolio-kpi-title">Portfolio SPI</span><span class="portfolio-kpi-val" style="color: ${spiColor};">${spiVal}</span><span class="portfolio-kpi-sub">${Number(spiVal) >= 1.0 ? 'Ahead / On Schedule' : 'Schedule Slippage'}</span></div>
          <div class="portfolio-kpi-card"><span class="portfolio-kpi-title">Portfolio Schedule Variance (SV)</span><span class="portfolio-kpi-val" style="color: ${Number(kpis.portfolio_sv || 0) < 0 ? '#DC2626' : '#059669'};">${(kpis.portfolio_sv !== undefined && kpis.portfolio_sv !== null) ? Number(kpis.portfolio_sv).toFixed(1) + ' d' : '0.0 d'}</span><span class="portfolio-kpi-sub">Aggregate EV - PV Delta</span></div>
          <div class="portfolio-kpi-card"><span class="portfolio-kpi-title">Milestone Completions</span><span class="portfolio-kpi-val" style="color: #2563EB;">${kpis.milestones ? kpis.milestones.completed : 0} / ${kpis.milestones ? kpis.milestones.total : 0}</span><span class="portfolio-kpi-sub">${kpis.milestones ? kpis.milestones.completion_rate : 0}% Zero-Duration Milestones</span></div>
        </div>

        ${projects.length > 0 ? `
          <div style="border-top: 1px solid var(--border-light); padding-top: 0.9rem;">
            <div style="font-size: 0.85rem; font-weight: 700; color: var(--charcoal); margin-bottom: 0.6rem;">
              Executive Cross-Project Performance Matrix:
            </div>
            <div class="table-responsive">
              <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem;">
                <thead>
                  <tr style="background: #F8FAFC; text-align: left; border-bottom: 1px solid var(--border);">
                    <th style="padding: 6px 10px;">Project Name</th>
                    <th style="padding: 6px 10px;">Status Health</th>
                    <th style="padding: 6px 10px;">Planned Value (PV)</th>
                    <th style="padding: 6px 10px;">Earned Value (EV)</th>
                    <th style="padding: 6px 10px;">Variance (SV)</th>
                    <th style="padding: 6px 10px;">SPI</th>
                    <th style="padding: 6px 10px; min-width: 130px;">Milestones</th>
                    <th style="padding: 6px 10px;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${matrixRows}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    portfolioContainer.querySelectorAll(".btn-portfolio-jump").forEach(b => {
      b.addEventListener("click", () => openProjectWorkspace(b.getAttribute("data-proj-id")));
    });
  }

  loadPortfolio();
  loadExecutivePortfolio();

  // ============================================================================
  // TWO-STAGE PROJECT CREATION WIZARD STATE & LOGIC
  // ============================================================================
  let wizardStage = 1;
  let allUsersCache = [];
  let configuredTeams = [];
  let unassignedUserIds = [];
  let designatedControllerIds = [pmId]; // PM is always automatically included
  let editingTeamIndex = null;
  let draftTeamMemberIds = [];

  // Open & Close Modal
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

  btnOpenCreateModal.addEventListener("click", openCreateWizard);
  btnCloseCreateModal.addEventListener("click", closeCreateWizard);
  btnCancelStage1.addEventListener("click", closeCreateWizard);
  btnCancelStage2.addEventListener("click", closeCreateWizard);

  function resetStage1Inputs() {
    inputProjName.value = "";
    inputProjDesc.value = "";
    inputProjDate.value = todayStr;
    cbAllowMultiTeam.checked = false;
    govFeedbackSingle.style.display = "flex";
    govFeedbackMulti.style.display = "none";
    if (cbOpenParticipation) {
      cbOpenParticipation.checked = false;
      if (partFeedbackApproval) partFeedbackApproval.style.display = "flex";
      if (partFeedbackOpen) partFeedbackOpen.style.display = "none";
    }
    stage1Error.style.display = "none";
  }

  /**
   * Resets all personnel, team assignments, and controllers.
   * Preserves Project Name, Description, and Start Date when returning to Stage 1.
   */
  function resetStage2Personnel() {
    configuredTeams = [];
    unassignedUserIds = [];
    designatedControllerIds = [pmId];
    editingTeamIndex = null;
    draftTeamMemberIds = [];
    inputTeamName.value = "";
    btnCancelTeamEdit.style.display = "none";
    btnConfirmTeam.textContent = "Add Team";
  }

  // Multi-team checkbox dynamic live badge in Stage 1
  cbAllowMultiTeam.addEventListener("change", () => {
    if (cbAllowMultiTeam.checked) {
      govFeedbackSingle.style.display = "none";
      govFeedbackMulti.style.display = "flex";
    } else {
      govFeedbackSingle.style.display = "flex";
      govFeedbackMulti.style.display = "none";
    }
  });

  // Open participation checkbox dynamic live badge in Stage 1
  if (cbOpenParticipation) {
    cbOpenParticipation.addEventListener("change", () => {
      if (cbOpenParticipation.checked) {
        if (partFeedbackApproval) partFeedbackApproval.style.display = "none";
        if (partFeedbackOpen) partFeedbackOpen.style.display = "flex";
      } else {
        if (partFeedbackApproval) partFeedbackApproval.style.display = "flex";
        if (partFeedbackOpen) partFeedbackOpen.style.display = "none";
      }
    });
  }

  // Step 1 -> Step 2 Transition
  btnProceedStage2.addEventListener("click", async () => {
    stage1Error.style.display = "none";
    const name = inputProjName.value.trim();
    const dateVal = inputProjDate.value;

    if (!name) {
      stage1Error.textContent = "Project Name is mandatory.";
      stage1Error.style.display = "block";
      return;
    }

    if (dateVal < todayStr) {
      stage1Error.textContent = `Start Date cannot be in the past. (Selected: ${dateVal}, Today: ${todayStr})`;
      stage1Error.style.display = "block";
      return;
    }

    // Load users cache if empty
    if (allUsersCache.length === 0) {
      const { data: users } = await fetchAllUsers();
      allUsersCache = (users || []).filter(u => String(u.id || u._id) !== pmId);
      allUsersCache.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));
    }

    wizardStage = 2;
    renderWizardStage();
  });

  // Step 2 -> Step 1 (Back button with wiping rule)
  btnBackToStage1.addEventListener("click", () => {
    resetStage2Personnel();
    wizardStage = 1;
    renderWizardStage();
  });

  function renderWizardStage() {
    if (wizardStage === 1) {
      stepIndicator.innerHTML = `
        <span class="badge badge-blue">Step 1 of 2: Charter & Governance</span>
        <span style="color: var(--muted); font-size: 0.8rem;">➔ Step 2: Personnel & Team Allocation</span>
      `;
      stage1Container.style.display = "block";
      stage2Container.style.display = "none";
      stage1Footer.style.display = "flex";
      stage2Footer.style.display = "none";
    } else {
      stepIndicator.innerHTML = `
        <span class="badge badge-gray">✓ Step 1: Charter & Governance</span>
        <span style="color: var(--muted); font-size: 0.8rem;">➔</span>
        <span class="badge badge-blue">Step 2 of 2: Personnel & Team Allocation</span>
      `;
      stage1Container.style.display = "none";
      stage2Container.style.display = "block";
      stage1Footer.style.display = "none";
      stage2Footer.style.display = "flex";

      // Populate confirmed charter summary
      stage2SummaryName.textContent = inputProjName.value.trim();
      stage2SummaryDate.textContent = inputProjDate.value;
      const isMulti = cbAllowMultiTeam.checked;
      stage2SummaryBadge.innerHTML = isMulti
        ? `<span class="badge badge-blue">🔓 Multi-Team Membership</span>`
        : `<span class="badge badge-amber">🔒 Single-Team Exclusivity</span>`;

      // Render locked governance banner
      if (!isMulti) {
        stage2LockedGovBanner.innerHTML = `
          <div class="alert-box alert-amber">
            <span style="font-size: 1.4rem;">🔒</span>
            <div>
              <strong>Governance Policy (Locked): Single-Team Assignment Active.</strong> Contributors already assigned to a team or the unassigned pool cannot be assigned to another team.
            </div>
          </div>
        `;
      } else {
        stage2LockedGovBanner.innerHTML = `
          <div class="alert-box alert-blue">
            <span style="font-size: 1.4rem;">🔓</span>
            <div>
              <strong>Governance Policy (Locked): Multi-Team Membership Enabled.</strong> Contributors can belong to multiple teams across this project simultaneously.
            </div>
          </div>
        `;
      }

      leadControllerName.textContent = `Lead Controller: ${pmFn} ${pmLn} (Project Manager)`;

      renderTeamBuilderSection();
      renderUnassignedSection();
      renderControllersSection();
      updateRosterKPI();
    }
  }

  // ============================================================================
  // STAGE 2: TEAM BUILDER, DYNAMIC ROLE FILTERING & CONTROLLERS
  // ============================================================================
  function getGloballyBlockedIds() {
    if (cbAllowMultiTeam.checked) return new Set();

    const blocked = new Set();
    // Block members in other teams (excluding the team currently being edited)
    configuredTeams.forEach((t, idx) => {
      if (editingTeamIndex !== null && idx === editingTeamIndex) return;
      (t.member_ids || []).forEach(mid => blocked.add(String(mid)));
    });
    // Block unassigned pool
    unassignedUserIds.forEach(uid => blocked.add(String(uid)));

    return blocked;
  }

  function renderTeamBuilderSection() {
    const blocked = getGloballyBlockedIds();
    const availableForTeam = allUsersCache.filter(u => !blocked.has(String(u.id || u._id)));

    // Calculate dynamic roles
    // Rule: if all candidates for a specific role are already selected in this team (or blocked), that role disappears!
    const draftSet = new Set(draftTeamMemberIds.map(String));
    const allRoles = Array.from(new Set(availableForTeam.map(u => (u.role || "Member").trim()))).sort();

    const visibleRoles = [];
    allRoles.forEach(role => {
      const candidatesForRole = availableForTeam.filter(u => (u.role || "Member").trim() === role);
      const remainingUnselected = candidatesForRole.filter(u => !draftSet.has(String(u.id || u._id)));
      if (remainingUnselected.length > 0) {
        visibleRoles.push(role);
      }
    });

    // Populate role filter dropdown
    const currentSelectedRole = selectTeamRole.value || "All Roles";
    let roleOptionsHtml = `<option value="All Roles">All Roles</option>`;
    visibleRoles.forEach(r => {
      const isSel = r === currentSelectedRole ? "selected" : "";
      roleOptionsHtml += `<option value="${r}" ${isSel}>${r}</option>`;
    });
    selectTeamRole.innerHTML = roleOptionsHtml;

    renderTeamCandidates();
    renderTeamLeadOptions(editingTeamIndex !== null && configuredTeams[editingTeamIndex] ? (configuredTeams[editingTeamIndex].lead_id || "") : (selectTeamLead ? selectTeamLead.value : ""));
    renderConfiguredTeamsList();
  }

  function renderTeamLeadOptions(selectedLeadId = "") {
    if (!selectTeamLead) return;
    let html = `<option value="">(None / No Designated Lead)</option>`;
    draftTeamMemberIds.forEach(uid => {
      const u = allUsersCache.find(x => String(x.id || x._id) === String(uid));
      if (u) {
        const isSel = String(selectedLeadId) === String(uid) ? "selected" : "";
        html += `<option value="${uid}" ${isSel}>👑 ${u.last_name}, ${u.first_name} (${u.role || 'Member'})</option>`;
      }
    });
    selectTeamLead.innerHTML = html;
  }

  function renderTeamCandidates() {
    const blocked = getGloballyBlockedIds();
    const filterRole = selectTeamRole.value || "All Roles";
    const draftSet = new Set(draftTeamMemberIds.map(String));

    let candidates = allUsersCache.filter(u => !blocked.has(String(u.id || u._id)));
    if (filterRole !== "All Roles") {
      candidates = candidates.filter(u => (u.role || "Member").trim() === filterRole);
    }

    if (candidates.length === 0) {
      teamCandidateContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); margin: 0.4rem 0;">No available personnel matching this filter.</p>`;
      return;
    }

    let itemsHtml = "";
    candidates.forEach(u => {
      const uid = String(u.id || u._id);
      const isChecked = draftSet.has(uid) ? "checked" : "";
      const role = u.role || "Member";
      itemsHtml += `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 4px 0; cursor: pointer; user-select: none;">
          <input type="checkbox" class="cb-team-member" value="${uid}" ${isChecked}>
          <span><strong>${u.last_name}, ${u.first_name}</strong> • ${role}</span>
        </label>
      `;
    });
    teamCandidateContainer.innerHTML = itemsHtml;

    // Attach change handlers
    teamCandidateContainer.querySelectorAll(".cb-team-member").forEach(cb => {
      cb.addEventListener("change", (e) => {
        const uid = e.target.value;
        if (e.target.checked) {
          if (!draftTeamMemberIds.includes(uid)) draftTeamMemberIds.push(uid);
        } else {
          draftTeamMemberIds = draftTeamMemberIds.filter(id => id !== uid);
        }
        renderTeamBuilderSection();
      });
    });
  }

  // Handle Role Filter Change
  selectTeamRole.addEventListener("change", () => {
    renderTeamCandidates();
  });

  // "Add All Filtered" Button
  btnAddAllFiltered.addEventListener("click", () => {
    const blocked = getGloballyBlockedIds();
    const filterRole = selectTeamRole.value || "All Roles";

    let candidates = allUsersCache.filter(u => !blocked.has(String(u.id || u._id)));
    if (filterRole !== "All Roles") {
      candidates = candidates.filter(u => (u.role || "Member").trim() === filterRole);
    }

    candidates.forEach(u => {
      const uid = String(u.id || u._id);
      if (!draftTeamMemberIds.includes(uid)) {
        draftTeamMemberIds.push(uid);
      }
    });

    renderTeamBuilderSection();
  });

  // Add / Confirm Team
  btnConfirmTeam.addEventListener("click", () => {
    const tName = inputTeamName.value.trim();
    if (!tName) {
      alert("Please provide a designation for the team.");
      return;
    }

    const leadId = selectTeamLead && selectTeamLead.value ? selectTeamLead.value : null;

    if (editingTeamIndex !== null) {
      // Update existing team in place
      configuredTeams[editingTeamIndex].name = tName;
      configuredTeams[editingTeamIndex].member_ids = [...draftTeamMemberIds];
      configuredTeams[editingTeamIndex].lead_id = leadId;
      editingTeamIndex = null;
      btnConfirmTeam.textContent = "Add Team";
      btnCancelTeamEdit.style.display = "none";
    } else {
      // Add new team
      const newTeamId = `TEAM-${configuredTeams.length + 1}`;
      configuredTeams.push({
        team_id: newTeamId,
        name: tName,
        member_ids: [...draftTeamMemberIds],
        lead_id: leadId
      });
    }

    // Auto-clear team name as requested!
    inputTeamName.value = "";
    draftTeamMemberIds = [];
    selectTeamRole.value = "All Roles";
    if (selectTeamLead) selectTeamLead.value = "";

    renderTeamBuilderSection();
    renderUnassignedSection();
    updateRosterKPI();
  });

  // Cancel Team Edit
  btnCancelTeamEdit.addEventListener("click", () => {
    editingTeamIndex = null;
    inputTeamName.value = "";
    draftTeamMemberIds = [];
    if (selectTeamLead) selectTeamLead.value = "";
    btnConfirmTeam.textContent = "Add Team";
    btnCancelTeamEdit.style.display = "none";
    renderTeamBuilderSection();
  });

  function renderConfiguredTeamsList() {
    if (configuredTeams.length === 0) {
      configuredTeamsList.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); margin: 0.6rem 0;">No teams assembled yet.</p>`;
      return;
    }

    let listHtml = "";
    configuredTeams.forEach((team, idx) => {
      const memberNames = (team.member_ids || []).map(mid => {
        const u = allUsersCache.find(x => String(x.id || x._id) === String(mid));
        return u ? `${u.last_name}, ${u.first_name} (${u.role || 'Member'})` : `User ${mid}`;
      }).join(", ");

      const leadUser = team.lead_id ? allUsersCache.find(x => String(x.id || x._id) === String(team.lead_id)) : null;
      const leadBadge = leadUser 
        ? `<span class="badge badge-amber" style="margin-left: 6px;">👑 Lead: ${leadUser.first_name} ${leadUser.last_name}</span>`
        : "";

      listHtml += `
        <div style="background: #FFFFFF; border: 1px solid var(--border-light); border-left: 4px solid var(--primary); border-radius: var(--radius-sm); padding: 0.8rem 1rem; margin-bottom: 0.6rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong>🏢 ${team.name}</strong> 
            <span class="badge badge-blue" style="margin-left: 6px;">${team.member_ids.length} Members</span>
            ${leadBadge}
            <div style="font-size: 0.82rem; color: var(--slate); margin-top: 3px;">
              ${memberNames || "No members"}
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm btn-edit-team" data-index="${idx}">✏️ Edit</button>
            <button class="btn btn-secondary btn-sm btn-remove-team" data-index="${idx}" style="color: #DC2626;">🗑️</button>
          </div>
        </div>
      `;
    });

    configuredTeamsList.innerHTML = listHtml;

    configuredTeamsList.querySelectorAll(".btn-edit-team").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        editingTeamIndex = idx;
        const targetTeam = configuredTeams[idx];
        inputTeamName.value = targetTeam.name;
        draftTeamMemberIds = [...targetTeam.member_ids];
        btnConfirmTeam.textContent = "Update Team";
        btnCancelTeamEdit.style.display = "inline-flex";
        renderTeamBuilderSection();
        renderTeamLeadOptions(targetTeam.lead_id || "");
      });
    });

    configuredTeamsList.querySelectorAll(".btn-remove-team").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        configuredTeams.splice(idx, 1);
        if (editingTeamIndex === idx) {
          editingTeamIndex = null;
          inputTeamName.value = "";
          draftTeamMemberIds = [];
          btnConfirmTeam.textContent = "Add Team";
          btnCancelTeamEdit.style.display = "none";
        }
        renderTeamBuilderSection();
        renderUnassignedSection();
        updateRosterKPI();
      });
    });
  }

  // 1-Click Import Reusable Teams Library
  btnImportReusable.addEventListener("click", async () => {
    btnImportReusable.disabled = true;
    btnImportReusable.textContent = "Importing...";
    const { data: libraryTeams } = await fetchReusableTeams(pmId);
    btnImportReusable.disabled = false;
    btnImportReusable.textContent = "📚 Import from Reusable Teams Library";

    if (!libraryTeams || libraryTeams.length === 0) {
      alert("No reusable teams found in your library.");
      return;
    }

    libraryTeams.forEach(lt => {
      // Avoid duplicate team name
      if (!configuredTeams.some(ct => ct.name.toLowerCase() === lt.name.toLowerCase())) {
        configuredTeams.push({
          team_id: `TEAM-${configuredTeams.length + 1}`,
          name: lt.name,
          member_ids: [...(lt.member_ids || [])]
        });
      }
    });

    renderTeamBuilderSection();
    renderUnassignedSection();
    updateRosterKPI();
  });

  // Section 2.A.2: Unassigned Individual Contributors Pool
  function renderUnassignedSection() {
    const isMulti = cbAllowMultiTeam.checked;
    const allocatedToTeams = new Set();
    if (!isMulti) {
      configuredTeams.forEach(t => {
        (t.member_ids || []).forEach(mid => allocatedToTeams.add(String(mid)));
      });
    }

    const availableForUnassigned = allUsersCache.filter(u => !allocatedToTeams.has(String(u.id || u._id)));

    if (availableForUnassigned.length === 0) {
      unassignedContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); margin: 0.4rem 0;">All contributors are already assigned to teams.</p>`;
      return;
    }

    let itemsHtml = "";
    availableForUnassigned.forEach(u => {
      const uid = String(u.id || u._id);
      const isChecked = unassignedUserIds.includes(uid) ? "checked" : "";
      itemsHtml += `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 4px 0; cursor: pointer; user-select: none;">
          <input type="checkbox" class="cb-unassigned" value="${uid}" ${isChecked}>
          <span><strong>${u.last_name}, ${u.first_name}</strong> • ${u.role || 'Member'}</span>
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
        renderTeamBuilderSection();
        updateRosterKPI();
      });
    });
  }

  // Section 2.B: Project Controllers
  function renderControllersSection() {
    // Controllers can be chosen from any user (even if already in a team!)
    let itemsHtml = "";
    allUsersCache.forEach(u => {
      const uid = String(u.id || u._id);
      const isChecked = designatedControllerIds.includes(uid) ? "checked" : "";
      itemsHtml += `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; padding: 4px 0; cursor: pointer; user-select: none;">
          <input type="checkbox" class="cb-controller" value="${uid}" ${isChecked}>
          <span><strong>${u.last_name}, ${u.first_name}</strong> • ${u.role || 'Member'}</span>
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
  btnInitProject.addEventListener("click", async () => {
    btnInitProject.disabled = true;
    btnInitProject.textContent = "Initializing Project...";

    // Ensure PM is always in controllers and assigned_user_ids
    if (!designatedControllerIds.includes(pmId)) designatedControllerIds.unshift(pmId);

    const allAssigned = new Set(unassignedUserIds);
    allAssigned.add(pmId);
    configuredTeams.forEach(t => {
      (t.member_ids || []).forEach(mid => allAssigned.add(String(mid)));
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
});
