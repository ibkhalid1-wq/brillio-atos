/**
 * Phase input prioritisation — "show what matters now".
 *
 * The methodology defines a fixed set of inputs per phase, but at any given
 * moment only some of them actually move the needle: an empty *required* field
 * blocks the gate, an empty optional one merely adds polish, and a field that's
 * already filled needs no attention at all. This reorders the schema so the
 * highest-impact gaps float to the top while preserving the methodology's
 * intended order *within* each band as a stable tiebreak. Crucially it ranks from
 * a *snapshot* of values (the persisted state), not the live edit buffer, so a
 * field never jumps under the user's cursor as they type into it.
 */
import type { PhaseInputField } from "@/v3/lib/phaseInputSchema";

export type FieldPriority = "required-gap" | "optional-gap" | "complete";

const RANK: Record<FieldPriority, number> = {
  "required-gap": 0,
  "optional-gap": 1,
  complete: 2,
};

export interface PrioritizedField {
  field: PhaseInputField;
  priority: FieldPriority;
}

export interface PrioritizedFieldsResult {
  /** Fields ordered highest-impact first, stable within each band. */
  fields: PrioritizedField[];
  /** Required fields still empty — these block the gate. */
  requiredGaps: number;
  /** Optional fields still empty. */
  optionalGaps: number;
  /** Id of the first field needing attention (required first), or null when none. */
  firstGapId: string | null;
}

function isFilled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Prioritise `fields` against a snapshot of `values`. Pure and order-stable.
 */
export function prioritizePhaseFields(
  fields: PhaseInputField[],
  values: Record<string, string | undefined>,
): PrioritizedFieldsResult {
  const decorated = fields.map((field, index) => {
    const filled = isFilled(values[field.id]);
    const priority: FieldPriority = filled
      ? "complete"
      : field.required
        ? "required-gap"
        : "optional-gap";
    return { field, priority, index };
  });

  const ordered = [...decorated].sort((a, b) => {
    const rankDelta = RANK[a.priority] - RANK[b.priority];
    if (rankDelta !== 0) return rankDelta;
    return a.index - b.index; // stable: keep methodology order within a band
  });

  const requiredGaps = decorated.filter((d) => d.priority === "required-gap").length;
  const optionalGaps = decorated.filter((d) => d.priority === "optional-gap").length;
  const firstGap = ordered.find((d) => d.priority !== "complete");

  return {
    fields: ordered.map(({ field, priority }) => ({ field, priority })),
    requiredGaps,
    optionalGaps,
    firstGapId: firstGap ? firstGap.field.id : null,
  };
}
