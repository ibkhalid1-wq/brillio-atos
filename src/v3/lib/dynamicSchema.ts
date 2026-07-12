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
import { ATOS_STANDARD, type GridColumn, type PhaseInputField } from "@/v3/lib/methodology";
import { AGENT_META, AGENT_ID_ALIASES, RETIRED_AGENT_IDS } from "@/v3/lib/agentMeta";
import { FORMAL_ARTIFACT_PHASES } from "@/v3/lib/formalArtifacts";

export type ArtifactGenerationReadiness = "ready" | "needs_input" | "blocked";

/**
 * Canonical producing-agent id for a (possibly phase-prefixed) dynamic artifact.
 *
 * The planner occasionally names a dynamic artifact with a phase prefix
 * (e.g. "mobilise-narrative") even though its producing agent is the bare id
 * ("narrative"). Both the artifact ledger (run-agent writes the node keyed by the
 * agent id) and the run-agent endpoint's VALID_AGENT_IDS check key off the bare
 * producing-agent id — so a phase-prefixed id never matches a generated artifact
 * and "Generate"/"Improve quality" 400 with `Unknown agentId`. Strip a leading
 * phase descriptor only when the remainder is a real producing agent (AGENT_META
 * is the registry of those) or a known alias; genuinely hyphenated agent ids
 * ("gate-review", "raci-matrix") return at the top before any stripping, so they
 * are never mangled.
 */
export function canonicalArtifactId(phaseId: string, id: string): string {
  if (AGENT_META[id]) return id;
  if (AGENT_ID_ALIASES[id]) return AGENT_ID_ALIASES[id];
  // Any planner-invented narrative variant ("current-state-narrative",
  // "future-state-narrative", …) is the single program-level narrative agent.
  // Folding them to "narrative" lets dynamicArtifactDefs drop them via its one
  // exclusion, instead of each slipping through as an unresolvable phase
  // deliverable whose Generate 400s with `Unknown agentId`.
  if (/(^|-)narrative$/.test(id)) return "narrative";
  const resolve = (base: string): string | null =>
    AGENT_META[base] ? base : AGENT_ID_ALIASES[base] ?? null;
  // Try the canonical "<phaseId>-" prefix first, then fall back to stripping the
  // first hyphen segment so a British or otherwise-spelled phase descriptor the
  // planner invents ("mobilisation-narrative" when the phase id is "mobilise")
  // still resolves to its producing agent.
  const prefix = `${phaseId}-`;
  if (id.startsWith(prefix)) {
    const hit = resolve(id.slice(prefix.length));
    if (hit) return hit;
  }
  const hyphen = id.indexOf("-");
  if (hyphen > 0) {
    const hit = resolve(id.slice(hyphen + 1));
    if (hit) return hit;
  }
  return id;
}

/**
 * Which agent actually produces a given phase artifact.
 *
 * Named deliverables (charter, raci-matrix, future-state-design, …) each have a
 * dedicated producing agent in AGENT_META, so the artifact's own canonical id is
 * the agent to run. But the planner also invents *custom* phase artifacts
 * (scope-map, routing-policy, …) that have no per-artifact agent — those are
 * produced by the phase agent's generic branch, whose agentId is the phase id.
 * Passing the bare custom artifact id as the agentId 400s with `Unknown agentId`;
 * routing to the phase id is what makes their Generate work. Callers that target
 * the phase agent should also tell it which single artifact to emit (by id/label)
 * so the generic output lands in the right ledger slot.
 *
 * A retired agent (RETIRED_AGENT_IDS) is treated as if it had no generator: its
 * artifact (e.g. a planner-emitted "critical-path") routes to the generic phase
 * agent instead. Otherwise the Generate button would dispatch a dead agent id
 * that the run-agent guard silently drops, making the click a no-op.
 */
export function artifactGeneratorAgentId(phaseId: string, artifactId: string): string {
  const canonical = canonicalArtifactId(phaseId, artifactId);
  return AGENT_META[canonical] && !RETIRED_AGENT_IDS.has(canonical) ? canonical : phaseId;
}

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
  /** Deterministic guardrail warnings (e.g. an artifact-like field was demoted). */
  warnings?: string[];
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

/**
 * A persisted dynamic `grid` field with no usable columns cannot render: every
 * row would have no cells (only a remove button), and because `rowHasContent`
 * is false for a column-less row, any imported value is silently dropped to `[]`
 * on the next save. Coerce such a field to a `textarea` so the captured value
 * survives and stays editable. Defensive at the read boundary so it also repairs
 * schemas persisted before the planner carried grid columns through.
 */
function normalizeDynamicField(field: PhaseInputField): PhaseInputField {
  if (field.type === "grid" && !(field.columns && field.columns.length > 0)) {
    const { columns: _columns, minRows: _minRows, ...rest } = field;
    return { ...rest, type: "textarea" };
  }
  return field;
}

/**
 * Person-role nouns that mark a "Named <role>" field as an owner assignment
 * (RACI), not an answerable fact. These people are captured once in the Mobilise
 * core-team roster; re-asking for them on a later phase just duplicates the
 * roster. The guardrail below drops such planner-proposed fields so owners
 * resolve from the roster instead of being re-typed each phase.
 */
const ROSTER_OWNER_ROLE_WORDS = new Set([
  "lead", "owner", "architect", "manager", "sponsor", "director", "head",
  "analyst", "engineer", "specialist", "coordinator", "champion", "officer", "sme",
  // Generic staffing nouns: "Named individuals per core team role", "Named
  // roster for Build phase" — these re-ask for the roster wholesale, not a
  // specific role, but are still pure owner assignments.
  "role", "roles", "roster", "team", "staff", "personnel",
  "individual", "individuals", "resource", "resources", "member", "members",
]);

/**
 * True when a label names a roster-resolved owner — it starts with "Named " and
 * mentions a person-role noun (e.g. "Named QA/Test Lead for Design phase",
 * "Named owner for critical path"). Requiring the "Named " prefix keeps atomic
 * facts that merely contain a role word ("Workstream owners", "Confirmed
 * delivery lead") as inputs.
 */
export function isRosterOwnerLabel(label: string): boolean {
  const lower = label.trim().toLowerCase();
  if (!lower.startsWith("named ")) return false;
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => ROSTER_OWNER_ROLE_WORDS.has(w));
}

/**
 * The inherited programme fundamental a field captures — currently the in-scope
 * and out-of-scope lists. These are PROGRAMME FUNDAMENTALS (see the Phase
 * Transition Planner prompt): established once and inherited by every phase, never
 * re-requested. Each phase's static methodology schema already owns the scope
 * lists as required inputs, but the planner sometimes mints a dynamic "Confirm
 * in/out-of-scope items" twin anyway (a different id, e.g. `scopeExclusionsConfirmed`,
 * so it slips past the id-collision dedupe). Mapping both the static field and the
 * dynamic twin to the same fundamental key lets the merge drop the duplicate.
 * Out-of-scope is tested first because its phrasing also contains "scope".
 */
type InheritedFundamental = "scope-in" | "scope-out";
function inheritedFundamentalKey(id: string, label?: string): InheritedFundamental | null {
  const hay = `${id} ${label ?? ""}`.toLowerCase();
  if (/out[- ]?of[- ]?scope|scope\s*exclusion/.test(hay)) return "scope-out";
  if (/in[- ]?scope|scope\s*inclusion/.test(hay)) return "scope-in";
  return null;
}

/**
 * Merge static + dynamic input fields for a phase. Static fields keep their
 * order and win on id collision; dynamic fields are appended in declared order
 * and tagged `source: "ai-derived"` if not already. Two classes of planner-
 * proposed field are dropped so they never render or gate generation:
 *  - Roster-owner staffing fields — owners resolve from the Mobilise roster.
 *  - Inherited-fundamental duplicates — a dynamic "Confirm in/out-of-scope items"
 *    twin of a scope list the phase's static schema already captures. Dropping it
 *    here (the single chokepoint every consumer reads through) means
 *    `getFillableArtifactInputFields` also excludes it, so an artifact wired to the
 *    twin (e.g. a Discover scope-agreement) is no longer blocked behind a
 *    redundant, often un-prefilled confirmation the user already answered via the
 *    static scope grid.
 */
export function mergeDynamicInputFields(
  staticFields: PhaseInputField[],
  phaseId: string,
  store?: DynamicSchemaStore,
): PhaseInputField[] {
  const dynamic = store?.inputFields?.[phaseId];
  if (!Array.isArray(dynamic) || dynamic.length === 0) return staticFields;
  const seen = new Set(staticFields.map((f) => f.id));
  // Fundamentals the static schema already covers — a dynamic twin of one of
  // these is pure duplication and is dropped below.
  const staticFundamentals = new Set<InheritedFundamental>();
  for (const f of staticFields) {
    const key = inheritedFundamentalKey(f.id, f.label);
    if (key) staticFundamentals.add(key);
  }
  const extra = dynamic
    .filter((f) => {
      if (!f || typeof f.id !== "string" || seen.has(f.id)) return false;
      if (typeof f.label === "string" && isRosterOwnerLabel(f.label)) return false;
      const fundamental = inheritedFundamentalKey(f.id, typeof f.label === "string" ? f.label : "");
      if (fundamental && staticFundamentals.has(fundamental)) return false;
      return true;
    })
    .map((f) => normalizeDynamicField({ ...f, source: "ai-derived" as const }));
  return extra.length ? [...staticFields, ...extra] : staticFields;
}

const ARTIFACT_READINESS = new Set(["ready", "needs_input", "blocked"]);

/** Dynamic artifact ids declared for a phase (deduped, valid). */
export function dynamicArtifactDefs(phaseId: string, store?: DynamicSchemaStore): DynamicArtifactDef[] {
  const defs = store?.artifacts?.[phaseId];
  if (!Array.isArray(defs)) return [];
  const seen = new Set<string>();
  // A phase's STATIC contract artifacts (methodology.requiredArtifacts) are merged
  // with these dynamic defs by every consumer (readiness completeness, schedule,
  // artifact model). If the planner also proposes one dynamically, the id would
  // appear in both halves of that merge and be double-counted. Drop the dynamic
  // duplicate here — the single chokepoint — so the static contract entry wins.
  const staticRequired = new Set(
    ATOS_STANDARD.phases.find((p) => p.id === phaseId)?.requiredArtifacts ?? [],
  );
  const out: DynamicArtifactDef[] = [];
  for (const def of defs) {
    if (!def || typeof def.id !== "string") continue;
    const id = canonicalArtifactId(phaseId, def.id);
    // Narrative is a program-level briefing, not a phase deliverable: the agent
    // stores a single program narrative, never a phaseArtifacts stub, so a
    // planner-proposed "phase narrative" can never be satisfied and would sit
    // permanently "Missing". Drop it here — the one chokepoint every phase
    // artifact consumer reads through — so it never appears in any phase list.
    if (id === "narrative") continue;
    // A canonical formal artifact (charter, raci-matrix, governance-model, …) is
    // owned by exactly one phase and writes a single shared top-level field key.
    // The planner sometimes re-proposes one on a later phase ("Build Phase RACI
    // Matrix"), which both duplicates the home-phase deliverable and would, on
    // generation, overwrite that home-phase document. Drop it on any phase but
    // its own so formal artifacts stay pinned to their methodology home.
    const homePhase = FORMAL_ARTIFACT_PHASES[id];
    if (homePhase && homePhase !== phaseId) continue;
    // Already a static contract artifact for this phase — the merge would double
    // it. The static entry is authoritative, so drop the dynamic duplicate.
    if (staticRequired.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry: DynamicArtifactDef = { id, label: def.label || id, description: def.description || "" };
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

const ALLOWED_FIELD_TYPES = new Set([
  "text", "textarea", "number", "date", "select", "grid",
  // Semantic reference types — persist as a string, render as a context picker.
  // "transcript" additionally accepts pasted conversation text as the value.
  "stakeholder", "organization", "document", "artifact-reference", "transcript",
]);

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

const GRID_COLUMN_TYPES = new Set(["text", "number", "select"]);

/**
 * Validate the planner's `columns` for a `grid` field into well-formed
 * `GridColumn`s. Columns are untrusted AI output, so each is shape-checked and
 * anything without a usable `key` is dropped; duplicate keys collapse to the
 * first. A grid that yields no valid column here is unusable and is coerced to a
 * textarea by the caller.
 */
function sanitizeGridColumns(raw: unknown): GridColumn[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GridColumn[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const key = asString(c.key).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const col: GridColumn = { key, label: asString(c.label).trim() || key };
    const type = asString(c.type).trim();
    if (GRID_COLUMN_TYPES.has(type)) col.type = type as GridColumn["type"];
    const options = asStringArray(c.options);
    if (options.length) col.options = options;
    if (asString(c.placeholder).trim()) col.placeholder = asString(c.placeholder).trim();
    const width = Number(c.width);
    if (Number.isFinite(width) && width > 0) col.width = Math.floor(width);
    out.push(col);
  }
  return out;
}

/**
 * Words that signal a label names a deliverable (artifact) rather than an atomic
 * fact the user can answer. The Phase Transition Planner must put these in
 * `artifactsToGenerate`, never in `inputFields` — users supply facts; ATOS
 * generates artifacts. The guardrail below repairs violations deterministically
 * so a misbehaving model can never present "Mobilization Plan" as something to
 * type in.
 */
const ARTIFACT_LIKE_WORDS = new Set([
  "plan", "summary", "report", "register", "map", "model", "deck",
  "brief", "pack", "roadmap", "assessment", "design", "artifact",
]);

/**
 * True when a label names a deliverable. We test the HEAD noun (the last
 * alphabetic word) rather than any word, so "Mobilization Plan" / "Stakeholder
 * Map" / "Governance Model" are caught while atomic facts that merely mention a
 * term ("Model routing", "Operating model owner") are not.
 */
export function isArtifactLikeLabel(label: string): boolean {
  const words = label.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const head = words[words.length - 1];
  return head ? ARTIFACT_LIKE_WORDS.has(head) : false;
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

  // Artifact-like input labels the guardrail demoted into artifactsToGenerate.
  const promotedArtifacts: DynamicArtifactDef[] = [];
  const guardrailWarnings: string[] = [];

  const fieldIds = new Set<string>();
  const inputFields: PhaseInputField[] = [];
  for (const f of fieldsIn) {
    if (!isRecord(f)) continue;
    const id = (asString(f.fieldId) || asString(f.id)).trim();
    const type = asString(f.type).trim();
    if (!id || fieldIds.has(id) || !ALLOWED_FIELD_TYPES.has(type)) continue;
    const label = asString(f.label).trim() || id;
    // Guardrail: a "Named <role>" owner assignment is captured once in the
    // Mobilise roster — drop it rather than re-ask for it on this phase.
    if (isRosterOwnerLabel(label)) {
      guardrailWarnings.push(`Dropped roster-owner input "${label}" — owners resolve from the Mobilise roster.`);
      continue;
    }
    // Guardrail: a field whose label names a deliverable is not an answerable
    // fact. Demote it to an artifact rather than asking the user to type it.
    if (isArtifactLikeLabel(label)) {
      promotedArtifacts.push({
        id,
        label,
        description: asString(f.description).trim() || asString(f.hint).trim(),
      });
      guardrailWarnings.push(`Demoted artifact-like input "${label}" to artifactsToGenerate.`);
      continue;
    }
    fieldIds.add(id);
    const field: PhaseInputField = {
      id,
      label,
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
    // A grid needs columns to render its rows. Carry the planner's columns
    // through when valid; a column-less grid is unusable, so demote it to a
    // textarea (matching the read-boundary guard) rather than ship empty rows.
    if (field.type === "grid") {
      const columns = sanitizeGridColumns(f.columns);
      if (columns.length) {
        field.columns = columns;
        const minRows = Number(f.minRows);
        if (Number.isFinite(minRows) && minRows > 0) field.minRows = Math.floor(minRows);
      } else {
        field.type = "textarea";
        guardrailWarnings.push(`Demoted column-less grid "${label}" to a textarea.`);
      }
    }
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

  // Fold in any artifact-like input fields the guardrail demoted, unless the
  // planner already declared an artifact with that id or an equivalent label.
  const artifactLabels = new Set(artifacts.map((a) => a.label.trim().toLowerCase()));
  for (const promoted of promotedArtifacts) {
    if (artifactIds.has(promoted.id) || artifactLabels.has(promoted.label.trim().toLowerCase())) continue;
    artifactIds.add(promoted.id);
    artifactLabels.add(promoted.label.trim().toLowerCase());
    artifacts.push(promoted);
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
  // Surface deterministic guardrail repairs (alongside any planner-supplied warnings).
  const plannerWarnings = asStringArray(summaryIn.warnings);
  const warnings = [...plannerWarnings, ...guardrailWarnings];
  if (warnings.length) planMeta.warnings = warnings;

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
    // Canonicalise so a flow keyed by a phase-prefixed id ("mobilise-narrative")
    // still targets the artifact under its producing-agent id, matching the
    // normalised id getPhaseArtifactDefs emits — otherwise the edge is dropped.
    const canonicalId = canonicalArtifactId(phaseId, artifactId);
    for (const fieldId of fieldIds) {
      if (typeof fieldId !== "string") continue;
      (inverted[fieldId] ??= []).push(canonicalId);
    }
  }
  return inverted;
}
