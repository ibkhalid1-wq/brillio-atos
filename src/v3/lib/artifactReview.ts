/**
 * Single source of truth for reading an artifact's AI quality review.
 *
 * run-agent produces an independent quality review (score 0-100 + improvement
 * plan) at generation time and persists it at a top-level program key derived
 * from the producing-agent id: `${camelCase(agentId)}Quality` (e.g. narrative →
 * narrativeQuality, change-impact → changeImpactQuality, charter →
 * charterQuality). Both the Stage view artifact cards and the phase header
 * "Artifact quality" tile resolve quality through here, so a given artifact can
 * never read one score on the card and a different one in the header.
 */

import { getFormalArtifactConfidence, getFormalArtifactGapCount } from "@/v3/lib/formalArtifacts";
import { filterActionableImprovements } from "@/v3/lib/qualityImprovementFilter";

/** Convert a producing-agent/artifact id to its persisted review key. */
export function artifactReviewFieldKey(defId: string): string {
  const camel = defId.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  return `${camel}Quality`;
}

export interface ArtifactReview {
  score: number | null;
  improvements: string[];
  /**
   * Concrete stakeholder roles the reviewer judged missing from the programme's
   * stakeholder list (populated only for stakeholder/scope artifacts). Drives the
   * "create placeholder rows" action — the stakeholder analogue of RACI gaps.
   */
  suggestedStakeholders: string[];
}

/**
 * Resolve the AI review record for one artifact. The review is stored at a
 * top-level (program-wide) key but may carry a per-phase bucket; prefer the
 * phase-specific entry. Returns null when no usable score or improvement exists.
 */
export function resolveArtifactReview(
  source: Record<string, unknown> | null | undefined,
  defId: string,
  phaseId: string,
): ArtifactReview | null {
  if (!source) return null;
  const candidate = source[artifactReviewFieldKey(defId)];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const phaseBucket = record[phaseId];
  const pick = (phaseBucket && typeof phaseBucket === "object" && !Array.isArray(phaseBucket)
    ? phaseBucket
    : record) as Record<string, unknown>;
  const score = typeof pick.score === "number" ? Math.round(pick.score) : null;
  const improvements = Array.isArray(pick.improvements)
    ? filterActionableImprovements(
        pick.improvements.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
      )
    : [];
  const suggestedStakeholders = Array.isArray(pick.suggestedStakeholders)
    ? pick.suggestedStakeholders.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (score == null && improvements.length === 0 && suggestedStakeholders.length === 0) return null;
  return { score, improvements, suggestedStakeholders };
}

/**
 * Per-deficiency quality erosion and the floor it cannot fall below.
 *
 * A raw quality score reflects only how good a draft *is*; it ignores what the
 * artifact itself admits is *missing*. The AI review score and the artifact's
 * self-reported deficiencies (the reviewer's actionable improvement plan, and a
 * formal document's `gaps` list) are produced independently and never reconciled,
 * so a card can read "98%" beside an admission that "scope inclusions and
 * exclusions are not formally documented". Each self-reported deficiency erodes
 * the score multiplicatively so a near-perfect score cannot coexist with admitted
 * gaps. Calibrated so one material deficiency drops ~98 → ~90, two → ~82, and the
 * erosion saturates at 40% however many pile up — an artifact that scored well is
 * never zeroed out by its own honesty.
 */
export const QUALITY_PENALTY_PER_DEFICIENCY = 0.08;
export const QUALITY_EROSION_FLOOR = 0.6;

/**
 * Erode a 0-100 quality score by a self-reported deficiency count. Pure. Returns
 * the score unchanged when there are no deficiencies.
 */
export function discountQualityForDeficiencies(score: number, deficiencies: number): number {
  if (deficiencies <= 0) return score;
  const factor = Math.max(QUALITY_EROSION_FLOOR, 1 - QUALITY_PENALTY_PER_DEFICIENCY * deficiencies);
  return Math.round(score * factor);
}

/**
 * The 0-100 quality score for one artifact, scoped to a phase: the AI review
 * score when present, else the artifact ledger's stored agent confidence
 * (0-1 → 0-100), else a formal document's generation confidence. The resolved
 * score is then eroded by the artifact's own self-reported deficiencies (the
 * reviewer's actionable improvements plus any formal-document gaps) so a high
 * score cannot contradict admitted gaps. Returns null when the artifact has no
 * quality signal at all.
 */
export function resolveArtifactQualityScore(
  source: Record<string, unknown> | null | undefined,
  defId: string,
  phaseId: string,
  storedConfidence?: number | null,
): number | null {
  const review = resolveArtifactReview(source, defId, phaseId);
  let raw: number | null = null;
  if (review?.score != null) {
    raw = review.score;
  } else if (typeof storedConfidence === "number" && Number.isFinite(storedConfidence)) {
    raw = Math.round(storedConfidence <= 1 ? storedConfidence * 100 : storedConfidence);
  } else {
    // Formal documents persist the AI's generation confidence on their top-level
    // mirror, not the ledger record — fall back to it so their cards/header show a
    // score before the independent review lands.
    raw = getFormalArtifactConfidence(source ?? null, defId);
  }
  if (raw == null) return null;

  const deficiencies =
    (review?.improvements.length ?? 0) + getFormalArtifactGapCount(source ?? null, defId);
  return discountQualityForDeficiencies(raw, deficiencies);
}
