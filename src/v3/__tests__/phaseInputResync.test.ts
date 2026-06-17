import { managedInputSignature } from "@/v3/components/PhaseInputsPanel";

/**
 * Resync-guard contract. PhaseInputsPanel only blocks re-adopting persisted
 * inputs into the edit buffer when the incoming change is *our own* auto-save
 * echo (signature equals what we just saved). An external write — e.g. a document
 * import landing KPIs in phaseInputs.kpis — has a different signature and must be
 * adopted, otherwise the stale buffer hides it and the next auto-save wipes it.
 */

const STRATEGY_FIELDS = [
  { id: "businessObjective" },
  { id: "sponsor" },
  { id: "successMetric" },
];

describe("managedInputSignature", () => {
  it("ignores metadata keys so a save echo matches what we persisted", () => {
    const saved = { businessObjective: "Cut cost", sponsor: "Jane", kpis: "[]" };
    const echoed = { ...saved, savedAt: "2026-06-17T00:00:00Z", __provenance: "{...}" };
    expect(managedInputSignature(echoed, STRATEGY_FIELDS)).toBe(
      managedInputSignature(saved, STRATEGY_FIELDS),
    );
  });

  it("changes when an external write populates the KPI grid", () => {
    const before = { businessObjective: "Cut cost", kpis: "[]" };
    const afterImport = {
      businessObjective: "Cut cost",
      kpis: JSON.stringify([{ id: "a", name: "Accuracy", baseline: "55%", target: "80%", unit: "%" }]),
    };
    expect(managedInputSignature(afterImport, STRATEGY_FIELDS)).not.toBe(
      managedInputSignature(before, STRATEGY_FIELDS),
    );
  });

  it("treats missing and empty-string values identically", () => {
    expect(managedInputSignature({}, STRATEGY_FIELDS)).toBe(
      managedInputSignature({ businessObjective: "", sponsor: "", successMetric: "" }, STRATEGY_FIELDS),
    );
  });
});
