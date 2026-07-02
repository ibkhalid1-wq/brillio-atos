import {
  artifactReviewFieldKey,
  resolveArtifactReview,
  resolveArtifactQualityScore,
  discountQualityForDeficiencies,
  QUALITY_EROSION_FLOOR,
} from "@/v3/lib/artifactReview";
import { getFormalArtifactGapCount } from "@/v3/lib/formalArtifacts";

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

  it("reads suggestedStakeholders, dropping blanks, and surfaces a review that has only them", () => {
    const source = {
      scopeMapQuality: { score: 80, improvements: [], suggestedStakeholders: ["VP Sales", "  ", "Delivery Manager"] },
    };
    const review = resolveArtifactReview(source, "scope-map", "discover")!;
    expect(review.suggestedStakeholders).toEqual(["VP Sales", "Delivery Manager"]);
    // A review with no score/improvements but a non-empty stakeholder list is
    // still usable — it drives the placeholder action.
    const onlyStakeholders = resolveArtifactReview({ scopeMapQuality: { suggestedStakeholders: ["DPO"] } }, "scope-map", "discover")!;
    expect(onlyStakeholders.suggestedStakeholders).toEqual(["DPO"]);
    // Absent field defaults to an empty array, never undefined.
    expect(resolveArtifactReview({ planQuality: { score: 70 } }, "plan", "build")!.suggestedStakeholders).toEqual([]);
  });
});

describe("resolveArtifactQualityScore", () => {
  it("prefers the AI review score over stored confidence", () => {
    const source = { charterQuality: { score: 82, improvements: [] } };
    expect(resolveArtifactQualityScore(source, "charter", "strategy", 0.5)).toBe(82);
  });

  it("falls back to stored agent confidence (0-1) when no review exists", () => {
    expect(resolveArtifactQualityScore({}, "charter", "strategy", 0.74)).toBe(74);
  });

  it("accepts an already-0-100 confidence", () => {
    expect(resolveArtifactQualityScore({}, "charter", "strategy", 80)).toBe(80);
  });

  it("falls back to a formal document's generation confidence from its mirror", () => {
    // A regenerated formal doc has no review key and no ledger confidence, but the
    // AI's generation confidence is stored on the top-level mirror. The card must
    // surface it so quality isn't blank before the independent review lands.
    const source = { outcomeFramework: { confidence: 0.98, summary: "x" } };
    expect(resolveArtifactQualityScore(source, "outcome-framework", "strategy", null)).toBe(98);
    // The mirror key differs from camelCase(defId) for charter/business-case.
    expect(resolveArtifactQualityScore({ transformationCharter: { confidence: 0.6 } }, "charter", "strategy")).toBe(60);
  });

  it("returns null when the artifact has no quality signal at all", () => {
    // A draft with no review key, no persisted confidence, and no formal mirror
    // confidence has no score to show, and must NOT inherit another phase's
    // programme-wide review score.
    expect(resolveArtifactQualityScore({}, "charter", "strategy", null)).toBeNull();
    expect(resolveArtifactQualityScore({ planQuality: { score: 57 } }, "charter", "strategy")).toBeNull();
  });

  it("erodes a high score by the reviewer's own actionable improvements", () => {
    // The exact contradiction reported: a near-perfect score alongside a material
    // "not formally documented" admission. The score must drop below the raw 98.
    const source = {
      scopeMapQuality: {
        score: 98,
        improvements: ["Scope inclusions and exclusions are not formally documented beyond high-level statements."],
      },
    };
    // 98 * (1 - 0.08) = 90.16 → 90.
    expect(resolveArtifactQualityScore(source, "scope-map", "discover")).toBe(90);
    // Two admissions erode further: 98 * (1 - 0.16) = 82.32 → 82.
    const two = {
      scopeMapQuality: { score: 98, improvements: ["Document scope exclusions.", "Baseline the current state."] },
    };
    expect(resolveArtifactQualityScore(two, "scope-map", "discover")).toBe(82);
  });

  it("erodes a formal document's confidence by its self-reported gaps", () => {
    // No review key, so the score comes from the mirror confidence; the mirror's
    // own `gaps` array is the self-reported deficiency channel for formal docs.
    const source = {
      transformationCharter: {
        confidence: 0.98,
        gaps: ["Executive sponsor not yet named", "Success criteria lack KPI baselines"],
      },
    };
    // 98 * (1 - 0.16) = 82.32 → 82.
    expect(resolveArtifactQualityScore(source, "charter", "strategy")).toBe(82);
  });

  it("does not erode a clean score with no admissions", () => {
    const source = { charterQuality: { score: 91, improvements: [] } };
    expect(resolveArtifactQualityScore(source, "charter", "strategy")).toBe(91);
  });
});

describe("discountQualityForDeficiencies", () => {
  it("leaves a score untouched when there are no deficiencies", () => {
    expect(discountQualityForDeficiencies(98, 0)).toBe(98);
    expect(discountQualityForDeficiencies(98, -1)).toBe(98);
  });

  it("erodes multiplicatively per deficiency", () => {
    expect(discountQualityForDeficiencies(100, 1)).toBe(92);
    expect(discountQualityForDeficiencies(100, 2)).toBe(84);
    expect(discountQualityForDeficiencies(100, 3)).toBe(76);
  });

  it("saturates at the erosion floor however many deficiencies pile up", () => {
    // 1 - 0.08 * 6 = 0.52 < floor, so the floor caps the erosion.
    expect(discountQualityForDeficiencies(100, 6)).toBe(Math.round(100 * QUALITY_EROSION_FLOOR));
    expect(discountQualityForDeficiencies(100, 50)).toBe(Math.round(100 * QUALITY_EROSION_FLOOR));
  });
});

describe("getFormalArtifactGapCount", () => {
  it("counts non-empty gap entries on a formal mirror, ignoring blanks", () => {
    const source = {
      transformationCharter: { confidence: 0.9, gaps: ["Missing sponsor", "   ", "", "No KPI baseline"] },
    };
    expect(getFormalArtifactGapCount(source, "charter")).toBe(2);
  });

  it("reads object-shaped gap entries defensively", () => {
    const source = {
      businessCaseDoc: { gaps: [{ description: "ROI unquantified" }, { note: "ignored — unknown key" }, "plain gap"] },
    };
    // The `{ description }` and the plain string count; the unknown-key object does not.
    expect(getFormalArtifactGapCount(source, "business-case")).toBe(2);
  });

  it("returns 0 for non-formal artifacts, missing mirrors, or absent gaps", () => {
    expect(getFormalArtifactGapCount({ scopeMapQuality: { gaps: ["x"] } }, "scope-map")).toBe(0);
    expect(getFormalArtifactGapCount(null, "charter")).toBe(0);
    expect(getFormalArtifactGapCount({ transformationCharter: { confidence: 0.8 } }, "charter")).toBe(0);
  });
});
