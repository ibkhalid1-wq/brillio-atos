/**
 * Per-programme dynamic schema extension.
 *
 * The static ATOS methodology (`ATOS_STANDARD`) declares the same input fields,
 * artifacts, and input→artifact flow for every programme. When a phase clears
 * its gate, a planner agent reads the prior phase's approved artifacts and can
 * propose *additional* next-phase input fields and artifacts tailored to that
 * specific programme (e.g. an "agentic CRM" programme may warrant a "Model
 * routing policy" input on Design that a generic programme would not).
 *
 * Those proposals are persisted on the programme (not in the methodology) under
 * `rawData.dynamicSchema`, mirroring the methodology's own shape:
 *   - inputFields:      phaseId → PhaseInputField[]   (each source:"ai-derived")
 *   - artifacts:        phaseId → DynamicArtifactDef[]
 *   - artifactInputFlow:phaseId → { artifactId → fieldId[] }   (same shape as
 *                       the methodology's `artifactInputFlow`)
 *
 * This module is the single resolver that merges the static methodology layer
 * with a programme's dynamic layer. Static always wins on id collisions, so the
 * methodology stays authoritative and dynamic entries are purely additive. Every
 * downstream resolver (input schema, artifact catalogue, flow edges) reads
 * through here, so a dynamic field shows up in the inputs panel, the flow
 * overlay, and the staleness model with no parallel wiring.
 */
import { ATOS_STANDARD, type PhaseInputField } from "@/v3/lib/methodology";

export interface DynamicArtifactDef {
  id: string;
  label: string;
  description: string;
}

export interface DynamicSchemaStore {
  /** phaseId → ai-derived input fields proposed for that phase. */
  inputFields?: Record<string, PhaseInputField[]>;
  /** phaseId → ai-derived artifacts proposed for that phase. */
  artifacts?: Record<string, DynamicArtifactDef[]>;
  /** phaseId → { artifactId → input field ids that feed it } (additive). */
  artifactInputFlow?: Record<string, Record<string, string[]>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Safely extract the dynamic schema store from a programme's raw data jsonb.
 * Tolerant of missing/malformed shapes — returns an empty store rather than
 * throwing, so callers can always merge unconditionally.
 */
export function getDynamicSchemaStore(rawData: unknown): DynamicSchemaStore {
  if (!isRecord(rawData)) return {};
  // Programme raw data is sometimes wrapped one level under `.data`; unwrap so
  // callers can pass `program.rawData` directly regardless of shape.
  const inner = isRecord(rawData.data) ? rawData.data : rawData;
  const store = inner.dynamicSchema;
  if (!isRecord(store)) return {};
  const out: DynamicSchemaStore = {};
  if (isRecord(store.inputFields)) out.inputFields = store.inputFields as Record<string, PhaseInputField[]>;
  if (isRecord(store.artifacts)) out.artifacts = store.artifacts as Record<string, DynamicArtifactDef[]>;
  if (isRecord(store.artifactInputFlow)) {
    out.artifactInputFlow = store.artifactInputFlow as Record<string, Record<string, string[]>>;
  }
  return out;
}

/** Static methodology input fields for a phase. */
function staticInputFields(phaseId: string): PhaseInputField[] {
  return ATOS_STANDARD.phases.find((p) => p.id === phaseId)?.inputFields ?? [];
}

/**
 * Merge static + dynamic input fields for a phase. Static fields keep their
 * order and win on id collision; dynamic fields are appended in declared order
 * and tagged `source: "ai-derived"` if not already.
 */
export function mergeDynamicInputFields(
  staticFields: PhaseInputField[],
  phaseId: string,
  store?: DynamicSchemaStore,
): PhaseInputField[] {
  const dynamic = store?.inputFields?.[phaseId];
  if (!Array.isArray(dynamic) || dynamic.length === 0) return staticFields;
  const seen = new Set(staticFields.map((f) => f.id));
  const extra = dynamic
    .filter((f) => f && typeof f.id === "string" && !seen.has(f.id))
    .map((f) => ({ ...f, source: "ai-derived" as const }));
  return extra.length ? [...staticFields, ...extra] : staticFields;
}

/** Dynamic artifact ids declared for a phase (deduped, valid). */
export function dynamicArtifactDefs(phaseId: string, store?: DynamicSchemaStore): DynamicArtifactDef[] {
  const defs = store?.artifacts?.[phaseId];
  if (!Array.isArray(defs)) return [];
  const seen = new Set<string>();
  const out: DynamicArtifactDef[] = [];
  for (const def of defs) {
    if (!def || typeof def.id !== "string" || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push({ id: def.id, label: def.label || def.id, description: def.description || "" });
  }
  return out;
}

const ALLOWED_FIELD_TYPES = new Set(["text", "textarea", "number", "date", "select", "grid"]);

export interface DynamicPhaseProposal {
  inputFields: PhaseInputField[];
  artifacts: DynamicArtifactDef[];
  artifactInputFlow: Record<string, string[]>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validate and coerce a planner agent's raw proposal for one phase into a
 * well-formed shape. The planner output is AI-generated and untrusted, so every
 * entry is shape-checked: fields need a non-empty id and an allowed type;
 * artifacts need a non-empty id; flow entries must reference declared dynamic
 * field/artifact ids. Anything malformed is dropped rather than persisted.
 * Returns null when nothing usable survives.
 */
export function sanitizePlannerProposal(raw: unknown): DynamicPhaseProposal | null {
  if (!isRecord(raw)) return null;
  const fieldsIn = Array.isArray(raw.inputFields) ? raw.inputFields : [];
  const artifactsIn = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  const flowIn = isRecord(raw.artifactInputFlow) ? raw.artifactInputFlow : {};

  const fieldIds = new Set<string>();
  const inputFields: PhaseInputField[] = [];
  for (const f of fieldsIn) {
    if (!isRecord(f)) continue;
    const id = asString(f.id).trim();
    const type = asString(f.type).trim();
    if (!id || fieldIds.has(id) || !ALLOWED_FIELD_TYPES.has(type)) continue;
    fieldIds.add(id);
    const field: PhaseInputField = {
      id,
      label: asString(f.label).trim() || id,
      type: type as PhaseInputField["type"],
      required: Boolean(f.required),
      source: "ai-derived",
    };
    if (asString(f.placeholder)) field.placeholder = asString(f.placeholder);
    if (asString(f.hint)) field.hint = asString(f.hint);
    if (Array.isArray(f.options)) field.options = f.options.filter((o): o is string => typeof o === "string");
    inputFields.push(field);
  }

  const artifactIds = new Set<string>();
  const artifacts: DynamicArtifactDef[] = [];
  for (const a of artifactsIn) {
    if (!isRecord(a)) continue;
    const id = asString(a.id).trim();
    if (!id || artifactIds.has(id)) continue;
    artifactIds.add(id);
    artifacts.push({ id, label: asString(a.label).trim() || id, description: asString(a.description).trim() });
  }

  const artifactInputFlow: Record<string, string[]> = {};
  for (const [artifactId, fields] of Object.entries(flowIn)) {
    if (!artifactIds.has(artifactId) || !Array.isArray(fields)) continue;
    const refs = fields.filter((id): id is string => typeof id === "string" && fieldIds.has(id));
    if (refs.length) artifactInputFlow[artifactId] = refs;
  }

  if (!inputFields.length && !artifacts.length) return null;
  return { inputFields, artifacts, artifactInputFlow };
}

/**
 * Merge a sanitized phase proposal into a programme's dynamic store, replacing
 * that phase's prior dynamic entries (the planner re-proposes the full set for
 * the phase each time). Returns a new store object; other phases untouched.
 */
export function applyDynamicProposal(
  store: DynamicSchemaStore,
  phaseId: string,
  proposal: DynamicPhaseProposal,
): DynamicSchemaStore {
  return {
    inputFields: { ...(store.inputFields ?? {}), [phaseId]: proposal.inputFields },
    artifacts: { ...(store.artifacts ?? {}), [phaseId]: proposal.artifacts },
    artifactInputFlow: { ...(store.artifactInputFlow ?? {}), [phaseId]: proposal.artifactInputFlow },
  };
}

/**
 * Dynamic field→artifact targets for a phase, inverted from the stored
 * artifact→fields flow (same shape as the methodology's `artifactInputFlow`).
 * Returns fieldId → artifactId[].
 */
export function dynamicFieldArtifacts(phaseId: string, store?: DynamicSchemaStore): Record<string, string[]> {
  const flow = store?.artifactInputFlow?.[phaseId];
  if (!isRecord(flow)) return {};
  const inverted: Record<string, string[]> = {};
  for (const [artifactId, fieldIds] of Object.entries(flow)) {
    if (!Array.isArray(fieldIds)) continue;
    for (const fieldId of fieldIds) {
      if (typeof fieldId !== "string") continue;
      (inverted[fieldId] ??= []).push(artifactId);
    }
  }
  return inverted;
}
