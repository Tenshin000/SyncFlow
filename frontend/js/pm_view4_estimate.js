/**
 * SyncFlow Frontend - PM Workspace View 4: Estimate Activity Durations Matrix
 * PMBOK Process 6.4: Estimate Activity Durations.
 * Renders the interactive Three-Point (Beta), Parametric, and Analogous matrix,
 * live input validation (Opt < Likely < Pess), standard defaults seeding,
 * and database persistence.
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import { updateProjectActivities } from "./api.js";
import { pmState } from "./pm_workspace_state.js";
import { round, getWorkPackageMap } from "./utility.js";
import { renderEstimateRowHtml } from "./pm_workspace_templates.js";
import {
  pertEngineState,
  STANDARD_PERT_BASELINE,
  applyActivityDurationCalc,
  computePertScheduleClient,
  updatePertSimulator,
  openAnalogousPicker,
  initPertEngineListeners
} from "./pm_view4_pert_engine.js";

// ==========================================
// VIEW STATE
// ==========================================
let hasUnsavedEstimates = false;

// ==========================================
// RENDER ESTIMATION TABLE
// ==========================================
/**
 * Renders interactive Three-Point, Parametric, and Analogous duration estimation matrix.
 */
export function renderEstimateTable() {
  const project = pmState.project || {};
  const activities = project.activities || [];
  const dependencies = project.dependencies || [];
  const wpMap = getWorkPackageMap(project);

  // Recompute CPM
  pertEngineState.activePertAnalysis = computePertScheduleClient(activities, dependencies);

  const estimateSearchInput = document.getElementById("estimate-search-input");
  const estimateWpFilter = document.getElementById("estimate-wp-filter");
  const estimateTechFilter = document.getElementById("estimate-tech-filter");
  const estimateCpOnlyFilter = document.getElementById("estimate-cp-only-filter");
  const estimateTableContainer = document.getElementById("estimate-table-container");

  if (!estimateTableContainer) return;

  // Populate WP Filter if options empty
  if (estimateWpFilter && estimateWpFilter.options.length <= 1) {
    const distinctWps = new Set();
    activities.forEach(a => { if (a.work_package_id) distinctWps.add(a.work_package_id); });
    Array.from(distinctWps).sort().forEach(wpId => {
      const opt = document.createElement("option");
      opt.value = wpId;
      opt.textContent = `${wpId}: ${wpMap[wpId] || 'Work Package'}`;
      estimateWpFilter.appendChild(opt);
    });
  }

  // Filter criteria
  const searchQuery = (estimateSearchInput ? estimateSearchInput.value : "").trim().toLowerCase();
  const wpFilterVal = estimateWpFilter ? estimateWpFilter.value : "";
  const techFilterVal = estimateTechFilter ? estimateTechFilter.value : "";
  const cpOnly = estimateCpOnlyFilter ? estimateCpOnlyFilter.checked : false;

  const analysis = pertEngineState.activePertAnalysis || { criticalPathIds: [], schedule: {} };

  const filtered = activities.filter(a => {
    if (searchQuery) {
      const text = `${a.activity_id} ${a.name} ${a.description || ''}`.toLowerCase();
      if (!text.includes(searchQuery)) return false;
    }
    if (wpFilterVal && a.work_package_id !== wpFilterVal) return false;
    const isMilestone = Boolean(a.is_milestone || (a.estimation_technique || "").toLowerCase() === "milestone");
    const tech = isMilestone ? "milestone" : (a.estimation_technique || "three_point").toLowerCase();
    if (techFilterVal && tech !== techFilterVal) return false;
    const isCrit = analysis.criticalPathIds.includes(a.activity_id);
    if (cpOnly && !isCrit) return false;
    return true;
  });

  if (filtered.length === 0) {
    estimateTableContainer.innerHTML = `
      <div style="text-align: center; padding: 2.5rem; color: var(--slate);">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
        <p style="margin: 0; font-weight: 600;">No activities match the active filter criteria.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="table-responsive">
      <table>
        <thead>
          <tr>
            <th style="width: 28%;">Activity & Path Status</th>
            <th style="width: 14%;">Technique</th>
            <th style="width: 32%;">Estimation Inputs (a, m, b / Rate × Qty)</th>
            <th style="width: 13%; text-align: right;">Expected (te)</th>
            <th style="width: 13%; text-align: center;">Uncertainty (σ)</th>
          </tr>
        </thead>
        <tbody>
  `;

  filtered.forEach(act => {
    const aid = act.activity_id;
    const isMilestone = Boolean(act.is_milestone || (act.estimation_technique || "").toLowerCase() === "milestone");
    const isCrit = analysis.criticalPathIds.includes(aid);
    const sched = analysis.schedule[aid] || { float: 0 };
    const wpName = wpMap[act.work_package_id] || act.work_package_id || "Work Package";
    const tech = isMilestone ? "milestone" : (act.estimation_technique || "three_point").toLowerCase();

    const a = act.optimistic !== undefined ? act.optimistic : 3.0;
    const m = act.most_likely !== undefined ? act.most_likely : 5.0;
    const b = act.pessimistic !== undefined ? act.pessimistic : 9.0;
    const te = isMilestone ? 0.0 : (act.duration !== undefined ? act.duration : round((a + 4*m + b)/6, 2));
    const sigma = isMilestone ? 0.0 : (act.std_dev !== undefined ? act.std_dev : round((b - a)/6, 2));
    const varVal = isMilestone ? 0.0 : (act.variance !== undefined ? act.variance : round(sigma*sigma, 3));

    const pathBadge = isCrit
      ? `<span class="badge badge-rose" style="font-size: 0.72rem; padding: 2px 7px;">🔥 Critical Path (Float: 0d)</span>`
      : `<span class="badge badge-secondary" style="font-size: 0.72rem; padding: 2px 7px;">⚪ Float: ${sched.float}d</span>`;

    // Inputs based on technique
    let inputsHtml = "";
    if (isMilestone) {
      inputsHtml = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge badge-indigo" style="font-size: 0.78rem; padding: 4px 10px;">🎯 Milestone Gate (Fixed Duration: 0.00 d)</span>
        </div>
      `;
    } else if (tech === "three_point") {
      const isInvalid = !(a > 0 && a < m && m < b);
      let errDesc = "";
      if (a <= 0) errDesc = "Opt (a) must be > 0";
      else if (a >= m && m >= b) errDesc = "Opt (a) < Likely (m) < Pess (b) violated";
      else if (a >= m) errDesc = `Opt (a=${a}) ≥ Likely (m=${m})`;
      else if (m >= b) errDesc = `Likely (m=${m}) ≥ Pess (b=${b})`;

      inputsHtml = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.68rem; color: #15803D; font-weight: 700;">Opt (a)</span>
              <input type="number" step="0.5" min="0.1" value="${a}" class="form-control pert-input-a" data-id="${aid}" style="width: 70px; padding: 3px 6px; font-size: 0.82rem; text-align: center; ${isInvalid && (a <= 0 || a >= m) ? 'border-color: #EF4444; background: #FEF2F2;' : ''}" title="Optimistic Duration">
            </div>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.68rem; color: #1D4ED8; font-weight: 700;">Likely (m)</span>
              <input type="number" step="0.5" min="0.1" value="${m}" class="form-control pert-input-m" data-id="${aid}" style="width: 70px; padding: 3px 6px; font-size: 0.82rem; text-align: center; font-weight: 700; ${isInvalid && (m <= a || m >= b) ? 'border-color: #EF4444; background: #FEF2F2;' : ''}" title="Most Likely Duration">
            </div>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.68rem; color: #B91C1C; font-weight: 700;">Pess (b)</span>
              <input type="number" step="0.5" min="0.1" value="${b}" class="form-control pert-input-b" data-id="${aid}" style="width: 70px; padding: 3px 6px; font-size: 0.82rem; text-align: center; ${isInvalid && (b <= m) ? 'border-color: #EF4444; background: #FEF2F2;' : ''}" title="Pessimistic Duration">
            </div>
          </div>
          <div class="pert-err-msg-${aid}" style="font-size: 0.72rem; color: #DC2626; font-weight: 700; display: ${isInvalid ? 'block' : 'none'};">
            ⚠️ Violation: Strict ordering required: Opt (a) &lt; Likely (m) &lt; Pess (b) ${errDesc ? `(${errDesc})` : ''}
          </div>
        </div>
      `;
    } else if (tech === "parametric") {
      const rate = act.parametric_rate !== undefined && act.parametric_rate !== null ? act.parametric_rate : 1.0;
      const qty = act.parametric_quantity !== undefined && act.parametric_quantity !== null ? act.parametric_quantity : m;
      inputsHtml = `
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 0.68rem; color: var(--slate); font-weight: 700;">Rate (d/unit)</span>
            <input type="number" step="0.05" min="0.01" value="${rate}" class="form-control pert-input-prate" data-id="${aid}" style="width: 80px; padding: 3px 6px; font-size: 0.82rem; text-align: center;">
          </div>
          <span style="margin-top: 14px; font-weight: 700; color: var(--slate);">×</span>
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: 0.68rem; color: var(--slate); font-weight: 700;">Units Qty</span>
            <input type="number" step="1" min="1" value="${qty}" class="form-control pert-input-pqty" data-id="${aid}" style="width: 80px; padding: 3px 6px; font-size: 0.82rem; text-align: center;">
          </div>
        </div>
      `;
    } else if (tech === "analogous") {
      if (act.analogous_activity_id && act.analogous_actual_duration) {
        inputsHtml = `
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 6px 10px; font-size: 0.78rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <span style="font-weight: 700; color: #166534; font-size: 0.78rem;">📁 ${act.analogous_project_name || 'Historical Project'}</span>
              <button type="button" class="btn btn-sm btn-outline-primary btn-open-analogous-picker" data-id="${aid}" style="padding: 1px 7px; font-size: 0.72rem; line-height: 1.2;">
                🔄 Change
              </button>
            </div>
            <div style="font-weight: 600; color: #14532D; margin-bottom: 2px;">
              ${act.analogous_activity_name} <span style="font-family: monospace; font-size: 0.72rem; color: #166534;">(${act.analogous_activity_id})</span>
            </div>
            <div style="color: #15803D; font-size: 0.72rem;">
              🛡️ Verified: <strong>${act.analogous_controller_name || 'Sarah Williams'}</strong> on ${act.analogous_approval_date || '—'}
            </div>
          </div>
        `;
      } else {
        inputsHtml = `
          <div style="display: flex; align-items: center;">
            <button type="button" class="btn btn-sm btn-outline-primary btn-open-analogous-picker" data-id="${aid}" style="padding: 6px 12px; font-size: 0.8rem; font-weight: 600; border-style: dashed; width: 100%;">
              📜 Select Completed Activity (Controller-Approved)...
            </button>
          </div>
        `;
      }
    } else {
      // Single-Point
      inputsHtml = `
        <div style="display: flex; gap: 6px; align-items: center;">
          <div style="display: flex; flex-direction: column; width: 90px;">
            <span style="font-size: 0.68rem; color: var(--slate); font-weight: 700;">Single Duration</span>
            <input type="number" step="0.5" min="0.5" value="${m}" class="form-control pert-input-m" data-id="${aid}" style="padding: 3px 6px; font-size: 0.82rem; text-align: center; font-weight: 700;">
          </div>
        </div>
      `;
    }

    // Uncertainty color
    let sigmaBadgeColor = "#16A34A"; // Low
    if (sigma > 2.5) sigmaBadgeColor = "#DC2626"; // High
    else if (sigma > 1.2) sigmaBadgeColor = "#D97706"; // Medium

    html += renderEstimateRowHtml({ aid, act, wpName, tech, inputsHtml, te, sigma, varVal, isCrit, pathBadge, sigmaBadgeColor });
  });

  html += `</tbody></table></div>`;
  estimateTableContainer.innerHTML = html;

  // Attach row events
  bindEstimateTableEvents();
}

// ==========================================
// ROW EVENT LISTENERS & LIVE RECALCULATION
// ==========================================
/**
 * Binds live input recalculation listeners across duration estimation fields.
 */
export function bindEstimateTableEvents() {
  const project = pmState.project || {};
  const activities = project.activities || [];
  const estimateTableContainer = document.getElementById("estimate-table-container");
  const estimateSaveStatus = document.getElementById("estimate-save-status");
  const btnSaveDurationEstimates = document.getElementById("btn-save-duration-estimates");

  if (!estimateTableContainer) return;

  // Technique Selector change
  estimateTableContainer.querySelectorAll(".pert-select-tech").forEach(sel => {
    sel.addEventListener("change", () => {
      const aid = sel.getAttribute("data-id");
      const act = activities.find(a => a.activity_id === aid);
      if (!act) return;

      const newTech = sel.value;
      act.estimation_technique = newTech;

      if (newTech === "milestone") {
        act.is_milestone = true;
        act.duration = 0.0;
        act.expected_time = 0.0;
        act.optimistic = 0.0;
        act.most_likely = 0.0;
        act.pessimistic = 0.0;
        act.std_dev = 0.0;
        act.variance = 0.0;
      } else {
        act.is_milestone = false;
        if (act.duration === 0.0 || !act.most_likely) {
          act.optimistic = 3.0;
          act.most_likely = 5.0;
          act.pessimistic = 9.0;
          act.duration = 5.0;
          act.expected_time = 5.0;
          act.std_dev = 1.0;
          act.variance = 1.0;
        }
      }

      hasUnsavedEstimates = true;
      if (estimateSaveStatus) {
        estimateSaveStatus.textContent = "Unsaved Changes";
        estimateSaveStatus.className = "badge badge-amber";
        estimateSaveStatus.style.display = "inline-block";
      }

      if (newTech === "analogous" && !act.analogous_activity_id) {
        renderEstimateTable();
        updatePertSimulator();
        openAnalogousPicker(aid);
        return;
      }
      renderEstimateTable();
      updatePertSimulator();
    });
  });

  // Analogous Benchmark Pickers
  estimateTableContainer.querySelectorAll(".btn-open-analogous-picker").forEach(btn => {
    btn.addEventListener("click", () => {
      const aid = btn.getAttribute("data-id");
      if (aid) openAnalogousPicker(aid);
    });
  });

  // Helper to carefully parse numeric input with both dot and comma support
  const parsePertNum = (str, fallback) => {
    if (str === null || str === undefined) return fallback;
    const s = String(str).replace(",", ".").trim();
    if (s === "") return fallback;
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
  };

  // Helper to recalculate a single row
  /**
   * Recalculates expected duration and risk standard deviation for a modified table row.
   */
  function updateRowValues(aid) {
    const act = (project.activities || []).find(a => a.activity_id === aid);
    const row = estimateTableContainer.querySelector(`tr[data-row-id="${aid}"]`);
    if (!act || !row) return;

    const techSel = row.querySelector(".pert-select-tech");
    const tech = (techSel ? techSel.value : (act.estimation_technique || "three_point")).toLowerCase();

    if (tech === "milestone" || act.is_milestone) {
      row.classList.remove("row-invalid-estimate");
      delete act.has_validation_error;
      return;
    }
    const inA = row.querySelector(".pert-input-a"), inM = row.querySelector(".pert-input-m"), inB = row.querySelector(".pert-input-b");
    const inRate = row.querySelector(".pert-input-prate"), inQty = row.querySelector(".pert-input-pqty");

    const a = inA ? parsePertNum(inA.value, act.optimistic || 1.0) : (act.optimistic || 1.0);
    const m = inM ? parsePertNum(inM.value, act.most_likely || 2.0) : (act.most_likely || 2.0);
    const b = inB ? parsePertNum(inB.value, act.pessimistic || 3.0) : (act.pessimistic || 3.0);

    // Strict Ordering Check: Opt (a) < Likely (m) < Pess (b)
    if (tech === "three_point") {
      const errDiv = row.querySelector(`.pert-err-msg-${aid}`);
      const isValid = (a > 0 && a < m && m < b);

      if (!isValid) {
        row.classList.add("row-invalid-estimate");
        const setInpErr = (inp, cond) => { if (inp) { inp.style.borderColor = cond ? "#EF4444" : ""; inp.style.background = cond ? "#FEF2F2" : ""; } };
        setInpErr(inA, a <= 0 || a >= m);
        setInpErr(inM, m <= a || m >= b);
        setInpErr(inB, b <= m);

        const reason = a <= 0 ? "Optimistic (a) must be strictly positive (> 0)"
          : (a >= m && m >= b) ? `Opt (a=${a}) ≥ Likely (m=${m}) ≥ Pess (b=${b})`
          : (a >= m) ? `Opt (a=${a}) must be strictly less than Likely (m=${m})`
          : `Likely (m=${m}) must be strictly less than Pess (b=${b})`;

        if (errDiv) { errDiv.innerHTML = `⚠️ <strong>Violation:</strong> ${reason}`; errDiv.style.display = "block"; }
        const teCell = row.querySelector(`.cell-te-${aid}`);
        if (teCell) teCell.innerHTML = `<span style="color: #DC2626;" title="${reason}">⚠️ Error</span>`;
        const sigmaCell = row.querySelector(`.cell-sigma-${aid}`);
        if (sigmaCell) sigmaCell.innerHTML = `<span style="color: #DC2626; font-size: 0.72rem; font-weight: 700;">Invalid a &lt; m &lt; b</span>`;
        const varCell = row.querySelector(`.cell-var-${aid}`);
        if (varCell) varCell.textContent = `—`;

        act.optimistic = a; act.most_likely = m; act.pessimistic = b;
        act.has_validation_error = true;
        if (estimateSaveStatus) {
          estimateSaveStatus.textContent = "Fix Validation Errors";
          estimateSaveStatus.className = "badge badge-rose";
          estimateSaveStatus.style.display = "inline-block";
        }
        if (btnSaveDurationEstimates) btnSaveDurationEstimates.disabled = true;
        return;
      }

      row.classList.remove("row-invalid-estimate");
      [inA, inM, inB].forEach(inp => { if (inp) { inp.style.borderColor = ""; inp.style.background = ""; } });
      if (errDiv) errDiv.style.display = "none";
      delete act.has_validation_error;
      applyActivityDurationCalc(act, "three_point", { a, m, b });
    } else if (tech === "parametric") {
      applyActivityDurationCalc(act, "parametric", {
        rate: inRate ? parsePertNum(inRate.value, 0.8) : 0.8,
        qty: inQty ? parsePertNum(inQty.value, m) : m
      });
    } else if (tech === "analogous") {
      applyActivityDurationCalc(act, "analogous", { dur: act.analogous_actual_duration || act.duration || 75.0 });
    } else {
      applyActivityDurationCalc(act, "single", { dur: inM ? parsePertNum(inM.value, 35.0) : (act.duration || 35.0) });
    }

    // Update row cell displays
    const teCell = row.querySelector(`.cell-te-${aid}`);
    if (teCell) teCell.textContent = (act.duration || 0).toFixed(1);
    const sigmaCell = row.querySelector(`.cell-sigma-${aid}`);
    if (sigmaCell) sigmaCell.textContent = `± ${(act.std_dev || 0).toFixed(1)}d`;
    const varCell = row.querySelector(`.cell-var-${aid}`);
    if (varCell) varCell.textContent = `σ²: ${(act.variance || 0).toFixed(2)}`;

    const hasAnyInvalid = estimateTableContainer.querySelector(".row-invalid-estimate") !== null;
    if (btnSaveDurationEstimates) btnSaveDurationEstimates.disabled = hasAnyInvalid;
    if (estimateSaveStatus) {
      estimateSaveStatus.textContent = hasAnyInvalid ? "Fix Validation Errors" : "Unsaved Changes";
      estimateSaveStatus.className = `badge ${hasAnyInvalid ? "badge-rose" : "badge-amber"}`;
      estimateSaveStatus.style.display = "inline-block";
    }
    if (!hasAnyInvalid) hasUnsavedEstimates = true;

    // Recompute CPM client-side and update top banner live!
    pertEngineState.activePertAnalysis = computePertScheduleClient(project.activities || [], project.dependencies || []);
    updatePertSimulator();
  }

  // Attach direct listeners on every input
  estimateTableContainer.querySelectorAll("input").forEach(inp => {
    ["input", "change", "blur", "keyup"].forEach(evt => {
      inp.addEventListener(evt, () => {
        const aid = inp.getAttribute("data-id");
        if (aid) updateRowValues(aid);
      });
    });
  });

  // Delegated container listener to guarantee capturing all edits
  estimateTableContainer.oninput = (e) => {
    const inp = e.target.closest("input");
    if (inp && inp.getAttribute("data-id")) {
      updateRowValues(inp.getAttribute("data-id"));
    }
  };
  estimateTableContainer.onchange = (e) => {
    const inp = e.target.closest("input");
    if (inp && inp.getAttribute("data-id")) {
      updateRowValues(inp.getAttribute("data-id"));
    }
  };
}

// ==========================================
// DOM SYNCHRONIZATION
// ==========================================
/**
 * Scans all rendered estimation table rows and synchronizes live user inputs into project.activities.
 */
export function syncAllEstimateInputsFromDom() {
  const project = pmState.project || {};
  const estimateTableContainer = document.getElementById("estimate-table-container");
  if (!estimateTableContainer) return;

  const rows = estimateTableContainer.querySelectorAll("tr[data-row-id]");
  const parseNum = (str, fallback) => {
    if (str === null || str === undefined) return fallback;
    const s = String(str).replace(",", ".").trim();
    if (s === "") return fallback;
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
  };

  rows.forEach(row => {
    const aid = row.getAttribute("data-row-id");
    const act = (project.activities || []).find(a => a.activity_id === aid);
    if (!act) return;

    const techSel = row.querySelector(".pert-select-tech");
    const tech = (techSel ? techSel.value : (act.is_milestone ? "milestone" : (act.estimation_technique || "three_point"))).toLowerCase();
    act.estimation_technique = tech;

    if (tech === "milestone" || act.is_milestone) {
      act.is_milestone = true;
      act.estimation_technique = "milestone";
      act.optimistic = 0.0;
      act.most_likely = 0.0;
      act.pessimistic = 0.0;
      act.duration = 0.0;
      act.expected_time = 0.0;
      act.std_dev = 0.0;
      act.variance = 0.0;
      return;
    }
    act.is_milestone = false;

    const inA = row.querySelector(".pert-input-a");
    const inM = row.querySelector(".pert-input-m");
    const inB = row.querySelector(".pert-input-b");
    const inRate = row.querySelector(".pert-input-prate");
    const inQty = row.querySelector(".pert-input-pqty");

    if (tech === "three_point") {
      const a = inA ? parseNum(inA.value, act.optimistic || 1.0) : (act.optimistic || 1.0);
      const m = inM ? parseNum(inM.value, act.most_likely || 2.0) : (act.most_likely || 2.0);
      const b = inB ? parseNum(inB.value, act.pessimistic || 3.0) : (act.pessimistic || 3.0);
      applyActivityDurationCalc(act, "three_point", { a, m, b });
    } else if (tech === "parametric") {
      const rate = inRate ? parseNum(inRate.value, act.parametric_rate || 0.8) : (act.parametric_rate || 0.8);
      const qty = inQty ? parseNum(inQty.value, act.parametric_quantity || 1.0) : (act.parametric_quantity || 1.0);
      applyActivityDurationCalc(act, "parametric", { rate, qty });
    } else if (tech === "analogous") {
      const dur = parseNum(act.analogous_actual_duration, act.duration || 10.0);
      applyActivityDurationCalc(act, "analogous", { dur });
    } else {
      const dur = inM ? parseNum(inM.value, act.most_likely || act.duration || 5.0) : (act.duration || 5.0);
      applyActivityDurationCalc(act, "single", { dur });
    }
  });
}

// ==========================================
// SEED PERT DEFAULTS
// ==========================================
export function handleSeedPertDefaults() {
  if (!confirm("Reset all activity duration estimates to the standard realistic PERT baseline (4-Year Lifecycle)?")) return;

  const project = pmState.project || {};
  const estimateSaveStatus = document.getElementById("estimate-save-status");

  (project.activities || []).forEach(act => {
    const cfg = STANDARD_PERT_BASELINE[act.activity_id] || { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" };
    const tech = cfg.tech || "three_point";
    applyActivityDurationCalc(act, tech, {
      a: cfg.opt, m: cfg.likely, b: cfg.pess,
      rate: cfg.p_rate || 0.8, qty: cfg.p_qty || cfg.likely,
      dur: cfg.duration || cfg.likely || 75.0
    });
    if (tech === "analogous") {
      Object.assign(act, {
        analogous_project_id: cfg.analogous_project_id,
        analogous_project_name: cfg.analogous_project_name,
        analogous_activity_id: cfg.analogous_activity_id,
        analogous_activity_name: cfg.analogous_activity_name,
        analogous_actual_duration: cfg.analogous_actual_duration || act.duration,
        analogous_controller_name: cfg.analogous_controller_name,
        analogous_approval_date: cfg.analogous_approval_date,
        analogous_source: cfg.analogous_project_name ? `${cfg.analogous_project_name}: ${cfg.analogous_activity_name}` : null
      });
    }
  });

  hasUnsavedEstimates = true;
  if (estimateSaveStatus) {
    estimateSaveStatus.textContent = "Unsaved Changes";
    estimateSaveStatus.className = "badge badge-amber";
    estimateSaveStatus.style.display = "inline-block";
  }
  renderEstimateView();
}

// ==========================================
// SAVE DURATION ESTIMATES
// ==========================================
export async function handleSaveDurationEstimates() {
  const estimateAlertMsg = document.getElementById("estimate-alert-msg");
  const estimateSaveStatus = document.getElementById("estimate-save-status");
  const btnSaveDurationEstimates = document.getElementById("btn-save-duration-estimates");

  if (estimateAlertMsg) estimateAlertMsg.style.display = "none";

  // 1. Force synchronize all live DOM input table values into project.activities
  syncAllEstimateInputsFromDom();

  const project = pmState.project || {};

  // 2. Strict Pre-save Check: Opt (a) < Likely (m) < Pess (b)
  const invalidList = [];
  (project.activities || []).forEach(act => {
    if (act.is_milestone || act.estimation_technique === "milestone") return;
    const tech = (act.estimation_technique || "three_point").toLowerCase();
    if (tech === "three_point") {
      const a = parseFloat(act.optimistic);
      const m = parseFloat(act.most_likely);
      const b = parseFloat(act.pessimistic);
      if (isNaN(a) || isNaN(m) || isNaN(b) || a <= 0 || a >= m || m >= b) {
        invalidList.push({ id: act.activity_id, name: act.name, a, m, b });
      }
    }
  });

  if (invalidList.length > 0) {
    if (estimateAlertMsg) {
      estimateAlertMsg.className = "alert alert-danger";
      const details = invalidList.map(item => `<li><strong>${item.id}</strong> (${item.name}): Opt (a=${item.a}) &lt; Likely (m=${item.m}) &lt; Pess (b=${item.b}) violated</li>`).join("");
      estimateAlertMsg.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 4px;">⛔ Cannot save duration estimates: Invalid Three-Point values detected!</div>
        <div style="font-size: 0.85rem; margin-bottom: 6px;">The PMBOK Three-Point (Beta) distribution strictly requires <code>Opt (a) &lt; Likely (m) &lt; Pess (b)</code>. Please correct the highlighted entries:</div>
        <ul style="margin: 0; padding-left: 1.2rem; font-size: 0.82rem;">${details}</ul>
      `;
      estimateAlertMsg.style.display = "block";
    }
    if (estimateSaveStatus) {
      estimateSaveStatus.textContent = "Fix Validation Errors";
      estimateSaveStatus.className = "badge badge-rose";
    }
    return;
  }

  if (btnSaveDurationEstimates) {
    btnSaveDurationEstimates.disabled = true;
    btnSaveDurationEstimates.innerHTML = `⏳ Saving...`;
  }

  try {
    const currentPid = pmState.projectId || (project.id || project._id);
    const res = await updateProjectActivities(currentPid, project.activities || []);
    if (res.error) {
      if (estimateAlertMsg) {
        estimateAlertMsg.className = "alert alert-danger";
        estimateAlertMsg.textContent = `Failed to save duration estimates: ${res.error}`;
        estimateAlertMsg.style.display = "block";
      }
    } else {
      pmState.project = res.data;
      hasUnsavedEstimates = false;
      if (estimateSaveStatus) {
        estimateSaveStatus.textContent = "Saved";
        estimateSaveStatus.className = "badge badge-emerald";
        estimateSaveStatus.style.display = "inline-block";
      }
      if (estimateAlertMsg) {
        estimateAlertMsg.className = "alert alert-success";
        estimateAlertMsg.textContent = "✓ Activity duration estimates saved successfully to database!";
        estimateAlertMsg.style.display = "block";
        setTimeout(() => {
          estimateAlertMsg.style.display = "none";
        }, 3000);
      }
      renderEstimateView();
    }
  } catch (err) {
    if (estimateAlertMsg) {
      estimateAlertMsg.className = "alert alert-danger";
      estimateAlertMsg.textContent = `Error: ${err.message}`;
      estimateAlertMsg.style.display = "block";
    }
  } finally {
    if (btnSaveDurationEstimates) {
      btnSaveDurationEstimates.disabled = false;
      btnSaveDurationEstimates.innerHTML = `💾 Save Duration Estimates`;
    }
  }
}

// ==========================================
// MAIN VIEW RENDER DISPATCHER
// ==========================================
/**
 * Main render dispatcher for Section 4 (Estimate Activity Durations).
 */
export function renderEstimateView() {
  const project = pmState.project || {};
  const activities = project.activities || [];
  const dependencies = project.dependencies || [];

  // Ensure activities have baseline estimates if missing
  activities.forEach(act => {
    if (act.duration === undefined || act.optimistic === undefined) {
      if (act.is_milestone || act.estimation_technique === "milestone") {
        act.is_milestone = true;
        act.estimation_technique = "milestone";
        act.optimistic = 0.0;
        act.most_likely = 0.0;
        act.pessimistic = 0.0;
        act.duration = 0.0;
        act.expected_time = 0.0;
        act.std_dev = 0.0;
        act.variance = 0.0;
      } else {
        const cfg = STANDARD_PERT_BASELINE[act.activity_id] || { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" };
        act.estimation_technique = cfg.tech || "three_point";
        act.optimistic = cfg.opt;
        act.most_likely = cfg.likely;
        act.pessimistic = cfg.pess;

        if (act.estimation_technique === "three_point") {
          act.duration = parseFloat(((cfg.opt + 4.0 * cfg.likely + cfg.pess) / 6.0).toFixed(2));
          act.expected_time = act.duration;
          act.std_dev = parseFloat(((cfg.pess - cfg.opt) / 6.0).toFixed(3));
          act.variance = parseFloat((act.std_dev * act.std_dev).toFixed(4));
        } else if (act.estimation_technique === "parametric") {
          act.parametric_rate = cfg.p_rate || 0.8;
          act.parametric_quantity = cfg.p_qty || cfg.likely;
          act.duration = parseFloat((act.parametric_rate * act.parametric_quantity).toFixed(2));
          act.expected_time = act.duration;
          act.std_dev = parseFloat((act.duration * 0.1).toFixed(3));
          act.variance = parseFloat((act.std_dev * act.std_dev).toFixed(4));
        } else if (act.estimation_technique === "analogous") {
          act.duration = cfg.duration || cfg.likely || 75.0;
          act.expected_time = act.duration;
          act.std_dev = parseFloat((act.duration * 0.15).toFixed(3));
          act.variance = parseFloat((act.std_dev * act.std_dev).toFixed(4));
          act.analogous_project_id = cfg.analogous_project_id;
          act.analogous_project_name = cfg.analogous_project_name;
          act.analogous_activity_id = cfg.analogous_activity_id;
          act.analogous_activity_name = cfg.analogous_activity_name;
          act.analogous_actual_duration = cfg.analogous_actual_duration || act.duration;
          act.analogous_controller_name = cfg.analogous_controller_name;
          act.analogous_approval_date = cfg.analogous_approval_date;
          act.analogous_source = cfg.analogous_project_name ? `${cfg.analogous_project_name}: ${cfg.analogous_activity_name}` : null;
        } else {
          act.duration = cfg.likely;
          act.expected_time = act.duration;
          act.std_dev = 0;
          act.variance = 0;
        }
      }
    }
  });

  // 1. Compute CPM and PERT path
  pertEngineState.activePertAnalysis = computePertScheduleClient(activities, dependencies);

  // 2. Adjust slider range based on mu and sigma
  const mu = pertEngineState.activePertAnalysis.mu;
  const std = pertEngineState.activePertAnalysis.stdPath;
  const minD = Math.max(10, Math.floor(mu - 3.5 * std));
  const maxD = Math.ceil(mu + 4.0 * std);

  const pertTargetSlider = document.getElementById("pert-target-slider");
  if (pertTargetSlider) {
    pertTargetSlider.min = minD;
    pertTargetSlider.max = maxD;
    pertTargetSlider.step = 0.5;
  }

  if (pertEngineState.currentTargetD === null || pertEngineState.currentTargetD < minD || pertEngineState.currentTargetD > maxD) {
    pertEngineState.currentTargetD = mu;
  }

  // 3. Update simulator UI
  updatePertSimulator(pertEngineState.currentTargetD);

  // Auto-correct any legacy values that violate strict a < m < b
  activities.forEach(act => {
    if (act.is_milestone || act.estimation_technique === "milestone") return;
    const tech = (act.estimation_technique || "three_point").toLowerCase();
    if (tech === "three_point") {
      let a = parseFloat(act.optimistic);
      let m = parseFloat(act.most_likely);
      let b = parseFloat(act.pessimistic);
      if (!isNaN(a) && !isNaN(m) && !isNaN(b)) {
        let adjusted = false;
        if (a <= 0) { a = 1.0; adjusted = true; }
        if (m <= a) { m = round(a + Math.max(1.0, a * 0.3), 1); adjusted = true; }
        if (b <= m) { b = round(m + Math.max(1.5, m * 0.4), 1); adjusted = true; }
        if (adjusted) {
          act.optimistic = a;
          act.most_likely = m;
          act.pessimistic = b;
          act.duration = act.expected_time = round((a + 4.0 * m + b) / 6.0, 2);
          act.std_dev = round((b - a) / 6.0, 3);
          act.variance = round(act.std_dev * act.std_dev, 4);
        }
      }
    }
  });

  // 4. Render Table
  renderEstimateTable();
}

// ==========================================
// INITIALIZATION
// ==========================================
export function initEstimateView() {
  initPertEngineListeners();

  pertEngineState.onBenchmarkAppliedCallback = (aid) => {
    hasUnsavedEstimates = true;
    renderEstimateTable();
    updatePertSimulator();
  };

  const estimateSearchInput = document.getElementById("estimate-search-input");
  const estimateWpFilter = document.getElementById("estimate-wp-filter");
  const estimateTechFilter = document.getElementById("estimate-tech-filter");
  const estimateCpOnlyFilter = document.getElementById("estimate-cp-only-filter");
  const btnSeedPertDefaults = document.getElementById("btn-seed-pert-defaults");
  const btnSaveDurationEstimates = document.getElementById("btn-save-duration-estimates");

  if (estimateSearchInput) estimateSearchInput.addEventListener("input", renderEstimateTable);
  if (estimateWpFilter) estimateWpFilter.addEventListener("change", renderEstimateTable);
  if (estimateTechFilter) estimateTechFilter.addEventListener("change", renderEstimateTable);
  if (estimateCpOnlyFilter) estimateCpOnlyFilter.addEventListener("change", renderEstimateTable);

  if (btnSeedPertDefaults) btnSeedPertDefaults.addEventListener("click", handleSeedPertDefaults);
  if (btnSaveDurationEstimates) btnSaveDurationEstimates.addEventListener("click", handleSaveDurationEstimates);
}
