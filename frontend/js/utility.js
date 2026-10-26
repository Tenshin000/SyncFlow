/**
 * SyncFlow Frontend – Shared Utility Functions
 * Consolidates helper logic shared across PM Workspace and Member Workspace.
 */

export function round(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(Number(val) * factor) / factor;
}

export function formatDateYmd(d) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? String(d) : dt.toISOString().split("T")[0];
  } catch (e) {
    return String(d);
  }
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function getStatusBadge(status) {
  if (status === "in_progress") return `<span class="badge badge-amber" style="font-weight: 700;">🟡 WIP</span>`;
  if (status === "completed") return `<span class="badge badge-green" style="font-weight: 700;">🟢 Completed (Pending Review)</span>`;
  if (status === "verified") return `<span class="badge badge-blue" style="font-weight: 700;">🔵 Verified (Controlled)</span>`;
  return `<span class="badge badge-gray">⚪ Not Started</span>`;
}

export function getUserActivityPermission(act, user, project) {
  if (!user || !act) return { canComplete: false, isViewOnly: true, isController: false };
  const userId = String(user.id || user._id || "");
  const userRole = (user.role || "").trim().toLowerCase();
  const isController = Boolean(user.is_admin) || userRole === "controller" || userRole.includes("controller");

  let isProjController = false;
  if (project && project.controllers && Array.isArray(project.controllers)) {
    isProjController = project.controllers.map(String).includes(userId);
  }
  const isActCtrl = isProjController || isController;

  const userTeamsInAct = [];
  if (project && project.teams) {
    const assignedTeamNames = (act.assigned_teams || []).map(String);
    project.teams.forEach(t => {
      const tId = String(t.team_id || "");
      const tName = String(t.name || "");
      if (assignedTeamNames.includes(tId) || assignedTeamNames.includes(tName)) {
        if ((t.member_ids || []).map(String).includes(userId)) {
          userTeamsInAct.push(t);
        }
      }
    });
  }

  if (userTeamsInAct.length > 0) {
    let hasLead = false;
    let isLeadOfAny = false;
    let leadTeamName = "";

    userTeamsInAct.forEach(t => {
      if (t.lead_id) {
        hasLead = true;
        if (String(t.lead_id) === userId) {
          isLeadOfAny = true;
        } else {
          leadTeamName = t.name;
        }
      }
    });

    if (hasLead && !isLeadOfAny) {
      return {
        canComplete: false,
        isViewOnly: true,
        reason: `Team Lead (${leadTeamName || "Assigned"})`,
        isController: isActCtrl
      };
    }
    return {
      canComplete: true,
      isViewOnly: false,
      isLead: isLeadOfAny,
      isController: isActCtrl
    };
  }

  // Direct individual contributor assignment
  return { canComplete: true, isViewOnly: false, isController: isActCtrl };
}

export function getWorkPackageMap(project) {
  const map = {};
  if (!project) return map;
  const wbs = project.wbs || [];
  function traverse(nodes) {
    (nodes || []).forEach(n => {
      if (n.id) map[n.id] = n.name;
      if (n.children && n.children.length > 0) traverse(n.children);
    });
  }
  traverse(wbs);

  (project.deliverables || []).forEach(d => {
    (d.sub_deliverables || []).forEach(sub => {
      (sub.work_packages || []).forEach(wp => {
        const wId = wp.id || wp.work_package_id;
        if (wId) map[wId] = wp.name;
      });
    });
  });
  return map;
}

export const CONTROLLER_CHECKLIST = [
  { id: "crit_req", text: "Deliverable scope and technical specifications fully satisfied" },
  { id: "crit_qa", text: "Quality assurance tests passed and acceptance criteria verified" },
  { id: "crit_docs", text: "Technical documentation, user guides, or build assets verified" },
  { id: "crit_signoff", text: "Formal Controller audit sign-off confirmed" }
];

export function formatTime(timeStr) {
  if (!timeStr) return "";
  try {
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return timeStr;
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return timeStr;
  }
}

export function getInitials(firstName, lastName, fallback = "U") {
  const f = (firstName || "").trim();
  const l = (lastName || "").trim();
  const first = f ? f[0].toUpperCase() : fallback;
  const last = l ? l[0].toUpperCase() : "";
  return `${first}${last}`;
}

export function showTransientAlert(element, msg, type = "success", durationMs = 3500) {
  if (!element) return;
  element.className = `alert alert-${type}`;
  element.textContent = msg;
  element.style.display = "block";
  setTimeout(() => {
    element.style.display = "none";
  }, durationMs);
}

export const ALLOWED_NOTIF_TYPES = {
  join_request: { icon: "🙋", label: "Join Request", badgeClass: "badge-amber" },
  join_approved: { icon: "🎉", label: "Approved", badgeClass: "badge-green" },
  join_rejected: { icon: "🚫", label: "Declined", badgeClass: "badge-danger" },
  review_request: { icon: "📋", label: "Review Request", badgeClass: "badge-amber" },
  review_confirmed: { icon: "🔵", label: "Task Verified", badgeClass: "badge-blue" },
  review_returned_wip: { icon: "🔙", label: "Returned to WIP", badgeClass: "badge-amber" }
};

export function getNotificationMeta(type) {
  return ALLOWED_NOTIF_TYPES[type] || { icon: "📌", label: "Notice", badgeClass: "badge-gray" };
}


