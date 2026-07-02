import { describe, it, expect, beforeEach } from "vitest";
import {
  getConfidenceHistory,
  getPreviousScore,
  recordConfidenceSnapshot,
  getConfidenceForecast,
  assessGateRisk,
  getGateRisk,
  type ScoreSnapshot,
} from "@/v3/lib/confidenceHistory";

const DAY = 86_400_000;
const KEY = (id: string) => `atlas-confidence-history:${id}`;

/**
 * The history layer feeds the confidence trend + forecast. It must: use a
 * PRIOR-day snapshot as the trend baseline (not earlier-today, which would read
 * zero drift all day), throttle to one entry per calendar day, cap growth, and
 * defer to forecastConfidence for the projection.
 */
function seed(id: string, entries: Array<{ ts: number; score: number }>) {
  window.localStorage.setItem(KEY(id), JSON.stringify(entries));
}

describe("confidenceHistory", () => {
  beforeEach(() => window.localStorage.clear());

  it("returns no previous score when there is no prior-day history", () => {
    expect(getPreviousScore("p1")).toBeUndefined();
    // An entry from *today* is not a valid trend baseline.
    seed("p1", [{ ts: Date.now(), score: 55 }]);
    expect(getPreviousScore("p1")).toBeUndefined();
  });

  it("uses the most recent prior-day score as the trend baseline", () => {
    const now = Date.now();
    seed("p1", [
      { ts: now - 3 * DAY, score: 40 },
      { ts: now - 1 * DAY, score: 52 },
      { ts: now, score: 60 },
    ]);
    expect(getPreviousScore("p1")).toBe(52);
  });

  it("appends a new day but overwrites within the same day", () => {
    recordConfidenceSnapshot("p2", 50);
    expect(getConfidenceHistory("p2")).toHaveLength(1);
    // Same calendar day, new value → overwrite, not append.
    recordConfidenceSnapshot("p2", 57);
    const hist = getConfidenceHistory("p2");
    expect(hist).toHaveLength(1);
    expect(hist[0].score).toBe(57);
    // Same day, same value → no-op.
    recordConfidenceSnapshot("p2", 57);
    expect(getConfidenceHistory("p2")).toHaveLength(1);
  });

  it("preserves prior-day entries when recording today", () => {
    seed("p3", [{ ts: Date.now() - 2 * DAY, score: 30 }]);
    recordConfidenceSnapshot("p3", 44);
    const hist = getConfidenceHistory("p3");
    expect(hist).toHaveLength(2);
    expect(hist.map((h) => h.score)).toEqual([30, 44]);
  });

  it("caps the series length", () => {
    const now = Date.now();
    const many = Array.from({ length: 80 }, (_, i) => ({ ts: now - (80 - i) * DAY, score: i }));
    seed("p4", many);
    recordConfidenceSnapshot("p4", 99);
    expect(getConfidenceHistory("p4").length).toBeLessThanOrEqual(60);
  });

  it("forecasts an improving trend from a rising series", () => {
    const now = Date.now();
    seed("p5", [
      { ts: now - 6 * DAY, score: 40 },
      { ts: now - 4 * DAY, score: 50 },
      { ts: now - 2 * DAY, score: 58 },
    ]);
    const forecast = getConfidenceForecast("p5", 66, 80);
    expect(forecast.trend).toBe("improving");
    expect(forecast.weeklyVelocity).toBeGreaterThan(0);
  });

  it("reports insufficient history rather than guessing on a cold start", () => {
    const forecast = getConfidenceForecast("p6", 64, 80);
    expect(forecast.estimatedDaysToTarget).toBeNull();
    expect(forecast.trend).toBe("stable");
  });
});

describe("assessGateRisk", () => {
  const snap = (scores: number[]): ScoreSnapshot[] =>
    scores.map((score, i) => ({ ts: i * DAY, score }));

  it("reports no history on a cold start", () => {
    const risk = assessGateRisk([]);
    expect(risk.level).toBe("on-track");
    expect(risk.currentScore).toBeUndefined();
  });

  it("flags at-risk when the current score is already below the gate", () => {
    const risk = assessGateRisk(snap([80, 75, 65]), 70);
    expect(risk.level).toBe("at-risk");
    expect(risk.direction).toBe("falling");
  });

  it("flags at-risk when a falling trend projects below the gate within the lookahead", () => {
    // 88 → 82 → 76: above the 70 gate now, but -6/step projects 76 - 12 = 64 in two steps.
    const risk = assessGateRisk(snap([88, 82, 76]), 70);
    expect(risk.level).toBe("at-risk");
  });

  it("flags watch for a gentle decline that does not yet project failure", () => {
    // 95 → 93 → 91: falling but projects 91 - 4 = 87, comfortably above 70.
    const risk = assessGateRisk(snap([95, 93, 91]), 70);
    expect(risk.level).toBe("watch");
    expect(risk.direction).toBe("falling");
  });

  it("counts consecutive declines from the tail", () => {
    const risk = assessGateRisk(snap([60, 70, 68, 66, 64]), 50);
    expect(risk.consecutiveDeclines).toBe(3);
  });

  it("reports on-track for a rising, comfortably-above series", () => {
    const risk = assessGateRisk(snap([70, 78, 88]), 70);
    expect(risk.level).toBe("on-track");
    expect(risk.direction).toBe("rising");
  });

  it("getGateRisk anchors the live score to the series tail", () => {
    window.localStorage.clear();
    seed("g1", [{ ts: Date.now() - 2 * DAY, score: 82 }, { ts: Date.now() - DAY, score: 76 }]);
    // Live score 68 is below the gate → at-risk, regardless of stored tail.
    expect(getGateRisk("g1", 68, 70).level).toBe("at-risk");
  });
});
