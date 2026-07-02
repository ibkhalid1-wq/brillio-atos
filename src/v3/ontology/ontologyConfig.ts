/**
 * Ontology configuration — the single, declarative source of every tunable in
 * the objective-confidence model.
 *
 * The roll-up used to hard-code its weights, quality bar, penalties, and band
 * cutoffs inline. Per the methodology-driven principle (config belongs in a
 * registry, not scattered through logic) they live here, so tuning the model is
 * a data edit with one test guarding its invariants — never a logic change.
 *
 * Bands are deliberately delegated to `confidenceScore.confidenceLabel` so
 * objective-attainment confidence and process-health confidence label a score
 * identically (Explainability > Trust: one score can't read "Strong" on one
 * surface and "On Track" on another).
 */
import { confidenceLabel } from "@/v3/lib/confidenceScore";
import type { ValidationSeverity } from "@/v3/lib/crossArtifactValidation";

export type ComponentKey = "measurable" | "delivered" | "evidenced" | "unthreatened" | "progressing";

export const COMPONENT_KEYS: ComponentKey[] = ["measurable", "delivered", "evidenced", "unthreatened", "progressing"];

export const COMPONENT_LABEL: Record<ComponentKey, string> = {
  measurable: "Measurable",
  delivered: "Delivered",
  evidenced: "Evidenced",
  unthreatened: "Unthreatened",
  progressing: "Progressing",
};

export interface OntologyConfig {
  /** Contribution of each component to the 0–100 objective score. Must sum to 1. */
  weights: Record<ComponentKey, number>;
  /** Artifact confidence at/above which a delivery is treated as quality. */
  qualityBar: number;
  /** Base erosion applied per severe gap, before severity/confidence weighting. */
  gapPenaltyUnit: number;
  /** Cap on total gap penalty for a single component (0–1). */
  maxGapPenalty: number;
  /** Erosion of "unthreatened" per attributed severe risk. */
  riskPenaltyUnit: number;
  /** Relative weight of a gap/finding by its severity, for weighted aggregation. */
  severityWeight: Record<ValidationSeverity, number>;
  /** Component sub-score thresholds for the good/warn/poor status pill. */
  status: { good: number; warn: number };
}

export const DEFAULT_ONTOLOGY_CONFIG: OntologyConfig = {
  weights: { measurable: 0.25, delivered: 0.3, evidenced: 0.2, unthreatened: 0.15, progressing: 0.1 },
  qualityBar: 0.6,
  gapPenaltyUnit: 0.2,
  maxGapPenalty: 0.5,
  riskPenaltyUnit: 0.25,
  severityWeight: { critical: 1, high: 0.7, medium: 0.4, low: 0.15 },
  status: { good: 0.75, warn: 0.45 },
};

/** Confidence band, shared verbatim with the process-health confidence model. */
export type ConfidenceBand = ReturnType<typeof confidenceLabel>;

export function bandForScore(score: number): ConfidenceBand {
  return confidenceLabel(score);
}

export function statusForScore(score: number, config: OntologyConfig = DEFAULT_ONTOLOGY_CONFIG): "good" | "warn" | "poor" {
  if (score >= config.status.good) return "good";
  if (score >= config.status.warn) return "warn";
  return "poor";
}

/** Numeric rank for a severity, for sorting worst-first. */
export function severityRank(severity: ValidationSeverity): number {
  return severity === "critical" ? 3 : severity === "high" ? 2 : severity === "medium" ? 1 : 0;
}

/** Display colour for a severity — the single source surfaces share for dots/chips. */
const SEVERITY_COLOR: Record<ValidationSeverity, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#94a3b8",
};
export function severityColor(severity: ValidationSeverity): string {
  return SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.low;
}

/** Map an expected point-gain back to a severity, for recommendation triage. */
export function severityForGain(gain: number): ValidationSeverity {
  if (gain >= 18) return "critical";
  if (gain >= 10) return "high";
  if (gain >= 5) return "medium";
  return "low";
}

/** True when the config's weights form a valid distribution (sum ≈ 1). */
export function isValidConfig(config: OntologyConfig): boolean {
  const sum = COMPONENT_KEYS.reduce((s, k) => s + config.weights[k], 0);
  return Math.abs(sum - 1) < 1e-9;
}
