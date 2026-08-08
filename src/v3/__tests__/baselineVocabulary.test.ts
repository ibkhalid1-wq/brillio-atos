/**
 * The baseline vocabulary must be a PRECISE floor — it resolves generic enterprise
 * concepts but must NOT over-bind per-engagement domain composites that merely share
 * a word (the failure mode the census flagged in the loose token match).
 */
import { describe, it, expect } from "vitest";
import { resolveToBaseline, isBaselineConcept, BASELINE_VOCABULARY } from "@/v3/lib/baselineVocabulary";

describe("baseline vocabulary", () => {
  it("resolves the generic concepts (whole name + alias + plural)", () => {
    expect(resolveToBaseline("Document")).toBe("Document");
    expect(resolveToBaseline("documents")).toBe("Document");
    expect(resolveToBaseline("attachment")).toBe("Document");
    expect(resolveToBaseline("User")).toBe("User");
    expect(resolveToBaseline("reporting")).toBe("Report");
    expect(resolveToBaseline("persona")).toBe("Role");
    expect(resolveToBaseline("company")).toBe("Organization");
    expect(resolveToBaseline("Tasks")).toBe("Task");
  });

  it("does NOT over-bind domain composites that only share a token", () => {
    // these are the census's false positives under loose token matching — must stay null
    for (const domain of [
      "Account Competitor View", "Account Plan", "Account Stakeholder Map",
      "Police Report", "Deal Team", "Project Team Member", "Reference Catalog Entry",
      "FNOL", "Physician", "Candidate", "RetentionOffer", "RiskScore", "OnboardingRequest",
    ]) {
      expect(resolveToBaseline(domain), `${domain} must not bind to a generic concept`).toBeNull();
      expect(isBaselineConcept(domain)).toBe(false);
    }
  });

  it("has definitions and no vertical-specific terms", () => {
    expect(BASELINE_VOCABULARY.length).toBeGreaterThanOrEqual(10);
    for (const c of BASELINE_VOCABULARY) {
      expect(c.definition.length).toBeGreaterThan(20);
    }
    const names = BASELINE_VOCABULARY.map((c) => c.name.toLowerCase());
    for (const vertical of ["fnol", "physician", "candidate", "reserve", "claim", "patient"]) {
      expect(names).not.toContain(vertical);
    }
  });
});
