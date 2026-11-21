/**
 * SyncFlow Frontend - PM Workspace View 4: PERT Beta Engine & Duration Simulator
 * PMBOK Process 6.4: Estimate Activity Durations.
 * High-speed client CPM/PERT engine, Abramowitz-Stegun normal CDF,
 * top-banner simulator controls, analogous historical benchmark picker modal,
 * and realistic baseline configurations.
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import { fetchCompletedActivities } from "./api.js";
import { pmState } from "./pm_workspace_state.js";
import { round } from "./utility.js";

// ==========================================
// SHARED STATE & ENGINE CACHE
// ==========================================
export const pertEngineState = {
  activePertAnalysis: null,
  currentTargetD: null,
  activePertPreset: null,
  completedActivitiesCache: null,
  currentAnalogousTargetAid: null,
  onBenchmarkAppliedCallback: null
};

// ==========================================
// STANDARD REALISTIC PERT BASELINE (4-Year Lifecycle > 1,461 Days)
// ==========================================
export const STANDARD_PERT_BASELINE = {
  // 1. Pre-production (~310 days)
  "ACT-1.1.1": { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" },
  "ACT-1.1.2": { opt: 30.0, likely: 50.0, pess: 80.0, tech: "three_point" },
  "ACT-1.1.3": { opt: 25.0, likely: 45.0, pess: 75.0, tech: "three_point" },
  "ACT-1.2.1": { opt: 45.0, likely: 75.0, pess: 120.0, tech: "three_point" },
  "ACT-1.2.2": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
  "ACT-1.3.1": { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" },
  "ACT-1.3.2": { opt: 30.0, likely: 50.0, pess: 85.0, tech: "three_point" },
  "ACT-1.4.1": { opt: 15.0, likely: 30.0, pess: 50.0, tech: "three_point" },
  "ACT-1.4.2": { opt: 10.0, likely: 15.0, pess: 30.0, tech: "three_point" },

  // 2. Production (~550 days)
  "ACT-2.1.1": { opt: 110.0, likely: 180.0, pess: 280.0, tech: "three_point" },
  "ACT-2.1.2": { opt: 80.0, likely: 130.0, pess: 200.0, tech: "three_point" },
  "ACT-2.2.1": { opt: 90.0, likely: 150.0, pess: 240.0, tech: "three_point" },
  "ACT-2.2.2": { opt: 75.0, likely: 124.0, pess: 190.0, tech: "parametric", p_rate: 0.8, p_qty: 155.0 },
  "ACT-2.3.1": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
  "ACT-2.3.2": { opt: 50.0, likely: 80.0, pess: 130.0, tech: "three_point" },
  "ACT-2.4.1": { opt: 40.0, likely: 65.0, pess: 110.0, tech: "three_point" },
  "ACT-2.4.2": { opt: 30.0, likely: 50.0, pess: 85.0, tech: "three_point" },

  // 3. Alpha (~160 days)
  "ACT-3.1.1": { opt: 30.0, likely: 50.0, pess: 80.0, tech: "three_point" },
  "ACT-3.1.2": { opt: 15.0, likely: 25.0, pess: 45.0, tech: "three_point" },
  "ACT-3.2.1": { opt: 20.0, likely: 35.0, pess: 60.0, tech: "three_point" },
  "ACT-3.2.2": { opt: 25.0, likely: 45.0, pess: 75.0, tech: "three_point" },

  // 4. Beta (~280 days)
  "ACT-4.1.1": {
    opt: 45.0, likely: 75.0, pess: 120.0, tech: "analogous", duration: 75.0,
    analogous_project_id: "6acf99990001aaaaaaaa0001",
    analogous_project_name: "Legacy Fantasy RPG: Realms of Aethelgard",
    analogous_activity_id: "PAST-ACT-105",
    analogous_activity_name: "Multi-Language Text & Voice Localization Integration",
    analogous_actual_duration: 75.0,
    analogous_controller_name: "Sarah Williams (Controller)",
    analogous_approval_date: "2023-06-18"
  },
  "ACT-4.1.2": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
  "ACT-4.2.1": { opt: 40.0, likely: 70.0, pess: 110.0, tech: "three_point" },
  "ACT-4.2.2": { opt: 30.0, likely: 50.0, pess: 85.0, tech: "three_point" },

  // 5. Gold (~135 days)
  "ACT-5.1.1": { opt: 25.0, likely: 40.0, pess: 70.0, tech: "three_point" },
  "ACT-5.1.2": { opt: 15.0, likely: 25.0, pess: 40.0, tech: "three_point" },
  "ACT-5.2.1": {
    opt: 50.0, likely: 80.0, pess: 130.0, tech: "analogous", duration: 80.0,
    analogous_project_id: "6acf99990001aaaaaaaa0001",
    analogous_project_name: "Legacy Fantasy RPG: Realms of Aethelgard",
    analogous_activity_id: "PAST-ACT-106",
    analogous_activity_name: "First-Party Console Compliance Certification (TRC & XR)",
    analogous_actual_duration: 80.0,
    analogous_controller_name: "Sarah Williams (Controller)",
    analogous_approval_date: "2024-01-22"
  },
  "ACT-5.2.2": { opt: 30.0, likely: 50.0, pess: 90.0, tech: "three_point" },

  // 6. Launch (~70 days)
  "ACT-6.1.1": { opt: 15.0, likely: 25.0, pess: 45.0, tech: "three_point" },
  "ACT-6.1.2": { opt: 10.0, likely: 15.0, pess: 30.0, tech: "three_point" },
  "ACT-6.2.1": { opt: 5.0, likely: 8.0, pess: 15.0, tech: "three_point" },
  "ACT-6.2.2": { opt: 25.0, likely: 40.0, pess: 65.0, tech: "three_point" },

  // 7. Management and Control
  "ACT-7.1.1": { opt: 120.0, likely: 200.0, pess: 320.0, tech: "three_point" },
  "ACT-7.1.2": { opt: 80.0, likely: 140.0, pess: 220.0, tech: "three_point" },
  "ACT-7.2.1": { opt: 60.0, likely: 100.0, pess: 160.0, tech: "three_point" },
  "ACT-7.2.2": { opt: 50.0, likely: 80.0, pess: 130.0, tech: "three_point" },
  "ACT-7.3.1": { opt: 35.0, likely: 60.0, pess: 95.0, tech: "three_point" },
  "ACT-7.3.2": { opt: 25.0, likely: 45.0, pess: 75.0, tech: "three_point" },
  "ACT-7.4.1": { opt: 40.0, likely: 65.0, pess: 110.0, tech: "three_point" },
  "ACT-7.4.2": { opt: 35.0, likely: 55.0, pess: 90.0, tech: "three_point" }
};

// ==========================================
// MATHEMATICAL FUNCTIONS (ERF & NORMAL CDF)
// ==========================================

// Abramowitz & Stegun 7.1.26 erf approximation for PERT probability
export function erf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

// Standard Normal Cumulative Distribution Function
/**
 * Evaluates standard normal cumulative distribution function for Z-score.
 */
export function normalCdf(z) {
  return 0.5 * (1.0 + erf(z / Math.SQRT2));
}

// ==========================================
// DURATION CALCULATION HELPER
// ==========================================
/**
 * Calculates Te and variance for an activity based on chosen estimation technique.
 */
export function applyActivityDurationCalc(act, tech, { a, m, b, rate, qty, dur } = {}) {
  act.estimation_technique = tech;
  let te = 0, sigma = 0;
  if (tech === "milestone") {
    act.is_milestone = true;
    act.optimistic = 0.0; act.most_likely = 0.0; act.pessimistic = 0.0;
    te = 0.0;
    sigma = 0.0;
  } else {
    act.is_milestone = false;
    if (tech === "three_point") {
      act.optimistic = a; act.most_likely = m; act.pessimistic = b;
      te = round((a + 4 * m + b) / 6, 2);
      sigma = round((b - a) / 6, 3);
    } else if (tech === "parametric") {
      act.parametric_rate = rate; act.parametric_quantity = qty;
      te = round(rate * qty, 2);
      sigma = round(te * 0.1, 3);
    } else if (tech === "analogous") {
      te = dur || act.duration || 75.0;
      sigma = round(te * 0.15, 3);
    } else {
      te = m !== undefined ? m : (dur !== undefined ? dur : (act.duration || 35.0));
      sigma = 0;
    }
  }
  act.duration = act.expected_time = te;
  act.std_dev = sigma;
  act.variance = round(sigma * sigma, 4);
}

// ==========================================
// HIGH-SPEED CLIENT CPM & PERT ENGINE
// ==========================================
/**
 * Client-side CPM/PERT schedule engine computing ES, EF, LS, LF, and critical path.
 */
export function computePertScheduleClient(activities, dependencies) {
  const actMap = {};
  (activities || []).forEach(a => {
    if (a.activity_id) actMap[a.activity_id] = a;
  });
  const actIds = Object.keys(actMap);
  if (actIds.length === 0) {
    return {
      criticalPathIds: [],
      mu: 0,
      varPath: 0,
      stdPath: 0,
      confidenceLevels: { 50: 0, 80: 0, 90: 0, 95: 0, 99: 0 },
      schedule: {}
    };
  }

  const preds = {};
  const succs = {};
  actIds.forEach(id => { preds[id] = []; succs[id] = []; });

  (dependencies || []).forEach(dep => {
    const u = (dep.from_activity_id || dep.from || "").trim();
    const v = (dep.to_activity_id || dep.to || "").trim();
    let rawType = (dep.type || "FS").trim().toUpperCase();
    if (rawType.includes("(") && rawType.includes(")")) {
      rawType = rawType.split("(")[1].replace(")", "").trim();
    }
    const lag = parseFloat(dep.lag_days || 0.0);

    if (actMap[u] && actMap[v] && u !== v) {
      succs[u].push({ to: v, type: rawType, lag });
      preds[v].push({ from: u, type: rawType, lag });
    }
  });

  // Topological Sort
  const inDegree = {};
  actIds.forEach(id => { inDegree[id] = preds[id].length; });
  const queue = actIds.filter(id => inDegree[id] === 0);
  const topOrder = [];

  while (queue.length > 0) {
    const curr = queue.shift();
    topOrder.push(curr);
    succs[curr].forEach(edge => {
      inDegree[edge.to]--;
      if (inDegree[edge.to] === 0) {
        queue.push(edge.to);
      }
    });
  }

  actIds.forEach(id => {
    if (!topOrder.includes(id)) topOrder.push(id);
  });

  // Forward Pass
  const es = {}, ef = {};
  actIds.forEach(id => { es[id] = ef[id] = 0.0; });

  topOrder.forEach(u => {
    const d_val = actMap[u].duration !== undefined && actMap[u].duration !== null ? actMap[u].duration : (actMap[u].expected_time !== undefined && actMap[u].expected_time !== null ? actMap[u].expected_time : 5.0);
    const d_u = (actMap[u].is_milestone || actMap[u].estimation_technique === "milestone" || actMap[u].duration === 0) ? 0.0 : parseFloat(d_val);
    let maxEs = 0.0;
    preds[u].forEach(({ from: p, type: rel, lag }) => {
      const cand = rel === "SS" ? es[p] + lag
                 : rel === "FF" ? ef[p] + lag - d_u
                 : rel === "SF" ? es[p] + lag - d_u
                 : ef[p] + lag;
      if (cand > maxEs) maxEs = cand;
    });
    es[u] = Math.max(0.0, maxEs);
    ef[u] = es[u] + d_u;
  });

  const projectFinish = Math.max(0.0, ...actIds.map(id => ef[id] || 0));

  // Backward Pass
  const lf = {}, ls = {};
  actIds.forEach(id => { lf[id] = projectFinish; ls[id] = 0.0; });

  [...topOrder].reverse().forEach(u => {
    const d_val = actMap[u].duration !== undefined && actMap[u].duration !== null ? actMap[u].duration : (actMap[u].expected_time !== undefined && actMap[u].expected_time !== null ? actMap[u].expected_time : 5.0);
    const d_u = (actMap[u].is_milestone || actMap[u].estimation_technique === "milestone" || actMap[u].duration === 0) ? 0.0 : parseFloat(d_val);
    let minLf = succs[u].length > 0 ? Infinity : projectFinish;
    succs[u].forEach(({ to: s, type: rel, lag }) => {
      const cand = rel === "SS" ? ls[s] - lag + d_u
                 : rel === "FF" ? lf[s] - lag
                 : rel === "SF" ? lf[s] - lag + d_u
                 : ls[s] - lag;
      if (cand < minLf) minLf = cand;
    });
    lf[u] = Math.min(projectFinish, minLf);
    ls[u] = lf[u] - d_u;
  });

  // Float & Critical Path Identification
  const tf = {};
  let minFloat = Infinity;
  actIds.forEach(id => {
    const f = parseFloat((lf[id] - ef[id]).toFixed(2));
    tf[id] = f;
    if (f < minFloat) minFloat = f;
  });

  const criticalPathIds = actIds.filter(id => Math.abs(tf[id] - minFloat) <= 0.05);
  let mu = 0.0, varPath = 0.0;
  criticalPathIds.forEach(cid => {
    const d_cid_val = actMap[cid].duration !== undefined && actMap[cid].duration !== null ? actMap[cid].duration : (actMap[cid].expected_time !== undefined && actMap[cid].expected_time !== null ? actMap[cid].expected_time : 5.0);
    const d_cid = (actMap[cid].is_milestone || actMap[cid].estimation_technique === "milestone" || actMap[cid].duration === 0) ? 0.0 : parseFloat(d_cid_val);
    mu += d_cid;
    varPath += parseFloat(actMap[cid].variance || 0.0);
  });
  const stdPath = varPath > 0 ? Math.sqrt(varPath) : 0.0;

  const schedule = {};
  actIds.forEach(id => {
    schedule[id] = {
      es: parseFloat(es[id].toFixed(1)), ef: parseFloat(ef[id].toFixed(1)),
      ls: parseFloat(ls[id].toFixed(1)), lf: parseFloat(lf[id].toFixed(1)),
      float: tf[id], isCritical: criticalPathIds.includes(id)
    };
  });

  return {
    criticalPathIds,
    mu: parseFloat(mu.toFixed(2)),
    varPath: parseFloat(varPath.toFixed(3)),
    stdPath: parseFloat(stdPath.toFixed(2)),
    confidenceLevels: {
      50: parseFloat(mu.toFixed(1)),
      80: parseFloat((mu + 0.8416 * stdPath).toFixed(1)),
      90: parseFloat((mu + 1.2816 * stdPath).toFixed(1)),
      95: parseFloat((mu + 1.6449 * stdPath).toFixed(1)),
      99: parseFloat((mu + 2.3263 * stdPath).toFixed(1))
    },
    schedule
  };
}

// ==========================================
// TOP BANNER PERT SIMULATOR & PRESETS
// ==========================================

/**
 * Sets active confidence level preset (50%, 80%, 90%, 95%, 99%) in PERT simulator.
 */
export function setActivePertPreset(probOrNull) {
  pertEngineState.activePertPreset = probOrNull;
  const presetButtons = document.querySelectorAll(".btn-pert-preset");
  presetButtons.forEach(btn => {
    const p = parseInt(btn.getAttribute("data-prob"), 10);
    const isAct = probOrNull !== null && p === probOrNull;
    btn.classList.toggle("active", isAct);
    btn.style.background = isAct ? "rgba(56, 189, 248, 0.25)" : "rgba(255, 255, 255, 0.1)";
    btn.style.color = isAct ? "#38BDF8" : "#FFFFFF";
    btn.style.borderColor = isAct ? "rgba(56, 189, 248, 0.5)" : "rgba(255, 255, 255, 0.2)";
    btn.style.fontWeight = isAct ? "700" : "normal";
  });
}

/**
 * Simulates completion probability for target project duration using Beta distribution parameters.
 */
export function updatePertSimulator(targetD, explicitProb = undefined) {
  const analysis = pertEngineState.activePertAnalysis;
  if (!analysis) return;
  const { mu, stdPath, varPath, criticalPathIds, confidenceLevels } = analysis;

  if (targetD === undefined || targetD === null) {
    targetD = (pertEngineState.activePertPreset !== null && confidenceLevels && confidenceLevels[pertEngineState.activePertPreset] !== undefined)
      ? confidenceLevels[pertEngineState.activePertPreset]
      : (pertEngineState.currentTargetD !== null ? pertEngineState.currentTargetD : mu);
  }
  pertEngineState.currentTargetD = targetD;

  const pertMuDisplay = document.getElementById("pert-mu-display");
  const pertSigmaDisplay = document.getElementById("pert-sigma-display");
  const pertCpCount = document.getElementById("pert-cp-count");
  const pertVarDisplay = document.getElementById("pert-var-display");
  const pertProbBadge = document.getElementById("pert-prob-badge");
  const pertZBadge = document.getElementById("pert-z-badge");
  const pertTargetSlider = document.getElementById("pert-target-slider");
  const pertTargetInput = document.getElementById("pert-target-input");
  const pertNarrativeInsight = document.getElementById("pert-narrative-insight");

  const presetP50Val = document.getElementById("preset-p50-val");
  const presetP80Val = document.getElementById("preset-p80-val");
  const presetP90Val = document.getElementById("preset-p90-val");
  const presetP95Val = document.getElementById("preset-p95-val");
  const presetP99Val = document.getElementById("preset-p99-val");

  const project = pmState.project || {};
  const totalActs = (project.activities || []).length;

  if (pertMuDisplay) pertMuDisplay.textContent = `${mu.toFixed(1)} d`;
  if (pertSigmaDisplay) pertSigmaDisplay.textContent = `± ${stdPath.toFixed(1)} d (σ)`;
  if (pertCpCount) pertCpCount.textContent = `${criticalPathIds.length} / ${totalActs}`;
  if (pertVarDisplay) pertVarDisplay.textContent = `${varPath.toFixed(1)} d²`;

  const presetMap = { 50: presetP50Val, 80: presetP80Val, 90: presetP90Val, 95: presetP95Val, 99: presetP99Val };
  Object.entries(presetMap).forEach(([p, el]) => {
    if (el && confidenceLevels[p] !== undefined) el.textContent = `${confidenceLevels[p].toFixed(1)}d`;
  });

  if (explicitProb !== undefined) {
    setActivePertPreset(explicitProb);
  } else {
    const matched = [50, 80, 90, 95, 99].find(p => confidenceLevels && confidenceLevels[p] !== undefined && Math.abs(confidenceLevels[p] - targetD) < 0.15);
    setActivePertPreset(matched !== undefined ? matched : null);
  }

  const z = stdPath > 0 ? (targetD - mu) / stdPath : 0.0;
  const prob = stdPath > 0 ? normalCdf(z) : (targetD >= mu ? 1.0 : 0.0);
  const probPct = (prob * 100).toFixed(1);

  if (pertProbBadge) {
    pertProbBadge.textContent = `${probPct}%`;
    pertProbBadge.style.color = prob >= 0.90 ? "#4ADE80" : prob >= 0.75 ? "#38BDF8" : prob >= 0.50 ? "#FBBF24" : "#F87171";
  }

  const sign = z >= 0 ? "+" : "";
  if (pertZBadge) {
    pertZBadge.textContent = `Z = ${sign}${z.toFixed(2)} (${targetD >= mu ? 'Buffer' : 'Tight'})`;
  }
  if (pertTargetSlider) pertTargetSlider.value = targetD;
  if (pertTargetInput) pertTargetInput.value = targetD;

  const riskAdvisory = prob >= 0.95 ? "High assurance client-ready commitment with robust risk mitigation buffer."
    : prob >= 0.80 ? "Balanced management buffer in line with standard industry practices."
    : prob >= 0.50 ? "Even-odds estimation (50% likelihood of overrunning deadline)."
    : "Aggressive high-risk schedule with significant likelihood of delay.";

  if (pertNarrativeInsight) {
    pertNarrativeInsight.innerHTML = `
      With target <strong>D = ${targetD.toFixed(1)} days</strong> (${sign}${z.toFixed(2)} standard deviations from expected μ = ${mu.toFixed(1)}d),
      there is a <strong>${probPct}% probability</strong> of completing critical path deliverables on or before this deadline. <em>${riskAdvisory}</em>
    `;
  }
}

// ==========================================
// ANALOGOUS HISTORICAL BENCHMARK PICKER MODAL
// ==========================================

/**
 * Opens modal to search and select historical completed activities for analogous duration benchmarking.
 */
export async function openAnalogousPicker(aid, onAppliedCallback) {
  pertEngineState.currentAnalogousTargetAid = aid;
  if (onAppliedCallback) pertEngineState.onBenchmarkAppliedCallback = onAppliedCallback;

  const analogousModal = document.getElementById("analogous-modal");
  const analogousLoadingSpinner = document.getElementById("analogous-loading-spinner");
  const analogousActivitiesList = document.getElementById("analogous-activities-list");

  if (analogousModal) analogousModal.style.display = "flex";
  if (analogousLoadingSpinner) analogousLoadingSpinner.style.display = "block";
  if (analogousActivitiesList) {
    analogousActivitiesList.style.display = "none";
    analogousActivitiesList.innerHTML = "";
  }

  try {
    if (!pertEngineState.completedActivitiesCache) {
      const res = await fetchCompletedActivities();
      if (res.error) throw new Error(res.error);
      pertEngineState.completedActivitiesCache = res.data || [];
    }

    if (analogousLoadingSpinner) analogousLoadingSpinner.style.display = "none";
    if (analogousActivitiesList) analogousActivitiesList.style.display = "block";

    const completed = pertEngineState.completedActivitiesCache;
    if (!completed || completed.length === 0) {
      analogousActivitiesList.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: var(--slate);">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">📜</div>
          <p style="font-weight: 700; margin: 0; color: var(--charcoal);">No Verified Completed Activities Available</p>
          <p style="font-size: 0.85rem; color: var(--muted); margin-top: 4px;">
            Only past activities formally reviewed, verified, and signed off by a Project Controller qualify for analogous benchmarking.
          </p>
        </div>
      `;
      return;
    }

    const byProject = {};
    completed.forEach(item => {
      const pName = item.project_name || "Historical Project";
      if (!byProject[pName]) byProject[pName] = [];
      byProject[pName].push(item);
    });

    const project = pmState.project || {};
    const targetAct = (project.activities || []).find(a => a.activity_id === aid);
    const currentBenchmarkId = targetAct ? targetAct.analogous_activity_id : null;

    let listHtml = "";
    for (const [projName, acts] of Object.entries(byProject)) {
      listHtml += `
        <div style="margin-bottom: 1.5rem; background: #FFFFFF; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="background: #F1F5F9; padding: 10px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 700; color: var(--charcoal); font-size: 0.92rem;">
              📁 ${projName}
            </span>
            <span class="badge badge-emerald" style="font-size: 0.72rem; padding: 3px 8px;">
              ✓ Completed & Certified
            </span>
          </div>
          <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
      `;

      acts.forEach(act => {
        const actDur = act.actual_duration_days || 0;
        const reviewDate = act.reviewed_at ? act.reviewed_at.split('T')[0] : (act.actual_end_date || '—');
        const isSelected = currentBenchmarkId && act.activity_id === currentBenchmarkId;

        listHtml += `
          <div style="border: 1px solid ${isSelected ? '#3B82F6' : 'var(--border-light)'}; background: ${isSelected ? '#EFF6FF' : '#FAFAFA'}; border-radius: 6px; padding: 12px; display: flex; justify-content: space-between; align-items: flex-start; gap: 14px;">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <strong style="color: var(--charcoal); font-size: 0.9rem;">${act.activity_name}</strong>
                <span class="badge badge-secondary" style="font-size: 0.7rem; font-family: monospace;">${act.activity_id}</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--slate); margin-bottom: 6px; line-height: 1.35;">
                ${act.description || ''}
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.75rem; color: var(--muted); align-items: center;">
                <span>📅 Dates: <strong>${act.actual_start_date || '—'}</strong> ➔ <strong>${act.actual_end_date || '—'}</strong></span>
                <span>⏱️ Actual Duration: <strong style="color: #0F172A; font-size: 0.85rem;">${actDur} days</strong></span>
              </div>
              <div style="margin-top: 6px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 4px; padding: 4px 8px; font-size: 0.75rem; color: #15803D;">
                🛡️ <strong>Controller Review:</strong> Approved by <strong>${act.controller_name || 'Sarah Williams'}</strong> on ${reviewDate}
                ${act.sign_off_notes ? `<div style="font-style: italic; color: #166534; margin-top: 2px;">"${act.sign_off_notes}"</div>` : ''}
              </div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 140px;">
              <div style="font-size: 1.25rem; font-weight: 800; color: #1E293B; font-family: monospace;">
                ${actDur} <span style="font-size: 0.75rem; color: var(--muted); font-weight: 600;">days</span>
              </div>
              <button type="button" class="btn btn-sm ${isSelected ? 'btn-outline-primary' : 'btn-primary'} btn-pick-analogous" data-act-id="${act.activity_id}">
                ${isSelected ? '✓ Current' : '🎯 Select'}
              </button>
            </div>
          </div>
        `;
      });

      listHtml += `
          </div>
        </div>
      `;
    }

    analogousActivitiesList.innerHTML = listHtml;

    analogousActivitiesList.querySelectorAll(".btn-pick-analogous").forEach(btn => {
      btn.addEventListener("click", () => {
        const pastActId = btn.getAttribute("data-act-id");
        const selectedBenchmark = pertEngineState.completedActivitiesCache.find(x => x.activity_id === pastActId);
        if (selectedBenchmark && pertEngineState.currentAnalogousTargetAid) {
          applyAnalogousBenchmark(pertEngineState.currentAnalogousTargetAid, selectedBenchmark);
        }
      });
    });

  } catch (err) {
    if (analogousLoadingSpinner) analogousLoadingSpinner.style.display = "none";
    if (analogousActivitiesList) {
      analogousActivitiesList.style.display = "block";
      analogousActivitiesList.innerHTML = `
        <div class="alert alert-danger" style="margin: 1rem 0;">
          Failed to load completed activities: ${err.message}
        </div>
      `;
    }
  }
}

/**
 * Closes historical analogous benchmark picker modal.
 */
export function closeAnalogousModal() {
  const analogousModal = document.getElementById("analogous-modal");
  if (analogousModal) analogousModal.style.display = "none";
  pertEngineState.currentAnalogousTargetAid = null;
}

/**
 * Applies historical benchmark duration and metadata to an activity.
 */
export function applyAnalogousBenchmark(aid, benchmark) {
  const project = pmState.project || {};
  const act = (project.activities || []).find(a => a.activity_id === aid);
  if (!act) return;

  const actualDays = parseFloat(benchmark.actual_duration_days || 75.0);
  applyActivityDurationCalc(act, "analogous", { dur: actualDays });
  act.most_likely = actualDays;
  act.optimistic = round(actualDays * 0.65, 1);
  act.pessimistic = round(actualDays * 1.55, 1);
  Object.assign(act, {
    analogous_project_id: benchmark.project_id,
    analogous_project_name: benchmark.project_name,
    analogous_activity_id: benchmark.activity_id,
    analogous_activity_name: benchmark.activity_name,
    analogous_actual_duration: actualDays,
    analogous_controller_name: benchmark.controller_name,
    analogous_approval_date: benchmark.reviewed_at ? benchmark.reviewed_at.split('T')[0] : (benchmark.actual_end_date || ''),
    analogous_source: `${benchmark.project_name}: ${benchmark.activity_name}`
  });

  const estimateSaveStatus = document.getElementById("estimate-save-status");
  if (estimateSaveStatus) {
    estimateSaveStatus.textContent = "Unsaved Changes";
    estimateSaveStatus.className = "badge badge-amber";
    estimateSaveStatus.style.display = "inline-block";
  }

  closeAnalogousModal();
  if (typeof pertEngineState.onBenchmarkAppliedCallback === "function") {
    pertEngineState.onBenchmarkAppliedCallback(aid);
  }
  updatePertSimulator();
}

// ==========================================
// INITIALIZATION
// ==========================================
export function initPertEngineListeners() {
  const btnCloseAnalogousModal = document.getElementById("btn-close-analogous-modal");
  const btnCancelAnalogousModal = document.getElementById("btn-cancel-analogous-modal");
  const analogousModal = document.getElementById("analogous-modal");

  if (btnCloseAnalogousModal) btnCloseAnalogousModal.addEventListener("click", closeAnalogousModal);
  if (btnCancelAnalogousModal) btnCancelAnalogousModal.addEventListener("click", closeAnalogousModal);
  if (analogousModal) {
    analogousModal.addEventListener("click", (e) => {
      if (e.target === analogousModal) closeAnalogousModal();
    });
  }

  // Slider & Target Input listeners
  const pertTargetSlider = document.getElementById("pert-target-slider");
  const pertTargetInput = document.getElementById("pert-target-input");

  if (pertTargetSlider) {
    pertTargetSlider.addEventListener("input", () => {
      const dVal = parseFloat(pertTargetSlider.value);
      if (pertTargetInput) pertTargetInput.value = dVal;
      updatePertSimulator(dVal);
    });
  }

  if (pertTargetInput) {
    pertTargetInput.addEventListener("input", () => {
      const dVal = parseFloat(pertTargetInput.value);
      if (!isNaN(dVal)) {
        if (pertTargetSlider) pertTargetSlider.value = dVal;
        updatePertSimulator(dVal);
      }
    });
  }

  // Presets Buttons
  const presetButtons = document.querySelectorAll(".btn-pert-preset");
  presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const prob = parseInt(btn.getAttribute("data-prob"), 10);
      const analysis = pertEngineState.activePertAnalysis;
      if (analysis && analysis.confidenceLevels && analysis.confidenceLevels[prob]) {
        const targetVal = analysis.confidenceLevels[prob];
        setActivePertPreset(prob);
        updatePertSimulator(targetVal, prob);
      } else {
        setActivePertPreset(prob);
      }
    });
  });
}
