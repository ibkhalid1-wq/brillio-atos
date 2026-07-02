import { describe, it, expect, beforeEach } from "vitest";
import {
  reviewGraphChanges,
  commitGraphSnapshot,
  getStoredFingerprint,
  describeGraphDiff,
} from "@/v3/lib/graphChangeLog";
import { diffFingerprints, fingerprintGraph } from "@/v3/lib/graphFingerprint";
import type { ProgramGraph, ProgramGraphNode, ProgramGraphEdge } from "@/v3/lib/programGraph";

/**
 * The change-log layer persists a per-programme graph fingerprint (device-local,
 * like confidenceHistory) and turns a run-over-run diff into a "since you last
 * looked" summary. reviewGraphChanges must NOT advance the baseline (idempotent
 * read); commitGraphSnapshot advances it.
 */
function node(over: Partial<ProgramGraphNode>): ProgramGraphNode {
  return { id: "n", type: "fact", label: "L", ...over };
}
function graphOf(nodes: ProgramGraphNode[], edges: ProgramGraphEdge[] = []): ProgramGraph {
  return {
    nodes,
    edges,
    stats: { nodeCount: nodes.length, edgeCount: edges.length, byKind: {} as never, documentCount: 0, orphanFacts: 0 },
  };
}

describe("graphChangeLog persistence", () => {
  beforeEach(() => window.localStorage.clear());

  it("reports a first snapshot (no baseline) as unchanged", () => {
    const g = graphOf([node({ id: "fact:1", label: "A" })]);
    const summary = reviewGraphChanges("p1", g);
    expect(summary.isFirstSnapshot).toBe(true);
    expect(summary.changed).toBe(false);
    expect(summary.diff).toBeNull();
  });

  it("reviewGraphChanges does not advance the baseline (idempotent read)", () => {
    const g = graphOf([node({ id: "fact:1", label: "A" })]);
    expect(getStoredFingerprint("p1")).toBeNull();
    reviewGraphChanges("p1", g);
    expect(getStoredFingerprint("p1")).toBeNull(); // review must not persist
  });

  it("detects added and removed nodes across a committed baseline", () => {
    const before = graphOf([node({ id: "fact:1", label: "Legacy platform" })]);
    commitGraphSnapshot("p1", before);

    const after = graphOf([
      node({ id: "fact:1", label: "Legacy platform" }),
      node({ id: "requirement:REQ-1", type: "requirement", label: "Must support SSO" }),
    ]);
    const summary = reviewGraphChanges("p1", after);
    expect(summary.changed).toBe(true);
    expect(summary.diff!.addedNodes).toEqual(["requirement:REQ-1"]);
    expect(summary.headline).toContain("1 added");
    expect(summary.details.some((d) => d.includes('requirement "Must support SSO"'))).toBe(true);
  });

  it("shows no changes once the baseline is advanced to the current graph", () => {
    const g = graphOf([node({ id: "fact:1", label: "A" })]);
    commitGraphSnapshot("p1", g);
    const summary = reviewGraphChanges("p1", g);
    expect(summary.changed).toBe(false);
    expect(summary.headline).toContain("No changes");
  });

  it("returns null baseline for a corrupt stored value", () => {
    window.localStorage.setItem("atlas-graph-fingerprint:p1", "{not valid");
    expect(getStoredFingerprint("p1")).toBeNull();
  });
});

describe("describeGraphDiff", () => {
  it("names a removed node by parsing its id when it is gone from the graph", () => {
    const prev = fingerprintGraph(graphOf([node({ id: "risk:R-1", type: "risk", label: "Vendor slip" })]));
    const next = fingerprintGraph(graphOf([]));
    const diff = diffFingerprints(prev, next);
    const { headline, details } = describeGraphDiff(diff, graphOf([]));
    expect(headline).toContain("1 removed");
    expect(details[0]).toContain('risk "R-1"');
  });

  it("summarises a changed node with its live label", () => {
    const prev = fingerprintGraph(graphOf([node({ id: "fact:1", label: "Old" })]));
    const nextGraph = graphOf([node({ id: "fact:1", label: "New" })]);
    const diff = diffFingerprints(prev, fingerprintGraph(nextGraph));
    const { headline, details } = describeGraphDiff(diff, nextGraph);
    expect(headline).toContain("1 changed");
    expect(details[0]).toContain('fact "New"');
  });

  it("reports an edge-only change as rewired relationships", () => {
    const a = node({ id: "fact:1", label: "A" });
    const b = node({ id: "artifact:c", type: "artifact", label: "Charter" });
    const prev = fingerprintGraph(graphOf([a, b], []));
    const nextGraph = graphOf([a, b], [{ id: "e", from: "fact:1", to: "artifact:c", type: "grounds" }]);
    const diff = diffFingerprints(prev, fingerprintGraph(nextGraph));
    const { headline } = describeGraphDiff(diff, nextGraph);
    expect(headline).toContain("relationship");
  });

  it("caps detail lines and appends an overflow note", () => {
    const prevNodes = [node({ id: "fact:0", label: "keep" })];
    const nextNodes = [
      node({ id: "fact:0", label: "keep" }),
      ...Array.from({ length: 10 }, (_, i) => node({ id: `fact:${i + 1}`, label: `F${i + 1}` })),
    ];
    const diff = diffFingerprints(fingerprintGraph(graphOf(prevNodes)), fingerprintGraph(graphOf(nextNodes)));
    const { details } = describeGraphDiff(diff, graphOf(nextNodes));
    expect(details.length).toBe(9); // 8 shown + 1 overflow note
    expect(details[details.length - 1]).toContain("more");
  });
});
