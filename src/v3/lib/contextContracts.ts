/**
 * Context Contract Framework — every intelligence capability declares the
 * context it needs, and no capability receives full program context.
 *
 * The mandate is precise: "No capability should receive full program context."
 * Each capability (Delivery, Governance, Executive, Artifact) has a fixed set of
 * things it needs and an explicit list of things it does NOT need. Today a
 * generic agent is handed the entire program JSON, so ~80% of calls pay for
 * context they never use.
 *
 * This module turns those contracts into data. A contract declares which
 * Knowledge-Graph node kinds the capability may see and how far to walk the
 * graph from the impacted object. `selectContext()` then uses the Increment-1
 * traversal API to assemble exactly that scoped lineage — "retrieve only
 * connected lineage" — and reports how much was pruned versus the full graph so
 * the token-savings story is measurable.
 *
 * Pure functions of a `KnowledgeGraph`: no program reads, no backend, fully
 * unit-testable. The contracts are the design artifact; selectContext is the
 * mechanism that enforces them.
 */
import type {
  KnowledgeGraph,
  GraphNode,
  GraphNodeKind,
} from "@/v3/lib/knowledgeGraph";
import {
  indexGraph,
  traverse,
  type GraphIndex,
  type TraversalDirection,
} from "@/v3/lib/graphTraversal";

export type IntelligenceCapability =
  | "delivery"
  | "governance"
  | "executive"
  | "artifact";

export interface ContextContract {
  capability: IntelligenceCapability;
  label: string;
  /** Human-readable list of data categories this capability needs. */
  needs: string[];
  /** Human-readable list of what it explicitly does NOT need (anti-context). */
  excludes: string[];
  /** Graph node kinds this capability is permitted to see. */
  includeKinds: GraphNodeKind[];
  /** How far, and in which direction, to walk from the impacted object. */
  traversal: { direction: TraversalDirection; maxDistance: number };
  /**
   * Whether the capability needs the program-level scalar summary (health,
   * confidence, readiness, outcome) rather than entity lineage. Executive
   * intelligence works from summaries, not raw entities.
   */
  needsProgramSummary: boolean;
}

const ALL_KINDS: GraphNodeKind[] = [
  "phase",
  "artifact",
  "decision",
  "risk",
  "milestone",
  "gate",
];

/**
 * The four reference contracts from the mandate. Each maps the declared data
 * categories onto graph node kinds and a scoped traversal.
 */
export const CONTEXT_CONTRACTS: Record<IntelligenceCapability, ContextContract> = {
  // Delivery: risks, issues, dependencies, milestones, current phase, impacted
  // artifacts. NOT executive narrative, document corpus, historical artifacts.
  delivery: {
    capability: "delivery",
    label: "Delivery Intelligence",
    needs: ["Risks", "Issues", "Dependencies", "Milestones", "Current phase", "Impacted artifacts"],
    excludes: ["Executive narrative", "Entire document corpus", "Historical artifacts"],
    includeKinds: ["phase", "risk", "milestone", "decision", "artifact"],
    traversal: { direction: "both", maxDistance: 2 },
    needsProgramSummary: false,
  },
  // Governance: approvals, evidence, risks, decisions, governance requirements.
  // NOT entire program history.
  governance: {
    capability: "governance",
    label: "Governance Intelligence",
    needs: ["Approvals", "Evidence", "Risks", "Decisions", "Governance requirements"],
    excludes: ["Entire program history", "Raw document corpus"],
    includeKinds: ["gate", "phase", "risk", "decision", "artifact"],
    traversal: { direction: "both", maxDistance: 2 },
    needsProgramSummary: false,
  },
  // Executive: program health, key risks/decisions, confidence + readiness
  // summary, outcome forecast. NOT raw evidence/requirements/technical detail.
  executive: {
    capability: "executive",
    label: "Executive Intelligence",
    needs: [
      "Program health",
      "Key risks",
      "Key decisions",
      "Confidence summary",
      "Readiness summary",
      "Outcome forecast",
    ],
    excludes: ["Raw evidence", "Raw requirements", "Technical detail"],
    includeKinds: ["phase", "risk", "decision", "gate"],
    traversal: { direction: "both", maxDistance: 1 },
    needsProgramSummary: true,
  },
  // Artifact: template, relevant inputs/evidence/decisions/risks, prior version,
  // changed data. NOT entire program context.
  artifact: {
    capability: "artifact",
    label: "Artifact Intelligence",
    needs: [
      "Artifact template",
      "Relevant inputs",
      "Relevant evidence",
      "Relevant decisions",
      "Relevant risks",
      "Prior artifact version",
      "Changed data",
    ],
    excludes: ["Entire program context"],
    includeKinds: ["artifact", "decision", "risk", "phase"],
    traversal: { direction: "both", maxDistance: 1 },
    needsProgramSummary: false,
  },
};

export function getContextContract(capability: IntelligenceCapability): ContextContract {
  return CONTEXT_CONTRACTS[capability];
}

export interface ScopedContext {
  capability: IntelligenceCapability;
  /** The impacted object the context was scoped around (may be null for whole-program executive scope). */
  focusId: string | null;
  /** The scoped lineage subgraph — only nodes the contract permits. */
  graph: KnowledgeGraph;
  /** Node kinds actually present in the scoped context. */
  includedKinds: GraphNodeKind[];
  /** Node kinds the contract excluded (for explainability). */
  excludedKinds: GraphNodeKind[];
  /** Whether the program-level summary should accompany this context. */
  needsProgramSummary: boolean;
  reduction: {
    fullNodeCount: number;
    scopedNodeCount: number;
    droppedNodeCount: number;
    /** Percentage of nodes pruned vs the full graph (0–100). */
    reductionPct: number;
  };
}

function emptyByKind(): Record<GraphNodeKind, number> {
  return { phase: 0, artifact: 0, decision: 0, risk: 0, milestone: 0, gate: 0 };
}

function subgraphFrom(full: KnowledgeGraph, keep: Set<string>): KnowledgeGraph {
  const nodes = full.nodes.filter((node) => keep.has(node.id));
  const edges = full.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  const byKind = emptyByKind();
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

/**
 * Assemble the scoped context package for `capability` around `focusId`.
 *
 * When `focusId` is provided, walk the graph per the contract's traversal and
 * keep only nodes of permitted kinds. When `focusId` is null (whole-program
 * scope, e.g. executive), keep every node of a permitted kind — still a strict
 * subset of the full graph, never the raw program.
 */
export function selectContext(
  source: KnowledgeGraph | GraphIndex,
  capability: IntelligenceCapability,
  focusId: string | null = null,
): ScopedContext {
  const contract = CONTEXT_CONTRACTS[capability];
  const index: GraphIndex = "adjacency" in source ? source : indexGraph(source);
  const full = index.graph;
  const allowed = new Set(contract.includeKinds);

  let keep: Set<string>;
  if (focusId && index.nodeById.has(focusId)) {
    const reachable = traverse(index, focusId, {
      direction: contract.traversal.direction,
      maxDistance: contract.traversal.maxDistance,
      nodeKinds: contract.includeKinds,
      includeStart: true,
    });
    keep = new Set(reachable.map((hit) => hit.node.id));
  } else {
    // Whole-program scope, still kind-filtered to the contract.
    keep = new Set(
      full.nodes.filter((node) => allowed.has(node.kind)).map((node) => node.id),
    );
  }

  const graph = subgraphFrom(full, keep);
  const includedKinds = ALL_KINDS.filter((kind) => graph.stats.byKind[kind] > 0);
  const excludedKinds = ALL_KINDS.filter((kind) => !allowed.has(kind));

  const fullNodeCount = full.nodes.length;
  const scopedNodeCount = graph.nodes.length;
  const droppedNodeCount = fullNodeCount - scopedNodeCount;
  const reductionPct = fullNodeCount === 0 ? 0 : Math.round((droppedNodeCount / fullNodeCount) * 100);

  return {
    capability,
    focusId: focusId ?? null,
    graph,
    includedKinds,
    excludedKinds,
    needsProgramSummary: contract.needsProgramSummary,
    reduction: { fullNodeCount, scopedNodeCount, droppedNodeCount, reductionPct },
  };
}

/** A compact, serialisable view of a scoped context for prompt assembly. */
export interface ScopedContextDigest {
  capability: IntelligenceCapability;
  focusId: string | null;
  nodes: Array<Pick<GraphNode, "id" | "kind" | "label" | "status" | "health" | "quality" | "detail">>;
  edges: Array<{ source: string; target: string; kind: string }>;
  reductionPct: number;
}

/**
 * Reduce a ScopedContext to the minimal JSON an agent prompt actually needs —
 * strips internal namespacing/refs and keeps only fields that carry meaning.
 * This is the "structured internal output" the mandate asks for: compact JSON,
 * not verbose program prose.
 */
export function digestScopedContext(scoped: ScopedContext): ScopedContextDigest {
  return {
    capability: scoped.capability,
    focusId: scoped.focusId,
    nodes: scoped.graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      status: node.status,
      health: node.health,
      quality: node.quality,
      detail: node.detail,
    })),
    edges: scoped.graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    })),
    reductionPct: scoped.reduction.reductionPct,
  };
}
