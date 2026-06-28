import { ATOS_STANDARD, type GridColumn, type PhaseInputField } from "@/v3/lib/methodology";
import { mergeDynamicInputFields, type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

// Field/column types are owned by the methodology (single source of truth);
// re-exported here so existing imports from this module keep working.
export type { GridColumn, PhaseInputField } from "@/v3/lib/methodology";

export interface PhaseInputSchema {
  phaseId: string;
  title: string;
  description: string;
  fields: PhaseInputField[];
}

/** Reads a phase's input-field definitions from the methodology registry. */
function methodologyInputFields(phaseId: string): PhaseInputField[] {
  return ATOS_STANDARD.phases.find((phase) => phase.id === phaseId)?.inputFields ?? [];
}

export const PHASE_INPUT_SCHEMAS: Record<string, PhaseInputSchema> = {
  strategy: {
    phaseId: "strategy",
    title: "Strategy inputs",
    description: "Provide the foundational context ATOS needs to generate strategy artifacts.",
    // Fields sourced from the methodology so the schema never drifts from it.
    fields: methodologyInputFields("strategy"),
  },
  mobilise: {
    phaseId: "mobilise",
    title: "Mobilise inputs",
    description: "Define the team and governance structure for this phase.",
    // Fields sourced from the methodology so the schema never drifts from it.
    fields: methodologyInputFields("mobilise"),
  },
  discover: {
    phaseId: "discover",
    title: "Discover inputs",
    description: "Describe the current state and discovery scope.",
    fields: methodologyInputFields("discover"),
  },
  design: {
    phaseId: "design",
    title: "Design inputs",
    description: "Provide the solution design context for this phase.",
    fields: methodologyInputFields("design"),
  },
  build: {
    phaseId: "build",
    title: "Build inputs",
    description: "Track build progress and highlight what ATOS should know.",
    fields: methodologyInputFields("build"),
  },
  operate: {
    phaseId: "operate",
    title: "Operate inputs",
    description: "Confirm go-live readiness, support arrangements, and the KPIs now being tracked.",
    fields: methodologyInputFields("operate"),
  },
  govern: {
    phaseId: "govern",
    title: "Govern inputs",
    description: "Establish the compliance, controls, and reporting that keep the programme governed.",
    fields: methodologyInputFields("govern"),
  },
  optimize: {
    phaseId: "optimize",
    title: "Optimize inputs",
    description: "Capture the baseline, improvement backlog, and adoption signals that drive continuous improvement.",
    fields: methodologyInputFields("optimize"),
  },
  valuerealize: {
    phaseId: "valuerealize",
    title: "Value Realize inputs",
    description: "Record realised benefits, lessons, and the handover that closes the programme.",
    fields: methodologyInputFields("valuerealize"),
  },
};

/**
 * Resolve a phase's input schema. When a programme's `store` is supplied, any
 * ai-derived dynamic fields for the phase are merged on top of the static
 * methodology fields (static wins on id collision). Omitting `store` yields the
 * static schema unchanged, so existing pure call sites and tests are unaffected.
 */
export function getPhaseInputSchema(phaseId: string, store?: DynamicSchemaStore): PhaseInputSchema {
  const base = PHASE_INPUT_SCHEMAS[phaseId] ?? {
    phaseId,
    title: "Phase inputs",
    description: "Provide any context ATOS needs to generate artifacts for this phase.",
    fields: [
      { id: "context", label: "Phase context", type: "textarea", placeholder: "Key information, decisions made, or constraints for this phase", required: true },
      { id: "objectives", label: "Phase objectives", type: "textarea", placeholder: "What must be achieved before this phase can close?", required: true },
    ],
  };
  const fields = mergeDynamicInputFields(base.fields, phaseId, store);
  return fields === base.fields ? base : { ...base, fields };
}

// ─── Canonical core-team roster resolution ────────────────────────────────────
// The team roster is an ai-derived dynamic grid, never a hard-coded schema. Its
// canonical address is the field id "coreTeamRoster" (label "Named individuals
// per core team role"). Every consumer — the inputs panel reference, the
// document-import bridge, the capacity-assessor — resolves it through these
// helpers so the roster has one shared address even though its columns are
// proposed by the planner per programme.

/** The phase that owns the canonical roster. */
export const ROSTER_PHASE_ID = "mobilise";

/** Find the column key whose key or label matches `re`, falling back to `fallback`. */
export function matchColumnKey(columns: GridColumn[], re: RegExp, fallback?: string): string | undefined {
  const hit = columns.find((c) => re.test(c.key) || re.test(c.label ?? ""));
  return hit?.key ?? fallback;
}

/**
 * Locate the core-team roster grid in a set of phase fields. Prefers the
 * canonical ai-derived id ("coreTeamRoster"); otherwise the first grid whose
 * columns clearly carry a name and a role. Returns null when no such grid is
 * declared (e.g. the dynamic schema has not been generated yet) — we never
 * fabricate a field.
 */
export function findRosterGrid(fields: PhaseInputField[]): PhaseInputField | null {
  const byId = fields.find((f) => f.type === "grid" && f.id === "coreTeamRoster");
  if (byId) return byId;
  return (
    fields.find(
      (f) =>
        f.type === "grid" &&
        Boolean(matchColumnKey(f.columns ?? [], /name/i)) &&
        Boolean(matchColumnKey(f.columns ?? [], /role|title|position/i)),
    ) ?? null
  );
}

/** Resolve the roster grid field for a programme (defaults to the Mobilise phase). */
export function resolveRosterField(store?: DynamicSchemaStore, phaseId: string = ROSTER_PHASE_ID): PhaseInputField | null {
  return findRosterGrid(getPhaseInputSchema(phaseId, store).fields);
}
