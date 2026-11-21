/**
 * SyncFlow Frontend - PM View 2: Work Breakdown Structure (pm_view2_wbs.js)
 * Implements:
 *  - WBS canonical hierarchical recalculation (Level 1 Project -> Level 2 Deliverables -> Sub-deliverables -> Work Packages)
 *  - Interactive Structured Builder view
 *  - WBS element creation and edit modal
 *  - Vis-Network tree visualization tab
 *  - WBS persistence to MongoDB backend
 */

import {
  updateProjectWbs,
  updateProjectActivities
} from "./api.js";
import { renderWbsTree } from "./visualizations.js";
import { pmState } from "./pm_workspace_state.js";

// =========================================================================
// MODULE SCOPE REFERENCES & CALLBACKS
// =========================================================================
let callbacks = {
  renderDefineActivitiesTab: () => {},
  onSelectWorkPackage: (wpId) => {}
};

// DOM References
let wbsSaveStatus = null;
let wbsAlertMsg = null;
let btnAddActivityTop = null;
let btnSaveWbsActivities = null;
let wbsTabButtons = [];
let wbsCardsContainer = null;
let wbsCanvas = null;

let tabPanes = {
  tree: null,
  builder: null,
  activities: null
};

// WBS Modal References
let wbsModal = null;
let wbsModalTitle = null;
let btnCloseWbsModal = null;
let btnCancelWbsModal = null;
let wbsElementForm = null;
let wbsEditMode = null;
let wbsNodeId = null;
let wbsParentId = null;
let selectWbsType = null;
let groupParentElement = null;
let selectParentElement = null;
let inputWbsName = null;
let inputWbsDesc = null;

/**
 * Initializes View 2 WBS Tab & Structure Controller.
 */
export function initWbsController(cbs = {}) {
  callbacks = { ...callbacks, ...cbs };

  // View 2 DOM References
  wbsSaveStatus = document.getElementById("wbs-save-status");
  wbsAlertMsg = document.getElementById("wbs-alert-msg");
  btnAddActivityTop = document.getElementById("btn-add-activity-top");
  btnSaveWbsActivities = document.getElementById("btn-save-wbs-activities");
  wbsTabButtons = document.querySelectorAll(".wbs-tab-btn");
  wbsCardsContainer = document.getElementById("wbs-cards-container");
  wbsCanvas = document.getElementById("wbs-network-canvas");

  tabPanes = {
    tree: document.getElementById("tab-pane-wbs-tree"),
    builder: document.getElementById("tab-pane-wbs-builder"),
    activities: document.getElementById("tab-pane-wbs-activities")
  };

  // WBS Modal References
  wbsModal = document.getElementById("wbs-element-modal");
  wbsModalTitle = document.getElementById("wbs-modal-title");
  btnCloseWbsModal = document.getElementById("btn-close-wbs-modal");
  btnCancelWbsModal = document.getElementById("btn-cancel-wbs-modal");
  wbsElementForm = document.getElementById("wbs-element-form");
  wbsEditMode = document.getElementById("wbs-edit-mode");
  wbsNodeId = document.getElementById("wbs-node-id");
  wbsParentId = document.getElementById("wbs-parent-id");
  selectWbsType = document.getElementById("select-wbs-type");
  groupParentElement = document.getElementById("group-parent-element");
  selectParentElement = document.getElementById("select-parent-element");
  inputWbsName = document.getElementById("input-wbs-name");
  inputWbsDesc = document.getElementById("input-wbs-desc");

  // Initial structure normalization: Only migrate if wbs is undefined/null
  const project = pmState.project || {};
  if (project.wbs === undefined || project.wbs === null) {
    if (project.deliverables && project.deliverables.length > 0) {
      project.wbs = project.deliverables.map((d, dIdx) => {
        const dNum = `${dIdx + 1}`;
        const subs = (d.sub_deliverables || []).map((s, sIdx) => {
          const sNum = `${dNum}.${sIdx + 1}`;
          const wps = (s.work_packages || []).map((w, wIdx) => ({
            id: w.work_package_id || `WP-${sNum}.${wIdx + 1}`,
            wbs_number: `${sNum}.${wIdx + 1}`,
            name: w.name || `Work Package ${sNum}.${wIdx + 1}`,
            description: w.description || null,
            type: "work_package",
            children: []
          }));
          return {
            id: s.sub_deliverable_id || `SUB-${sNum}`,
            wbs_number: sNum,
            name: s.name || `Sub-deliverable ${sNum}`,
            description: s.description || null,
            type: wps.length > 0 ? "sub_deliverable" : "work_package",
            children: wps
          };
        });
        return {
          id: d.deliverable_id || `DEL-${dNum}`,
          wbs_number: dNum,
          name: d.name || `Major Deliverable ${dNum}`,
          description: d.description || null,
          type: "major_deliverable",
          children: subs
        };
      });
    } else {
      project.wbs = [];
    }
  }
  if (!project.activities) {
    project.activities = [];
  }

  // Bind tab switching
  wbsTabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchWbsTab(tab);
    });
  });

  // Top toolbar Add Major Deliverable button
  if (btnAddActivityTop) {
    btnAddActivityTop.addEventListener("click", () => {
      openWbsModal({ mode: "add", presetType: "major_deliverable" });
    });
  }

  // Modal close buttons
  if (btnCloseWbsModal) btnCloseWbsModal.addEventListener("click", closeWbsModal);
  if (btnCancelWbsModal) btnCancelWbsModal.addEventListener("click", closeWbsModal);

  // WBS Element Form Submit
  if (wbsElementForm) {
    wbsElementForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const mode = wbsEditMode.value;
      const name = inputWbsName.value.trim();
      if (!name) return;
      const description = inputWbsDesc.value.trim() || null;
      const elemType = selectWbsType.value;

      if (mode === "add") {
        if (elemType === "major_deliverable") {
          const nextNum = `${pmState.project.wbs.length + 1}`;
          pmState.project.wbs.push({
            id: `DEL-${nextNum}`,
            wbs_number: nextNum,
            name: name,
            description: description,
            type: "major_deliverable",
            children: []
          });
        } else {
          const targetParentId = selectParentElement.value || wbsParentId.value;
          const parentNode = findWbsNode(targetParentId);
          if (!parentNode) {
            alert("Please select a parent deliverable/container.");
            return;
          }
          if (!parentNode.children) parentNode.children = [];
          parentNode.type = (parentNode.type === "major_deliverable") ? "major_deliverable" : "sub_deliverable";

          const childNum = `${parentNode.wbs_number}.${parentNode.children.length + 1}`;
          const newId = (elemType === "work_package") ? `WP-${childNum}` : `SUB-${childNum}`;
          parentNode.children.push({
            id: newId,
            wbs_number: childNum,
            name: name,
            description: description,
            type: elemType,
            children: []
          });
        }
      } else {
        // Edit
        const editId = wbsNodeId.value;
        const node = findWbsNode(editId);
        if (node) {
          node.name = name;
          node.description = description;
        }
      }

      closeWbsModal();
      setWbsDirty(true);
      recalculateWbsNumbers();
      switchWbsTab(pmState.activeWbsTab);
    });
  }

  // Save All Changes button (Saves both WBS and Activities)
  if (btnSaveWbsActivities) {
    btnSaveWbsActivities.addEventListener("click", async () => {
      const success = await persistWbsAndActivities(true);
      if (success && wbsAlertMsg) {
        wbsAlertMsg.textContent = "✓ Work Breakdown Structure and Activities saved successfully to database.";
        wbsAlertMsg.style.display = "block";
        setTimeout(() => {
          wbsAlertMsg.style.display = "none";
        }, 3500);
        switchWbsTab(pmState.activeWbsTab);
      }
    });
  }
}

// =========================================================================
// WBS PERSISTENCE & AUTO-NUMBERING
// =========================================================================

/**
 * Persists WBS tree and activity modifications to the MongoDB backend.
 */
export async function persistWbsAndActivities(showFeedback = true) {
  recalculateWbsNumbers();
  if (showFeedback && btnSaveWbsActivities) {
    btnSaveWbsActivities.disabled = true;
    btnSaveWbsActivities.textContent = "Saving to Database...";
  }
  try {
    const currentPid = pmState.projectId || (pmState.project ? (pmState.project.id || pmState.project._id) : null);
    const [wbsRes, actRes] = await Promise.all([
      updateProjectWbs(currentPid, (pmState.project && pmState.project.wbs) || []),
      updateProjectActivities(currentPid, (pmState.project && pmState.project.activities) || [])
    ]);
    if (wbsRes && wbsRes.data) {
      pmState.project.wbs = wbsRes.data.wbs || pmState.project.wbs;
      pmState.project.deliverables = wbsRes.data.deliverables || pmState.project.deliverables;
    }
    if (actRes && actRes.data) {
      pmState.project.activities = actRes.data.activities || pmState.project.activities;
    }
    setWbsDirty(false);
    return true;
  } catch (err) {
    console.error("Failed to persist WBS/activities:", err);
    setWbsDirty(true);
    return false;
  } finally {
    if (showFeedback && btnSaveWbsActivities) {
      btnSaveWbsActivities.disabled = false;
      btnSaveWbsActivities.textContent = "💾 Save All Changes";
    }
  }
}

/**
 * Recursively recomputes canonical hierarchical numbering for WBS nodes (e.g. 1.1, 1.2.1).
 */
export function recalculateWbsNumbers(nodes = (pmState.project ? pmState.project.wbs : []), prefix = "") {
  if (!nodes || !Array.isArray(nodes)) return;
  nodes.forEach((node, idx) => {
    const num = prefix ? `${prefix}.${idx + 1}` : `${idx + 1}`;
    node.wbs_number = num;

    const hasChildren = node.children && Array.isArray(node.children) && node.children.length > 0;

    if (!prefix) {
      node.type = "major_deliverable";
    } else if (hasChildren) {
      node.type = "sub_deliverable";
    } else if (node.type !== "sub_deliverable") {
      node.type = "work_package";
    }

    if (!node.id) {
      if (node.type === "major_deliverable") node.id = `DEL-${num}`;
      else if (node.type === "work_package") node.id = `WP-${num}`;
      else node.id = `SUB-${num}`;
    }

    if (hasChildren && node.type !== "work_package") {
      recalculateWbsNumbers(node.children, num);
    } else {
      node.children = [];
    }
  });
}

/**
 * Recursively locates a WBS node by its ID.
 */
export function findWbsNode(id, nodes = (pmState.project ? pmState.project.wbs : [])) {
  if (!nodes) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children && n.children.length > 0) {
      const found = findWbsNode(id, n.children);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recursively locates the parent node of a specified WBS node ID.
 */
export function findWbsParent(id, nodes = (pmState.project ? pmState.project.wbs : []), parent = null) {
  if (!nodes) return null;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { parent, index: i, node: nodes[i] };
    }
    if (nodes[i].children && nodes[i].children.length > 0) {
      const res = findWbsParent(id, nodes[i].children, nodes[i]);
      if (res) return res;
    }
  }
  return null;
}

/**
 * Collects all intermediate container nodes (Major Deliverables and Sub-deliverables).
 */
export function getAllWbsContainers(nodes = (pmState.project ? pmState.project.wbs : []), list = []) {
  if (!nodes) return list;
  nodes.forEach(n => {
    if (n.type === "major_deliverable" || n.type === "sub_deliverable" || (n.children && n.children.length > 0)) {
      list.push(n);
      if (n.children && n.children.length > 0) {
        getAllWbsContainers(n.children, list);
      }
    }
  });
  return list;
}

/**
 * Collects all leaf Work Package nodes eligible for activity assignment.
 */
export function getAllWorkPackages(nodes = (pmState.project ? pmState.project.wbs : []), list = []) {
  if (!nodes) return list;
  nodes.forEach(n => {
    const isLeaf = !n.children || n.children.length === 0 || n.type === "work_package";
    if (isLeaf && n.type === "work_package") {
      list.push(n);
    } else if (n.children && n.children.length > 0) {
      getAllWorkPackages(n.children, list);
    } else if (isLeaf) {
      list.push(n);
    }
  });
  return list;
}

/**
 * Computes breadcrumb hierarchy path leading to a specified WBS node.
 */
export function getWbsPath(id, nodes = (pmState.project ? pmState.project.wbs : []), currentPath = []) {
  if (!nodes) return null;
  for (const n of nodes) {
    const pathWithCurrent = [...currentPath, n];
    if (n.id === id) return pathWithCurrent;
    if (n.children && n.children.length > 0) {
      const found = getWbsPath(id, n.children, pathWithCurrent);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Toggles unsaved changes state and shows/hides the pending save banner.
 */
export function setWbsDirty(isDirty) {
  pmState.hasUnsavedWbsChanges = isDirty;
  if (wbsSaveStatus) {
    if (isDirty) {
      wbsSaveStatus.textContent = "Unsaved Changes";
      wbsSaveStatus.className = "badge badge-amber";
      wbsSaveStatus.style.display = "inline-block";
    } else {
      wbsSaveStatus.textContent = "All Changes Saved";
      wbsSaveStatus.className = "badge badge-emerald";
      wbsSaveStatus.style.display = "inline-block";
    }
  }
}

// =========================================================================
// TAB SWITCHING & RENDERING
// =========================================================================

/**
 * Switches between WBS Tree hierarchy view and Define Activities tab.
 */
export function switchWbsTab(tabName) {
  pmState.activeWbsTab = tabName;
  wbsTabButtons.forEach(btn => {
    if (btn.getAttribute("data-tab") === tabName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  Object.keys(tabPanes).forEach(k => {
    if (tabPanes[k]) {
      tabPanes[k].style.display = (k === tabName) ? "block" : "none";
    }
  });

  const projectName = pmState.project.name || "Untitled Project";
  if (tabName === "tree") {
    renderWbsTree(wbsCanvas, projectName, pmState.project.wbs, pmState.userMap, pmState.project.teams);
  } else if (tabName === "builder") {
    renderStructuredBuilder();
  } else if (tabName === "activities") {
    callbacks.renderDefineActivitiesTab();
  }
}

/**
 * Main render dispatcher for Section 2 (Scope & Work Breakdown Structure).
 */
export function renderWbsView() {
  recalculateWbsNumbers();
  switchWbsTab(pmState.activeWbsTab || "builder");
}

/**
 * Recursively generates HTML tree node markup for structured WBS elements.
 */
function renderWbsNodeHtml(node, depth = 0) {
  const isLeaf = !node.children || node.children.length === 0 || node.type === "work_package";
  const num = node.wbs_number || "";

  if (depth === 0) {
    // Level 2: Major Deliverable
    let childrenHtml = "";
    if (node.children && node.children.length > 0) {
      childrenHtml = node.children.map(child => renderWbsNodeHtml(child, depth + 1)).join("");
    }

    return `
      <div class="wbs-activity-card" data-node-id="${node.id}" style="background: #FFFFFF; border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: var(--radius-sm); padding: 1.1rem 1.3rem; margin-bottom: 1.1rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 0.8rem; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 260px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
              <span class="badge badge-blue" style="font-weight: 700; font-size: 0.82rem;">Level 2: Major Deliverable [${num}]</span>
              <h4 style="margin: 0; font-size: 1.1rem; color: var(--charcoal);">${node.name}</h4>
            </div>
            ${node.description ? `<p style="margin: 2px 0 6px 0; font-size: 0.84rem; color: var(--muted);">${node.description}</p>` : ""}
            <div style="font-size: 0.82rem; color: var(--slate);">
              <strong>${(node.children || []).length} Elements inside</strong>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-sub" data-parent-id="${node.id}" style="padding: 4px 10px; font-size: 0.8rem;">
              ➕ Add Sub-deliverable
            </button>
            <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-wp" data-parent-id="${node.id}" style="padding: 4px 10px; font-size: 0.8rem;">
              ➕ Add Work Package
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-wbs-edit-node" data-node-id="${node.id}" style="padding: 4px 8px; font-size: 0.8rem;" title="Edit Element">
              ✏️
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-wbs-del-node" data-node-id="${node.id}" style="padding: 4px 8px; font-size: 0.8rem; color: #DC2626;" title="Delete Element">
              🗑️
            </button>
          </div>
        </div>

        <div style="padding-left: 0.9rem; border-left: 2px dashed #93C5FD; margin-top: 0.6rem;">
          ${childrenHtml || `<p style="font-size: 0.82rem; color: var(--muted); margin: 6px 0;">No elements in this deliverable. Click '+ Add Sub-deliverable' or '+ Add Work Package' to decompose this outcome.</p>`}
        </div>
      </div>
    `;
  }

  if (!isLeaf) {
    let childrenHtml = "";
    if (node.children && node.children.length > 0) {
      childrenHtml = node.children.map(child => renderWbsNodeHtml(child, depth + 1)).join("");
    }

    return `
      <div class="wbs-sub-card" data-node-id="${node.id}" style="background: #F8FAFC; border: 1px solid var(--border-light); border-left: 3px solid #6366F1; border-radius: var(--radius-sm); padding: 0.9rem 1.1rem; margin-bottom: 0.8rem;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
              <span class="badge" style="background: #EEF2FF; color: #4F46E5; font-weight: 700; font-size: 0.78rem;">Sub-deliverable [${num}]</span>
              <strong style="color: var(--charcoal); font-size: 0.95rem;">${node.name}</strong>
            </div>
            ${node.description ? `<p style="margin: 2px 0 4px 0; font-size: 0.82rem; color: var(--muted);">${node.description}</p>` : ""}
            <div style="font-size: 0.8rem; color: var(--slate);">
              <span>${(node.children || []).length} Elements inside</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-sub" data-parent-id="${node.id}" style="padding: 3px 8px; font-size: 0.76rem;">
              ➕ Sub-deliverable
            </button>
            <button type="button" class="btn btn-outline-primary btn-sm btn-wbs-add-wp" data-parent-id="${node.id}" style="padding: 3px 8px; font-size: 0.76rem;">
              ➕ Work Package
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-wbs-edit-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem;" title="Edit Element">
              ✏️
            </button>
            <button type="button" class="btn btn-secondary btn-sm btn-wbs-del-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem; color: #DC2626;" title="Delete Element">
              🗑️
            </button>
          </div>
        </div>

        <div style="padding-left: 0.8rem; border-left: 2px dashed #CBD5E1; margin-top: 0.6rem;">
          ${childrenHtml || `<p style="font-size: 0.78rem; color: var(--muted); margin: 4px 0;">No child elements. Click '+ Sub-deliverable' to group further, or '+ Work Package' to define a work package.</p>`}
        </div>
      </div>
    `;
  }

  // Terminal Node: Work Package (Leaf)
  const wpActs = (pmState.project.activities || []).filter(a => a.work_package_id === node.id);

  return `
    <div class="wbs-wp-card" data-node-id="${node.id}" style="background: #FFFFFF; border: 1px solid #A7F3D0; border-left: 3px solid #10B981; border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin-bottom: 0.6rem;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 220px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
            <span class="badge" style="background: #ECFDF5; color: #047857; font-weight: 700; font-size: 0.76rem;">Work Package [${num}]</span>
            <strong style="color: var(--charcoal); font-size: 0.9rem;">${node.name}</strong>
            <span class="badge ${wpActs.length > 0 ? 'badge-blue' : 'badge-slate'}" style="font-size: 0.74rem;">
              📝 ${wpActs.length} Activities
            </span>
          </div>
          ${node.description ? `<p style="margin: 2px 0 0 0; font-size: 0.8rem; color: var(--muted);">${node.description}</p>` : ""}
        </div>
        <div style="display: flex; gap: 5px; align-items: center;">
          <button type="button" class="btn btn-primary btn-sm btn-goto-activities" data-wp-id="${node.id}" style="padding: 3px 10px; font-size: 0.76rem;" title="Define concrete activities for this Work Package">
            📝 Define Activities (${wpActs.length})
          </button>
          <button type="button" class="btn btn-secondary btn-sm btn-wbs-edit-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem;" title="Edit Work Package">
            ✏️
          </button>
          <button type="button" class="btn btn-secondary btn-sm btn-wbs-del-node" data-node-id="${node.id}" style="padding: 3px 7px; font-size: 0.76rem; color: #DC2626;" title="Delete Work Package">
            🗑️
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders the complete structured WBS tree hierarchy view.
 */
export function renderStructuredBuilder() {
  recalculateWbsNumbers();
  const deliverables = pmState.project.wbs || [];
  const projectName = pmState.project.name || "Untitled Project";

  let deliverablesHtml = "";
  if (deliverables.length === 0) {
    deliverablesHtml = `
      <div style="background: #F8FAFC; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 2.5rem 1.5rem; text-align: center; color: var(--muted); margin: 0.5rem 0;">
        <div style="font-size: 2.2rem; margin-bottom: 0.4rem;">📦</div>
        <h4 style="color: var(--charcoal); margin-bottom: 0.3rem;">No Major Deliverables Created Yet</h4>
        <p style="font-size: 0.88rem; max-width: 480px; margin: 0 auto 1.2rem auto; line-height: 1.5;">
          Decompose this project into Level 2 Major Deliverables (the primary components and outcomes).
        </p>
        <button type="button" class="btn btn-primary btn-sm btn-builder-add-act-container">
          ➕ Add First Major Deliverable (Level 2)
        </button>
      </div>
    `;
  } else {
    deliverablesHtml = deliverables.map(d => renderWbsNodeHtml(d, 0)).join("");
  }

  // Outer Container: Level 1 (Project)
  const projectContainerHtml = `
    <div class="wbs-project-container-card" style="background: #FFFFFF; border: 2px solid #202938; border-radius: var(--radius-md); padding: 1.4rem 1.6rem; box-shadow: var(--shadow-sm); margin-bottom: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 1.2rem; border-bottom: 2px solid var(--border-light); padding-bottom: 1rem; flex-wrap: wrap;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
            <span class="badge" style="background: #202938; color: #FFFFFF; font-weight: 700; font-size: 0.85rem; padding: 4px 10px;">
              Level 1: Project
            </span>
            <h3 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: #202938;">
              ${projectName}
            </h3>
          </div>
          <div style="font-size: 0.85rem; color: var(--slate); margin-top: 5px;">
            <span>Major Deliverables: <strong>${deliverables.length}</strong></span>
            ${pmState.project.description ? `<p style="margin: 6px 0 0 0; font-size: 0.84rem; color: var(--muted); line-height: 1.4;">${pmState.project.description}</p>` : ""}
          </div>
        </div>
        <div>
          <button type="button" class="btn btn-primary btn-sm btn-builder-add-act-container">
            ➕ Add Major Deliverable (Level 2)
          </button>
        </div>
      </div>

      <div class="wbs-activities-list">
        ${deliverablesHtml}
      </div>
    </div>
  `;

  if (wbsCardsContainer) {
    wbsCardsContainer.innerHTML = projectContainerHtml;

    // Attach Add Major Deliverable listeners
    wbsCardsContainer.querySelectorAll(".btn-builder-add-act-container").forEach(btn => {
      btn.addEventListener("click", () => {
        openWbsModal({ mode: "add", presetType: "major_deliverable" });
      });
    });

    // Attach Add Sub-deliverable listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-add-sub").forEach(btn => {
      btn.addEventListener("click", () => {
        const parentId = btn.getAttribute("data-parent-id");
        openWbsModal({ mode: "add", parentId: parentId, presetType: "sub_deliverable" });
      });
    });

    // Attach Add Work Package listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-add-wp").forEach(btn => {
      btn.addEventListener("click", () => {
        const parentId = btn.getAttribute("data-parent-id");
        openWbsModal({ mode: "add", parentId: parentId, presetType: "work_package" });
      });
    });

    // Attach Edit Element listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-edit-node").forEach(btn => {
      btn.addEventListener("click", () => {
        const nodeId = btn.getAttribute("data-node-id");
        openWbsModal({ mode: "edit", nodeId: nodeId });
      });
    });

    // Attach Delete Element listeners
    wbsCardsContainer.querySelectorAll(".btn-wbs-del-node").forEach(btn => {
      btn.addEventListener("click", async () => {
        const nodeId = btn.getAttribute("data-node-id");
        const nodeInfo = findWbsParent(nodeId);
        if (!nodeInfo) return;

        const node = nodeInfo.node;
        if (confirm(`Are you sure you want to delete "${node.name}" (${node.wbs_number}) and all its nested sub-elements?`)) {
          const removedWpIds = new Set();
          function collectWpIds(n) {
            if (!n) return;
            if (n.type === "work_package" || !n.children || n.children.length === 0) {
              if (n.id) removedWpIds.add(n.id);
            }
            if (n.children && Array.isArray(n.children)) {
              n.children.forEach(collectWpIds);
            }
          }
          collectWpIds(node);

          if (!nodeInfo.parent) {
            pmState.project.wbs.splice(nodeInfo.index, 1);
          } else {
            nodeInfo.parent.children.splice(nodeInfo.index, 1);
            if (nodeInfo.parent.children.length === 0 && nodeInfo.parent.type !== "major_deliverable") {
              nodeInfo.parent.type = "work_package";
            }
          }

          if (removedWpIds.size > 0 && Array.isArray(pmState.project.activities)) {
            pmState.project.activities = pmState.project.activities.filter(a => !removedWpIds.has(a.work_package_id));
          }

          await persistWbsAndActivities(false);
          renderStructuredBuilder();
        }
      });
    });

    // Attach Goto Activities buttons on Work Packages
    wbsCardsContainer.querySelectorAll(".btn-goto-activities").forEach(btn => {
      btn.addEventListener("click", () => {
        const wpId = btn.getAttribute("data-wp-id");
        callbacks.onSelectWorkPackage(wpId);
        switchWbsTab("activities");
      });
    });
  }
}

// =========================================================================
// WBS ELEMENT MODAL ACTIONS
// =========================================================================

/**
 * Opens modal dialog to create or edit a WBS Deliverable, Sub-deliverable, or Work Package.
 */
export function openWbsModal({ mode = "add", nodeId = null, parentId = null, presetType = "sub_deliverable" }) {
  if (!wbsModal) return;
  wbsEditMode.value = mode;
  wbsNodeId.value = nodeId || "";
  wbsParentId.value = parentId || "";

  const containers = getAllWbsContainers();

  if (mode === "add") {
    selectWbsType.disabled = false;
    selectWbsType.value = presetType;

    if (presetType === "major_deliverable") {
      wbsModalTitle.textContent = "Add Major Deliverable (Level 2)";
      groupParentElement.style.display = "none";
    } else {
      wbsModalTitle.textContent = presetType === "work_package" ? "Add Work Package (Terminal Leaf)" : "Add Sub-deliverable (Intermediate Node)";
      groupParentElement.style.display = "block";

      let optHtml = "";
      containers.forEach(c => {
        const isSelected = c.id === parentId;
        optHtml += `<option value="${c.id}" ${isSelected ? "selected" : ""}>[${c.wbs_number}] ${c.name}</option>`;
      });
      selectParentElement.innerHTML = optHtml;
    }

    inputWbsName.value = "";
    inputWbsDesc.value = "";
  } else {
    // Edit mode
    const node = findWbsNode(nodeId);
    if (!node) return;

    wbsModalTitle.textContent = `Edit Element [${node.wbs_number}]`;
    selectWbsType.value = node.type || "sub_deliverable";
    selectWbsType.disabled = true;
    groupParentElement.style.display = "none";

    inputWbsName.value = node.name || "";
    inputWbsDesc.value = node.description || "";
  }

  selectWbsType.onchange = () => {
    const curType = selectWbsType.value;
    if (curType === "major_deliverable") {
      groupParentElement.style.display = "none";
    } else {
      groupParentElement.style.display = "block";
      if (selectParentElement.children.length === 0) {
        let optHtml = "";
        containers.forEach(c => {
          optHtml += `<option value="${c.id}">[${c.wbs_number}] ${c.name}</option>`;
        });
        selectParentElement.innerHTML = optHtml;
      }
    }
  };

  wbsModal.style.display = "flex";
  inputWbsName.focus();
}

/**
 * Closes the WBS element modal dialog.
 */
export function closeWbsModal() {
  if (wbsModal) wbsModal.style.display = "none";
}
