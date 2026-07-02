import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { buildProgramGraph } from "@/v3/lib/programGraph";
import { detectCoverageGaps, summarizeCoverageGaps, impactedBy, dependenciesOf } from "@/v3/lib/graphInference";

function program(over: Record<string, unknown>): ProgramSummary {
  return {
    phases: [],
    artifacts: [],
    raidEntries: [],
    decisionQueue: [],
    stakeholders: [],
    rawData: {},
    ...over,
  } as unknown as ProgramSummary;
}

const phases = [
  { id: "strategy", displayName: "Strategy", pct: 100, status: "complete", objective: "" },
  { id: "discover", displayName: "Discover", pct: 60, status: "active", objective: "" },
  { id: "design", displayName: "Design", pct: 20, status: "active", objective: "" },
  { id: "build", displayName: "Build", pct: 0, status: "inactive", objective: "" },
];

describe("detectCoverageGaps", () => {
  it("returns nothing for an empty graph", () => {
    expect(detectCoverageGaps(buildProgramGraph(null))).toEqual([]);
  });

  it("flags a requirement that no design decision addresses, and clears it when one does", () => {
    const requirements = JSON.stringify([
      { id: "REQ-1", requirement: "System must support SSO" },
      { id: "REQ-2", requirement: "Response under 200ms" },
    ]);
    // A single decision addresses REQ-1 only, by its label text.
    const decisions = JSON.stringify([
      { id: "D-1", decision: "Adopt Okta", addresses: "System must support SSO" },
    ]);
    const graph = buildProgramGraph(program({
      phases,
      rawData: { phaseInputs: { discover: { requirements }, design: { keyDesignDecisions: decisions } } },
    }));

    const gaps = detectCoverageGaps(graph);
    const untraced = gaps.filter((g) => g.kind === "untraced-requirement");
    // REQ-1 is addressed; REQ-2 is not.
    expect(untraced).toHaveLength(1);
    expect(untraced[0].label).toBe("Response under 200ms");
  });

  it("flags an in-scope item that no increment delivers, and clears it when one does", () => {
    const scopeInclusions = JSON.stringify([
      { id: "S-1", item: "Customer portal" },
      { id: "S-2", item: "Admin console" },
    ]);
    const deliveryIncrements = JSON.stringify([
      { id: "I-1", increment: "MVP", delivers: "Customer portal" },
    ]);
    const graph = buildProgramGraph(program({
      phases,
      rawData: { phaseInputs: { discover: { scopeInclusions }, build: { deliveryIncrements } } },
    }));

    const gaps = detectCoverageGaps(graph);
    const undelivered = gaps.filter((g) => g.kind === "undelivered-scope");
    expect(undelivered).toHaveLength(1);
    expect(undelivered[0].label).toBe("Admin console");
  });

  it("flags an ungrounded fact", () => {
    // A confirmed free-text input becomes a fact; with no usedByArtifacts it grounds nothing.
    const graph = buildProgramGraph(program({
      phases,
      rawData: {
        phaseInputs: { strategy: { businessContext: "Legacy platform is end-of-life" } },
        dynamicSchema: { inputFields: { strategy: [{ id: "businessContext", label: "Business context", type: "textarea", required: false }] } },
      },
    }));
    const ungrounded = detectCoverageGaps(graph).filter((g) => g.kind === "ungrounded-fact");
    expect(ungrounded.length).toBeGreaterThanOrEqual(1);
  });

  it("groups gaps deterministically: requirements, then scope, then facts", () => {
    const graph = buildProgramGraph(program({
      phases,
      rawData: {
        phaseInputs: {
          discover: {
            requirements: JSON.stringify([{ id: "REQ-1", requirement: "R1" }]),
            scopeInclusions: JSON.stringify([{ id: "S-1", item: "Sc1" }]),
          },
        },
      },
    }));
    const kinds = detectCoverageGaps(graph).map((g) => g.kind);
    const reqIndex = kinds.indexOf("untraced-requirement");
    const scopeIndex = kinds.indexOf("undelivered-scope");
    expect(reqIndex).toBeGreaterThanOrEqual(0);
    expect(scopeIndex).toBeGreaterThan(reqIndex);
  });

  it("summarizes gaps by kind", () => {
    const graph = buildProgramGraph(program({
      phases,
      rawData: {
        phaseInputs: {
          discover: {
            requirements: JSON.stringify([{ id: "REQ-1", requirement: "R1" }, { id: "REQ-2", requirement: "R2" }]),
            scopeInclusions: JSON.stringify([{ id: "S-1", item: "Sc1" }]),
          },
        },
      },
    }));
    const summary = summarizeCoverageGaps(detectCoverageGaps(graph));
    expect(summary["untraced-requirement"]).toBe(2);
    expect(summary["undelivered-scope"]).toBe(1);
  });
});

describe("impact / reachability analysis", () => {
  // A programme where a decision addresses a requirement (addresses edge) and a
  // fact grounds an artifact (grounds edge), so both a requirement change and a
  // fact change have a real, deterministic downstream blast radius.
  const graph = () => buildProgramGraph(program({
    phases,
    artifacts: [
      { id: "charter", phaseId: "strategy", title: "Programme Charter", status: "approved", agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1 },
    ],
    rawData: {
      phaseInputs: {
        strategy: { businessContext: "Legacy platform is end-of-life" },
        discover: { requirements: JSON.stringify([{ id: "REQ-1", requirement: "System must support SSO" }]) },
        design: {
          keyDesignDecisions: JSON.stringify([{ id: "D-1", decision: "Adopt Okta", addresses: "System must support SSO" }]),
        },
      },
      dynamicSchema: {
        inputFields: {
          strategy: [{ id: "businessContext", label: "Business context", type: "textarea", required: false, usedByArtifacts: ["charter"] }],
        },
      },
    },
  }));

  it("finds what a requirement change impacts (the decision that addresses it)", () => {
    const impacted = impactedBy(graph(), "requirement:REQ-1").nodeIds;
    expect(impacted).toContain("decision:D-1");
  });

  it("finds what a fact change impacts (the artifact it grounds)", () => {
    const g = graph();
    const fact = g.nodes.find((n) => n.type === "fact");
    expect(fact).toBeDefined();
    expect(impactedBy(g, fact!.id).nodeIds).toContain("artifact:charter");
  });

  it("excludes the start node and returns an empty set for an unknown node", () => {
    const impacted = impactedBy(graph(), "requirement:REQ-1").nodeIds;
    expect(impacted).not.toContain("requirement:REQ-1");
    expect(impactedBy(graph(), "requirement:NOPE").nodeIds).toEqual([]);
  });

  it("walks provenance backward: an artifact depends on the fact that grounds it", () => {
    const g = graph();
    const fact = g.nodes.find((n) => n.type === "fact");
    expect(dependenciesOf(g, "artifact:charter").nodeIds).toContain(fact!.id);
  });

  it("returns empty reachability for an empty graph", () => {
    expect(impactedBy(buildProgramGraph(null), "x").nodeIds).toEqual([]);
    expect(dependenciesOf(buildProgramGraph(null), "x").nodeIds).toEqual([]);
  });
});
