import { describe, it, expect } from "vitest";
import {
  describeOntologyOutputContract,
  parseOntologyEntities,
  stableEntityId,
  isEntityKind,
  isRelationKind,
} from "@/v3/lib/ontologyOutput";

describe("stableEntityId", () => {
  it("builds a deterministic <kind>:<slug> id", () => {
    expect(stableEntityId("requirement", "Must support SSO")).toBe("requirement:must-support-sso");
    // Same kind+label always yields the same id (idempotent write-back).
    expect(stableEntityId("requirement", "Must support SSO")).toBe(stableEntityId("requirement", "Must support SSO"));
  });

  it("uses the graph's `doc` prefix for documents", () => {
    expect(stableEntityId("document", "Charter.pdf")).toBe("doc:charter-pdf");
  });

  it("collapses punctuation and falls back for an empty label", () => {
    expect(stableEntityId("kpi", "  !!!  ")).toBe("kpi:entity");
  });
});

describe("kind/relation guards", () => {
  it("recognises valid kinds and relations only", () => {
    expect(isEntityKind("objective")).toBe(true);
    expect(isEntityKind("banana")).toBe(false);
    expect(isRelationKind("measured-by")).toBe(true);
    expect(isRelationKind("caused-by")).toBe(false);
  });
});

describe("describeOntologyOutputContract", () => {
  it("lists kinds and expected relations within budget", () => {
    const text = describeOntologyOutputContract();
    expect(text).toContain("Objective");
    expect(text).toContain("measured-by");
    expect(text).toContain("[expected]"); // gapWhenMissing relations are flagged
  });

  it("respects the char budget by dropping tail relation lines", () => {
    const full = describeOntologyOutputContract(10_000);
    const capped = describeOntologyOutputContract(400);
    expect(capped.length).toBeLessThanOrEqual(400);
    expect(capped.length).toBeLessThan(full.length);
    // The header survives the cut; relation lines are dropped from the tail first.
    expect(capped).toContain("ontology-native");
    expect(full).toContain("depends-on");
    expect(capped).not.toContain("depends-on");
  });
});

describe("parseOntologyEntities", () => {
  it("normalises typed entities and assigns stable ids", () => {
    const entities = parseOntologyEntities([
      { kind: "requirement", label: "Must support SSO", refs: [{ relation: "satisfied-by", to: "design:sso" }] },
    ]);
    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe("requirement:must-support-sso");
    expect(entities[0].refs[0]).toEqual({ relation: "satisfied-by", to: "design:sso" });
  });

  it("parses a JSON string and an {entities:[...]} wrapper", () => {
    const fromString = parseOntologyEntities('[{"kind":"kpi","label":"Adoption %"}]');
    expect(fromString[0].kind).toBe("kpi");
    const fromWrapper = parseOntologyEntities({ entities: [{ kind: "risk", label: "Vendor slip" }] });
    expect(fromWrapper[0].id).toBe("risk:vendor-slip");
  });

  it("drops entries with an unknown kind or blank label", () => {
    const entities = parseOntologyEntities([
      { kind: "banana", label: "nope" },
      { kind: "fact", label: "   " },
      { kind: "fact", label: "Legacy platform" },
    ]);
    expect(entities.map((e) => e.label)).toEqual(["Legacy platform"]);
  });

  it("filters refs whose relation is off-vocabulary and keeps valid ones", () => {
    const entities = parseOntologyEntities([
      {
        kind: "objective",
        label: "Grow revenue",
        refs: [
          { relation: "measured-by", to: "kpi:arr" },
          { relation: "caused-by", to: "kpi:x" },
          { relation: "delivered-by", to: "" },
        ],
      },
    ]);
    expect(entities[0].refs).toEqual([{ relation: "measured-by", to: "kpi:arr" }]);
  });

  it("merges refs from duplicate ids, deduping by relation+target", () => {
    const entities = parseOntologyEntities([
      { kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:arr" }] },
      { kind: "objective", label: "Grow revenue", refs: [{ relation: "measured-by", to: "kpi:arr" }, { relation: "delivered-by", to: "artifact:case" }] },
    ]);
    expect(entities).toHaveLength(1);
    expect(entities[0].refs).toEqual([
      { relation: "measured-by", to: "kpi:arr" },
      { relation: "delivered-by", to: "artifact:case" },
    ]);
  });

  it("returns an empty array for malformed JSON and non-arrays", () => {
    expect(parseOntologyEntities("{not json")).toEqual([]);
    expect(parseOntologyEntities(42)).toEqual([]);
    expect(parseOntologyEntities(null)).toEqual([]);
  });
});
