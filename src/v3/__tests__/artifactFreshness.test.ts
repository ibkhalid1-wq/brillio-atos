import {
  assessArtifactFreshness,
  nextStatusForDrift,
  type FreshnessInputs,
} from "@/v3/lib/artifactFreshness";

const baseFresh: FreshnessInputs = {
  generatedAt: "2026-06-01T00:00:00.000Z",
  status: "approved",
  priorFingerprint: "fp-1",
  currentFingerprint: "fp-1",
};

describe("artifactFreshness", () => {
  it("reports fresh when inputs are unchanged", () => {
    const a = assessArtifactFreshness(baseFresh);
    expect(a.freshness).toBe("fresh");
    expect(a.drift).toBe(false);
    expect(a.recommendedAction).toBe("none");
  });

  it("reports unknown when never generated or no fingerprint", () => {
    expect(assessArtifactFreshness({ ...baseFresh, generatedAt: null }).freshness).toBe("unknown");
    expect(assessArtifactFreshness({ ...baseFresh, priorFingerprint: null }).freshness).toBe("unknown");
  });

  it("detects drift and NEVER auto-regenerates an approved artifact", () => {
    const a = assessArtifactFreshness({
      ...baseFresh,
      currentFingerprint: "fp-2",
      changedInputs: [
        { kind: "stakeholder", label: "New exec sponsor" },
        { kind: "risk", label: "Critical integration risk opened" },
      ],
    });
    expect(a.freshness).toBe("stale");
    expect(a.drift).toBe(true);
    expect(a.approved).toBe(true);
    expect(a.autoRegenerate).toBe(false); // hard guarantee
    expect(a.recommendedAction).toBe("recommend-regeneration");
  });

  it("maps changed inputs to affected artifact sections", () => {
    const a = assessArtifactFreshness({
      ...baseFresh,
      currentFingerprint: "fp-2",
      changedInputs: [
        { kind: "stakeholder", label: "X" },
        { kind: "decision", label: "Y" },
        { kind: "risk", label: "Z" },
      ],
    });
    expect(a.affectedSections).toEqual(["Decision Impact", "Risks", "Stakeholders"]);
    expect(a.impact).toMatch(/Affects: Decision Impact, Risks, Stakeholders/);
  });

  it("recommends review (not regeneration) for a drifted draft", () => {
    const a = assessArtifactFreshness({
      ...baseFresh,
      status: "draft",
      currentFingerprint: "fp-2",
      changedInputs: [{ kind: "milestone", label: "Slip" }],
    });
    expect(a.recommendedAction).toBe("review");
    expect(a.approved).toBe(false);
  });

  it("never flags an archived artifact", () => {
    const a = assessArtifactFreshness({
      ...baseFresh,
      status: "archived",
      currentFingerprint: "fp-2",
    });
    expect(a.freshness).toBe("unknown");
    expect(a.drift).toBe(false);
    expect(a.recommendedAction).toBe("none");
  });

  it("nextStatusForDrift marks approved->stale only on drift", () => {
    const drifted = assessArtifactFreshness({ ...baseFresh, currentFingerprint: "fp-2" });
    expect(nextStatusForDrift("approved", drifted)).toBe("stale");

    const stillFresh = assessArtifactFreshness(baseFresh);
    expect(nextStatusForDrift("approved", stillFresh)).toBe("approved");

    // Drafts are never auto-promoted/demoted.
    expect(nextStatusForDrift("draft", drifted)).toBe("draft");
  });
});
