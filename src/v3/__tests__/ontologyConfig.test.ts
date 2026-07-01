import { describe, it, expect } from "vitest";
import {
  DEFAULT_ONTOLOGY_CONFIG,
  COMPONENT_KEYS,
  bandForScore,
  statusForScore,
  severityRank,
  severityForGain,
  isValidConfig,
} from "@/v3/ontology/ontologyConfig";
import { confidenceLabel } from "@/v3/lib/confidenceScore";

describe("ontologyConfig", () => {
  it("ships a valid default: component weights form a distribution", () => {
    expect(isValidConfig(DEFAULT_ONTOLOGY_CONFIG)).toBe(true);
    const sum = COMPONENT_KEYS.reduce((s, k) => s + DEFAULT_ONTOLOGY_CONFIG.weights[k], 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("rejects a config whose weights do not sum to 1", () => {
    const broken = {
      ...DEFAULT_ONTOLOGY_CONFIG,
      weights: { ...DEFAULT_ONTOLOGY_CONFIG.weights, measurable: 0.5 },
    };
    expect(isValidConfig(broken)).toBe(false);
  });

  it("labels a score identically to the process-health confidence model", () => {
    // Explainability > Trust: one score cannot read differently on two surfaces.
    for (const score of [0, 20, 39, 40, 55, 60, 72, 80, 95, 100]) {
      expect(bandForScore(score)).toBe(confidenceLabel(score));
    }
  });

  it("maps sub-scores to the good/warn/poor pill by the config thresholds", () => {
    expect(statusForScore(0.9)).toBe("good");
    expect(statusForScore(DEFAULT_ONTOLOGY_CONFIG.status.good)).toBe("good");
    expect(statusForScore(0.5)).toBe("warn");
    expect(statusForScore(DEFAULT_ONTOLOGY_CONFIG.status.warn)).toBe("warn");
    expect(statusForScore(0.1)).toBe("poor");
  });

  it("ranks severities worst-first and round-trips gains back to severities", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("high")).toBeGreaterThan(severityRank("medium"));
    expect(severityRank("medium")).toBeGreaterThan(severityRank("low"));

    expect(severityForGain(25)).toBe("critical");
    expect(severityForGain(12)).toBe("high");
    expect(severityForGain(6)).toBe("medium");
    expect(severityForGain(2)).toBe("low");
  });
});
