/**
 * Program Knowledge Graph — the mandatory system of record.
 *
 * ATOS's truth is a connected graph of entities, not a set of disconnected
 * surfaces. This module derives, from normalized programme data, a typed graph
 * of nodes (phases, artifacts, decisions, risks, milestones, gates) and edges
 * (contains, feeds, depends-on, affects, threatens, reviews) that captures full
 * traceability: which artifact feeds which gate, which risk threatens which
 * phase, which decision is blocking which work.
 *
 * It is a pure, testable selector that reuses the Cycle-4 artifact model for
 * artifact lineage and reads only `ProgramSummary` — no backend changes. It is
 * the data layer the Knowledge Graph panel renders, and the substrate future
 * explainability (Cycle 6) reasons over.
 */
import type { ProgramSummary } from "@/new/types";
import { ATOS_STANDARD, type MethodologyDefinition } from "@/v3/lib/methodology";
import { buildArtifactModel } from "@/v3/lib/artifactModel";

export type GraphNodeKind = "phase" | "artifact" | "decision" | "risk" | "milestone" | "gate";
export type GraphEdgeKind = "contains" | "feeds" | "depends-on" | "affects" | "threatens" | "reviews";
export type GraphHealth = "good" | "warning" | "critical" | "neutral";

export interface GraphNode {
  /** Namespaced stable id, e.g. "phase:discovery" or "artifact:plan". */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Owning phase id when applicable. */
  phaseId: string | null;
  /** Domain status string (kind-specific). */
  status: string | null;
  health: GraphHealth;
  /** 0-100 confidence/quality where known, else null. */
  quality: number | null;
  /** One-line detail for tooltips / side panels. */
  detail: string | null;
  /** Underlying entity id (un-namespaced) for navigation. */
  ref: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label: string;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    byKind: Record<GraphNodeKind, number>;
    /** Nodes with no incident edges — gaps in traceability. */
    orphans: number;
  };
}

const EDGE_LABEL: Record<GraphEdgeKind, string> = {
  contains: "contains",
  feeds: "feeds",
  "depends-on": "depends on",
  affects: "affects",
  threatens: "threatens",
  reviews: "reviews",
};

function phaseNodeId(phaseId: string): string {
  return `phase:${phaseId}`;
}

function phaseHealth(status: string): GraphHealth {
  switch (status) {
    case "complete":
    case "ready":
      return "good";
    case "at-risk":
      return "warning";
    case "blocked":
      return "critical";
    default:
      return "neutral";
  }
}

function artifactHealth(state: string): GraphHealth {
  switch (state) {
    case "approved":
    case "ready":
      return "good";
    case "draft":
      return "warning";
    case "missing":
      return "critical";
    default:
      return "neutral";
  }
}

function severityHealth(level: string): GraphHealth {
  switch (level) {
    case "critical":
      return "critical";
    case "high":
      return "warning";
    case "medium":
    case "low":
      return "neutral";
    default:
      return "neutral";
  }
}

function milestoneHealth(status: string): GraphHealth {
  switch (status) {
    case "complete":
    case "on-track":
      return "good";
    case "at-risk":
      return "warning";
    case "delayed":
    case "blocked":
      return "critical";
    default:
      return "neutral";
  }
}

function gateHealth(status: string): GraphHealth {
  switch (status) {
    case "approved":
    case "ready":
      return "good";
    case "pending-review":
      return "warning";
    case "not-ready":
    case "remediation-requested":
      return "critical";
    default:
      return "neutral";
  }
}

export function buildKnowledgeGraph(
  program: ProgramSummary | null,
  methodology: MethodologyDefinition = ATOS_STANDARD,
): KnowledgeGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const emptyByKind: Record<GraphNodeKind, number> = {
    phase: 0,
    artifact: 0,
    decision: 0,
    risk: 0,
    milestone: 0,
    gate: 0,
  };

  if (!program) {
    return { nodes, edges, stats: { nodeCount: 0, edgeCount: 0, byKind: emptyByKind, orphans: 0 } };
  }

  const addEdge = (source: string, target: string, kind: GraphEdgeKind) => {
    if (source === target) return;
    const id = `${kind}:${source}->${target}`;
    if (edgeKeys.has(id)) return;
    edgeKeys.add(id);
    edges.push({ id, source, target, kind, label: EDGE_LABEL[kind] });
  };

  const nodeIds = new Set<string>();
  const addNode = (node: GraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  // 1. Phase nodes — the spine of the graph.
  const phaseIds = new Set<string>();
  for (const phase of program.phases || []) {
    phaseIds.add(phase.id);
    addNode({
      id: phaseNodeId(phase.id),
      kind: "phase",
      label: phase.displayName,
      phaseId: phase.id,
      status: phase.status,
      health: phaseHealth(phase.status),
      quality: typeof phase.pct === "number" ? Math.round(phase.pct) : null,
      detail: phase.objective || null,
      ref: phase.id,
    });
  }

  // 2. Artifact nodes (reuse Cycle-4 artifact model) + lineage edges.
  const artifactModel = buildArtifactModel(program, methodology);
  // Map producing-agent id -> artifact node id, for lineage resolution.
  const agentToArtifactNode = new Map<string, string>();
  for (const phase of artifactModel.phases) {
    for (const artifact of phase.artifacts) {
      const nodeId = `artifact:${phase.phaseId}:${artifact.key}`;
      addNode({
        id: nodeId,
        kind: "artifact",
        label: artifact.label,
        phaseId: artifact.phaseId,
        status: artifact.state,
        health: artifactHealth(artifact.state),
        quality: artifact.quality,
        detail: artifact.evidence,
        ref: artifact.artifactId ?? artifact.key,
      });
      // Required artifacts are keyed by their producing-agent id.
      if (artifact.required) agentToArtifactNode.set(artifact.key, nodeId);
      // phase contains artifact
      if (phaseIds.has(artifact.phaseId)) {
        addEdge(phaseNodeId(artifact.phaseId), nodeId, "contains");
      }
    }
  }
  // Lineage edges: upstream artifact feeds this one.
  for (const phase of artifactModel.phases) {
    for (const artifact of phase.artifacts) {
      const targetNode = agentToArtifactNode.get(artifact.key);
      if (!targetNode) continue;
      for (const upstreamAgent of artifact.upstream) {
        const sourceNode = agentToArtifactNode.get(upstreamAgent);
        if (sourceNode) addEdge(sourceNode, targetNode, "feeds");
      }
    }
  }

  // 3. Gate nodes — one per phase that has a gate review.
  const gateNodeByPhase = new Map<string, string>();
  for (const [phaseId, gate] of Object.entries(program.gateReviews || {})) {
    const nodeId = `gate:${phaseId}`;
    gateNodeByPhase.set(phaseId, nodeId);
    addNode({
      id: nodeId,
      kind: "gate",
      label: `${gate.phaseName || phaseId} gate`,
      phaseId,
      status: gate.status,
      health: gateHealth(gate.status),
      quality: typeof gate.readinessScore === "number" ? Math.round(gate.readinessScore) : null,
      detail: gate.recommendation || null,
      ref: phaseId,
    });
    // gate reviews phase
    if (phaseIds.has(phaseId)) addEdge(nodeId, phaseNodeId(phaseId), "reviews");
  }
  // Artifacts whose lineage feeds a gate connect to that phase's gate.
  for (const phase of artifactModel.phases) {
    const gateNode = gateNodeByPhase.get(phase.phaseId);
    if (!gateNode) continue;
    for (const artifact of phase.artifacts) {
      if (!artifact.required) continue;
      if (artifact.downstream.includes("gate-review")) {
        const sourceNode = agentToArtifactNode.get(artifact.key);
        if (sourceNode) addEdge(sourceNode, gateNode, "feeds");
      }
    }
  }

  // 4. Milestone nodes + dependency edges.
  const milestoneIds = new Set<string>();
  for (const milestone of program.milestones || []) {
    const nodeId = `milestone:${milestone.id}`;
    milestoneIds.add(milestone.id);
    addNode({
      id: nodeId,
      kind: "milestone",
      label: milestone.title,
      phaseId: milestone.phaseId,
      status: milestone.status,
      health: milestoneHealth(milestone.status),
      quality: typeof milestone.confidence === "number" ? Math.round(milestone.confidence) : null,
      detail: milestone.targetDate ? `Target ${milestone.targetDate}` : null,
      ref: milestone.id,
    });
    // phase contains milestone
    if (phaseIds.has(milestone.phaseId)) addEdge(phaseNodeId(milestone.phaseId), nodeId, "contains");
  }
  // milestone depends-on milestone
  for (const milestone of program.milestones || []) {
    if (!milestoneIds.has(milestone.id)) continue;
    for (const dep of milestone.dependsOn || []) {
      if (milestoneIds.has(dep)) addEdge(`milestone:${milestone.id}`, `milestone:${dep}`, "depends-on");
    }
  }

  // 5. Decision nodes — affect their phase (and any blocked gate).
  for (const decision of program.decisionQueue || []) {
    if (decision.status && decision.status !== "open" && decision.status !== "pending") continue;
    const nodeId = `decision:${decision.id}`;
    addNode({
      id: nodeId,
      kind: "decision",
      label: decision.title,
      phaseId: decision.phaseId || null,
      status: decision.status || "open",
      health: severityHealth(decision.priority),
      quality: decision.advisorAnalysis?.confidence ?? null,
      detail: decision.question || decision.recommendation || null,
      ref: decision.id,
    });
    if (decision.phaseId && phaseIds.has(decision.phaseId)) {
      addEdge(nodeId, phaseNodeId(decision.phaseId), "affects");
      const gateNode = gateNodeByPhase.get(decision.phaseId);
      if (gateNode) addEdge(nodeId, gateNode, "affects");
    }
  }

  // 6. Risk nodes — threaten their phase. Prefer RAID entries (phase-scoped);
  // fall back to the simpler risk list when RAID is empty.
  const openRaid = (program.raidEntries || []).filter(
    (entry) => (entry.type === "risk" || entry.type === "blocker") && entry.status !== "closed",
  );
  if (openRaid.length) {
    for (const entry of openRaid) {
      const nodeId = `risk:${entry.id}`;
      addNode({
        id: nodeId,
        kind: "risk",
        label: entry.title,
        phaseId: entry.phase || null,
        status: entry.status,
        health: severityHealth(entry.severity),
        quality: entry.agentConfidence ?? null,
        detail: entry.mitigation || entry.description || null,
        ref: entry.id,
      });
      if (entry.phase && phaseIds.has(entry.phase)) addEdge(nodeId, phaseNodeId(entry.phase), "threatens");
    }
  } else {
    for (const risk of program.risks || []) {
      const nodeId = `risk:${risk.id}`;
      addNode({
        id: nodeId,
        kind: "risk",
        label: risk.label,
        phaseId: null,
        status: risk.severity,
        health: severityHealth(risk.severity),
        quality: null,
        detail: risk.action || null,
        ref: risk.id,
      });
    }
  }

  // Stats.
  const byKind = { ...emptyByKind };
  for (const node of nodes) byKind[node.kind] += 1;
  const incident = new Set<string>();
  for (const edge of edges) {
    incident.add(edge.source);
    incident.add(edge.target);
  }
  const orphans = nodes.reduce((count, node) => (incident.has(node.id) ? count : count + 1), 0);

  return {
    nodes,
    edges,
    stats: { nodeCount: nodes.length, edgeCount: edges.length, byKind, orphans },
  };
}

/** Convenience: the sub-graph of nodes/edges touching a single phase. */
export function buildPhaseSubgraph(
  program: ProgramSummary | null,
  phaseId: string,
  methodology: MethodologyDefinition = ATOS_STANDARD,
): KnowledgeGraph {
  const full = buildKnowledgeGraph(program, methodology);
  const keep = new Set<string>();
  for (const node of full.nodes) {
    if (node.phaseId === phaseId || node.id === phaseNodeId(phaseId)) keep.add(node.id);
  }
  // Pull in directly-connected neighbours so lineage across phases stays visible.
  for (const edge of full.edges) {
    if (keep.has(edge.source)) keep.add(edge.target);
    if (keep.has(edge.target)) keep.add(edge.source);
  }
  const nodes = full.nodes.filter((node) => keep.has(node.id));
  const edges = full.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));

  const byKind: Record<GraphNodeKind, number> = {
    phase: 0,
    artifact: 0,
    decision: 0,
    risk: 0,
    milestone: 0,
    gate: 0,
  };
  for (const node of nodes) byKind[node.kind] += 1;
  const incident = new Set<string>();
  for (const edge of edges) {
    incident.add(edge.source);
    incident.add(edge.target);
  }
  const orphans = nodes.reduce((count, node) => (incident.has(node.id) ? count : count + 1), 0);

  return { nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length, byKind, orphans } };
}
