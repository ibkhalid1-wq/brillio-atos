import {
  getMethodology,
  type MethodologyVariant,
  type PhaseDefinition,
  type PhaseInputField,
} from "@/v3/lib/methodology";
import { getMandatoryCriteria, type ExitCriterion } from "@/v3/lib/exitCriteriaLibrary";

/**
 * Methodology-spine coherence analysis (Option D).
 *
 * The phase "spine" is a contract between three declarations that are meant to
 * describe the SAME programme but are authored separately and can silently drift:
 *
 *   1. `inputFields`                — what the user is asked to provide.
 *   2. `artifactInputFlow`         — which inputs feed each artifact's generation.
 *   3. mandatory exit criteria     — what the phase must PROVE to pass its gate
 *                                    (from EXIT_CRITERIA_LIBRARY).
 *
 * Two failure modes show up in practice:
 *
 *   • A structural break — `artifactInputFlow` references an input field id that
 *     no longer exists (a rename/typo). Generation and staleness wiring then
 *     silently drop that input. This is always a bug, so it is a hard invariant.
 *
 *   • A coverage gap — an exit criterion demands a fact (e.g. "date of sponsor
 *     sign-off", "budget approval reference") that no input field can hold, so
 *     the artifact reviewer keeps asking the user to "record it in the relevant
 *     input" that doesn't exist. This is a methodology-design gap, not a code
 *     bug, so it is reported (not hard-failed) as an inventory the team can work
 *     down deliberately — and locked by a test so new gaps surface in review.
 */

/** A flow entry that points at an input field the phase does not declare. */
export interface FlowFieldGap {
  phaseId: string;
  /** The artifact/agent whose input flow references the missing field. */
  artifactId: string;
  missingFieldId: string;
}

/** How well a mandatory exit criterion is backed by capturable input fields. */
export interface ExitCriterionCoverage {
  phaseId: string;
  criterionId: string;
  label: string;
  category: ExitCriterion["category"];
  /** Input field ids whose subject matter overlaps the criterion's evidence. */
  backingFieldIds: string[];
  /** True when at least one input field plausibly captures the criterion's evidence. */
  covered: boolean;
}

export interface MethodologySpineReport {
  variant: MethodologyVariant;
  flowFieldGaps: FlowFieldGap[];
  exitCriteriaCoverage: ExitCriterionCoverage[];
  /** Convenience: the mandatory criteria with no input backing, most actionable first. */
  uncoveredCriteria: ExitCriterionCoverage[];
}

// Generic programme / governance vocabulary that carries no subject identity —
// stripped before overlap so "Budget baseline confirmed" matches a *budget*
// field on the noun, not on filler like "confirmed" that appears everywhere.
const SPINE_STOPWORDS = new Set([
  "the", "and", "for", "with", "has", "have", "been", "are", "not", "all", "any",
  "each", "least", "one", "per", "from", "into", "that", "this", "their", "its",
  "programme", "program", "phase", "gate", "key", "initial", "ongoing", "final",
  "least", "level", "list", "summary", "reference", "document", "documented",
  "record", "recorded", "plan", "planned", "approved", "approval", "confirmed",
  "confirm", "established", "establish", "defined", "define", "agreed", "agree",
  "complete", "completed", "reviewed", "review", "signed", "sign", "off", "date",
  "dates", "status", "log", "register", "report", "reports", "reporting", "note",
  "noted", "identified", "identify", "mapped", "map", "against", "across", "over",
  "under", "within", "least", "committed", "commitment", "chart", "matrix",
  "threshold", "criteria", "criterion", "material", "ready", "place", "put",
]);

function toTokens(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 2 && !SPINE_STOPWORDS.has(token)),
  );
}

/** The searchable text a field exposes — label plus every author-written hint. */
function fieldSubjectText(field: PhaseInputField): string {
  return [
    field.label,
    field.hint,
    field.placeholder,
    field.validationRule,
    ...(field.columns?.flatMap((column) => [column.label, column.placeholder]) ?? []),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) if (b.has(token)) return true;
  return false;
}

/** Structural check: which flow entries reference a non-existent input field. */
export function findFlowFieldGaps(phase: PhaseDefinition): FlowFieldGap[] {
  const fieldIds = new Set((phase.inputFields ?? []).map((field) => field.id));
  const gaps: FlowFieldGap[] = [];
  for (const [artifactId, flowFieldIds] of Object.entries(phase.artifactInputFlow ?? {})) {
    for (const fieldId of flowFieldIds) {
      if (!fieldIds.has(fieldId)) gaps.push({ phaseId: phase.id, artifactId, missingFieldId: fieldId });
    }
  }
  return gaps;
}

/**
 * Coverage check: for each mandatory exit criterion, the input fields whose
 * subject matter overlaps the criterion's label + evidence prompt. A criterion
 * with no overlapping field is a coverage gap — nothing the user types can carry
 * its evidence, so the phase can only ever prove it via an artifact/approval.
 */
export function analyzeExitCriteriaCoverage(phase: PhaseDefinition): ExitCriterionCoverage[] {
  const fields = phase.inputFields ?? [];
  const fieldTokenSets = fields.map((field) => ({ id: field.id, tokens: toTokens(fieldSubjectText(field)) }));
  return getMandatoryCriteria(phase.id).map((criterion) => {
    const criterionTokens = toTokens(`${criterion.label} ${criterion.evidencePrompt}`);
    const backingFieldIds = fieldTokenSets
      .filter((field) => hasOverlap(field.tokens, criterionTokens))
      .map((field) => field.id);
    return {
      phaseId: phase.id,
      criterionId: criterion.id,
      label: criterion.label,
      category: criterion.category,
      backingFieldIds,
      covered: backingFieldIds.length > 0,
    };
  });
}

/** Full spine coherence report for a methodology variant. */
export function analyzeMethodologySpine(variant: MethodologyVariant = "atos-lite"): MethodologySpineReport {
  const phases = getMethodology(variant).phases;
  const flowFieldGaps = phases.flatMap(findFlowFieldGaps);
  const exitCriteriaCoverage = phases.flatMap(analyzeExitCriteriaCoverage);
  return {
    variant,
    flowFieldGaps,
    exitCriteriaCoverage,
    uncoveredCriteria: exitCriteriaCoverage.filter((coverage) => !coverage.covered),
  };
}
