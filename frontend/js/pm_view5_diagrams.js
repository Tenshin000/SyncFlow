/**
 * SyncFlow Frontend - PM Workspace View 5: Network Diagrams, Baselines & Quality
 * PMBOK Process 6.5: Develop Schedule.
 * Activity-on-Node (AON / CPM), Activity-on-Arrow (AOA / PERT),
 * Baselines lifecycle freeze & comparison, and DCMA 14-point audit diagnostic.
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import {
  fetchBaselines,
  createBaseline,
  fetchDcmaQuality
} from "./api.js";
import { pmState } from "./pm_workspace_state.js";
import {
  renderDcmaScoreCardHtml,
  renderDcmaCardHtml
} from "./pm_workspace_templates.js";
import { showTransientAlert } from "./utility.js";

// ==========================================
// MODULE STATE
// ==========================================
export const diagramsState = {
  aonNetworkInstance: null,
  aoaNetworkInstance: null,
  projectBaselinesList: [],
  selectedBaselineData: null,
  selectedBaselineMap: {}
};

// ==========================================
// HELPER: ZOOM & LEGEND TOGGLE
// ==========================================
/**
 * Wires collapsible diagram legend toggle behavior.
 */
export function wireLegendToggle(btn, content, chevron) {
  if (!btn || !content) return;
  btn.addEventListener("click", () => {
    const isHidden = content.style.display === "none" || !content.style.display;
    content.style.display = isHidden ? "block" : "none";
    if (chevron) chevron.textContent = isHidden ? "Collapse Guide ▴" : "Expand Guide ▾";
  });
}

/**
 * Wires interactive zoom in, zoom out, and fit-view controls for vis-network graph.
 */
export function wireNetworkZoomControls(instanceFn, btnIn, btnOut, btnFit) {
  if (btnIn) btnIn.addEventListener("click", () => { const inst = instanceFn(); if (inst) inst.moveTo({ scale: inst.getScale() * 1.25, animation: true }); });
  if (btnOut) btnOut.addEventListener("click", () => { const inst = instanceFn(); if (inst) inst.moveTo({ scale: inst.getScale() * 0.8, animation: true }); });
  if (btnFit) btnFit.addEventListener("click", () => { const inst = instanceFn(); if (inst) inst.fit({ animation: true }); });
}

// ==========================================
// AON (ACTIVITY-ON-NODE CPM NETWORK)
// ==========================================
/**
 * Renders Activity-on-Node (AON) Precedence Diagram with CPM blocks and red critical path.
 */
export function renderAonNetwork(currentScheduleModel) {
  const aonNetworkCanvas = document.getElementById("aon-network-canvas");
  const schedAonFilterMode = document.getElementById("sched-aon-filter-mode");
  if (!aonNetworkCanvas || !currentScheduleModel) return;

  const filterMode = schedAonFilterMode ? schedAonFilterMode.value : "all";
  const rawNodes = (currentScheduleModel.aon_graph && currentScheduleModel.aon_graph.nodes) || [];
  const rawEdges = (currentScheduleModel.aon_graph && currentScheduleModel.aon_graph.edges) || [];

  let filteredNodes = rawNodes;
  if (filterMode === "critical") {
    filteredNodes = rawNodes.filter(n => n.is_critical);
  } else if (filterMode === "near_critical") {
    filteredNodes = rawNodes.filter(n => n.is_critical || n.is_near_critical);
  }

  const nodeIds = new Set(filteredNodes.map(n => n.id));
  const filteredEdges = rawEdges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

  const data = {
    nodes: new vis.DataSet(filteredNodes),
    edges: new vis.DataSet(filteredEdges)
  };

  const options = {
    layout: {
      hierarchical: {
        direction: "LR",
        sortMethod: "directed",
        levelSeparation: 260,
        nodeSpacing: 130,
        shakeTowards: "roots"
      }
    },
    physics: {
      hierarchicalRepulsion: {
        nodeDistance: 130,
        springLength: 100
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      zoomView: true,
      dragView: true
    }
  };

  if (diagramsState.aonNetworkInstance) {
    diagramsState.aonNetworkInstance.destroy();
  }
  diagramsState.aonNetworkInstance = new vis.Network(aonNetworkCanvas, data, options);
  aonNetworkCanvas._visNetwork = diagramsState.aonNetworkInstance;
  if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
  window.SyncFlowNetworks["aon-network-canvas"] = diagramsState.aonNetworkInstance;
}

// ==========================================
// AOA (ACTIVITY-ON-ARROW PERT NETWORK)
// ==========================================
/**
 * Renders Activity-on-Arrow (AOA / PERT) Event Network with TE/TL dates and dummy arrows.
 */
export function renderAoaNetwork(currentScheduleModel) {
  const aoaNetworkCanvas = document.getElementById("aoa-network-canvas");
  const schedAoaFilterMode = document.getElementById("sched-aoa-filter-mode");
  if (!aoaNetworkCanvas || !currentScheduleModel) return;

  const filterMode = schedAoaFilterMode ? schedAoaFilterMode.value : "all";
  const rawEvents = (currentScheduleModel.aoa_graph && currentScheduleModel.aoa_graph.events) || [];
  const rawArrows = (currentScheduleModel.aoa_graph && currentScheduleModel.aoa_graph.edges) || [];

  let filteredArrows = rawArrows;
  let filteredEvents = rawEvents;

  if (filterMode === "critical") {
    filteredArrows = rawArrows.filter(a => a.is_critical);
    const usedEventIds = new Set();
    filteredArrows.forEach(a => {
      usedEventIds.add(a.from);
      usedEventIds.add(a.to);
    });
    filteredEvents = rawEvents.filter(e => usedEventIds.has(e.id));
  }

  const data = {
    nodes: new vis.DataSet(filteredEvents),
    edges: new vis.DataSet(filteredArrows)
  };

  const options = {
    layout: {
      hierarchical: {
        direction: "LR",
        sortMethod: "directed",
        levelSeparation: 220,
        nodeSpacing: 110,
        shakeTowards: "roots"
      }
    },
    physics: {
      hierarchicalRepulsion: {
        nodeDistance: 120,
        springLength: 90
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      zoomView: true,
      dragView: true
    }
  };

  if (diagramsState.aoaNetworkInstance) {
    diagramsState.aoaNetworkInstance.destroy();
  }
  diagramsState.aoaNetworkInstance = new vis.Network(aoaNetworkCanvas, data, options);
  aoaNetworkCanvas._visNetwork = diagramsState.aoaNetworkInstance;
  if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
  window.SyncFlowNetworks["aoa-network-canvas"] = diagramsState.aoaNetworkInstance;
}

// ==========================================
// BASELINE MANAGEMENT & FREEZE
// ==========================================
/**
 * Loads Planned Baseline snapshot and renders variance comparisons against current schedule.
 */
export async function loadProjectBaselines() {
  const selectCompareBaseline = document.getElementById("select-compare-baseline");
  if (!selectCompareBaseline) return;
  const project = pmState.project;
  const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
  if (!projId) return;

  const { data: baselines, error } = await fetchBaselines(projId);
  if (!error && baselines) {
    diagramsState.projectBaselinesList = baselines;
    let optHtml = `<option value="">None (Current CPM Schedule)</option>`;
    baselines.forEach(b => {
      const dStr = b.created_at ? b.created_at.split('T')[0] : 'Frozen';
      optHtml += `<option value="${b.id || b._id}">${b.name} (${dStr})</option>`;
    });
    selectCompareBaseline.innerHTML = optHtml;
  }
}

/**
 * Initializes baseline freeze and baseline select comparison listeners.
 */
export function initBaselineControls(onGanttRefresh) {
  const selectCompareBaseline = document.getElementById("select-compare-baseline");
  const btnFreezeBaseline = document.getElementById("btn-freeze-baseline");
  const schedAlertMsg = document.getElementById("sched-alert-msg");

  if (selectCompareBaseline && !selectCompareBaseline._hasListener) {
    selectCompareBaseline._hasListener = true;
    selectCompareBaseline.addEventListener("change", () => {
      const bId = selectCompareBaseline.value;
      if (!bId) {
        diagramsState.selectedBaselineData = null;
        diagramsState.selectedBaselineMap = {};
      } else {
        const found = diagramsState.projectBaselinesList.find(b => (b.id || b._id) === bId);
        if (found) {
          diagramsState.selectedBaselineData = found.activities_snapshot || [];
          diagramsState.selectedBaselineMap = {};
          diagramsState.selectedBaselineData.forEach(a => { diagramsState.selectedBaselineMap[a.activity_id] = a; });
        }
      }
      if (typeof onGanttRefresh === "function") {
        onGanttRefresh();
      }
    });
  }

  if (btnFreezeBaseline && !btnFreezeBaseline._hasListener) {
    btnFreezeBaseline._hasListener = true;
    btnFreezeBaseline.addEventListener("click", async () => {
      const defaultName = `Baseline ${diagramsState.projectBaselinesList.length} - ${new Date().toISOString().split("T")[0]}`;
      const name = window.prompt("Enter name for this schedule baseline snapshot:", defaultName);
      if (!name) return;
      const description = window.prompt("Optional description / contract revision justification:", "Approved schedule freeze");
      const project = pmState.project;
      const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
      const user = JSON.parse(sessionStorage.getItem("user") || "{}");

      btnFreezeBaseline.disabled = true;
      btnFreezeBaseline.textContent = "⏳ Freezing...";
      const { data: created, error } = await createBaseline(projId, {
        name,
        description: description || "",
        created_by: user.id || user._id
      });
      btnFreezeBaseline.disabled = false;
      btnFreezeBaseline.textContent = "🔒 Freeze Current Baseline";

      if (error || !created) {
        showTransientAlert(schedAlertMsg, `Failed to freeze baseline: ${error || "Unknown error"}`, "danger", 4000);
        return;
      }
      showTransientAlert(schedAlertMsg, `Schedule baseline "${name}" successfully frozen and archived!`, "success", 4000);
      await loadProjectBaselines();
      if (selectCompareBaseline) {
        selectCompareBaseline.value = created.id || created._id;
        selectCompareBaseline.dispatchEvent(new Event("change"));
      }
    });
  }
}

// ==========================================
// DCMA 14-POINT AUTOMATED SCHEDULE QUALITY AUDIT
// ==========================================
/**
 * Fetches automated DCMA 14-Point Quality Assessment and renders scorecard and metric cards.
 */
export async function renderDcmaQualityAudit() {
  const dcmaContainer = document.getElementById("dcma-audit-container");
  if (!dcmaContainer) return;
  dcmaContainer.innerHTML = `<div style="text-align: center; padding: 2.5rem; color: var(--muted);"><span style="font-size: 1.5rem;">⚙️</span><br>Running DCMA 14-Point Automated Schedule Quality Diagnostic...</div>`;

  const project = pmState.project;
  const projId = (project && (project.id || project._id)) || sessionStorage.getItem("active_project_id");
  if (!projId) return;

  const { data: dcma, error } = await fetchDcmaQuality(projId);

  if (error || !dcma) {
    dcmaContainer.innerHTML = `<div class="alert-box alert-danger">Failed to execute DCMA 14-Point Diagnostic: ${error || "Unknown error"}</div>`;
    return;
  }

  const score = Number(dcma.overall_score || 0).toFixed(0);
  const grade = dcma.letter_grade || "C";
  const gradeColor = grade === "A" ? "#059669" : (grade === "B" ? "#2563EB" : (grade === "C" ? "#D97706" : "#DC2626"));
  const metrics = dcma.metrics || [];

  const passCount = metrics.filter(m => m.status === "pass").length;
  const warnCount = metrics.filter(m => m.status === "warning").length;
  const failCount = metrics.filter(m => m.status === "fail").length;

  let cardsHtml = "";
  metrics.forEach(m => {
    const statusPillClass = m.status === "pass" ? "dcma-pill-pass" : (m.status === "warning" ? "dcma-pill-warning" : "dcma-pill-fail");
    const statusLabel = m.status === "pass" ? "✓ PASS" : (m.status === "warning" ? "⚠️ WARNING" : "❌ FAIL");
    
    let culpritsHtml = "";
    if (m.culprits && m.culprits.length > 0) {
      const chips = m.culprits.map(c => {
        let label = "";
        let tooltip = "";
        if (typeof c === "object" && c !== null) {
          label = c.activity_id || c.dependency || c.name || c.error || "Issue";
          tooltip = c.name 
            ? `${c.activity_id ? c.activity_id + ': ' : ''}${c.name}${c.reason ? ' (' + c.reason + ')' : ''}${c.total_float !== undefined ? ' (Float: ' + c.total_float + 'd)' : ''}${c.duration !== undefined ? ' (Duration: ' + c.duration + 'd)' : ''}`
            : (c.dependency ? `${c.dependency}${c.lag !== undefined ? ' (Lag: ' + c.lag + 'd)' : ''}${c.type ? ' (Type: ' + c.type + ')' : ''}` : label);
        } else {
          label = String(c);
          tooltip = label;
        }
        const safeLabel = String(label).replace(/"/g, '&quot;');
        const safeTooltip = String(tooltip).replace(/"/g, '&quot;');
        return `<span style="font-size: 0.72rem; background: #FEE2E2; color: #DC2626; padding: 2px 6px; border-radius: 4px; font-weight: 700; cursor: help;" title="${safeTooltip}">${safeLabel}</span>`;
      }).join(" ");
      culpritsHtml = `
        <div style="margin-top: 8px; border-top: 1px dashed var(--border-light); padding-top: 6px;">
          <span style="font-size: 0.72rem; color: var(--muted); font-weight: 600; display: block; margin-bottom: 2px;">Culprit Activities:</span>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">${chips}</div>
        </div>
      `;
    }

    const violationsCount = m.count !== undefined ? m.count : (m.culprits ? m.culprits.length : 0);
    const ratioDisplay = m.ratio_pct !== undefined ? `${m.ratio_pct}%` : (m.value || "0%");
    const thresholdDisplay = m.threshold_pct !== undefined ? `${m.threshold_pct}%` : (m.target || "N/A");

    cardsHtml += renderDcmaCardHtml({ m, statusPillClass, statusLabel, violationsCount, ratioDisplay, thresholdDisplay, culpritsHtml });
  });

  dcmaContainer.innerHTML = renderDcmaScoreCardHtml({ score, grade, gradeColor, passCount, warnCount, failCount, cardsHtml });
}
