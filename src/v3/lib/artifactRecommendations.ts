/**
 * Categorized artifact recommendations.
 *
 * The "Improve quality" panel historically showed only *local* signals — the AI
 * score, missing grounding inputs, and the reviewer's free-text improvements. It
 * was blind to the **semantic layer**: the cross-artifact validator (Layer 2)
 * detects that a deliverable breaks the objective delivery chain (a requirement
 * with no design, a benefit with no KPI, a risk with no control), but those
 * findings only surfaced in Objective Confidence — never beside the artifact that
 * caused them. So a card could read "regenerate to lift depth" while the real
 * problem was an un-traced requirement the reviewer never mentioned.
 *
 * This module folds an artifact's semantic findings (and its own self-reported
 * gaps) into its recommendation set, and groups every recommendation by the same
 * top-level class the rest of the platform uses — Ontology, Change, Governance,
 * Completeness — so the panel reads as "here's what's wrong, by discipline"
 * rather than one flat list. Pure and framework-free so it unit-tests without a
 * render.
 */
import {
  classifyFinding,
  FINDING_CLASS_DESCRIPTION,
  FINDING_CLASS_ORDER,
  type FindingClass,
  type ValidationFinding,
  type ValidationSeverity,
} from "@/v3/lib/crossArtifactValidation";
import { FORMAL_ARTIFACT_FIELD_KEYS, listFormalArtifactGaps } from "@/v3/lib/formalArtifacts";

/** Recommendations are grouped under the same top-level classes as findings. */
export type RecommendationCategory = FindingClass;

export type RecommendationSeverity = "high" | "medium" | "low";

export interface ArtifactRecommendation {
  title: string;
  detail: string;
  severity: RecommendationSeverity;
  /** Top-level discipline this recommendation belongs to. */
  category: RecommendationCategory;
}

export interface RecommendationGroup<T extends ArtifactRecommendation = ArtifactRecommendation> {
  category: RecommendationCategory;
  /** One-line description of what this discipline covers. */
  description: string;
  items: T[];
}

const SEVERITY_RANK: Record<RecommendationSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Collapse the four validation severities onto the panel's three-level scale. */
const FINDING_SEVERITY: Record<ValidationSeverity, RecommendationSeverity> = {
  critical: "high",
  high: "high",
  medium: "medium",
  low: "low",
};

/**
 * The field keys that identify one artifact inside a finding's source/target/item
 * slots. Formal documents live under a dedicated top-level mirror key (e.g.
 * charter → transformationCharter), so match both that and the raw def id — a
 * finding may cite either the producing-agent id or the stored field.
 */
export function artifactFieldKeysFor(defId: string): string[] {
  const mirror = FORMAL_ARTIFACT_FIELD_KEYS[defId];
  return mirror ? [mirror, defId] : [defId];
}

/**
 * The findings that pertain to one artifact: those citing its field key in the
 * source, target, or item slot. Optionally scoped to a phase — a finding with no
 * phase is program-wide and always kept; one with a different phase is dropped.
 * Pure filter over an already-resolved finding list (deterministic + model).
 */
export function selectFindingsForArtifact(
  findings: ValidationFinding[],
  defId: string,
  phaseId?: string,
): ValidationFinding[] {
  const keys = new Set(artifactFieldKeysFor(defId));
  return findings.filter((f) => {
    const cites = keys.has(f.sourceArtifact) || keys.has(f.targetArtifact) || keys.has(f.sourceItem);
    if (!cites) return false;
    return !phaseId || !f.phaseId || f.phaseId === phaseId;
  });
}

/**
 * Turn artifact-scoped findings into categorized recommendations. The finding's
 * `issue` is the headline; its `recommendation` is the fix (falling back to the
 * first evidence line when a rule left the recommendation blank, e.g. a
 * self-reported gap whose text is itself the corrective). Its `domain` rolls up
 * to the top-level category via the shared classifier.
 */
export function findingsToRecommendations(findings: ValidationFinding[]): ArtifactRecommendation[] {
  return findings
    .filter((f) => f.issue.trim().length > 0)
    .map((f) => ({
      title: f.issue.trim(),
      detail: (f.recommendation.trim() || f.evidence[0]?.trim() || ""),
      severity: FINDING_SEVERITY[f.severity] ?? "medium",
      category: classifyFinding(f.domain),
    }));
}

/**
 * A reviewer's free-text improvement plan as recommendations. These carry no
 * domain metadata (the AI review emits prose, not typed findings), so they land
 * under Completeness — "make this draft better" — the same class StageView tags
 * them. The genuinely categorized guidance (Ontology / Change / Governance)
 * comes from the semantic findings folded in beside them.
 */
export function reviewImprovementsToRecommendations(improvements: string[]): ArtifactRecommendation[] {
  return improvements
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .map((s) => ({
      title: s.trim(),
      detail: "",
      severity: "low" as const,
      category: "Completeness" as const,
    }));
}

/**
 * A formal artifact's self-reported gaps as Completeness recommendations. These
 * are the generating agent's own "could not complete" admissions, read straight
 * from the mirror's `gaps` array (the same source the quality reader erodes by),
 * so the panel names the exact shortfalls that dragged the score down. Returns []
 * for attached or non-formal artifacts (no mirror / mirror cleared on attach).
 */
export function selfReportedGapRecommendations(
  source: Record<string, unknown> | null,
  defId: string,
): ArtifactRecommendation[] {
  return listFormalArtifactGaps(source, defId).map((gap) => ({
    title: "Self-reported gap",
    detail: gap.text,
    severity: "low" as const,
    category: "Completeness" as const,
  }));
}

/**
 * Group recommendations by category in the canonical class order, sorting each
 * group's items by severity (high → low). Empty categories are dropped, so the
 * panel only renders disciplines that actually have something to say.
 */
export function groupRecommendationsByCategory<T extends ArtifactRecommendation>(
  recommendations: T[],
): RecommendationGroup<T>[] {
  return FINDING_CLASS_ORDER.map((category) => ({
    category,
    description: FINDING_CLASS_DESCRIPTION[category],
    items: recommendations
      .filter((r) => r.category === category)
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
  })).filter((group) => group.items.length > 0);
}

/**
 * The grounding fields a free-form recommendation is talking about, found by
 * matching each field's label OR its id as a whole phrase inside the issue text.
 * A model suggestion carries no explicit fieldId, but it names the field in prose
 * — and reviewers name it either by its human label ("add per-line estimates to
 * the Cost assumption input") OR, just as often, by its raw id, bare or phase-
 * qualified ("specify the costAssumption", "in the strategy.costAssumption
 * input"). Matching the id too is what lets those lines surface a jump-to-field
 * chip instead of leaving the user to hunt the field index. Whole-word matching
 * (each needle regex-escaped) keeps a short label like "Industry" from firing on
 * a substring, and the phase-qualified form works because "." is a word boundary
 * so `\bcostAssumption\b` still hits inside "strategy.costAssumption". Fields are
 * returned in their original order so chips read stably.
 */
export function matchGroundingFields<T extends { id: string; label: string }>(text: string, fields: T[]): T[] {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack.trim()) return [];
  const namesField = (needle: string): boolean => {
    const n = needle.trim().toLowerCase();
    if (!n) return false;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(haystack);
  };
  return fields.filter((field) => namesField(field.label) || namesField(field.id));
}
