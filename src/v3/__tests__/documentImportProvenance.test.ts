import { buildApprovedInputs } from "@/new/lib/useDocumentIntelligence";
import { parseProvenance, mergeProvenance, provenanceMatches, PROVENANCE_KEY } from "@/new/lib/fieldProvenance";
import type { FieldProvenance } from "@/new/lib/fieldProvenance";
import type { ReviewField, FieldMapping, ExtractionType } from "@/new/lib/documentIntelligenceTypes";

/**
 * End-to-end source-traceability contract for document import. Provenance
 * (source quote, confidence, extraction type) captured at extraction must
 * survive the save into phaseInputs and stay correct across the edge cases the
 * importer has to handle: plain import, hand-edit vs import, field collisions,
 * and repeated imports into the same phase.
 */

const mapping = (over: Partial<FieldMapping>): FieldMapping => ({
  value: "",
  confidence: 0.9,
  source: "",
  extractionType: "extracted" as ExtractionType,
  ...over,
});

const field = (over: Partial<ReviewField> & { fieldId: string }): ReviewField => ({
  phaseId: "strategy",
  fieldLabel: over.fieldId,
  mapping: mapping({}),
  hasConflict: false,
  ...over,
});

function prov(bucket: Record<string, string>) {
  return parseProvenance(bucket[PROVENANCE_KEY]);
}

describe("fieldProvenance helpers", () => {
  it("parseProvenance tolerates empty/garbage", () => {
    expect(parseProvenance("")).toEqual({});
    expect(parseProvenance("not json")).toEqual({});
    expect(parseProvenance("[1,2]")).toEqual({});
    expect(parseProvenance(undefined)).toEqual({});
  });

  it("mergeProvenance keeps existing-only fields and lets incoming win on overlap", () => {
    const a = JSON.stringify({ sponsor: { source: "p1", confidence: 0.9, extractionType: "extracted", value: "Jane" } });
    const b = JSON.stringify({ constraints: { source: "p2", confidence: 0.8, extractionType: "inferred", value: "Q4" } });
    const merged = parseProvenance(mergeProvenance(a, b));
    expect(Object.keys(merged).sort()).toEqual(["constraints", "sponsor"]);
  });

  it("mergeProvenance returns undefined when neither side has provenance", () => {
    expect(mergeProvenance("", "")).toBeUndefined();
  });

  it("provenanceMatches gates the badge to imported-and-unmodified values", () => {
    const prov: FieldProvenance = { source: "p.2", confidence: 0.9, extractionType: "extracted", value: "Jane Doe, CFO" };
    // Unmodified import → badge shows; whitespace-only diff still matches.
    expect(provenanceMatches(prov, "Jane Doe, CFO")).toBe(true);
    expect(provenanceMatches(prov, "  Jane Doe, CFO  ")).toBe(true);
    // Hand-edited away from the snapshot → badge drops.
    expect(provenanceMatches(prov, "Jane Doe, CEO")).toBe(false);
    expect(provenanceMatches(prov, "")).toBe(false);
    // No provenance recorded, or a non-string live value → never shows.
    expect(provenanceMatches(undefined, "Jane Doe, CFO")).toBe(false);
    expect(provenanceMatches(prov, undefined)).toBe(false);
  });
});

describe("buildApprovedInputs — provenance persistence", () => {
  it("records source/confidence/extractionType + value snapshot for a plain accepted field", async () => {
    const out = await buildApprovedInputs([
      field({
        fieldId: "sponsor",
        mapping: mapping({ value: "Jane Doe, CFO", source: "p.2 sponsor table", confidence: 0.92, reviewState: "approved" }),
      }),
    ]);
    expect(out.strategy.sponsor).toBe("Jane Doe, CFO");
    const p = prov(out.strategy);
    expect(p.sponsor).toMatchObject({
      source: "p.2 sponsor table",
      confidence: 0.92,
      extractionType: "extracted",
      value: "Jane Doe, CFO",
    });
  });

  it("excludes rejected fields entirely (value and provenance)", async () => {
    const out = await buildApprovedInputs([
      field({ fieldId: "sponsor", mapping: mapping({ value: "Jane", reviewState: "rejected" }) }),
    ]);
    expect(out.strategy).toBeUndefined();
  });

  it("hand-edit wins verbatim and is marked enriched (edit vs import)", async () => {
    const out = await buildApprovedInputs([
      field({
        fieldId: "businessObjective",
        mapping: mapping({
          value: "Cut cost 20%",
          source: "exec summary",
          reviewState: "edited",
          editedValue: "Cut operating cost by 20% within FY26",
        }),
      }),
    ]);
    expect(out.strategy.businessObjective).toBe("Cut operating cost by 20% within FY26");
    const p = prov(out.strategy);
    expect(p.businessObjective.extractionType).toBe("enriched");
    expect(p.businessObjective.value).toBe("Cut operating cost by 20% within FY26");
  });

  it("a colliding text field is merged (not overwritten) and marked enriched", async () => {
    const out = await buildApprovedInputs([
      field({
        fieldId: "constraints",
        existingValue: "Budget capped at £2m",
        hasConflict: true,
        mapping: mapping({ value: "Must launch before regulatory deadline", source: "p.4" }),
      }),
    ]);
    // No refineField supplied → deterministic local merge keeps both sides.
    expect(out.strategy.constraints).toContain("Budget capped at £2m");
    expect(out.strategy.constraints).toContain("Must launch before regulatory deadline");
    expect(prov(out.strategy).constraints.extractionType).toBe("enriched");
  });

  it("a colliding KPI field merges structurally instead of corrupting JSON", async () => {
    const existing = JSON.stringify([{ id: "a", name: "Accuracy", baseline: "55%", target: "", unit: "%" }]);
    const incoming = JSON.stringify([{ id: "b", name: "Accuracy", baseline: "", target: "80%", unit: "%" }]);
    const out = await buildApprovedInputs([
      field({ fieldId: "kpis", existingValue: existing, hasConflict: true, mapping: mapping({ value: incoming }) }),
    ]);
    const rows = JSON.parse(out.strategy.kpis) as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Accuracy", baseline: "55%", target: "80%" });
  });

  it("handles mixed collisions: one conflict field merged, one clean field direct", async () => {
    const out = await buildApprovedInputs([
      field({ fieldId: "sponsor", mapping: mapping({ value: "Jane Doe", reviewState: "approved" }) }),
      field({
        fieldId: "constraints",
        existingValue: "Budget £2m",
        hasConflict: true,
        mapping: mapping({ value: "Tight timeline" }),
      }),
    ]);
    expect(out.strategy.sponsor).toBe("Jane Doe");
    expect(out.strategy.constraints).toContain("Budget £2m");
    expect(Object.keys(prov(out.strategy)).sort()).toEqual(["constraints", "sponsor"]);
  });

  it("multiple imports into one phase accumulate provenance (simulating the save-merge)", async () => {
    const first = await buildApprovedInputs([
      field({ fieldId: "sponsor", mapping: mapping({ value: "Jane", source: "doc1" }) }),
    ]);
    const second = await buildApprovedInputs([
      field({ fieldId: "constraints", mapping: mapping({ value: "Q4 deadline", source: "doc2" }) }),
    ]);
    // The save layer (mergePhaseInputBucket) deep-merges _provenance via mergeProvenance.
    const merged = parseProvenance(
      mergeProvenance(first.strategy[PROVENANCE_KEY], second.strategy[PROVENANCE_KEY]),
    );
    expect(merged.sponsor.source).toBe("doc1");
    expect(merged.constraints.source).toBe("doc2");
  });
});
