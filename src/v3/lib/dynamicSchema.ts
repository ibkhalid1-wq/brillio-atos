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

export type ArtifactGenerationReadiness = "ready" | "needs_input" | "blocked";

export interface DynamicArtifactDef {
  id: string;
  label: string;
  description: string;
  // ── Planner dependency map (optional) ──────────────────────────────────────
  /** Field ids this artifact needs before it can be generated. */
  requiredInputs?: string[];
  /** Prior-phase artifact ids this artifact synthesizes. */
  sourceArtifactsUsed?: string[];
  /** Whether the artifact can be generated now, needs inputs, or is blocked. */
  generationReadiness?: ArtifactGenerationReadiness;
  /** Field ids still missing that block generation. */
  missingInputs?: string[];
}

/** A field the planner surfaces because prior phases disagree on a value. */
export interface ConflictField {
  fieldId: string;
  label: string;
  conflictDescription: string;
  conflictingValues: string[];
  requiredResolution: boolean;
  usedByArtifacts: string[];
}

/** Planner verdict + counts for a phase, shown in the phase header. */
export interface PhasePlanMeta {
  readiness?: "green" | "yellow" | "red";
  rationale?: string;
  purpose?: string;
  validationSummary?: {
    inputCount: number;
    artifactCount: number;
    conflictCount: number;
    readyArtifacts: number;
    blockedArtifacts: number;
  };
}

export interface DynamicSchemaStore {
  /** phaseId → ai-derived input fields proposed for that phase. */
  inputFields?: Record<string, PhaseInputField[]>;
  /** phaseId → ai-derived artifacts proposed for that phase. */
  artifacts?: Record<string, DynamicArtifactDef[]>;
  /** phaseId → { artifactId → input field ids that feed it } (additive). */
  artifactInputFlow?: Record<string, Record<string, string[]>>;
  /** phaseId → cross-phase conflicts the user must resolve. */
  conflicts?: Record<string, ConflictField[]>;
  /** phaseId → planner-flagged gaps requiring attention. */
  gaps?: Record<string, string[]>;
  /** phaseId → planner readiness verdict + validation summary. */
  planMeta?: Record<string, PhasePlanMeta>;
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
  if (isRecord(store.conflicts)) out.conflicts = store.conflicts as Record<string, ConflictField[]>;
  if (isRecord(store.gaps)) out.gaps = store.gaps as Record<string, string[]>;
  if (isRecord(store.planMeta)) out.planMeta = store.planMeta as Record<string, PhasePlanMeta>;
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

const ARTIFACT_READINESS = new Set(["ready", "needs_input", "blocked"]);

/** Dynamic artifact ids declared for a phase (deduped, valid). */
export function dynamicArtifactDefs(phaseId: string, store?: DynamicSchemaStore): DynamicArtifactDef[] {
  const defs = store?.artifacts?.[phaseId];
  if (!Array.isArray(defs)) return [];
  const seen = new Set<string>();
  const out: DynamicArtifactDef[] = [];
  for (const def of defs) {
    if (!def || typeof def.id !== "string" || seen.has(def.id)) continue;
    seen.add(def.id);
    const entry: DynamicArtifactDef = { id: def.id, label: def.label || def.id, description: def.description || "" };
    if (Array.isArray(def.requiredInputs)) entry.requiredInputs = def.requiredInputs.filter((x): x is string => typeof x === "string");
    if (Array.isArray(def.sourceArtifactsUsed)) entry.sourceArtifactsUsed = def.sourceArtifactsUsed.filter((x): x is string => typeof x === "string");
    if (typeof def.generationReadiness === "string" && ARTIFACT_READINESS.has(def.generationReadiness)) entry.generationReadiness = def.generationReadiness;
    if (Array.isArray(def.missingInputs)) entry.missingInputs = def.missingInputs.filter((x): x is string => typeof x === "string");
    out.push(entry);
  }
  return out;
}

/** Cross-phase conflicts the planner flagged for a phase. */
export function dynamicConflicts(phaseId: string, store?: DynamicSchemaStore): ConflictField[] {
  const list = store?.conflicts?.[phaseId];
  if (!Array.isArray(list)) return [];
  const out: ConflictField[] = [];
  for (const c of list) {
    if (!isRecord(c)) continue;
    const fieldId = asString(c.fieldId).trim();
    if (!fieldId) continue;
    out.push({
      fieldId,
      label: asString(c.label).trim() || fieldId,
      conflictDescription: asString(c.conflictDescription).trim(),
      conflictingValues: Array.isArray(c.conflictingValues) ? c.conflictingValues.map((v) => asString(v)).filter(Boolean) : [],
      requiredResolution: c.requiredResolution !== false,
      usedByArtifacts: Array.isArray(c.usedByArtifacts) ? c.usedByArtifacts.filter((x): x is string => typeof x === "string") : [],
    });
  }
  return out;
}

/** Planner-flagged gaps (free-text) for a phase. */
export function dynamicGaps(phaseId: string, store?: DynamicSchemaStore): string[] {
  const list = store?.gaps?.[phaseId];
  if (!Array.isArray(list)) return [];
  return list.map((g) => asString(g).trim()).filter(Boolean);
}

/** Planner readiness verdict + summary for a phase, or null. */
export function dynamicPlanMeta(phaseId: string, store?: DynamicSchemaStore): PhasePlanMeta | null {
  const meta = store?.planMeta?.[phaseId];
  return isRecord(meta) ? (meta as PhasePlanMeta) : null;
}

const ALLOWED_FIELD_TYPES = new Set(["text", "textarea", "number", "date", "select", "grid"]);

export interface DynamicPhaseProposal {
  inputFields: PhaseInputField[];
  artifacts: DynamicArtifactDef[];
  artifactInputFlow: Record<string, string[]>;
  conflicts: ConflictField[];
  gaps: string[];
  planMeta: PhasePlanMeta;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);
const READINESS_LEVELS = new Set(["green", "yellow", "red"]);

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v).trim()).filter(Boolean) : [];
}

/**
 * Validate and coerce the Phase Transition Planner's raw proposal for one phase
 * into a well-formed shape. The output is AI-generated and untrusted, so every
 * entry is shape-checked and anything malformed is dropped. Accepts both the
 * rich planner contract (`fieldId`, `artifactsToGenerate`, `conflictResolution
 * Fields`, `gaps`, `nextPhase`) and the legacy flat shape (`id`, `artifacts`),
 * so an older deployed agent keeps working during rollout. Returns null when
 * nothing usable survives.
 */
export function sanitizePlannerProposal(raw: unknown): DynamicPhaseProposal | null {
  if (!isRecord(raw)) return null;
  const fieldsIn = Array.isArray(raw.inputFields) ? raw.inputFields : [];
  const artifactsIn = Array.isArray(raw.artifactsToGenerate)
    ? raw.artifactsToGenerate
    : Array.isArray(raw.artifacts) ? raw.artifacts : [];
  const flowIn = isRecord(raw.artifactInputFlow) ? raw.artifactInputFlow : {};
  const conflictsIn = Array.isArray(raw.conflictResolutionFields) ? raw.conflictResolutionFields : [];
  const nextPhase = isRecord(raw.nextPhase) ? raw.nextPhase : {};
  const summaryIn = isRecord(raw.validationSummary) ? raw.validationSummary : {};

  const fieldIds = new Set<string>();
  const inputFields: PhaseInputField[] = [];
  for (const f of fieldsIn) {
    if (!isRecord(f)) continue;
    const id = (asString(f.fieldId) || asString(f.id)).trim();
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
    // Prefer an explicit hint; fall back to the planner's field description.
    const hint = asString(f.hint).trim() || asString(f.description).trim();
    if (hint) field.hint = hint;
    if (Array.isArray(f.options)) field.options = f.options.filter((o): o is string => typeof o === "string");
    // Planner traceability + prefill (all optional).
    if (asString(f.reasonNeeded).trim()) field.reasonNeeded = asString(f.reasonNeeded).trim();
    const usedBy = asStringArray(f.usedByArtifacts);
    if (usedBy.length) field.usedByArtifacts = usedBy;
    const prefill = f.prefillValue;
    if (prefill !== null && prefill !== undefined && asString(prefill).trim()) {
      field.prefillValue = asString(prefill).trim();
    }
    if (asString(f.prefillSource).trim()) field.prefillSource = asString(f.prefillSource).trim();
    const conf = asString(f.confidence).trim().toLowerCase();
    if (CONFIDENCE_LEVELS.has(conf)) field.confidence = conf as PhaseInputField["confidence"];
    if (f.needsConfirmation === true) field.needsConfirmation = true;
    if (asString(f.validationRule).trim()) field.validationRule = asString(f.validationRule).trim();
    if (asString(f.example).trim()) field.example = asString(f.example).trim();
    inputFields.push(field);
  }

  const artifactIds = new Set<string>();
  const artifacts: DynamicArtifactDef[] = [];
  for (const a of artifactsIn) {
    if (!isRecord(a)) continue;
    const id = (asString(a.artifactId) || asString(a.id)).trim();
    if (!id || artifactIds.has(id)) continue;
    artifactIds.add(id);
    const def: DynamicArtifactDef = {
      id,
      label: (asString(a.artifactName) || asString(a.label)).trim() || id,
      description: (asString(a.artifactPurpose) || asString(a.description)).trim(),
    };
    const reqIn = asStringArray(a.requiredInputs);
    if (reqIn.length) def.requiredInputs = reqIn;
    const srcIn = asStringArray(a.sourceArtifactsUsed);
    if (srcIn.length) def.sourceArtifactsUsed = srcIn;
    const readiness = asString(a.generationReadiness).trim().toLowerCase();
    if (ARTIFACT_READINESS.has(readiness)) def.generationReadiness = readiness as ArtifactGenerationReadiness;
    const missingIn = asStringArray(a.missingInputs);
    if (missingIn.length) def.missingInputs = missingIn;
    artifacts.push(def);
  }

  // Flow: prefer an explicit artifactInputFlow map; otherwise derive it from each
  // artifact's requiredInputs so the rich contract still produces flow edges.
  const artifactInputFlow: Record<string, string[]> = {};
  for (const [artifactId, fields] of Object.entries(flowIn)) {
    if (!artifactIds.has(artifactId) || !Array.isArray(fields)) continue;
    const refs = fields.filter((id): id is string => typeof id === "string" && fieldIds.has(id));
    if (refs.length) artifactInputFlow[artifactId] = refs;
  }
  if (Object.keys(artifactInputFlow).length === 0) {
    for (const a of artifacts) {
      const refs = (a.requiredInputs ?? []).filter((id) => fieldIds.has(id));
      if (refs.length) artifactInputFlow[a.id] = refs;
    }
  }

  const conflicts: ConflictField[] = [];
  const conflictIds = new Set<string>();
  for (const c of conflictsIn) {
    if (!isRecord(c)) continue;
    const fieldId = asString(c.fieldId).trim();
    if (!fieldId || conflictIds.has(fieldId)) continue;
    conflictIds.add(fieldId);
    conflicts.push({
      fieldId,
      label: asString(c.label).trim() || fieldId,
      conflictDescription: asString(c.conflictDescription).trim(),
      conflictingValues: asStringArray(c.conflictingValues),
      requiredResolution: c.requiredResolution !== false,
      usedByArtifacts: asStringArray(c.usedByArtifacts),
    });
  }

  const gaps = Array.isArray(raw.gaps)
    ? raw.gaps.map((g) => (isRecord(g) ? asString(g.description).trim() : asString(g).trim())).filter(Boolean)
    : [];

  const planMeta: PhasePlanMeta = {};
  const readiness = asString(nextPhase.readiness).trim().toLowerCase();
  if (READINESS_LEVELS.has(readiness)) planMeta.readiness = readiness as PhasePlanMeta["readiness"];
  if (asString(nextPhase.rationale).trim()) planMeta.rationale = asString(nextPhase.rationale).trim();
  if (asString(nextPhase.purpose).trim()) planMeta.purpose = asString(nextPhase.purpose).trim();
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (Object.keys(summaryIn).length) {
    planMeta.validationSummary = {
      inputCount: num(summaryIn.inputCount),
      artifactCount: num(summaryIn.artifactCount),
      conflictCount: num(summaryIn.conflictCount),
      readyArtifacts: num(summaryIn.readyArtifacts),
      blockedArtifacts: num(summaryIn.blockedArtifacts),
    };
  }

  if (!inputFields.length && !artifacts.length && !conflicts.length) return null;
  return { inputFields, artifacts, artifactInputFlow, conflicts, gaps, planMeta };
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
    ...store,
    inputFields: { ...(store.inputFields ?? {}), [phaseId]: proposal.inputFields },
    artifacts: { ...(store.artifacts ?? {}), [phaseId]: proposal.artifacts },
    artifactInputFlow: { ...(store.artifactInputFlow ?? {}), [phaseId]: proposal.artifactInputFlow },
    conflicts: { ...(store.conflicts ?? {}), [phaseId]: proposal.conflicts },
    gaps: { ...(store.gaps ?? {}), [phaseId]: proposal.gaps },
    planMeta: { ...(store.planMeta ?? {}), [phaseId]: proposal.planMeta },
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
