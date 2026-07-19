import { describe, it, expect } from "vitest";
import {
  artifactEditTier, isArtifactEditable, isArtifactAuthorable,
  DESIGN_TEAM_ARTIFACTS, CURATABLE_ARTIFACTS,
} from "@/v3/lib/artifactEditPolicy";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";

describe("artifact edit policy — three tiers of ownership", () => {
  it("design-team artifacts are authorable (add-new allowed)", () => {
    for (const id of DESIGN_TEAM_ARTIFACTS) {
      expect(artifactEditTier(id)).toBe("authorable");
      expect(isArtifactEditable(id)).toBe(true);
      expect(isArtifactAuthorable(id)).toBe(true);
    }
  });

  it("ontology + atlas are curatable: editable but NOT authorable", () => {
    expect(CURATABLE_ARTIFACTS).toEqual(["domain-ontology", "current-state-atlas"]);
    for (const id of CURATABLE_ARTIFACTS) {
      expect(artifactEditTier(id)).toBe("curatable");
      expect(isArtifactEditable(id)).toBe(true);  // rename/relate/dismiss
      expect(isArtifactAuthorable(id)).toBe(false); // no add-new invention
    }
  });

  it("derived artifacts (discovery kit, demo scripts, ship) are read-only", () => {
    for (const id of ["discovery-kit", "demo-scripts", "hardening-plan", "charter"]) {
      expect(artifactEditTier(id)).toBe("derived");
      expect(isArtifactEditable(id)).toBe(false);
      expect(isArtifactAuthorable(id)).toBe(false);
    }
  });

  it("an unknown artifact id falls back to derived (safe default)", () => {
    expect(artifactEditTier("not-a-real-artifact")).toBe("derived");
    expect(isArtifactEditable("not-a-real-artifact")).toBe(false);
  });

  it("every editable artifact is a FORMAL_ARTIFACT_FIELD_KEYS entry — so its "
    + "hand-edits survive regeneration via the hand-corrections guard", () => {
    for (const id of [...DESIGN_TEAM_ARTIFACTS, ...CURATABLE_ARTIFACTS]) {
      expect(id in FORMAL_ARTIFACT_FIELD_KEYS).toBe(true);
    }
  });
});
