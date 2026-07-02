import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { buildProgramGraph } from "@/v3/lib/programGraph";
import { detectCoverageGaps, summarizeCoverageGaps, impactedBy, dependenciesOf, detectContradictions, propagateConfidence, coverageGapsToDirectives, buildCoverageDirectives, type CoverageGap } from "@/v3/lib/graphInference";

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

describe("detectContradictions", () => {
  it("finds conflicting KPI targets for the same metric across phases", () => {
    // The same metric is declared in Strategy with two conflicting targets. (Both
    // rows live on the strategy kpis grid; the conflict is value-level.)
    const kpis = JSON.stringify([
      { id: "k1", name: "Cycle time", baseline: "10d", target: "5d", unit: "days" },
      { id: "k2", name: "Cycle time", baseline: "10d", target: "3d", unit: "days" },
    ]);
    const graph = buildProgramGraph(program({ phases, rawData: { phaseInputs: { strategy: { kpis } } } }));
    const conflicts = detectContradictions(graph).filter((c) => c.kind === "conflicting-kpi-target");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain("5d");
    expect(conflicts[0].detail).toContain("3d");
  });

  it("finds a polarity conflict between an affirmative and a negated requirement", () => {
    const discoverReqs = JSON.stringify([{ id: "REQ-1", requirement: "Solution must support offline mode" }]);
    const designReqs = JSON.stringify([{ id: "NFR-1", requirement: "Solution must not support offline mode" }]);
    const graph = buildProgramGraph(program({
      phases,
      rawData: { phaseInputs: { discover: { requirements: discoverReqs }, design: { nonFunctionalRequirements: designReqs } } },
    }));
    const conflicts = detectContradictions(graph).filter((c) => c.kind === "polarity-conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].crossPhase).toBe(true);
  });

  it("does not flag two affirmative requirements about the same subject", () => {
    const reqs = JSON.stringify([
      { id: "REQ-1", requirement: "Solution must support offline mode" },
      { id: "REQ-2", requirement: "Solution must support offline mode fully" },
    ]);
    const graph = buildProgramGraph(program({ phases, rawData: { phaseInputs: { discover: { requirements: reqs } } } }));
    expect(detectContradictions(graph).filter((c) => c.kind === "polarity-conflict")).toHaveLength(0);
  });

  it("does not flag opposite-polarity statements about unrelated subjects", () => {
    const reqs = JSON.stringify([
      { id: "REQ-1", requirement: "Solution must support offline mode" },
      { id: "REQ-2", requirement: "Reporting should not export to PDF" },
    ]);
    const graph = buildProgramGraph(program({ phases, rawData: { phaseInputs: { discover: { requirements: reqs } } } }));
    expect(detectContradictions(graph).filter((c) => c.kind === "polarity-conflict")).toHaveLength(0);
  });

  it("returns nothing for an empty graph", () => {
    expect(detectContradictions(buildProgramGraph(null))).toEqual([]);
  });
});

describe("propagateConfidence", () => {
  // A low-confidence imported fact (0.4) grounds a high-confidence artifact (0.9).
  function graphWithGroundingConfidence(factConfidence: number) {
    const provenance = JSON.stringify({
      visionStatement: { source: "Deck p.2", documentName: "vision.pdf", confidence: factConfidence, extractionType: "extracted", value: "Reduce onboarding time" },
    });
    return buildProgramGraph(program({
      phases,
      artifacts: [
        { id: "charter", phaseId: "strategy", title: "Charter", status: "approved", agentGenerated: true, agentConfidence: 0.9, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1 },
      ],
      rawData: {
        phaseInputs: { strategy: { visionStatement: "Reduce onboarding time", _provenance: provenance } },
        dynamicSchema: { inputFields: { strategy: [{ id: "visionStatement", label: "Vision", type: "textarea", required: false, usedByArtifacts: ["charter"] }] } },
      },
    }));
  }

  it("dampens an artifact to its weakest grounding fact", () => {
    const result = propagateConfidence(graphWithGroundingConfidence(0.4));
    const charter = result.find((r) => r.nodeId === "artifact:charter");
    expect(charter).toBeDefined();
    expect(charter!.ownConfidence).toBe(0.9);
    expect(charter!.groundingConfidence).toBe(0.4);
    expect(charter!.effectiveConfidence).toBe(0.4);
    expect(charter!.dampened).toBe(true);
    expect(charter!.weakestGroundingId).toBeTruthy();
  });

  it("does not dampen when grounding is stronger than the artifact's own confidence", () => {
    const charter = propagateConfidence(graphWithGroundingConfidence(0.95)).find((r) => r.nodeId === "artifact:charter");
    expect(charter!.effectiveConfidence).toBe(0.9);
    expect(charter!.dampened).toBe(false);
  });

  it("omits artifacts with neither own confidence nor confidence-bearing grounding", () => {
    const graph = buildProgramGraph(program({
      phases,
      artifacts: [
        { id: "plan", phaseId: "build", title: "Plan", status: "draft", agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1 },
      ],
    }));
    expect(propagateConfidence(graph).find((r) => r.nodeId === "artifact:plan")).toBeUndefined();
  });

  it("returns nothing for an empty graph", () => {
    expect(propagateConfidence(buildProgramGraph(null))).toEqual([]);
  });
});

describe("coverageGapsToDirectives", () => {
  const gap = (over: Partial<CoverageGap>): CoverageGap =>
    ({ kind: "untraced-requirement", nodeId: "n", label: "L", detail: "", ...over });

  it("renders an imperative directive per gap kind", () => {
    const lines = coverageGapsToDirectives([
      gap({ kind: "untraced-requirement", label: "SSO" }),
      gap({ kind: "undelivered-scope", label: "Portal" }),
      gap({ kind: "ungrounded-fact", label: "EOL platform" }),
    ]);
    expect(lines[0]).toContain('Address requirement "SSO"');
    expect(lines[1]).toContain('Assign in-scope item "Portal"');
    expect(lines[2]).toContain('Ground fact "EOL platform"');
  });
});

describe("buildCoverageDirectives", () => {
  const requirements = JSON.stringify([
    { id: "REQ-1", requirement: "System must support SSO" },
    { id: "REQ-2", requirement: "Response under 200ms" },
  ]);
  const decisions = JSON.stringify([
    { id: "D-1", decision: "Adopt Okta", addresses: "System must support SSO" },
  ]);
  const prog = () => program({
    phases,
    rawData: { phaseInputs: { discover: { requirements }, design: { keyDesignDecisions: decisions } } },
  });

  it("returns empty for no program or empty phase", () => {
    expect(buildCoverageDirectives(null, "design")).toBe("");
    expect(buildCoverageDirectives(prog(), "")).toBe("");
  });

  it("emits a headered directive block for the phase's untraced requirement", () => {
    const block = buildCoverageDirectives(prog(), "design");
    expect(block).toContain("Coverage gaps to close");
    expect(block).toContain('Address requirement "Response under 200ms"');
    // The addressed requirement must not be nagged about.
    expect(block).not.toContain("System must support SSO");
  });

  it("excludes ungrounded-fact gaps by default (they are data-hygiene, not directives)", () => {
    const block = buildCoverageDirectives(
      program({
        phases,
        rawData: {
          phaseInputs: { strategy: { businessContext: "Legacy platform is end-of-life" } },
          dynamicSchema: { inputFields: { strategy: [{ id: "businessContext", label: "Business context", type: "textarea", required: false }] } },
        },
      }),
      "strategy",
    );
    expect(block).toBe("");
  });

  it("returns empty when the phase has no open coverage gaps", () => {
    const closed = JSON.stringify([
      { id: "D-1", decision: "Adopt Okta", addresses: "System must support SSO" },
      { id: "D-2", decision: "Add caching", addresses: "Response under 200ms" },
    ]);
    const block = buildCoverageDirectives(
      program({ phases, rawData: { phaseInputs: { discover: { requirements }, design: { keyDesignDecisions: closed } } } }),
      "design",
    );
    expect(block).toBe("");
  });
});
