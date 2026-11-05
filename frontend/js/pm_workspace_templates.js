/**
 * SyncFlow Frontend - Project Manager Workspace UI Templates (pm_workspace_templates.js)
 * Encapsulates HTML templates and table generators for PMBOK workspace views.
 */

import { formatDurationSeconds } from "./utility.js";

/**
 * Generates HTML markup for the overall DCMA 14-Point score banner and summary grid.
 */
export function renderDcmaScoreCardHtml({ score, grade, gradeColor, passCount, warnCount, failCount, cardsHtml }) {
  return `
    <div class="dcma-score-card">
      <div class="dcma-score-circle" style="border-color: ${gradeColor};">
        <span style="font-size: 1.6rem; font-weight: 800; color: ${gradeColor};">${score}%</span>
        <span style="font-size: 0.75rem; font-weight: 700; color: var(--slate);">Grade ${grade}</span>
      </div>
      <div style="flex: 1;">
        <h3 style="margin: 0; font-size: 1.3rem; color: var(--charcoal);">DCMA 14-Point Automated Schedule Quality Diagnostic</h3>
        <p style="margin: 4px 0 0.8rem 0; font-size: 0.86rem; color: var(--muted);">
          Defense Contract Management Agency (DCMA) industry standard audit evaluating schedule integrity, missing logic, float distortions, leads, and relationship validity.
        </p>
        <div style="display: flex; gap: 12px; font-size: 0.85rem; font-weight: 600; flex-wrap: wrap;">
          <span style="color: #059669;">✓ ${passCount} Checks Passed</span>
          <span style="color: #D97706;">⚠️ ${warnCount} Warnings</span>
          <span style="color: #DC2626;">❌ ${failCount} Failures</span>
        </div>
      </div>
    </div>
    <div class="dcma-grid">${cardsHtml}</div>
  `;
}

/**
 * Generates HTML markup for an individual DCMA metric card with status, violations count, and culprits list.
 */
export function renderDcmaCardHtml({ m, statusPillClass, statusLabel, violationsCount, ratioDisplay, thresholdDisplay, culpritsHtml }) {
  return `
    <div class="dcma-card ${m.status}">
      <div class="dcma-card-header">
        <span class="dcma-metric-num">${m.name || (m.id + '. Metric')}</span>
        <span class="${statusPillClass}">${statusLabel}</span>
      </div>
      <div class="dcma-metric-desc">${m.description}</div>
      <div class="dcma-metric-stats">
        <span>Violations: <strong>${violationsCount}</strong></span>
        <span>Ratio: <strong>${ratioDisplay}</strong> (Max: ${thresholdDisplay})</span>
      </div>
      ${culpritsHtml}
    </div>
  `;
}


/**
 * Generates HTML table row markup for an activity in the Develop Schedule CPM matrix table.
 */
export function renderScheduleMatrixRowHtml(r, rowClass, badgeHtml) {
  return `
    <tr class="${rowClass}">
      <td><code style="font-weight: 700; color: var(--charcoal);">${r.activity_id}</code></td>
      <td style="font-weight: 600; color: var(--charcoal);">
        ${r.name}
        ${r.work_package_id ? `<div style="font-size: 0.74rem; color: var(--muted); font-weight: normal;">WP: ${r.work_package_id}</div>` : ""}
      </td>
      <td style="text-align: right; font-family: monospace; font-weight: 700;">${r.duration.toFixed(1)} d</td>
      <td style="text-align: right; font-family: monospace;">${r.es.toFixed(1)}</td>
      <td style="text-align: right; font-family: monospace;">${r.ef.toFixed(1)}</td>
      <td style="text-align: right; font-family: monospace;">${r.ls.toFixed(1)}</td>
      <td style="text-align: right; font-family: monospace;">${r.lf.toFixed(1)}</td>
      <td style="text-align: right; font-family: monospace; font-weight: 700; color: ${r.is_critical ? '#DC2626' : (r.is_near_critical ? '#D97706' : '#2563EB')};">
        ${r.total_float.toFixed(1)} d
      </td>
      <td style="text-align: right; font-family: monospace; color: ${r.free_float === 0 ? '#64748B' : '#059669'};">
        ${r.free_float.toFixed(1)} d
      </td>
      <td style="font-size: 0.78rem; white-space: nowrap;">
        <div><strong>ES:</strong> ${r.early_start_date}</div>
        <div style="color: var(--muted);"><strong>EF:</strong> ${r.early_finish_date}</div>
      </td>
      <td>${badgeHtml}</td>
    </tr>
  `;
}

/**
 * Generates HTML table row markup for duration estimation (Beta PERT, Parametric, Analogous, Single-Point).
 */
export function renderEstimateRowHtml({ aid, act, wpName, tech, inputsHtml, te, sigma, varVal, isCrit, pathBadge, sigmaBadgeColor }) {
  const isMilestone = Boolean(act && act.is_milestone);
  return `
    <tr data-row-id="${aid}" style="${isCrit ? 'background: #FFFBFB;' : ''}">
      <td>
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
          <strong style="color: var(--charcoal); font-size: 0.9rem;">${aid}</strong>
          ${pathBadge}
        </div>
        <div style="font-weight: 600; color: var(--charcoal); font-size: 0.86rem; margin-bottom: 2px;">${act.name}</div>
        <div style="font-size: 0.76rem; color: var(--slate);">${wpName}</div>
      </td>
      <td>
        ${isMilestone ? `
          <span class="badge badge-secondary" style="padding: 5px 8px; font-size: 0.78rem; font-weight: 700;">🎯 Milestone</span>
        ` : `
          <select class="form-control pert-select-tech" data-id="${aid}" style="padding: 4px 6px; font-size: 0.8rem; font-weight: 600;">
            <option value="three_point" ${tech === 'three_point' ? 'selected' : ''}>🎲 Three-Point (Beta)</option>
            <option value="parametric" ${tech === 'parametric' ? 'selected' : ''}>📐 Parametric</option>
            <option value="analogous" ${tech === 'analogous' ? 'selected' : ''}>📜 Analogous</option>
            <option value="single_point" ${tech === 'single_point' ? 'selected' : ''}>🎯 Single-Point</option>
          </select>
        `}
      </td>
      <td>${inputsHtml}</td>
      <td style="text-align: right;">
        <span class="cell-te-${aid}" style="font-size: 1.15rem; font-weight: 800; color: #1E293B; font-family: monospace;">
          ${te.toFixed(1)}
        </span>
        <span style="font-size: 0.78rem; color: var(--muted); font-weight: 600;">d</span>
      </td>
      <td style="text-align: center;">
        <div class="cell-sigma-${aid}" style="display: inline-block; font-size: 0.78rem; font-weight: 700; color: ${sigmaBadgeColor}; background: #F8FAFC; border: 1px solid var(--border-light); padding: 2px 7px; border-radius: 4px;">
          ± ${sigma.toFixed(1)}d
        </div>
        <div class="cell-var-${aid}" style="font-size: 0.7rem; color: var(--muted); margin-top: 1px;">
          σ²: ${varVal.toFixed(2)}
        </div>
      </td>
    </tr>
  `;
}

/**
 * Generates HTML table row markup for an operational activity in the Control Project view.
 */
export function renderControlTaskRowHtml(a, statusPillClass, statusIcon, statusText, cpBadge, svColor) {
  return `
    <tr style="border-bottom: 1px solid var(--border-light); vertical-align: middle;">
      <td style="padding: 8px;">
        <div class="${statusPillClass}" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">
          <span>${statusIcon}</span>
          <span>${statusText}</span>
        </div>
      </td>
      <td style="padding: 8px; font-weight: 600; color: var(--charcoal); max-width: 220px;">
        <code>${a.activity_id}</code>
        <div style="font-size: 0.82rem; margin-top: 2px;">${a.name}</div>
        <div style="font-size: 0.72rem; color: var(--muted);">${a.work_package_id || ""}</div>
      </td>
      <td style="padding: 8px; text-align: center;">${cpBadge}</td>
      <td style="padding: 8px; text-align: right; font-size: 0.78rem; font-family: monospace;">
        <div>${a.planned_start_date || "-"}</div>
        <div style="color: var(--muted);">➔ ${a.planned_finish_date || "-"}</div>
        <div style="font-weight: 700;">${a.duration.toFixed(1)}d</div>
      </td>
      <td style="padding: 8px; text-align: right; font-size: 0.78rem; font-family: monospace;">
        <div>${a.actual_start_date || `<span style="color: var(--muted);">Not started</span>`}</div>
        <div style="color: var(--muted);">${a.actual_finish_date ? `➔ ${a.actual_finish_date}` : ""}</div>
      </td>
      <td style="padding: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 700; margin-bottom: 3px;">
          <span>${a.progress_pct.toFixed(0)}%</span>
        </div>
        <div style="height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden;">
          <div style="width: ${a.progress_pct}%; height: 100%; background: ${a.status === 'verified' ? '#2563EB' : (a.status === 'completed' ? '#16A34A' : '#EAB308')};"></div>
        </div>
      </td>
      <td style="padding: 8px; text-align: right; font-family: monospace; font-size: 0.78rem;">
        <div>EV: <strong>${a.ev_days.toFixed(1)}d</strong></div>
        <div style="color: var(--muted);">PV: ${a.pv_days.toFixed(1)}d</div>
      </td>
      <td style="padding: 8px; text-align: right; font-family: monospace; font-weight: 700; color: ${svColor};">
        ${a.sv_days >= 0 ? `+${a.sv_days.toFixed(1)}d` : `${a.sv_days.toFixed(1)}d`}
      </td>
      <td style="padding: 8px; font-size: 0.78rem;">
        ${a.status === "verified" ? `
          <div style="color: #1E40AF; font-weight: 700; display: flex; align-items: center; gap: 4px;">
            <span>🛡️</span> Verified
          </div>
          <div style="color: var(--muted); font-size: 0.72rem;">${a.verified_by || "Controller"}</div>
          <div style="color: var(--muted); font-size: 0.7rem;">${a.verified_date || ""}</div>
        ` : `<span style="color: var(--muted);">Pending Sign-off</span>`}
      </td>
      <td style="padding: 8px; text-align: center; white-space: nowrap;">
        <select class="ctrl-row-status-select" data-act-id="${a.activity_id}" style="padding: 3px 6px; font-size: 0.78rem; font-weight: 600; border-radius: 4px; border: 1px solid var(--border); margin-right: 4px;">
          <option value="not_started" ${a.status === 'not_started' ? 'selected' : ''}>⚪ White: Not Started</option>
          <option value="in_progress" ${a.status === 'in_progress' ? 'selected' : ''}>🟡 Yellow: In-Progress</option>
          <option value="completed" ${a.status === 'completed' ? 'selected' : ''}>🟢 Green: Completed</option>
          <option value="verified" ${a.status === 'verified' ? 'selected' : ''}>🔵 Blue: Verified</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm btn-edit-act-ctrl" data-act-id="${a.activity_id}" title="Edit detailed dates and controller sign-off" style="padding: 2px 7px; font-size: 0.78rem;">
          ✏️
        </button>
        <button type="button" class="btn btn-outline-primary btn-sm btn-view-act-timelogs" data-act-id="${a.activity_id}" title="Inspect logged time and contributor history" style="padding: 2px 7px; font-size: 0.78rem; font-weight: 700; margin-left: 3px; white-space: nowrap;">
          ⏱️ ${formatDurationSeconds(a.total_logged_seconds || 0)}
        </button>
      </td>
    </tr>
  `;
}
