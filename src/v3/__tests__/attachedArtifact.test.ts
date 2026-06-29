import { describe, it, expect } from "vitest";
import { deriveAttachedArtifactReview, buildAttachedArtifactPatch } from "@/v3/lib/attachedArtifact";
import { resolveArtifactReview, resolveArtifactQualityScore } from "@/v3/lib/artifactReview";
import type { DocumentIntelligence } from "@/new/lib/documentIntelligenceTypes";

function intel(over: Partial<DocumentIntelligence> = {}): DocumentIntelligence {
  return {
    documentType: "other",
    summary: "An attached test plan.",
    primaryPhase: "build",
    relevantPhases: ["build"],
    overallConfidence: 0.82,
    entities: {
      objectives: [], outcomes: [], successMetrics: [], constraints: [], assumptions: [],
      risks: [], stakeholders: [], milestones: [], budget: [], requirements: [],
      decisions: [], actions: [], technologies: [], integrations: [], gaps: [], recommendations: [],
    },
    methodologyMappings: {},
    gaps: "",
    ...over,
  };
}

describe("deriveAttachedArtifactReview", () => {
  it("maps doc-level confidence (0-1) to a 0-100 score", () => {
    expect(deriveAttachedArtifactReview(intel({ overallConfidence: 0.82 })).score).toBe(82);
    expect(deriveAttachedArtifactReview(intel({ overallConfidence: 0 })).score).toBe(0);
    expect(deriveAttachedArtifactReview(intel({ overallConfidence: 1 })).score).toBe(100);
  });

  it("folds gaps (with impact) and recommendations into the improvement list", () => {
    const review = deriveAttachedArtifactReview(intel({
      entities: {
        ...intel().entities,
        gaps: [{ description: "No rollback plan", impact: "Risky go-live", text: "", source: "", confidence: 0.9, extractionType: "extracted" }],
        recommendations: [{ text: "Add a UAT sign-off section", priority: "high", source: "", confidence: 0.8, extractionType: "inferred" }],
      },
    }));
    expect(review.improvements).toContain("No rollback plan — Risky go-live");
    expect(review.improvements).toContain("Add a UAT sign-off section");
  });

  it("derives no stakeholder placeholders — attached docs are read-only in-app", () => {
    const review = deriveAttachedArtifactReview(intel({
      entities: {
        ...intel().entities,
        stakeholders: [{ name: "A", role: "Sponsor", organization: "X", text: "", source: "", confidence: 0.9, extractionType: "extracted" }],
      },
    }));
    expect(review.suggestedStakeholders).toEqual([]);
  });
});

describe("buildAttachedArtifactPatch", () => {
  const review = { score: 82, improvements: ["Add a rollback plan"], suggestedStakeholders: [] };

  it("writes an uploaded-origin ledger entry that returns origin 'uploaded'", () => {
    const next = buildAttachedArtifactPatch({}, {
      phaseId: "build", defId: "test-plan", label: "Test Plan", agentId: "test-plan",
      fileName: "plan.pdf", review, summary: "Summary", content: "Body", now: "2026-06-30T00:00:00Z",
    });
    const entry = (next.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>).build["test-plan"];
    expect(entry.agentDrafted).toBe(false);
    expect(entry.lastEditedBy).toBe("human");
    expect(entry.status).toBe("ready");
    expect(entry.confidence).toBe(82);
    expect(entry.attachedFileName).toBe("plan.pdf");
  });

  it("clears the formal generated mirror so a stale body can't resurface", () => {
    const next = buildAttachedArtifactPatch(
      { testPlan: { body: "generated", confidence: 0.5 } },
      { phaseId: "build", defId: "test-plan", label: "Test Plan", agentId: "test-plan", fileName: "f.pdf", review, summary: "s", content: "c" },
    );
    expect(next.testPlan).toBeUndefined();
  });

  it("clears a stale generated entry keyed by the producing agent id", () => {
    const next = buildAttachedArtifactPatch(
      { phaseArtifacts: { mobilise: { "raci-matrix": { status: "approved", agentDrafted: true } } } },
      { phaseId: "mobilise", defId: "raciMatrix", label: "RACI", agentId: "raci-matrix", fileName: "f.pdf", review, summary: "s", content: "c" },
    );
    const bucket = (next.phaseArtifacts as Record<string, Record<string, unknown>>).mobilise;
    expect(bucket["raci-matrix"]).toBeUndefined();
    expect(bucket.raciMatrix).toBeDefined();
  });

  it("stores a review the artifactReview reader resolves (score + improvements)", () => {
    const next = buildAttachedArtifactPatch({}, {
      phaseId: "build", defId: "test-plan", label: "Test Plan", agentId: "test-plan",
      fileName: "f.pdf", review, summary: "s", content: "c",
    });
    const resolved = resolveArtifactReview(next, "test-plan", "build");
    expect(resolved?.score).toBe(82);
    expect(resolved?.improvements).toEqual(["Add a rollback plan"]);
    expect(resolveArtifactQualityScore(next, "test-plan", "build")).toBe(82);
  });

  it("does not mutate the input inner object", () => {
    const inner = { phaseArtifacts: { build: {} } };
    const snapshot = JSON.stringify(inner);
    buildAttachedArtifactPatch(inner, {
      phaseId: "build", defId: "test-plan", label: "Test Plan", agentId: "test-plan",
      fileName: "f.pdf", review, summary: "s", content: "c",
    });
    expect(JSON.stringify(inner)).toBe(snapshot);
  });
});
