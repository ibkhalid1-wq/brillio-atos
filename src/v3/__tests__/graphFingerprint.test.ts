import { fingerprintGraph, diffFingerprints, edgeKey } from "@/v3/lib/graphFingerprint";
import type { ProgramGraph, ProgramGraphNode, ProgramGraphEdge } from "@/v3/lib/programGraph";

function node(over: Partial<ProgramGraphNode> & { id: string }): ProgramGraphNode {
  return { type: "fact", label: over.id, ...over };
}
function edge(from: string, to: string, type = "grounds"): ProgramGraphEdge {
  return { id: `${type}:${from}->${to}`, from, to, type };
}
function graph(nodes: ProgramGraphNode[], edges: ProgramGraphEdge[]): ProgramGraph {
  return {
    nodes,
    edges,
    stats: { nodeCount: nodes.length, edgeCount: edges.length, byKind: {} as ProgramGraph["stats"]["byKind"], documentCount: 0, orphanFacts: 0 },
  };
}

describe("fingerprintGraph", () => {
  it("is order-independent: shuffling nodes and edges yields the same hash", () => {
    const nodes = [node({ id: "fact:a" }), node({ id: "artifact:charter", type: "artifact", label: "Charter" }), node({ id: "kpi:1", type: "kpi", label: "Cost" })];
    const edges = [edge("fact:a", "artifact:charter"), edge("kpi:1", "artifact:charter", "in_phase")];
    const a = fingerprintGraph(graph(nodes, edges));
    const b = fingerprintGraph(graph([...nodes].reverse(), [...edges].reverse()));
    expect(b.hash).toBe(a.hash);
    expect(b.nodeIds).toEqual(a.nodeIds);
    expect(b.edgeKeys).toEqual(a.edgeKeys);
  });

  it("counts distinct nodes and edges and sorts their keys", () => {
    const fp = fingerprintGraph(graph(
      [node({ id: "fact:b" }), node({ id: "fact:a" })],
      [edge("fact:a", "fact:b"), edge("fact:a", "fact:b")], // duplicate edge
    ));
    expect(fp.nodeCount).toBe(2);
    expect(fp.nodeIds).toEqual(["fact:a", "fact:b"]);
    expect(fp.edgeCount).toBe(1);
  });

  it("dedupes duplicate node ids first-wins, mirroring the graph builder", () => {
    const fp = fingerprintGraph(graph(
      [node({ id: "fact:a", label: "first" }), node({ id: "fact:a", label: "second" })],
      [],
    ));
    expect(fp.nodeCount).toBe(1);
  });

  it("changes the node hash when any tracked field changes", () => {
    const base = fingerprintGraph(graph([node({ id: "fact:a", label: "orig" })], []));
    const relabel = fingerprintGraph(graph([node({ id: "fact:a", label: "changed" })], []));
    expect(relabel.nodeHashes["fact:a"]).not.toBe(base.nodeHashes["fact:a"]);
    expect(relabel.hash).not.toBe(base.hash);
  });

  it("is insensitive to property key order", () => {
    const a = fingerprintGraph(graph([node({ id: "kpi:1", type: "kpi", label: "K", properties: { baseline: "1", target: "2" } })], []));
    const b = fingerprintGraph(graph([node({ id: "kpi:1", type: "kpi", label: "K", properties: { target: "2", baseline: "1" } })], []));
    expect(b.nodeHashes["kpi:1"]).toBe(a.nodeHashes["kpi:1"]);
  });

  it("edgeKey is canonical from→to→type, independent of the edge id scheme", () => {
    expect(edgeKey({ id: "whatever", from: "a", to: "b", type: "grounds" })).toBe("a\u2192b\u2192grounds");
  });
});

describe("diffFingerprints", () => {
  const nodes = [node({ id: "fact:a" }), node({ id: "artifact:charter", type: "artifact", label: "Charter" })];
  const edges = [edge("fact:a", "artifact:charter")];
  const base = fingerprintGraph(graph(nodes, edges));

  it("reports no change for an identical graph", () => {
    const same = fingerprintGraph(graph([...nodes], [...edges]));
    const diff = diffFingerprints(base, same);
    expect(diff.changed).toBe(false);
    expect(diff).toMatchObject({ addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [] });
  });

  it("detects an added node and its edge", () => {
    const next = fingerprintGraph(graph(
      [...nodes, node({ id: "requirement:r1", type: "requirement", label: "REQ-1" })],
      [...edges, edge("requirement:r1", "artifact:charter", "traces_to")],
    ));
    const diff = diffFingerprints(base, next);
    expect(diff.addedNodes).toEqual(["requirement:r1"]);
    expect(diff.addedEdges).toEqual(["requirement:r1\u2192artifact:charter\u2192traces_to"]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.changed).toBe(true);
  });

  it("detects a removed node", () => {
    const next = fingerprintGraph(graph([node({ id: "fact:a" })], []));
    const diff = diffFingerprints(base, next);
    expect(diff.removedNodes).toEqual(["artifact:charter"]);
    expect(diff.removedEdges).toEqual(["fact:a\u2192artifact:charter\u2192grounds"]);
    expect(diff.changed).toBe(true);
  });

  it("detects a node changed in place (same id, new content)", () => {
    const next = fingerprintGraph(graph(
      [node({ id: "fact:a" }), node({ id: "artifact:charter", type: "artifact", label: "Charter v2" })],
      edges,
    ));
    const diff = diffFingerprints(base, next);
    expect(diff.changedNodes).toEqual(["artifact:charter"]);
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.changed).toBe(true);
  });
});
