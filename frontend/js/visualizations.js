/**
 * SyncFlow Frontend – Visualizations Component
 * Replaces Streamlit st.graphviz_chart with interactive vis-network canvas graphs.
 * Renders:
 * 1. Top-to-Bottom Hierarchical WBS Tree (Project -> Activities -> Tasks -> Operations)
 * 2. Left-to-Right Project Network Diagram (Precedence Diagramming Method - PDM)
 */

/**
 * Calculates PERT expected duration: Te = (O + 4M + P) / 6
 */
export function calculatePertTe(act) {
  const opt = parseFloat(act.optimistic_time) || 0;
  const most = parseFloat(act.most_likely_time) || 0;
  const pess = parseFloat(act.pessimistic_time) || 0;
  if (!opt && !most && !pess) return null;
  return ((opt + 4 * most + pess) / 6.0).toFixed(1);
}

/**
 * Renders the Hierarchical WBS Tree in the specified container element.
 * Supports arbitrary depth:
 * Level 1 (Project) -> Level 2 (Major Deliverables) -> Sub-deliverables (Containers) -> Work Packages (Leaves)
 */
export function renderWbsTree(containerElement, projectName, wbsItems, userMap = null, teamList = []) {
  if (!containerElement) return;

  if (typeof vis === "undefined" || !vis.Network) {
    containerElement.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--danger);">
        Visualization library (vis-network) failed to load. Please verify your internet connection.
      </div>
    `;
    return;
  }

  const items = wbsItems || [];
  if (items.length === 0) {
    containerElement.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--muted);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📊</div>
        <h4>No WBS Deliverables Configured Yet</h4>
        <p style="font-size: 0.9rem; margin-top: 4px;">Add Major Deliverables in Project Builder to visualize the hierarchical work breakdown structure.</p>
      </div>
    `;
    return;
  }

  const nodes = [];
  const edges = [];

  // Level 1: Project Root Node
  const rootId = "node_root";
  nodes.push({
    id: rootId,
    label: `${projectName || "Project"}`,
    color: { background: "#202938", border: "#0F172A" },
    font: { color: "#FFFFFF", size: 14, bold: true, face: "Segoe UI, sans-serif" },
    shape: "box",
    margin: 12,
    level: 0
  });

  // Recursive traversal for arbitrary depth
  function traverse(item, parentId, level) {
    const nodeId = item.id || `node_${item.wbs_number || Math.random().toString(36).substring(2, 9)}`;
    const isLeaf = !item.children || item.children.length === 0 || item.type === "work_package";
    const wbsNum = item.wbs_number ? `[${item.wbs_number}] ` : "";

    let nodeColor, fontColor, borderColor, borderWidth;
    if (level === 1) {
      // Major Deliverable
      nodeColor = "#3B82F6";
      fontColor = "#FFFFFF";
      borderColor = "#1D4ED8";
      borderWidth = 2;
    } else if (isLeaf) {
      // Terminal Work Package
      nodeColor = "#ECFDF5";
      fontColor = "#065F46";
      borderColor = "#10B981";
      borderWidth = 2;
    } else {
      // Sub-deliverable (Intermediate container)
      nodeColor = "#F1F5F9";
      fontColor = "#1E293B";
      borderColor = "#475569";
      borderWidth = 1.5;
    }

    nodes.push({
      id: nodeId,
      label: `${wbsNum}${item.name || "Unnamed"}`,
      color: { background: nodeColor, border: borderColor },
      borderWidth: borderWidth,
      font: { color: fontColor, size: level === 1 ? 12 : 11, bold: true, face: "Segoe UI, sans-serif" },
      shape: "box",
      margin: level === 1 ? 10 : 8,
      level: level
    });

    edges.push({
      from: parentId,
      to: nodeId,
      color: { color: level === 1 ? "#3B82F6" : (isLeaf ? "#10B981" : "#475569") },
      width: level === 1 ? 2.5 : (isLeaf ? 1.5 : 2),
      dashes: isLeaf
    });

    const children = item.children || item.sub_deliverables || item.tasks || item.work_packages || [];
    if (children.length > 0 && item.type !== "work_package") {
      children.forEach(child => traverse(child, nodeId, level + 1));
    }
  }

  items.forEach(d => traverse(d, rootId, 1));

  const data = {
    nodes: new vis.DataSet(nodes),
    edges: new vis.DataSet(edges)
  };

  const options = {
    layout: {
      hierarchical: {
        direction: "UD",
        sortMethod: "directed",
        levelSeparation: 120,
        nodeSpacing: 190,
        treeSpacing: 220
      }
    },
    physics: false,
    nodes: {
      margin: 10,
      widthConstraint: { maximum: 220 }
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.7 } },
      smooth: { type: "cubicBezier", forceDirection: "vertical", roundness: 0.3 }
    },
    interaction: {
      hover: true,
      zoomView: true,
      dragView: true
    }
  };

  if (containerElement._visNetwork) {
    try {
      containerElement._visNetwork.destroy();
    } catch (e) {
      // ignore
    }
    containerElement._visNetwork = null;
  }

  containerElement.innerHTML = "";
  const network = new vis.Network(containerElement, data, options);
  containerElement._visNetwork = network;
  if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
  if (containerElement.id) window.SyncFlowNetworks[containerElement.id] = network;
  return network;
}

/**
 * Renders the Horizontal Precedence Diagramming Method (PDM) Network Diagram.
 * Supports FS (Blue), SS (Purple), FF (Teal), SF (Red dashed), lags, and health diagnostics.
 */
export function renderNetworkDiagram(containerElement, activities, dependencies, healthDiagnostics = null) {
  if (!containerElement) return null;

  if (typeof vis === "undefined" || !vis.Network) {
    containerElement.innerHTML = `
      <div style="padding: 2.5rem; text-align: center; color: var(--danger);">
        Visualization library (vis-network) failed to load.
      </div>
    `;
    return null;
  }

  if (!activities || activities.length === 0) {
    containerElement.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--muted);">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">🔀</div>
        <h4>No Activities Available</h4>
        <p style="font-size: 0.9rem; margin-top: 4px;">Define activities in "2. Define Activities" first to sequence dependencies.</p>
      </div>
    `;
    return null;
  }

  const nodes = [];
  const edges = [];
  const activityIds = new Set();

  activities.forEach(act => {
    const actId = act.activity_id || act.name;
    activityIds.add(actId);

    const shortName = act.name && act.name.length > 28 ? act.name.substring(0, 26) + "..." : (act.name || "Activity");

    nodes.push({
      id: actId,
      label: `📌 ${actId}\n${shortName}`,
      title: `ID: ${actId}\nName: ${act.name}`,
      color: {
        background: "#FFFFFF",
        border: "#CBD5E1",
        highlight: { background: "#EFF6FF", border: "#3B82F6" }
      },
      font: { color: "#202938", size: 11, bold: true, face: "Inter, system-ui, sans-serif" },
      shape: "box",
      borderWidth: 1.5,
      shadow: { enabled: true, color: "rgba(0,0,0,0.05)", size: 4, x: 2, y: 2 }
    });
  });

  (dependencies || []).forEach(dep => {
    const fromId = dep.from_activity_id || dep.from;
    const toId = dep.to_activity_id || dep.to;
    let depType = dep.type || "FS";

    // Extract acronym e.g. "FS" from "Finish-to-Start (FS)"
    if (depType.includes("(") && depType.includes(")")) {
      depType = depType.split("(")[1].replace(")", "").trim();
    } else {
      depType = depType.trim().toUpperCase();
    }

    const lag = parseFloat(dep.lag_days || 0);

    if (activityIds.has(fromId) && activityIds.has(toId)) {
      let edgeColor = "#3B82F6"; // Default FS (Blue)
      let dashes = false;

      if (depType === "SS") {
        edgeColor = "#7C3AED"; // Purple
      } else if (depType === "FF") {
        edgeColor = "#0891B2"; // Teal/Cyan
      } else if (depType === "SF") {
        edgeColor = "#DC2626"; // Amber/Red dashed link
        dashes = [5, 5];
      }

      let edgeLabel = depType;
      if (lag > 0) {
        edgeLabel = `${depType} +${lag}d`;
      }

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
        arrows: { to: { enabled: true, scaleFactor: 0.9 } }
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
        direction: "LR", // Left to Right
        sortMethod: "directed",
        levelSeparation: 220,
        nodeSpacing: 100,
        treeSpacing: 150
      }
    },
    physics: false,
    nodes: {
      margin: 10,
      borderWidth: 2,
      widthConstraint: { minimum: 140, maximum: 210 }
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

  if (containerElement._visNetwork) {
    try {
      containerElement._visNetwork.destroy();
    } catch (e) {
      // ignore
    }
    containerElement._visNetwork = null;
  }

  containerElement.innerHTML = "";
  const network = new vis.Network(containerElement, data, options);
  containerElement._visNetwork = network;
  if (!window.SyncFlowNetworks) window.SyncFlowNetworks = {};
  if (containerElement.id) window.SyncFlowNetworks[containerElement.id] = network;
  return network;
}

