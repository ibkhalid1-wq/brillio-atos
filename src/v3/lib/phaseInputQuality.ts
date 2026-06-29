/**
 * Deterministic, schema-grounded input-quality assessment for a phase.
 *
 * The Stage view previously rendered the "Input quality NN%" banner from a
 * model-generated bucket (the `input-quality` agent). Because that output was
 * free-form, it surfaced suggestions that don't belong to the phase — e.g.
 * "Defined workstreams" for Strategy, even though workstreams are not a Strategy
 * input. This derives the same banner shape purely from the phase's declared
 * input schema (the single source of truth for which fields a phase actually
 * has), so the "Missing:" list can only ever name real inputs for that phase.
 *
 * Zero-token by construction — no model call. The only phase-specific companion
 * input outside the field schema is the Strategy "Outcome KPIs" grid, which is
 * included for Strategy alone.
 */
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { parseRows, filledRowCount } from "@/v3/components/StructuredGrid";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { resolveArtifactReview } from "@/v3/lib/artifactReview";

// Each outstanding artifact-review improvement recommendation costs this many
// points off a perfect input-quality score. A reviewed artifact with no
// recommendations implies its grounding inputs were complete (100); the score
// degrades as the average recommendation count per reviewed artifact rises.
const RECOMMENDATION_PENALTY = 10;

// Input quality derived from the artifact-review improvement recommendations:
// the AI review for each produced artifact lists what to improve, which is direct
// evidence of how well the phase inputs grounded that artifact. Averaged across
// the phase's reviewed artifacts so the score is independent of artifact count.
// Returns null when no artifact in the phase has been reviewed yet — there is no
// recommendation signal to score, so the caller keeps the schema-based score.
function deriveRecommendationInputScore(
  phaseId: string,
  source: Record<string, unknown>,
  store?: DynamicSchemaStore,
): number | null {
  let reviewed = 0;
  let totalRecommendations = 0;
  for (const def of getPhaseArtifactDefs(phaseId, store)) {
    const review = resolveArtifactReview(source, def.id, phaseId);
    if (!review) continue;
    reviewed += 1;
    totalRecommendations += review.improvements.length;
  }
  if (reviewed === 0) return null;
  const avgRecommendations = totalRecommendations / reviewed;
  return Math.max(0, Math.round(100 - avgRecommendations * RECOMMENDATION_PENALTY));
}

export interface PhaseInputQuality {
  overallScore: number;
  verdict: "sufficient" | "partial" | "insufficient";
  missingCritical: string[];
  readyToRun?: string[];
  /** Count of required input fields that are filled (completeness numerator). */
  present: number;
  /** Total required input fields for the phase (completeness denominator). */
  total: number;
}

interface QualityItem {
  label: string;
  present: boolean;
  /** Word count for scalar text inputs; 0 for structured/non-text items. */
  words: number;
  scalar: boolean;
}

function assessScalar(value: unknown): { present: boolean; words: number } {
  if (typeof value === "number" && Number.isFinite(value)) return { present: true, words: 1 };
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) return { present: false, words: 0 };
  return { present: true, words: str.split(/\s+/).filter(Boolean).length };
}

function countNamedKpis(raw: unknown): number {
  if (typeof raw !== "string" || !raw.trim()) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter(
      (kpi) =>
        kpi &&
        typeof kpi === "object" &&
        typeof (kpi as Record<string, unknown>).name === "string" &&
        ((kpi as Record<string, unknown>).name as string).trim().length > 0,
    ).length;
  } catch {
    return 0;
  }
}

export function derivePhaseInputQuality(
  phaseId: string | null | undefined,
  phaseInputs: Record<string, unknown> | null | undefined,
  store?: DynamicSchemaStore,
  source?: Record<string, unknown> | null,
): PhaseInputQuality | null {
  if (!phaseId) return null;

  // Resolve with the programme's dynamic store so the metric scores the same
  // field set the inputs panel renders — including ai-derived dynamic fields.
  // Omitting the store yields the static schema (unchanged for callers/tests).
  const schema = getPhaseInputSchema(phaseId, store);
  const inputs = phaseInputs ?? {};
  const items: QualityItem[] = [];

  for (const field of schema.fields) {
    if (!field.required) continue;
    if (field.type === "grid") {
      const rows = parseRows(inputs[field.id], field.columns ?? []);
      const filled = filledRowCount(rows, field.columns ?? []);
      const need = field.minRows ?? 1;
      items.push({ label: field.label, present: filled >= need, words: 0, scalar: false });
    } else {
      const { present, words } = assessScalar(inputs[field.id]);
      items.push({ label: field.label, present, words, scalar: true });
    }
  }

  // Strategy is the only phase with the Outcome KPIs companion grid; it is a
  // genuine Strategy input, so a missing KPI set is a valid quality gap there.
  if (phaseId === "strategy") {
    items.push({ label: "Outcome KPIs", present: countNamedKpis(inputs.kpis) >= 1, words: 0, scalar: false });
  }

  if (items.length === 0) return null;

  const present = items.filter((item) => item.present);
  const completeness = present.length / items.length;

  // Depth bonus from substantive text entries only (grids/KPIs are pass/fail).
  const presentScalars = present.filter((item) => item.scalar);
  const avgWords = presentScalars.length
    ? presentScalars.reduce((sum, item) => sum + item.words, 0) / presentScalars.length
    : 0;
  const depth = presentScalars.length ? Math.min(1, avgWords / 12) : completeness;

  // Schema-grounded score from field completeness + depth. Used as the baseline
  // and as the fallback before any artifact has been reviewed.
  const schemaScore = Math.round((completeness * 0.8 + depth * 0.2) * 100);
  // Once artifacts exist and carry review recommendations, those recommendations
  // are the truer measure of input quality — they say, in the AI's own words,
  // what the inputs failed to ground. Prefer them when available.
  const recommendationScore = source ? deriveRecommendationInputScore(phaseId, source, store) : null;
  const overallScore = recommendationScore ?? schemaScore;
  const missingCritical = items.filter((item) => !item.present).map((item) => item.label);

  const verdict: PhaseInputQuality["verdict"] =
    overallScore >= 80 ? "sufficient" : overallScore >= 40 ? "partial" : "insufficient";

  return { overallScore, verdict, missingCritical, present: present.length, total: items.length };
}
