/**
 * Phase methodology completeness — the single binding that answers
 * "does this phase have everything the methodology requires, on this screen?"
 *
 * The methodology spreads its requirements across three independent sources:
 *   • required INPUTS      — phaseInputSchema (fields marked required)
 *   • required ARTIFACTS   — methodology.requiredArtifacts (via artifactModel)
 *   • mandatory EXIT CRITERIA — exitCriteriaLibrary
 *
 * Nothing previously reconciled them, so a PM could not see, in one place, the
 * full set of things the methodology demands of a phase and how much is done.
 * This pure selector unifies all three into one checklist + completeness score
 * so the phase screen can deliver on its promise: a PM can complete an entire
 * phase from this surface alone, because every required item is on it.
 */
import type { ProgramSummary } from "@/new/types";
import { getPhaseInputSchema, type GridColumn } from "@/v3/lib/phaseInputSchema";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";
import { isFieldValueFilled } from "@/v3/components/StructuredGrid";

export type RequirementKind = "input" | "artifact" | "exit-criterion";

export interface MethodologyRequirement {
  id: string;
  kind: RequirementKind;
  label: string;
  present: boolean;
  detail: string | null;
}

export interface MethodologyRequirementGroup {
  kind: RequirementKind;
  label: string;
  present: number;
  total: number;
  items: MethodologyRequirement[];
}

export interface PhaseMethodologyCompleteness {
  groups: MethodologyRequirementGroup[];
  /** Count of satisfied required items across all groups. */
  present: number;
  /** Total required items across all groups. */
  total: number;
  /** present / total as 0–100 (100 when there are no requirements). */
  pct: number;
  complete: boolean;
}

const GROUP_LABEL: Record<RequirementKind, string> = {
  input: "Required inputs",
  artifact: "Required artifacts",
  "exit-criterion": "Mandatory exit criteria",
};

/** Read the persisted phase inputs map, tolerating both rawData shapes. */
function readPhaseInputs(program: ProgramSummary, phaseId: string): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const source = typeof raw.data === "object" && raw.data !== null
    ? (raw.data as Record<string, unknown>)
    : raw;
  const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
    ? (source.phaseInputs as Record<string, Record<string, unknown>>)
    : {};
  return phaseInputs[phaseId] ?? {};
}

/** True when a required field carries real content. Grids must have at least one
 *  filled row (or their declared minRows) — a "[]" / blank-row JSON string is not
 *  "present", matching how derivePhaseInputQuality scores the same field set.
 *  Delegates to the shared isFieldValueFilled so every reader judges fill alike. */
function inputFilled(field: { type: string; columns?: GridColumn[]; minRows?: number }, value: unknown): boolean {
  return isFieldValueFilled(field, value);
}

/** Build the set of mandatory exit-criterion labels that are marked met on the gate. */
function metExitCriterionLabels(program: ProgramSummary, phaseId: string): Set<string> {
  const gate = program.gateReviews?.[phaseId] as unknown as Record<string, unknown> | undefined;
  if (!gate) return new Set();
  // An approved gate implies all mandatory criteria are satisfied.
  if (gate.status === "approved") return new Set(getMandatoryCriteria(phaseId).map((c) => c.label.toLowerCase()));
  const stored = Array.isArray(gate.exitCriteriaStatus) ? gate.exitCriteriaStatus : [];
  const met = new Set<string>();
  for (const entry of stored as Array<Record<string, unknown>>) {
    if (entry && entry.met === true && typeof entry.criterion === "string") {
      met.add(entry.criterion.toLowerCase());
    }
  }
  return met;
}

/**
 * Derive the methodology completeness for `phaseId`. Returns null when there is
 * no program or phase, so the caller can hide the panel.
 */
export function derivePhaseMethodologyCompleteness(
  program: ProgramSummary | null,
  phaseId: string | null,
): PhaseMethodologyCompleteness | null {
  if (!program || !phaseId) return null;

  // 1) Required inputs.
  const inputs = readPhaseInputs(program, phaseId);
  const inputItems: MethodologyRequirement[] = getPhaseInputSchema(phaseId).fields
    .filter((field) => field.required)
    .map((field) => ({
      id: `input:${field.id}`,
      kind: "input" as const,
      label: field.label,
      present: inputFilled(field, inputs[field.id]),
      detail: field.hint ?? null,
    }));

  // 2) Required artifacts.
  const phaseArtifacts = buildPhaseArtifacts(program, phaseId);
  const artifactItems: MethodologyRequirement[] = (phaseArtifacts?.artifacts ?? [])
    .filter((node) => node.required)
    .map((node) => ({
      id: `artifact:${node.key}`,
      kind: "artifact" as const,
      label: node.label,
      present: node.present,
      detail: node.present ? node.evidence : "Not yet produced",
    }));

  // 3) Mandatory exit criteria.
  const metLabels = metExitCriterionLabels(program, phaseId);
  const exitItems: MethodologyRequirement[] = getMandatoryCriteria(phaseId).map((criterion) => ({
    id: `exit:${criterion.id}`,
    kind: "exit-criterion" as const,
    label: criterion.label,
    present: metLabels.has(criterion.label.toLowerCase()),
    detail: criterion.description,
  }));

  const groups: MethodologyRequirementGroup[] = [
    { kind: "input" as const, label: GROUP_LABEL.input, items: inputItems, present: inputItems.filter((i) => i.present).length, total: inputItems.length },
    { kind: "artifact" as const, label: GROUP_LABEL.artifact, items: artifactItems, present: artifactItems.filter((i) => i.present).length, total: artifactItems.length },
    { kind: "exit-criterion" as const, label: GROUP_LABEL["exit-criterion"], items: exitItems, present: exitItems.filter((i) => i.present).length, total: exitItems.length },
  ].filter((group) => group.total > 0);

  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const present = groups.reduce((sum, group) => sum + group.present, 0);
  const pct = total === 0 ? 100 : Math.round((present / total) * 100);

  return { groups, present, total, pct, complete: total > 0 && present === total };
}
