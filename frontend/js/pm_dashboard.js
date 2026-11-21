/**
 * SyncFlow Frontend - Project Manager Dashboard & Two-Stage Project Creation Wizard
 * High-performance Vanilla JavaScript implementation replacing Streamlit UI.
 */

import {
  fetchProjects,
  fetchUserProfile,
  deleteProject,
  fetchPortfolioDashboard
} from "./api.js";
import { requireAuth, renderProfileSidebar, setLoggedUser } from "./auth.js";
import { initNotificationBell } from "./notifications.js";
import { escapeHtml } from "./utility.js";
import { initProjectCreationWizard } from "./pm_dashboard_wizard.js";

// Reusable HTML escape utility imported from shared utility.js
const safeEscapeHtml = escapeHtml;

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

  // Delete Project Confirmation Modal Elements
  const deleteModal = document.getElementById("delete-project-modal");
  const deleteModalProjName = document.getElementById("delete-modal-project-name");
  const deleteModalError = document.getElementById("delete-modal-error");
  const btnCloseDeleteModal = document.getElementById("btn-close-delete-modal");
  const btnCancelDelete = document.getElementById("btn-cancel-delete");
  const btnConfirmDelete = document.getElementById("btn-confirm-delete");
  let projectToDelete = null;


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

  /**
 * Navigates to the PM Workspace for the selected project.
 */
function openProjectWorkspace(projId) {
    if (projId) {
      sessionStorage.setItem("active_project_id", projId);
      window.location.href = "/project_manager/workspace.html";
    }
  }

  /**
 * Generates HTML card markup for a project summary on the dashboard grid.
 */
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
  /**
 * Fetches all projects created by current PM and renders the project grid.
 */
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

  /**
 * Opens confirmation modal to delete a project.
 */
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

  /**
 * Closes project deletion confirmation modal.
 */
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

  // Multi-Project Executive Portfolio Overview
  const portfolioContainer = document.getElementById("portfolio-dashboard-container");

  /**
 * Loads aggregated portfolio metrics (PV, EV, SV, SPI) and cross-project health.
 */
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

  // INITIALIZE TWO-STAGE PROJECT CREATION WIZARD
  initProjectCreationWizard(pmId);
});
