import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  GraphNodeKind,
  GraphEdgeKind,
} from "@/v3/lib/knowledgeGraph";
import {
  CONTEXT_CONTRACTS,
  getContextContract,
  selectContext,
  digestScopedContext,
} from "@/v3/lib/contextContracts";

/**
 * A small two-phase program graph with one of every node kind so we can prove
 * each contract keeps only its permitted kinds and prunes the rest.
 */
function node(id: string, kind: GraphNodeKind, phaseId: string | null = null): GraphNode {
  return {
    id,
    kind,
    label: id,
    phaseId,
    status: null,
    health: "neutral",
    quality: null,
    detail: null,
    ref: id,
  };
}
function edge(source: string, target: string, kind: GraphEdgeKind): GraphEdge {
  return { id: `${kind}:${source}->${target}`, source, target, kind, label: kind };
}

function makeGraph(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    node("phase:p1", "phase", "p1"),
    node("artifact:a", "artifact", "p1"),
    node("artifact:b", "artifact", "p1"),
    node("gate:p1", "gate", "p1"),
    node("risk:r1", "risk", "p1"),
    node("decision:d1", "decision", "p1"),
    node("milestone:m1", "milestone", "p1"),
    node("phase:p2", "phase", "p2"), // disconnected second phase
  ];
  const edges: GraphEdge[] = [
    edge("phase:p1", "artifact:a", "contains"),
    edge("phase:p1", "artifact:b", "contains"),
    edge("phase:p1", "milestone:m1", "contains"),
    edge("artifact:a", "artifact:b", "feeds"),
    edge("artifact:b", "gate:p1", "feeds"),
    edge("gate:p1", "phase:p1", "reviews"),
    edge("risk:r1", "phase:p1", "threatens"),
    edge("decision:d1", "phase:p1", "affects"),
  ];
  return {
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      byKind: { phase: 2, artifact: 2, decision: 1, risk: 1, milestone: 1, gate: 1 },
      orphans: 1,
    },
  };
}

describe("contextContracts", () => {
  it("defines all four reference contracts with needs and exclusions", () => {
    const caps = Object.keys(CONTEXT_CONTRACTS).sort();
    expect(caps).toEqual(["artifact", "delivery", "executive", "governance"]);
    for (const cap of caps) {
      const contract = getContextContract(cap as keyof typeof CONTEXT_CONTRACTS);
      expect(contract.needs.length).toBeGreaterThan(0);
      expect(contract.excludes.length).toBeGreaterThan(0);
      expect(contract.includeKinds.length).toBeGreaterThan(0);
    }
  });

  it("governance contract excludes milestones, executive excludes artifacts", () => {
    expect(CONTEXT_CONTRACTS.governance.includeKinds).not.toContain("milestone");
    expect(CONTEXT_CONTRACTS.executive.includeKinds).not.toContain("artifact");
    // Executive works from program summary, not entity detail.
    expect(CONTEXT_CONTRACTS.executive.needsProgramSummary).toBe(true);
    expect(CONTEXT_CONTRACTS.delivery.needsProgramSummary).toBe(false);
  });

  it("scopes delivery context around a phase and prunes excluded kinds", () => {
    const scoped = selectContext(makeGraph(), "delivery", "phase:p1");
    const ids = scoped.graph.nodes.map((n) => n.id).sort();
    // Delivery keeps phase/risk/milestone/decision/artifact connected to p1.
    expect(ids).toEqual(
      expect.arrayContaining([
        "phase:p1",
        "artifact:a",
        "artifact:b",
        "risk:r1",
        "decision:d1",
        "milestone:m1",
      ]),
    );
    // The gate is NOT a delivery kind → excluded even though it is adjacent.
    expect(ids).not.toContain("gate:p1");
    // The disconnected second phase is never pulled in.
    expect(ids).not.toContain("phase:p2");
    expect(scoped.excludedKinds).toContain("gate");
  });

  it("governance scope keeps the gate but drops milestones", () => {
    const scoped = selectContext(makeGraph(), "governance", "gate:p1");
    const ids = scoped.graph.nodes.map((n) => n.id);
    expect(ids).toContain("gate:p1");
    expect(ids).not.toContain("milestone:m1");
    expect(scoped.excludedKinds).toContain("milestone");
  });

  it("executive whole-program scope keeps only summary kinds, never full graph", () => {
    const scoped = selectContext(makeGraph(), "executive", null);
    const kinds = new Set(scoped.graph.nodes.map((n) => n.kind));
    expect(kinds.has("artifact")).toBe(false);
    expect(kinds.has("milestone")).toBe(false);
    // Strict subset of the full graph.
    expect(scoped.reduction.scopedNodeCount).toBeLessThan(scoped.reduction.fullNodeCount);
    expect(scoped.reduction.reductionPct).toBeGreaterThan(0);
  });

  it("reports node-count reduction versus the full graph", () => {
    const scoped = selectContext(makeGraph(), "artifact", "artifact:b");
    expect(scoped.reduction.fullNodeCount).toBe(8);
    expect(scoped.reduction.scopedNodeCount).toBeLessThan(8);
    expect(scoped.reduction.droppedNodeCount).toBe(
      scoped.reduction.fullNodeCount - scoped.reduction.scopedNodeCount,
    );
  });

  it("falls back to whole-program scope when the focus id is unknown", () => {
    const scoped = selectContext(makeGraph(), "delivery", "missing-node");
    // No crash; behaves like null focus (kind-filtered whole graph).
    expect(scoped.graph.nodes.length).toBeGreaterThan(0);
    expect(scoped.graph.nodes.every((n) => CONTEXT_CONTRACTS.delivery.includeKinds.includes(n.kind))).toBe(true);
  });

  it("digestScopedContext produces compact prompt-ready JSON", () => {
    const scoped = selectContext(makeGraph(), "delivery", "phase:p1");
    const digest = digestScopedContext(scoped);
    expect(digest.capability).toBe("delivery");
    expect(digest.focusId).toBe("phase:p1");
    expect(digest.nodes.length).toBe(scoped.graph.nodes.length);
    // Digest strips internal fields like `ref` and `phaseId`.
    expect(Object.keys(digest.nodes[0])).toEqual(
      expect.arrayContaining(["id", "kind", "label", "status", "health", "quality", "detail"]),
    );
    expect((digest.nodes[0] as Record<string, unknown>).ref).toBeUndefined();
  });
});
