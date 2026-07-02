import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary, Workstream } from "@/new/types";
import { getPhaseInputSchema, resolveRosterField, type GridColumn } from "@/v3/lib/phaseInputSchema";
import { rosterColumnKeys, sortRosterRowsBySeniority } from "@/v3/lib/rosterRaci";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { availableModes, FIELD_ASSIST_MODE_LABEL, type FieldAssistMode } from "@/v3/lib/fieldAssist";
import { prioritizePhaseFields } from "@/v3/lib/phaseInputPriority";
import { projectArchitectureDecisions } from "@/v3/lib/designDecisions";
import { projectCharterInScope, projectCharterOutOfScope } from "@/v3/lib/scopeDrafts";
import { preserveUntouchedGrids } from "@/v3/lib/gridSaveGuard";
import StructuredGrid, { type GridRow, parseRows, serializeRows, filledRowCount, isLegacyFreeTextGridValue, mergeGridDraft } from "@/v3/components/StructuredGrid";
import { V3Select, V3Combobox } from "@/v3/components/ui/V3Dropdown";
import AutoGrowTextarea from "@/v3/components/ui/AutoGrowTextarea";
import { PROVENANCE_KEY, parseProvenance, provenanceMatches, type FieldProvenance } from "@/new/lib/fieldProvenance";
import { EXTRACTION_TYPE_COLORS, EXTRACTION_TYPE_LABELS, confidenceLabel } from "@/new/lib/documentIntelligenceTypes";

export interface FieldAssistRequest {
  fieldId: string;
  fieldLabel: string;
  fieldHint?: string;
  mode: FieldAssistMode;
  currentValue: string;
  /** For `merge` mode: the new value to reconcile with currentValue. */
  incomingValue?: string;
  /** Reviewer suggestions to fold into this field (used by "Improve quality" apply). */
  guidance?: string;
}

interface PhaseInputsPanelProps {
  program: ProgramSummary;
  phaseId: string;
  onSave: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void>;
  /** Optional AI assist for a single field; resolves with the new field text. */
  onAssistField?: (phaseId: string, request: FieldAssistRequest) => Promise<string>;
  /**
   * Emits the live (unsaved) input snapshot on every edit, in the same shape
   * `onSave` would persist. Lets the surface recompute input-quality / readiness
   * / flow-line metrics from in-progress edits instead of waiting for an explicit
   * save. Read-only consumers only — the panel itself keeps using the persisted
   * `program`, so this never re-syncs the edit buffer (which would steal focus).
   */
  onValuesChange?: (phaseId: string, inputs: Record<string, string>) => void;
  /** When the phase gate is approved the inputs are frozen: read-only, no save. */
  locked?: boolean;
  /** Optional action rendered in the header card, beside the title. */
  headerAction?: React.ReactNode;
}

/**
 * Companion phaseInput keys that anchor the Primary success metric with a
 * baseline → target → unit, mirroring the Outcome KPIs grid. Persisted as
 * plain strings alongside `successMetric`.
 */
const SUCCESS_METRIC_ANCHOR_KEYS = ["successMetricBaseline", "successMetricTarget", "successMetricUnit"] as const;

/**
 * Content signature over the *managed* input keys (schema fields plus the special
 * KPI / workstream / success-metric-anchor keys), ignoring metadata like savedAt
 * and provenance. The resync effect uses it to tell our own debounced auto-save
 * echo (signature matches what we just persisted) from an external write — e.g. a
 * document import landing KPIs in phaseInputs.kpis. Only the former should block
 * the resync; an external change must always be adopted, otherwise the stale edit
 * buffer hides it and the next auto-save clobbers it.
 */
export function managedInputSignature(src: Record<string, unknown>, fields: { id: string }[]): string {
  const read = (key: string) => (typeof src[key] === "string" ? (src[key] as string) : "");
  const parts = fields.map((field) => `${field.id}=${read(field.id)}`);
  for (const key of ["kpis", "workstreams", "kpiActuals", ...SUCCESS_METRIC_ANCHOR_KEYS]) {
    parts.push(`${key}=${read(key)}`);
  }
  return parts.join("\u0001");
}

/**
 * Three-way merge for the string-keyed edit buffer when an external write lands
 * while the buffer is dirty. `base` is the snapshot the buffer was last synced
 * from; `ours` is the live buffer; `theirs` is the incoming persisted state.
 * Any key the user changed since `base` keeps the user's value; every other key
 * adopts the incoming value — so an external write to one field never discards
 * unsaved edits to a different field.
 */
export function mergeDirtyValues(
  base: Record<string, string>,
  ours: Record<string, string>,
  theirs: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...theirs };
  for (const key of new Set([...Object.keys(ours), ...Object.keys(base)])) {
    if ((ours[key] ?? "") !== (base[key] ?? "")) merged[key] = ours[key];
  }
  return merged;
}

/**
 * Structured baseline/target KPI captured at Strategy. Persisted as a JSON
 * string under phaseInputs.strategy.kpis so the benefits-tracker agent can
 * measure realisation against a human-entered baseline — closing the
 * Inputs → Outcomes traceability loop.
 */
interface PhaseKpi {
  id: string;
  name: string;
  baseline: string;
  target: string;
  unit: string;
}

function parseKpis(raw: unknown): PhaseKpi[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : `kpi-${Math.random().toString(36).slice(2, 9)}`,
        name: typeof entry.name === "string" ? entry.name : "",
        baseline: typeof entry.baseline === "string" ? entry.baseline : String(entry.baseline ?? ""),
        target: typeof entry.target === "string" ? entry.target : String(entry.target ?? ""),
        unit: typeof entry.unit === "string" ? entry.unit : "",
      }));
  } catch {
    return [];
  }
}

/**
 * Parses persisted KPI actuals into a map keyed by KPI id. Actuals are the
 * human-entered *measured* value captured at Value Realize, completing the
 * baseline → target → actual record so the Benefits Tracker reports realisation
 * against real numbers instead of estimating. Persisted as a JSON string under
 * phaseInputs.valuerealize.kpiActuals.
 */
/**
 * Per-field quality verdict shown beside each input. Mirrors the field-quality
 * heuristic in computeInputQualityScore (≈20 words = full quality) so the inline
 * signal a PM sees agrees with the gate readiness score it feeds. Gives an
 * at-a-glance answer to "is this field good enough?" without leaving the screen.
 */
export function assessField(value: string | undefined, type: string): { label: string; tone: "green" | "amber" | "red" | "muted" } {
  const v = (value ?? "").trim();
  if (!v) return { label: "Empty", tone: "muted" };
  if (type === "textarea") {
    const words = v.split(/\s+/).filter(Boolean).length;
    if (words < 8) return { label: "Brief", tone: "red" };
    if (words < 20) return { label: "Fair", tone: "amber" };
    return { label: "Complete", tone: "green" };
  }
  return { label: "Complete", tone: "green" };
}

/**
 * Compact source-provenance badge shown beside an imported field. A coloured dot
 * encodes the extraction type (extracted/enriched/inferred) and the confidence
 * label sits next to it; the source quote is in the title tooltip. Keeps the
 * traceability the document importer captured visible at the point of use,
 * without crowding the field row.
 */
function ProvenanceChip({ prov }: { prov: FieldProvenance }) {
  const conf = confidenceLabel(prov.confidence);
  const typeLabel = EXTRACTION_TYPE_LABELS[prov.extractionType];
  const title = prov.source
    ? `${typeLabel} from import · ${conf.label} confidence\nSource: "${prov.source}"`
    : `${typeLabel} from import · ${conf.label} confidence`;
  return (
    <span
      className="v3-chip"
      title={title}
      style={{ fontSize: 9, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: EXTRACTION_TYPE_COLORS[prov.extractionType],
          display: "inline-block",
        }}
      />
      {typeLabel}
    </span>
  );
}

/** Human-readable "last updated" for the phase inputs, from the persisted savedAt. */
function freshnessLabel(savedAt: unknown): string | null {
  if (typeof savedAt !== "string" || !savedAt.trim()) return null;
  const ts = new Date(savedAt).getTime();
  if (Number.isNaN(ts)) return null;
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "Updated just now";
  if (diff < 3600) return `Updated ${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `Updated ${Math.floor(diff / 3600)}h ago`;
  return `Updated ${Math.floor(diff / 86_400)}d ago`;
}

function parseKpiActuals(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string") {
        const record = entry as Record<string, unknown>;
        map[record.id as string] = typeof record.actual === "string" ? record.actual : String(record.actual ?? "");
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Workstreams for a phase: prefer the persisted bucket, else the program-level list. */
function workstreamsFromBucket(
  bucket: Record<string, unknown>,
  programWorkstreams: Workstream[] | undefined,
  phaseId: string,
): Workstream[] {
  if (Array.isArray(bucket.workstreams)) {
    return (bucket.workstreams as unknown[]).filter(
      (entry): entry is Workstream => typeof entry === "object" && entry !== null,
    );
  }
  return Array.isArray(programWorkstreams)
    ? programWorkstreams.filter((entry) => entry.phaseId === phaseId)
    : [];
}

export default function PhaseInputsPanel({ program, phaseId, onSave, onAssistField, onValuesChange, locked = false, headerAction }: PhaseInputsPanelProps) {
  // Merge any ai-derived dynamic fields for this phase on top of the static
  // methodology schema, so planner-proposed inputs render in this panel.
  const dynamicStore = useMemo(() => getDynamicSchemaStore(program.rawData), [program.rawData]);
  const schema = useMemo(() => getPhaseInputSchema(phaseId, dynamicStore), [phaseId, dynamicStore]);
  // Canonical roster field + its role column, resolved early so the grid-state
  // initializer/resync can present the roster ordered top-down by seniority at
  // *display* time only — never reshuffled while a role is being typed.
  const rosterField = useMemo(() => resolveRosterField(dynamicStore), [dynamicStore]);
  const rosterRoleKey = useMemo(
    () => (rosterField ? rosterColumnKeys(rosterField.columns ?? []).roleKey : undefined),
    [rosterField],
  );
  // Parse a grid field's persisted value into rows, applying the seniority order
  // to the roster field only. Used at load/resync so a saved roster reads
  // most-senior-first when the panel next renders, without touching row order
  // during editing (onChange writes rows verbatim).
  const parseGridRowsForDisplay = React.useCallback(
    (field: { id: string; columns?: GridColumn[] }, raw: unknown): GridRow[] => {
      const rows = parseRows(raw, field.columns ?? []);
      return rosterField && field.id === rosterField.id && rosterRoleKey
        ? sortRosterRowsBySeniority(rows, rosterRoleKey)
        : rows;
    },
    [rosterField, rosterRoleKey],
  );
  // useMemo prevents a new object reference on every render, which would cause an
  // infinite loop: new existingInputs reference → useEffect fires → setValues → re-render → repeat.
  const existingInputs = useMemo(() => {
    const raw = program.rawData as Record<string, unknown>;
    const source = raw && typeof raw.data === "object" && raw.data !== null
      ? raw.data as Record<string, unknown>
      : raw ?? {};
    const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
      ? source.phaseInputs as Record<string, Record<string, string>>
      : {};
    const bucket = phaseInputs[phaseId] ?? {};
    // An empty grid serializes to "[]". When a field is no longer a grid (e.g. a
    // column-less grid coerced to a textarea), that orphaned "[]" would render as
    // literal text — normalize the canonical empty-array string to "". Safe for
    // real grids too: parseRows treats "" and "[]" identically. Copy only when a
    // rewrite is needed so unchanged buckets keep their reference (resync guard).
    let normalized: Record<string, string> | null = null;
    for (const key in bucket) {
      if (bucket[key] === "[]") (normalized ??= { ...bucket })[key] = "";
    }
    return normalized ?? bucket;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.rawData, phaseId]);

  // Per-field source provenance recorded by the document importer. Keyed by
  // fieldId; a field's badge only renders while its live value still matches the
  // imported snapshot (see render below), so hand-edits drop the badge.
  const provenance = useMemo(
    () => parseProvenance((existingInputs as Record<string, unknown>)[PROVENANCE_KEY]),
    [existingInputs],
  );

  // KPI *definitions* always live at Strategy (baseline → target). At Value
  // Realize we read them here so the user records actuals against the same KPIs
  // they defined — never re-entering definitions. This is the bridge that closes
  // the Inputs(KPI) → Outcomes(realisation) loop.
  const strategyKpiDefs = useMemo(() => {
    const raw = program.rawData as Record<string, unknown>;
    const source = raw && typeof raw.data === "object" && raw.data !== null
      ? raw.data as Record<string, unknown>
      : raw ?? {};
    const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
      ? source.phaseInputs as Record<string, Record<string, string>>
      : {};
    return parseKpis((phaseInputs.strategy ?? {}).kpis);
  }, [program.rawData]);

  // Grid drafts projected from an upstream formal artifact, keyed by the grid
  // field id they pre-fill. An agent already emitted the content elsewhere, so we
  // surface it as a review banner over the (empty) grid — the human curates a
  // pre-filled draft instead of typing a blank table. Read-only: nothing persists
  // until the user adopts a draft and the grid is saved.
  //   - Design › keyDesignDecisions ← Solution Architecture agent's decisions
  //   - Discover › scopeInclusions / scopeExclusions ← Transformation Charter scope
  const gridDrafts = useMemo<Record<string, { rows: Array<Record<string, string>>; sourceLabel: string; noun: string }>>(() => {
    const drafts: Record<string, { rows: Array<Record<string, string>>; sourceLabel: string; noun: string }> = {};
    if (phaseId === "design") {
      const rows = projectArchitectureDecisions(program.rawData);
      if (rows.length) drafts.keyDesignDecisions = { rows, sourceLabel: "Solution Architecture agent", noun: "decision" };
    } else if (phaseId === "discover") {
      const inScope = projectCharterInScope(program.rawData);
      if (inScope.length) drafts.scopeInclusions = { rows: inScope, sourceLabel: "Transformation Charter", noun: "in-scope item" };
      const outOfScope = projectCharterOutOfScope(program.rawData);
      if (outOfScope.length) drafts.scopeExclusions = { rows: outOfScope, sourceLabel: "Transformation Charter", noun: "out-of-scope item" };
    }
    return drafts;
  }, [program.rawData, phaseId]);

  // Re-sync the local edit buffer from props only when the *persisted content*
  // actually changes — not on every new program.rawData reference. Background
  // refreshes (Supabase Realtime echoes, agent-run polling) hand us a fresh
  // rawData object with identical content; keying the reset effect on object
  // identity reset the buffer mid-keystroke and stole focus. This only surfaced
  // in the live app, where realtime traffic drives those no-op refreshes.
  const existingInputsKey = useMemo(
    () => `${JSON.stringify(existingInputs)}|${JSON.stringify(program.workstreams ?? [])}`,
    [existingInputs, program.workstreams],
  );

  // Initialize every managed buffer from the persisted inputs — same as `values`.
  // Starting these at empty created a window where a freshly-mounted panel looked
  // "dirty" (empty buffer) against non-empty persisted content, so the debounced
  // auto-save could clobber an external write (e.g. a document import that just
  // populated kpis) with an empty array before the resync effect adopted it.
  const [values, setValues] = useState<Record<string, string>>(existingInputs);
  const [localWorkstreams, setLocalWorkstreams] = useState<Workstream[]>(
    () => workstreamsFromBucket(existingInputs as Record<string, unknown>, program.workstreams, phaseId),
  );
  const [localKpis, setLocalKpis] = useState<PhaseKpi[]>(
    () => parseKpis((existingInputs as Record<string, unknown>).kpis),
  );
  // Map of KPI id → human-entered actual value (Value Realize only).
  const [localActuals, setLocalActuals] = useState<Record<string, string>>(
    () => parseKpiActuals((existingInputs as Record<string, unknown>).kpiActuals),
  );
  // Structured grid fields (e.g. key roles), keyed by field id. Persisted as a
  // JSON string under the field id — same convention as KPIs/workstreams.
  const [grids, setGrids] = useState<Record<string, GridRow[]>>(() => {
    const next: Record<string, GridRow[]> = {};
    for (const field of schema.fields) {
      if (field.type === "grid") next[field.id] = parseGridRowsForDisplay(field, (existingInputs as Record<string, unknown>)[field.id]);
    }
    return next;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Always start expanded so document-imported data is immediately visible
  const [open, setOpen] = useState(true);
  // Per-field AI assist: which field is currently generating, and any per-field error.
  const [assistingField, setAssistingField] = useState<string | null>(null);
  const [assistErrors, setAssistErrors] = useState<Record<string, string>>({});
  // Lets the user hide a projected-draft banner (per grid field id) without
  // adopting it (e.g. they'd rather type their own).
  const [dismissedDrafts, setDismissedDrafts] = useState<Record<string, boolean>>({});
  // Grid field ids the user has deliberately interacted with this phase (edited a
  // cell, added/removed a row, cleared it, or adopted a projected draft). The
  // auto-save guard restores the persisted value for any *untouched* grid that
  // would otherwise be written empty, so a phantom empty buffer (remount / external
  // -write window) can never clobber real rows — but a deliberate clear always
  // persists. Reset whenever the phase changes, since a different editor is shown.
  const gridsTouchedRef = useRef<Set<string>>(new Set());
  // Debounced auto-save plumbing. `isDirtyRef` lets the persisted-resync effect
  // tell our own save echo (safe to ignore) from an external change (must apply)
  // so it never clobbers in-progress typing. `prevPhaseIdRef` forces a full
  // resync when the phase changes regardless of dirtiness.
  const autoSaveTimerRef = useRef<number | null>(null);
  const isDirtyRef = useRef(false);
  const prevPhaseIdRef = useRef(phaseId);
  // Signature of the inputs this panel last persisted, so the resync effect can
  // recognise our own auto-save echo and not mistake an external write for it.
  const selfSaveSigRef = useRef<string | null>(null);
  // The exact edit a pending debounced save would persist, tagged with the phase
  // and field set it belongs to. Lets us flush that save when the panel is about
  // to leave the phase (phase switch or unmount) instead of dropping it — without
  // this, edits made within the 800ms debounce window are silently lost when the
  // resync resets the buffer to the new phase and the timer is cleared. Captured
  // from the *leaving* render, so it carries the old phase even though `values`
  // (and so `liveSnapshot`) lag a render behind a phase change.
  const pendingFlushRef = useRef<{ phaseId: string; snapshot: Record<string, string>; fields: { id: string }[] } | null>(null);
  // Latest onSave / locked, read by the flush cleanup without re-arming it.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // The persisted snapshot the edit buffer was last synced from. Acts as the
  // merge base for a three-way merge when an *external* write lands while the
  // buffer is dirty: fields the user changed since this base are kept, all other
  // fields adopt the incoming value. Without this, a wholesale reset on every
  // external write (apply-improvements, regenerate echoes) wiped unsaved edits
  // to fields the external write never touched.
  const baseInputsRef = useRef<Record<string, unknown>>(existingInputs);

  async function runAssist(field: { id: string; label: string; hint?: string }, mode: FieldAssistMode) {
    if (!onAssistField || assistingField) return;
    setAssistingField(field.id);
    setAssistErrors((current) => {
      const next = { ...current };
      delete next[field.id];
      return next;
    });
    try {
      const text = await onAssistField(phaseId, {
        fieldId: field.id,
        fieldLabel: field.label,
        fieldHint: field.hint,
        mode,
        currentValue: values[field.id] ?? "",
      });
      const clean = (text ?? "").trim();
      if (clean) {
        setValues((current) => ({ ...current, [field.id]: clean }));
      } else {
        setAssistErrors((current) => ({ ...current, [field.id]: "No suggestion returned." }));
      }
    } catch (error) {
      setAssistErrors((current) => ({
        ...current,
        [field.id]: error instanceof Error ? error.message : "AI assist failed.",
      }));
    } finally {
      setAssistingField(null);
    }
  }

  useEffect(() => {
    // Resync the edit buffer from persisted props. With auto-save on, our own
    // saves echo back a fresh `existingInputs`; if the user has kept typing, that
    // echo is *older* than the buffer, so blindly resetting would drop keystrokes
    // and steal focus. Skip the reset on a same-phase echo while the buffer is
    // dirty; always resync when the phase itself changed (a different editor).
    const phaseChanged = prevPhaseIdRef.current !== phaseId;
    prevPhaseIdRef.current = phaseId;
    // A phase switch shows a different editor, so grid-interaction history from the
    // leaving phase no longer applies to the incoming (freshly-resynced) buffers.
    if (phaseChanged) gridsTouchedRef.current = new Set();
    // Block the resync only for our *own* save echo while the buffer is dirty —
    // that's the focus-steal case the guard exists for. An external write (e.g. a
    // document import populating phaseInputs.kpis) carries a different signature
    // and must be adopted, even when the stale buffer looks "dirty" against it.
    const incomingSig = managedInputSignature(existingInputs as Record<string, unknown>, schema.fields);
    const isOwnSaveEcho = selfSaveSigRef.current !== null && incomingSig === selfSaveSigRef.current;
    // Own-save echo while dirty: the buffer already holds this state, so don't
    // reset (focus-steal). But advance the merge base to what we just persisted,
    // so a *later* external write diffs against current state, not a stale base.
    if (!phaseChanged && isDirtyRef.current && isOwnSaveEcho) {
      baseInputsRef.current = existingInputs;
      return;
    }

    // Decide before overwriting the base: merge only when an external write lands
    // mid-edit on the same phase. A phase switch is a different editor (the
    // leaving phase's pending edit is flushed separately), and a clean buffer has
    // nothing to protect — both take the wholesale resync below.
    const base = baseInputsRef.current;
    const shouldMerge = !phaseChanged && isDirtyRef.current;
    baseInputsRef.current = existingInputs;

    const workstreamsFrom = (bucket: Record<string, unknown>): Workstream[] =>
      workstreamsFromBucket(bucket, program.workstreams, phaseId);

    if (shouldMerge) {
      // Three-way merge per category: keep the user's value for any field changed
      // since `base`, otherwise adopt the incoming (`existingInputs`) value.
      setValues((ours) => mergeDirtyValues(base as Record<string, string>, ours, existingInputs as Record<string, string>));
      setGrids((ours) => {
        const next: Record<string, GridRow[]> = {};
        for (const field of schema.fields) {
          if (field.type !== "grid") continue;
          const cols = field.columns ?? [];
          const ourRows = ours[field.id] ?? [];
          // Compare against the display-ordered base so a pure presentational
          // reorder (roster seniority sort) never reads as a user edit here.
          const baseSer = serializeRows(parseGridRowsForDisplay(field, (base as Record<string, unknown>)[field.id]), cols);
          next[field.id] = serializeRows(ourRows, cols) !== baseSer
            ? ourRows
            : parseGridRowsForDisplay(field, (existingInputs as Record<string, unknown>)[field.id]);
        }
        return next;
      });
      setLocalWorkstreams((ours) =>
        JSON.stringify(ours) !== JSON.stringify(workstreamsFrom(base as Record<string, unknown>))
          ? ours
          : workstreamsFrom(existingInputs as Record<string, unknown>));
      setLocalKpis((ours) =>
        JSON.stringify(ours) !== JSON.stringify(parseKpis((base as Record<string, unknown>).kpis))
          ? ours
          : parseKpis((existingInputs as Record<string, unknown>).kpis));
      setLocalActuals((ours) =>
        JSON.stringify(ours) !== JSON.stringify(parseKpiActuals((base as Record<string, unknown>).kpiActuals))
          ? ours
          : parseKpiActuals((existingInputs as Record<string, unknown>).kpiActuals));
      return;
    }

    setValues(existingInputs);
    // Only auto-open if there's no data yet (first-time setup)
    if (Object.keys(existingInputs).length === 0) setOpen(true);
    setLocalWorkstreams(workstreamsFrom(existingInputs as Record<string, unknown>));
    setLocalKpis(parseKpis((existingInputs as Record<string, unknown>).kpis));
    setLocalActuals(parseKpiActuals((existingInputs as Record<string, unknown>).kpiActuals));
    const nextGrids: Record<string, GridRow[]> = {};
    for (const field of schema.fields) {
      if (field.type === "grid") nextGrids[field.id] = parseGridRowsForDisplay(field, (existingInputs as Record<string, unknown>)[field.id]);
    }
    setGrids(nextGrids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingInputsKey, phaseId]);

  const showKpis = phaseId === "strategy";
  const showActuals = phaseId === "valuerealize";
  // The Mobilise roster ("Key roles") is the single source of truth for the
  // project team, edited only on Mobilise. It is intentionally NOT echoed as a
  // read-only reference on later phases — governance/value/execution panels act
  // on their own working detail, not staffing — but it still powers the name
  // suggestions below. (rosterField / rosterRoleKey are resolved higher up so the
  // grid-state initializer can present the roster seniority-ordered on load.)
  const mobiliseRoles = useMemo(() => {
    if (!rosterField) return [];
    const raw = program.rawData as Record<string, unknown>;
    const source = raw && typeof raw.data === "object" && raw.data !== null
      ? raw.data as Record<string, unknown>
      : raw ?? {};
    const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
      ? source.phaseInputs as Record<string, Record<string, string>>
      : {};
    return parseRows((phaseInputs.mobilise ?? {})[rosterField.id], rosterField.columns ?? []);
  }, [program.rawData, rosterField]);

  // Context-sourced suggestions for the semantic reference field types
  // (stakeholder / organization / document / artifact-reference). Each persists
  // as a plain string, but renders as a text input backed by a <datalist> drawn
  // from the programme so the captured value is a real, resolvable reference
  // rather than free text. Empty lists degrade gracefully to a plain text input.
  const referenceSuggestions = useMemo<Record<string, string[]>>(() => {
    const dedup = (xs: (string | null | undefined)[]) =>
      Array.from(new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean)));
    const documents = (() => {
      const raw = program.rawData as Record<string, unknown>;
      const data = raw && typeof raw.data === "object" && raw.data !== null
        ? (raw.data as Record<string, unknown>)
        : raw ?? {};
      const list = Array.isArray(data.documents)
        ? data.documents
        : Array.isArray((raw as Record<string, unknown>).documents)
          ? ((raw as Record<string, unknown>).documents as unknown[])
          : [];
      return dedup((list as unknown[]).map((doc) => {
        if (typeof doc === "string") return doc;
        if (doc && typeof doc === "object") {
          const o = doc as Record<string, unknown>;
          const v = o.title ?? o.name ?? o.fileName ?? o.filename;
          return typeof v === "string" ? v : undefined;
        }
        return undefined;
      }));
    })();
    return {
      stakeholder: dedup([
        program.sponsor,
        ...mobiliseRoles.map((row) => row.name),
        ...program.stakeholders.map((s) => (s.role ? `${s.name} — ${s.role}` : s.name)),
      ]),
      organization: dedup([program.client, ...program.stakeholders.map((s) => s.organisation)]),
      document: documents,
      "artifact-reference": dedup(program.artifacts.map((a) => a.title)),
    };
  }, [program.sponsor, program.client, program.stakeholders, program.artifacts, program.rawData, mobiliseRoles]);

  /** Grid-aware "is this field filled?" — counts non-empty rows for grids. */
  const isFieldFilled = (field: { id: string; type: string; columns?: GridColumn[] }): boolean =>
    field.type === "grid"
      ? filledRowCount(grids[field.id] ?? [], field.columns ?? []) > 0
      : !!values[field.id]?.trim();

  const filledCount = schema.fields.filter((field) => isFieldFilled(field)).length;

  // Has the live buffer diverged from the persisted snapshot? Drives the Cancel
  // (revert) affordance so it only enables when there are unsaved edits.
  const isDirty = useMemo(() => {
    for (const field of schema.fields) {
      if (field.type === "grid") {
        // Order the persisted side the same way we display it, so the roster's
        // seniority sort at load is presentational only — it never marks the
        // panel dirty or triggers a phantom auto-save. A genuine content edit
        // still diverges from this baseline and registers as dirty.
        const persisted = serializeRows(parseGridRowsForDisplay(field, (existingInputs as Record<string, unknown>)[field.id]), field.columns ?? []);
        const live = serializeRows(grids[field.id] ?? [], field.columns ?? []);
        if (persisted !== live) return true;
        continue;
      }
      if ((values[field.id] ?? "") !== (((existingInputs as Record<string, unknown>)[field.id] as string) ?? "")) return true;
    }
    const existingWs = Array.isArray(existingInputs.workstreams)
      ? existingInputs.workstreams
      : Array.isArray(program.workstreams)
        ? program.workstreams.filter((entry) => entry.phaseId === phaseId)
        : [];
    if (JSON.stringify(localWorkstreams) !== JSON.stringify(existingWs)) return true;
    if (showKpis) {
      for (const key of SUCCESS_METRIC_ANCHOR_KEYS) {
        if ((values[key] ?? "") !== (((existingInputs as Record<string, unknown>)[key] as string) ?? "")) return true;
      }
    }
    if (showKpis && JSON.stringify(localKpis) !== JSON.stringify(parseKpis((existingInputs as Record<string, unknown>).kpis))) return true;
    if (showActuals && JSON.stringify(localActuals) !== JSON.stringify(parseKpiActuals((existingInputs as Record<string, unknown>).kpiActuals))) return true;
    return false;
  }, [schema.fields, values, existingInputs, localWorkstreams, localKpis, localActuals, grids, program.workstreams, phaseId, showKpis, showActuals, parseGridRowsForDisplay]);
  // Keep the ref in sync so the persisted-resync effect can read the latest
  // dirtiness without taking it as a dependency.
  isDirtyRef.current = isDirty;

  // Gap accounting for the "what's left" banner. We deliberately do NOT use this
  // to reorder the fields: the methodology owns the field sequence (e.g. Strategy
  // shows industry / start / end immediately after the sponsor), and reshuffling
  // by fill-state made just-saved fields appear to "jump" or vanish. So fields
  // render in methodology order and this only powers the summary banner.
  const prioritized = useMemo(
    () => prioritizePhaseFields(schema.fields, existingInputs as Record<string, string | undefined>),
    [schema.fields, existingInputs],
  );
  const firstGapLabel = prioritized.firstGapId
    ? schema.fields.find((field) => field.id === prioritized.firstGapId)?.label ?? null
    : null;

  // The exact payload `handleSave` would persist, recomputed on every edit. Used
  // both by the save path and by `onValuesChange` so read-only consumers (header
  // metrics, status rings, flow-line tones) can reflect in-progress edits without
  // an explicit save or a heavy network round-trip.
  const liveSnapshot = useMemo<Record<string, string>>(() => {
    const gridFieldIds = schema.fields.filter((field) => field.type === "grid").map((field) => field.id);
    const raw: Record<string, string> = {
    ...values,
    // Serialize structured grid fields (overrides any stale string in values).
    ...Object.fromEntries(
      gridFieldIds.map((id) => [id, serializeRows(grids[id] ?? [], schema.fields.find((f) => f.id === id)?.columns ?? [])]),
    ),
    workstreams: JSON.stringify(localWorkstreams),
    // Strategy-only: persist baseline/target KPIs so benefits realisation
    // is measured against the human-entered baseline downstream.
    ...(showKpis ? { kpis: JSON.stringify(localKpis.filter((kpi) => kpi.name.trim())) } : {}),
    // Value Realize-only: persist a full snapshot of each KPI plus its
    // measured actual, so the Benefits Tracker reports realisation against
    // human-entered numbers. Snapshotting baseline/target/unit keeps the
    // record self-contained even if Strategy KPIs are later edited.
    ...(showActuals ? {
      kpiActuals: JSON.stringify(
        strategyKpiDefs.map((def) => ({
          id: def.id,
          name: def.name,
          baseline: def.baseline,
          target: def.target,
          unit: def.unit,
          actual: localActuals[def.id] ?? "",
        })),
      ),
    } : {}),
    };
    // Safety net: never let an *untouched* grid buffer that reads empty overwrite
    // non-empty persisted rows. Guards the remount / external-write window where a
    // buffer can momentarily be "[]" while persisted data already holds rows — a
    // deliberate clear/edit marks the field touched, so real edits still persist.
    return preserveUntouchedGrids(raw, existingInputs as Record<string, unknown>, gridFieldIds, gridsTouchedRef.current);
  }, [values, schema.fields, grids, localWorkstreams, showKpis, localKpis, showActuals, strategyKpiDefs, localActuals, existingInputs]);

  // Emit the live snapshot to read-only consumers on every edit. The panel keeps
  // editing against the persisted `program`, so this never feeds back into the
  // edit buffer (which would steal focus mid-keystroke).
  useEffect(() => {
    onValuesChange?.(phaseId, liveSnapshot);
  }, [phaseId, liveSnapshot, onValuesChange]);

  async function handleSave() {
    if (locked) return;
    setSaving(true);
    // Record exactly what we're persisting so the resync effect recognises this
    // save's echo and doesn't treat it as an external change worth re-adopting.
    selfSaveSigRef.current = managedInputSignature(liveSnapshot, schema.fields);
    try {
      // Auto-save is the only save path now (no manual button), so persist
      // quietly — the surface shows a subtle "Saved" tick instead of a toast.
      await onSave(phaseId, liveSnapshot, { silent: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      // Auto-save is best-effort. A conflict (another save — e.g. a lock
      // snapshot — landed first) or transient failure must not surface as an
      // unhandled rejection: the buffer stays dirty, so the next debounced pass
      // retries against the refreshed program.
    } finally {
      setSaving(false);
    }
  }

  // Auto-save: persist after the user pauses typing. Debounced so a burst of
  // keystrokes coalesces into one write, and only fires when the buffer actually
  // diverges from the persisted snapshot (no-op saves are skipped). Partial input
  // is intentionally saved — progress should never be lost, and the header metrics
  // read the persisted value once it lands.
  useEffect(() => {
    if (locked || !isDirty) {
      pendingFlushRef.current = null;
      return;
    }
    // Record what this debounce intends to persist, tagged with the current phase
    // and fields, so a phase switch / unmount before the timer fires can flush it.
    pendingFlushRef.current = { phaseId, snapshot: liveSnapshot, fields: schema.fields };
    if (autoSaveTimerRef.current != null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      pendingFlushRef.current = null;
      void handleSave();
    }, 800);
    return () => {
      if (autoSaveTimerRef.current != null) window.clearTimeout(autoSaveTimerRef.current);
    };
    // handleSave is intentionally omitted — it is redefined every render; the
    // timer always fires the latest closure via liveSnapshot below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, liveSnapshot, locked, phaseId, schema.fields]);

  // Flush a pending debounced save when the panel leaves this phase (phase switch
  // or unmount). Keyed on phaseId so the cleanup closure's `phaseId` is the phase
  // being left; pendingFlushRef carries the matching snapshot/fields, so the edit
  // lands under the correct phase even though `values` lags the phaseId change.
  useEffect(() => {
    return () => {
      const pending = pendingFlushRef.current;
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (!pending || lockedRef.current) return;
      pendingFlushRef.current = null;
      selfSaveSigRef.current = managedInputSignature(pending.snapshot, pending.fields);
      void onSaveRef.current(pending.phaseId, pending.snapshot, { silent: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseId]);

  function addKpi() {
    setLocalKpis((current) => [
      ...current,
      {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `kpi-${Date.now()}`,
        name: "",
        baseline: "",
        target: "",
        unit: "",
      },
    ]);
  }

  function updateKpi(index: number, key: keyof PhaseKpi, value: string) {
    setLocalKpis((current) => current.map((kpi, itemIndex) => (itemIndex === index ? { ...kpi, [key]: value } : kpi)));
  }

  function removeKpi(index: number) {
    setLocalKpis((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateActual(kpiId: string, value: string) {
    setLocalActuals((current) => ({ ...current, [kpiId]: value }));
  }

  return (
    <div className="v3-phase-inputs">
      <div className={`v3-phase-inputs-head ${headerAction ? "has-action" : ""}`}>
        <button
          type="button"
          className="v3-phase-inputs-toggle"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            <span className="v3-phase-inputs-toggle-title">{schema.title}</span>
            <span className="v3-phase-inputs-toggle-sub">
              {filledCount}/{schema.fields.length} fields · {open ? "collapse" : "expand"}
            </span>
          </div>
          <div className="v3-phase-inputs-toggle-aside">
            <span className={`v3-input-chevron ${open ? "is-open" : ""}`} aria-hidden>▾</span>
          </div>
        </button>
        {headerAction ? (
          <div className="v3-phase-inputs-head-action">{headerAction}</div>
        ) : null}
      </div>

      {open ? (
        <div className="v3-phase-inputs-body">
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginBottom: 12, lineHeight: 1.55 }}>
            {schema.description}
          </div>
          {freshnessLabel((existingInputs as Record<string, unknown>).savedAt) ? (
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 12 }}>
              {freshnessLabel((existingInputs as Record<string, unknown>).savedAt)}
            </div>
          ) : null}

          {locked ? (
            <div className="v3-input-lock-banner">
              <span className="v3-chip" style={{ fontSize: 10 }}>🔒 Gate approved</span>
              <span className="v3-input-priority-detail">
                Inputs are locked for this phase. Reopen the gate to make changes.
              </span>
            </div>
          ) : null}

          <fieldset
            disabled={locked}
            className="v3-phase-inputs-fieldset"
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
          >
          {prioritized.requiredGaps > 0 ? (
            <div className="v3-input-priority-banner">
              <span className="v3-chip red" style={{ fontSize: 10 }}>
                {prioritized.requiredGaps} required {prioritized.requiredGaps === 1 ? "field" : "fields"} left
              </span>
              {firstGapLabel ? (
                <span className="v3-input-priority-detail">Start with <strong>{firstGapLabel}</strong> — sorted to the top.</span>
              ) : null}
            </div>
          ) : prioritized.optionalGaps > 0 ? (
            <div className="v3-input-priority-banner">
              <span className="v3-chip amber" style={{ fontSize: 10 }}>All required complete</span>
              <span className="v3-input-priority-detail">{prioritized.optionalGaps} optional {prioritized.optionalGaps === 1 ? "field" : "fields"} can add depth.</span>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
            {schema.fields.map((field) => {
              // The Primary success metric is folded into the unified Outcome KPIs
              // table below (it is the headline KPI), so don't also render it as a
              // standalone field here. Only Strategy shows that table (showKpis).
              if (field.id === "successMetric" && showKpis) return null;
              const verdict = field.type === "grid"
                ? (filledRowCount(grids[field.id] ?? [], field.columns ?? []) > 0
                    ? { label: "Complete", tone: "green" as const }
                    : { label: "Empty", tone: "muted" as const })
                : assessField(values[field.id], field.type);
              return (
              <div
                key={field.id}
                data-io-anchor={`input:${field.id}`}
                className="v3-input-field"
                data-filled={verdict.tone === "green" ? "true" : "false"}
                data-required={field.required ? "true" : "false"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginBottom: 4 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="v3-field-label">
                      {field.label}
                      {field.required ? <span style={{ color: "var(--v3-accent)", marginLeft: 3 }}>*</span> : null}
                      {field.source === "ai-derived" ? (
                        <span
                          className="v3-chip"
                          style={{ fontSize: 9, marginLeft: 6, verticalAlign: "middle" }}
                          title="Proposed by the planner agent from prior-phase artifacts"
                        >
                          ✦ AI
                        </span>
                      ) : null}
                    </div>
                    {field.hint ? (
                      <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>{field.hint}</div>
                    ) : null}
                    {field.example ? (
                      <div style={{ fontSize: 10.5, color: "var(--v3-text-muted)", marginTop: 2 }}>
                        e.g. <span style={{ fontStyle: "italic" }}>{field.example}</span>
                      </div>
                    ) : null}
                    {field.validationRule ? (
                      <div style={{ fontSize: 10, color: "var(--v3-text-muted)", marginTop: 2 }}>
                        Expected: {field.validationRule}
                      </div>
                    ) : null}
                    {field.reasonNeeded ? (
                      <div style={{ fontSize: 10.5, color: "var(--v3-text-muted)", marginTop: 2, fontStyle: "italic" }}>
                        Why: {field.reasonNeeded}
                      </div>
                    ) : null}
                    {field.usedByArtifacts && field.usedByArtifacts.length ? (
                      <div style={{ fontSize: 10, color: "var(--v3-text-muted)", marginTop: 2 }}>
                        Feeds: {field.usedByArtifacts.join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {provenanceMatches(provenance[field.id], values[field.id])
                      ? <ProvenanceChip prov={provenance[field.id]} />
                      : null}
                    <span className={`v3-chip ${verdict.tone}`} style={{ fontSize: 10 }}>{verdict.label}</span>
                  </div>
                </div>
                {field.type === "grid" ? (
                  <>
                    {(() => {
                      const draft = gridDrafts[field.id];
                      // Hide once dismissed or the user has interacted (typed,
                      // cleared, or already adopted/merged the draft this phase).
                      if (!draft || dismissedDrafts[field.id] || gridsTouchedRef.current.has(field.id)) return null;
                      const cols = field.columns ?? [];
                      const currentRows = grids[field.id] ?? [];
                      const filled = filledRowCount(currentRows, cols);
                      // Offer the draft over an empty grid, or over a legacy free-text
                      // value migrated into row(s) (structurally unstructured) — but
                      // never over a genuinely curated structured grid.
                      const isLegacy = isLegacyFreeTextGridValue((existingInputs as Record<string, unknown>)[field.id]);
                      if (filled > 0 && !isLegacy) return null;
                      const hasExisting = filled > 0;
                      // Preview each drafted row by its lead (first) column value.
                      const leadKey = cols[0]?.key;
                      const draftRows = () => parseRows(JSON.stringify(draft.rows), cols);
                      const adoptReplace = () => {
                        gridsTouchedRef.current.add(field.id);
                        setGrids((current) => ({ ...current, [field.id]: draftRows() }));
                      };
                      const adoptMerge = () => {
                        gridsTouchedRef.current.add(field.id);
                        // Append only drafted rows not already present (by lead value),
                        // so a merge never duplicates an item or discards existing rows.
                        setGrids((current) => ({
                          ...current,
                          [field.id]: mergeGridDraft(current[field.id] ?? [], draftRows(), leadKey),
                        }));
                      };
                      return (
                      <div className="v3-decision-draft" role="note">
                        <div className="v3-decision-draft-head">
                          <span>
                            ✨ The {draft.sourceLabel} drafted{" "}
                            {draft.rows.length} {draft.noun}{draft.rows.length === 1 ? "" : "s"}.{" "}
                            {hasExisting
                              ? "Replace your current entry, merge these in, or dismiss."
                              : "Review and edit, or dismiss to enter your own."}
                          </span>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button type="button" className="v3-field-assist-btn" onClick={adoptReplace}>
                              {hasExisting ? "Replace" : "Use these"}
                            </button>
                            {hasExisting ? (
                              <button type="button" className="v3-field-assist-btn" onClick={adoptMerge}>
                                Merge
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="v3-field-assist-btn"
                              onClick={() => setDismissedDrafts((current) => ({ ...current, [field.id]: true }))}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                        <ul className="v3-decision-draft-list">
                          {draft.rows.map((row, index) => (
                            <li key={index}>{leadKey ? row[leadKey] : ""}</li>
                          ))}
                        </ul>
                      </div>
                      );
                    })()}
                    <StructuredGrid
                      columns={field.columns ?? []}
                      rows={grids[field.id] ?? []}
                      onChange={(rows) => {
                        gridsTouchedRef.current.add(field.id);
                        setGrids((current) => ({ ...current, [field.id]: rows }));
                      }}
                      addLabel={`+ Add ${field.label.toLowerCase()}`}
                    />
                  </>
                ) : field.type === "textarea" ? (
                  <AutoGrowTextarea
                    className="v3-input v3-textarea"
                    rows={2}
                    style={{ overflow: "hidden", resize: "none" }}
                    aria-label={field.label}
                    placeholder={field.placeholder}
                    value={values[field.id] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                ) : field.type === "select" ? (
                  // Off-list current values (e.g. an AI-extracted option the schema
                  // doesn't list) are surfaced by V3Select as their own entry so
                  // they stay visible and selected rather than rendering blank.
                  <V3Select
                    ariaLabel={field.label}
                    value={values[field.id] ?? ""}
                    options={field.options ?? []}
                    onChange={(value) => setValues((c) => ({ ...c, [field.id]: value }))}
                  />
                ) : (field.type === "stakeholder" || field.type === "organization" || field.type === "document" || field.type === "artifact-reference") ? (
                  // Semantic reference types. Persist as a plain string but offer
                  // a context-aware suggestion list drawn from the programme (roster
                  // / orgs / documents / artifacts) so the value resolves to a real
                  // entity. Free text is still allowed when nothing matches.
                  (() => {
                    const suggestions = referenceSuggestions[field.type] ?? [];
                    const refPlaceholder = field.placeholder ?? (
                      field.type === "stakeholder" ? "Name a person…"
                      : field.type === "organization" ? "Name an organisation…"
                      : field.type === "document" ? "Reference a document…"
                      : "Reference an artifact…"
                    );
                    return (
                      <V3Combobox
                        ariaLabel={field.label}
                        value={values[field.id] ?? ""}
                        suggestions={suggestions}
                        placeholder={refPlaceholder}
                        onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                      />
                    );
                  })()
                ) : field.id === "successMetric" ? (
                  // Render the Primary success metric on a single row in the same
                  // column layout as the secondary Outcome KPIs below
                  // (name · baseline · target · unit), so the primary and
                  // secondary metrics read as one consistent system.
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      className="v3-input"
                      style={{ flex: 2 }}
                      aria-label={field.label}
                      placeholder={field.placeholder}
                      value={values[field.id] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                    />
                    <input
                      type="text"
                      className="v3-input"
                      style={{ width: 80 }}
                      aria-label={`${field.label} baseline`}
                      placeholder="Baseline"
                      value={values.successMetricBaseline ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, successMetricBaseline: event.target.value }))}
                    />
                    <input
                      type="text"
                      className="v3-input"
                      style={{ width: 80 }}
                      aria-label={`${field.label} target`}
                      placeholder="Target"
                      value={values.successMetricTarget ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, successMetricTarget: event.target.value }))}
                    />
                    <input
                      type="text"
                      className="v3-input"
                      style={{ width: 64 }}
                      aria-label={`${field.label} unit`}
                      placeholder="Unit"
                      value={values.successMetricUnit ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, successMetricUnit: event.target.value }))}
                    />
                    {/* Hidden spacer mirroring the KPI grid's remove button so the
                        columns line up with the Outcome KPIs rows beneath. */}
                    <button type="button" className="v3-button ghost" style={{ fontSize: 11, visibility: "hidden" }} tabIndex={-1} aria-hidden>✕</button>
                  </div>
                ) : (
                  <input
                    type={field.type}
                    className="v3-input"
                    aria-label={field.label}
                    placeholder={field.placeholder}
                    value={values[field.id] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                )}
                {field.prefillValue && !(values[field.id] ?? "").trim() ? (
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: 8, marginTop: 6,
                      padding: "6px 10px", borderRadius: 8,
                      border: "1px dashed var(--v3-border)", background: "var(--v3-surface-2, transparent)",
                    }}
                  >
                    <span style={{ fontSize: 9, flexShrink: 0 }} className="v3-chip amber">
                      {field.needsConfirmation ? "Confirm" : "Suggested"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--v3-text)", minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }} title={field.prefillSource ? `Inferred from ${field.prefillSource}` : undefined}>
                      {field.prefillValue}
                    </span>
                    <button
                      type="button"
                      className="v3-field-assist-btn"
                      disabled={locked}
                      onClick={() => setValues((current) => ({ ...current, [field.id]: field.prefillValue ?? "" }))}
                    >
                      {field.needsConfirmation ? "✓ Confirm" : "Use"}
                    </button>
                  </div>
                ) : null}
                {onAssistField && field.type === "textarea" ? (
                  <div className="v3-field-assist">
                    {assistingField === field.id ? (
                      <span className="v3-field-assist-status">✨ Writing…</span>
                    ) : (
                      availableModes(values[field.id] ?? "").filter((mode) => mode !== "improve").map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className="v3-field-assist-btn"
                          disabled={!!assistingField}
                          onClick={() => void runAssist({ id: field.id, label: field.label, hint: field.hint }, mode)}
                        >
                          {mode === "generate" ? "✨ " : ""}{FIELD_ASSIST_MODE_LABEL[mode]}
                        </button>
                      ))
                    )}
                    {assistErrors[field.id] ? (
                      <span className="v3-field-assist-error">{assistErrors[field.id]}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>

          {showKpis ? (() => {
            const successField = schema.fields.find((field) => field.id === "successMetric");
            const successVerdict = assessField(values.successMetric, "text");
            return (
            <div style={{ marginTop: 12, marginBottom: 12 }} data-io-anchor="input:successMetric">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className="v3-field-label">Outcome KPIs (baseline → target)</div>
                {provenanceMatches(provenance.kpis, (existingInputs as Record<string, unknown>).kpis)
                  ? <ProvenanceChip prov={provenance.kpis} />
                  : null}
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 8 }}>
                Your primary success metric is the headline outcome; add any supporting KPIs beneath it.
                Baseline and target captured here anchor the Benefits Tracker so realisation is measured
                against your numbers — not estimates.
              </div>
              {/* Shared column headers for the primary metric + supporting KPI rows */}
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <div style={{ flex: 2, fontSize: 10, fontWeight: 600, color: "var(--v3-text-muted)" }}>Metric</div>
                <div style={{ width: 80, fontSize: 10, fontWeight: 600, color: "var(--v3-text-muted)" }}>Baseline</div>
                <div style={{ width: 80, fontSize: 10, fontWeight: 600, color: "var(--v3-text-muted)" }}>Target</div>
                <div style={{ width: 64, fontSize: 10, fontWeight: 600, color: "var(--v3-text-muted)" }}>Unit</div>
                <div style={{ width: 28 }} />
              </div>
              {/* Primary success metric — pinned first row of the unified table */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span className="v3-chip indigo" style={{ fontSize: 9 }}>★ Primary</span>
                {successField?.required ? <span style={{ color: "var(--v3-accent)", fontSize: 11 }}>required</span> : null}
                <span className={`v3-chip ${successVerdict.tone}`} style={{ fontSize: 10 }}>{successVerdict.label}</span>
                {provenanceMatches(provenance.successMetric, values.successMetric)
                  ? <ProvenanceChip prov={provenance.successMetric} />
                  : null}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <input
                  type="text"
                  className="v3-input"
                  style={{ flex: 2 }}
                  aria-label={successField?.label ?? "Primary success metric"}
                  placeholder={successField?.placeholder ?? "Primary success metric, e.g. Cost to serve"}
                  value={values.successMetric ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, successMetric: event.target.value }))}
                />
                <input
                  type="text"
                  className="v3-input"
                  style={{ width: 80 }}
                  aria-label="Primary success metric baseline"
                  placeholder="Baseline"
                  value={values.successMetricBaseline ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, successMetricBaseline: event.target.value }))}
                />
                <input
                  type="text"
                  className="v3-input"
                  style={{ width: 80 }}
                  aria-label="Primary success metric target"
                  placeholder="Target"
                  value={values.successMetricTarget ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, successMetricTarget: event.target.value }))}
                />
                <input
                  type="text"
                  className="v3-input"
                  style={{ width: 64 }}
                  aria-label="Primary success metric unit"
                  placeholder="Unit"
                  value={values.successMetricUnit ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, successMetricUnit: event.target.value }))}
                />
                {/* The pinned primary metric is a singular *required* field, not an
                    array entry — the headline outcome slot always exists, so it can
                    only be CLEARED (emptied), never removed like the KPI rows below.
                    We deliberately use a distinct erase glyph (⌫) rather than the ✕
                    the KPI rows use for removal, and only show it when there is
                    something to clear: an identical ✕ on an always-present row read
                    as "delete", so clicking it (which merely cleared the values) felt
                    like the row "couldn't be deleted". A width-matched spacer keeps
                    the four columns aligned with the KPI rows when the button hides. */}
                {(values.successMetric || values.successMetricBaseline || values.successMetricTarget || values.successMetricUnit) ? (
                  <button
                    type="button"
                    className="v3-button ghost"
                    style={{ fontSize: 12, width: 28 }}
                    aria-label="Clear primary success metric"
                    title="Clear the primary metric. This required headline row always stays — only the KPI rows below can be removed."
                    onClick={() => setValues((current) => ({
                      ...current,
                      successMetric: "",
                      successMetricBaseline: "",
                      successMetricTarget: "",
                      successMetricUnit: "",
                    }))}
                  >⌫</button>
                ) : (
                  <span style={{ width: 28, display: "inline-block" }} aria-hidden="true" />
                )}
              </div>
              {localKpis.map((kpi, index) => (
                <div key={kpi.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <input
                    type="text"
                    className="v3-input"
                    style={{ flex: 2 }}
                    value={kpi.name}
                    placeholder="KPI, e.g. Cost to serve"
                    onChange={(event) => updateKpi(index, "name", event.target.value)}
                  />
                  <input
                    type="text"
                    className="v3-input"
                    style={{ width: 80 }}
                    value={kpi.baseline}
                    placeholder="Baseline"
                    onChange={(event) => updateKpi(index, "baseline", event.target.value)}
                  />
                  <input
                    type="text"
                    className="v3-input"
                    style={{ width: 80 }}
                    value={kpi.target}
                    placeholder="Target"
                    onChange={(event) => updateKpi(index, "target", event.target.value)}
                  />
                  <input
                    type="text"
                    className="v3-input"
                    style={{ width: 64 }}
                    value={kpi.unit}
                    placeholder="Unit"
                    onChange={(event) => updateKpi(index, "unit", event.target.value)}
                  />
                  {/* KPI rows are removable array entries, so this control deletes the
                      whole row (the ✕ the primary metric's clear control deliberately
                      avoids). Width/size matched to that control so the right-hand
                      column stays uniform across the pinned row and the KPI rows. */}
                  <button
                    type="button"
                    className="v3-button ghost"
                    style={{ fontSize: 12, width: 28 }}
                    aria-label="Remove this KPI"
                    title="Remove this KPI row"
                    onClick={() => removeKpi(index)}
                  >✕</button>
                </div>
              ))}
              <button type="button" className="v3-button ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={addKpi}>
                + Add KPI
              </button>
            </div>
            );
          })() : null}

          {showActuals ? (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div className="v3-field-label">KPI Realisation (record measured actuals)</div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 6 }}>
                Enter the measured value for each outcome KPI. These actuals feed the Benefits Tracker,
                which reports realisation against your Strategy baseline → target — closing the loop.
              </div>
              {strategyKpiDefs.length === 0 ? (
                <div style={{
                  fontSize: 11,
                  color: "var(--v3-text-muted)",
                  padding: "10px 12px",
                  border: "1px dashed var(--v3-border)",
                  borderRadius: 8,
                }}>
                  No outcome KPIs defined yet. Add them in the <strong>Strategy</strong> phase
                  (Outcome KPIs · baseline → target) and they will appear here for measurement.
                </div>
              ) : (
                strategyKpiDefs.map((def) => {
                  const actual = localActuals[def.id] ?? "";
                  return (
                    <div key={def.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                      <span style={{ flex: 2, fontSize: 12, color: "var(--v3-text)" }}>
                        {def.name || <em style={{ color: "var(--v3-text-muted)" }}>(unnamed KPI)</em>}
                        {def.unit ? <span style={{ color: "var(--v3-text-muted)" }}> ({def.unit})</span> : null}
                      </span>
                      <span title="Baseline (from Strategy)" style={{ width: 80, fontSize: 11, color: "var(--v3-text-muted)", textAlign: "center" }}>
                        {def.baseline || "—"}
                      </span>
                      <span title="Target (from Strategy)" style={{ width: 80, fontSize: 11, color: "var(--v3-text-muted)", textAlign: "center" }}>
                        → {def.target || "—"}
                      </span>
                      <input
                        type="text"
                        className="v3-input"
                        style={{ width: 80 }}
                        value={actual}
                        placeholder="Actual"
                        onChange={(event) => updateActual(def.id, event.target.value)}
                      />
                    </div>
                  );
                })
              )}
            </div>
          ) : null}

          </fieldset>

          {locked ? (
            <div className="v3-input-lock-footer">
              🔒 Inputs locked — this phase has cleared its stage gate. Reopen the gate to edit.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              <span className="v3-autosave-status" aria-live="polite">
                {saving ? "Saving…" : saved ? "Saved ✓" : isDirty ? "Unsaved changes…" : "All changes saved"}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
