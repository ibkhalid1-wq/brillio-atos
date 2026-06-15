import { normalizeProgram } from "@/new/lib/programData";
import { derivePhaseExecutiveSummary } from "@/v3/lib/phaseExecutiveSummary";

/**
 * A barely-started phase: no inputs, no artifacts, an open critical risk. This
 * should read as "blocked" with at least one critical blocker and a next action.
 */
function makeStrugglingProgram() {
  return normalizeProgram({
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: {
      objective: "Modernize finance operations",
      phases: [{ id: "mobilise", pct: 10 }],
      raidLog: {
        entries: [
          { id: "r1", type: "risk", title: "No executive sponsor confirmed", severity: "critical", phase: "mobilise", status: "open", createdAt: "2026-06-12T00:00:00.000Z" },
        ],
      },
    },
  });
}

describe("derivePhaseExecutiveSummary", () => {
  it("returns null without a program or phase", () => {
    expect(derivePhaseExecutiveSummary(null, "mobilise")).toBeNull();
    expect(derivePhaseExecutiveSummary(makeStrugglingProgram(), null)).toBeNull();
  });

  it("summarises a struggling phase as blocked with a critical blocker", () => {
    const summary = derivePhaseExecutiveSummary(makeStrugglingProgram(), "mobilise");
    expect(summary).not.toBeNull();
    expect(summary!.verdict).toBe("blocked");
    expect(summary!.canProgress).toBe(false);
    expect(summary!.criticalCount).toBeGreaterThan(0);
    expect(summary!.blockerCount).toBeGreaterThanOrEqual(summary!.criticalCount);
    expect(summary!.headline.toLowerCase()).toContain("blocked");
  });

  it("exposes scores and a next action consistent with the detail view", () => {
    const summary = derivePhaseExecutiveSummary(makeStrugglingProgram(), "mobilise")!;
    expect(summary.readinessScore).toBeGreaterThanOrEqual(0);
    expect(summary.readinessScore).toBeLessThanOrEqual(100);
    expect(summary.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(summary.confidenceScore).toBeLessThanOrEqual(100);
    expect(summary.threshold).toBeGreaterThan(0);
    // A struggling phase always has a recommended way forward.
    expect(summary.nextAction).not.toBeNull();
  });
});
