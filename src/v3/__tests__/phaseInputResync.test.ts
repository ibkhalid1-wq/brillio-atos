import { managedInputSignature, mergeDirtyValues } from "@/v3/components/PhaseInputsPanel";

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

/**
 * Three-way merge contract. When apply-improvements / regenerate echoes back a
 * fresh bucket while the user has unsaved edits, the buffer must keep the
 * user's edits and adopt the external change for everything else — never wipe a
 * field the external write didn't touch.
 */
describe("mergeDirtyValues", () => {
  it("keeps the user's edit while adopting an external write to another field", () => {
    const base = { businessObjective: "Cut cost", sponsor: "Jane" };
    const ours = { businessObjective: "Cut cost", sponsor: "Jane Doe" }; // user edited sponsor
    const theirs = { businessObjective: "Cut cost and time", sponsor: "Jane" }; // external improved objective
    expect(mergeDirtyValues(base, ours, theirs)).toEqual({
      businessObjective: "Cut cost and time",
      sponsor: "Jane Doe",
    });
  });

  it("keeps the user's edit even when the external write targets the same field", () => {
    const base = { businessObjective: "Cut cost" };
    const ours = { businessObjective: "Cut cost drastically" };
    const theirs = { businessObjective: "Cut cost and time" };
    expect(mergeDirtyValues(base, ours, theirs)).toEqual({ businessObjective: "Cut cost drastically" });
  });

  it("adopts a brand-new field introduced by the external write", () => {
    const base = { businessObjective: "Cut cost" };
    const ours = { businessObjective: "Cut cost drastically" };
    const theirs = { businessObjective: "Cut cost", scope: "EMEA" };
    expect(mergeDirtyValues(base, ours, theirs)).toEqual({
      businessObjective: "Cut cost drastically",
      scope: "EMEA",
    });
  });
});
