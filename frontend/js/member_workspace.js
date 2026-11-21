/**
 * SyncFlow Frontend - Member Workspace Controller (member_workspace.js)
 * Master orchestrator initializing and coordinating:
 *  - Authentication & Role Governance
 *  - Sidebar navigation and view switching
 *  - Shared state and user resolution (member_workspace_state.js)
 *  - Projects Portfolio & Search Discovery (member_projects.js)
 *  - Operational Agenda & Execution Kanban (member_agenda.js)
 *  - Trello-Style Live Stopwatch & Time Tracker (member_stopwatch.js)
 *  - Execution, Completion & Controller Review Modals (member_modals.js)
 */

import { fetchUserProfile, fetchUnreadNotificationsCount } from "./api.js";
import { getLoggedUser, logout, setLoggedUser } from "./auth.js";
import { initNotificationBell } from "./notifications.js";
import { getInitials } from "./utility.js";
import { memberState } from "./member_workspace_state.js";
import { initMemberProjects, loadParticipatingProjects, loadSearchProjects, renderInpageProjectPills, loadNotificationsLog, renderProfileForm } from "./member_projects.js";
import { initMemberStopwatch, updateStopwatchWipOptions, restoreOrSyncActiveTimer, selectAndStartTaskTimer, openEditTimerModal, handleDeleteTimer } from "./member_stopwatch.js";
import { initMemberAgenda, loadAssignedTasksPage, loadAgendaTasks } from "./member_agenda.js";
import { initMemberModals } from "./member_modals.js";

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

  // Populate shared memberState
  memberState.rawUser = rawUser;
  memberState.user = user;
  memberState.userId = userId;
  memberState.userRole = userRole;
  memberState.isController = isController;

  // DOM Elements - Sidebar & Top Header
  const sidebarAvatar = document.getElementById("member-sidebar-avatar");
  const sidebarName = document.getElementById("member-sidebar-name");
  const sidebarUsername = document.getElementById("member-sidebar-username");
  const sidebarNotifBadge = document.getElementById("sidebar-notif-badge");
  const userBadge = document.getElementById("workspace-user-badge");
  const headerSubtitle = document.getElementById("workspace-header-subtitle");
  const btnLogout = document.getElementById("btn-workspace-logout");
  const projectsWelcomeTitle = document.getElementById("projects-welcome-title");

  const navItems = document.querySelectorAll("#workspace-nav .sidebar-nav-item");
  const views = {
    "projects": document.getElementById("view-projects"),
    "search-projects": document.getElementById("view-search-projects"),
    "assigned-tasks": document.getElementById("view-assigned-tasks"),
    "notifications": document.getElementById("view-notifications"),
    "profile": document.getElementById("view-profile")
  };

  // Render User Information
  const fn = user.first_name || "Team Member";
  const ln = user.last_name || "";
  const un = user.username || "user";
  const initials = getInitials(fn, ln, "M");

  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = `${fn} ${ln}`.trim();
  if (sidebarUsername) sidebarUsername.textContent = `@${un}`;
  if (projectsWelcomeTitle) projectsWelcomeTitle.textContent = `📁 Projects Portfolio — ${fn} ${ln}`;

  if (userBadge) {
    userBadge.innerHTML = `
      <div style="background: var(--primary-light); border: 1px solid var(--primary-border); padding: 5px 14px; border-radius: 20px; font-weight: 700; color: var(--primary); font-size: 0.85rem;">
        👤 ${fn} ${ln} (${userRole || "Member"})
      </div>
    `;
  }

  // Sidebar Tab Navigation Subtitles
  const viewSubtitles = {
    "projects": "My Participating Projects Portfolio & Direct Selection",
    "search-projects": "Discover Projects, Join Open Workspaces & Request Access",
    "assigned-tasks": "Personal Operational Agenda & Activity Execution",
    "notifications": "Project-Level Logs & Activity Notifications",
    "profile": "Member Account & Governance Settings"
  };

  /**
   * Switches the active main view (Agenda, Projects, Explore, Notifications, Profile).
   */
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

  if (btnLogout) {
    btnLogout.addEventListener("click", () => logout());
  }

  // Sidebar Notification Badge Refresh
  async function refreshSidebarBadge() {
    if (!sidebarNotifBadge) return;
    const { data: count } = await fetchUnreadNotificationsCount(userId);
    if (count && count > 0) {
      sidebarNotifBadge.textContent = count > 99 ? "99+" : String(count);
      sidebarNotifBadge.style.display = "inline-block";
    } else {
      sidebarNotifBadge.style.display = "none";
    }
  }

  // Initialize Notification Bell in Top Nav
  memberState.bellCtrl = initNotificationBell("member-workspace-notification-bell-container", userId);
  refreshSidebarBadge();

  // Initialize Sub-Modules
  initMemberModals({
    loadAgendaTasks,
    refreshSidebarBadge
  });

  initMemberStopwatch({
    loadAgendaTasks
  });

  initMemberAgenda({
    switchMainView,
    refreshSidebarBadge,
    renderInpageProjectPills,
    loadParticipatingProjects,
    updateStopwatchWipOptions,
    restoreOrSyncActiveTimer,
    selectAndStartTaskTimer,
    openEditTimerModal,
    handleDeleteTimer
  });

  initMemberProjects({
    switchMainView,
    refreshSidebarBadge,
    loadAssignedTasksPage
  });

  // Initial Startup: Load participating projects and activate default view
  await loadParticipatingProjects();
  switchMainView("projects");
});
