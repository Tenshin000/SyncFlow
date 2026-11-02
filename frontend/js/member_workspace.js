/**
 * SyncFlow Frontend – Member Workspace Controller
 * Implements the required non-PM workspace navigation:
 * 1. "Projects" – Grid of participating / accessible projects with in-page selection.
 * 2. "Search Projects" – Visually appealing project discovery, indicating Open vs Approval Required,
 *    identifying joined projects, and allowing immediate join or PM approval request.
 * 3. "Schedule" – Displays tasks the user is assigned to or involved in, with direct in-page project switching.
 * 4. "Notifications" & "Profile" – Audit logs and role governance.
 */

import {
  fetchProjects,
  fetchProjectDetail,
  fetchControlSchedule,
  updateActivityStatus,
  searchAvailableProjects,
  joinProject,
  fetchNotifications,
  fetchUnreadNotificationsCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  fetchUserProfile
} from "./api.js";
import { getLoggedUser, logout, setLoggedUser, renderProfileSidebar } from "./auth.js";
import { initNotificationBell } from "./notifications.js";
import {
  round,
  formatDateYmd,
  escapeHtml,
  getStatusBadge,
  getUserActivityPermission as getUserActivityPermissionUtil,
  getInitials,
  formatTime,
  getNotificationMeta,
  CONTROLLER_CHECKLIST
} from "./utility.js";


document.addEventListener("DOMContentLoaded", async () => {
  // Authentication check: ensure non-PM access
  const rawUser = getLoggedUser();
  if (!rawUser) {
    window.location.href = "/login.html";
    return;
  }

  const isPM = Boolean(rawUser.is_admin) || (rawUser.role && rawUser.role.trim() === "Project Manager");
  if (isPM) {
    window.location.href = "/project_manager/dashboard.html";
    return;
  }

  const userId = String(rawUser.id || rawUser._id);

  // Sync latest user profile
  const { data: freshProfile } = await fetchUserProfile(userId);
  const user = freshProfile || rawUser;
  if (freshProfile) setLoggedUser(freshProfile);

  const userRole = (user.role || "").trim();
  const isController = Boolean(user.is_admin) || userRole === "Controller" || userRole.toLowerCase().includes("controller");

  // DOM Elements - Sidebar & Top Header
  const sidebarAvatar = document.getElementById("member-sidebar-avatar");
  const sidebarName = document.getElementById("member-sidebar-name");
  const sidebarUsername = document.getElementById("member-sidebar-username");
  const sidebarNotifBadge = document.getElementById("sidebar-notif-badge");
  const userBadge = document.getElementById("workspace-user-badge");
  const headerSubtitle = document.getElementById("workspace-header-subtitle");
  const btnLogout = document.getElementById("btn-workspace-logout");

  const navItems = document.querySelectorAll("#workspace-nav .sidebar-nav-item");
  const views = {
    "projects": document.getElementById("view-projects"),
    "search-projects": document.getElementById("view-search-projects"),
    "assigned-tasks": document.getElementById("view-assigned-tasks"),
    "notifications": document.getElementById("view-notifications"),
    "profile": document.getElementById("view-profile")
  };

  // View 1 (Projects) Elements
  const myProjectsContainer = document.getElementById("member-my-projects-container");
  const btnGotoSearchProjects = document.getElementById("btn-goto-search-projects");
  const projectsWelcomeTitle = document.getElementById("projects-welcome-title");

  // View 2 (Search Projects) Elements
  const inputSearchQuery = document.getElementById("input-member-search-query");
  const btnExecSearch = document.getElementById("btn-exec-search");
  const btnClearSearch = document.getElementById("btn-clear-member-search");
  const searchFilterPills = document.querySelectorAll(".search-filter-pill");
  const searchResultsCountBadge = document.getElementById("search-results-count-badge");
  const searchResultsContainer = document.getElementById("member-search-results-container");

  // Agenda Elements
  const btnRefreshAgenda = document.getElementById("btn-refresh-agenda");
  const agendaTasksContainer = document.getElementById("agenda-tasks-container");
  const kpiAgendaTotal = document.getElementById("kpi-agenda-total");
  const kpiAgendaWip = document.getElementById("kpi-agenda-wip");
  const kpiAgendaFinished = document.getElementById("kpi-agenda-finished");
  const kpiAgendaNotStarted = document.getElementById("kpi-agenda-not-started");

  // Modal Elements
  const memberActivityModal = document.getElementById("member-activity-modal");
  const memberActivityForm = document.getElementById("member-activity-form");
  const btnCloseModal = document.getElementById("btn-close-member-modal");
  const btnCancelModal = document.getElementById("btn-cancel-member-modal");
  const modalActId = document.getElementById("modal-act-id");
  const modalActNameDisplay = document.getElementById("modal-act-name-display");
  const modalActInfoDisplay = document.getElementById("modal-act-info-display");
  const modalActStatus = document.getElementById("modal-act-status");
  const modalOptVerified = document.getElementById("modal-opt-verified");
  const modalActProgressRange = document.getElementById("modal-act-progress-range");
  const modalActProgressNum = document.getElementById("modal-act-progress-num");
  const modalActStartDate = document.getElementById("modal-act-start-date");
  const modalActFinishDate = document.getElementById("modal-act-finish-date");
  const modalControllerSignoffBox = document.getElementById("modal-controller-signoff-box");
  const modalSignoffCheck = document.getElementById("modal-signoff-check");
  const modalSignoffUser = document.getElementById("modal-signoff-user");

  // View 4 (Notifications) Elements
  const fullNotificationsContainer = document.getElementById("full-notifications-container");
  const btnTabMarkAllRead = document.getElementById("btn-tab-mark-all-read");

  // View 5 (Profile) Element
  const profileFormContainer = document.getElementById("member-profile-form-container");

  // State Variables
  let participatingProjects = [];
  let allSearchProjects = [];
  let activeProjectId = null;
  let activeProject = null;
  let currentControlModel = null;
  let currentSearchFilter = "all";
  let bellCtrl = null;
  let agendaFilter = "active";
  let agendaViewMode = "table";
  let selectedReviewAct = null;
  let selectedCompleteAct = null;
  let selectedModalAct = null;

  // Render User Information
  const fn = user.first_name || "Team Member";
  const ln = user.last_name || "";
  const un = user.username || "user";
  const initials = getInitials(fn, ln, "M");

  if (sidebarAvatar) sidebarAvatar.textContent = initials;

  if (sidebarName) sidebarName.textContent = `${fn} ${ln}`.trim();
  if (sidebarUsername) sidebarUsername.textContent = `@${un}`;
  if (projectsWelcomeTitle) projectsWelcomeTitle.textContent = `📁 Projects Portfolio — ${fn} ${ln}`;

  userBadge.innerHTML = `
    <div style="background: var(--primary-light); border: 1px solid var(--primary-border); padding: 5px 14px; border-radius: 20px; font-weight: 700; color: var(--primary); font-size: 0.85rem;">
      👤 ${fn} ${ln} (${userRole || "Member"})
    </div>
  `;

  // Controller permissions
  if (!isController && modalOptVerified) {
    modalOptVerified.disabled = true;
    modalOptVerified.textContent = "🔵 Completed & Verified (Requires Controller Role)";
  }

  // Mount Header Notification Bell
  bellCtrl = initNotificationBell("#member-workspace-notification-bell-container", user, null);

  // Refresh sidebar unread count badge
  async function refreshSidebarBadge() {
    const { data } = await fetchUnreadNotificationsCount(userId);
    const count = data ? (data.unread_count || 0) : 0;
    if (count > 0) {
      sidebarNotifBadge.textContent = count > 99 ? "99+" : String(count);
      sidebarNotifBadge.style.display = "inline-block";
    } else {
      sidebarNotifBadge.style.display = "none";
    }
  }
  refreshSidebarBadge();

  // Sidebar Tab Navigation Switcher
  const viewSubtitles = {
    "projects": "My Participating Projects Portfolio & Direct Selection",
    "search-projects": "Discover Projects, Join Open Workspaces & Request Access",
    "assigned-tasks": "Personal Operational Agenda & Activity Execution",
    "notifications": "Project-Level Logs & Activity Notifications",
    "profile": "Member Account & Governance Settings"
  };

  function switchMainView(viewKey) {
    navItems.forEach(item => {
      if (item.dataset.view === viewKey) item.classList.add("active");
      else item.classList.remove("active");
    });

    Object.keys(views).forEach(key => {
      if (views[key]) {
        views[key].style.display = key === viewKey ? "block" : "none";
      }
    });

    if (headerSubtitle && viewSubtitles[viewKey]) {
      headerSubtitle.textContent = viewSubtitles[viewKey];
    }

    if (viewKey === "projects") loadParticipatingProjects();
    if (viewKey === "search-projects") loadSearchProjects();
    if (viewKey === "assigned-tasks") loadAssignedTasksPage();
    if (viewKey === "notifications") loadNotificationsLog();
    if (viewKey === "profile") renderProfileForm();
  }

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const v = item.dataset.view;
      if (v) switchMainView(v);
    });
  });

  if (btnGotoSearchProjects) {
    btnGotoSearchProjects.addEventListener("click", () => switchMainView("search-projects"));
  }

  document.querySelectorAll(".btn-inpage-view-all-projects").forEach(btn => {
    btn.addEventListener("click", () => switchMainView("projects"));
  });

  if (btnLogout) {
    btnLogout.addEventListener("click", () => logout());
  }

  // ============================================================================
  // VIEW 1: PROJECTS (PARTICIPATING / ACCESSIBLE PROJECTS LIST)
  // ============================================================================
  async function loadParticipatingProjects() {
    myProjectsContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 2.5rem 0;">Loading your projects...</p>`;

    // Query projects with membership_status computed
    const { data: allProjects, error } = await searchAvailableProjects(userId, "");
    if (error) {
      myProjectsContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load projects: ${error}</div>`;
      return;
    }

    participatingProjects = (allProjects || []).filter(p => p.membership_status === "member" || p.membership_status === "pm");

    // Also update in-page project pills for schedule view
    renderInpageProjectPills();

    if (participatingProjects.length === 0) {
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
      if (btnEmptySearch) btnEmptySearch.addEventListener("click", () => switchMainView("search-projects"));
      return;
    }

    // Default activeProjectId if not set or invalid
    if (!activeProjectId || !participatingProjects.some(p => p.id === activeProjectId)) {
      const stored = sessionStorage.getItem("active_project_id");
      if (stored && participatingProjects.some(p => p.id === stored)) {
        activeProjectId = stored;
      } else {
        activeProjectId = participatingProjects[0].id;
        sessionStorage.setItem("active_project_id", activeProjectId);
      }
    }

    let cardsHtml = "";
    participatingProjects.forEach(p => {
      const pid = p.id || p._id;
      const isSelected = pid === activeProjectId;
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
      card.addEventListener("click", async (e) => {
        const pid = card.getAttribute("data-proj-id");
        if (pid) {
          selectProjectDirectly(pid);
        }
      });
    });
  }

  // Directly selects project and switches to Assigned Tasks view
  async function selectProjectDirectly(pid) {
    activeProjectId = pid;
    sessionStorage.setItem("active_project_id", pid);
    renderInpageProjectPills();
    switchMainView("assigned-tasks");
  }

  // Renders the in-page project selection pills across views
  function renderInpageProjectPills() {
    const pillContainers = document.querySelectorAll(".inpage-project-pills");
    const nameDisplays = document.querySelectorAll(".inpage-active-project-name");

    if (participatingProjects.length === 0) {
      pillContainers.forEach(container => {
        container.innerHTML = `<span style="font-size: 0.82rem; color: var(--muted);">No projects available</span>`;
      });
      return;
    }

    let pillsHtml = "";
    participatingProjects.forEach(p => {
      const pid = p.id || p._id;
      const isSelected = pid === activeProjectId;
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
          if (pid && pid !== activeProjectId) {
            activeProjectId = pid;
            sessionStorage.setItem("active_project_id", pid);
            renderInpageProjectPills();
            const activeNav = document.querySelector("#workspace-nav .sidebar-nav-item.active");
            const curView = activeNav ? activeNav.dataset.view : "assigned-tasks";
            if (curView === "assigned-tasks") loadAssignedTasksPage();
          }
        });
      });
    });

    const activeObj = participatingProjects.find(p => p.id === activeProjectId);
    if (activeObj) {
      nameDisplays.forEach(el => {
        el.textContent = activeObj.name;
      });
    }
  }

  // ============================================================================
  // VIEW 2: SEARCH PROJECTS (DISCOVERY, POLICIES & JOINING)
  // ============================================================================
  async function loadSearchProjects(query = "") {
    searchResultsContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 2.5rem 0;">Searching available projects...</p>`;
    const { data: list, error } = await searchAvailableProjects(userId, query);

    if (error) {
      searchResultsContainer.innerHTML = `<div class="alert-box alert-danger">Project search failed: ${error}</div>`;
      return;
    }

    allSearchProjects = list || [];
    renderSearchResults();
  }

  function renderSearchResults() {
    let filtered = allSearchProjects;
    if (currentSearchFilter === "open") filtered = filtered.filter(p => Boolean(p.open_participation));
    else if (currentSearchFilter === "approval") filtered = filtered.filter(p => !Boolean(p.open_participation));
    else if (currentSearchFilter === "joined") filtered = filtered.filter(p => p.membership_status === "member" || p.membership_status === "pm");

    searchResultsCountBadge.textContent = `Showing ${filtered.length} of ${allSearchProjects.length} projects`;

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
      btn.addEventListener("click", async () => {
        const pid = btn.getAttribute("data-proj-id");
        const isOpen = btn.getAttribute("data-open") === "true";
        btn.disabled = true;
        btn.textContent = isOpen ? "Joining..." : "Submitting Request...";

        const { data, error } = await joinProject(pid, userId);
        btn.disabled = false;

        if (error) {
          alert(`Join request failed: ${error}`);
          btn.textContent = isOpen ? "⚡ Join Project (Immediate Access)" : "🛡️ Request to Join Project";
          return;
        }

        if (isOpen) {
          alert("🎉 You have successfully joined the project! Selecting project and opening schedule...");
          await loadParticipatingProjects();
          selectProjectDirectly(pid);
        } else {
          alert("📬 Your join request has been sent to the Project Manager for confirmation. You will receive a notification once reviewed.");
          await loadSearchProjects(inputSearchQuery.value.trim());
        }

        refreshSidebarBadge();
        if (bellCtrl) bellCtrl.refresh();
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

  // Search input events with debouncing
  let searchDebounceTimer = null;
  const triggerSearch = (delay = 350) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => loadSearchProjects(inputSearchQuery.value.trim()), delay);
  };
  inputSearchQuery.addEventListener("input", () => triggerSearch(350));
  btnExecSearch.addEventListener("click", () => triggerSearch(0));
  inputSearchQuery.addEventListener("keydown", (e) => { if (e.key === "Enter") triggerSearch(0); });
  btnClearSearch.addEventListener("click", () => { inputSearchQuery.value = ""; triggerSearch(0); });

  // Filter pills
  searchFilterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      searchFilterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      currentSearchFilter = pill.dataset.filter;
      renderSearchResults();
    });
  });

  // ============================================================================
  // VIEW 3: ASSIGNED TASKS (OPERATIONAL AGENDA)
  // ============================================================================
  async function loadAssignedTasksPage() {
    if (!activeProjectId) {
      if (participatingProjects.length > 0) {
        activeProjectId = participatingProjects[0].id;
        sessionStorage.setItem("active_project_id", activeProjectId);
      } else {
        await loadParticipatingProjects();
      }
    }

    if (!activeProjectId) {
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
        if (btnGo) btnGo.addEventListener("click", () => switchMainView("projects"));
      }
      return;
    }

    if (!activeProject || activeProject.id !== activeProjectId) {
      const { data: pDetail } = await fetchProjectDetail(activeProjectId);
      if (pDetail) activeProject = pDetail;
    }

    renderInpageProjectPills();
    await loadAgendaTasks();
  }

  // ── Activity & Controller Permission Helpers ──────────────────────────────
  function isUserController(act = null) {
    const isProjController = Boolean(activeProject && (activeProject.controllers || []).map(String).includes(String(userId)));
    if (act) {
      const isActSpecificCtrl = String(act.controller_id || "") === String(userId);
      return isProjController || isActSpecificCtrl || isController;
    }
    return isProjController || isController;
  }

  const getUserActivityPermission = (act) => getUserActivityPermissionUtil(act, user, activeProject);

  function isActAssignedToUser(act) {
    const assignedUsers = (act.assigned_users || []).map(String);
    if (assignedUsers.includes(String(userId)) || (user.username && assignedUsers.includes(user.username))) {
      return true;
    }
    const myTeamIds = new Set();
    if (activeProject && activeProject.teams) {
      activeProject.teams.forEach(t => {
        if ((t.member_ids || []).map(String).includes(String(userId))) {
          myTeamIds.add(String(t.team_id || ""));
          myTeamIds.add(String(t.name || ""));
        }
      });
    }
    const assignedTeams = (act.assigned_teams || []).map(String);
    for (const t of assignedTeams) {
      if (myTeamIds.has(t)) return true;
    }
    return false;
  }

  // ── Controller Review Modal Elements & Handlers ───────────────────────────
  const controllerReviewModal = document.getElementById("controller-review-modal");
  const btnCloseReviewModal = document.getElementById("btn-close-review-modal");
  const btnCancelReviewModal = document.getElementById("btn-cancel-review-modal");
  const controllerReviewForm = document.getElementById("controller-review-form");
  const modalReviewTitle = document.getElementById("modal-review-title");
  const modalReviewSubtitle = document.getElementById("modal-review-subtitle");
  const modalReviewInfo = document.getElementById("modal-review-info");
  const modalReviewAction = document.getElementById("modal-review-action");
  const modalReviewDescription = document.getElementById("modal-review-description");

  function openControllerReviewModal(act, defaultAction = "verified") {
    selectedReviewAct = act;
    if (modalReviewTitle) modalReviewTitle.textContent = `🛡️ Controller Review: ${act.name}`;
    if (modalReviewSubtitle) modalReviewSubtitle.textContent = act.activity_id;
    if (modalReviewInfo) {
      modalReviewInfo.innerHTML = `
        <strong>Activity:</strong> ${act.name} (${act.activity_id})<br>
        <strong>Plan Duration:</strong> ${act.duration} days | <strong>Status:</strong> 🟢 Completed (Awaiting Controller Review)<br>
        <strong>Assigned Teams:</strong> ${(act.assigned_teams || []).join(", ") || "None"} | <strong>Contributors:</strong> ${(act.assigned_users || []).join(", ") || "None"}
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

  function closeControllerReviewModal() {
    if (controllerReviewModal) controllerReviewModal.style.display = "none";
    selectedReviewAct = null;
  }

  if (btnCloseReviewModal) btnCloseReviewModal.addEventListener("click", closeControllerReviewModal);
  if (btnCancelReviewModal) btnCancelReviewModal.addEventListener("click", closeControllerReviewModal);

  if (controllerReviewForm) {
    controllerReviewForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedReviewAct || !activeProjectId) return;

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
        reviewer_id: userId,
        description: desc,
        verification_checklist: checklistItems
      };

      if (action === "verified") {
        payload.verified_by = `${fn} ${ln} (Controller)`;
        payload.verified_date = new Date().toISOString().split("T")[0];
      }

      const { error } = await updateActivityStatus(activeProjectId, selectedReviewAct.activity_id, payload);
      if (error) {
        alert(`Failed to save controller review decision: ${error}`);
        return;
      }

      alert(action === "verified"
        ? "Activity confirmed as Controlled & Verified (Blue)! Subsequent activities have begun on the nearest business day."
        : "Activity returned to WIP (Yellow). Notification sent to the Project Manager and assigned team.");

      closeControllerReviewModal();
      await loadAgendaTasks();
      refreshSidebarBadge();
      if (bellCtrl) bellCtrl.refresh();
    });
  }

  // ── Member Completion Proof Modal Elements & Handlers ───────────────────────
  const memberCompletionModal = document.getElementById("member-completion-modal");
  const btnCloseCompleteModal = document.getElementById("btn-close-complete-modal");
  const btnCancelCompleteModal = document.getElementById("btn-cancel-complete-modal");
  const memberCompletionForm = document.getElementById("member-completion-form");
  const modalCompleteTitle = document.getElementById("modal-complete-title");
  const modalCompleteSubtitle = document.getElementById("modal-complete-subtitle");
  const modalCompleteInfo = document.getElementById("modal-complete-info");
  const inputCompletionProof = document.getElementById("input-completion-proof");

  function openMemberCompletionModal(act) {
    selectedCompleteAct = act;
    if (modalCompleteTitle) modalCompleteTitle.textContent = `✅ Mark Complete: ${act.name}`;
    if (modalCompleteSubtitle) modalCompleteSubtitle.textContent = act.activity_id;
    if (modalCompleteInfo) {
      modalCompleteInfo.innerHTML = `
        <strong>Activity ID:</strong> ${act.activity_id}<br>
        <strong>Name:</strong> ${act.name}<br>
        <strong>Plan Duration:</strong> ${act.duration}d | <strong>Current Status:</strong> 🟡 Work-in-Progress (WIP)
      `;
    }
    if (inputCompletionProof) inputCompletionProof.value = act.completion_proof || "";
    if (memberCompletionModal) memberCompletionModal.style.display = "flex";
    if (inputCompletionProof) inputCompletionProof.focus();
  }

  function closeMemberCompletionModal() {
    if (memberCompletionModal) memberCompletionModal.style.display = "none";
    selectedCompleteAct = null;
  }

  if (btnCloseCompleteModal) btnCloseCompleteModal.addEventListener("click", closeMemberCompletionModal);
  if (btnCancelCompleteModal) btnCancelCompleteModal.addEventListener("click", closeMemberCompletionModal);

  if (memberCompletionForm) {
    memberCompletionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedCompleteAct || !activeProjectId) return;

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
        const { error } = await updateActivityStatus(activeProjectId, selectedCompleteAct.activity_id, {
          status: "completed",
          reviewer_id: userId,
          completion_proof: proofText
        });

        if (error) {
          alert(`Failed to submit activity for review: ${error}`);
          return;
        }

        alert(`Activity '${selectedCompleteAct.name}' marked complete with evidence! Controller has been notified.`);
        closeMemberCompletionModal();
        await loadAgendaTasks();
        refreshSidebarBadge();
        if (bellCtrl) bellCtrl.refresh();
      } catch (err) {
        alert("Error: " + err.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "🚀 Submit Deliverable & Request Review";
        }
      }
    });
  }

  // ── Perspective 1: My Operational Agenda & Tasks ───────────────────────────
  async function loadAgendaTasks() {
    if (!activeProjectId) return;
    agendaTasksContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 1.5rem 0;">Loading activities...</p>`;

    const { data: ctrlData, error } = await fetchControlSchedule(activeProjectId);
    if (error || !ctrlData) {
      agendaTasksContainer.innerHTML = `<div class="alert-box alert-danger">Failed to load schedule: ${error}</div>`;
      return;
    }

    currentControlModel = ctrlData;
    const activities = ctrlData.activities || [];

    const userIsCtrl = isUserController();
    const ctrlActivities = userIsCtrl ? activities.filter(a => isUserController(a)) : [];
    const myAssignedActivities = activities.filter(a => isActAssignedToUser(a));

    updateAgendaKPIs(myAssignedActivities);
    renderAgendaActivities(ctrlActivities, myAssignedActivities);
  }

  function updateAgendaKPIs(assignedActs) {
    const total = assignedActs.length;
    const wip = assignedActs.filter(a => a.status === "in_progress").length;
    const fin = assignedActs.filter(a => a.status === "completed" || a.status === "verified").length;
    const ns = assignedActs.filter(a => a.status === "not_started").length;

    if (kpiAgendaTotal) kpiAgendaTotal.textContent = total;
    if (kpiAgendaWip) kpiAgendaWip.textContent = wip;
    if (kpiAgendaFinished) kpiAgendaFinished.textContent = fin;
    if (kpiAgendaNotStarted) kpiAgendaNotStarted.textContent = ns;
  }

  function renderAgendaRow(act, isController) {
    const actId = act.activity_id;
    const status = act.status || "not_started";
    const sv = act.sv_days !== undefined ? act.sv_days : 0;
    const perm = getUserActivityPermission(act);

    let actionCell = `
      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
        <button type="button" class="btn btn-sm btn-outline-secondary btn-member-open-modal" data-act-id="${actId}" style="font-weight: 600; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; cursor: pointer;">
          📋 Details
        </button>
    `;
    if (isController) {
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
          ${!isController && perm.isLead ? `<span class="badge badge-amber" style="margin-left: 4px; font-size: 0.7rem;">👑 Team Lead</span>` : ''}
        </td>
        <td>${act.duration}d</td>
        <td>${getStatusBadge(status)}</td>
        <td style="color: ${sv >= 0 ? '#15803D' : '#DC2626'}; font-weight: 700;">${sv >= 0 ? '+' : ''}${sv.toFixed(1)}d</td>
        <td>${actionCell}</td>
      </tr>
    `;
  }

  function renderAgendaActivities(ctrlActivities, myAssignedActivities) {
    let containerHtml = "";

    // 1. Controller Review Queue (if user is Controller)
    if (ctrlActivities.length > 0) {
      const ctrlRows = ctrlActivities.map(act => renderAgendaRow(act, true)).join("");
      containerHtml += `
        <div style="background: #EFF6FF; border: 1.5px solid #93C5FD; border-radius: var(--radius-md); padding: 1.2rem; margin-bottom: 1.8rem; box-shadow: var(--shadow-sm);">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.4rem;">
            <span style="font-size: 1.4rem;">🛡️</span>
            <h3 style="margin: 0; font-size: 1.15rem; color: #1E3A8A; font-weight: 800;">
              Controller Review Queue &amp; Schedule Validation
            </h3>
            <span class="badge badge-blue" style="margin-left: auto;">${ctrlActivities.length} Assigned Controller Tasks</span>
          </div>
          <p style="margin: 0 0 1rem 0; font-size: 0.85rem; color: #1E40AF;">
            You are designated as Controller for these activities. When tasks are marked complete, review them to return to WIP with feedback or verify to advance successors on the nearest business day.
          </p>
          <div class="table-responsive" style="background: #FFFFFF; border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
            <table>
              <thead>
                <tr>
                  <th>Activity ID</th><th>Activity Name</th><th>Plan Duration</th><th>Current Status</th><th>Schedule Variance</th><th>Controller Action</th>
                </tr>
              </thead>
              <tbody>${ctrlRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    // 2. Member Assigned Activities Section
    let displayedActivities = myAssignedActivities;
    if (agendaFilter === "active") displayedActivities = myAssignedActivities.filter(a => a.status === "in_progress" || a.status === "completed");
    else if (agendaFilter === "wip") displayedActivities = myAssignedActivities.filter(a => a.status === "in_progress");
    else if (agendaFilter === "completed") displayedActivities = myAssignedActivities.filter(a => a.status === "completed");

    const memberRows = displayedActivities.map(act => renderAgendaRow(act, false)).join("");

    const activeCount = myAssignedActivities.filter(a => a.status === "in_progress" || a.status === "completed").length;
    const wipCount = myAssignedActivities.filter(a => a.status === "in_progress").length;
    const completedCount = myAssignedActivities.filter(a => a.status === "completed").length;

    containerHtml += `
      <div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.4rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="margin: 0; font-size: 1.2rem; color: var(--charcoal);">
              📋 My Assigned Activities (Working On &amp; Awaiting Review)
            </h3>
            <p style="margin: 0.2rem 0 0 0; font-size: 0.86rem; color: var(--muted);">
              Tasks in WIP status that you are currently performing, and completed activities awaiting Controller sign-off. Click <strong>📋 Details</strong> to view activity details and submit deliverables.
            </p>

          </div>
          <!-- Filter Buttons -->
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm ${agendaFilter === 'active' ? 'btn-primary' : 'btn-secondary'} btn-agenda-filter" data-filter="active">
              ⭐ WIP &amp; Completed (${activeCount})
            </button>
            <button type="button" class="btn btn-sm ${agendaFilter === 'wip' ? 'btn-primary' : 'btn-secondary'} btn-agenda-filter" data-filter="wip">
              🟡 WIP Only (${wipCount})
            </button>
            <button type="button" class="btn btn-sm ${agendaFilter === 'completed' ? 'btn-primary' : 'btn-secondary'} btn-agenda-filter" data-filter="completed">
              🟢 Completed (${completedCount})
            </button>
            <button type="button" class="btn btn-sm ${agendaFilter === 'all' ? 'btn-primary' : 'btn-secondary'} btn-agenda-filter" data-filter="all">
              All Assigned (${myAssignedActivities.length})
            </button>
          </div>
        </div>

        ${displayedActivities.length === 0 ? `
          <div style="text-align: center; padding: 2.5rem 1rem; color: var(--muted);">
            <div style="font-size: 2.2rem; margin-bottom: 0.4rem;">📂</div>
            <h4>No Activities in this Filter View</h4>
            <p style="font-size: 0.88rem; margin: 0;">Try switching the filter pills above to view all assigned project tasks.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Activity ID</th>
                  <th>Activity Name</th>
                  <th>Plan Duration</th>
                  <th>Status</th>
                  <th>Schedule Variance</th>
                  <th>Execution Permissions &amp; Review Action</th>
                </tr>
              </thead>
              <tbody>
                ${memberRows}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    agendaTasksContainer.innerHTML = containerHtml;

    // Attach click listeners for filter pills
    agendaTasksContainer.querySelectorAll(".btn-agenda-filter").forEach(btn => {
      btn.addEventListener("click", () => {
        agendaFilter = btn.getAttribute("data-filter");
        renderAgendaActivities(ctrlActivities, myAssignedActivities);
      });
    });

    // Attach click listeners for open modal (Task Details)
    agendaTasksContainer.querySelectorAll(".btn-member-open-modal").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const actId = btn.getAttribute("data-act-id");
        const act = myAssignedActivities.find(a => a.activity_id === actId) || ctrlActivities.find(a => a.activity_id === actId);
        if (act) openMemberActivityModal(act);
      });
    });

    // Attach Controller action listeners
    agendaTasksContainer.querySelectorAll(".btn-ctrl-return-wip").forEach(btn => {
      btn.addEventListener("click", () => {
        const actId = btn.getAttribute("data-act-id");
        const act = ctrlActivities.find(a => a.activity_id === actId);
        if (act) openControllerReviewModal(act, "in_progress");
      });
    });

    agendaTasksContainer.querySelectorAll(".btn-ctrl-confirm-verified").forEach(btn => {
      btn.addEventListener("click", () => {
        const actId = btn.getAttribute("data-act-id");
        const act = ctrlActivities.find(a => a.activity_id === actId);
        if (act) openControllerReviewModal(act, "verified");
      });
    });

    // Attach Member mark complete listener
    agendaTasksContainer.querySelectorAll(".btn-member-mark-complete").forEach(btn => {
      btn.addEventListener("click", () => {
        const actId = btn.getAttribute("data-act-id");
        const act = myAssignedActivities.find(a => a.activity_id === actId);
        if (act) openMemberCompletionModal(act);
      });
    });

    // Update Kanban board if visible
    renderAgendaKanbanBoard(myAssignedActivities, ctrlActivities);
  }

  function renderAgendaKanbanBoard(myAssignedActivities, ctrlActivities) {
    const kanbanContainer = document.getElementById("agenda-kanban-container");
    if (!kanbanContainer) return;

    // Merge activities to present full active perspective
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
                ${perm.isController ? `<span class="badge badge-blue" style="font-size: 0.65rem; padding: 1px 4px;">🛡️ Controller</span>` : ''}
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

  // Hook Agenda View Toggle Buttons (Table vs Kanban)
  const btnAgendaViewTable = document.getElementById("btn-agenda-view-table");
  const btnAgendaViewKanban = document.getElementById("btn-agenda-view-kanban");
  const agendaTasksContainerEl = document.getElementById("agenda-tasks-container");
  const agendaKanbanContainerEl = document.getElementById("agenda-kanban-container");

  if (btnAgendaViewTable && btnAgendaViewKanban) {
    btnAgendaViewTable.addEventListener("click", () => {
      agendaViewMode = "table";
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
      agendaViewMode = "kanban";
      btnAgendaViewKanban.classList.remove("btn-secondary");
      btnAgendaViewKanban.classList.add("btn-primary");
      btnAgendaViewKanban.style.fontWeight = "700";
      btnAgendaViewTable.classList.remove("btn-primary");
      btnAgendaViewTable.classList.add("btn-secondary");
      btnAgendaViewTable.style.fontWeight = "600";
      if (agendaTasksContainerEl) agendaTasksContainerEl.style.display = "none";
      if (agendaKanbanContainerEl) agendaKanbanContainerEl.style.display = "block";
      if (currentControlModel) {
        const activities = currentControlModel.activities || [];
        const userIsCtrl = isUserController();
        const ctrlActs = userIsCtrl ? activities.filter(a => isUserController(a)) : [];
        const myActs = activities.filter(a => isActAssignedToUser(a));
        renderAgendaKanbanBoard(myActs, ctrlActs);
      }
    });
  }

  btnRefreshAgenda.addEventListener("click", () => loadAgendaTasks());


  // ── Modal Activity Execution Handler ───────────────────────────────────────
  function openMemberActivityModal(act) {
    selectedModalAct = act;
    modalActId.textContent = act.activity_id;
    modalActNameDisplay.textContent = act.name || "Activity Execution";

    modalActInfoDisplay.innerHTML = `
      <strong>Activity:</strong> ${act.name} (${act.activity_id})<br>
      <strong>Duration:</strong> ${act.duration} days | <strong>Planned ES/EF:</strong> Day ${act.es || 0} → Day ${act.ef || act.duration}<br>
      <strong>Schedule Variance:</strong> ${act.sv_days !== undefined ? (act.sv_days >= 0 ? '+' : '') + act.sv_days.toFixed(1) + 'd' : '0.0d'}
    `;

    modalActStatus.value = act.status || "not_started";
    modalActProgressRange.value = act.progress_pct || 0;
    modalActProgressNum.textContent = `${act.progress_pct || 0}%`;
    modalActStartDate.value = act.actual_start_date || "";
    modalActFinishDate.value = act.actual_finish_date || "";

    if (isController && modalControllerSignoffBox) {
      modalControllerSignoffBox.style.display = "block";
      modalSignoffUser.textContent = `Sign-off as Controller: ${fn} ${ln}`;
      modalSignoffCheck.checked = act.status === "verified";
    } else if (modalControllerSignoffBox) {
      modalControllerSignoffBox.style.display = "none";
    }

    memberActivityModal.style.display = "flex";
  }

  function closeMemberActivityModal() {
    memberActivityModal.style.display = "none";
    selectedModalAct = null;
  }

  btnCloseModal.addEventListener("click", closeMemberActivityModal);
  btnCancelModal.addEventListener("click", closeMemberActivityModal);

  modalActProgressRange.addEventListener("input", () => {
    modalActProgressNum.textContent = `${modalActProgressRange.value}%`;
    const val = parseInt(modalActProgressRange.value, 10);
    if (val === 0) modalActStatus.value = "not_started";
    else if (val === 100) {
      if (isController && modalSignoffCheck && modalSignoffCheck.checked) {
        modalActStatus.value = "verified";
      } else {
        modalActStatus.value = "completed";
      }
    } else {
      modalActStatus.value = "in_progress";
    }
  });

  modalActStatus.addEventListener("change", () => {
    const val = modalActStatus.value;
    if (val === "not_started") modalActProgressRange.value = 0;
    else if (val === "completed" || val === "verified") modalActProgressRange.value = 100;
    else if (val === "in_progress" && parseInt(modalActProgressRange.value, 10) === 0) modalActProgressRange.value = 50;
    modalActProgressNum.textContent = `${modalActProgressRange.value}%`;
  });

  memberActivityForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedModalAct || !activeProjectId) return;

    const payload = {
      status: modalActStatus.value,
      progress_pct: parseFloat(modalActProgressRange.value),
      actual_start_date: modalActStartDate.value || null,
      actual_finish_date: modalActFinishDate.value || null
    };

    if (isController && modalSignoffCheck && modalSignoffCheck.checked && payload.status === "verified") {
      payload.verified_by = `${fn} ${ln} (Controller)`;
      payload.verified_date = new Date().toISOString().split("T")[0];
    }

    const { error } = await updateActivityStatus(activeProjectId, selectedModalAct.activity_id, payload);
    if (error) {
      alert(`Failed to save activity execution state: ${error}`);
      return;
    }

    closeMemberActivityModal();
    await loadAgendaTasks();
  });

  // ============================================================================
  // VIEW 4: NOTIFICATIONS AUDIT LOG
  // ============================================================================
  async function loadNotificationsLog() {
    fullNotificationsContainer.innerHTML = `<p style="color: var(--muted); text-align: center; padding: 2rem 0;">Loading notifications...</p>`;
    const { data: notifications, error } = await fetchNotifications(userId);

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
        await markNotificationRead(nid, userId);
        await loadNotificationsLog();
        refreshSidebarBadge();
        if (bellCtrl) bellCtrl.refresh();
      });
    });

    fullNotificationsContainer.querySelectorAll(".btn-delete-notif-view").forEach(btn => {
      btn.addEventListener("click", async () => {
        const nid = btn.getAttribute("data-notif-id");
        if (!confirm("Are you sure you want to remove this notification? It will no longer appear in your feed.")) return;
        const { error } = await deleteNotification(nid, userId);
        if (error) {
          alert(`Failed to delete notification: ${error}`);
          return;
        }
        await loadNotificationsLog();
        refreshSidebarBadge();
        if (bellCtrl) bellCtrl.refresh();
      });
    });
  }

  btnTabMarkAllRead.addEventListener("click", async () => {
    btnTabMarkAllRead.disabled = true;
    btnTabMarkAllRead.textContent = "Marking...";
    await markAllNotificationsRead(userId);
    await loadNotificationsLog();
    refreshSidebarBadge();
    if (bellCtrl) bellCtrl.refresh();
    btnTabMarkAllRead.disabled = false;
    btnTabMarkAllRead.textContent = "✓ Mark All as Read";
  });

  // ============================================================================
  // VIEW 5: USER PROFILE
  // ============================================================================
  function renderProfileForm() {
    renderProfileSidebar(profileFormContainer, user, (updated) => {
      setLoggedUser(updated);
      window.location.reload();
    });
  }

  // Initial Startup: Load participating projects
  await loadParticipatingProjects();
  switchMainView("projects");
});
