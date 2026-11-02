/**
 * SyncFlow Frontend – Login Controller
 */

import { loginUser } from "./api.js";
import { setLoggedUser, getLoggedUser, initPasswordToggles } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
  initPasswordToggles();

  // If already authenticated, redirect appropriately
  const existingUser = getLoggedUser();
  if (existingUser) {
    const isPM = Boolean(existingUser.is_admin) || (existingUser.role && existingUser.role.trim() === "Project Manager");
    window.location.href = isPM ? "/project_manager/dashboard.html" : "/member/workspace.html";
    return;
  }

  const form = document.getElementById("login-form");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const errorAlert = document.getElementById("login-error-alert");
  const submitBtn = document.getElementById("btn-login-submit");

  // Forgot password modal elements
  const linkForgot = document.getElementById("link-forgot-pw");
  const modalForgot = document.getElementById("forgot-modal");
  const btnCloseForgot = document.getElementById("btn-close-forgot");
  const btnSubmitForgot = document.getElementById("btn-submit-forgot");
  const forgotIdentifier = document.getElementById("forgot-identifier");
  const forgotStatus = document.getElementById("forgot-status");

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = "block";
  }

  function clearError() {
    errorAlert.textContent = "";
    errorAlert.style.display = "none";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError("Please enter both username and password.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing In...";

    const { data: user, error } = await loginUser(username, password);

    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";

    if (error || !user) {
      showError(error || "Invalid username or password.");
      return;
    }

    // Save session
    setLoggedUser(user);

    // Route based on role
    const isPM = Boolean(user.is_admin) || (user.role && user.role.trim() === "Project Manager");
    if (isPM) {
      window.location.href = "/project_manager/dashboard.html";
    } else {
      window.location.href = "/member/workspace.html";
    }
  });

  // Forgot password handlers
  if (linkForgot && modalForgot) {
    linkForgot.addEventListener("click", (e) => {
      e.preventDefault();
      modalForgot.style.display = "flex";
      forgotStatus.innerHTML = "";
      forgotIdentifier.value = "";
    });

    btnCloseForgot.addEventListener("click", () => {
      modalForgot.style.display = "none";
    });

    btnSubmitForgot.addEventListener("click", () => {
      const val = forgotIdentifier.value.trim();
      if (!val) {
        forgotStatus.innerHTML = `<span style="color: var(--danger);">Please enter your username or email.</span>`;
        return;
      }
      forgotStatus.innerHTML = `<span style="color: var(--success);">If an account matches '${val}', password recovery instructions have been dispatched.</span>`;
      setTimeout(() => {
        modalForgot.style.display = "none";
      }, 2500);
    });
  }
});
