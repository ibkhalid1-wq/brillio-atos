import { artifactReviewFieldKey, resolveArtifactReview } from "@/v3/surfaces/StageView";

describe("artifactReviewFieldKey", () => {
  it("camelCases the producing-agent id and suffixes Quality", () => {
    // These must match run-agent's persisted keys exactly — the edge writes the
    // review under the same `${camelCase(agentId)}Quality` key the client reads.
    expect(artifactReviewFieldKey("narrative")).toBe("narrativeQuality");
    expect(artifactReviewFieldKey("gate-review")).toBe("gateReviewQuality");
    expect(artifactReviewFieldKey("change-impact")).toBe("changeImpactQuality");
    expect(artifactReviewFieldKey("critical-path")).toBe("criticalPathQuality");
    // Formal-document artifacts resolve through the same rule — no hardcoded map.
    expect(artifactReviewFieldKey("charter")).toBe("charterQuality");
    expect(artifactReviewFieldKey("business-case")).toBe("businessCaseQuality");
    expect(artifactReviewFieldKey("outcome-framework")).toBe("outcomeFrameworkQuality");
    expect(artifactReviewFieldKey("strategic-roadmap")).toBe("strategicRoadmapQuality");
  });
});

describe("resolveArtifactReview", () => {
  it("returns null when there is no source or no matching review key", () => {
    expect(resolveArtifactReview(null, "charter", "strategy")).toBeNull();
    expect(resolveArtifactReview({}, "charter", "strategy")).toBeNull();
  });

  it("surfaces a formal artifact's AI score + improvement plan for a draft", () => {
    // A draft has no stored agentConfidence, so the card score would be null —
    // the reviewer score here is what lets the chip and modal show quality.
    const source = {
      charterQuality: {
        score: 72,
        improvements: ["Name the executive sponsor explicitly", "Anchor success criteria to the KPI baselines"],
      },
    };
    const review = resolveArtifactReview(source, "charter", "strategy")!;
    expect(review.score).toBe(72);
    expect(review.improvements).toHaveLength(2);
  });

  it("prefers a per-phase bucket over the top-level record when present", () => {
    const source = {
      deckQuality: {
        score: 50,
        improvements: ["generic"],
        strategy: { score: 88, improvements: ["phase-specific suggestion"] },
      },
    };
    const review = resolveArtifactReview(source, "deck", "strategy")!;
    expect(review.score).toBe(88);
    expect(review.improvements).toEqual(["phase-specific suggestion"]);
  });

  it("rounds the score and drops blank improvement strings", () => {
    const source = { planQuality: { score: 64.6, improvements: ["real", "  ", ""] } };
    const review = resolveArtifactReview(source, "plan", "build")!;
    expect(review.score).toBe(65);
    expect(review.improvements).toEqual(["real"]);
  });
});
