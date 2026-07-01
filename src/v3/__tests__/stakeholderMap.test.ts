import { describe, it, expect } from "vitest";
import type { StakeholderProfile } from "@/new/types";
import {
  quadrantStrategy,
  engagementDelta,
  needsMovement,
  isBlindSpot,
  isUnownedHighInfluence,
} from "@/v3/lib/stakeholderMap";

function sh(overrides: Partial<StakeholderProfile> = {}): StakeholderProfile {
  return {
    id: "s1",
    name: "Test Person",
    role: "Sponsor",
    organisation: null,
    influence: "medium",
    interest: "high",
    currentEngagement: "supportive",
    targetEngagement: "champion",
    sentiment: "positive",
    riskOfDisengagement: "low",
    recommendedActions: [],
    owner: null,
    ...overrides,
  };
}

describe("quadrantStrategy", () => {
  it("preserves the classic four corners", () => {
    expect(quadrantStrategy("high", "high")).toBe("Manage closely");
    expect(quadrantStrategy("high", "low")).toBe("Keep satisfied");
    expect(quadrantStrategy("low", "high")).toBe("Keep informed");
    expect(quadrantStrategy("low", "low")).toBe("Monitor");
  });

  it("gives medium cells sensible labels instead of defaulting to Monitor", () => {
    // The old corner-only ternary mislabelled all of these as "Monitor".
    expect(quadrantStrategy("high", "medium")).toBe("Manage closely");
    expect(quadrantStrategy("medium", "high")).toBe("Keep informed");
    expect(quadrantStrategy("medium", "medium")).toBe("Keep informed");
    expect(quadrantStrategy("medium", "low")).toBe("Monitor");
    expect(quadrantStrategy("low", "medium")).toBe("Monitor");
  });
});

describe("engagementDelta", () => {
  it("flags an unknown current posture as needing assessment", () => {
    expect(engagementDelta(sh({ currentEngagement: "unknown" }))).toEqual({ kind: "unknown" });
  });

  it("reports on-target when current meets or exceeds target", () => {
    expect(engagementDelta(sh({ currentEngagement: "champion", targetEngagement: "champion" })).kind).toBe("on-target");
    expect(engagementDelta(sh({ currentEngagement: "champion", targetEngagement: "supportive" })).kind).toBe("on-target");
  });

  it("computes the number of bands to move up", () => {
    expect(engagementDelta(sh({ currentEngagement: "supportive", targetEngagement: "champion" }))).toEqual({
      kind: "move",
      from: "supportive",
      to: "champion",
      steps: 1,
    });
    expect(engagementDelta(sh({ currentEngagement: "resistant", targetEngagement: "champion" })).kind).toBe("move");
    expect((engagementDelta(sh({ currentEngagement: "resistant", targetEngagement: "champion" })) as { steps: number }).steps).toBe(4);
  });
});

describe("needsMovement / isBlindSpot / isUnownedHighInfluence", () => {
  it("needsMovement excludes unknowns and on-target", () => {
    expect(needsMovement(sh({ currentEngagement: "supportive", targetEngagement: "champion" }))).toBe(true);
    expect(needsMovement(sh({ currentEngagement: "unknown" }))).toBe(false);
    expect(needsMovement(sh({ currentEngagement: "champion", targetEngagement: "champion" }))).toBe(false);
  });

  it("isBlindSpot catches unknown engagement or sentiment", () => {
    expect(isBlindSpot(sh({ currentEngagement: "unknown" }))).toBe(true);
    expect(isBlindSpot(sh({ sentiment: "unknown" }))).toBe(true);
    expect(isBlindSpot(sh())).toBe(false);
  });

  it("isUnownedHighInfluence flags high-influence stakeholders with no owner", () => {
    expect(isUnownedHighInfluence(sh({ influence: "high", owner: null }))).toBe(true);
    expect(isUnownedHighInfluence(sh({ influence: "high", owner: "Dana" }))).toBe(false);
    expect(isUnownedHighInfluence(sh({ influence: "medium", owner: null }))).toBe(false);
  });
});
