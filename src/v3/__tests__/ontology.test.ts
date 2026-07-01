import { describe, it, expect } from "vitest";
import {
  ENTITY_TYPES,
  ENTITY_KINDS,
  RELATION_TYPES,
  RELATION_KINDS,
  isValidRelation,
  relationsBetween,
  isObjectiveFactType,
  type EntityKind,
} from "@/v3/ontology/ontology";

describe("ontology vocabulary", () => {
  it("every entity type is keyed by its own kind", () => {
    for (const kind of ENTITY_KINDS) {
      expect(ENTITY_TYPES[kind].kind).toBe(kind);
      expect(ENTITY_TYPES[kind].curie.startsWith("atos:")).toBe(true);
    }
  });

  it("every relation type is keyed by its own kind and references valid entity kinds", () => {
    const validKind = new Set<EntityKind>(ENTITY_KINDS);
    for (const kind of RELATION_KINDS) {
      const rel = RELATION_TYPES[kind];
      expect(rel.kind).toBe(kind);
      expect(rel.from.length).toBeGreaterThan(0);
      expect(rel.to.length).toBeGreaterThan(0);
      for (const k of [...rel.from, ...rel.to]) expect(validKind.has(k)).toBe(true);
    }
  });
});

describe("isValidRelation", () => {
  it("accepts an objective measured-by a KPI", () => {
    expect(isValidRelation("measured-by", "objective", "kpi")).toBe(true);
  });

  it("accepts a requirement satisfied-by a design element", () => {
    expect(isValidRelation("satisfied-by", "requirement", "design")).toBe(true);
  });

  it("rejects a nonsensical relation (risk measured-by stakeholder)", () => {
    expect(isValidRelation("measured-by", "risk", "stakeholder")).toBe(false);
  });

  it("rejects an objective satisfied-by anything (satisfied-by starts at a requirement)", () => {
    expect(isValidRelation("satisfied-by", "objective", "design")).toBe(false);
  });
});

describe("relationsBetween", () => {
  it("finds measured-by between objective and kpi", () => {
    expect(relationsBetween("objective", "kpi")).toContain("measured-by");
  });

  it("finds no relation between two stakeholders", () => {
    expect(relationsBetween("stakeholder", "stakeholder")).toHaveLength(0);
  });
});

describe("isObjectiveFactType", () => {
  it("recognises objective field ids", () => {
    expect(isObjectiveFactType("businessObjective")).toBe(true);
    expect(isObjectiveFactType("programObjective")).toBe(true);
  });

  it("does not misclassify unrelated fields", () => {
    expect(isObjectiveFactType("sponsor")).toBe(false);
    expect(isObjectiveFactType("successMetric")).toBe(false);
    expect(isObjectiveFactType(undefined)).toBe(false);
  });
});
