/**
 * SyncFlow Frontend - Project Manager Workspace Root Controller (pm_workspace.js)
 * PMBOK 6 Process Views Orchestrator.
 * Handles authentication, project loading, top navigation router,
 * and initializes sub-modules for Plan, WBS, Sequence, Estimate, Schedule, and Control.
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import { fetchProjectDetail, fetchAllUsers } from "./api.js";
import { requireAuth, logout } from "./auth.js";
import { initNotificationBell } from "./notifications.js";
import { pmState, updateProjectPersonnelStats } from "./pm_workspace_state.js";

// View Sub-Module Initializers & Renderers
import { initPlanScheduleManagement as initPlanView, renderPlanView } from "./pm_view1_plan.js";
import { initWbsController as initWbsView, renderWbsView } from "./pm_view2_wbs.js";
import { initActivitiesController as initActivitiesView, renderDefineActivitiesTab, setSelectedActivityWpId } from "./pm_view2_activities.js";
import { initSequenceController as initSequenceView, renderSequenceView } from "./pm_view3_sequence.js";
import { initEstimateView, renderEstimateView } from "./pm_view4_estimate.js";
import { initScheduleView, renderScheduleView } from "./pm_view5_schedule.js";
import { initControlView, renderControlScheduleView } from "./pm_view6_control.js";

// ==========================================
// DOMContentLoaded ROOT ORCHESTRATOR
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  const user = requireAuth();
  if (!user) return;

  // Resolve project ID from sessionStorage or URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = sessionStorage.getItem("active_project_id") || urlParams.get("project_id");
  if (!projectId) {
    window.location.href = "/project_manager/dashboard.html";
    return;
  }
  sessionStorage.setItem("active_project_id", projectId);

  // Initialize shared workspace state
  pmState.user = user;
  pmState.projectId = projectId;

  // Mount project notification bell scoped to this project
  initNotificationBell("#pm-workspace-notification-bell-container", user, projectId);

  // UI Elements
  const sidebarProjName = document.getElementById("sidebar-proj-name");
  const navContainer = document.getElementById("workspace-nav");
  const headerSubtitle = document.getElementById("workspace-header-subtitle");
  const userBadge = document.getElementById("workspace-user-badge");
  const btnReturnDashboard = document.getElementById("btn-return-dashboard");
  const btnLogout = document.getElementById("btn-workspace-logout");

  // View Sections
  const view1Plan = document.getElementById("view-1-plan");
  const view2Wbs = document.getElementById("view-2-wbs");
  const view3Sequence = document.getElementById("view-3-sequence");
  const view4Estimate = document.getElementById("view-4-estimate");
  const view5Schedule = document.getElementById("view-5-schedule");
  const view6Control = document.getElementById("view-6-control");
  const viewPlaceholder = document.getElementById("view-placeholder");
  const placeholderTitle = document.getElementById("placeholder-title");

  // Wire Return Dashboard and Logout immediately so navigation is always responsive
  if (btnReturnDashboard) {
    btnReturnDashboard.addEventListener("click", () => {
      sessionStorage.removeItem("active_project_id");
      window.location.href = "/project_manager/dashboard.html";
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      logout();
    });
  }

  // Protect against accidental loss of unsaved changes on reload/navigate
  window.addEventListener("beforeunload", (e) => {
    if (pmState && (pmState.hasUnsavedWbsChanges || pmState.hasUnsavedDependencies)) {
      e.preventDefault();
      e.returnValue = "You have unsaved changes in your project. Are you sure you want to leave?";
      return e.returnValue;
    }
  });

  // Set user badge
  if (userBadge) {
    userBadge.innerHTML = `
      <div style="background: var(--primary-light); border: 1px solid var(--primary-border); padding: 5px 14px; border-radius: 20px; font-weight: 700; color: var(--primary); font-size: 0.85rem;">
        👤 ${user.first_name || 'User'} (${user.role || 'Member'})
      </div>
    `;
  }

  // Fetch project and users cache
  const [projectResult, usersResult] = await Promise.all([
    fetchProjectDetail(projectId),
    fetchAllUsers()
  ]);

  if (projectResult.error || !projectResult.data) {
    alert(`Failed to load project workspace: ${projectResult.error || "Project not found."}`);
    window.location.href = "/project_manager/dashboard.html";
    return;
  }

  pmState.project = projectResult.data;
  pmState.allUsers = usersResult.data || [];
  pmState.userMap.clear();
  pmState.allUsers.forEach(u => pmState.userMap.set(String(u.id || u._id), u));

  // Populate active project information in header & sidebar
  const projectName = pmState.project.name || "Untitled Project";
  if (sidebarProjName) sidebarProjName.textContent = projectName;
  updateProjectPersonnelStats();

  // ==========================================
  // VIEW NAVIGATION & ROUTING
  // ==========================================
  const processTitles = {
    1: "Plan Schedule Management — Policies & Personnel Allocation",
    2: "Define Activities & WBS — Decomposition & Deliverables",
    3: "Sequence Activities — Precedence Diagramming Method (PDM)",
    4: "Estimate Activity Durations — PERT Beta & Parametric Modeling",
    5: "Develop Schedule — Critical Path Method (CPM), Float & Baseline",
    6: "Control Schedule — Operational Monitoring & Variance Analysis"
  };

  const navItems = navContainer ? navContainer.querySelectorAll(".sidebar-nav-item") : [];

  /**
   * Switches active workspace section (1: Plan, 2: Scope/WBS, 3: Sequence, 4: Estimate, 5: Schedule, 6: Control).
   */
  function switchView(viewIndex) {
    try {
      sessionStorage.setItem("syncflow_active_view", String(viewIndex));
    } catch (err) {}

    navItems.forEach(item => item.classList.remove("active"));
    const activeItem = navContainer ? navContainer.querySelector(`[data-view="${viewIndex}"]`) : null;
    if (activeItem) activeItem.classList.add("active");

    if (headerSubtitle) {
      headerSubtitle.textContent = processTitles[viewIndex] || "Schedule Management";
    }

    // Hide all view panes
    if (view1Plan) view1Plan.style.display = "none";
    if (view2Wbs) view2Wbs.style.display = "none";
    if (view3Sequence) view3Sequence.style.display = "none";
    if (view4Estimate) view4Estimate.style.display = "none";
    if (view5Schedule) view5Schedule.style.display = "none";
    if (view6Control) view6Control.style.display = "none";
    if (viewPlaceholder) viewPlaceholder.style.display = "none";

    try {
      if (viewIndex === 1) {
        if (view1Plan) view1Plan.style.display = "block";
        renderPlanView();
      } else if (viewIndex === 2) {
        if (view2Wbs) view2Wbs.style.display = "block";
        renderWbsView();
      } else if (viewIndex === 3) {
        if (view3Sequence) view3Sequence.style.display = "block";
        renderSequenceView();
      } else if (viewIndex === 4) {
        if (view4Estimate) view4Estimate.style.display = "block";
        renderEstimateView();
      } else if (viewIndex === 5) {
        if (view5Schedule) view5Schedule.style.display = "block";
        renderScheduleView();
      } else if (viewIndex === 6) {
        if (view6Control) view6Control.style.display = "block";
        renderControlScheduleView();
      } else {
        if (viewPlaceholder) viewPlaceholder.style.display = "block";
        if (placeholderTitle) placeholderTitle.textContent = activeItem ? activeItem.textContent : "";
      }
    } catch (viewErr) {
      console.error(`[SyncFlow] Failed to render view ${viewIndex}:`, viewErr);
    }
  }

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const idx = parseInt(item.getAttribute("data-view"), 10);
      switchView(idx);
    });
  });

  // ==========================================
  // INITIALIZE SUB-MODULES
  // ==========================================
  const isPM = Boolean(user.is_admin) || (user.role && user.role.trim() === "Project Manager") || (String(user.id || user._id) === String(pmState.project.created_by || ""));
  try {
    initPlanView(user, isPM);
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 1 (Plan):", err);
  }

  try {
    initWbsView({
      renderDefineActivitiesTab,
      onSelectWorkPackage: (wpId) => setSelectedActivityWpId(wpId)
    });
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 2 (WBS):", err);
  }

  try {
    initActivitiesView();
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 2 (Activities):", err);
  }

  try {
    initSequenceView();
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 3 (Sequence):", err);
  }

  try {
    initEstimateView();
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 4 (Estimate):", err);
  }

  try {
    initScheduleView();
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 5 (Schedule):", err);
  }

  try {
    initControlView();
  } catch (err) {
    console.error("[SyncFlow] Failed to initialize View 6 (Control):", err);
  }

  // Restore remembered view or open initial view
  const initialView = parseInt(sessionStorage.getItem("syncflow_active_view") || urlParams.get("view") || "1", 10);
  switchView(initialView);
});
