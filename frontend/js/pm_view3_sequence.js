/**
 * SyncFlow Frontend - PM View 3: Sequence Activities (pm_view3_sequence.js)
 * Implements:
 *  - Precedence Diagramming Method (PDM) Network Diagram
 *  - Logic dependencies list (FS, SS, FF, SF and lead/lag days)
 *  - Client-side cycle detection and schedule health evaluation engine
 *  - Schedule health diagnostic drawer and interactive resolution shortcuts
 *  - Auto-sequence generation and dependency persistence
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import { updateProjectDependencies, fetchScheduleHealth } from './api.js';
import { renderNetworkDiagram } from './visualizations.js';
import { pmState } from './pm_workspace_state.js';

// ==========================================
// MODULE REFERENCES & STATE
// ==========================================
let pdmCanvas = null, pdmDependencies = null;
let btnOpenAddDependency = null, btnSaveDependencies = null, seqAlertMsg = null, seqSaveStatus = null;
let healthStatusIndicator = null, healthQuickSummary = null, btnToggleHealthDetails = null, scheduleHealthDrawer = null, healthDiagnosticsDetails = null;
let tabBtnDiagram = null, tabBtnTable = null, seqPaneDiagram = null, seqPaneTable = null, seqDepsBadgeCount = null, diagramToolbar = null;
let btnCanvasZoomIn = null, btnCanvasZoomOut = null, btnCanvasFit = null;
let dependencyModal = null, dependencyModalTitle = null, btnCloseDependencyModal = null, btnCancelDependencyModal = null;
let dependencyForm = null, dependencyModalAlert = null, selectDepPredecessor = null, selectDepType = null;
let selectDepSuccessor = null, inputDepLag = null, inputDepDesc = null, depTypeExplanation = null, dependencyEditIndex = null;
let networkInstance = null, hasUnsavedDependencies = false, activeSeqTab = 'diagram';

export function getNetworkInstance() {
  return networkInstance;
}

  // Cycle detection on client-side graph
  /**
 * Client-side DFS cycle detector identifying circular precedence loops.
 */
export function detectScheduleCyclesClient(nodeIds, edges) {
    const adj = {};
    nodeIds.forEach(id => { adj[id] = []; });
    edges.forEach(e => {
      const u = (e.from_activity_id || e.from || "").trim();
      const v = (e.to_activity_id || e.to || "").trim();
      if (u && v && adj[u]) {
        adj[u].push(v);
      }
    });

    const visited = {};
    nodeIds.forEach(id => { visited[id] = 0; });
    const cyclePath = [];

    /**
     * Recursive depth-first search helper detecting back-edges in precedence network.
     */
    function dfs(u, path) {
      visited[u] = 1;
      path.push(u);
      for (const v of (adj[u] || [])) {
        if (visited[v] === 1) {
          const idx = path.indexOf(v);
          cyclePath.push(...path.slice(idx), v);
          return true;
        } else if (visited[v] === 0) {
          if (dfs(v, path)) return true;
        }
      }
      path.pop();
      visited[u] = 2;
      return false;
    }

    for (const id of nodeIds) {
      if (visited[id] === 0) {
        if (dfs(id, [])) return cyclePath;
      }
    }
    return null;
  }

  // Client-side Schedule Health Evaluation Engine
  /**
 * Evaluates schedule network health metrics, dangling nodes, and redundant links in browser.
 */
export function evaluateScheduleHealthClient(activities, dependencies) {
    const actIds = (activities || []).map(a => a.activity_id).filter(Boolean);
    const actIdSet = new Set(actIds);

    const hasStartAnchor = new Set();
    const hasFinishDriver = new Set();
    const logicDensity = {};
    actIds.forEach(id => { logicDensity[id] = 0; });

    const pairSeen = new Set();
    const redundantLinks = [];
    const sfLinks = [];
    const excessiveLags = [];
    const invalidLinks = [];

    (dependencies || []).forEach(dep => {
      const fromId = (dep.from_activity_id || dep.from || "").trim();
      const toId = (dep.to_activity_id || dep.to || "").trim();
      let rawType = (dep.type || "FS").trim().toUpperCase();
      if (rawType.includes("(") && rawType.includes(")")) {
        rawType = rawType.split("(")[1].replace(")", "").trim();
      }
      const lag = parseFloat(dep.lag_days || 0);

      if (!actIdSet.has(fromId) || !actIdSet.has(toId)) {
        invalidLinks.push(`Dependency links unknown activity: '${fromId}' ➔ '${toId}'`);
        return;
      }

      const pairKey = `${fromId}->${toId}`;
      if (pairSeen.has(pairKey)) {
        redundantLinks.push(`Duplicate link between '${fromId}' and '${toId}'`);
      } else {
        pairSeen.add(pairKey);
      }

      logicDensity[fromId] = (logicDensity[fromId] || 0) + 1;
      logicDensity[toId] = (logicDensity[toId] || 0) + 1;

      // Start anchor: predecessor must be FS or SS
      if (rawType === "FS" || rawType === "SS") {
        hasStartAnchor.add(toId);
      }

      // Finish driver: successor must be FS or FF
      if (rawType === "FS" || rawType === "FF") {
        hasFinishDriver.add(fromId);
      }

      // SF link
      if (rawType === "SF") {
        sfLinks.push({ from: fromId, to: toId });
      }

      // Excessive lag (> 2 days)
      if (lag > 2.0) {
        excessiveLags.push({
          from: fromId,
          to: toId,
          lag_days: lag,
          warning: `Lag of ${lag} days exceeds 2-day threshold.`
        });
      }
    });

    const totalActs = actIds.length;
    const projectStartId = totalActs > 0 ? actIds[0] : null;
    const projectEndId = totalActs > 0 ? actIds[totalActs - 1] : null;

    const unanchoredStarts = totalActs > 1 ? actIds.filter(id => !hasStartAnchor.has(id)) : [];
    const unanchoredFinishes = totalActs > 1 ? actIds.filter(id => !hasFinishDriver.has(id)) : [];

    // True dangling activities exclude the project start milestone and project end milestone
    const danglingStarts = unanchoredStarts.filter(id => id !== projectStartId);
    const danglingFinishes = unanchoredFinishes.filter(id => id !== projectEndId);

    const excessiveDensity = Object.entries(logicDensity)
      .filter(([id, cnt]) => cnt > 4)
      .map(([id, cnt]) => ({ activity_id: id, count: cnt }));

    const cyclePath = detectScheduleCyclesClient(actIds, dependencies || []);

    // Calculate score
    let score = 100;
    const deductions = [];

    if (cyclePath) {
      score = 0;
      deductions.push("Circular logic loop detected (-100 pts)");
    } else {
      if (danglingStarts.length > 0) {
        const startDeduction = Math.min(danglingStarts.length * 10, 30);
        score -= startDeduction;
        deductions.push(`${danglingStarts.length} unlinked start(s) (-${startDeduction} pts)`);
      }

      if (danglingFinishes.length > 0) {
        const finishDeduction = Math.min(danglingFinishes.length * 10, 30);
        score -= finishDeduction;
        deductions.push(`${danglingFinishes.length} unlinked finish(es) (-${finishDeduction} pts)`);
      }

      if (excessiveLags.length > 0) {
        const lagDeduction = Math.min(excessiveLags.length * 3, 15);
        score -= lagDeduction;
        deductions.push(`${excessiveLags.length} high lag link(s) > 2d (-${lagDeduction} pts)`);
      }

      if (excessiveDensity.length > 0) {
        const densityDeduction = Math.min(excessiveDensity.length * 2, 10);
        score -= densityDeduction;
        deductions.push(`${excessiveDensity.length} high logic density activity(ies) (-${densityDeduction} pts)`);
      }
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      is_healthy: score >= 80 && !cyclePath && danglingStarts.length === 0 && danglingFinishes.length === 0,
      total_activities: totalActs,
      total_dependencies: (dependencies || []).length,
      project_start: projectStartId,
      project_end: projectEndId,
      open_starts: danglingStarts,
      open_finishes: danglingFinishes,
      sf_links: sfLinks,
      excessive_lags: excessiveLags,
      excessive_density: excessiveDensity,
      redundant_links: redundantLinks,
      invalid_links: invalidLinks,
      cycle_path: cyclePath,
      deductions
    };
  }

  // Open Add/Edit Precedence Dependency Modal helper
  window.openAddDependencyFor = function(activityId, role) {
    openAddDependencyModal(-1);
    if (role === 'successor') {
      selectDepSuccessor.value = activityId;
    } else if (role === 'predecessor') {
      selectDepPredecessor.value = activityId;
    }
    validateDependencyModalInput();
  };

  // Render Clean Schedule Health Status Bar & Detailed Diagnostic Guidance
  /**
 * Renders schedule health score, diagnostic indicators, and actionable error alerts.
 */
export function renderScheduleHealthUI(health) {
    const project = pmState.project || {};
    if (!health) return;

    const activities = project.activities || [];
    const actMap = {};
    activities.forEach(a => { actMap[a.activity_id] = a.name; });

    if (health.cycle_path) {
      healthStatusIndicator.className = "badge badge-rose";
      healthStatusIndicator.innerHTML = `⛔ Logic Loop Detected (0%)`;
      healthQuickSummary.innerHTML = `Circular dependency: <strong>${health.cycle_path.join(' ➔ ')}</strong>`;
      scheduleHealthDrawer.style.display = "block";
      btnToggleHealthDetails.textContent = "Diagnostics ▴";
    } else if (health.is_healthy) {
      healthStatusIndicator.className = "badge badge-emerald";
      healthStatusIndicator.innerHTML = `✅ Complete Workflow (100%)`;
      healthQuickSummary.textContent = `${health.total_activities} Activities • ${health.total_dependencies} Dependencies • Clean flow from Entry (${health.project_start || 'Start'}) to Exit (${health.project_end || 'Finish'})`;
    } else {
      healthStatusIndicator.className = "badge badge-amber";
      healthStatusIndicator.innerHTML = `⚠️ Schedule Health: ${health.score}%`;
      const issueCount = health.open_starts.length + health.open_finishes.length;
      healthQuickSummary.textContent = `${health.total_activities} Activities • ${health.total_dependencies} Dependencies • ${issueCount} unlinked task(s) found`;
    }

    // Diagnostics Drawer Details
    const findings = [];

    // 1. Critical: Circular Dependency Loop
    if (health.cycle_path) {
      const loopStr = health.cycle_path.map(id => `<strong>${id}</strong> (${actMap[id] || 'Activity'})`).join(" ➔ ");
      findings.push(`
        <div class="diagnostic-card critical">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #991B1B;">
              ⛔ Critical Blocker: Circular Precedence Loop Detected
            </div>
            <span class="badge badge-rose" style="font-size: 0.72rem;">Score: 0% (Fatal)</span>
          </div>
          <div style="font-size: 0.85rem; color: #7F1D1D; margin-bottom: 0.6rem;">
            <strong>Detected Cycle:</strong> ${loopStr}
          </div>
          <div style="font-size: 0.84rem; color: #450A0A; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #FECACA; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is this issue?</strong> The schedule network contains an infinite dependency loop where an activity depends on itself through a chain of predecessors. A schedule must be a strict Directed Acyclic Graph (DAG).
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> A circular loop causes infinite recursion during forward and backward passes. It makes it mathematically impossible to calculate Early Dates, Late Dates, or Total Float, invalidating the entire project schedule.
            </div>
            <div>
              <strong>• How to Resolve:</strong>
              <ol style="margin: 0.3rem 0 0 1.2rem; padding: 0;">
                <li>Identify which dependency creates the reverse link in the cycle above.</li>
                <li>Switch to the <strong>Dependencies List</strong> tab, locate that dependency, and delete or re-route it to a downstream task.</li>
              </ol>
            </div>
          </div>
        </div>
      `);
    }

    // 2. Open Start Activities (Dangling Predecessor Link)
    if (health.open_starts.length > 0) {
      const taskListHtml = health.open_starts.map(id => `
        <li style="display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px dashed #FDE68A;">
          <div>
            <strong style="color: #92400E;">${id}</strong>: ${actMap[id] || 'Activity'}
          </div>
          <button type="button" class="btn btn-outline-primary btn-xs" onclick="openAddDependencyFor('${id}', 'successor')" title="Link predecessor for ${id}">
            ➕ Anchor with Predecessor
          </button>
        </li>
      `).join("");

      findings.push(`
        <div class="diagnostic-card warning">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #92400E;">
              ⏳ Open Start Activities (${health.open_starts.length} task(s) unanchored)
            </div>
            <span class="badge badge-amber" style="font-size: 0.72rem;">Logic Integrity</span>
          </div>
          <div style="font-size: 0.84rem; color: #78350F; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #FDE68A; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is an "Open Start"?</strong> An activity has no incoming predecessor link (neither <code>Finish-to-Start [FS]</code> nor <code>Start-to-Start [SS]</code>) to anchor when it can begin. In project management standards (PMBOK and DCMA 14-Point Assessment), only the initial project kick-off milestone should begin without a predecessor.
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> Without a predecessor, the scheduling engine assumes the task can start immediately on Day 1 of the project. This produces <em>artificial float</em> (unrealistic excess buffer) that conceals real project bottlenecks and distorts the true Critical Path.
            </div>
            <div>
              <strong>• How to Resolve:</strong>
              <ol style="margin: 0.3rem 0 0 1.2rem; padding: 0;">
                <li>Identify which prior work package or milestone produces the inputs needed for each task below.</li>
                <li>Click <strong>"➕ Anchor with Predecessor"</strong> beside each task to open the dependency form with the task preselected as successor, and select its predecessor.</li>
              </ol>
            </div>
          </div>
          <div style="font-size: 0.82rem; color: #92400E; font-weight: 700; margin-bottom: 0.25rem;">Affected Tasks:</div>
          <ul style="list-style: none; padding: 0; margin: 0; background: #FFFFFF; border: 1px solid #FDE68A; border-radius: 4px; padding: 0.4rem 0.8rem; font-size: 0.84rem;">
            ${taskListHtml}
          </ul>
        </div>
      `);
    }

    // 3. Open Finish Activities (Dangling Successor Link)
    if (health.open_finishes.length > 0) {
      const taskListHtml = health.open_finishes.map(id => `
        <li style="display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px dashed #FDE68A;">
          <div>
            <strong style="color: #92400E;">${id}</strong>: ${actMap[id] || 'Activity'}
          </div>
          <button type="button" class="btn btn-outline-primary btn-xs" onclick="openAddDependencyFor('${id}', 'predecessor')" title="Link successor for ${id}">
            ➕ Connect to Successor
          </button>
        </li>
      `).join("");

      findings.push(`
        <div class="diagnostic-card warning">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #92400E;">
              🏁 Open Finish Activities (${health.open_finishes.length} task(s) unconstrained)
            </div>
            <span class="badge badge-amber" style="font-size: 0.72rem;">Logic Integrity</span>
          </div>
          <div style="font-size: 0.84rem; color: #78350F; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #FDE68A; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is an "Open Finish"?</strong> An activity has no outgoing successor link (neither <code>Finish-to-Start [FS]</code> nor <code>Finish-to-Finish [FF]</code>) that is constrained by its completion. Only the final project delivery milestone should have an unconstrained finish.
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> If a task has no successor, any delays or cost overruns occurring in this task will never propagate downstream to affect the project end date. The task effectively "falls off" the critical path, blinding management to real delivery risks.
            </div>
            <div>
              <strong>• How to Resolve:</strong>
              <ol style="margin: 0.3rem 0 0 1.2rem; padding: 0;">
                <li>Determine which subsequent task or phase milestone depends on the completion of each task below.</li>
                <li>Click <strong>"➕ Connect to Successor"</strong> beside each task to open the dependency form with the task preselected as predecessor, and select its successor.</li>
              </ol>
            </div>
          </div>
          <div style="font-size: 0.82rem; color: #92400E; font-weight: 700; margin-bottom: 0.25rem;">Affected Tasks:</div>
          <ul style="list-style: none; padding: 0; margin: 0; background: #FFFFFF; border: 1px solid #FDE68A; border-radius: 4px; padding: 0.4rem 0.8rem; font-size: 0.84rem;">
            ${taskListHtml}
          </ul>
        </div>
      `);
    }

    // 4. Excessive Lags (> 2 days)
    if (health.excessive_lags.length > 0) {
      findings.push(`
        <div class="diagnostic-card info">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <div style="font-weight: 700; font-size: 0.95rem; color: #0369A1;">
              ℹ️ High Lag Offset (&gt; 2 working days — ${health.excessive_lags.length} link(s))
            </div>
            <span class="badge badge-blue" style="font-size: 0.72rem;">Best Practice</span>
          </div>
          <div style="font-size: 0.84rem; color: #0C4A6E; line-height: 1.5; background: #FFFFFF; padding: 0.75rem 0.9rem; border-radius: 4px; border: 1px solid #BAE6FD; margin-bottom: 0.6rem;">
            <div style="margin-bottom: 0.4rem;">
              <strong>• What is this issue?</strong> Dependencies contain lag offsets exceeding 2 days (${health.excessive_lags.map(l => `${l.from} ➔ ${l.to} [${l.lag_days}d]`).join("; ")}).
            </div>
            <div style="margin-bottom: 0.4rem;">
              <strong>• Impact on CPM Schedule:</strong> DCMA 14-Point schedule health standards caution against long positive lags because they frequently represent unmodeled work, invisible waiting periods (e.g. curing time, review cycles), or artificial padding that evades progress tracking.
            </div>
            <div>
              <strong>• How to Resolve:</strong> If the delay represents active work, review periods, or vendor transit, convert the lag into a distinct activity node in the WBS instead of an invisible offset.
            </div>
          </div>
        </div>
      `);
    }

    // 5. Perfect Clean Workflow
    if (findings.length === 0) {
      findings.push(`
        <div class="diagnostic-card success">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0.6rem;">
            <span style="font-size: 1.25rem;">✅</span>
            <div style="font-weight: 700; font-size: 0.98rem; color: #166534;">
              Continuous, Defect-Free Precedence Network (100% Health Score)
            </div>
          </div>
          <p style="margin: 0 0 0.6rem 0; font-size: 0.85rem; color: #14532D; line-height: 1.5;">
            The project schedule meets all DCMA 14-point and PMBOK network integrity requirements:
          </p>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 0.5rem;">
            <div style="background: #FFFFFF; padding: 0.7rem 0.9rem; border-radius: 4px; border: 1px solid #BBF7D0;">
              <span style="font-size: 0.72rem; color: #15803D; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Initial Entry Milestone</span><br>
              <strong style="color: #14532D; font-size: 0.9rem;">${health.project_start || 'Start'}</strong>
              <div style="font-size: 0.78rem; color: #4B5563;">${actMap[health.project_start] || 'Project Start'}</div>
            </div>
            <div style="background: #FFFFFF; padding: 0.7rem 0.9rem; border-radius: 4px; border: 1px solid #BBF7D0;">
              <span style="font-size: 0.72rem; color: #15803D; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Final Exit Milestone</span><br>
              <strong style="color: #14532D; font-size: 0.9rem;">${health.project_end || 'Finish'}</strong>
              <div style="font-size: 0.78rem; color: #4B5563;">${actMap[health.project_end] || 'Project Completion'}</div>
            </div>
            <div style="background: #FFFFFF; padding: 0.7rem 0.9rem; border-radius: 4px; border: 1px solid #BBF7D0;">
              <span style="font-size: 0.72rem; color: #15803D; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Topology Status</span><br>
              <strong style="color: #14532D; font-size: 0.9rem;">Validated DAG</strong>
              <div style="font-size: 0.78rem; color: #4B5563;">0 loops • 0 open ends • 0 negative lags</div>
            </div>
          </div>
        </div>
      `);
    }

    healthDiagnosticsDetails.innerHTML = findings.join("");
  }

  // Toggle Health Diagnostics Drawer
export function switchSeqTab(tab) {
    activeSeqTab = tab;
    if (tab === "diagram") {
      tabBtnDiagram.classList.add("active");
      tabBtnDiagram.style.color = "var(--primary)";
      tabBtnDiagram.style.borderBottom = "3px solid var(--primary)";
      tabBtnDiagram.style.fontWeight = "700";

      tabBtnTable.classList.remove("active");
      tabBtnTable.style.color = "var(--slate)";
      tabBtnTable.style.borderBottom = "3px solid transparent";
      tabBtnTable.style.fontWeight = "600";

      seqPaneDiagram.style.display = "block";
      seqPaneTable.style.display = "none";
      diagramToolbar.style.display = "flex";

      if (networkInstance) {
        setTimeout(() => { networkInstance.fit({ animation: true }); }, 50);
      }
    } else {
      tabBtnTable.classList.add("active");
      tabBtnTable.style.color = "var(--primary)";
      tabBtnTable.style.borderBottom = "3px solid var(--primary)";
      tabBtnTable.style.fontWeight = "700";

      tabBtnDiagram.classList.remove("active");
      tabBtnDiagram.style.color = "var(--slate)";
      tabBtnDiagram.style.borderBottom = "3px solid transparent";
      tabBtnDiagram.style.fontWeight = "600";

      seqPaneDiagram.style.display = "none";
      seqPaneTable.style.display = "block";
      diagramToolbar.style.display = "none";
    }
  }

export function validateDependencyModalInput() {
    const project = pmState.project || {};
    const fromId = selectDepPredecessor.value;
    const toId = selectDepSuccessor.value;
    const rawType = selectDepType.value;
    const lag = parseFloat(inputDepLag.value || 0);
    const editIdx = parseInt(dependencyEditIndex.value, 10);

    const submitBtn = dependencyForm.querySelector('button[type="submit"]');

    const descriptions = {
      FS: "Finish-to-Start (FS): Predecessor must finish before Successor can start.",
      SS: "Start-to-Start (SS): Successor starts after Predecessor starts.",
      FF: "Finish-to-Finish (FF): Successor finishes after Predecessor finishes.",
      SF: "Start-to-Finish (SF): Successor cannot finish until Predecessor has started."
    };
    depTypeExplanation.textContent = descriptions[rawType] || "";

    const errors = [];
    const warnings = [];

    if (fromId && toId && fromId === toId) {
      errors.push(`Predecessor and successor cannot be the same activity ('${fromId}').`);
    }

    if (isNaN(lag) || lag < 0) {
      errors.push(`Negative lag (${lag} days) is prohibited.`);
    }

    if (fromId && toId && fromId !== toId) {
      const currentDeps = project.dependencies || [];
      const isDuplicate = currentDeps.some((d, idx) => {
        if (editIdx >= 0 && idx === editIdx) return false;
        const dFrom = d.from_activity_id || d.from;
        const dTo = d.to_activity_id || d.to;
        return dFrom === fromId && dTo === toId;
      });
      if (isDuplicate) {
        warnings.push(`A dependency between '${fromId}' and '${toId}' already exists.`);
      }

      // Cycle simulation
      const simulatedEdges = currentDeps
        .filter((_, idx) => editIdx < 0 || idx !== editIdx)
        .map(d => ({ from: d.from_activity_id || d.from, to: d.to_activity_id || d.to }));
      simulatedEdges.push({ from: fromId, to: toId });

      const actIds = (project.activities || []).map(a => a.activity_id).filter(Boolean);
      const cycle = detectScheduleCyclesClient(actIds, simulatedEdges);
      if (cycle) {
        errors.push(`Circular loop detected: ${cycle.join(' ➔ ')}.`);
      }
    }

    if (errors.length > 0) {
      dependencyModalAlert.className = "alert-box alert-danger";
      dependencyModalAlert.style.display = "block";
      dependencyModalAlert.innerHTML = `<strong>Error:</strong> ${errors.join("<br>")}`;
      submitBtn.disabled = true;
      return false;
    } else if (warnings.length > 0) {
      dependencyModalAlert.className = "alert-box alert-warning";
      dependencyModalAlert.style.display = "block";
      dependencyModalAlert.innerHTML = `<strong>Notice:</strong> ${warnings.join("<br>")}`;
      submitBtn.disabled = false;
      return true;
    } else {
      dependencyModalAlert.style.display = "none";
      submitBtn.disabled = false;
      return true;
    }
  }

  // Open Dependency Modal
  /**
 * Opens modal dialog to create or modify an activity precedence dependency.
 */
export function openAddDependencyModal(editIdx = -1) {
    const project = pmState.project || {};
    dependencyEditIndex.value = editIdx;
    const activities = project.activities || [];

    selectDepPredecessor.innerHTML = '<option value="">Select predecessor activity...</option>' +
      activities.map(a => `<option value="${a.activity_id}">📌 ${a.activity_id}: ${a.name}</option>`).join('');

    selectDepSuccessor.innerHTML = '<option value="">Select successor activity...</option>' +
      activities.map(a => `<option value="${a.activity_id}">📌 ${a.activity_id}: ${a.name}</option>`).join('');

    const submitBtn = dependencyForm.querySelector('button[type="submit"]');

    if (editIdx >= 0 && project.dependencies && project.dependencies[editIdx]) {
      const dep = project.dependencies[editIdx];
      dependencyModalTitle.textContent = "Edit Precedence Dependency";
      selectDepPredecessor.value = dep.from_activity_id || dep.from || "";
      selectDepSuccessor.value = dep.to_activity_id || dep.to || "";
      
      let rawType = dep.type || "FS";
      if (rawType.includes("(") && rawType.includes(")")) {
        rawType = rawType.split("(")[1].replace(")", "").trim();
      }
      selectDepType.value = rawType;
      inputDepLag.value = dep.lag_days !== undefined ? dep.lag_days : 0;
      inputDepDesc.value = dep.description || "";
      submitBtn.textContent = "💾 Update Dependency";
    } else {
      dependencyModalTitle.textContent = "Add Precedence Dependency";
      selectDepPredecessor.value = "";
      selectDepSuccessor.value = "";
      selectDepType.value = "FS";
      inputDepLag.value = 0;
      inputDepDesc.value = "";
      submitBtn.textContent = "➕ Add Dependency";
    }

    validateDependencyModalInput();
    dependencyModal.style.display = "flex";
  }

  /**
 * Closes the precedence dependency modal dialog.
 */
export function closeDependencyModal() {
    dependencyModal.style.display = "none";
    dependencyModalAlert.style.display = "none";
  }
export function autoGenerateLogicalSequence() {
    const project = pmState.project || {};
    const activities = project.activities || [];
    if (activities.length < 2) {
      alert("At least 2 activities are required.");
      return;
    }

    if (project.dependencies && project.dependencies.length > 0) {
      if (!confirm("This will link all activities in continuous sequential order. Proceed?")) {
        return;
      }
    }

    const newDeps = [];
    for (let i = 0; i < activities.length - 1; i++) {
      newDeps.push({
        dependency_id: `DEP-${String(i + 1).padStart(3, "0")}`,
        from_activity_id: activities[i].activity_id,
        to_activity_id: activities[i + 1].activity_id,
        type: "FS",
        lag_days: 0,
        description: `Sequential handoff from ${activities[i].activity_id} to ${activities[i+1].activity_id}`
      });
    }

    project.dependencies = newDeps;
    hasUnsavedDependencies = true;
    renderSequenceView();

    seqSaveStatus.textContent = "Unsaved Changes";
    seqSaveStatus.className = "badge badge-amber";
    seqSaveStatus.style.display = "inline-block";
  }
export function renderSequenceView() {
    const project = pmState.project || {};
    const activities = project.activities || [];
    const dependencies = project.dependencies || [];

    // Update dependencies count badge
    if (seqDepsBadgeCount) {
      seqDepsBadgeCount.textContent = dependencies.length;
    }

    // 1. Evaluate schedule health on client
    const health = evaluateScheduleHealthClient(activities, dependencies);
    renderScheduleHealthUI(health);

    // 2. Render vis-network interactive diagram
    networkInstance = renderNetworkDiagram(pdmCanvas, activities, dependencies, health);

    // 3. Render Dependencies Table
    if (dependencies.length > 0) {
      const actMap = {};
      activities.forEach(a => { actMap[a.activity_id] = a.name; });

      let tableHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; flex-wrap: wrap; gap: 10px;">
          <h4 style="margin: 0; font-size: 1.05rem; color: var(--charcoal);">
            Activity Dependencies (${dependencies.length})
          </h4>
          <button type="button" id="btn-re-sequence-logic" class="btn btn-outline-primary btn-sm" style="font-weight: 600;">
            ⚡ Auto-Sequence All Activities
          </button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th style="width: 30%;">Predecessor (From)</th>
                <th style="width: 15%;">Type</th>
                <th style="width: 30%;">Successor (To)</th>
                <th style="width: 10%;">Lag</th>
                <th style="width: 15%; text-align: center;">Actions</th>
              </tr>
            </thead>
            <tbody>
      `;

      dependencies.forEach((d, idx) => {
        const fromId = d.from_activity_id || d.from || "—";
        const toId = d.to_activity_id || d.to || "—";
        const fromName = actMap[fromId] || "";
        const toName = actMap[toId] || "";

        let rawType = d.type || "FS";
        if (rawType.includes("(") && rawType.includes(")")) {
          rawType = rawType.split("(")[1].replace(")", "").trim();
        }

        const lag = parseFloat(d.lag_days || 0);

        let typeBadge = `<span class="badge badge-blue">FS</span>`;
        if (rawType === "SS") {
          typeBadge = `<span class="badge" style="background:#EDE9FE; color:#6D28D9; border: 1px solid #DDD6FE;">SS</span>`;
        } else if (rawType === "FF") {
          typeBadge = `<span class="badge" style="background:#CFFAFE; color:#0E7490; border: 1px solid #A5F3FC;">FF</span>`;
        } else if (rawType === "SF") {
          typeBadge = `<span class="badge" style="background:#FEF2F2; color:#DC2626; border: 1px solid #FECACA;">SF</span>`;
        }

        tableHtml += `
          <tr>
            <td>
              <div style="font-weight: 700; color: var(--charcoal); font-size: 0.88rem;">${fromId}</div>
              <div style="font-size: 0.8rem; color: var(--slate);">${fromName}</div>
            </td>
            <td>${typeBadge}</td>
            <td>
              <div style="font-weight: 700; color: var(--charcoal); font-size: 0.88rem;">${toId}</div>
              <div style="font-size: 0.8rem; color: var(--slate);">${toName}</div>
            </td>
            <td style="font-weight: 600; color: var(--slate);">${lag > 0 ? `+${lag}d` : '0d'}</td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 6px; justify-content: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="editSequenceDependency(${idx})" title="Edit">
                  ✏️
                </button>
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteSequenceDependency(${idx})" title="Delete">
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        `;
      });

      tableHtml += `</tbody></table></div>`;
      pdmDependencies.innerHTML = tableHtml;

      const btnReSeq = document.getElementById("btn-re-sequence-logic");
      if (btnReSeq) {
        btnReSeq.addEventListener("click", autoGenerateLogicalSequence);
      }
    } else {
      pdmDependencies.innerHTML = `
        <div style="background: #FFFFFF; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 2.5rem; text-align: center;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔗</div>
          <h4 style="margin: 0; color: var(--charcoal);">No Precedence Dependencies Yet</h4>
          <p style="font-size: 0.88rem; color: var(--slate); max-width: 450px; margin: 0.4rem auto 1.2rem auto;">
            Connect tasks to establish a logical workflow across the project.
          </p>
          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary" onclick="document.getElementById('btn-open-add-dependency').click()">
              ➕ Add First Dependency
            </button>
            <button type="button" id="btn-seed-standard-dependencies" class="btn btn-outline-primary">
              ⚡ Auto-Sequence All Activities
            </button>
          </div>
        </div>
      `;

      const btnSeed = document.getElementById("btn-seed-standard-dependencies");
      if (btnSeed) {
        btnSeed.addEventListener("click", autoGenerateLogicalSequence);
      }
    }

    // Restore active tab
    switchSeqTab(activeSeqTab);
  }

// ==========================================
// INITIALIZATION CONTROLLER
// ==========================================
export function initSequenceController() {
  pdmCanvas = document.getElementById("pdm-network-canvas");
  pdmDependencies = document.getElementById("pdm-dependencies-container");
  btnOpenAddDependency = document.getElementById("btn-open-add-dependency");
  btnSaveDependencies = document.getElementById("btn-save-dependencies");
  seqAlertMsg = document.getElementById("seq-alert-msg");
  seqSaveStatus = document.getElementById("seq-save-status");

  healthStatusIndicator = document.getElementById("health-status-indicator");
  healthQuickSummary = document.getElementById("health-quick-summary");
  btnToggleHealthDetails = document.getElementById("btn-toggle-health-details");
  scheduleHealthDrawer = document.getElementById("schedule-health-drawer");
  healthDiagnosticsDetails = document.getElementById("health-diagnostics-details");

  tabBtnDiagram = document.getElementById("tab-btn-diagram");
  tabBtnTable = document.getElementById("tab-btn-table");
  seqPaneDiagram = document.getElementById("seq-pane-diagram");
  seqPaneTable = document.getElementById("seq-pane-table");
  seqDepsBadgeCount = document.getElementById("seq-deps-badge-count");
  diagramToolbar = document.getElementById("diagram-toolbar");

  btnCanvasZoomIn = document.getElementById("btn-canvas-zoom-in");
  btnCanvasZoomOut = document.getElementById("btn-canvas-zoom-out");
  btnCanvasFit = document.getElementById("btn-canvas-fit");

  dependencyModal = document.getElementById("dependency-modal");
  dependencyModalTitle = document.getElementById("dependency-modal-title");
  btnCloseDependencyModal = document.getElementById("btn-close-dependency-modal");
  btnCancelDependencyModal = document.getElementById("btn-cancel-dependency-modal");
  dependencyForm = document.getElementById("dependency-form");
  dependencyModalAlert = document.getElementById("dependency-modal-alert");
  selectDepPredecessor = document.getElementById("select-dep-predecessor");
  selectDepType = document.getElementById("select-dep-type");
  selectDepSuccessor = document.getElementById("select-dep-successor");
  inputDepLag = document.getElementById("input-dep-lag");
  inputDepDesc = document.getElementById("input-dep-desc");
  depTypeExplanation = document.getElementById("dep-type-explanation");
  dependencyEditIndex = document.getElementById("dependency-edit-index");

  // Health drawer toggle
  if (btnToggleHealthDetails && scheduleHealthDrawer) {
    btnToggleHealthDetails.addEventListener("click", () => {
      const isOpen = scheduleHealthDrawer.style.display === "block";
      scheduleHealthDrawer.style.display = isOpen ? "none" : "block";
      btnToggleHealthDetails.textContent = isOpen ? "Diagnostics ▾" : "Diagnostics ▴";
    });
  }

  // Tab switching
  if (tabBtnDiagram) tabBtnDiagram.addEventListener("click", () => switchSeqTab("diagram"));
  if (tabBtnTable) tabBtnTable.addEventListener("click", () => switchSeqTab("table"));

  // Dependency Modal Controls
  if (btnCloseDependencyModal) btnCloseDependencyModal.addEventListener("click", closeDependencyModal);
  if (btnCancelDependencyModal) btnCancelDependencyModal.addEventListener("click", closeDependencyModal);
  if (btnOpenAddDependency) btnOpenAddDependency.addEventListener("click", () => openAddDependencyModal(-1));

  if (selectDepPredecessor) selectDepPredecessor.addEventListener("change", validateDependencyModalInput);
  if (selectDepSuccessor) selectDepSuccessor.addEventListener("change", validateDependencyModalInput);
  if (selectDepType) selectDepType.addEventListener("change", validateDependencyModalInput);
  if (inputDepLag) inputDepLag.addEventListener("input", validateDependencyModalInput);

  if (dependencyForm) {
    dependencyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!validateDependencyModalInput()) return;

      const fromId = selectDepPredecessor.value;
      const toId = selectDepSuccessor.value;
      const type = selectDepType.value;
      const lag = parseFloat(inputDepLag.value || 0);
      const desc = inputDepDesc ? inputDepDesc.value.trim() : "";
      const editIdx = parseInt(dependencyEditIndex.value, 10);

      const project = pmState.project || {};
      if (!project.dependencies) project.dependencies = [];

      const depPayload = {
        dependency_id: editIdx >= 0 ? (project.dependencies[editIdx].dependency_id || `DEP-${editIdx+1}`) : `DEP-${project.dependencies.length+1}`,
        from_activity_id: fromId,
        to_activity_id: toId,
        type: type,
        lag_days: lag,
        description: desc
      };

      if (editIdx >= 0) {
        project.dependencies[editIdx] = depPayload;
      } else {
        project.dependencies.push(depPayload);
      }

      hasUnsavedDependencies = true;
      closeDependencyModal();
      renderSequenceView();

      if (seqSaveStatus) {
        seqSaveStatus.textContent = "Unsaved Changes";
        seqSaveStatus.className = "badge badge-amber";
        seqSaveStatus.style.display = "inline-block";
      }
    });
  }

  // Canvas Controls
  if (btnCanvasZoomIn) {
    btnCanvasZoomIn.addEventListener("click", () => {
      if (networkInstance) {
        const scale = networkInstance.getScale();
        networkInstance.moveTo({ scale: scale * 1.3, animation: true });
      }
    });
  }

  if (btnCanvasZoomOut) {
    btnCanvasZoomOut.addEventListener("click", () => {
      if (networkInstance) {
        const scale = networkInstance.getScale();
        networkInstance.moveTo({ scale: scale * 0.7, animation: true });
      }
    });
  }

  if (btnCanvasFit) {
    btnCanvasFit.addEventListener("click", () => {
      if (networkInstance) networkInstance.fit({ animation: true });
    });
  }

  // Save Dependencies Action
  if (btnSaveDependencies) {
    btnSaveDependencies.addEventListener("click", async () => {
      btnSaveDependencies.disabled = true;
      btnSaveDependencies.innerHTML = `⏳ Saving...`;
      if (seqAlertMsg) seqAlertMsg.style.display = "none";

      const project = pmState.project || {};
      const currentPid = pmState.projectId || project.id || project._id;

      try {
        const res = await updateProjectDependencies(currentPid, project.dependencies || []);
        if (res.error) {
          if (seqAlertMsg) {
            seqAlertMsg.className = "alert alert-danger";
            seqAlertMsg.textContent = `Failed to save: ${res.error}`;
            seqAlertMsg.style.display = "block";
          }
        } else {
          pmState.project = res.data || project;
          hasUnsavedDependencies = false;
          if (seqAlertMsg) {
            seqAlertMsg.className = "alert alert-success";
            seqAlertMsg.textContent = "✓ Dependencies saved successfully!";
            seqAlertMsg.style.display = "block";
          }
          if (seqSaveStatus) {
            seqSaveStatus.textContent = "Saved";
            seqSaveStatus.className = "badge badge-emerald";
            seqSaveStatus.style.display = "inline-block";
          }
          setTimeout(() => {
            if (seqAlertMsg) seqAlertMsg.style.display = "none";
          }, 3000);
          renderSequenceView();
        }
      } catch (err) {
        if (seqAlertMsg) {
          seqAlertMsg.className = "alert alert-danger";
          seqAlertMsg.textContent = `Error: ${err.message}`;
          seqAlertMsg.style.display = "block";
        }
      } finally {
        btnSaveDependencies.disabled = false;
        btnSaveDependencies.innerHTML = `💾 Save Dependencies`;
      }
    });
  }

  // Global window helpers for actions inside generated HTML
  window.deleteSequenceDependency = function(index) {
    const project = pmState.project || {};
    if (!project.dependencies || !project.dependencies[index]) return;
    const dep = project.dependencies[index];
    if (confirm(`Delete dependency ${dep.from_activity_id || dep.from} ➔ ${dep.to_activity_id || dep.to}?`)) {
      project.dependencies.splice(index, 1);
      hasUnsavedDependencies = true;
      renderSequenceView();
      if (seqSaveStatus) {
        seqSaveStatus.textContent = "Unsaved Changes";
        seqSaveStatus.className = "badge badge-amber";
        seqSaveStatus.style.display = "inline-block";
      }
    }
  };

  window.editSequenceDependency = function(index) {
    openAddDependencyModal(index);
  };

  window.openAddDependencyFor = function(activityId, role) {
    openAddDependencyModal(-1);
    if (role === 'successor') {
      if (selectDepSuccessor) selectDepSuccessor.value = activityId;
    } else if (role === 'predecessor') {
      if (selectDepPredecessor) selectDepPredecessor.value = activityId;
    }
    validateDependencyModalInput();
  };
}
