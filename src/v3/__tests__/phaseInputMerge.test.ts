import { describe, it, expect } from "vitest";
import { mergePhaseInputBucket } from "@/v3/lib/phaseInputMerge";
import { movementInputsFingerprint } from "@/v3/components/flow/flowShellData";
import { PROVENANCE_KEY, parseProvenance, serializeProvenance } from "@/new/lib/fieldProvenance";

describe("mergePhaseInputBucket", () => {
  it("folds incoming fields onto a null/empty bucket and stamps the save time under _savedAt (not the fingerprinted savedAt)", () => {
    const bucket = mergePhaseInputBucket(null, { a: "1", b: "2" });
    expect(bucket.a).toBe("1");
    expect(bucket.b).toBe("2");
    expect(typeof bucket._savedAt).toBe("string");
    expect(bucket).not.toHaveProperty("savedAt");
  });

  it("purges a legacy bare savedAt so it stops polluting the fingerprint", () => {
    const bucket = mergePhaseInputBucket({ a: "old", savedAt: "2026-01-01T00:00:00Z" }, { a: "new" });
    expect(bucket).not.toHaveProperty("savedAt");
    expect(typeof bucket._savedAt).toBe("string");
  });

  it("the movement-inputs fingerprint is STABLE across saves that change no evidence (the discovery-kit stale bug)", () => {
    const prog = (bucket: Record<string, unknown>) => ({ id: "p", name: "p", rawData: { phaseInputs: { frame: bucket } } } as never);
    // Two saves of the same evidence carry different _savedAt values, yet the
    // fingerprint is identical — the churn that re-staled artifacts is gone.
    const a = { sponsor: "Raj", businessObjective: "x", _savedAt: "2026-01-01T00:00:00Z" };
    const b = { sponsor: "Raj", businessObjective: "x", _savedAt: "2099-12-31T23:59:59Z" };
    expect(a._savedAt).not.toBe(b._savedAt);
    expect(movementInputsFingerprint(prog(a), "frame")).toBe(movementInputsFingerprint(prog(b), "frame"));
    // And a real evidence change still moves it.
    const changed = { ...b, businessObjective: "y" };
    expect(movementInputsFingerprint(prog(changed), "frame")).not.toBe(movementInputsFingerprint(prog(b), "frame"));
  });

  it("lets incoming fields win while preserving untouched prior fields", () => {
    const bucket = mergePhaseInputBucket({ a: "old", c: "keep" }, { a: "new" });
    expect(bucket.a).toBe("new");
    expect(bucket.c).toBe("keep");
  });

  it("deep-merges provenance so a partial import keeps prior fields' provenance", () => {
    const prevProv = serializeProvenance({
      a: { source: "doc1", confidence: 1, extractionType: "extracted", value: "old" },
    });
    const incomingProv = serializeProvenance({
      b: { source: "doc2", confidence: 1, extractionType: "extracted", value: "2" },
    });
    const bucket = mergePhaseInputBucket(
      { a: "old", [PROVENANCE_KEY]: prevProv },
      { b: "2", [PROVENANCE_KEY]: incomingProv },
    );
    const merged = parseProvenance(bucket[PROVENANCE_KEY]);
    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
    expect(merged.a.value).toBe("old");
    expect(merged.b.value).toBe("2");
  });

  it("drops the provenance key when neither side carries provenance", () => {
    const bucket = mergePhaseInputBucket({ a: "x" }, { b: "y" });
    expect(bucket).not.toHaveProperty(PROVENANCE_KEY);
  });
});
