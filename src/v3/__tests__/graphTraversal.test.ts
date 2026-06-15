import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  GraphNodeKind,
  GraphEdgeKind,
} from "@/v3/lib/knowledgeGraph";
import {
  indexGraph,
  traverse,
  getReachableNodes,
  getUpstreamDependencies,
  getDownstreamConsumers,
  getNeighbors,
  buildLineageContext,
  isReachable,
} from "@/v3/lib/graphTraversal";

/**
 * Hand-built fixture modelling the mandate's lineage example:
 *   risk → (threatens) → phase
 *   artifact-a → (feeds) → artifact-b → (feeds) → gate → (reviews) → phase
 *   decision → (affects) → phase
 * Directed edges let us prove upstream vs downstream walks differ.
 */
function node(id: string, kind: GraphNodeKind): GraphNode {
  return {
    id,
    kind,
    label: id,
    phaseId: null,
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
    node("phase:p1", "phase"),
    node("artifact:a", "artifact"),
    node("artifact:b", "artifact"),
    node("gate:p1", "gate"),
    node("risk:r1", "risk"),
    node("decision:d1", "decision"),
    node("milestone:m1", "milestone"), // orphan / isolated
  ];
  const edges: GraphEdge[] = [
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
      byKind: { phase: 1, artifact: 2, decision: 1, risk: 1, milestone: 1, gate: 1 },
      orphans: 1,
    },
  };
}

describe("graphTraversal", () => {
  it("returns empty for an unknown start node", () => {
    expect(getReachableNodes(makeGraph(), "does-not-exist")).toEqual([]);
    expect(traverse(makeGraph(), "nope")).toEqual([]);
  });

  it("walks downstream following edge direction with hop distances", () => {
    const hits = traverse(makeGraph(), "artifact:a", { direction: "downstream" });
    const byId = new Map(hits.map((h) => [h.node.id, h.distance]));
    expect(byId.get("artifact:a")).toBe(0);
    expect(byId.get("artifact:b")).toBe(1);
    expect(byId.get("gate:p1")).toBe(2);
    expect(byId.get("phase:p1")).toBe(3);
    // Downstream from artifact:a never reaches the risk/decision (they point INTO phase).
    expect(byId.has("risk:r1")).toBe(false);
    expect(byId.has("decision:d1")).toBe(false);
  });

  it("walks upstream to recover producers/inputs", () => {
    const ids = getUpstreamDependencies(makeGraph(), "phase:p1").map((n) => n.id);
    // Everything that feeds/affects/threatens the phase, transitively.
    expect(ids).toEqual(
      expect.arrayContaining([
        "gate:p1",
        "artifact:b",
        "artifact:a",
        "risk:r1",
        "decision:d1",
      ]),
    );
    // Start node excluded by default for the dependency helper.
    expect(ids).not.toContain("phase:p1");
  });

  it("respects maxDistance and includeStart", () => {
    const near = getReachableNodes(makeGraph(), "artifact:a", {
      direction: "downstream",
      maxDistance: 1,
    });
    expect(near.map((n) => n.id).sort()).toEqual(["artifact:a", "artifact:b"]);

    const neighbours = getNeighbors(makeGraph(), "phase:p1", "upstream");
    // Immediate upstream neighbours of the phase only (distance 1).
    expect(neighbours.map((n) => n.id).sort()).toEqual([
      "decision:d1",
      "gate:p1",
      "risk:r1",
    ]);
  });

  it("filters by edge kind and node kind", () => {
    // Only follow 'feeds' edges from artifact:a → cannot cross the 'reviews' edge.
    const feedsOnly = getReachableNodes(makeGraph(), "artifact:a", {
      direction: "downstream",
      edgeKinds: ["feeds"],
    });
    expect(feedsOnly.map((n) => n.id).sort()).toEqual([
      "artifact:a",
      "artifact:b",
      "gate:p1",
    ]);

    // Node-kind filter narrows the returned set without changing what is walked.
    const artifactsUpstream = getUpstreamDependencies(makeGraph(), "phase:p1", {
      nodeKinds: ["artifact"],
    });
    expect(artifactsUpstream.map((n) => n.id).sort()).toEqual([
      "artifact:a",
      "artifact:b",
    ]);
  });

  it("treats direction 'both' as undirected reachability", () => {
    const ids = getReachableNodes(makeGraph(), "risk:r1", { direction: "both" })
      .map((n) => n.id)
      .sort();
    // From the risk we reach the phase, then everything else connected to it.
    expect(ids).toEqual([
      "artifact:a",
      "artifact:b",
      "decision:d1",
      "gate:p1",
      "phase:p1",
      "risk:r1",
    ]);
    // The isolated milestone is never reachable.
    expect(ids).not.toContain("milestone:m1");
  });

  it("getDownstreamConsumers excludes the start and follows consumers", () => {
    const ids = getDownstreamConsumers(makeGraph(), "artifact:a").map((n) => n.id);
    expect(ids).not.toContain("artifact:a");
    expect(ids).toEqual(expect.arrayContaining(["artifact:b", "gate:p1", "phase:p1"]));
  });

  it("buildLineageContext returns a self-contained scoped subgraph", () => {
    const ctx = buildLineageContext(makeGraph(), "artifact:a", { direction: "downstream" });
    const ids = ctx.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["artifact:a", "artifact:b", "gate:p1", "phase:p1"]);
    // Every retained edge has both endpoints in the kept set.
    for (const e of ctx.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
    expect(ctx.stats.nodeCount).toBe(4);
    expect(ctx.stats.byKind.artifact).toBe(2);
    // The risk/decision edges into phase:p1 are dropped (their sources aren't kept).
    expect(ctx.edges.some((e) => e.source === "risk:r1")).toBe(false);
  });

  it("isReachable answers connectivity respecting direction", () => {
    const g = makeGraph();
    expect(isReachable(g, "artifact:a", "phase:p1", { direction: "downstream" })).toBe(true);
    expect(isReachable(g, "phase:p1", "artifact:a", { direction: "downstream" })).toBe(false);
    expect(isReachable(g, "phase:p1", "artifact:a", { direction: "upstream" })).toBe(true);
    expect(isReachable(g, "artifact:a", "milestone:m1", { direction: "both" })).toBe(false);
  });

  it("reuses a prebuilt index across multiple queries", () => {
    const index = indexGraph(makeGraph());
    expect(getReachableNodes(index, "artifact:a", { direction: "downstream" }).length).toBe(4);
    expect(getUpstreamDependencies(index, "phase:p1").length).toBe(5);
    expect(getNeighbors(index, "phase:p1", "upstream").length).toBe(3);
  });
});
