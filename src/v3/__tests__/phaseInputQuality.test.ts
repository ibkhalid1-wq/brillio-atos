import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";

describe("derivePhaseInputQuality", () => {
  it("returns null without a phase", () => {
    expect(derivePhaseInputQuality(null, {})).toBeNull();
  });

  it("derives missing items from the Strategy schema — never workstreams", () => {
    const result = derivePhaseInputQuality("strategy", {
      businessObjective: "Modernise finance operations to cut cost-to-serve.",
      // sponsor, constraints, successMetric and KPIs left empty
    })!;
    // Only real Strategy inputs may appear.
    expect(result.missingCritical).toEqual(
      expect.arrayContaining(["Executive sponsor", "Key constraints", "Primary success metric", "Outcome KPIs"]),
    );
    expect(result.missingCritical).not.toContain("Defined workstreams");
    expect(result.missingCritical.join(" ").toLowerCase()).not.toContain("workstream");
    expect(result.verdict).not.toBe("sufficient");
  });

  it("includes Outcome KPIs for Strategy and marks them present when defined", () => {
    const result = derivePhaseInputQuality("strategy", {
      businessObjective: "Cut cost-to-serve by twenty percent within eighteen months across all regions.",
      sponsor: "Jane Smith, CFO",
      industry: "Financial services",
      startDate: "2026-01-01",
      targetEndDate: "2027-06-30",
      constraints: "Must go live before the Q4 financial year end with a fixed budget envelope.",
      successMetric: "Cost to serve",
      kpis: JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" }]),
    })!;
    expect(result.missingCritical).toHaveLength(0);
    expect(result.verdict).toBe("sufficient");
    expect(result.overallScore).toBeGreaterThan(60);
  });

  it("does not include KPIs or workstreams for non-Strategy phases", () => {
    const result = derivePhaseInputQuality("design", {})!;
    expect(result.missingCritical).toEqual(
      expect.arrayContaining(["Solution approach", "Integration points", "Design constraints"]),
    );
    expect(result.missingCritical).not.toContain("Outcome KPIs");
    expect(result.missingCritical.join(" ").toLowerCase()).not.toContain("workstream");
  });
});
