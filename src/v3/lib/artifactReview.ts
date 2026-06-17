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

import { getFormalArtifactConfidence } from "@/v3/lib/formalArtifacts";

/** Convert a producing-agent/artifact id to its persisted review key. */
export function artifactReviewFieldKey(defId: string): string {
  const camel = defId.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  return `${camel}Quality`;
}

export interface ArtifactReview {
  score: number | null;
  improvements: string[];
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
    ? pick.improvements.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (score == null && improvements.length === 0) return null;
  return { score, improvements };
}

/**
 * The 0-100 quality score for one artifact, scoped to a phase: the AI review
 * score when present, else the artifact ledger's stored agent confidence
 * (0-1 → 0-100). Returns null when the artifact has no quality signal at all.
 */
export function resolveArtifactQualityScore(
  source: Record<string, unknown> | null | undefined,
  defId: string,
  phaseId: string,
  storedConfidence?: number | null,
): number | null {
  const review = resolveArtifactReview(source, defId, phaseId);
  if (review?.score != null) return review.score;
  if (typeof storedConfidence === "number" && Number.isFinite(storedConfidence)) {
    return Math.round(storedConfidence <= 1 ? storedConfidence * 100 : storedConfidence);
  }
  // Formal documents persist the AI's generation confidence on their top-level
  // mirror, not the ledger record — fall back to it so their cards/header show a
  // score before the independent review lands.
  return getFormalArtifactConfidence(source ?? null, defId);
}
