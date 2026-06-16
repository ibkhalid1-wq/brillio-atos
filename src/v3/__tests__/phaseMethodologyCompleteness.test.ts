import { normalizeProgram } from "@/new/lib/programData";
import { derivePhaseMethodologyCompleteness } from "@/v3/lib/phaseMethodologyCompleteness";

/**
 * Strategy phase requires 4 inputs (businessObjective, sponsor, constraints,
 * successMetric), a set of required artifacts, and 3 mandatory exit criteria.
 * We fill one input and leave the rest, then assert the binding reconciles all
 * three sources.
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
      phases: [{ id: "strategy", pct: 30 }],
      phaseInputs: {
        strategy: {
          businessObjective: "Cut cost-to-serve by 20% within 18 months.",
          // sponsor + successMetric left empty → required gaps
        },
      },
      gateReviews: {
        strategy: {
          exitCriteriaStatus: [
            { criterion: "Sponsor confirmed and committed", met: true, evidence: "Signed charter", mandatory: true },
          ],
        },
      },
    },
  });
}

describe("derivePhaseMethodologyCompleteness", () => {
  it("returns null without a program or phase", () => {
    expect(derivePhaseMethodologyCompleteness(null, "strategy")).toBeNull();
    expect(derivePhaseMethodologyCompleteness(makeProgram(), null)).toBeNull();
  });

  it("reconciles inputs, artifacts and exit criteria into one checklist", () => {
    const result = derivePhaseMethodologyCompleteness(makeProgram(), "strategy")!;
    const kinds = result.groups.map((g) => g.kind);
    expect(kinds).toContain("input");
    expect(kinds).toContain("artifact");
    expect(kinds).toContain("exit-criterion");

    const inputGroup = result.groups.find((g) => g.kind === "input")!;
    expect(inputGroup.total).toBe(4);          // businessObjective, sponsor, constraints, successMetric
    expect(inputGroup.present).toBe(1);          // only businessObjective filled

    const exitGroup = result.groups.find((g) => g.kind === "exit-criterion")!;
    expect(exitGroup.total).toBe(3);
    expect(exitGroup.present).toBe(1);           // only "Sponsor confirmed" marked met
  });

  it("computes an overall completeness percentage and not-complete flag", () => {
    const result = derivePhaseMethodologyCompleteness(makeProgram(), "strategy")!;
    expect(result.total).toBeGreaterThan(0);
    expect(result.present).toBeLessThan(result.total);
    expect(result.pct).toBe(Math.round((result.present / result.total) * 100));
    expect(result.complete).toBe(false);
  });
});
