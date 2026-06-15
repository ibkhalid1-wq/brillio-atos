import {
  TIER_PROFILES,
  AGENT_TIER,
  resolveAgentModelTier,
  resolveAgentModel,
} from "@/v3/lib/modelRouting";

describe("modelRouting", () => {
  it("defines three tiers with ascending relative cost", () => {
    expect(TIER_PROFILES.tier1.relativeCost).toBeLessThan(TIER_PROFILES.tier2.relativeCost);
    expect(TIER_PROFILES.tier2.relativeCost).toBeLessThan(TIER_PROFILES.tier3.relativeCost);
    // Tier 2 is the production baseline (= existing default model).
    expect(TIER_PROFILES.tier2.model).toBe("claude-sonnet-4-6");
    expect(TIER_PROFILES.tier2.relativeCost).toBe(1);
  });

  it("routes detection/scoring agents to Tier 1", () => {
    expect(resolveAgentModelTier("input-quality")).toBe("tier1");
    expect(resolveAgentModelTier("artifact-staleness-check")).toBe("tier1");
    expect(resolveAgentModelTier("budget-anomaly-detector")).toBe("tier1");
    expect(resolveAgentModelTier("workstream-health-scorer")).toBe("tier1");
  });

  it("routes analytical agents to Tier 2", () => {
    expect(resolveAgentModelTier("risk")).toBe("tier2");
    expect(resolveAgentModelTier("decision-advisor")).toBe("tier2");
    expect(resolveAgentModelTier("gate-review")).toBe("tier2");
    expect(resolveAgentModelTier("strategy")).toBe("tier2");
  });

  it("routes narrative/strategic agents to Tier 3", () => {
    expect(resolveAgentModelTier("narrative")).toBe("tier3");
    expect(resolveAgentModelTier("board-pack")).toBe("tier3");
    expect(resolveAgentModelTier("benefit-forecast")).toBe("tier3");
    expect(resolveAgentModelTier("closure")).toBe("tier3");
  });

  it("falls back to a conservative name heuristic for unknown agents", () => {
    // Unknown but clearly light.
    expect(resolveAgentModelTier("freshness-detector")).toBe("tier1");
    expect(resolveAgentModelTier("evidence-ranking")).toBe("tier1");
    // Unknown but clearly heavy.
    expect(resolveAgentModelTier("quarterly-narrative")).toBe("tier3");
    expect(resolveAgentModelTier("outcome-forecast")).toBe("tier3");
    // Unknown and ambiguous → safe analytical default, never the cheapest.
    expect(resolveAgentModelTier("some-new-agent")).toBe("tier2");
  });

  it("prefers heavy over light when both heuristics match", () => {
    expect(resolveAgentModelTier("narrative-detector")).toBe("tier3");
  });

  it("resolveAgentModel reports tier, model, cost and source", () => {
    const known = resolveAgentModel("input-quality");
    expect(known.tier).toBe("tier1");
    expect(known.model).toBe(TIER_PROFILES.tier1.model);
    expect(known.source).toBe("registry");

    const heuristic = resolveAgentModel("mystery-detector");
    expect(heuristic.tier).toBe("tier1");
    expect(heuristic.source).toBe("heuristic");

    const fallback = resolveAgentModel("totally-unknown");
    expect(fallback.tier).toBe("tier2");
    expect(fallback.source).toBe("default");
  });

  it("every registered tier references a real tier profile", () => {
    for (const tier of Object.values(AGENT_TIER)) {
      expect(TIER_PROFILES[tier]).toBeDefined();
    }
  });
});
