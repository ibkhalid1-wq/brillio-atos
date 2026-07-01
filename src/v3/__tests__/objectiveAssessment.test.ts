import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import type { ValidationFinding } from "@/v3/lib/crossArtifactValidation";
import { buildObjectiveGraph, graphGaps } from "@/v3/ontology/objectiveGraph";
import { assessObjectives } from "@/v3/ontology/objectiveConfidence";

/** Minimal ProgramSummary stub carrying only what the ontology selectors read. */
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

const OBJECTIVE = "Reduce cost to serve by 20% by FY27";

function businessCaseArtifact(confidence: number) {
  return {
    id: "business-case", phaseId: "strategy", title: "Business Case", status: "approved",
    agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1,
    agentConfidence: confidence,
  };
}

/**
 * A healthy strategy programme: measurable KPI, an objective that grounds the
 * business case, no risks. `dynamicSchema.artifactInputFlow` is what factGraph
 * uses to ground a fact into an artifact — in production the static methodology
 * flow is captured there at runtime, so the fixture mirrors that.
 */
function healthyProgram(overInputs: Record<string, unknown> = {}, pct = 100) {
  return program({
    phases: [{ id: "strategy", displayName: "Strategy", pct, status: "complete", objective: "" }],
    artifacts: [businessCaseArtifact(0.9)],
    rawData: {
      phaseInputs: {
        strategy: {
          businessObjective: OBJECTIVE,
          kpis: JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" }]),
          ...overInputs,
        },
      },
      dynamicSchema: {
        artifactInputFlow: { strategy: { "business-case": ["businessObjective", "successMetric"] } },
      },
    },
  });
}

const requirementFinding: ValidationFinding = {
  findingId: "rc-req14",
  severity: "critical",
  domain: "requirements-coverage",
  phaseId: "design",
  sourceArtifact: "requirementsCatalog",
  targetArtifact: "solution-architecture",
  sourceItem: "REQ-14",
  issue: "REQ-14 (SSO) is not covered by any design element.",
  recommendation: "Add design coverage for REQ-14",
  confidence: 0.85,
  evidence: ["requirementsCatalog: REQ-14; solution-architecture: no matching component"],
};

describe("buildObjectiveGraph", () => {
  it("returns an empty graph with no objective for a null program", () => {
    const graph = buildObjectiveGraph(null);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.objectiveIds).toHaveLength(0);
  });

  it("promotes the businessObjective fact to an objective node and links its delivery chain", () => {
    const graph = buildObjectiveGraph(healthyProgram());
    expect(graph.objectiveIds).toHaveLength(1);
    const objId = graph.objectiveIds[0];

    const measuredBy = graph.relations.filter((r) => r.from === objId && r.kind === "measured-by");
    const deliveredBy = graph.relations.filter((r) => r.from === objId && r.kind === "delivered-by");
    expect(measuredBy.length).toBeGreaterThanOrEqual(1);
    expect(deliveredBy.length).toBeGreaterThanOrEqual(1);
    // A complete KPI carries no gap.
    expect(measuredBy.every((r) => !r.gap)).toBe(true);
  });

  it("folds a requirements-coverage finding in as a satisfied-by gap edge", () => {
    const graph = buildObjectiveGraph(healthyProgram(), { findings: [requirementFinding] });
    const gaps = graphGaps(graph);
    const satisfied = gaps.find((r) => r.kind === "satisfied-by");
    expect(satisfied).toBeDefined();
    expect(satisfied?.gap?.findingId).toBe("rc-req14");
  });

  it("falls back to same-phase artifacts for delivery when grounding metadata is absent", () => {
    // No dynamicSchema.artifactInputFlow ⇒ the objective fact grounds no artifact,
    // but a business case sits in the objective's own (strategy) phase.
    const ungrounded = program({
      phases: [{ id: "strategy", displayName: "Strategy", pct: 100, status: "complete", objective: "" }],
      artifacts: [businessCaseArtifact(0.9)],
      rawData: {
        phaseInputs: {
          strategy: {
            businessObjective: OBJECTIVE,
            kpis: JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" }]),
          },
        },
      },
    });
    const graph = buildObjectiveGraph(ungrounded);
    const objId = graph.objectiveIds[0];
    const deliveredBy = graph.relations.filter((r) => r.from === objId && r.kind === "delivered-by");
    expect(deliveredBy.length).toBeGreaterThanOrEqual(1);
    expect(deliveredBy.some((r) => r.to === "artifact:business-case")).toBe(true);
  });

  it("attributes a programme-global artifact as delivery when grounding is absent", () => {
    // The one artifact is scoped to a non-phase bucket ("program"), as a
    // programme charter would be. It should still count as delivery.
    const globalArtifact = program({
      phases: [{ id: "strategy", displayName: "Strategy", pct: 0, status: "active", objective: "" }],
      artifacts: [{
        id: "charter", phaseId: "program", title: "Programme Charter", status: "approved",
        agentGenerated: true, lastEditedBy: "agent", lastEditedAt: "", contentSummary: "", versionNumber: 1,
        agentConfidence: 0.8,
      }],
      rawData: {
        phaseInputs: { strategy: { businessObjective: OBJECTIVE } },
      },
    });
    const graph = buildObjectiveGraph(globalArtifact);
    const objId = graph.objectiveIds[0];
    const deliveredBy = graph.relations.filter((r) => r.from === objId && r.kind === "delivered-by");
    expect(deliveredBy.some((r) => r.to === "artifact:charter")).toBe(true);
  });

  it("never admits a relation that violates the ontology", () => {
    const graph = buildObjectiveGraph(healthyProgram());
    // Every relation's endpoints must exist as nodes (guard side-effect).
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const rel of graph.relations) {
      expect(ids.has(rel.from)).toBe(true);
      expect(ids.has(rel.to)).toBe(true);
    }
  });
});

describe("assessObjectives", () => {
  it("returns an empty assessment for a program with no objective", () => {
    const result = assessObjectives(program({ phases: [{ id: "strategy", displayName: "Strategy", pct: 0, status: "active", objective: "" }] }));
    expect(result.objectives).toHaveLength(0);
    expect(result.overall).toBe(0);
    expect(result.band).toBe("Critical");
  });

  it("scores a healthy objective as Strong with no measurability blocker", () => {
    const result = assessObjectives(healthyProgram());
    expect(result.objectives).toHaveLength(1);
    const obj = result.objectives[0];
    expect(obj.confidence).toBeGreaterThanOrEqual(90);
    expect(obj.band).toBe("Strong");
    expect(obj.blockers.find((b) => b.component === "measurable")).toBeUndefined();
    // The five components each contribute, summing to the headline score.
    const summed = Math.round(obj.components.reduce((s, c) => s + c.score * c.weight, 0) * 100);
    expect(summed).toBe(obj.confidence);
  });

  it("flags an unmeasurable objective (no KPI) with a 25-point measurable blocker", () => {
    // Remove KPIs entirely.
    const result = assessObjectives(healthyProgram({ kpis: JSON.stringify([]) }));
    const obj = result.objectives[0];
    const measurable = obj.components.find((c) => c.key === "measurable")!;
    expect(measurable.score).toBe(0);
    const blocker = obj.blockers.find((b) => b.component === "measurable");
    expect(blocker).toBeDefined();
    expect(blocker!.expectedGain).toBe(25);
    expect(blocker!.label).toBe("Objective is not measurable");
  });

  it("marks a KPI missing its target as a measurability gap", () => {
    const result = assessObjectives(healthyProgram({
      kpis: JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "", unit: "$" }]),
    }));
    const obj = result.objectives[0];
    expect(obj.components.find((c) => c.key === "measurable")!.score).toBeLessThan(1);
    expect(obj.blockers.some((b) => b.component === "measurable")).toBe(true);
  });

  it("lowers evidence confidence and surfaces the specific requirement recommendation", () => {
    // pct 80 so a critical requirements gap pushes evidenced below the blocker bar.
    const result = assessObjectives(healthyProgram({}, 80), { findings: [requirementFinding] });
    const obj = result.objectives[0];
    const evidenced = obj.components.find((c) => c.key === "evidenced")!;
    expect(evidenced.score).toBeLessThan(0.75);
    // The finding's own recommendation is what gets surfaced, not a generic prompt.
    expect(result.recommendations.some((r) => r.recommendation === "Add design coverage for REQ-14")).toBe(true);
  });

  it("scores evidence from the real gate-review exit criteria and names an unmet one", () => {
    const prog = healthyProgram();
    (prog as unknown as Record<string, unknown>).gateReviews = {
      strategy: {
        phaseId: "strategy", phaseName: "Strategy", status: "pending-review",
        readinessScore: 40, artifactsSummary: [], openDecisions: 0, openRisks: 0,
        exitCriteriaStatus: [
          { criterion: "Business case approved", met: true, evidence: "signed" },
          { criterion: "Objectives defined and measurable", met: false, evidence: null },
          { criterion: "Sponsor confirmed and committed", met: false, evidence: null },
        ],
        recommendation: "", generatedAt: "", approvedAt: null, approvedBy: null, remediationNote: null,
      },
    };
    const result = assessObjectives(prog);
    const obj = result.objectives[0];
    const evidenced = obj.components.find((c) => c.key === "evidenced")!;
    // 1 of 3 mandatory strategy exit criteria met — evidence is the real fraction,
    // not the phase-progress proxy.
    expect(evidenced.score).toBeCloseTo(1 / 3, 5);
    const blocker = obj.blockers.find((b) => b.component === "evidenced");
    expect(blocker).toBeDefined();
    expect(blocker!.recommendation).toContain("Objectives defined and measurable");
  });

  it("penalises an objective threatened by an open severe risk", () => {
    const prog = healthyProgram();
    (prog as unknown as Record<string, unknown>).raidEntries = [
      { id: "r1", type: "risk", status: "open", severity: "high", title: "Vendor delay", phase: "strategy" },
    ];
    const result = assessObjectives(prog);
    const obj = result.objectives[0];
    const objId = obj.objectiveId;
    expect(result.graph.relations.some((r) => r.from === objId && r.kind === "threatened-by")).toBe(true);
    expect(obj.blockers.some((b) => b.component === "unthreatened")).toBe(true);
  });

  it("does not double-count an intrinsic KPI baseline gap against evidence", () => {
    // A KPI missing its target is a measurable gap only — it must not also erode
    // the evidenced component nor surface as a 'traceability' blocker.
    const result = assessObjectives(healthyProgram({
      kpis: JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "", unit: "$" }]),
    }));
    const obj = result.objectives[0];
    expect(obj.components.find((c) => c.key === "measurable")!.score).toBeLessThan(1);
    // Evidence stays whole (healthy strategy phase), unaffected by the KPI gap.
    expect(obj.components.find((c) => c.key === "evidenced")!.score).toBe(1);
    expect(obj.blockers.some((b) => b.label === "Requirement/benefit not traceable")).toBe(false);
  });

  it("cites the KPI behind the measurable component and the finding behind an evidence blocker", () => {
    const result = assessObjectives(healthyProgram({}, 80), { findings: [requirementFinding] });
    const obj = result.objectives[0];
    // The measurable component is traceable to its KPI node.
    const measurable = obj.components.find((c) => c.key === "measurable")!;
    expect(measurable.citations.length).toBeGreaterThanOrEqual(1);
    expect(measurable.citations.every((c) => c.kind === "kpi")).toBe(true);
    // The evidence blocker cites the specific validation finding that eroded it.
    const evidenceBlocker = obj.blockers.find((b) => b.component === "evidenced")!;
    expect(evidenceBlocker.citations.some((c) => c.kind === "finding" && c.ref === "rc-req14")).toBe(true);
  });

  it("cites the delivering phase behind the evidenced component", () => {
    const result = assessObjectives(healthyProgram());
    const evidenced = result.objectives[0].components.find((c) => c.key === "evidenced")!;
    expect(evidenced.citations.some((c) => c.kind === "phase" && c.ref === "strategy")).toBe(true);
  });

  it("ranks recommendations by expected gain, de-duplicated", () => {
    const result = assessObjectives(healthyProgram({ kpis: JSON.stringify([]) }), { findings: [requirementFinding] });
    const gains = result.recommendations.map((r) => r.expectedGain);
    // Non-increasing order.
    for (let i = 1; i < gains.length; i += 1) expect(gains[i - 1]).toBeGreaterThanOrEqual(gains[i]);
    // No duplicate recommendation text.
    const texts = result.recommendations.map((r) => r.recommendation);
    expect(new Set(texts).size).toBe(texts.length);
    // The unmeasurable objective's 25-point fix leads.
    expect(result.recommendations[0].component).toBe("measurable");
  });
});
