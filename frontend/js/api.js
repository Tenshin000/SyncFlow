/**
 * SyncFlow Frontend – Centralized API Connector
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

// ── Authentication & Users API ────────────────────────────────────────────────
export async function loginUser(identifier, password) {
  return await apiRequest("/syncflow/user/login", {
    method: "POST",
    body: JSON.stringify({ identifier, username: identifier, password })
  });
}

export async function signupUser(payload) {
  return await apiRequest("/syncflow/user/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchUserProfile(userId) {
  return await apiRequest(`/syncflow/user/${userId}/profile`, {
    method: "GET"
  });
}

export async function updateUserProfile(userId, payload) {
  return await apiRequest(`/syncflow/user/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function fetchAllUsers() {
  return await apiRequest("/syncflow/user", {
    method: "GET"
  });
}


// ── Projects & Teams API ─────────────────────────────────────────────────────
export async function fetchProjects(pmId = null, memberId = null) {
  const params = new URLSearchParams();
  if (pmId) params.append("pm_id", pmId);
  if (memberId) params.append("member_id", memberId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return await apiRequest(`/syncflow/projects${qs}`, {
    method: "GET"
  });
}

export async function fetchProjectDetail(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}`, {
    method: "GET"
  });
}

export async function createProject(payload) {
  return await apiRequest("/syncflow/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateProjectDescription(projectId, description) {
  return await apiRequest(`/syncflow/projects/${projectId}/description`, {
    method: "PUT",
    body: JSON.stringify({ description })
  });
}

export async function fetchReusableTeams(pmId) {
  const query = pmId ? `?pm_id=${encodeURIComponent(pmId)}` : "";
  return await apiRequest(`/syncflow/teams${query}`, {
    method: "GET"
  });
}

export async function deleteProject(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}`, {
    method: "DELETE"
  });
}

export async function updateProjectPersonnel(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${projectId}/personnel`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function updateProjectActivities(projectId, activities) {
  return await apiRequest(`/syncflow/projects/${projectId}/activities`, {
    method: "PUT",
    body: JSON.stringify({ activities })
  });
}

export async function updateProjectDeliverables(projectId, deliverables) {
  return await apiRequest(`/syncflow/projects/${projectId}/deliverables`, {
    method: "PUT",
    body: JSON.stringify({ deliverables })
  });
}

export async function updateProjectWbs(projectId, wbs) {
  return await apiRequest(`/syncflow/projects/${projectId}/wbs`, {
    method: "PUT",
    body: JSON.stringify({ wbs })
  });
}

export async function updateProjectDependencies(projectId, dependencies) {
  return await apiRequest(`/syncflow/projects/${projectId}/dependencies`, {
    method: "PUT",
    body: JSON.stringify({ dependencies })
  });
}

export async function fetchScheduleHealth(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}/schedule-health`, {
    method: "GET"
  });
}

export async function fetchPertAnalysis(projectId, targetDays = null) {
  const query = targetDays !== null ? `?target_days=${encodeURIComponent(targetDays)}` : "";
  return await apiRequest(`/syncflow/projects/${projectId}/pert-analysis${query}`, {
    method: "GET"
  });
}

export async function fetchCompletedActivities() {
  return await apiRequest(`/syncflow/projects/completed-activities`, {
    method: "GET"
  });
}

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

export async function updateProjectScheduleSettings(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${projectId}/schedule-settings`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchControlSchedule(projectId, statusDate = null) {
  const q = statusDate ? `?status_date=${encodeURIComponent(statusDate)}` : "";
  return await apiRequest(`/syncflow/projects/${projectId}/control-schedule${q}`, {
    method: "GET"
  });
}

export async function updateActivityStatus(projectId, activityId, payload) {
  return await apiRequest(`/syncflow/projects/${projectId}/activities/${activityId}/status`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function seedProjectProgress(projectId) {
  return await apiRequest(`/syncflow/projects/${projectId}/activities/seed-progress`, {
    method: "POST"
  });
}

// ── Notifications API ────────────────────────────────────────────────────────
export async function fetchNotifications(userId, projectId = null) {
  const q = new URLSearchParams({ user_id: userId });
  if (projectId) q.append("project_id", projectId);
  return await apiRequest(`/syncflow/notifications?${q.toString()}`, {
    method: "GET"
  });
}

export async function fetchUnreadNotificationsCount(userId, projectId = null) {
  const q = new URLSearchParams({ user_id: userId });
  if (projectId) q.append("project_id", projectId);
  return await apiRequest(`/syncflow/notifications/unread-count?${q.toString()}`, {
    method: "GET"
  });
}


export async function markNotificationRead(notificationId, userId) {
  return await apiRequest(`/syncflow/notifications/${encodeURIComponent(notificationId)}/read?user_id=${encodeURIComponent(userId)}`, {
    method: "PUT"
  });
}

export async function markAllNotificationsRead(userId, projectId = null) {
  return await apiRequest("/syncflow/notifications/mark-all-read", {
    method: "PUT",
    body: JSON.stringify({ user_id: userId, project_id: projectId })
  });
}

export async function actOnNotification(notificationId, userId, action) {
  return await apiRequest(`/syncflow/notifications/${encodeURIComponent(notificationId)}/action`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, action })
  });
}

export async function deleteNotification(notificationId, userId) {
  return await apiRequest(`/syncflow/notifications/${encodeURIComponent(notificationId)}?user_id=${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

// ── Project Search & Participation ───────────────────────────────────────────
export async function searchAvailableProjects(userId, query = "") {
  const q = new URLSearchParams({ user_id: userId });
  if (query) q.append("query", query);
  return await apiRequest(`/syncflow/projects/available/search?${q.toString()}`, {
    method: "GET"
  });
}

export async function joinProject(projectId, userId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/join`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId })
  });
}


// ── Multi-Baseline Comparison ────────────────────────────────────────────────
export async function createBaseline(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/baselines`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchBaselines(projectId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/baselines`, {
    method: "GET"
  });
}

export async function deleteBaseline(projectId, baselineId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/baselines/${encodeURIComponent(baselineId)}`, {
    method: "DELETE"
  });
}

// ── DCMA 14-Point Quality Diagnostic ─────────────────────────────────────────
export async function fetchDcmaQuality(projectId) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/schedule/dcma-quality`, {
    method: "GET"
  });
}



// ── Executive Portfolio Dashboard ────────────────────────────────────────────
export async function fetchPortfolioDashboard(userId) {
  return await apiRequest(`/syncflow/portfolio/dashboard?user_id=${encodeURIComponent(userId)}`, {
    method: "GET"
  });
}

// ── Google Gemini 1.5 Flash AI NLP Engine ─────────────────────────────────────
export async function aiGenerateWbs(projectId, payload) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/nlp/text-to-wbs`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function aiEstimateDurations(projectId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/nlp/estimate-durations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function aiExtractDependencies(projectId, payload = {}) {
  return await apiRequest(`/syncflow/projects/${encodeURIComponent(projectId)}/nlp/extract-dependencies`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function aiVerifyKey(apiKey) {
  return await apiRequest("/syncflow/nlp/verify-key", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey })
  });
}
