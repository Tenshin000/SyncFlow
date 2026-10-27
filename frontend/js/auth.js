/**
 * SyncFlow Frontend - Authentication & Session Management Module
 * Manages user session state, route protection, transient center alerts,
 * and the unified Profile View/Edit side menu.
 */

import { fetchUserProfile, updateUserProfile } from "./api.js";
import { getInitials } from "./utility.js";

const SESSION_STORAGE_KEY = "syncflow_logged_user";

/**
 * Retrieves currently logged-in user from storage.
 */
export function getLoggedUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Persists logged-in user into sessionStorage.
 */
export function setLoggedUser(user) {
  if (user) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

/**
 * Clears active session and redirects to login.
 */
export function logout() {
  setLoggedUser(null);
  sessionStorage.removeItem("active_project_id");
  sessionStorage.removeItem("syncflow_active_view");
  window.location.href = "/login.html";
}

/**
 * Checks whether user is authenticated and authorized for the page.
 */
export function requireAuth(targetRole = null) {
  const user = getLoggedUser();
  if (!user) {
    window.location.href = "/login.html";
    return null;
  }

  const isPM = Boolean(user.is_admin) || (user.role && user.role.trim() === "Project Manager");

  if (targetRole === "pm" && !isPM) {
    window.location.href = "/member/workspace.html";
    return null;
  }

  if (targetRole === "member" && isPM) {
    window.location.href = "/project_manager/dashboard.html";
    return null;
  }

  return user;
}

/**
 * Displays a prominent red error banner in the center of the screen for exactly 4 seconds.
 */
export function showCenterError(message, durationSec = 4.0) {
  let container = document.getElementById("center-error-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "center-error-container";
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div class="center-error-content">
      ⚠️ <strong>Profile Update Error:</strong> ${message}
    </div>
  `;
  container.style.display = "block";

  setTimeout(() => {
    container.style.display = "none";
    container.innerHTML = "";
  }, durationSec * 1000);
}

/**
 * Renders the unified Profile Side Menu with inline editing capabilities.
 * Enforces role governance and 4-second centered error alerts on failure.
 */
export function renderProfileSidebar(containerElement, user, onUpdateCallback = null) {
  if (!containerElement || !user) return;

  const isPM = Boolean(user.is_admin) || (user.role && user.role.trim() === "Project Manager");
  const userId = user.id || user._id;

  let isEditing = false;
  let originalData = { ...user };

  /**
   * Internal render function to generate the profile sidebar HTML in read or edit mode.
   */
  function render() {
    const fn = user.first_name || "";
    const ln = user.last_name || "";
    const un = user.username || "";
    const gn = user.gender || "Other";
    const em = user.email || "";
    const mob = user.mobile_phone || "";
    const dob = user.date_of_birth ? user.date_of_birth.split("T")[0] : "";
    const role = user.role || (isPM ? "Project Manager" : "Member");

    containerElement.innerHTML = `
      <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 1.2rem; margin-bottom: 1.2rem;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 700;">
            ${getInitials(fn, ln)}
          </div>

          <div>
            <h4 style="margin: 0; font-size: 1.05rem;">${fn} ${ln}</h4>
            <span style="font-size: 0.8rem; color: var(--muted);">@${un}</span>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 1.4rem;">
        <h5 style="margin-bottom: 0.8rem; color: var(--charcoal); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em;">
          Profile Settings
        </h5>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">First Name:</label>
          ${isEditing 
            ? `<input type="text" id="prof-fn" value="${fn}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${fn}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Last Name:</label>
          ${isEditing 
            ? `<input type="text" id="prof-ln" value="${ln}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${ln}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Username:</label>
          ${isEditing 
            ? `<input type="text" id="prof-un" value="${un}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${un}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Gender:</label>
          ${isEditing 
            ? `<select id="prof-gn" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">
                 <option value="Male" ${gn === "Male" ? "selected" : ""}>Male</option>
                 <option value="Female" ${gn === "Female" ? "selected" : ""}>Female</option>
                 <option value="Other" ${gn === "Other" ? "selected" : ""}>Other</option>
               </select>` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${gn}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Email:</label>
          ${isEditing 
            ? `<input type="email" id="prof-em" value="${em}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${em || "—"}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Mobile Contact:</label>
          ${isEditing 
            ? `<input type="tel" id="prof-mob" value="${mob}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${mob || "—"}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 0.75rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Date of Birth:</label>
          ${isEditing 
            ? `<input type="date" id="prof-dob" value="${dob}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;">` 
            : `<div style="font-weight: 600; font-size: 0.9rem;">${dob || "—"}</div>`}
        </div>

        <div class="form-group" style="margin-bottom: 1.1rem;">
          <label style="font-size: 0.8rem; color: var(--muted); margin-bottom: 2px;">Governance:</label>
          ${isEditing
            ? (isPM 
                ? `<input type="text" id="prof-role" value="Project Manager" disabled style="padding: 0.45rem 0.65rem; font-size: 0.88rem; background-color: #F1F5F9;" title="Project Manager role cannot be altered.">`
                : `<input type="text" id="prof-role" value="${role}" style="padding: 0.45rem 0.65rem; font-size: 0.88rem;" placeholder="e.g. Developer, Analyst">`
              )
            : `<div style="font-weight: 700; color: ${isPM ? 'var(--primary)' : 'var(--slate)'}; font-size: 0.9rem;">${role}</div>`
          }
        </div>
      </div>

      <div class="sidebar-bottom-actions" style="margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; position: sticky; bottom: 0; background: inherit; z-index: 10; flex-shrink: 0;">
        <button id="btn-toggle-edit" class="btn btn-primary btn-block">
          ${isEditing ? "Confirm Changes" : "Edit Profile"}
        </button>

        ${isEditing ? `
          <button id="btn-cancel-edit" class="btn btn-secondary btn-block">
            Cancel
          </button>
        ` : `
          <button id="btn-logout" class="btn btn-secondary btn-block">
            Log Out
          </button>
        `}
      </div>
    `;

    // Bind event listeners
    const toggleBtn = containerElement.querySelector("#btn-toggle-edit");
    const cancelBtn = containerElement.querySelector("#btn-cancel-edit");
    const logoutBtn = containerElement.querySelector("#btn-logout");

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        isEditing = false;
        user = { ...originalData };
        render();
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        logout();
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", async () => {
        if (!isEditing) {
          isEditing = true;
          render();
          return;
        }

        // Gather updated values
        const newFn = containerElement.querySelector("#prof-fn").value.trim();
        const newLn = containerElement.querySelector("#prof-ln").value.trim();
        const newUn = containerElement.querySelector("#prof-un").value.trim();
        const newGn = containerElement.querySelector("#prof-gn").value;
        const newEm = containerElement.querySelector("#prof-em").value.trim();
        const newMob = containerElement.querySelector("#prof-mob").value.trim();
        const newDob = containerElement.querySelector("#prof-dob").value;
        const newRoleInput = containerElement.querySelector("#prof-role");
        const newRole = newRoleInput ? newRoleInput.value.trim() : role;

        // Front-end validations
        if (!newFn || !newLn || !newUn) {
          showCenterError("First Name, Last Name, and Username are required.", 4.0);
          return;
        }

        // Role Governance Rule Check
        if (!isPM && newRole.toLowerCase() === "project manager") {
          showCenterError("You cannot change your role to 'Project Manager' unless you already hold that role.", 4.0);
          return;
        }
        if (!isPM && newRole.toLowerCase() === "controller" && (user.role || "").toLowerCase() !== "controller") {
          showCenterError("The role of 'Controller' is assigned exclusively by the Project Manager; users cannot self-assign this role.", 4.0);
          return;
        }

        const payload = {
          first_name: newFn,
          last_name: newLn,
          username: newUn,
          gender: newGn,
          email: newEm || null,
          mobile_phone: newMob || null,
          date_of_birth: newDob || null,
          role: isPM ? "Project Manager" : newRole
        };

        toggleBtn.disabled = true;
        toggleBtn.textContent = "Saving...";

        const { data: updatedUser, error } = await updateUserProfile(userId, payload);

        toggleBtn.disabled = false;

        if (error || !updatedUser) {
          showCenterError(error || "Failed to update profile.", 4.0);
          // Keep profile unchanged
          toggleBtn.textContent = "Confirm Changes";
          return;
        }

        // Successfully updated
        user = { ...updatedUser };
        originalData = { ...updatedUser };
        setLoggedUser(updatedUser);
        isEditing = false;
        render();

        if (onUpdateCallback) {
          onUpdateCallback(updatedUser);
        }
      });
    }
  }

  render();
}

/**
 * Initializes eye toggle buttons on password input fields.
 * Discovers any .password-toggle-btn elements and attaches reveal/mask behavior.
 */
export function initPasswordToggles() {
  const eyeIconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;

  const eyeOffIconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
  `;

  document.querySelectorAll(".password-toggle-btn").forEach((btn) => {
    if (!btn.innerHTML.trim()) {
      btn.innerHTML = eyeIconSvg;
    }
    btn.title = "Show password";
    btn.setAttribute("aria-label", "Show password");

    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const targetInput = targetId ? document.getElementById(targetId) : btn.closest(".password-input-wrapper")?.querySelector("input");
      if (!targetInput) return;

      const isPassword = targetInput.type === "password";
      targetInput.type = isPassword ? "text" : "password";
      btn.innerHTML = isPassword ? eyeOffIconSvg : eyeIconSvg;
      btn.title = isPassword ? "Hide password" : "Show password";
      btn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    });
  });
}

