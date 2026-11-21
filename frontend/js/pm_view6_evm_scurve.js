/**
 * SyncFlow Frontend - PM Workspace View 6: EVM KPIs & S-Curve Envelope
 * PMBOK Process 6.6: Control Schedule.
 * Leading & lagging EVM metrics, S-Curve Banana Envelope (Chart.js & SVG fallback),
 * and 4-tier Execution Network Diagram (Vis-network).
 */

// ==========================================
// IMPORTS & DEPENDENCIES
// ==========================================
import { pmState } from "./pm_workspace_state.js";
import { wireNetworkZoomControls } from "./pm_view5_diagrams.js";

// ==========================================
// MODULE STATE
// ==========================================
export const ctrlScurveState = {
  scurveChartInstance: null,
  ctrlNetworkInstance: null
};

// ==========================================
// EXECUTIVE KPIS & EVM METRICS
// ==========================================
/**
 * Renders operational execution KPIs (SPI, SV, Completed, Verified) in Section 5.
 */
export function renderControlKpis(kpis) {
  if (!kpis) return;

  const ctrlCardHealth = document.getElementById("ctrl-card-health");
  const ctrlHealthBadge = document.getElementById("ctrl-health-badge");
  const ctrlHealthSub = document.getElementById("ctrl-health-sub");
  const ctrlKpiSpi = document.getElementById("ctrl-kpi-spi");
  const ctrlSpiDesc = document.getElementById("ctrl-spi-desc");
  const ctrlKpiSv = document.getElementById("ctrl-kpi-sv");
  const ctrlKpiEvPct = document.getElementById("ctrl-kpi-ev-pct");
  const ctrlKpiPvPct = document.getElementById("ctrl-kpi-pv-pct");
  const ctrlKpiForecastDate = document.getElementById("ctrl-kpi-forecast-date");
  const ctrlKpiSlippageSub = document.getElementById("ctrl-kpi-slippage-sub");

  const ctrlLeadEacDays = document.getElementById("ctrl-lead-eac-days");
  const ctrlLeadCpSlippage = document.getElementById("ctrl-lead-cp-slippage");
  const ctrlLeadSpiVelocity = document.getElementById("ctrl-lead-spi-velocity");
  const ctrlLeadPfRem = document.getElementById("ctrl-lead-pf-rem");

  const ctrlBarNotStarted = document.getElementById("ctrl-bar-not-started");
  const ctrlBarInProgress = document.getElementById("ctrl-bar-in-progress");
  const ctrlBarCompleted = document.getElementById("ctrl-bar-completed");
  const ctrlBarVerified = document.getElementById("ctrl-bar-verified");
  const ctrlCountNotStarted = document.getElementById("ctrl-count-not-started");
  const ctrlCountInProgress = document.getElementById("ctrl-count-in-progress");
  const ctrlCountCompleted = document.getElementById("ctrl-count-completed");
  const ctrlCountVerified = document.getElementById("ctrl-count-verified");
  const ctrlLagEvEffort = document.getElementById("ctrl-lag-ev-effort");
  const ctrlLagPvEffort = document.getElementById("ctrl-lag-pv-effort");
  const ctrlLagTotalEffort = document.getElementById("ctrl-lag-total-effort");

  // 1. Overall Health Badge & Border
  if (ctrlHealthBadge && ctrlCardHealth) {
    if (kpis.overall_health === "on_track") {
      ctrlHealthBadge.className = "badge badge-emerald";
      ctrlHealthBadge.textContent = "● On Track (Controlled)";
      ctrlCardHealth.style.borderColor = "#10B981";
      if (ctrlHealthSub) ctrlHealthSub.textContent = "Performance conforming to baseline";
    } else if (kpis.overall_health === "warning") {
      ctrlHealthBadge.className = "badge badge-amber";
      ctrlHealthBadge.textContent = "⚠️ Minor Schedule Delay";
      ctrlCardHealth.style.borderColor = "#F59E0B";
      if (ctrlHealthSub) ctrlHealthSub.textContent = "Corrective interventions advised";
    } else {
      ctrlHealthBadge.className = "badge badge-rose";
      ctrlHealthBadge.textContent = "🚨 Severe Schedule Slippage";
      ctrlCardHealth.style.borderColor = "#EF4444";
      if (ctrlHealthSub) ctrlHealthSub.textContent = "Immediate schedule compression required";
    }
  }

  // 2. SPI & SV
  if (ctrlKpiSpi) {
    ctrlKpiSpi.textContent = kpis.spi.toFixed(2);
    ctrlKpiSpi.style.color = kpis.spi >= 1.0 ? "#16A34A" : (kpis.spi >= 0.90 ? "#D97706" : "#DC2626");
  }
  if (ctrlSpiDesc) {
    const spiDiff = ((kpis.spi - 1.0) * 100).toFixed(1);
    ctrlSpiDesc.textContent = kpis.spi >= 1.0 ? `+${spiDiff}% Ahead of target velocity` : `${spiDiff}% Velocity deficit`;
  }

  if (ctrlKpiSv) {
    const sv = kpis.schedule_variance_days;
    ctrlKpiSv.textContent = sv >= 0 ? `+${sv.toFixed(1)} d` : `${sv.toFixed(1)} d`;
    ctrlKpiSv.style.color = sv >= 0 ? "#16A34A" : (sv >= -30 ? "#D97706" : "#DC2626");
  }

  // 3. Cumulative Progress %
  if (ctrlKpiEvPct) {
    ctrlKpiEvPct.textContent = `${kpis.cumulative_ev_pct}%`;
  }
  if (ctrlKpiPvPct) {
    ctrlKpiPvPct.textContent = `Planned: ${kpis.cumulative_pv_pct}% at status date`;
  }

  // 4. Forecast Finish & Slippage
  if (ctrlKpiForecastDate) {
    ctrlKpiForecastDate.textContent = kpis.forecast_finish_date;
  }
  if (ctrlKpiSlippageSub) {
    const slip = kpis.projected_slippage_days;
    ctrlKpiSlippageSub.textContent = slip <= 0 ? `On-time or ${Math.abs(slip).toFixed(0)}d early` : `⚠️ ${slip.toFixed(0)}d Projected Slippage`;
    ctrlKpiSlippageSub.style.color = slip <= 0 ? "#16A34A" : "#DC2626";
  }

  // 5. Leading Indicators Group
  if (ctrlLeadEacDays) {
    ctrlLeadEacDays.textContent = `${kpis.eac_forecast_days.toLocaleString()} days`;
  }
  if (ctrlLeadCpSlippage) {
    if (kpis.critical_path_slippage_days <= 0) {
      ctrlLeadCpSlippage.textContent = "0.0 d (Critical Path Fully Preserved)";
      ctrlLeadCpSlippage.style.color = "#16A34A";
    } else {
      ctrlLeadCpSlippage.textContent = `⚠️ ${kpis.critical_path_slippage_days.toFixed(1)} d critical path slippage`;
      ctrlLeadCpSlippage.style.color = "#DC2626";
    }
  }
  if (ctrlLeadSpiVelocity) {
    ctrlLeadSpiVelocity.textContent = `${kpis.spi.toFixed(2)}x (${kpis.spi >= 1.0 ? 'Ahead of Schedule' : 'Lagging Plan'})`;
  }
  if (ctrlLeadPfRem) {
    const pfRem = kpis.project_float_remaining_days;
    ctrlLeadPfRem.textContent = pfRem >= 0 ? `+${pfRem.toFixed(1)} days contingency` : `${pfRem.toFixed(1)} days buffer deficit`;
    ctrlLeadPfRem.style.color = pfRem >= 0 ? "#2563EB" : "#DC2626";
  }

  // 6. Lagging Indicators & 4 Status Distribution (White, Yellow, Green, Blue)
  const counts = kpis.status_counts || {};
  if (ctrlCountNotStarted) {
    ctrlCountNotStarted.textContent = `${counts.not_started || 0} (${counts.not_started_pct || 0}%)`;
  }
  if (ctrlCountInProgress) {
    ctrlCountInProgress.textContent = `${counts.in_progress || 0} (${counts.in_progress_pct || 0}%)`;
  }
  if (ctrlCountCompleted) {
    ctrlCountCompleted.textContent = `${counts.completed || 0} (${counts.completed_pct || 0}%)`;
  }
  if (ctrlCountVerified) {
    ctrlCountVerified.textContent = `${counts.verified || 0} (${counts.verified_pct || 0}%)`;
  }

  if (ctrlBarNotStarted) ctrlBarNotStarted.style.width = `${counts.not_started_pct || 0}%`;
  if (ctrlBarInProgress) ctrlBarInProgress.style.width = `${counts.in_progress_pct || 0}%`;
  if (ctrlBarCompleted) ctrlBarCompleted.style.width = `${counts.completed_pct || 0}%`;
  if (ctrlBarVerified) ctrlBarVerified.style.width = `${counts.verified_pct || 0}%`;

  if (ctrlLagEvEffort) ctrlLagEvEffort.textContent = `${kpis.total_earned_effort_days.toLocaleString()} d`;
  if (ctrlLagPvEffort) ctrlLagPvEffort.textContent = `${((kpis.cumulative_pv_pct / 100) * kpis.total_planned_effort_days).toFixed(1)} d`;
  if (ctrlLagTotalEffort) ctrlLagTotalEffort.textContent = `${kpis.total_planned_effort_days.toLocaleString()} d`;
}

// ==========================================
// S-CURVE BANANA ENVELOPE CHART
// ==========================================
/**
 * Renders PMBOK S-Curve progression chart with Early, Late, Actual, and Forecast curves.
 */
export function renderControlScurve(scurveData) {
  const ctrlScurveCanvas = document.getElementById("control-scurve-canvas");
  const ctrlScurveSvg = document.getElementById("control-scurve-svg");
  if (!scurveData || !scurveData.points || scurveData.points.length === 0) return;

  const points = scurveData.points;
  const labels = points.map(p => `Day ${Math.round(p.day)} (${p.date})`);
  const earlyData = points.map(p => p.pv_early_pct);
  const lateData = points.map(p => p.pv_late_pct);
  const actualData = points.map(p => p.actual_ev_pct);
  const forecastData = points.map(p => p.forecast_pct);

  if (typeof Chart !== "undefined" && ctrlScurveCanvas) {
    if (ctrlScurveSvg) ctrlScurveSvg.style.display = "none";
    ctrlScurveCanvas.style.display = "block";

    if (ctrlScurveState.scurveChartInstance) {
      ctrlScurveState.scurveChartInstance.destroy();
    }

    const ctx = ctrlScurveCanvas.getContext("2d");
    ctrlScurveState.scurveChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Early Dates Curve (PV Early)",
            data: earlyData,
            borderColor: "#2563EB",
            backgroundColor: "rgba(37, 99, 235, 0.08)",
            borderWidth: 2.5,
            tension: 0.28,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: false
          },
          {
            label: "Late Dates Curve (PV Late)",
            data: lateData,
            borderColor: "#EA580C",
            backgroundColor: "rgba(37, 99, 235, 0.08)",
            borderWidth: 2.5,
            tension: 0.28,
            pointRadius: 0,
            pointHoverRadius: 5,
            fill: "-1" // Fills the Banana Envelope between Early and Late!
          },
          {
            label: "Actual Progress (EV)",
            data: actualData,
            borderColor: "#16A34A",
            backgroundColor: "#22C55E",
            borderWidth: 3.5,
            tension: 0.2,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: false
          },
          {
            label: "Forecast Trajectory",
            data: forecastData,
            borderColor: "#9333EA",
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [6, 6],
            tension: 0.1,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            display: false // Using custom legend pills for cleaner UI
          },
          tooltip: {
            backgroundColor: "#1E293B",
            padding: 10,
            callbacks: {
              label: function(context) {
                let val = context.parsed.y;
                if (val === null || val === undefined) return null;
                return `${context.dataset.label}: ${val.toFixed(1)}%`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: "#F1F5F9" },
            ticks: { maxTicksLimit: 9, font: { size: 10 } }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: "#E2E8F0" },
            ticks: {
              callback: function(value) { return value + "%"; },
              stepSize: 20,
              font: { size: 11, weight: "bold" }
            },
            title: {
              display: true,
              text: "Cumulative Progress (%)",
              font: { size: 11, weight: "bold" }
            }
          }
        }
      }
    });
  } else {
    // SVG Fallback renderer
    renderScurveSvg(points, scurveData.status_day);
  }
}

/**
 * Generates SVG graph markup for the PMBOK cumulative S-Curve.
 */
export function renderScurveSvg(points, statusDay) {
  const ctrlScurveCanvas = document.getElementById("control-scurve-canvas");
  const ctrlScurveSvg = document.getElementById("control-scurve-svg");
  if (!ctrlScurveSvg) return;

  if (ctrlScurveCanvas) ctrlScurveCanvas.style.display = "none";
  ctrlScurveSvg.style.display = "block";

  const width = 860;
  const height = 340;
  const padding = { top: 20, right: 30, bottom: 40, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxDay = points[points.length - 1].day || 1750;

  function getX(d) {
    return padding.left + (d / maxDay) * chartW;
  }
  function getY(pct) {
    return padding.top + chartH - ((pct || 0) / 100) * chartH;
  }

  let earlyPath = "";
  let latePath = "";
  let actualPath = "";
  let forecastPath = "";

  points.forEach((p, idx) => {
    const x = getX(p.day);
    const ye = getY(p.pv_early_pct);
    const yl = getY(p.pv_late_pct);

    earlyPath += (idx === 0 ? `M ${x} ${ye}` : ` L ${x} ${ye}`);
    latePath += (idx === 0 ? `M ${x} ${yl}` : ` L ${x} ${yl}`);

    if (p.actual_ev_pct !== null && p.actual_ev_pct !== undefined) {
      const ya = getY(p.actual_ev_pct);
      actualPath += (actualPath === "" ? `M ${x} ${ya}` : ` L ${x} ${ya}`);
    }

    if (p.forecast_pct !== null && p.forecast_pct !== undefined) {
      const yf = getY(p.forecast_pct);
      forecastPath += (forecastPath === "" ? `M ${x} ${yf}` : ` L ${x} ${yf}`);
    }
  });

  let svgHtml = `
    <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%; font-family: Inter, sans-serif;">
      <!-- Grid Lines -->
  `;

  for (let pct = 0; pct <= 100; pct += 20) {
    const y = getY(pct);
    svgHtml += `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1" />
      <text x="${padding.left - 10}" y="${y + 4}" font-size="11" text-anchor="end" fill="#64748B">${pct}%</text>
    `;
  }

  // Vertical Status Date Line
  if (statusDay !== undefined && statusDay !== null) {
    const sx = getX(statusDay);
    svgHtml += `
      <line x1="${sx}" y1="${padding.top}" x2="${sx}" y2="${height - padding.bottom}" stroke="#DC2626" stroke-width="2" stroke-dasharray="4,4" />
      <text x="${sx}" y="${padding.top - 5}" font-size="11" font-weight="bold" fill="#DC2626" text-anchor="middle">Status Date</text>
    `;
  }

  // Paths
  svgHtml += `
      <path d="${earlyPath}" fill="none" stroke="#2563EB" stroke-width="2.5" />
      <path d="${latePath}" fill="none" stroke="#EA580C" stroke-width="2.5" />
      ${forecastPath ? `<path d="${forecastPath}" fill="none" stroke="#9333EA" stroke-width="2" stroke-dasharray="6,6" />` : ""}
      ${actualPath ? `<path d="${actualPath}" fill="none" stroke="#16A34A" stroke-width="3.5" />` : ""}
    </svg>
  `;

  ctrlScurveSvg.innerHTML = svgHtml;
}

// ==========================================
// VIS-NETWORK EXECUTION NETWORK DIAGRAM
// ==========================================
/**
 * Renders 4-tier task execution network graph (White, Yellow, Green, Blue).
 */
export function renderControlNetworkDiagram(currentControlModel, onNodeClick) {
  const ctrlPdmCanvas = document.getElementById("ctrl-pdm-network-canvas");
  const ctrlPdmFilterMode = document.getElementById("ctrl-pdm-filter-mode");
  if (!ctrlPdmCanvas || !currentControlModel) return;

  if (typeof vis === "undefined" || !vis.Network) {
    ctrlPdmCanvas.innerHTML = `
      <div style="padding: 2.5rem; text-align: center; color: var(--danger);">
        Visualization library (vis-network) failed to load.
      </div>
    `;
    return;
  }

  const project = pmState.project || {};
  const rawActivities = currentControlModel.activities || [];
  const rawDependencies = currentControlModel.dependencies || project.dependencies || [];
  const filterMode = ctrlPdmFilterMode ? ctrlPdmFilterMode.value : "all";

  // Filter activities if needed
  const visibleActivities = rawActivities.filter(a => {
    if (filterMode === "all") return true;
    if (filterMode === "critical") return Boolean(a.is_critical);
    return a.status === filterMode;
  });

  const visibleActIds = new Set(visibleActivities.map(a => a.activity_id));

  // Construct vis-network nodes
  const nodes = [];
  visibleActivities.forEach(act => {
    const actId = act.activity_id;
    const progress = act.progress_pct !== undefined ? act.progress_pct : 0;
    const sv = act.sv_days !== undefined ? act.sv_days : 0;
    const shortName = act.name && act.name.length > 25 ? act.name.substring(0, 23) + "..." : (act.name || "Activity");

    // PMBOK Execution Colors:
    // White: Not started
    // Yellow: WIP (Work in Progress)
    // Green: Completed
    // Blue: Completed & Verified by Controller
    const isMilestone = Boolean(act.is_milestone || act.duration === 0);
    let bgColor = "#FFFFFF";
    let borderColor = "#64748B";
    let textColor = "#1E293B";
    let borderWidth = 2;
    let statusIcon = "⚪";
    let statusLabel = "Not Started";
    let shapeType = isMilestone ? "diamond" : "box";

    if (act.status === "in_progress") {
      bgColor = "#FEF08A";
      borderColor = "#CA8A04";
      textColor = "#713F12";
      borderWidth = 2.5;
      statusIcon = "🟡";
      statusLabel = "WIP";
    } else if (act.status === "completed") {
      bgColor = "#DCFCE7";
      borderColor = "#16A34A";
      textColor = "#14532D";
      borderWidth = 2.5;
      statusIcon = "🟢";
      statusLabel = "Completed";
    } else if (act.status === "verified") {
      bgColor = "#DBEAFE";
      borderColor = "#2563EB";
      textColor = "#1E40AF";
      borderWidth = 3;
      statusIcon = "🔵";
      statusLabel = "Verified";
    } else if (isMilestone) {
      bgColor = "#EDE9FE";
      borderColor = "#7C3AED";
      textColor = "#5B21B6";
    }

    const svStr = sv >= 0 ? `+${sv.toFixed(1)}d` : `${sv.toFixed(1)}d`;
    const mPrefix = isMilestone ? "◆ " : "";
    const planStr = isMilestone ? "Milestone (0d)" : `Plan: ${act.duration.toFixed(0)}d`;
    const nodeLabel = `${statusIcon} ${mPrefix}[${actId}]\n${shortName}\n${statusLabel}\n${planStr} | SV: ${svStr}`;

    const tooltip = `Activity: ${actId} ${isMilestone ? '(Milestone)' : ''}
Name: ${act.name}
Work Package: ${act.work_package_id || 'N/A'}
Status: ${statusLabel} (${progress.toFixed(0)}%)
Planned: ${act.planned_start_date || '-'} ➔ ${act.planned_finish_date || '-'}
Actual: ${act.actual_start_date || 'Not Started'} ➔ ${act.actual_finish_date || 'Ongoing'}
Duration: ${act.duration.toFixed(1)}d | EV: ${act.ev_days.toFixed(1)}d | SV: ${svStr}
Controller Sign-off: ${act.status === 'verified' ? (act.verified_by || 'Verified') : 'Pending'}
${act.is_critical ? '🔥 CRITICAL PATH ACTIVITY' : (act.is_near_critical ? '⚠️ NEAR-CRITICAL' : '')}
(Click node to update execution status & sign-off)`;

    nodes.push({
      id: actId,
      label: nodeLabel,
      title: tooltip,
      color: {
        background: bgColor,
        border: borderColor,
        highlight: {
          background: bgColor,
          border: act.is_critical ? "#DC2626" : "#2563EB"
        }
      },
      font: {
        color: textColor,
        size: 11,
        bold: true,
        face: "Inter, Segoe UI, sans-serif"
      },
      shape: shapeType,
      borderWidth: borderWidth,
      margin: 10,
      shadow: act.is_critical ? {
        enabled: true,
        color: "rgba(239, 68, 68, 0.4)",
        size: 8,
        x: 0,
        y: 0
      } : {
        enabled: true,
        color: "rgba(0, 0, 0, 0.06)",
        size: 4,
        x: 2,
        y: 2
      }
    });
  });

  // Construct vis-network edges
  const edges = [];
  rawDependencies.forEach(dep => {
    const fromId = dep.from_activity_id || dep.from;
    const toId = dep.to_activity_id || dep.to;

    if (visibleActIds.has(fromId) && visibleActIds.has(toId)) {
      let depType = dep.type || "FS";
      if (depType.includes("(") && depType.includes(")")) {
        depType = depType.split("(")[1].replace(")", "").trim();
      } else {
        depType = depType.trim().toUpperCase();
      }

      const lag = parseFloat(dep.lag_days || 0);
      let edgeColor = "#3B82F6";
      let dashes = false;

      if (depType === "SS") {
        edgeColor = "#7C3AED";
      } else if (depType === "FF") {
        edgeColor = "#0891B2";
      } else if (depType === "SF") {
        edgeColor = "#DC2626";
        dashes = [5, 5];
      }

      let edgeLabel = depType;
      if (lag > 0) edgeLabel = `${depType} +${lag}d`;

      edges.push({
        from: fromId,
        to: toId,
        label: ` ${edgeLabel} `,
        font: {
          color: edgeColor,
          size: 10,
          bold: true,
          align: "horizontal",
          background: "#FFFFFF",
          strokeWidth: 0
        },
        color: { color: edgeColor, highlight: "#2563EB" },
        width: depType === "SF" ? 2.5 : 2,
        dashes: dashes,
        arrows: { to: { enabled: true, scaleFactor: 0.85 } }
      });
    }
  });

  const data = {
    nodes: new vis.DataSet(nodes),
    edges: new vis.DataSet(edges)
  };

  const options = {
    layout: {
      hierarchical: {
        enabled: edges.length > 0,
        direction: "LR",
        sortMethod: "directed",
        levelSeparation: 260,
        nodeSpacing: 110,
        treeSpacing: 160
      }
    },
    physics: false,
    nodes: {
      margin: 10,
      widthConstraint: { minimum: 150, maximum: 220 }
    },
    edges: {
      smooth: { type: "cubicBezier", forceDirection: "horizontal", roundness: 0.3 }
    },
    interaction: {
      hover: true,
      zoomView: true,
      dragView: true,
      selectable: true
    }
  };

  if (ctrlScurveState.ctrlNetworkInstance) {
    try {
      ctrlScurveState.ctrlNetworkInstance.destroy();
    } catch (e) {
      // ignore
    }
    ctrlScurveState.ctrlNetworkInstance = null;
  }

  ctrlPdmCanvas.innerHTML = "";
  ctrlScurveState.ctrlNetworkInstance = new vis.Network(ctrlPdmCanvas, data, options);
  ctrlPdmCanvas._visNetwork = ctrlScurveState.ctrlNetworkInstance;
  if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
  window.SyncFlowNetworks["ctrl-pdm-network-canvas"] = ctrlScurveState.ctrlNetworkInstance;

  // Node click handler: opens execution update modal
  ctrlScurveState.ctrlNetworkInstance.on("click", (params) => {
    if (params.nodes && params.nodes.length > 0) {
      const clickedId = params.nodes[0];
      const act = rawActivities.find(a => a.activity_id === clickedId);
      if (act && typeof onNodeClick === "function") {
        onNodeClick(act);
      }
    }
  });
}

// ==========================================
// ZOOM CONTROLS SETUP
// ==========================================
export function initCtrlPdmControls(onFilterChange) {
  const btnCtrlPdmZoomIn = document.getElementById("btn-ctrl-pdm-zoom-in");
  const btnCtrlPdmZoomOut = document.getElementById("btn-ctrl-pdm-zoom-out");
  const btnCtrlPdmFit = document.getElementById("btn-ctrl-pdm-fit");
  const ctrlPdmFilterMode = document.getElementById("ctrl-pdm-filter-mode");

  wireNetworkZoomControls(() => ctrlScurveState.ctrlNetworkInstance, btnCtrlPdmZoomIn, btnCtrlPdmZoomOut, btnCtrlPdmFit);

  if (ctrlPdmFilterMode && !ctrlPdmFilterMode._hasListener) {
    ctrlPdmFilterMode._hasListener = true;
    ctrlPdmFilterMode.addEventListener("change", () => {
      if (typeof onFilterChange === "function") {
        onFilterChange();
      }
    });
  }
}
