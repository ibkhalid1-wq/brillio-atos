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
