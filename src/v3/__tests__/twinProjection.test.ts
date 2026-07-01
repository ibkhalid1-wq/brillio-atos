import { describe, it, expect } from "vitest";
import {
  domainState,
  summariseFidelity,
  buildTwinDomains,
  buildPhaseSpine,
  weightedCompletion,
  projectScenario,
  EMPTY_SCENARIO,
  type TwinDomainSource,
  type TwinModel,
} from "@/v3/lib/twinProjection";

describe("domainState", () => {
  it("is empty when absent, regardless of confidence", () => {
    expect(domainState(false, 0.9)).toBe("empty");
    expect(domainState(false, null)).toBe("empty");
  });

  it("is partial when present but low confidence, modeled otherwise", () => {
    expect(domainState(true, 0.4)).toBe("partial");
    expect(domainState(true, 0.5)).toBe("modeled");
    expect(domainState(true, null)).toBe("modeled");
  });
});

describe("summariseFidelity", () => {
  it("weights partial domains as half and empty as zero", () => {
    const fidelity = summariseFidelity([
      { key: "a", label: "A", state: "modeled", confidence: 1 },
      { key: "b", label: "B", state: "partial", confidence: 0.3 },
      { key: "c", label: "C", state: "empty", confidence: null },
      { key: "d", label: "D", state: "empty", confidence: null },
    ]);
    expect(fidelity).toMatchObject({ modeled: 1, partial: 1, empty: 2, total: 4 });
    expect(fidelity.score).toBeCloseTo((1 + 0.5) / 4);
  });

  it("returns zero score for no domains", () => {
    expect(summariseFidelity([]).score).toBe(0);
  });
});

describe("buildTwinDomains", () => {
  const full: TwinDomainSource = {
    narrative: "A grounded narrative",
    plan: { confidence: 0.8 },
    milestones: [{}, {}],
    budgetTracking: { confidence: 0.7 },
    criticalPath: { confidence: 0.6 },
    stakeholders: [{}],
    healthHeatmap: { confidence: 0.9 },
    raidEntries: [{}],
  };

  it("maps all eight domains as modeled when fully populated", () => {
    const domains = buildTwinDomains(full);
    expect(domains).toHaveLength(8);
    expect(domains.every((d) => d.state === "modeled")).toBe(true);
    expect(domains.map((d) => d.key)).toEqual([
      "narrative",
      "plan",
      "milestones",
      "budget",
      "criticalPath",
      "stakeholders",
      "health",
      "raid",
    ]);
  });

  it("marks blank narrative and empty collections as empty", () => {
    const domains = buildTwinDomains({
      ...full,
      narrative: "   ",
      milestones: [],
      stakeholders: [],
      raidEntries: [],
      plan: null,
      budgetTracking: null,
      criticalPath: null,
      healthHeatmap: null,
    });
    expect(domains.every((d) => d.state === "empty")).toBe(true);
  });

  it("marks a low-confidence agent domain as partial", () => {
    const domains = buildTwinDomains({ ...full, budgetTracking: { confidence: 0.2 } });
    expect(domains.find((d) => d.key === "budget")?.state).toBe("partial");
  });
});

describe("buildPhaseSpine", () => {
  const phases = [
    { id: "p1", displayName: "Discover", pct: 100, status: "complete" },
    { id: "p2", displayName: "Design", pct: 40, status: "active" },
    { id: "p3", displayName: "Deliver", pct: 0, status: "inactive" },
  ];

  it("joins health rag, phase spend, open RAID and workstream counts per phase", () => {
    const spine = buildPhaseSpine({
      phases,
      healthPhases: [
        { phaseId: "p1", rag: "green" },
        { phaseId: "p2", rag: "amber" },
      ],
      raidEntries: [
        { phase: "p2", status: "open" },
        { phase: "Design", status: "monitoring" }, // matched by displayName
        { phase: "p2", status: "closed" }, // excluded
      ],
      workstreams: [{ phaseId: "p2" }, { phaseId: "p2" }, { phaseId: "p3" }],
      projectedCost: 900,
      phaseActuals: { p1: 250 },
    });

    expect(spine[0]).toMatchObject({ phaseId: "p1", rag: "green", estimatedCost: 300, actualCost: 250, costStatus: "under", openRaidCount: 0, workstreamCount: 0 });
    expect(spine[1]).toMatchObject({ phaseId: "p2", rag: "amber", estimatedCost: 300, actualCost: null, openRaidCount: 2, workstreamCount: 2 });
    expect(spine[2]).toMatchObject({ phaseId: "p3", rag: "grey", workstreamCount: 1 });
  });

  it("leaves estimates null when no projected cost is set", () => {
    const spine = buildPhaseSpine({
      phases,
      healthPhases: [],
      raidEntries: [],
      workstreams: [],
      projectedCost: null,
      phaseActuals: {},
    });
    expect(spine.every((node) => node.estimatedCost === null && node.rag === "grey")).toBe(true);
  });
});

describe("weightedCompletion", () => {
  it("weights pct by weight", () => {
    expect(weightedCompletion([{ weight: 3, pct: 100 }, { weight: 1, pct: 0 }])).toBe(75);
  });
  it("returns null with no positive weight", () => {
    expect(weightedCompletion([])).toBeNull();
    expect(weightedCompletion([{ weight: 0, pct: 50 }])).toBeNull();
  });
});

describe("projectScenario", () => {
  const model: TwinModel = {
    phases: [{ id: "p1", pct: 100 }, { id: "p2", pct: 40 }, { id: "p3", pct: 0 }],
    workstreams: [
      { id: "w1", phaseId: "p1", weight: 2, pct: 100 },
      { id: "w2", phaseId: "p2", weight: 2, pct: 0 },
    ],
    milestones: [
      { id: "m1", title: "Go-live", phaseId: "p2" },
      { id: "m2", title: "Steady state", phaseId: "p3" },
    ],
    projectedCost: 1000,
    actualSpend: 600,
    projectedBenefits: 3000,
  };

  it("returns the live baseline for the empty scenario", () => {
    const projection = projectScenario(model, EMPTY_SCENARIO);
    expect(projection.scheduleSlipWeeks).toBe(0);
    expect(projection.baselineCompletionPct).toBe(50); // (2*100 + 2*0)/4
    expect(projection.projectedCompletionPct).toBe(50);
    expect(projection.projectedCost).toBe(1000);
    expect(projection.atRiskMilestones).toEqual([]);
    expect(projection.valueAtRisk).toBe(0);
  });

  it("sums phase delays, flags milestones in delayed phases, and shares value at risk", () => {
    const projection = projectScenario(model, {
      phaseDelaysWeeks: { p2: 3, p3: 2, p1: 0 },
      droppedWorkstreamIds: [],
      budgetDeltaPct: 0,
    });
    expect(projection.scheduleSlipWeeks).toBe(5);
    expect(projection.atRiskMilestones.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(projection.valueAtRisk).toBe(3000 * (2 / 3));
  });

  it("descoping an incomplete workstream raises projected completion", () => {
    const projection = projectScenario(model, {
      phaseDelaysWeeks: {},
      droppedWorkstreamIds: ["w2"],
      budgetDeltaPct: 0,
    });
    expect(projection.baselineCompletionPct).toBe(50);
    expect(projection.projectedCompletionPct).toBe(100); // only w1 remains
  });

  it("applies a budget delta and recomputes utilization", () => {
    const projection = projectScenario(model, {
      phaseDelaysWeeks: {},
      droppedWorkstreamIds: [],
      budgetDeltaPct: 20,
    });
    expect(projection.projectedCost).toBe(1200);
    expect(projection.costUtilization).toBeCloseTo(600 / 1200);
  });

  it("falls back to phase-average completion when there are no workstreams", () => {
    const projection = projectScenario({ ...model, workstreams: [] }, EMPTY_SCENARIO);
    expect(projection.baselineCompletionPct).toBeCloseTo((100 + 40 + 0) / 3);
  });
});
