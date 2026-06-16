import { normalizeProgram } from "@/new/lib/programData";
import { selectPhaseMetrics, selectProgramMetrics } from "@/v3/lib/programMetrics";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { getGateThreshold } from "@/v3/lib/confidenceScore";

/**
 * programMetrics is the single source of truth for the headline numbers shown
 * across Today / Action Center / Executive / phase surfaces. These tests pin the
 * key invariant the module exists to guarantee: the active phase's readiness is
 * the SAME number however a surface reaches it (the standalone phase selector,
 * the programme-level `gateReadiness`, and the confidence breakdown all agree).
 */
function makeProgram() {
  return normalizeProgram({
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: {
      objective: "Modernize finance operations",
      activePhaseId: "mobilise",
      phases: [
        { id: "strategy", pct: 100 },
        { id: "mobilise", pct: 40 },
        { id: "discover", pct: 0 },
      ],
      gateReviews: {
        strategy: { status: "approved", readinessScore: 82 },
        mobilise: { status: "in-review", readinessScore: 40 },
      },
    },
  });
}

describe("selectProgramMetrics", () => {
  it("keeps active-phase readiness identical across every access path", () => {
    const program = makeProgram();
    const metrics = selectProgramMetrics(program, "mobilise");

    // The three numbers a surface might reach for "active phase readiness".
    expect(metrics.gateReadiness).toBe(metrics.activePhase!.readiness);
    expect(metrics.gateReadiness).toBe(metrics.confidence.breakdown.gateReadiness);
    // …and all equal the standalone phase selector a per-phase view would call.
    expect(metrics.gateReadiness).toBe(selectPhaseMetrics(program, "mobilise").readiness);
  });

  it("mirrors deriveProgramConfidence for the same scope", () => {
    const program = makeProgram();
    const metrics = selectProgramMetrics(program, "mobilise");
    expect(metrics.score).toBe(deriveProgramConfidence(program, "mobilise").score);
  });

  it("exposes the persisted gate-review score separately from composite readiness", () => {
    const program = makeProgram();
    const mobilise = selectPhaseMetrics(program, "mobilise");
    // Raw agent score is 40; composite readiness blends artifact/input quality in,
    // so the two are distinct numbers — never conflated as one "readiness".
    expect(mobilise.gateReviewScore).toBe(40);
    expect(mobilise.readiness).not.toBe(mobilise.gateReviewScore);
  });

  it("counts approved gates and uses the phase-calibrated threshold", () => {
    const program = makeProgram();
    const metrics = selectProgramMetrics(program, "mobilise");
    expect(metrics.approvedGates).toBe(1); // only the strategy gate is approved
    expect(metrics.totalGates).toBe(program.phases.length);
    expect(metrics.threshold).toBe(getGateThreshold("mobilise"));
  });

  it("an approved phase reports its persisted gate score as readiness", () => {
    const strategy = selectPhaseMetrics(makeProgram(), "strategy");
    expect(strategy.gateApproved).toBe(true);
    expect(strategy.readiness).toBe(82);
  });

  it("falls back to the program's own active phase when no override is given", () => {
    const metrics = selectProgramMetrics(makeProgram());
    expect(metrics.activePhaseId).toBe("mobilise");
    expect(metrics.activePhase).not.toBeNull();
  });
});
