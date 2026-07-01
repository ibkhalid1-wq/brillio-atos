import { buildReviewFields } from "@/new/lib/useDocumentIntelligence";
import type { MethodologyMappings, FieldMapping } from "@/new/lib/documentIntelligenceTypes";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

const m = (over: Partial<FieldMapping> = {}): FieldMapping => ({
  value: "x",
  confidence: 0.9,
  source: "doc",
  extractionType: "extracted",
  ...over,
});

/**
 * The methodology is the single source of truth for what an import may write.
 * Only Strategy declares static input fields; every later phase is dynamic and
 * has no input fields until the programme reaches and activates it (a dynamic
 * schema appears in the store). So a document that mentions Build or Operate
 * material must NOT scatter inputs into those unreached phases — those mappings
 * are dropped, never surfaced for review or saved.
 */
describe("buildReviewFields — methodology phase gate", () => {
  it("surfaces declared strategy fields and uses their methodology labels", () => {
    const mappings: MethodologyMappings = {
      strategy: { businessObjective: m({ value: "Cut cost 20%" }), sponsor: m({ value: "Jane, CFO" }) },
    };
    const fields = buildReviewFields(mappings, {});
    expect(fields.map((f) => f.fieldId).sort()).toEqual(["businessObjective", "sponsor"]);
    // Label comes from the methodology schema, never a raw id.
    expect(fields.find((f) => f.fieldId === "sponsor")?.fieldLabel).toBe("Executive sponsor");
  });

  it("drops a mapping whose field is not a declared strategy input (e.g. keyRoles)", () => {
    const mappings: MethodologyMappings = {
      strategy: { sponsor: m(), keyRoles: m({ value: "PM, architect" }) },
    };
    expect(buildReviewFields(mappings, {}).map((f) => f.fieldId)).toEqual(["sponsor"]);
  });

  it("drops every mapping for an unreached dynamic phase (build/operate) with no store", () => {
    const mappings: MethodologyMappings = {
      build: { blockers: m({ value: "Scope creep" }), keyRoles: m({ value: "UAT team" }) },
      operate: { adoption: m({ value: "Adoption plan" }) },
    };
    expect(buildReviewFields(mappings, {})).toEqual([]);
  });

  it("admits dynamic-phase fields only once the programme has generated that phase's schema", () => {
    const store: DynamicSchemaStore = {
      inputFields: {
        build: [{ id: "blockers", label: "Active blockers", type: "textarea", required: false }],
      },
    };
    const mappings: MethodologyMappings = {
      build: { blockers: m({ value: "Scope creep" }), keyRoles: m({ value: "UAT team" }) },
    };
    const fields = buildReviewFields(mappings, {}, store);
    // blockers is now declared (via the store) → admitted with its dynamic label;
    // keyRoles is still undeclared → dropped.
    expect(fields.map((f) => f.fieldId)).toEqual(["blockers"]);
    expect(fields[0].fieldLabel).toBe("Active blockers");
  });

  it("flags a conflict when the declared field already holds a different value", () => {
    const fields = buildReviewFields(
      { strategy: { sponsor: m({ value: "John" }) } },
      { strategy: { sponsor: "Jane" } },
    );
    expect(fields[0].hasConflict).toBe(true);
    expect(fields[0].existingValue).toBe("Jane");
  });
});

/**
 * The extractor is an LLM: despite the prompt's {value,confidence,...} skeleton,
 * it drifts to returning a mapping as a bare string, or lists a field it found
 * no data for as null. buildReviewFields must survive both — a bare string is a
 * real value to review (not silently dropped) and a null is skipped (not a crash
 * that sinks the whole import). Regression for "field extracted but not populated
 * via import": a bare-string design.functionalDesignSummary was being dropped and
 * a sibling null field was throwing before this normalisation.
 */
describe("buildReviewFields — tolerates model mapping-shape drift", () => {
  // A cast is used because these malformed shapes cannot occur under the
  // FieldMapping type, yet do occur at runtime in the raw extractor JSON.
  const mappings = (obj: unknown) => obj as MethodologyMappings;

  it("wraps a bare-string mapping as a reviewable value rather than dropping it", () => {
    const fields = buildReviewFields(
      mappings({ strategy: { businessObjective: "Cut cost 20%" } }),
      {},
    );
    expect(fields.map((f) => f.fieldId)).toEqual(["businessObjective"]);
    expect(fields[0].mapping.value).toBe("Cut cost 20%");
    // Synthesised envelope carries sensible defaults.
    expect(fields[0].mapping.extractionType).toBe("extracted");
    expect(fields[0].mapping.reviewState).toBe("pending");
  });

  it("skips a null / value-less mapping instead of throwing", () => {
    const build = () =>
      buildReviewFields(
        mappings({
          strategy: {
            businessObjective: "Real value",
            sponsor: null,
            constraints: { confidence: 0.9, source: "doc", extractionType: "extracted" },
            successMetric: { value: null },
          },
        }),
        {},
      );
    expect(build).not.toThrow();
    // Only the field with a usable value survives; the malformed siblings drop.
    expect(build().map((f) => f.fieldId)).toEqual(["businessObjective"]);
  });

  it("does not let one malformed field sink the rest of the mappings", () => {
    const fields = buildReviewFields(
      mappings({
        strategy: {
          sponsor: null, // would previously crash the whole build
          businessObjective: "Cut cost 20%", // bare string, previously dropped
          successMetric: m({ value: "NPS +10" }), // well-formed
        },
      }),
      {},
    );
    expect(fields.map((f) => f.fieldId).sort()).toEqual(["businessObjective", "successMetric"]);
  });

  it("coerces a numeric mapping value to string", () => {
    const fields = buildReviewFields(mappings({ strategy: { businessObjective: 42 } }), {});
    expect(fields[0].mapping.value).toBe("42");
  });

  it("treats an empty-string / whitespace bare mapping as no value", () => {
    expect(buildReviewFields(mappings({ strategy: { businessObjective: "   " } }), {})).toEqual([]);
  });
});
