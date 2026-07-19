/**
 * Who may change a Flow artifact, and how. Three tiers of ownership:
 *
 *  - "authorable" — the Prototype Loop's OWN working documents (architecture,
 *    experience, blueprint, prototype). The delivery team authors them directly:
 *    full edit, including inventing new sections from nothing.
 *  - "curatable" — the Domain Ontology and Current-State Atlas. DERIVED from
 *    stakeholder evidence, but the operator may CURATE their structure: rename,
 *    redefine, relate, regroup, dismiss-with-reason. NOT authorable — inventing a
 *    current-state fact with no evidence would break the artifact's grounding, so
 *    the studios hide the "add a brand-new entity/workflow/system" affordances.
 *    A curation edit lands through the same attested save path and is preserved
 *    across regeneration by the hand-corrections guard.
 *  - "derived" — everything else (discovery kit, demo scripts, ship/hardening).
 *    Read-only; a change must arrive as EVIDENCE and land through resynthesis.
 *
 * Single source of truth for the split, so FlowArtifactStudio and its tests
 * never disagree.
 */
export const DESIGN_TEAM_ARTIFACTS = ["architecture-strategy", "experience-design", "agentic-blueprint", "prototype-build"];
export const CURATABLE_ARTIFACTS = ["domain-ontology", "current-state-atlas"];

export type ArtifactEditTier = "authorable" | "curatable" | "derived";

export function artifactEditTier(artifactId: string): ArtifactEditTier {
  if (DESIGN_TEAM_ARTIFACTS.includes(artifactId)) return "authorable";
  if (CURATABLE_ARTIFACTS.includes(artifactId)) return "curatable";
  return "derived";
}

/** May the operator edit this artifact directly (author OR curate)? */
export function isArtifactEditable(artifactId: string): boolean {
  return artifactEditTier(artifactId) !== "derived";
}

/** May the operator INVENT new top-level items (add-new)? Authorable only. */
export function isArtifactAuthorable(artifactId: string): boolean {
  return artifactEditTier(artifactId) === "authorable";
}
