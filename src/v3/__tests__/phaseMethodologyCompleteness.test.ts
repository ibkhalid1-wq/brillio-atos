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
    data: { methodology: "atos-standard",
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
    expect(inputGroup.total).toBe(8);          // businessObjective, sponsor, industry, startDate, targetEndDate, costAssumption, constraints, successMetric
    expect(inputGroup.present).toBe(1);          // only businessObjective filled

    const exitGroup = result.groups.find((g) => g.kind === "exit-criterion")!;
    expect(exitGroup.total).toBe(3);
    expect(exitGroup.present).toBe(1);           // only "Sponsor confirmed" marked met
  });

  it("honours the required-ness ratchet: a ratcheted input counts only for post-cutoff programmes", () => {
    // kpis is required since 2026-07-02. A programme created before the cutoff
    // must NOT show it as a required gap (8 inputs); one created on/after the
    // cutoff must (9 inputs) — matching the generation gate's ratchet rule.
    const preCutoff = normalizeProgram({
      id: "pre", name: "N", client: "C", industry: "Financial Services",
      updated_at: "2026-06-13T00:00:00.000Z",
      data: { methodology: "atos-standard", _createdAt: "2026-06-01T00:00:00.000Z", phases: [{ id: "strategy", pct: 0 }], phaseInputs: { strategy: {} } },
    });
    const postCutoff = normalizeProgram({
      id: "post", name: "N", client: "C", industry: "Financial Services",
      updated_at: "2026-07-10T00:00:00.000Z",
      data: { methodology: "atos-standard", _createdAt: "2026-07-10T00:00:00.000Z", phases: [{ id: "strategy", pct: 0 }], phaseInputs: { strategy: {} } },
    });
    const preInputs = derivePhaseMethodologyCompleteness(preCutoff, "strategy")!.groups.find((g) => g.kind === "input")!;
    const postInputs = derivePhaseMethodologyCompleteness(postCutoff, "strategy")!.groups.find((g) => g.kind === "input")!;
    expect(preInputs.total).toBe(8);
    expect(postInputs.total).toBe(9); // + Success KPIs
  });

  it("computes an overall completeness percentage and not-complete flag", () => {
    const result = derivePhaseMethodologyCompleteness(makeProgram(), "strategy")!;
    expect(result.total).toBeGreaterThan(0);
    expect(result.present).toBeLessThan(result.total);
    expect(result.pct).toBe(Math.round((result.present / result.total) * 100));
    expect(result.complete).toBe(false);
  });

  it("counts a required grid present only when it has a filled row, not a blank one", () => {
    // A grid persists as a JSON string. An empty "[]" or a single blank seeded
    // row must NOT count as present — otherwise the completeness panel disagrees
    // with derivePhaseInputQuality, which scores the same field set row-aware.
    const rosterInput = (value: string) =>
      normalizeProgram({
        id: "p", name: "N", client: "C", industry: "I", updated_at: "2026-06-13T00:00:00.000Z",
        data: { phases: [{ id: "mobilise", pct: 0 }], phaseInputs: { mobilise: { coreTeamRoster: value } } },
      });

    const rosterItem = (value: string) =>
      derivePhaseMethodologyCompleteness(rosterInput(value), "mobilise")!
        .groups.find((g) => g.kind === "input")!
        .items.find((i) => i.id === "input:coreTeamRoster")!;

    expect(rosterItem("[]").present).toBe(false);
    expect(rosterItem(JSON.stringify([{ id: "r1", role: "", name: "" }])).present).toBe(false);
    expect(rosterItem(JSON.stringify([{ id: "r1", role: "Sponsor", name: "Jane Doe" }])).present).toBe(true);
  });
});
