/**
 * SyncFlow Frontend – Signup Controller
 */

import { signupUser } from "./api.js";
import { setLoggedUser, initPasswordToggles } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {
  initPasswordToggles();

  const selectIsPM = document.getElementById("select-is-pm");
  const form = document.getElementById("signup-form");
  const firstName = document.getElementById("first-name");
  const lastName = document.getElementById("last-name");
  const gender = document.getElementById("gender");
  const username = document.getElementById("reg-username");
  const roleInput = document.getElementById("reg-role");
  const pmRoleInfo = document.getElementById("pm-role-info");
  const password = document.getElementById("reg-password");
  const confirmPassword = document.getElementById("confirm-password");
  const dobInput = document.getElementById("date-of-birth");
  const email = document.getElementById("email");
  const mobilePhone = document.getElementById("mobile-phone");
  const submitBtn = document.getElementById("btn-signup-submit");
  const errorAlert = document.getElementById("signup-error-alert");
  const successAlert = document.getElementById("signup-success-alert");

  // Set default Date of Birth to 30 years ago, max to today, min to 130 years ago
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const defaultDob = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate()).toISOString().split("T")[0];
  const minDob = new Date(today.getFullYear() - 130, today.getMonth(), today.getDate()).toISOString().split("T")[0];

  dobInput.value = defaultDob;
  dobInput.max = todayStr;
  dobInput.min = minDob;

  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.style.display = "block";
    successAlert.style.display = "none";
    errorAlert.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function showSuccess(msg) {
    successAlert.textContent = msg;
    successAlert.style.display = "block";
    errorAlert.style.display = "none";
    successAlert.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearAlerts() {
    errorAlert.style.display = "none";
    successAlert.style.display = "none";
  }

  // Handle PM choice change
  selectIsPM.addEventListener("change", () => {
    const isPM = selectIsPM.value === "yes";
    form.style.display = "block";

    if (isPM) {
      roleInput.value = "Project Manager";
      roleInput.disabled = true;
      roleInput.style.backgroundColor = "#F1F5F9";
      pmRoleInfo.style.display = "block";
    } else {
      roleInput.value = "";
      roleInput.disabled = false;
      roleInput.style.backgroundColor = "#FFFFFF";
      roleInput.placeholder = "e.g. Developer, Data Analyst, Controller";
      pmRoleInfo.style.display = "none";
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlerts();

    const isPM = selectIsPM.value === "yes";
    const fn = firstName.value.trim();
    const ln = lastName.value.trim();
    const gn = gender.value;
    const un = username.value.trim();
    const rl = isPM ? "Project Manager" : roleInput.value.trim();
    const pw = password.value;
    const cpw = confirmPassword.value;
    const dob = dobInput.value;
    const em = email.value.trim();
    const mob = mobilePhone.value.trim();

    // Validations
    if (!fn || !ln || !un) {
      showError("First Name, Last Name, and Username are required.");
      return;
    }

    if (!gn) {
      showError("Please select your gender ('Male', 'Female', or 'Other').");
      return;
    }

    if (!rl) {
      showError("Please specify your functional role.");
      return;
    }

    if (pw.length < 6) {
      showError("Password must be at least 6 characters long.");
      return;
    }

    if (pw !== cpw) {
      showError("Passwords do not match. Please verify.");
      return;
    }

    if (!dob) {
      showError("Date of Birth is mandatory.");
      return;
    }

    if (!em) {
      showError("Email Address is mandatory.");
      return;
    }

    const payload = {
      first_name: fn,
      last_name: ln,
      gender: gn,
      username: un,
      password: pw,
      confirm_password: cpw,
      date_of_birth: dob,
      email: em,
      mobile_phone: mob || null,
      role: rl,
      is_admin: isPM
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Registering Account...";

    const { data: newUser, error } = await signupUser(payload);

    submitBtn.disabled = false;
    submitBtn.textContent = "Complete Registration";

    if (error || !newUser) {
      showError(error || "Registration failed. Please check your inputs.");
      return;
    }

    showSuccess(`Registration successful! Welcome to SyncFlow, ${fn}! Redirecting...`);
    setLoggedUser(newUser);

    setTimeout(() => {
      if (isPM) {
        window.location.href = "/project_manager/dashboard.html";
      } else {
        window.location.href = "/member/workspace.html";
      }
    }, 1500);
  });
});
