/**
 * SyncFlow Frontend - Member Projects, Search, Notifications & Profile (member_projects.js)
 * Implements:
 *  - Participating projects portfolio and direct in-page selection
 *  - Search & discovery with instant join and PM approval requests
 *  - Join Choice Modal (individual vs team allocation)
 *  - Notifications log and read/delete management
 *  - Member profile management
 */

import {
  searchAvailableProjects,
  joinProject,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification
} from "./api.js";
import { setLoggedUser, renderProfileSidebar } from "./auth.js";
import { formatTime, escapeHtml, getNotificationMeta } from "./utility.js";
import { memberState } from "./member_workspace_state.js";

// =========================================================================
// MODULE SCOPE REFERENCES & CALLBACKS
// =========================================================================
let callbacks = {
  switchMainView: () => {},
  refreshSidebarBadge: () => {},
  loadAssignedTasksPage: () => {}
};

let myProjectsContainer = null;
let inputSearchQuery = null;
let searchResultsCountBadge = null;
let searchResultsContainer = null;
let fullNotificationsContainer = null;
let btnTabMarkAllRead = null;
let profileFormContainer = null;

// Join choice modal elements
let joinChoiceModal = null;
let joinChoiceTitle = null;
let joinChoiceSubtitle = null;
let joinRadioIndividual = null;
let joinRadioTeam = null;
let joinLblIndividual = null;
let joinLblTeam = null;
let joinTeamBox = null;
let joinTeamDropdown = null;
let joinTeamEmptyHint = null;
let joinPolicyNotice = null;
let btnCloseJoinModal = null;
let btnCancelJoinChoice = null;
let btnConfirmJoinChoice = null;
let activeJoinTarget = null; // { pid, proj, isOpen, triggerBtn }

/**
 * Initializes the Member Projects, Search, Notifications, and Profile features.
 */
export function initMemberProjects(cbs) {
  callbacks = { ...callbacks, ...cbs };

  // DOM Elements - View 1
  myProjectsContainer = document.getElementById("member-my-projects-container");
  const btnGotoSearchProjects = document.getElementById("btn-goto-search-projects");
  if (btnGotoSearchProjects) {
    btnGotoSearchProjects.addEventListener("click", () => callbacks.switchMainView("search-projects"));
  }

  document.querySelectorAll(".btn-inpage-view-all-projects").forEach(btn => {
    btn.addEventListener("click", () => callbacks.switchMainView("projects"));
  });

  // DOM Elements - View 2
  inputSearchQuery = document.getElementById("input-member-search-query");
  const btnExecSearch = document.getElementById("btn-exec-search");
  const btnClearSearch = document.getElementById("btn-clear-member-search");
  const searchFilterPills = document.querySelectorAll(".search-filter-pill");
  searchResultsCountBadge = document.getElementById("search-results-count-badge");
  searchResultsContainer = document.getElementById("member-search-results-container");

  // Search input events with debouncing
  let searchDebounceTimer = null;
  const triggerSearch = (delay = 350) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const q = inputSearchQuery ? inputSearchQuery.value.trim() : "";
      loadSearchProjects(q);
    }, delay);
  };

  if (inputSearchQuery) {
    inputSearchQuery.addEventListener("input", () => triggerSearch(350));
    inputSearchQuery.addEventListener("keydown", (e) => { if (e.key === "Enter") triggerSearch(0); });
  }
  if (btnExecSearch) btnExecSearch.addEventListener("click", () => triggerSearch(0));
  if (btnClearSearch) {
    btnClearSearch.addEventListener("click", () => {
      if (inputSearchQuery) inputSearchQuery.value = "";
      triggerSearch(0);
    });
  }

  // Filter pills
  searchFilterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      searchFilterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      memberState.currentSearchFilter = pill.dataset.filter;
      renderSearchResults();
    });
  });

  // Join Choice Modal Elements
  joinChoiceModal = document.getElementById("modal-join-choice");
  joinChoiceTitle = document.getElementById("join-choice-project-title");
  joinChoiceSubtitle = document.getElementById("join-choice-project-subtitle");
  joinRadioIndividual = document.getElementById("join-radio-individual");
  joinRadioTeam = document.getElementById("join-radio-team");
  joinLblIndividual = document.getElementById("lbl-join-individual");
  joinLblTeam = document.getElementById("lbl-join-team");
  joinTeamBox = document.getElementById("join-team-selection-box");
  joinTeamDropdown = document.getElementById("join-team-dropdown");
  joinTeamEmptyHint = document.getElementById("join-team-empty-hint");
  joinPolicyNotice = document.getElementById("join-choice-policy-notice");
  btnCloseJoinModal = document.getElementById("btn-close-join-modal");
  btnCancelJoinChoice = document.getElementById("btn-cancel-join-choice");
  btnConfirmJoinChoice = document.getElementById("btn-confirm-join-choice");

  if (joinRadioIndividual && joinRadioTeam) {
    joinRadioIndividual.addEventListener("change", updateJoinChoiceRadioStyles);
    joinRadioTeam.addEventListener("change", updateJoinChoiceRadioStyles);
  }
  if (btnCloseJoinModal) btnCloseJoinModal.addEventListener("click", closeJoinChoiceModal);
  if (btnCancelJoinChoice) btnCancelJoinChoice.addEventListener("click", closeJoinChoiceModal);
  if (joinChoiceModal) {
    joinChoiceModal.addEventListener("click", (e) => {
      if (e.target === joinChoiceModal) closeJoinChoiceModal();
    });
  }

  if (btnConfirmJoinChoice) {
    btnConfirmJoinChoice.addEventListener("click", handleConfirmJoinChoice);
  }

  // DOM Elements - View 4
  fullNotificationsContainer = document.getElementById("full-notifications-container");
  btnTabMarkAllRead = document.getElementById("btn-tab-mark-all-read");
  if (btnTabMarkAllRead) {
    btnTabMarkAllRead.addEventListener("click", async () => {
      btnTabMarkAllRead.disabled = true;
      btnTabMarkAllRead.textContent = "Marking...";
      await markAllNotificationsRead(memberState.userId);
      await loadNotificationsLog();
      callbacks.refreshSidebarBadge();
      if (memberState.bellCtrl) memberState.bellCtrl.refresh();
      btnTabMarkAllRead.disabled = false;
      btnTabMarkAllRead.textContent = "✓ Mark All as Read";
    });
  }

  // DOM Elements - View 5
  profileFormContainer = document.getElementById("member-profile-form-container");

  // Real-time listener for notification updates (instant sidebar badge update)
  const sidebarNotifBadge = document.getElementById("sidebar-notif-badge");
  window.addEventListener("syncflow:notifications_updated", (e) => {
    const count = (e.detail && e.detail.unread_count !== undefined) ? e.detail.unread_count : null;
    if (sidebarNotifBadge) {
      if (count !== null) {
        if (count > 0) {
          sidebarNotifBadge.textContent = count > 99 ? "99+" : String(count);
          sidebarNotifBadge.style.display = "inline-block";
        } else {
          sidebarNotifBadge.style.display = "none";
        }
      } else {
        callbacks.refreshSidebarBadge();
      }
    }
  });
}

// =========================================================================
// VIEW 1: PARTICIPATING PROJECTS PORTFOLIO
// =========================================================================

/**
 * Loads all projects where the current user is a team member, contributor, or controller.
 */
export async function loadParticipatingProjects() {
  if (!myProjectsContainer) return;
  myProjectsContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 2.5rem 0;">Loading your projects...</p>`;

  // Query projects with membership_status computed
  const { data: allProjects, error } = await searchAvailableProjects(memberState.userId, "");
  if (error) {
    myProjectsContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load projects: ${error}</div>`;
    return;
  }

  memberState.participatingProjects = (allProjects || []).filter(p => p.membership_status === "member" || p.membership_status === "pm");

  // Also update in-page project pills for schedule view
  renderInpageProjectPills();

  if (memberState.participatingProjects.length === 0) {
    myProjectsContainer.innerHTML = `
      <div style="background: #FFFFFF; border: 1.5px dashed var(--border); border-radius: var(--radius-md); padding: 3rem 2rem; text-align: center;">
        <div style="font-size: 3rem; margin-bottom: 0.6rem;">📂</div>
        <h3 style="margin: 0 0 0.4rem 0; color: var(--charcoal); font-size: 1.3rem;">You are not enrolled in any projects yet</h3>
        <p style="margin: 0 0 1.5rem 0; color: var(--slate); font-size: 0.95rem; max-width: 520px; margin-left: auto; margin-right: auto;">
          Explore open projects across SyncFlow to join immediately, or submit a request to the Project Manager for approval.
        </p>
        <button id="btn-empty-goto-search" class="btn btn-primary" style="padding: 0.75rem 1.6rem; font-weight: 700;">
          🔍 Search &amp; Join Projects Now
        </button>
      </div>
    `;
    const btnEmptySearch = document.getElementById("btn-empty-goto-search");
    if (btnEmptySearch) btnEmptySearch.addEventListener("click", () => callbacks.switchMainView("search-projects"));
    return;
  }

  // Default activeProjectId if not set or invalid
  if (!memberState.activeProjectId || !memberState.participatingProjects.some(p => p.id === memberState.activeProjectId)) {
    const stored = sessionStorage.getItem("active_project_id");
    if (stored && memberState.participatingProjects.some(p => p.id === stored)) {
      memberState.activeProjectId = stored;
    } else {
      memberState.activeProjectId = memberState.participatingProjects[0].id;
      sessionStorage.setItem("active_project_id", memberState.activeProjectId);
    }
  }

  let cardsHtml = "";
  memberState.participatingProjects.forEach(p => {
    const pid = p.id || p._id;
    const isSelected = pid === memberState.activeProjectId;
    const pName = p.name || "Untitled Project";
    const pDesc = p.description || "No project charter description available.";
    const sDate = p.start_date || "Not set";
    const pmName = p.pm_name || "Project Manager";
    const teamsCount = p.teams_count || 0;
    const membersCount = p.members_count || 0;
    const activitiesCount = p.activities_count || 0;

    cardsHtml += `
      <div class="project-search-card ${isSelected ? 'project-card-active' : ''}" style="cursor: pointer;" data-proj-id="${pid}">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 0.6rem; flex-wrap: wrap;">
            <h3 style="margin: 0; font-size: 1.2rem; color: var(--charcoal); font-weight: 800;">
              ${pName}
            </h3>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${isSelected ? `<span class="badge badge-blue">⭐ Currently Selected</span>` : `<span class="badge badge-green">✓ Active Member</span>`}
            </div>
          </div>
          <p style="font-size: 0.88rem; color: var(--slate); line-height: 1.45; margin-bottom: 0.9rem;">
            ${pDesc}
          </p>
        </div>
        <div>
          <div style="font-size: 0.82rem; color: var(--muted); margin-bottom: 0.9rem; display: flex; flex-direction: column; gap: 3px; background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 8px 12px;">
            <span>📅 Planned Start: <strong>${sDate}</strong></span>
            <span>⭐ Project Manager: <strong>${pmName}</strong></span>
            <span>🏢 ${teamsCount} Teams • 👥 ${membersCount} Members • ⚡ ${activitiesCount} Activities</span>
          </div>
          <button type="button" class="btn ${isSelected ? 'btn-primary' : 'btn-outline-primary'} btn-block btn-select-project" data-proj-id="${pid}" style="font-weight: 700;">
            ${isSelected ? '✓ Selected • View Schedule →' : '⚡ Select Project & View Schedule →'}
          </button>
        </div>
      </div>
    `;
  });

  myProjectsContainer.innerHTML = `<div class="project-grid">${cardsHtml}</div>`;

  // Click listeners on project cards and buttons to make selection directly from page
  myProjectsContainer.querySelectorAll(".project-search-card").forEach(card => {
    card.addEventListener("click", async () => {
      const pid = card.getAttribute("data-proj-id");
      if (pid) {
        selectProjectDirectly(pid);
      }
    });
  });
}

/**
 * Sets the active project context and reloads assigned tasks for the agenda.
 */
export async function selectProjectDirectly(pid) {
  memberState.activeProjectId = pid;
  sessionStorage.setItem("active_project_id", pid);
  renderInpageProjectPills();
  callbacks.switchMainView("assigned-tasks");
}

/**
 * Renders interactive project selection pills in the top header of the workspace.
 */
export function renderInpageProjectPills() {
  const pillContainers = document.querySelectorAll(".inpage-project-pills");
  const nameDisplays = document.querySelectorAll(".inpage-active-project-name");

  if (memberState.participatingProjects.length === 0) {
    pillContainers.forEach(container => {
      container.innerHTML = `<span style="font-size: 0.82rem; color: var(--muted);">No projects available</span>`;
    });
    return;
  }

  let pillsHtml = "";
  memberState.participatingProjects.forEach(p => {
    const pid = p.id || p._id;
    const isSelected = pid === memberState.activeProjectId;
    pillsHtml += `
      <button type="button" class="inpage-project-pill ${isSelected ? 'active' : ''}" data-proj-id="${pid}">
        ${isSelected ? '⭐ ' : ''}${p.name}
      </button>
    `;
  });

  pillContainers.forEach(container => {
    container.innerHTML = pillsHtml;
    container.querySelectorAll(".inpage-project-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        const pid = pill.getAttribute("data-proj-id");
        if (pid && pid !== memberState.activeProjectId) {
          memberState.activeProjectId = pid;
          sessionStorage.setItem("active_project_id", pid);
          renderInpageProjectPills();
          const activeNav = document.querySelector("#workspace-nav .sidebar-nav-item.active");
          const curView = activeNav ? activeNav.dataset.view : "assigned-tasks";
          if (curView === "assigned-tasks") callbacks.loadAssignedTasksPage();
        }
      });
    });
  });

  const activeObj = memberState.participatingProjects.find(p => p.id === memberState.activeProjectId);
  if (activeObj) {
    nameDisplays.forEach(el => {
      el.textContent = activeObj.name;
    });
  }
}

// =========================================================================
// VIEW 2: SEARCH & DISCOVERY PROJECTS
// =========================================================================

/**
 * Searches all available projects across the system matching an optional query string.
 */
export async function loadSearchProjects(query = "") {
  if (!searchResultsContainer) return;
  searchResultsContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 2.5rem 0;">Searching available projects...</p>`;
  const { data: list, error } = await searchAvailableProjects(memberState.userId, query);
  if (error) {
    searchResultsContainer.innerHTML = `<div class="alert-box alert-danger">Project search failed: ${error}</div>`;
    return;
  }

  memberState.allSearchProjects = list || [];
  renderSearchResults();
}

/**
 * Renders search results with project cards, PM information, and interactive join buttons.
 */
export function renderSearchResults() {
  if (!searchResultsContainer) return;
  let filtered = memberState.allSearchProjects;
  if (memberState.currentSearchFilter === "open") filtered = filtered.filter(p => Boolean(p.open_participation));
  else if (memberState.currentSearchFilter === "approval") filtered = filtered.filter(p => !Boolean(p.open_participation));
  else if (memberState.currentSearchFilter === "joined") filtered = filtered.filter(p => p.membership_status === "member" || p.membership_status === "pm");

  if (searchResultsCountBadge) {
    searchResultsCountBadge.textContent = `Showing ${filtered.length} of ${memberState.allSearchProjects.length} projects`;
  }

  if (filtered.length === 0) {
    searchResultsContainer.innerHTML = `
      <div style="background: #FFFFFF; border: 1.5px dashed var(--border); border-radius: var(--radius-md); padding: 3rem 2rem; text-align: center; color: var(--muted);">
        <div style="font-size: 2.8rem; margin-bottom: 0.5rem;">🔍</div>
        <h4 style="margin: 0 0 0.3rem 0; color: var(--charcoal); font-size: 1.15rem;">No Projects Matched Your Search</h4>
        <p style="font-size: 0.9rem; margin: 0;">Try adjusting your search keywords or filter pills.</p>
      </div>
    `;
    return;
  }

  let cardsHtml = "";
  filtered.forEach(p => {
    const pid = p.id || p._id;
    const pName = p.name || "Untitled Project";
    const pDesc = p.description || "No project description provided.";
    const sDate = p.start_date || "Not set";
    const pmName = p.pm_name || "Project Manager";
    const isOpen = Boolean(p.open_participation);
    const status = p.membership_status || "none";
    const teamsCount = p.teams_count || 0;
    const membersCount = p.members_count || 0;
    const isMember = status === "member" || status === "pm";

    const policyBadge = isOpen
      ? `<span class="badge badge-blue" style="font-weight: 700;" title="You can join immediately without waiting for PM confirmation">🌐 Open Participation</span>`
      : `<span class="badge badge-amber" style="font-weight: 700;" title="Requires Project Manager confirmation to participate">🛡️ Approval Required</span>`;

    const actionHtml = isMember ? `
      <div style="background: #F0FDF4; border: 1px solid #86EFAC; border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 0.6rem; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span style="font-size: 0.82rem; color: #166534; font-weight: 700;">✓ You are already a member</span>
        <span style="font-size: 0.75rem; color: #15803D;">Active Status</span>
      </div>
      <button type="button" class="btn btn-primary btn-block btn-select-search-project" data-proj-id="${pid}">
        📁 Select Project &amp; Open Schedule →
      </button>`
    : status === "pending" ? `
      <div style="background: #FEF3C7; border: 1px solid #F59E0B; border-radius: var(--radius-sm); padding: 10px 14px; text-align: center; color: #92400E; font-weight: 700; font-size: 0.85rem; margin-bottom: 0.4rem;">
        ⏳ Access Request Pending PM Approval
      </div>
      <p style="font-size: 0.76rem; color: var(--muted); text-align: center; margin: 0;">The Project Manager was notified. You will receive a notification once confirmed.</p>`
    : isOpen ? `
      <div style="font-size: 0.78rem; color: #2563EB; margin-bottom: 0.4rem;">⚡ <strong>Open Enrollment:</strong> Join immediately and begin working on project tasks.</div>
      <button type="button" class="btn btn-primary btn-block btn-join-project" data-proj-id="${pid}" data-open="true">⚡ Join Project (Immediate Access)</button>`
    : `
      <div style="font-size: 0.78rem; color: #B45309; margin-bottom: 0.4rem;">🛡️ <strong>Private Governance:</strong> Requires approval from ${pmName}.</div>
      <button type="button" class="btn btn-secondary btn-block btn-join-project" data-proj-id="${pid}" data-open="false" style="border: 1px solid var(--border); font-weight: 600;">🛡️ Request to Join Project</button>`;

    cardsHtml += `
      <div class="project-search-card ${isMember ? 'project-card-active' : ''}">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 0.5rem; flex-wrap: wrap;">
            <h3 style="margin: 0; font-size: 1.15rem; color: var(--charcoal); font-weight: 800;">${pName}</h3>
            ${policyBadge}
          </div>
          <p style="font-size: 0.88rem; color: var(--slate); line-height: 1.45; margin-bottom: 0.9rem;">${pDesc}</p>
        </div>
        <div>
          <div style="font-size: 0.82rem; color: var(--muted); margin-bottom: 0.9rem; display: flex; flex-direction: column; gap: 3px; background: #F8FAFC; border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 8px 12px;">
            <span>📅 Planned Start: <strong>${sDate}</strong></span>
            <span>⭐ Project Manager: <strong>${pmName}</strong></span>
            <span>🏢 ${teamsCount} Teams • 👥 ${membersCount} Members</span>
          </div>
          ${actionHtml}
        </div>
      </div>
    `;
  });

  searchResultsContainer.innerHTML = `<div class="project-grid">${cardsHtml}</div>`;

  // Join button clicks
  searchResultsContainer.querySelectorAll(".btn-join-project").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-proj-id");
      const isOpen = btn.getAttribute("data-open") === "true";
      const proj = memberState.allSearchProjects.find(p => (p.id || p._id) === pid);
      openJoinChoiceModal(pid, proj, isOpen, btn);
    });
  });

  // Select project & open schedule from search
  searchResultsContainer.querySelectorAll(".btn-select-search-project").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-proj-id");
      if (pid) selectProjectDirectly(pid);
    });
  });
}

// =========================================================================
// JOIN PROJECT CHOICE MODAL LOGIC (Individual vs Team Assignment)
// =========================================================================

function updateJoinChoiceRadioStyles() {
  if (!joinRadioIndividual || !joinRadioTeam) return;
  if (joinRadioIndividual.checked) {
    if (joinLblIndividual) {
      joinLblIndividual.style.borderColor = "#2563EB";
      joinLblIndividual.style.background = "#EFF6FF";
    }
    if (joinLblTeam) {
      joinLblTeam.style.borderColor = "var(--border)";
      joinLblTeam.style.background = "#ffffff";
    }
    if (joinTeamBox) joinTeamBox.style.display = "none";
  } else {
    if (joinLblTeam) {
      joinLblTeam.style.borderColor = "#2563EB";
      joinLblTeam.style.background = "#EFF6FF";
    }
    if (joinLblIndividual) {
      joinLblIndividual.style.borderColor = "var(--border)";
      joinLblIndividual.style.background = "#ffffff";
    }
    if (joinTeamBox) joinTeamBox.style.display = "block";
  }
}

export function closeJoinChoiceModal() {
  if (joinChoiceModal) joinChoiceModal.style.display = "none";
  activeJoinTarget = null;
}

export function openJoinChoiceModal(pid, proj, isOpen, triggerBtn) {
  if (!joinChoiceModal) return;
  activeJoinTarget = { pid, proj, isOpen, triggerBtn };

  const pName = (proj && proj.name) || "Project";
  if (joinChoiceTitle) joinChoiceTitle.textContent = `🚀 Join Project: ${pName}`;
  if (joinChoiceSubtitle) {
    joinChoiceSubtitle.textContent = isOpen
      ? "Open Enrollment Project — Instant access upon joining"
      : "Private Governance Project — Requires confirmation by the Project Manager";
  }

  if (joinPolicyNotice) {
    joinPolicyNotice.innerHTML = isOpen
      ? `⚡ <strong>Instant Access:</strong> This project has open participation. Once you confirm, you will be enrolled immediately.`
      : `📬 <strong>Approval Required:</strong> Your request will be sent to the Project Manager for approval before you are enrolled.`;
  }

  // Default to Individual
  if (joinRadioIndividual) joinRadioIndividual.checked = true;
  if (joinRadioTeam) joinRadioTeam.checked = false;

  // Populate teams dropdown
  const teams = (proj && proj.teams) || [];
  if (joinTeamDropdown) {
    if (teams.length > 0) {
      joinTeamDropdown.innerHTML = teams.map(t => `<option value="${t.team_id}">${t.name} (${t.member_count || 0} members)</option>`).join("");
      joinTeamDropdown.style.display = "block";
      if (joinTeamEmptyHint) joinTeamEmptyHint.style.display = "none";
      if (joinRadioTeam) joinRadioTeam.disabled = false;
      if (joinLblTeam) {
        joinLblTeam.style.opacity = "1";
        joinLblTeam.style.cursor = "pointer";
      }
    } else {
      joinTeamDropdown.innerHTML = "";
      joinTeamDropdown.style.display = "none";
      if (joinTeamEmptyHint) joinTeamEmptyHint.style.display = "block";
      if (joinRadioTeam) joinRadioTeam.disabled = true;
      if (joinLblTeam) {
        joinLblTeam.style.opacity = "0.6";
        joinLblTeam.style.cursor = "not-allowed";
      }
    }
  }

  updateJoinChoiceRadioStyles();
  if (btnConfirmJoinChoice) {
    btnConfirmJoinChoice.disabled = false;
    btnConfirmJoinChoice.textContent = isOpen ? "🚀 Join Project Now" : "📬 Submit Join Request";
  }
  joinChoiceModal.style.display = "flex";
}

async function handleConfirmJoinChoice() {
  if (!activeJoinTarget) return;
  const { pid, isOpen, triggerBtn } = activeJoinTarget;

  const isTeam = joinRadioTeam && joinRadioTeam.checked;
  const selectedTeamId = isTeam && joinTeamDropdown ? joinTeamDropdown.value : null;

  btnConfirmJoinChoice.disabled = true;
  btnConfirmJoinChoice.textContent = isOpen ? "Joining..." : "Submitting Request...";
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = isOpen ? "Joining..." : "Submitting Request...";
  }

  const { data, error } = await joinProject(pid, memberState.userId, selectedTeamId);

  btnConfirmJoinChoice.disabled = false;
  btnConfirmJoinChoice.textContent = isOpen ? "🚀 Join Project Now" : "📬 Submit Join Request";
  if (triggerBtn) {
    triggerBtn.disabled = false;
    triggerBtn.textContent = isOpen ? "⚡ Join Project (Immediate Access)" : "📬 Request to Join Project";
  }

  if (error) {
    alert(`Join request failed: ${error}`);
    return;
  }

  closeJoinChoiceModal();

  if (isOpen) {
    const teamMsg = selectedTeamId ? " and assigned to your selected team" : " as an individual contributor";
    alert(`✅ You have successfully joined the project${teamMsg}! Selecting project and opening schedule...`);
    await loadParticipatingProjects();
    selectProjectDirectly(pid);
  } else {
    const teamMsg = selectedTeamId ? " (requesting team assignment)" : " (as individual contributor)";
    alert(`📬 Your join request${teamMsg} has been sent to the Project Manager for confirmation. You will receive a notification once approved.`);
    const q = inputSearchQuery ? inputSearchQuery.value.trim() : "";
    await loadSearchProjects(q);
  }

  callbacks.refreshSidebarBadge();
  if (memberState.bellCtrl) memberState.bellCtrl.refresh();
}

// =========================================================================
// VIEW 4: NOTIFICATIONS AUDIT LOG
// =========================================================================

/**
 * Fetches and displays recent project notifications in the Notifications view.
 */
export async function loadNotificationsLog() {
  if (!fullNotificationsContainer) return;
  fullNotificationsContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 2rem 0;">Loading notifications...</p>`;
  const { data: notifications, error } = await fetchNotifications(memberState.userId);

  if (error) {
    fullNotificationsContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load notifications: ${error}</div>`;
    return;
  }

  if (!notifications || notifications.length === 0) {
    fullNotificationsContainer.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--muted);">
        <div style="font-size: 2.6rem; margin-bottom: 0.5rem;">📭</div>
        <h4 style="margin: 0 0 0.3rem 0; font-size: 1.15rem; color: var(--charcoal);">No Project Notifications</h4>
        <p style="font-size: 0.88rem; margin: 0;">You have no notification logs recorded for your active projects.</p>
      </div>
    `;
    return;
  }

  let itemsHtml = "";
  notifications.forEach(n => {
    const isUnread = !n.is_read;
    const type = n.type || "general";

    const meta = getNotificationMeta(type);
    const typeBadge = `<span class="badge ${meta.badgeClass}">${meta.label}</span>`;
    const typeIcon = meta.icon;

    itemsHtml += `
      <div class="notification-item ${isUnread ? 'notification-unread' : 'notification-read'}" style="border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 0.75rem; padding: 1rem 1.2rem;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 0.4rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.2rem;">${typeIcon}</span>
            <strong style="font-size: 0.95rem; color: var(--charcoal);">${n.title}</strong>
            ${typeBadge}
            <span class="project-tag" style="font-size: 0.75rem; color: #1E40AF; background: #DBEAFE; padding: 2px 7px; border-radius: 4px; font-weight: 600;">
              📁 ${n.project_name || 'Project'}
            </span>
          </div>
          <span style="font-size: 0.78rem; color: var(--muted);">${formatTime(n.created_at)}</span>
        </div>
        <p style="font-size: 0.88rem; color: var(--slate); line-height: 1.45; margin: 0 0 0.6rem 0;">
          ${n.message}
        </p>
        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px;">
          ${isUnread 
            ? `<button class="btn btn-outline-primary btn-sm btn-mark-read-view" data-notif-id="${n.id}">● Mark as Read</button>` 
            : `<span style="font-size: 0.78rem; color: #94A3B8; font-weight: 600;">✓ Read</span>`}
          <button type="button" class="btn btn-secondary btn-sm btn-delete-notif-view" data-notif-id="${n.id}" title="Remove notification" style="color: #DC2626; padding: 2px 8px; font-size: 0.78rem;">🗑️ Delete</button>
        </div>
      </div>
    `;
  });

  fullNotificationsContainer.innerHTML = itemsHtml;

  fullNotificationsContainer.querySelectorAll(".btn-mark-read-view").forEach(btn => {
    btn.addEventListener("click", async () => {
      const nid = btn.getAttribute("data-notif-id");
      await markNotificationRead(nid, memberState.userId);
      await loadNotificationsLog();
      callbacks.refreshSidebarBadge();
      if (memberState.bellCtrl) memberState.bellCtrl.refresh();
    });
  });

  fullNotificationsContainer.querySelectorAll(".btn-delete-notif-view").forEach(btn => {
    btn.addEventListener("click", async () => {
      const nid = btn.getAttribute("data-notif-id");
      if (!confirm("Are you sure you want to remove this notification? It will no longer appear in your feed.")) return;
      const { error } = await deleteNotification(nid, memberState.userId);
      if (error) {
        alert(`Failed to delete notification: ${error}`);
        return;
      }
      await loadNotificationsLog();
      callbacks.refreshSidebarBadge();
      if (memberState.bellCtrl) memberState.bellCtrl.refresh();
    });
  });
}

// =========================================================================
// VIEW 5: USER PROFILE MANAGEMENT
// =========================================================================

/**
 * Renders editable profile form in the Profile tab.
 */
export function renderProfileForm() {
  if (!profileFormContainer) return;
  renderProfileSidebar(profileFormContainer, memberState.user, (updated) => {
    setLoggedUser(updated);
    window.location.reload();
  });
}
