/**
 * SyncFlow – Google Gemini 1.5 Flash AI Integration Controller
 * Robust, standalone controller for:
 * 1. AI Text-to-WBS Generator (View 2)
 * 2. AI DCMA 14-Point PERT Estimator (View 4)
 * 3. AI Precedence Dependency Extractor (View 3)
 */

import {
  aiGenerateWbs,
  aiEstimateDurations,
  aiExtractDependencies,
  fetchProjectDetail
} from "./api.js";

const LOCAL_STORAGE_GEMINI_KEY = "syncflow_gemini_api_key";

function getStoredGeminiKey() {
  try {
    return localStorage.getItem(LOCAL_STORAGE_GEMINI_KEY) || "";
  } catch {
    return "";
  }
}

function storeGeminiKey(key) {
  try {
    if (key && typeof key === "string" && key.trim()) {
      localStorage.setItem(LOCAL_STORAGE_GEMINI_KEY, key.trim());
    }
  } catch (err) {
    console.warn("Could not save Gemini key to localStorage:", err);
  }
}

function getActiveProjectId() {
  const urlParam = new URLSearchParams(window.location.search).get("project_id");
  if (urlParam) return urlParam;
  const sess = sessionStorage.getItem("active_project_id");
  if (sess) return sess;
  const loc = localStorage.getItem("active_project_id");
  if (loc) return loc;
  return "";
}

let activeProjectCache = null;

async function getProjectData(projectId) {
  if (!projectId) return null;
  if (activeProjectCache && String(activeProjectCache.id || activeProjectCache._id) === String(projectId)) {
    return activeProjectCache;
  }
  try {
    const res = await fetchProjectDetail(projectId);
    if (res && res.data) {
      activeProjectCache = res.data;
      return activeProjectCache;
    }
  } catch (err) {
    console.warn("Failed to fetch project detail for AI modal:", err);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Progress Sequence Helper & Flash Notification
// ─────────────────────────────────────────────────────────────────────────────
function startProgressSequence(prefix, steps) {
  const container = document.getElementById(`${prefix}-loading`);
  const titleEl = document.getElementById(`${prefix}-step-title`);
  const pctEl = document.getElementById(`${prefix}-step-pct`);
  const barEl = document.getElementById(`${prefix}-progress-bar`);
  const detailEl = document.getElementById(`${prefix}-step-detail`);

  if (container) container.style.display = "block";

  let stepIdx = 0;
  const update = () => {
    if (stepIdx < steps.length) {
      const s = steps[stepIdx];
      if (titleEl) titleEl.textContent = s.title;
      if (pctEl) pctEl.textContent = s.pct;
      if (barEl) barEl.style.width = s.pct;
      if (detailEl) detailEl.textContent = s.detail;
      stepIdx++;
    }
  };

  update();
  const interval = setInterval(update, 2200);

  return {
    finish: (finalMsg) => {
      clearInterval(interval);
      if (titleEl) titleEl.textContent = finalMsg || "Complete! Applying updates...";
      if (pctEl) pctEl.textContent = "100%";
      if (barEl) barEl.style.width = "100%";
      if (detailEl) detailEl.textContent = "Updating workspace hierarchy...";
    },
    stop: () => {
      clearInterval(interval);
      if (container) container.style.display = "none";
    }
  };
}

export function checkAndDisplayFlashMessage() {
  const flash = sessionStorage.getItem("syncflow_ai_flash");
  if (!flash) return;
  sessionStorage.removeItem("syncflow_ai_flash");

  // Floating toast notification
  const toast = document.createElement("div");
  toast.id = "syncflow-ai-toast";
  toast.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 99999;
    background: #064e3b;
    color: #ecfdf5;
    padding: 1rem 1.4rem;
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.25), 0 8px 10px -6px rgba(0,0,0,0.2);
    border: 1px solid #10b981;
    font-size: 0.92rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: aiToastSlideIn 0.35s ease-out;
  `;
  toast.innerHTML = `
    <span style="font-size: 1.3rem;">✨</span>
    <span style="flex: 1;">${flash}</span>
    <button style="background: none; border: none; color: #a7f3d0; font-size: 1.3rem; cursor: pointer; padding: 0 4px;" onclick="this.parentElement.remove()">&times;</button>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentElement) {
      toast.style.transition = "opacity 0.6s ease, transform 0.6s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-15px)";
      setTimeout(() => toast.remove(), 600);
    }
  }, 6000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. AI Text-to-WBS Modal Logic
// ─────────────────────────────────────────────────────────────────────────────
export function openWbsModal() {
  const modal = document.getElementById("ai-wbs-modal");
  if (!modal) {
    console.error("Critical: ai-wbs-modal element not found in DOM");
    alert("Error: AI Text-to-WBS modal not found on page.");
    return;
  }

  // 1. OPEN IMMEDIATELY — NO BLOCKING AWAITS
  modal.style.setProperty("display", "flex", "important");
  modal.style.setProperty("z-index", "10000", "important");

  const titleEl = document.getElementById("ai-wbs-context-title");
  const descEl = document.getElementById("ai-wbs-context-desc");
  const keyInput = document.getElementById("ai-wbs-api-key");
  const loading = document.getElementById("ai-wbs-loading");
  const errorBox = document.getElementById("ai-wbs-error");
  const scopeInput = document.getElementById("ai-wbs-scope-input");

  if (loading) loading.style.display = "none";
  if (errorBox) errorBox.style.display = "none";
  if (keyInput) keyInput.value = getStoredGeminiKey();
  if (scopeInput) scopeInput.focus();

  // 2. Fetch context asynchronously
  const projectId = getActiveProjectId();
  if (projectId) {
    getProjectData(projectId).then(proj => {
      if (titleEl) titleEl.textContent = (proj && proj.name) ? proj.name : "Active Project";
      if (descEl) descEl.textContent = (proj && proj.description) ? proj.description : "No scope narrative specified.";
    }).catch(err => {
      console.warn("Could not load project context:", err);
    });
  } else {
    if (titleEl) titleEl.textContent = "Active Project";
    if (descEl) descEl.textContent = "Paste requirements to synthesize WBS.";
  }
}

export function closeWbsModal() {
  const modal = document.getElementById("ai-wbs-modal");
  if (modal) modal.style.display = "none";
}

export async function submitWbsGeneration() {
  const projectId = getActiveProjectId();
  const scopeInput = document.getElementById("ai-wbs-scope-input");
  const promptInput = document.getElementById("ai-wbs-prompt-input");
  const keyInput = document.getElementById("ai-wbs-api-key");
  const modeRadio = document.querySelector('input[name="ai-wbs-mode"]:checked');
  const errorBox = document.getElementById("ai-wbs-error");
  const errorMsg = document.getElementById("ai-wbs-error-msg");
  const submitBtn = document.getElementById("btn-submit-ai-wbs");
  const cancelBtn = document.getElementById("btn-cancel-ai-wbs");

  if (!projectId) {
    if (errorBox && errorMsg) {
      errorMsg.textContent = "No active project found. Please select a project from the dashboard.";
      errorBox.style.display = "block";
    }
    return;
  }

  const scopeText = (scopeInput ? scopeInput.value : "").trim();
  if (!scopeText) {
    if (errorBox && errorMsg) {
      errorMsg.textContent = "Please enter a project scope narrative, charter, or requirements text.";
      errorBox.style.display = "block";
    }
    return;
  }

  const customPrompt = (promptInput ? promptInput.value : "").trim();
  const mode = modeRadio ? modeRadio.value : "merge";
  const apiKey = (keyInput ? keyInput.value : "").trim();
  if (apiKey) storeGeminiKey(apiKey);

  if (errorBox) errorBox.style.display = "none";
  if (submitBtn) submitBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  const progress = startProgressSequence("ai-wbs", [
    { pct: "30%", title: "Step 1/3: 🌐 Connecting to Google Gemini AI Engine...", detail: "Analyzing project charter & preparing PMBOK parameters..." },
    { pct: "65%", title: "Step 2/3: 🧠 Decomposing Scope into PMBOK Hierarchy...", detail: "Synthesizing Deliverables, Work Packages & PERT duration estimates..." },
    { pct: "90%", title: "Step 3/3: ⚡ Validating Structure & Inserting to MongoDB...", detail: "Verifying DCMA 14-point rules and committing baseline to workspace..." }
  ]);

  try {
    const payload = {
      scope_text: scopeText,
      custom_prompt: customPrompt || undefined,
      mode: mode,
      api_key: apiKey || undefined
    };

    const res = await aiGenerateWbs(projectId, payload);
    if (res.error) {
      throw new Error(res.error);
    }

    progress.finish("Complete! 🎉 WBS synthesized successfully.");
    
    // Store active view (View 2: Define Activities & WBS) and flash message for notification on reload
    sessionStorage.setItem("syncflow_active_view", "2");
    sessionStorage.setItem("syncflow_ai_flash", "✨ WBS successfully synthesized! Level 2 Deliverables and Work Packages are now live.");

    // Dismiss modal immediately
    closeWbsModal();

    // Reload workspace to render the newly created WBS
    setTimeout(() => {
      window.location.reload();
    }, 350);


  } catch (err) {
    progress.stop();
    if (errorBox && errorMsg) {
      errorMsg.textContent = "AI Generation Error: " + (err.message || "Failed to decompose scope into WBS.");
      errorBox.style.display = "block";
    }
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. AI DCMA 14-Point PERT Estimator Modal Logic
// ─────────────────────────────────────────────────────────────────────────────
export function openEstimateModal() {
  const modal = document.getElementById("ai-estimate-modal");
  if (!modal) return;

  // 1. OPEN IMMEDIATELY
  modal.style.setProperty("display", "flex", "important");
  modal.style.setProperty("z-index", "10000", "important");

  const statsEl = document.getElementById("ai-estimate-context-stats");
  const keyInput = document.getElementById("ai-estimate-api-key");
  const loading = document.getElementById("ai-estimate-loading");
  const errorBox = document.getElementById("ai-estimate-error");

  if (loading) loading.style.display = "none";
  if (errorBox) errorBox.style.display = "none";
  if (keyInput) keyInput.value = getStoredGeminiKey();

  const projectId = getActiveProjectId();
  if (projectId) {
    getProjectData(projectId).then(proj => {
      const acts = (proj && proj.activities) ? proj.activities : [];
      const missing = acts.filter(a => a.optimistic == null || a.most_likely == null || a.pessimistic == null || (a.optimistic === 0 && a.pessimistic === 0));
      if (statsEl) {
        statsEl.textContent = `Targeting ${acts.length} total activities in "${proj ? proj.name : 'Project'}" (${missing.length} unestimated or default 0d).`;
      }
    }).catch(err => {
      console.warn("Could not load project context:", err);
    });
  }
}

export function closeEstimateModal() {
  const modal = document.getElementById("ai-estimate-modal");
  if (modal) modal.style.display = "none";
}

export async function submitEstimateCalculation() {
  const projectId = getActiveProjectId();
  const promptInput = document.getElementById("ai-estimate-prompt-input");
  const keyInput = document.getElementById("ai-estimate-api-key");
  const errorBox = document.getElementById("ai-estimate-error");
  const errorMsg = document.getElementById("ai-estimate-error-msg");
  const submitBtn = document.getElementById("btn-submit-ai-estimate");
  const cancelBtn = document.getElementById("btn-cancel-ai-estimate");

  if (!projectId) {
    if (errorBox && errorMsg) {
      errorMsg.textContent = "No active project found.";
      errorBox.style.display = "block";
    }
    return;
  }

  const customPrompt = (promptInput ? promptInput.value : "").trim();
  const apiKey = (keyInput ? keyInput.value : "").trim();
  if (apiKey) storeGeminiKey(apiKey);

  if (errorBox) errorBox.style.display = "none";
  if (submitBtn) submitBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  const progress = startProgressSequence("ai-estimate", [
    { pct: "30%", title: "Step 1/3: 🌐 Contacting Gemini AI Engine...", detail: "Auditing activities against DCMA 14-Point Metric 6 guidelines..." },
    { pct: "65%", title: "Step 2/3: 🧠 Calculating PERT 3-Point Parameters...", detail: "Computing optimistic (a), most likely (m), and pessimistic (b) durations..." },
    { pct: "90%", title: "Step 3/3: ⚡ Applying Estimates & Risk Rationales...", detail: "Committing PERT beta distribution parameters to schedule baseline..." }
  ]);

  try {
    const payload = {
      custom_prompt: customPrompt || undefined,
      api_key: apiKey || undefined
    };

    const res = await aiEstimateDurations(projectId, payload);
    if (res.error) {
      throw new Error(res.error);
    }

    progress.finish("Complete! 🎉 PERT estimates calculated.");
    sessionStorage.setItem("syncflow_active_view", "4");
    sessionStorage.setItem("syncflow_ai_flash", "✨ DCMA 14-Point PERT estimates calculated and applied successfully!");

    closeEstimateModal();

    setTimeout(() => {
      window.location.reload();
    }, 350);

  } catch (err) {
    progress.stop();
    if (errorBox && errorMsg) {
      errorMsg.textContent = "AI Estimation Error: " + (err.message || "Failed to calculate estimates.");
      errorBox.style.display = "block";
    }
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AI Precedence Dependency Extractor Modal Logic
// ─────────────────────────────────────────────────────────────────────────────
export function openDependencyModal() {
  const modal = document.getElementById("ai-dependency-modal");
  if (!modal) return;

  // 1. OPEN IMMEDIATELY
  modal.style.setProperty("display", "flex", "important");
  modal.style.setProperty("z-index", "10000", "important");

  const statsEl = document.getElementById("ai-dependency-context-stats");
  const keyInput = document.getElementById("ai-dep-api-key");
  const loading = document.getElementById("ai-dep-loading");
  const errorBox = document.getElementById("ai-dep-error");

  if (loading) loading.style.display = "none";
  if (errorBox) errorBox.style.display = "none";
  if (keyInput) keyInput.value = getStoredGeminiKey();

  const projectId = getActiveProjectId();
  if (projectId) {
    getProjectData(projectId).then(proj => {
      const acts = (proj && proj.activities) ? proj.activities : [];
      if (statsEl) {
        statsEl.textContent = `Project "${proj ? proj.name : 'Project'}" has ${acts.length} activities ready for CPM precedence sequencing.`;
      }
    }).catch(err => {
      console.warn("Could not load project context:", err);
    });
  }
}

export function closeDependencyModal() {
  const modal = document.getElementById("ai-dependency-modal");
  if (modal) modal.style.display = "none";
}

export async function submitDependencyExtraction() {
  const projectId = getActiveProjectId();
  const narrativeInput = document.getElementById("ai-dep-narrative-input");
  const promptInput = document.getElementById("ai-dep-prompt-input");
  const keyInput = document.getElementById("ai-dep-api-key");
  const errorBox = document.getElementById("ai-dep-error");
  const errorMsg = document.getElementById("ai-dep-error-msg");
  const submitBtn = document.getElementById("btn-submit-ai-dep");
  const cancelBtn = document.getElementById("btn-cancel-ai-dep");

  if (!projectId) {
    if (errorBox && errorMsg) {
      errorMsg.textContent = "No active project found.";
      errorBox.style.display = "block";
    }
    return;
  }

  const narrative = (narrativeInput ? narrativeInput.value : "").trim();
  const customPrompt = (promptInput ? promptInput.value : "").trim();
  const apiKey = (keyInput ? keyInput.value : "").trim();
  if (apiKey) storeGeminiKey(apiKey);

  if (errorBox) errorBox.style.display = "none";
  if (submitBtn) submitBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  const progress = startProgressSequence("ai-dep", [
    { pct: "30%", title: "Step 1/3: 🌐 Analyzing Workflow Narrative...", detail: "Identifying handoffs, dependencies, and lag requirements..." },
    { pct: "65%", title: "Step 2/3: 🧠 Synthesizing Precedence Links (FS, SS, FF)...", detail: "Enforcing DCMA non-negative lags & testing cycle freedom with Kahn's algorithm..." },
    { pct: "90%", title: "Step 3/3: ⚡ Committing Dependency Network...", detail: "Connecting activities into topological CPM schedule network..." }
  ]);

  try {
    const payload = {
      workflow_narrative: narrative || undefined,
      custom_prompt: customPrompt || undefined,
      api_key: apiKey || undefined
    };

    const res = await aiExtractDependencies(projectId, payload);
    if (res.error) {
      throw new Error(res.error);
    }

    progress.finish("Complete! 🎉 Dependencies extracted.");
    sessionStorage.setItem("syncflow_active_view", "3");
    sessionStorage.setItem("syncflow_ai_flash", "✨ Precedence network dependencies synthesized and validated successfully!");


    closeDependencyModal();

    setTimeout(() => {
      window.location.reload();
    }, 350);

  } catch (err) {
    progress.stop();
    if (errorBox && errorMsg) {
      errorMsg.textContent = "AI Dependency Extraction Error: " + (err.message || "Failed to extract dependencies.");
      errorBox.style.display = "block";
    }
    if (submitBtn) submitBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Expose on window for direct HTML inline calls & developer console access
// ─────────────────────────────────────────────────────────────────────────────
window.SyncFlowAI = {
  openWbsModal,
  closeWbsModal,
  submitWbsGeneration,
  openEstimateModal,
  closeEstimateModal,
  submitEstimateCalculation,
  openDependencyModal,
  closeDependencyModal,
  submitDependencyExtraction,
  getActiveProjectId
};

// ─────────────────────────────────────────────────────────────────────────────
// Global Event Delegation & Direct Listeners
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("click", (e) => {
  // 1. Text-to-WBS Triggers & Actions
  if (e.target.closest("#btn-ai-text-to-wbs")) {
    e.preventDefault();
    openWbsModal();
    return;
  }
  if (e.target.closest("#btn-close-ai-wbs-modal") || e.target.closest("#btn-cancel-ai-wbs")) {
    e.preventDefault();
    closeWbsModal();
    return;
  }
  if (e.target.closest("#btn-submit-ai-wbs") || e.target.closest("#btn-retry-ai-wbs")) {
    e.preventDefault();
    submitWbsGeneration();
    return;
  }
  if (e.target.id === "ai-wbs-modal") {
    closeWbsModal();
    return;
  }

  // 2. DCMA Estimator Triggers & Actions
  if (e.target.closest("#btn-ai-estimate-durations")) {
    e.preventDefault();
    openEstimateModal();
    return;
  }
  if (e.target.closest("#btn-close-ai-estimate-modal") || e.target.closest("#btn-cancel-ai-estimate")) {
    e.preventDefault();
    closeEstimateModal();
    return;
  }
  if (e.target.closest("#btn-submit-ai-estimate") || e.target.closest("#btn-retry-ai-estimate")) {
    e.preventDefault();
    submitEstimateCalculation();
    return;
  }
  if (e.target.id === "ai-estimate-modal") {
    closeEstimateModal();
    return;
  }

  // 3. Precedence Extractor Triggers & Actions
  if (e.target.closest("#btn-ai-extract-dependencies")) {
    e.preventDefault();
    openDependencyModal();
    return;
  }
  if (e.target.closest("#btn-close-ai-dependency-modal") || e.target.closest("#btn-cancel-ai-dep")) {
    e.preventDefault();
    closeDependencyModal();
    return;
  }
  if (e.target.closest("#btn-submit-ai-dep") || e.target.closest("#btn-retry-ai-dep")) {
    e.preventDefault();
    submitDependencyExtraction();
    return;
  }
  if (e.target.id === "ai-dependency-modal") {
    closeDependencyModal();
    return;
  }
});

// Also attach directly when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachDirectHandlers);
} else {
  attachDirectHandlers();
}

function attachDirectHandlers() {
  checkAndDisplayFlashMessage();

  const btnWbs = document.getElementById("btn-ai-text-to-wbs");
  if (btnWbs) btnWbs.addEventListener("click", () => openWbsModal());

  const btnEst = document.getElementById("btn-ai-estimate-durations");
  if (btnEst) btnEst.addEventListener("click", () => openEstimateModal());

  const btnDep = document.getElementById("btn-ai-extract-dependencies");
  if (btnDep) btnDep.addEventListener("click", () => openDependencyModal());
}

// Check flash message immediately in case DOM is already ready
checkAndDisplayFlashMessage();

console.log("SyncFlow Google Gemini 1.5 Flash AI Engine loaded and attached successfully.");

