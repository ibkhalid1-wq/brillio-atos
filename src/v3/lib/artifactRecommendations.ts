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
import { SPINE_STOPWORDS } from "@/v3/lib/methodologySpine";

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

/** A grounding input the artifact is generated from, with its fill state. */
export interface GroundingFieldGap {
  id: string;
  label: string;
  filled: boolean;
  /** What the field must hold — placeholder/hint prose, or a fallback. */
  requirement?: string;
}

/**
 * Deterministic "Add X" recommendations for the artifact's EMPTY grounding
 * inputs, carrying an explicit `fieldId` so the caller renders a jump-to-field
 * chip that drills straight to the input. This is the same high-leverage signal
 * the Improve modal shows — an empty grounding input is the most actionable fix —
 * surfaced on the Guidance rail too, so the two surfaces name the same fields.
 * A filled input is dropped; the returned recs always carry a resolvable fieldId.
 */
export function groundingGapRecommendations(
  fields: GroundingFieldGap[],
): (ArtifactRecommendation & { fieldId: string })[] {
  return fields
    .filter((field) => !field.filled)
    .map((field) => ({
      title: `Add "${field.label}"`,
      detail: field.requirement?.trim() || `Provide ${field.label}.`,
      severity: "high" as const,
      category: "Completeness" as const,
      fieldId: field.id,
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

/** Split a camelCase id into its words so "costAssumption" → "cost assumption". */
function splitCamel(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Light singular stem: drop a trailing "s" on longer words so a reviewer's plural
 * or JSON-key form ("costs", "benefits", "estimates") overlaps the singular noun
 * in a field label ("Cost assumption", "Realised benefits"). Short words (kpis,
 * nfrs) are left intact — those resolve by whole-word/id match, and stemming them
 * only invites false overlaps.
 */
function stemToken(token: string): string {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

/**
 * The subject tokens of a piece of text: lowercased words with generic programme/
 * governance filler (SPINE_STOPWORDS, shared with the methodology-spine analysis)
 * stripped and each remaining word lightly singular-stemmed. This is what lets a
 * field match on *meaning* — its distinctive noun — rather than only on an exact
 * label/id occurrence.
 */
function subjectTokens(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 2 && !SPINE_STOPWORDS.has(token))
      .map(stemToken),
  );
}

/**
 * The grounding fields a free-form recommendation is talking about. Resolved by
 * two complementary passes, so a line surfaces its input chip whether it names the
 * field explicitly or only by subject:
 *
 *   1. Whole-phrase match — the field's human label OR its raw id (bare or phase-
 *      qualified: "specify the costAssumption", "in the strategy.costAssumption
 *      input") as a whole word. Regex-escaped so a short label like "Industry"
 *      never fires on a substring, and "." counts as a boundary so
 *      `\bcostAssumption\b` still hits inside "strategy.costAssumption".
 *   2. Subject-token overlap — the field's distinctive noun(s) share a stemmed,
 *      stopword-stripped token with the text. This is what catches reviewer prose
 *      that names the field by meaning rather than by its exact label: "trim the
 *      costs array" → Cost assumption, "raise the realised benefits" → Realised
 *      benefits. Reuses the methodology-spine stopword vocabulary so both surfaces
 *      judge "subject" the same way.
 *
 * Fields are returned in their original order so chips read stably.
 */
export function matchGroundingFields<T extends { id: string; label: string }>(text: string, fields: T[]): T[] {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack.trim()) return [];
  const textTokens = subjectTokens(text);
  const namesField = (needle: string): boolean => {
    const n = needle.trim().toLowerCase();
    if (!n) return false;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(haystack);
  };
  const sharesSubject = (field: T): boolean => {
    if (textTokens.size === 0) return false;
    for (const token of subjectTokens(`${field.label} ${splitCamel(field.id)}`)) {
      if (textTokens.has(token)) return true;
    }
    return false;
  };
  return fields.filter(
    (field) => namesField(field.label) || namesField(field.id) || sharesSubject(field),
  );
}
