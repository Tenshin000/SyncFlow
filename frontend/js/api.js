/**
 * SyncFlow Frontend - Centralized API Connector
 * Handles all REST communication with the FastAPI backend (/syncflow).
 */

const API_BASE_URL = (function() {
  const host = window.location.hostname || "localhost";
  const protocol = window.location.protocol || "http:";
  return `${protocol}//${host}:8000`;
})();

/**
 * In-memory client cache & in-flight promise registry for ultra-fast information flow.
 */
const _inFlightRequests = new Map();
const _getCache = new Map();
const CACHE_TTL_MS = 2500; // 2.5 second micro-cache for idempotent GET calls


/**
 * Universal JSON fetch helper with in-flight deduplication and intelligent micro-caching.
 */
async function apiRequest(endpoint, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = `${API_BASE_URL}${endpoint}`;
  const cacheKey = `${method}:${endpoint}`;

  // Serve from micro-cache for GET requests if fresh
  if (method === "GET") {
    const cached = _getCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return { data: cached.data, error: cached.error };
    }

    // Deduplicate in-flight GET requests
    if (_inFlightRequests.has(cacheKey)) {
      return await _inFlightRequests.get(cacheKey);
    }
  }

  const defaultHeaders = {
    "Content-Type": "application/json",
    "Accept": "application/json"
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    }
  };

  const executeRequest = async () => {
    try {
      const response = await fetch(url, config);
      let data = null;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        let errorMessage = "An unexpected error occurred.";
        if (data && typeof data === "object") {
          if (typeof data.detail === "string") {
            errorMessage = data.detail;
          } else if (Array.isArray(data.detail)) {
            errorMessage = data.detail.map(d => d.msg || JSON.stringify(d)).join(", ");
          } else if (data.message) {
            errorMessage = data.message;
          }
        } else if (typeof data === "string" && data.trim()) {
          errorMessage = data;
        }
        throw new Error(errorMessage);
      }

      const result = { data, error: null };

      // Cache successful GET requests
      if (method === "GET") {
        _getCache.set(cacheKey, { data: result.data, error: null, timestamp: Date.now() });
      } else {
        // Any mutation (POST, PUT, DELETE, PATCH) invalidates the micro-cache to prevent stale reads
        _getCache.clear();
      }

      return result;
    } catch (err) {
      return { data: null, error: err.message || "Network error. Please ensure the backend is running." };
    } finally {
      if (method === "GET") {
        _inFlightRequests.delete(cacheKey);
      }
    }
  };

  if (method === "GET") {
    const promise = executeRequest();
    _inFlightRequests.set(cacheKey, promise);
    return await promise;
  }

  return await executeRequest();
}

// Authentication & Users API 
/**
 * Authenticates user credentials using identifier/username and password.
 */
export async function loginUser(identifier, password) {
  return await apiRequest("/syncflow/user/login", {
    method: "POST",
    body: JSON.stringify({ identifier, username: identifier, password })
  });
}

/**
 * Registers a new user account with profile information and role.
 */
export async function signupUser(payload) {
  return await apiRequest("/syncflow/user/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Retrieves profile information for the specified user ID.
 */
export async function fetchUserProfile(userId) {
  return await apiRequest(`/syncflow/user/${userId}/profile`, {
    method: "GET"
  });
}

/**
 * Updates profile details for the specified user ID.
 */
export async function updateUserProfile(userId, payload) {
  return await apiRequest(`/syncflow/user/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/**
 * Retrieves all registered users for personnel allocation and team setup.
 */
export async function fetchAllUsers() {
  return await apiRequest("/syncflow/user", {
    method: "GET"
  });
}


// Projects & Teams API
/**
 * Retrieves project summaries, optionally filtered by PM ID or participating member ID.
 */
export async function fetchProjects(pmId = null, memberId = null) {
  const params = new URLSearchParams();
  if (pmId) params.append("pm_id", pmId);
  if (memberId) params.append("member_id", memberId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return await apiRequest(`/syncflow/projects${qs}`, {
    method: "GET"
  });
}

/**
 * Fetches complete project document including WBS, activities, teams, and dependencies.
 */
export async function fetchProjectDetail(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}`, {
    method: "GET"
  });
}

/**
 * Creates a new project document in the database.
 */
export async function createProject(payload) {
  return await apiRequest("/syncflow/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Updates the project scope / description statement.
 */
export async function updateProjectDescription(projectId, description) {
  return await apiRequest(`/syncflow/projects/${projectId}/description`, {
    method: "PUT",
    body: JSON.stringify({ description })
  });
}

/**
 * Retrieves the PM's reusable team library from historical projects.
 */
export async function fetchReusableTeams(pmId) {
  const query = pmId ? `?pm_id=${encodeURIComponent(pmId)}` : "";
  return await apiRequest(`/syncflow/teams${query}`, {
    method: "GET"
  });
}

/**
 * Deletes a project from the system by project ID.
 */
export async function deleteProject(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}`, {
    method: "DELETE"
  });
}

/**
 * Updates project assigned teams, individual contributors, and controllers.
 */
export async function updateProjectPersonnel(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${projectId}/personnel`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/**
 * Updates WBS activities list, duration estimates, and assignments.
 */
export async function updateProjectActivities(projectId, activities) {
  return await apiRequest(`/syncflow/projects/${projectId}/activities`, {
    method: "PUT",
    body: JSON.stringify({ activities })
  });
}

/**
 * Updates project deliverables list (compatibility route for WBS).
 */
export async function updateProjectDeliverables(projectId, deliverables) {
  return await apiRequest(`/syncflow/projects/${projectId}/deliverables`, {
    method: "PUT",
    body: JSON.stringify({ deliverables })
  });
}

/**
 * Updates canonical recursive Work Breakdown Structure tree hierarchy.
 */
export async function updateProjectWbs(projectId, wbs) {
  return await apiRequest(`/syncflow/projects/${projectId}/wbs`, {
    method: "PUT",
    body: JSON.stringify({ wbs })
  });
}

/**
 * Updates precedence relationships with circular logic prevention.
 */
export async function updateProjectDependencies(projectId, dependencies) {
  return await apiRequest(`/syncflow/projects/${projectId}/dependencies`, {
    method: "PUT",
    body: JSON.stringify({ dependencies })
  });
}

/**
 * Evaluates schedule health diagnostics including dangling tasks and cycles.
 */
export async function fetchScheduleHealth(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}/schedule-health`, {
    method: "GET"
  });
}

/**
 * Calculates PERT critical path expected duration, variance, and completion probability.
 */
export async function fetchPertAnalysis(projectId, targetDays = null) {
  const query = targetDays !== null ? `?target_days=${encodeURIComponent(targetDays)}` : "";
  return await apiRequest(`/syncflow/projects/${projectId}/pert-analysis${query}`, {
    method: "GET"
  });
}

/**
 * Retrieves historical controller-approved activities for analogous estimation benchmarks.
 */
export async function fetchCompletedActivities() {
  return await apiRequest(`/syncflow/projects/completed-activities`, {
    method: "GET"
  });
}

/**
 * Calculates comprehensive CPM schedule, floats, S-curve bounds, and network diagrams.
 */
export async function fetchProjectSchedule(projectId, params = {}) {
  const q = new URLSearchParams();
  if (params.imposed_deadline_days) q.append("imposed_deadline_days", params.imposed_deadline_days);
  if (params.imposed_deadline_date) q.append("imposed_deadline_date", params.imposed_deadline_date);
  if (params.near_critical_threshold) q.append("near_critical_threshold", params.near_critical_threshold);
  const qs = q.toString() ? `?${q.toString()}` : "";
  return await apiRequest(`/syncflow/projects/${projectId}/schedule${qs}`, {
    method: "GET"
  });
}

/**
 * Updates baseline schedule settings such as imposed deadline and float thresholds.
 */
export async function updateProjectScheduleSettings(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${projectId}/schedule-settings`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Calculates Control Schedule (PMBOK 6.6) statuses, EV metrics, and S-Curve progression.
 */
export async function fetchControlSchedule(projectId, statusDate = null) {
  const q = statusDate ? `?status_date=${encodeURIComponent(statusDate)}` : "";
  return await apiRequest(`/syncflow/projects/${projectId}/control-schedule${q}`, {
    method: "GET"
  });
}

/**
 * Updates activity operational status (WIP, Completed, Verified) and actual dates.
 */
export async function updateActivityStatus(projectId, activityId, payload) {
  return await apiRequest(`/syncflow/projects/${projectId}/activities/${activityId}/status`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/**
 * Initializes realistic sample progress across activities for demonstration.
 */
export async function seedProjectProgress(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}/activities/seed-progress`, {
    method: "POST"
  });
}

// Notifications API 
/**
 * Fetches project and system notifications for the specified user.
 */
export async function fetchNotifications(userId, projectId = null) {
  const q = new URLSearchParams({ user_id: userId });
  if (projectId) q.append("project_id", projectId);
  return await apiRequest(`/syncflow/notifications?${q.toString()}`, {
    method: "GET"
  });
}

/**
 * Retrieves count of unread notifications for badge rendering.
 */
export async function fetchUnreadNotificationsCount(userId, projectId = null) {
  const q = new URLSearchParams({ user_id: userId });
  if (projectId) q.append("project_id", projectId);
  return await apiRequest(`/syncflow/notifications/unread-count?${q.toString()}`, {
    method: "GET"
  });
}


/**
 * Marks a specific notification as read by the user.
 */
export async function markNotificationRead(notificationId, userId) {
  return await apiRequest(`/syncflow/notifications/${encodeURIComponent(notificationId)}/read?user_id=${encodeURIComponent(userId)}`, {
    method: "PUT"
  });
}

/**
 * Marks all notifications in a project as read for the user.
 */
export async function markAllNotificationsRead(userId, projectId = null) {
  return await apiRequest("/syncflow/notifications/mark-all-read", {
    method: "PUT",
    body: JSON.stringify({ user_id: userId, project_id: projectId })
  });
}

/**
 * Handles interactive actions on notifications (e.g. accepting a join request).
 */
export async function actOnNotification(notificationId, userId, action) {
  return await apiRequest(`/syncflow/notifications/${encodeURIComponent(notificationId)}/action`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, action })
  });
}

/**
 * Deletes or dismisses a notification for the current user.
 */
export async function deleteNotification(notificationId, userId) {
  return await apiRequest(`/syncflow/notifications/${encodeURIComponent(notificationId)}?user_id=${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

// Project Search & Participation
/**
 * Searches all projects and computes current user's membership status.
 */
export async function searchAvailableProjects(userId, query = "") {
  const q = new URLSearchParams({ user_id: userId });
  if (query) q.append("query", query);
  return await apiRequest(`/syncflow/projects/available/search?${q.toString()}`, {
    method: "GET"
  });
}

/**
 * Submits a join request or directly joins an open participation project.
 */
export async function joinProject(projectId, userId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/join`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId })
  });
}


// Multi-Baseline Comparison 
/**
 * Freezes the current CPM schedule into a single canonical Planned Baseline snapshot.
 */
export async function createBaseline(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/baselines`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Retrieves the planned baseline snapshot for schedule comparison.
 */
export async function fetchBaselines(projectId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/baselines`, {
    method: "GET"
  });
}

/**
 * Clears the saved Planned Baseline snapshot.
 */
export async function deleteBaseline(projectId, baselineId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/baselines/${encodeURIComponent(baselineId)}`, {
    method: "DELETE"
  });
}

// DCMA 14-Point Quality Diagnostic
/**
 * Executes the DCMA 14-Point automated schedule quality assessment.
 */
export async function fetchDcmaQuality(projectId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/schedule/dcma-quality`, {
    method: "GET"
  });
}



// Executive Portfolio Dashboard
/**
 * Retrieves cross-project executive portfolio metrics and health indicators.
 */
export async function fetchPortfolioDashboard(userId) {
  return await apiRequest(`/syncflow/portfolio/dashboard?user_id=${encodeURIComponent(userId)}`, {
    method: "GET"
  });
}

// Google Gemini Flash AI NLP Engine
/**
 * Calls Gemini AI engine to generate hierarchical WBS nodes from text description.
 */
export async function aiGenerateWbs(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/nlp/text-to-wbs`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Calls Gemini AI engine to calculate Three-Point duration estimates for activities.
 */
export async function aiEstimateDurations(projectId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/nlp/estimate-durations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Calls Gemini AI engine to identify topological precedence dependencies from text.
 */
export async function aiExtractDependencies(projectId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/nlp/extract-dependencies`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Validates Google Gemini API key by performing a test ping.
 */
export async function aiVerifyKey(apiKey) {
  return await apiRequest("/syncflow/nlp/verify-key", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey })
  });
}

// Time Tracking & Stopwatch API (Trello-Style)
/**
 * Starts a live work timer linked strictly to an in-progress (WIP) activity assigned to user.
 */
export async function startActivityTimer(projectId, activityId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/timer/start`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Stops an active stopwatch timer and logs elapsed seconds to the activity.
 */
export async function stopActivityTimer(projectId, activityId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/timer/stop`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Retrieves all time logs and contributor history for a specific activity.
 */
export async function fetchActivityTimeLogs(projectId, activityId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/time-logs`, {
    method: "GET"
  });
}

/**
 * Retrieves executive rollup of logged time across all activities for PM Control audit.
 */
export async function fetchProjectTimeLogsSummary(projectId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/time-logs/summary`, {
    method: "GET"
  });
}

/**
 * Updates session notes or reassigns an existing timer log to another WIP activity.
 */
export async function updateActivityTimeLog(projectId, activityId, logId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/time-logs/${encodeURIComponent(logId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/**
 * Deletes a user-generated timer log and deducts logged seconds from the activity.
 */
export async function deleteActivityTimeLog(projectId, activityId, logId, userId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/time-logs/${encodeURIComponent(logId)}?user_id=${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

/**
 * Retrieves all time tracking sessions created by a specific user for the Trackers screen.
 */
export async function fetchUserTimeLogs(projectId, userId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/my-time-logs?user_id=${encodeURIComponent(userId)}`, {
    method: "GET"
  });
}

