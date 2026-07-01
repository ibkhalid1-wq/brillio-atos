import { describe, it, expect } from "vitest";
import { mergePhaseInputBucket } from "@/v3/lib/phaseInputMerge";
import { PROVENANCE_KEY, parseProvenance, serializeProvenance } from "@/new/lib/fieldProvenance";

describe("mergePhaseInputBucket", () => {
  it("folds incoming fields onto a null/empty bucket and stamps savedAt", () => {
    const bucket = mergePhaseInputBucket(null, { a: "1", b: "2" });
    expect(bucket.a).toBe("1");
    expect(bucket.b).toBe("2");
    expect(typeof bucket.savedAt).toBe("string");
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
