import { describe, it, expect } from "vitest";
import {
  structuralSimilarity,
  convergenceScore,
  meetsConvergenceTarget,
} from "@/v3/lib/artifactConvergence";

const charter = () => ({
  title: "Transformation Charter",
  sponsor: "Jane Smith",
  mandate: "Authorise the finance modernisation programme and set its boundaries",
  objectives: ["Reduce processing time", "Improve compliance"],
  successCriteria: ["20% faster close"],
  confidence: 0.8,
  generatedAt: "2026-01-01T00:00:00.000Z",
});

describe("structuralSimilarity", () => {
  it("scores identical artifacts as 1", () => {
    expect(structuralSimilarity(charter(), charter())).toBeCloseTo(1, 5);
  });

  it("ignores provenance fields that vary per run", () => {
    const a = charter();
    const b = { ...charter(), confidence: 0.42, generatedAt: "2026-09-09T00:00:00.000Z" };
    expect(structuralSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("ignores internal _generationMetadata", () => {
    const a = charter();
    const b = { ...charter(), _generationMetadata: { runMode: "manual_regeneration", changedInputs: ["budget"] } };
    expect(structuralSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("stays high when only prose is reworded but structure is preserved", () => {
    const a = charter();
    const b = {
      ...charter(),
      mandate: "Authorize the finance modernization program and define its scope",
    };
    const score = structuralSimilarity(a, b);
    expect(score).toBeGreaterThan(0.85);
    expect(score).toBeLessThan(1);
  });

  it("penalizes reordered sections", () => {
    const a = { alpha: "one", beta: "two", gamma: "three" };
    const b = { gamma: "three", beta: "two", alpha: "one" };
    const score = structuralSimilarity(a, b);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0.8);
  });

  it("scores structurally unrelated artifacts low", () => {
    const score = structuralSimilarity(charter(), { foo: "bar", baz: [1, 2, 3] });
    expect(score).toBeLessThan(0.5);
  });

  it("penalizes array length drift", () => {
    const full = structuralSimilarity({ items: ["a", "b", "c"] }, { items: ["a", "b", "c"] });
    const short = structuralSimilarity({ items: ["a", "b", "c"] }, { items: ["a"] });
    expect(full).toBeCloseTo(1, 5);
    expect(short).toBeLessThan(full);
  });
});

describe("convergenceScore", () => {
  it("returns 1 for a single run", () => {
    expect(convergenceScore([charter()])).toBe(1);
  });

  it("meets the convergence target for identical regenerations", () => {
    const runs = [charter(), charter(), charter()];
    const score = convergenceScore(runs);
    expect(score).toBeCloseTo(1, 5);
    expect(meetsConvergenceTarget(score)).toBe(true);
  });

  it("meets the target when only wording drifts across regenerations", () => {
    const runs = [
      charter(),
      { ...charter(), successCriteria: ["20% faster financial close"] },
      { ...charter(), successCriteria: ["20% quicker close"] },
    ];
    expect(meetsConvergenceTarget(convergenceScore(runs), 0.9)).toBe(true);
  });

  it("fails the target when regenerations diverge structurally", () => {
    const runs = [
      charter(),
      { title: "Charter", differentShape: true, sections: ["x"] },
      { foo: "bar" },
    ];
    expect(meetsConvergenceTarget(convergenceScore(runs))).toBe(false);
  });
});
