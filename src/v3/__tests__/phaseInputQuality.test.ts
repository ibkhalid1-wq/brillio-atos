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
      costAssumption: "Approximately $2.4M based on vendor quotes and a six-person core team over eighteen months.",
      constraints: "Must go live before the Q4 financial year end with a fixed budget envelope.",
      successMetric: "Cost to serve",
      kpis: JSON.stringify([{ id: "k1", name: "Cost to serve", baseline: "100", target: "80", unit: "$" }]),
    })!;
    expect(result.missingCritical).toHaveLength(0);
    expect(result.verdict).toBe("sufficient");
    expect(result.overallScore).toBeGreaterThan(60);
  });

  it("assesses Design against its static solution-design schema", () => {
    // Design carries a static methodology schema (solution approach, target
    // architecture, NFRs, …) so its required facts are always assessed regardless
    // of what the planner proposes — generation never depends on the planner
    // remembering to ask for design substance.
    const result = derivePhaseInputQuality("design", {})!;
    expect(result).not.toBeNull();
    expect(result.missingCritical).toEqual(
      expect.arrayContaining([
        "Solution approach & design principles",
        "Target architecture summary",
        "Non-functional requirements",
      ]),
    );
  });

  it("returns null for a dynamic-only phase — no static schema, so no leaked KPI/workstream fields", () => {
    // Strategy, Mobilise, Discover and Design carry static input schemas; the
    // remaining phases are dynamic-only, so their fields come from the programme's
    // dynamicSchema store, not from here. With no static fields there is nothing to
    // assess — and crucially no path for "Outcome KPIs"/"workstreams" to leak in.
    expect(derivePhaseInputQuality("build", {})).toBeNull();
    expect(derivePhaseInputQuality("operate", { anything: "x" })).toBeNull();
  });

  it("scores a dynamic-only phase against its ai-derived fields when a store is supplied", () => {
    // The header metric must assess the SAME field set the inputs panel renders.
    // Once the planner has proposed dynamic fields for a phase, omitting the store
    // (the old behaviour) under-counts inputs; passing it makes the metric track
    // exactly what the user can fill in.
    const store = {
      inputFields: {
        build: [
          { id: "modelRoutingPolicy", label: "Model routing policy", type: "textarea" as const, required: true },
          { id: "dataResidency", label: "Data residency", type: "textarea" as const, required: true },
        ],
      },
    };
    // With no store, build is dynamic-only → null.
    expect(derivePhaseInputQuality("build", { modelRoutingPolicy: "Route to Opus for planning." }, undefined)).toBeNull();
    // With the store, the dynamic required fields become the assessed set.
    const result = derivePhaseInputQuality(
      "build",
      { modelRoutingPolicy: "Route planning to Opus and execution to Sonnet for cost efficiency." },
      store,
    )!;
    expect(result).not.toBeNull();
    expect(result.total).toBe(2);
    expect(result.present).toBe(1);
    expect(result.missingCritical).toContain("Data residency");
  });
});
