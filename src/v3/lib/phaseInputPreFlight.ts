import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";

export interface PreFlightResult {
  pass: boolean;
  completeness: number;
  missingFields: string[];
  warnings: string[];
  blockingCount: number;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Validates a phase's persisted inputs against its real input schema
 * (PHASE_INPUT_SCHEMAS) — the same fields the user fills in PhaseInputsPanel.
 * A required field counts as missing only when blank, so the "Needs: …" warning
 * always names fields that genuinely have no value (no phantom keys).
 */
export function runPreFlight(phaseId: string, inputs: Record<string, unknown>): PreFlightResult {
  const schema = getPhaseInputSchema(phaseId);
  const required = schema.fields.filter((field) => field.required);
  const missingFields: string[] = [];
  const warnings: string[] = [];

  for (const field of required) {
    if (isEmptyValue(inputs[field.id])) missingFields.push(field.label);
  }

  for (const field of schema.fields) {
    if (field.type !== "textarea") continue;
    const val = inputs[field.id];
    if (typeof val === "string" && val.trim().length > 0 && val.trim().split(/\s+/).length < 8) {
      warnings.push(`${field.label} is brief — output quality may be limited`);
    }
  }

  const completeness = required.length === 0
    ? 100
    : Math.round(((required.length - missingFields.length) / required.length) * 100);

  return { pass: missingFields.length === 0, completeness, missingFields, warnings, blockingCount: missingFields.length };
}
