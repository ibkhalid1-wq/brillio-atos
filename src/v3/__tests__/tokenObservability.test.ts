import {
  estimateTokens,
  estimateCost,
  buildLedgerEntry,
  summarizeLedger,
  MODEL_PRICING,
  type AgentRunLedgerEntry,
} from "@/v3/lib/tokenObservability";

describe("tokenObservability — estimation", () => {
  it("estimates ~4 chars per token and 0 for blank", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens(null)).toBe(0);
  });

  it("prices output more than input and applies cache discount", () => {
    const full = estimateCost({ model: "claude-sonnet-4-6", inputTokens: 1_000_000, outputTokens: 0 });
    expect(full).toBeCloseTo(MODEL_PRICING["claude-sonnet-4-6"].inputPerMillion, 5);

    const out = estimateCost({ model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 1_000_000 });
    expect(out).toBeGreaterThan(full); // output is pricier than input

    const cached = estimateCost({
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(cached).toBeLessThan(full); // fully-cached input is cheaper
  });

  it("cheaper tier model costs less for identical tokens", () => {
    const haiku = estimateCost({ model: "claude-3-5-haiku-latest", inputTokens: 1000, outputTokens: 1000 });
    const opus = estimateCost({ model: "claude-opus-4-1", inputTokens: 1000, outputTokens: 1000 });
    expect(haiku).toBeLessThan(opus);
  });
});

describe("tokenObservability — ledger entries", () => {
  it("derives model+tier from the agent registry and computes cost", () => {
    const entry = buildLedgerEntry({
      programId: "prog-1",
      agentId: "input-quality", // Tier 1
      inputTokens: 2000,
      outputTokens: 500,
      timestamp: "2026-06-15T00:00:00.000Z",
    });
    expect(entry.tier).toBe("tier1");
    expect(entry.model).toBe("claude-3-5-haiku-latest");
    expect(entry.costUsd).toBeGreaterThan(0);
  });

  it("a skipped run records zero tokens and zero cost", () => {
    const entry = buildLedgerEntry({
      programId: "prog-1",
      agentId: "risk",
      inputTokens: 9999,
      outputTokens: 9999,
      timestamp: "2026-06-15T00:00:00.000Z",
      skipped: true,
    });
    expect(entry.skipped).toBe(true);
    expect(entry.inputTokens).toBe(0);
    expect(entry.costUsd).toBe(0);
  });
});

describe("tokenObservability — summary", () => {
  function ledger(): AgentRunLedgerEntry[] {
    return [
      buildLedgerEntry({
        programId: "prog-1",
        agentId: "risk",
        capability: "delivery",
        inputTokens: 4000,
        outputTokens: 1000,
        timestamp: "t1",
        cacheHit: true,
        outputs: { recommendations: 2, insights: 1 },
      }),
      buildLedgerEntry({
        programId: "prog-1",
        agentId: "narrative",
        capability: "executive",
        artifactId: "exec-brief",
        inputTokens: 8000,
        outputTokens: 3000,
        timestamp: "t2",
        latencyMs: 1200,
        outputs: { artifacts: 1 },
      }),
      buildLedgerEntry({
        programId: "prog-1",
        agentId: "scope-creep-monitor",
        capability: "delivery",
        inputTokens: 5000,
        outputTokens: 5000,
        timestamp: "t3",
        skipped: true, // skipped → only affects skip rate
      }),
    ];
  }

  it("aggregates totals, skip rate and cache-hit rate", () => {
    const s = summarizeLedger(ledger());
    expect(s.totalRuns).toBe(3);
    expect(s.executedRuns).toBe(2);
    expect(s.skippedRuns).toBe(1);
    expect(s.skipRate).toBeCloseTo(1 / 3, 2);
    expect(s.cacheHitRate).toBeCloseTo(0.5, 2); // 1 of 2 executed runs hit cache
    expect(s.totalInputTokens).toBe(12000); // skipped run contributes nothing
    expect(s.totalOutputTokens).toBe(4000);
  });

  it("buckets tokens by capability, model, program and artifact", () => {
    const s = summarizeLedger(ledger());
    expect(s.byCapability.delivery.runs).toBe(1); // the skipped one is excluded
    expect(s.byCapability.executive.runs).toBe(1);
    expect(s.byProgram["prog-1"].runs).toBe(2);
    expect(s.byArtifact["exec-brief"].runs).toBe(1);
    expect(Object.keys(s.byModel)).toContain("claude-sonnet-4-6");
  });

  it("computes unit economics per recommendation/artifact/insight", () => {
    const s = summarizeLedger(ledger());
    expect(s.unitEconomics.recommendations).toBe(2);
    expect(s.unitEconomics.artifacts).toBe(1);
    expect(s.unitEconomics.insights).toBe(1);
    expect(s.unitEconomics.costPerRecommendation).toBeCloseTo(s.totalCostUsd / 2, 6);
    expect(s.unitEconomics.costPerArtifact).toBeCloseTo(s.totalCostUsd, 6);
  });

  it("handles an empty ledger without dividing by zero", () => {
    const s = summarizeLedger([]);
    expect(s.totalRuns).toBe(0);
    expect(s.skipRate).toBe(0);
    expect(s.cacheHitRate).toBe(0);
    expect(s.avgLatencyMs).toBeNull();
    expect(s.unitEconomics.costPerRecommendation).toBeNull();
  });
});
