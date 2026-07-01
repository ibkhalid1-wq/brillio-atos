import { describe, it, expect } from "vitest";
import {
  runDeterministicValidation,
  summariseValidation,
  decideValidation,
  selectFindingsForPhase,
  type ValidatableProgram,
  type ValidationFinding,
} from "@/v3/lib/crossArtifactValidation";

const risk = (over: Partial<NonNullable<ValidatableProgram["raidEntries"]>[number]> = {}) => ({
  id: "R-01",
  type: "risk" as const,
  title: "Vendor readiness slips",
  description: "",
  severity: "high" as const,
  phase: "mobilise",
  owner: "Jane",
  mitigation: "Weekly vendor checkpoint",
  status: "open" as const,
  source: "agent" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
  closedBy: null,
  closureNote: null,
  ...over,
});

describe("runDeterministicValidation — risk & controls", () => {
  it("flags an open high risk with no mitigation", () => {
    const findings = runDeterministicValidation({ raidEntries: [risk({ mitigation: null })] });
    expect(findings).toHaveLength(1);
    expect(findings[0].domain).toBe("risk-controls");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].sourceItem).toBe("R-01");
    expect(findings[0].confidence).toBe(1);
  });

  it("does not flag a mitigated risk", () => {
    expect(runDeterministicValidation({ raidEntries: [risk()] })).toHaveLength(0);
  });

  it("ignores closed risks and low-severity risks", () => {
    const findings = runDeterministicValidation({
      raidEntries: [
        risk({ id: "R-02", mitigation: null, status: "closed" }),
        risk({ id: "R-03", mitigation: null, severity: "low" }),
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("flags an open blocker with no owner", () => {
    const findings = runDeterministicValidation({
      raidEntries: [risk({ id: "B-01", type: "blocker", owner: null, mitigation: "x" })],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].findingId).toBe("owner:B-01");
  });
});

describe("runDeterministicValidation — stakeholder readiness", () => {
  it("flags a high-influence stakeholder with no change actions", () => {
    const findings = runDeterministicValidation({
      stakeholders: [
        {
          id: "S-1",
          name: "CFO",
          role: "Finance lead",
          organisation: null,
          influence: "high",
          interest: "high",
          currentEngagement: "neutral",
          targetEngagement: "champion",
          sentiment: "neutral",
          riskOfDisengagement: "medium",
          recommendedActions: [],
          owner: null,
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].domain).toBe("stakeholder-readiness");
  });

  it("flags an impacted group with no interventions", () => {
    const findings = runDeterministicValidation({
      changeImpact: {
        impactedGroups: [
          {
            group: "Branch staff",
            impactLevel: "high",
            changeType: "process",
            affectedHeadcount: 200,
            readinessScore: 40,
            interventions: [],
            owner: null,
          },
        ],
        overallChangeLoad: "high",
        peakChangeWindow: "Q3",
        resistanceRisk: "high",
        topInterventions: [],
        confidence: 0.7,
        summary: "",
      },
    });
    expect(findings.some((f) => f.findingId === "change-interventions:Branch staff")).toBe(true);
  });
});

describe("runDeterministicValidation — benefits traceability", () => {
  it("flags projected benefits with no tracked KPIs", () => {
    const findings = runDeterministicValidation({
      budgetTracking: {
        projectedCost: 1000,
        actualSpend: null,
        projectedBenefits: 5000,
        realisedBenefits: null,
        roi: null,
        burnRate: "healthy",
        valueDeliveryRate: "on-track",
        phaseSpend: [],
        benefitMilestones: [],
        healthSignal: "green",
        healthReason: "",
        confidence: 0.8,
      },
      benefitsTracking: null,
    });
    expect(findings.some((f) => f.findingId === "benefits-no-kpis")).toBe(true);
  });

  it("does not flag benefits-no-kpis when strategy phaseInputs carry measurable KPIs", () => {
    // The common live shape: KPIs are authored in phaseInputs.strategy.kpis and
    // benefitsTracking has not been populated yet. That is tracked measurability,
    // not a missing-KPI gap, so the finding must not fire (no false positive).
    const budgetTracking = {
      projectedCost: 1000, actualSpend: null, projectedBenefits: 0, realisedBenefits: null,
      roi: null, burnRate: "healthy" as const, valueDeliveryRate: "on-track" as const,
      phaseSpend: [], benefitMilestones: [{ id: "bm1", title: "Go-live benefit", targetDate: null, estimatedValue: "100", status: "pending" as const, phaseId: "operate" }],
      healthSignal: "green" as const, healthReason: "", confidence: 0.8,
    };
    const kpisJson = JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" }]);
    // Both the flat and the `data`-wrapped rawData shapes must be recognised.
    const flat = runDeterministicValidation({
      budgetTracking, benefitsTracking: null,
      rawData: { phaseInputs: { strategy: { kpis: kpisJson } } },
    });
    const wrapped = runDeterministicValidation({
      budgetTracking, benefitsTracking: null,
      rawData: { data: { phaseInputs: { strategy: { kpis: kpisJson } } } },
    });
    expect(flat.some((f) => f.findingId === "benefits-no-kpis")).toBe(false);
    expect(wrapped.some((f) => f.findingId === "benefits-no-kpis")).toBe(false);
  });

  it("flags a strategy KPI that the populated benefits tracker dropped", () => {
    const kpisJson = JSON.stringify([
      { id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" },
      { id: "k2", name: "NPS", baseline: "20", target: "40", unit: "pts" },
    ]);
    const findings = runDeterministicValidation({
      benefitsTracking: {
        overallRag: "amber", summary: "",
        // Only "Cost to serve" is carried forward; "NPS" is silently dropped.
        kpis: [{ name: "Cost to serve", baseline: "100", target: "80", current: "95", rag: "green", trend: "improving", commentary: "" }],
        atRisk: [], onTrack: [], confidence: 0.7, trackedAt: "2026-01-01T00:00:00.000Z",
      },
      rawData: { phaseInputs: { strategy: { kpis: kpisJson } } },
    });
    expect(findings.some((f) => f.findingId === "benefits-kpi-untracked:NPS")).toBe(true);
    // The carried-forward KPI does not flag.
    expect(findings.some((f) => f.findingId === "benefits-kpi-untracked:Cost to serve")).toBe(false);
  });

  it("does not flag strategy-KPI drops when the benefits tracker is empty", () => {
    // An unbuilt tracker is the benefits-no-kpis concern, not a per-KPI fidelity
    // gap — flagging every strategy KPI here would be a false positive.
    const kpisJson = JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" }]);
    const findings = runDeterministicValidation({
      benefitsTracking: null,
      rawData: { phaseInputs: { strategy: { kpis: kpisJson } } },
    });
    expect(findings.some((f) => f.findingId.startsWith("benefits-kpi-untracked:"))).toBe(false);
  });

  it("flags a KPI missing a baseline", () => {
    const findings = runDeterministicValidation({
      benefitsTracking: {
        overallRag: "amber",
        summary: "",
        kpis: [{ name: "Cycle time", baseline: "", target: "20% faster", current: "n/a", rag: "unknown", trend: "unknown", commentary: "" }],
        atRisk: [],
        onTrack: [],
        confidence: 0.7,
        trackedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(findings.some((f) => f.findingId === "kpi-baseline:Cycle time")).toBe(true);
  });
});

describe("runDeterministicValidation — delivery, governance, scope", () => {
  it("flags a milestone with a broken dependency", () => {
    const findings = runDeterministicValidation({
      milestones: [
        {
          id: "M-1",
          title: "Design sign-off",
          phaseId: "design",
          targetDate: null,
          status: "on-track",
          dependsOn: ["M-missing"],
          exitCriteria: [],
          confidence: 0.6,
          source: "agent",
          lastUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    // An empty exitCriteria field is NOT flagged — exit criteria are derived by the
    // methodology, never authored by the user.
    expect(findings.some((f) => f.findingId === "milestone-exit:M-1")).toBe(false);
    expect(findings.some((f) => f.findingId === "milestone-dep:M-1:M-missing")).toBe(true);
  });

  it("flags a gate criterion marked met without evidence", () => {
    const findings = runDeterministicValidation({
      gateReviews: {
        design: {
          phaseId: "design",
          phaseName: "Design",
          status: "ready",
          readinessScore: 80,
          artifactsSummary: [],
          openDecisions: 0,
          openRisks: 0,
          exitCriteriaStatus: [{ criterion: "Architecture approved", met: true, evidence: null }],
          recommendation: "",
          generatedAt: "2026-01-01T00:00:00.000Z",
          approvedAt: null,
          approvedBy: null,
          remediationNote: null,
        },
      },
    });
    expect(findings.some((f) => f.domain === "governance")).toBe(true);
  });

  it("flags a phase signed off while an earlier phase has not cleared its gate", () => {
    const ph = (id: string, name: string, status: string) =>
      ({ id, displayName: name, status } as unknown as NonNullable<ValidatableProgram["phases"]>[number]);
    const findings = runDeterministicValidation({
      phases: [ph("discover", "Discover", "active"), ph("design", "Design", "complete")],
    });
    expect(findings.some((f) => f.findingId === "gate-sequence:design:discover")).toBe(true);
    expect(findings.find((f) => f.findingId === "gate-sequence:design:discover")!.severity).toBe("high");
  });

  it("does not flag phases that clear in sequence", () => {
    const ph = (id: string, name: string, status: string) =>
      ({ id, displayName: name, status } as unknown as NonNullable<ValidatableProgram["phases"]>[number]);
    const findings = runDeterministicValidation({
      phases: [ph("discover", "Discover", "complete"), ph("design", "Design", "complete"), ph("build", "Build", "active")],
    });
    expect(findings.some((f) => f.findingId.startsWith("gate-sequence:"))).toBe(false);
  });

  it("treats an approved upstream gate as clearing that phase for the sequence check", () => {
    const ph = (id: string, name: string, status: string) =>
      ({ id, displayName: name, status } as unknown as NonNullable<ValidatableProgram["phases"]>[number]);
    const findings = runDeterministicValidation({
      phases: [ph("discover", "Discover", "active"), ph("design", "Design", "complete")],
      gateReviews: {
        discover: { phaseId: "discover", status: "approved" } as unknown as NonNullable<ValidatableProgram["gateReviews"]>[string],
      },
    });
    expect(findings.some((f) => f.findingId.startsWith("gate-sequence:"))).toBe(false);
  });

  it("flags an active phase with no workstream, but not when workstreams are unplanned", () => {
    const phases = [{ id: "build", name: "Build", status: "active" as const } as unknown as NonNullable<ValidatableProgram["phases"]>[number]];
    const withWs = runDeterministicValidation({
      phases,
      workstreams: [{ id: "w1", label: "Data", phaseId: "design", weight: 1, pct: 50, gateScore: null, owner: null, status: "active" }],
    });
    expect(withWs.some((f) => f.findingId === "scope-workstream:build")).toBe(true);
    const noWs = runDeterministicValidation({ phases, workstreams: [] });
    expect(noWs).toHaveLength(0);
  });
});

describe("summariseValidation", () => {
  it("returns a perfect score for no findings", () => {
    const s = summariseValidation([]);
    expect(s.total).toBe(0);
    expect(s.coverageScore).toBe(100);
    expect(s.recommendation).toBe("Proceed");
  });

  it("recommends rework when a critical finding exists", () => {
    const findings = runDeterministicValidation({ raidEntries: [risk({ severity: "critical", mitigation: null })] });
    const s = summariseValidation(findings);
    expect(s.critical).toBe(1);
    expect(s.recommendation).toBe("Rework Required");
    expect(s.coverageScore).toBeLessThan(100);
  });

  it("can restrict to a single domain", () => {
    const program: ValidatableProgram = {
      raidEntries: [risk({ mitigation: null })],
      milestones: [
        { id: "M-1", title: "x", phaseId: "design", targetDate: null, status: "on-track", dependsOn: [], exitCriteria: [], confidence: 0.5, source: "agent", lastUpdatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const onlyRisk = runDeterministicValidation(program, { domains: ["risk-controls"] });
    expect(onlyRisk.every((f) => f.domain === "risk-controls")).toBe(true);
    expect(onlyRisk).toHaveLength(1);
  });
});

describe("selectFindingsForPhase", () => {
  const findings: ValidationFinding[] = [
    { findingId: "a", severity: "high", domain: "delivery-readiness", phaseId: "design", sourceArtifact: "milestones", targetArtifact: "", sourceItem: "M-1", issue: "", recommendation: "", confidence: 1, evidence: [] },
    { findingId: "b", severity: "low", domain: "delivery-readiness", phaseId: "build", sourceArtifact: "milestones", targetArtifact: "", sourceItem: "M-2", issue: "", recommendation: "", confidence: 1, evidence: [] },
    { findingId: "c", severity: "critical", domain: "benefits-traceability", sourceArtifact: "businessCaseDoc", targetArtifact: "", sourceItem: "x", issue: "", recommendation: "", confidence: 1, evidence: [] },
    { findingId: "d", severity: "medium", domain: "risk-controls", phaseId: "design", sourceArtifact: "raidEntries", targetArtifact: "", sourceItem: "R-1", issue: "", recommendation: "", confidence: 1, evidence: [] },
  ];

  it("returns only findings attributed to the phase by default", () => {
    const out = selectFindingsForPhase(findings, "design");
    expect(out.map((f) => f.findingId).sort()).toEqual(["a", "d"]);
  });

  it("can exclude domains and pull in severe program-wide findings", () => {
    const out = selectFindingsForPhase(findings, "design", {
      excludeDomains: ["risk-controls"],
      includeProgramWideAtLeast: "high",
    });
    expect(out.map((f) => f.findingId).sort()).toEqual(["a", "c"]);
  });
});

describe("decideValidation — triggering framework", () => {
  it("always validates on gate review", () => {
    const d = decideValidation("gate_review");
    expect(d.shouldValidate).toBe(true);
    expect(d.domains).toEqual([]);
  });

  it("skips validation when no material input changed", () => {
    const d = decideValidation("input_change", [{ field: "strategy.sponsor" }, { field: "design.notes" }]);
    expect(d.shouldValidate).toBe(false);
  });

  it("validates only impacted domains on a material change", () => {
    const d = decideValidation("input_change", [{ field: "discover.requirement_17", changeType: "added" }, { field: "strategy.budget" }]);
    expect(d.shouldValidate).toBe(true);
    expect(d.domains).toContain("requirements-coverage");
    expect(d.domains).toContain("benefits-traceability");
    expect(d.domains).not.toContain("stakeholder-readiness");
  });
});
