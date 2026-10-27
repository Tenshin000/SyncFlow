/**
 * SyncFlow Frontend - Project-Scoped Notification System
 * Handles notification bell badge, dropdown log drawer, interactive actions
 * (e.g., project join approvals), mark-as-read, and full CRUD operations.
 */

import {
  fetchNotifications,
  fetchUnreadNotificationsCount,
  markNotificationRead,
  markAllNotificationsRead,
  actOnNotification,
  deleteNotification
} from "./api.js";
import { formatTime, getNotificationMeta } from "./utility.js";


/**
 * Initializes and mounts the notification bell component into a target container element.
 * 
 * @param {HTMLElement|string} mountTarget - DOM element or CSS selector
 * @param {Object} user - Logged-in user object
 * @param {string|null} projectId - Optional project scope (null = all user projects)
 * @returns {Object} Controller with refresh() and destroy() methods
 */
export function initNotificationBell(mountTarget, user, projectId = null) {
  const container = typeof mountTarget === "string" ? document.querySelector(mountTarget) : mountTarget;
  if (!container || !user) return null;

  const userId = String(user.id || user._id);
  const isPM = Boolean(user.is_admin) || (user.role && user.role.trim() === "Project Manager");

  // Create bell wrapper
  const bellWrapper = document.createElement("div");
  bellWrapper.className = "notification-bell-wrapper";
  bellWrapper.style.position = "relative";
  bellWrapper.style.display = "inline-flex";
  bellWrapper.style.alignItems = "center";

  bellWrapper.innerHTML = `
    <button type="button" class="notification-bell-btn" title="Project Notifications" aria-label="Project Notifications">
      <span class="bell-icon">🔔</span>
      <span class="notification-badge" style="display: none;">0</span>
    </button>
    <div class="notification-dropdown" style="display: none;">
      <div class="notification-dropdown-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.1rem;">🔔</span>
          <span style="font-weight: 700; font-size: 0.95rem; color: var(--charcoal);">Project Notifications</span>
        </div>
        <button type="button" class="btn-mark-all-read" style="background: none; border: none; font-size: 0.78rem; color: var(--primary); font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 4px;">
          Mark all as read
        </button>
      </div>
      <div class="notification-dropdown-body">
        <p class="notification-loading">Loading notifications...</p>
      </div>
      <div class="notification-dropdown-footer">
        <span style="font-size: 0.75rem; color: var(--muted);">Project-level audit logs & updates</span>
      </div>
    </div>
  `;

  container.appendChild(bellWrapper);

  const bellBtn = bellWrapper.querySelector(".notification-bell-btn");
  const badgeEl = bellWrapper.querySelector(".notification-badge");
  const dropdownEl = bellWrapper.querySelector(".notification-dropdown");
  const bodyEl = bellWrapper.querySelector(".notification-dropdown-body");
  const markAllBtn = bellWrapper.querySelector(".btn-mark-all-read");

  let isDropdownOpen = false;
  let cachedNotifications = [];

  /**
   * Refreshes the unread count badge.
   * If unread count is 0, the badge disappears completely (Facebook-style).
   */
  async function refreshBadge() {
    const { data, error } = await fetchUnreadNotificationsCount(userId, projectId);
    if (error || !data) {
      badgeEl.style.display = "none";
      return;
    }

    const count = data.unread_count || 0;
    if (count > 0) {
      badgeEl.textContent = count > 99 ? "99+" : String(count);
      badgeEl.style.display = "flex";
    } else {
      badgeEl.style.display = "none";
    }
  }

  /**
   * Loads notifications list and renders into dropdown drawer.
   */
  async function loadNotifications() {
    bodyEl.innerHTML = `<p class="notification-loading" style="text-align: center; padding: 1.5rem 0; color: var(--muted); font-size: 0.85rem;">Loading notifications...</p>`;
    const { data: list, error } = await fetchNotifications(userId, projectId);

    if (error) {
      bodyEl.innerHTML = `<div style="padding: 1rem; color: #DC2626; font-size: 0.85rem; text-align: center;">Failed to load notifications: ${error}</div>`;
      return;
    }

    cachedNotifications = list || [];
    renderList();
    await refreshBadge();
  }

  /**
   * Renders the cached notification list items.
   */
  function renderList() {
    if (!cachedNotifications || cachedNotifications.length === 0) {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 2.2rem 1rem; color: var(--muted);">
          <div style="font-size: 2rem; margin-bottom: 0.4rem;">📭</div>
          <p style="font-size: 0.88rem; font-weight: 600; margin-bottom: 2px;">No notifications yet</p>
          <p style="font-size: 0.78rem; color: var(--muted); margin: 0;">Project logs and updates will appear here.</p>
        </div>
      `;
      return;
    }

    let itemsHtml = "";
    cachedNotifications.forEach(notif => {
      const isUnread = !notif.is_read;
      const type = notif.type || "general";
      const notifData = notif.data || {};
      const status = notifData.status;

      const meta = getNotificationMeta(type);
      const typeIcon = meta.icon;
      const typeBadge = `<span class="badge ${meta.badgeClass}" style="font-size: 0.7rem; padding: 1px 6px;">${meta.label}</span>`;

      // Check if this is an actionable join request for the PM
      let actionButtons = "";
      if (type === "join_request" && isPM) {
        if (status === "approved") {
          actionButtons = `<span style="font-size: 0.78rem; color: #16A34A; font-weight: 700;">✅ Confirmed & Added</span>`;
        } else if (status === "rejected") {
          actionButtons = `<span style="font-size: 0.78rem; color: #DC2626; font-weight: 700;">❌ Request Declined</span>`;
        } else {
          actionButtons = `
            <div style="display: flex; gap: 6px; margin-top: 6px;">
              <button type="button" class="btn btn-sm btn-action-approve" data-notif-id="${notif.id}" style="padding: 3px 10px; font-size: 0.78rem; background: #16A34A; color: #FFFFFF; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">
                ✓ Approve
              </button>
              <button type="button" class="btn btn-sm btn-action-reject" data-notif-id="${notif.id}" style="padding: 3px 10px; font-size: 0.78rem; background: #EF4444; color: #FFFFFF; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">
                ✕ Reject
              </button>
            </div>
          `;
        }
      }

      // Read marker button
      const readMarker = isUnread 
        ? `<button type="button" class="btn-mark-item-read" data-notif-id="${notif.id}" title="Mark as read" style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 0.75rem; padding: 2px 4px;">● Mark Read</button>`
        : `<span style="font-size: 0.72rem; color: #94A3B8;">✓ Read</span>`;

      // Soft-delete button (available to all users; permanently remains in DB, hidden for this user)
      const deleteBtn = `<button type="button" class="btn-delete-notif" data-notif-id="${notif.id}" title="Remove notification" style="background: none; border: none; color: #94A3B8; cursor: pointer; font-size: 0.75rem; padding: 2px 4px; margin-left: 4px;">🗑️</button>`;

      itemsHtml += `
        <div class="notification-item ${isUnread ? 'notification-unread' : 'notification-read'}" data-notif-id="${notif.id}">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="font-size: 1.3rem; line-height: 1; flex-shrink: 0; margin-top: 2px;">
              ${typeIcon}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 2px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <strong style="font-size: 0.85rem; color: var(--charcoal);">${notif.title}</strong>
                  ${typeBadge}
                </div>
                <span style="font-size: 0.72rem; color: var(--muted);">${formatTime(notif.created_at)}</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--slate); line-height: 1.4; margin-bottom: 4px;">
                ${notif.message}
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; margin-top: 4px;">
                <span class="project-tag" style="font-size: 0.72rem; color: #1E40AF; background: #DBEAFE; padding: 1px 6px; border-radius: 3px; font-weight: 600;">
                  📁 ${notif.project_name || 'Project'}
                </span>
                <div style="display: flex; align-items: center;">
                  ${readMarker}
                  ${deleteBtn}
                </div>
              </div>
              ${actionButtons}
            </div>
          </div>
        </div>
      `;
    });

    bodyEl.innerHTML = itemsHtml;

    // Attach listeners
    // Mark item read
    bodyEl.querySelectorAll(".btn-mark-item-read").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nid = btn.getAttribute("data-notif-id");
        await markNotificationRead(nid, userId);
        const target = cachedNotifications.find(n => n.id === nid);
        if (target) target.is_read = true;
        renderList();
        await refreshBadge();
      });
    });

    // Delete item (Soft-delete for user)
    bodyEl.querySelectorAll(".btn-delete-notif").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nid = btn.getAttribute("data-notif-id");
        if (!confirm("Are you sure you want to remove this notification?")) return;
        const { error } = await deleteNotification(nid, userId);
        if (error) {
          alert(`Failed to delete notification: ${error}`);
          return;
        }
        cachedNotifications = cachedNotifications.filter(n => n.id !== nid);
        renderList();
        await refreshBadge();
      });
    });

    // Approve join request
    bodyEl.querySelectorAll(".btn-action-approve").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nid = btn.getAttribute("data-notif-id");
        btn.disabled = true;
        btn.textContent = "Processing...";
        const { data, error } = await actOnNotification(nid, userId, "approve");
        if (error) {
          alert(`Approval failed: ${error}`);
          btn.disabled = false;
          btn.textContent = "✓ Approve";
          return;
        }
        alert(data.message || "User approved and added to the project!");
        await loadNotifications();
      });
    });

    // Reject join request
    bodyEl.querySelectorAll(".btn-action-reject").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nid = btn.getAttribute("data-notif-id");
        btn.disabled = true;
        btn.textContent = "Processing...";
        const { data, error } = await actOnNotification(nid, userId, "reject");
        if (error) {
          alert(`Rejection failed: ${error}`);
          btn.disabled = false;
          btn.textContent = "✕ Reject";
          return;
        }
        await loadNotifications();
      });
    });
  }

  // Toggle dropdown on bell click
  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isDropdownOpen = !isDropdownOpen;
    dropdownEl.style.display = isDropdownOpen ? "flex" : "none";
    if (isDropdownOpen) {
      loadNotifications();
    }
  });

  // Mark all read button
  markAllBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    markAllBtn.textContent = "Marking...";
    await markAllNotificationsRead(userId, projectId);
    cachedNotifications.forEach(n => { n.is_read = true; });
    renderList();
    await refreshBadge();
    markAllBtn.textContent = "Mark all as read";
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (isDropdownOpen && !bellWrapper.contains(e.target)) {
      isDropdownOpen = false;
      dropdownEl.style.display = "none";
    }
  });

  // Prevent dropdown inside clicks from closing it
  dropdownEl.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Initial badge check
  refreshBadge();

  // Periodic polling every 30 seconds for real-time notification updates
  const pollInterval = setInterval(() => {
    refreshBadge();
    if (isDropdownOpen) {
      loadNotifications();
    }
  }, 30000);

  return {
    refresh: () => {
      refreshBadge();
      if (isDropdownOpen) loadNotifications();
    },
    destroy: () => {
      clearInterval(pollInterval);
      bellWrapper.remove();
    }
  };
}
