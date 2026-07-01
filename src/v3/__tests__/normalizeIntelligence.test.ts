import { normalizeFieldMapping, normalizeIntelligence } from "@/new/lib/normalizeIntelligence";

// The extractor is an LLM: despite the prompt's fixed JSON skeleton it drifts —
// mappings come back as bare strings or null, entity arrays go missing, numbers
// arrive as strings. normalizeIntelligence is the single boundary that coerces
// all of that into a shape-guaranteed DocumentIntelligence so no downstream
// consumer has to defend itself (and none can be crashed by a malformed field).

describe("normalizeFieldMapping", () => {
  it("wraps a bare-string mapping as a value envelope", () => {
    expect(normalizeFieldMapping("Cut cost 20%")).toEqual({
      value: "Cut cost 20%",
      confidence: 0.75,
      source: "",
      extractionType: "extracted",
    });
  });

  it("coerces a numeric mapping value to string", () => {
    expect(normalizeFieldMapping(42)?.value).toBe("42");
  });

  it("returns null for null / value-less / empty-string mappings", () => {
    expect(normalizeFieldMapping(null)).toBeNull();
    expect(normalizeFieldMapping(undefined)).toBeNull();
    expect(normalizeFieldMapping({ confidence: 0.9 })).toBeNull();
    expect(normalizeFieldMapping({ value: null })).toBeNull();
    expect(normalizeFieldMapping("   ")).toBeNull();
  });

  it("keeps a well-formed envelope and trims the value", () => {
    expect(normalizeFieldMapping({ value: "  X  ", confidence: 0.9, source: "doc", extractionType: "enriched" })).toEqual({
      value: "X",
      confidence: 0.9,
      source: "doc",
      extractionType: "enriched",
    });
  });

  it("defaults an unknown extractionType and clamps confidence into [0,1]", () => {
    const m = normalizeFieldMapping({ value: "X", confidence: 5, extractionType: "bogus" });
    expect(m?.extractionType).toBe("extracted");
    expect(m?.confidence).toBe(1);
  });
});

describe("normalizeIntelligence — methodologyMappings", () => {
  it("keeps bare-string mappings and drops null/value-less ones per phase", () => {
    const intel = normalizeIntelligence({
      methodologyMappings: {
        design: {
          functionalDesignSummary: "Covers case intake and resolution", // bare string
          designApprovalDate: null, // value-less
          solutionApproach: { value: "Adopt Service Cloud", confidence: 0.9 },
        },
      },
    });
    expect(Object.keys(intel.methodologyMappings.design)).toEqual(["functionalDesignSummary", "solutionApproach"]);
    expect(intel.methodologyMappings.design.functionalDesignSummary.value).toBe("Covers case intake and resolution");
  });

  it("drops a phase whose every mapping is malformed", () => {
    const intel = normalizeIntelligence({
      methodologyMappings: { build: { a: null, b: "   " }, design: { x: "real" } },
    });
    expect(Object.keys(intel.methodologyMappings)).toEqual(["design"]);
  });

  it("tolerates a non-object methodologyMappings entirely", () => {
    expect(normalizeIntelligence({ methodologyMappings: "nope" }).methodologyMappings).toEqual({});
    expect(normalizeIntelligence({}).methodologyMappings).toEqual({});
  });
});

describe("normalizeIntelligence — entities & kpis", () => {
  it("guarantees every entity bucket is an array even when omitted", () => {
    const { entities } = normalizeIntelligence({});
    for (const key of ["objectives", "risks", "stakeholders", "milestones", "recommendations"] as const) {
      expect(Array.isArray(entities[key])).toBe(true);
    }
  });

  it("coerces stakeholder string fields so the roster bridge can trim them", () => {
    const { entities } = normalizeIntelligence({
      entities: { stakeholders: [{ name: 123, role: null, confidence: "x" }] },
    });
    const s = entities.stakeholders[0];
    expect(s.name).toBe("123");
    expect(s.role).toBe("");
    expect(typeof s.confidence).toBe("number");
  });

  it("drops non-object entity entries rather than passing them through", () => {
    const { entities } = normalizeIntelligence({ entities: { risks: ["oops", null, { text: "real risk" }] } });
    expect(entities.risks).toHaveLength(1);
  });

  it("normalizes kpis and drops nameless rows", () => {
    const { kpis } = normalizeIntelligence({
      kpis: [{ name: " Win rate ", target: 30, confidence: "0.9" }, { baseline: "10" }],
    });
    expect(kpis).toHaveLength(1);
    expect(kpis?.[0]).toMatchObject({ name: "Win rate", target: "30" });
  });

  it("never throws on a wholly malformed response and fills safe defaults", () => {
    const intel = normalizeIntelligence(null);
    expect(intel.documentType).toBe("other");
    expect(intel.overallConfidence).toBe(0.75);
    expect(intel.methodologyMappings).toEqual({});
    expect(intel.kpis).toEqual([]);
  });
});
