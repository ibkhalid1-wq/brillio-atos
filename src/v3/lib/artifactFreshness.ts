/**
 * Artifact freshness & staleness detection — artifacts as living assets.
 *
 * The mandate is explicit: do NOT auto-regenerate approved artifacts. Instead
 * detect drift (an artifact's inputs changed after it was generated), explain
 * the impact, recommend regeneration, and preserve user control. Regeneration
 * should be section-level where possible, not a wholesale rewrite.
 *
 * This pure module is the detection + recommendation brain:
 *   • assessArtifactFreshness() — compares the input fingerprint captured at
 *     generation time against the current one (see Increment-4 fingerprint),
 *     classifies fresh / stale / unknown, maps changed inputs to the artifact
 *     sections they affect, and produces a user-controlled recommendation that
 *     NEVER auto-regenerates an approved artifact.
 *   • nextStatusForDrift() — the status an artifact should move to when drift is
 *     detected (approved → stale; drafts stay where they are), per the
 *     Draft/Review/Approved/Stale/Archived lifecycle.
 *
 * No AI, no backend, deterministic and unit-testable.
 */

export type ArtifactFreshness = "fresh" | "stale" | "unknown";

export type ArtifactStatus = "draft" | "review" | "approved" | "stale" | "archived";

export interface ArtifactInputChange {
  /** Input category that changed (stakeholder/risk/decision/milestone/...). */
  kind: string;
  /** Human-readable label of the specific changed input. */
  label: string;
}

export interface FreshnessInputs {
  /** When the artifact was last generated (ISO string) — null if never. */
  generatedAt: string | null;
  /** Current lifecycle status of the artifact. */
  status?: ArtifactStatus;
  /** Input fingerprint captured when the artifact was generated (null if none). */
  priorFingerprint: string | null;
  /** Fingerprint of the artifact's current inputs/evidence. */
  currentFingerprint: string;
  /** The specific inputs that changed, for impact + section mapping. */
  changedInputs?: ArtifactInputChange[];
}

export type RecommendedAction = "none" | "review" | "recommend-regeneration";

export interface FreshnessAssessment {
  freshness: ArtifactFreshness;
  /** True when inputs changed since generation. */
  drift: boolean;
  approved: boolean;
  /**
   * Always false. Approved artifacts are never auto-regenerated; this field
   * documents the guarantee for callers and makes the contract testable.
   */
  autoRegenerate: false;
  recommendedAction: RecommendedAction;
  /** Plain-English explanation of what changed and why it matters. */
  impact: string | null;
  /** Artifact sections affected, for section-level regeneration. */
  affectedSections: string[];
}

/** Map a changed-input kind to the artifact section it affects. */
const SECTION_FOR_INPUT: Record<string, string> = {
  stakeholder: "Stakeholders",
  risk: "Risks",
  issue: "Risks & Issues",
  decision: "Decision Impact",
  milestone: "Timeline",
  dependency: "Dependencies",
  evidence: "Evidence",
  input: "Scope & Inputs",
  scope: "Scope & Inputs",
  budget: "Budget",
  benefit: "Benefits",
  gate: "Governance",
};

function sectionsFor(changes: ArtifactInputChange[]): string[] {
  const sections = new Set<string>();
  for (const change of changes) {
    sections.add(SECTION_FOR_INPUT[change.kind.toLowerCase()] ?? "General");
  }
  return [...sections].sort();
}

function describeImpact(changes: ArtifactInputChange[], sections: string[]): string {
  if (!changes.length) {
    return "Source inputs changed since this artifact was generated.";
  }
  const labels = changes.slice(0, 3).map((c) => c.label);
  const more = changes.length > 3 ? ` and ${changes.length - 3} more` : "";
  const sectionText = sections.length ? ` Affects: ${sections.join(", ")}.` : "";
  return `Changed since generation: ${labels.join(", ")}${more}.${sectionText}`;
}

/**
 * Assess whether an artifact is still fresh given its inputs. Quality-first and
 * user-controlled: drift on an approved artifact recommends — never performs —
 * regeneration; drift on a draft suggests a review.
 */
export function assessArtifactFreshness(inputs: FreshnessInputs): FreshnessAssessment {
  const status = inputs.status ?? "draft";
  const approved = status === "approved";
  const changedInputs = inputs.changedInputs ?? [];

  // Archived artifacts are intentionally frozen — never flag them.
  if (status === "archived") {
    return {
      freshness: "unknown",
      drift: false,
      approved: false,
      autoRegenerate: false,
      recommendedAction: "none",
      impact: null,
      affectedSections: [],
    };
  }

  // No generation record or no captured fingerprint → cannot judge drift.
  if (!inputs.generatedAt || inputs.priorFingerprint == null) {
    return {
      freshness: "unknown",
      drift: false,
      approved,
      autoRegenerate: false,
      recommendedAction: "none",
      impact: null,
      affectedSections: [],
    };
  }

  // Inputs unchanged → fresh.
  if (inputs.currentFingerprint === inputs.priorFingerprint) {
    return {
      freshness: "fresh",
      drift: false,
      approved,
      autoRegenerate: false,
      recommendedAction: "none",
      impact: null,
      affectedSections: [],
    };
  }

  // Drift detected.
  const affectedSections = sectionsFor(changedInputs);
  return {
    freshness: "stale",
    drift: true,
    approved,
    autoRegenerate: false,
    recommendedAction: approved ? "recommend-regeneration" : "review",
    impact: describeImpact(changedInputs, affectedSections),
    affectedSections,
  };
}

/**
 * The status an artifact should move to given a freshness assessment. Approved
 * artifacts that have drifted become "stale" (a visible flag), while preserving
 * the fact they were approved is the caller's concern. Non-approved statuses are
 * left untouched — drafts stay drafts. Never silently re-approves or archives.
 */
export function nextStatusForDrift(current: ArtifactStatus, assessment: FreshnessAssessment): ArtifactStatus {
  if (assessment.drift && current === "approved") return "stale";
  return current;
}
