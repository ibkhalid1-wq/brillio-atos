import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary, Workstream } from "@/new/types";
import { getPhaseInputSchema, type GridColumn } from "@/v3/lib/phaseInputSchema";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { availableModes, FIELD_ASSIST_MODE_LABEL, type FieldAssistMode } from "@/v3/lib/fieldAssist";
import { prioritizePhaseFields } from "@/v3/lib/phaseInputPriority";
import StructuredGrid, { type GridRow, parseRows, serializeRows, filledRowCount } from "@/v3/components/StructuredGrid";
import { PROVENANCE_KEY, parseProvenance, provenanceMatches, type FieldProvenance } from "@/new/lib/fieldProvenance";
import { EXTRACTION_TYPE_COLORS, EXTRACTION_TYPE_LABELS, confidenceLabel } from "@/new/lib/documentIntelligenceTypes";

/** Columns for the canonical roles roster (mirrors ROLE_COLS in phaseInputSchema). */
const ROLE_COLS: GridColumn[] =
  getPhaseInputSchema("mobilise").fields.find((field) => field.id === "keyRoles")?.columns ?? [];

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
  onUploadDocument: () => void;
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

export default function PhaseInputsPanel({ program, phaseId, onSave, onUploadDocument, onAssistField, onValuesChange, locked = false }: PhaseInputsPanelProps) {
  // Merge any ai-derived dynamic fields for this phase on top of the static
  // methodology schema, so planner-proposed inputs render in this panel.
  const dynamicStore = useMemo(() => getDynamicSchemaStore(program.rawData), [program.rawData]);
  const schema = useMemo(() => getPhaseInputSchema(phaseId, dynamicStore), [phaseId, dynamicStore]);
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
    return phaseInputs[phaseId] ?? {};
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

  const [values, setValues] = useState<Record<string, string>>(existingInputs);
  const [localWorkstreams, setLocalWorkstreams] = useState<Workstream[]>([]);
  const [localKpis, setLocalKpis] = useState<PhaseKpi[]>([]);
  // Map of KPI id → human-entered actual value (Value Realize only).
  const [localActuals, setLocalActuals] = useState<Record<string, string>>({});
  // Structured grid fields (e.g. key roles), keyed by field id. Persisted as a
  // JSON string under the field id — same convention as KPIs/workstreams.
  const [grids, setGrids] = useState<Record<string, GridRow[]>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Always start expanded so document-imported data is immediately visible
  const [open, setOpen] = useState(true);
  // Per-field AI assist: which field is currently generating, and any per-field error.
  const [assistingField, setAssistingField] = useState<string | null>(null);
  const [assistErrors, setAssistErrors] = useState<Record<string, string>>({});
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
    // Block the resync only for our *own* save echo while the buffer is dirty —
    // that's the focus-steal case the guard exists for. An external write (e.g. a
    // document import populating phaseInputs.kpis) carries a different signature
    // and must be adopted, even when the stale buffer looks "dirty" against it.
    const incomingSig = managedInputSignature(existingInputs as Record<string, unknown>, schema.fields);
    const isOwnSaveEcho = selfSaveSigRef.current !== null && incomingSig === selfSaveSigRef.current;
    if (!phaseChanged && isDirtyRef.current && isOwnSaveEcho) return;
    setValues(existingInputs);
    // Only auto-open if there's no data yet (first-time setup)
    if (Object.keys(existingInputs).length === 0) setOpen(true);
    const existingWorkstreams = Array.isArray(existingInputs.workstreams)
      ? existingInputs.workstreams.filter((entry): entry is Workstream => typeof entry === "object" && entry !== null)
      : Array.isArray(program.workstreams)
        ? program.workstreams.filter((entry) => entry.phaseId === phaseId)
        : [];
    setLocalWorkstreams(existingWorkstreams);
    setLocalKpis(parseKpis((existingInputs as Record<string, unknown>).kpis));
    setLocalActuals(parseKpiActuals((existingInputs as Record<string, unknown>).kpiActuals));
    const nextGrids: Record<string, GridRow[]> = {};
    for (const field of schema.fields) {
      if (field.type === "grid") nextGrids[field.id] = parseRows((existingInputs as Record<string, unknown>)[field.id], field.columns ?? []);
    }
    setGrids(nextGrids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingInputsKey, phaseId]);

  const showKpis = phaseId === "strategy";
  const showActuals = phaseId === "valuerealize";
  // Roles are defined once at Mobilise (canonical roster). Phases after Mobilise
  // reference that roster read-only — single source of truth for people. Strategy
  // runs before Mobilise, so the roster doesn't exist there yet.
  const showRolesReference = phaseId !== "mobilise" && phaseId !== "strategy";
  const mobiliseRoles = useMemo(() => {
    const raw = program.rawData as Record<string, unknown>;
    const source = raw && typeof raw.data === "object" && raw.data !== null
      ? raw.data as Record<string, unknown>
      : raw ?? {};
    const phaseInputs = typeof source.phaseInputs === "object" && source.phaseInputs !== null
      ? source.phaseInputs as Record<string, Record<string, string>>
      : {};
    return parseRows((phaseInputs.mobilise ?? {}).keyRoles, ROLE_COLS);
  }, [program.rawData]);

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
        const persisted = serializeRows(parseRows((existingInputs as Record<string, unknown>)[field.id], field.columns ?? []), field.columns ?? []);
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
  }, [schema.fields, values, existingInputs, localWorkstreams, localKpis, localActuals, grids, program.workstreams, phaseId, showKpis, showActuals]);
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
  const liveSnapshot = useMemo<Record<string, string>>(() => ({
    ...values,
    // Serialize structured grid fields (overrides any stale string in values).
    ...Object.fromEntries(
      schema.fields
        .filter((field) => field.type === "grid")
        .map((field) => [field.id, serializeRows(grids[field.id] ?? [], field.columns ?? [])]),
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
  }), [values, schema.fields, grids, localWorkstreams, showKpis, localKpis, showActuals, strategyKpiDefs, localActuals]);

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
    if (locked || !isDirty) return;
    if (autoSaveTimerRef.current != null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void handleSave();
    }, 800);
    return () => {
      if (autoSaveTimerRef.current != null) window.clearTimeout(autoSaveTimerRef.current);
    };
    // handleSave is intentionally omitted — it is redefined every render; the
    // timer always fires the latest closure via liveSnapshot below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, liveSnapshot, locked]);

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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {filledCount === schema.fields.length
            ? <span className="v3-chip green" style={{ fontSize: 11 }}>Complete</span>
            : filledCount > 0
              ? <span className="v3-chip amber" style={{ fontSize: 11 }}>Partial</span>
              : <span className="v3-chip muted" style={{ fontSize: 11 }}>Empty</span>}
          <span>{open ? "▴" : "▾"}</span>
        </div>
      </button>

      {open ? (
        <div className="v3-phase-inputs-body">
          {!locked ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onUploadDocument}>
                ↑ Upload document instead
              </button>
            </div>
          ) : null}
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
              const verdict = field.type === "grid"
                ? (filledRowCount(grids[field.id] ?? [], field.columns ?? []) > 0
                    ? { label: "Complete", tone: "green" as const }
                    : { label: "Empty", tone: "muted" as const })
                : assessField(values[field.id], field.type);
              return (
              <div key={field.id} data-io-anchor={`input:${field.id}`}>
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
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {provenanceMatches(provenance[field.id], values[field.id])
                      ? <ProvenanceChip prov={provenance[field.id]} />
                      : null}
                    <span className={`v3-chip ${verdict.tone}`} style={{ fontSize: 10 }}>{verdict.label}</span>
                  </div>
                </div>
                {field.type === "grid" ? (
                  <StructuredGrid
                    columns={field.columns ?? []}
                    rows={grids[field.id] ?? []}
                    onChange={(rows) => setGrids((current) => ({ ...current, [field.id]: rows }))}
                    addLabel={`+ Add ${field.label.toLowerCase()}`}
                  />
                ) : field.type === "textarea" ? (
                  <textarea
                    className="v3-input v3-textarea"
                    rows={2}
                    aria-label={field.label}
                    placeholder={field.placeholder}
                    value={values[field.id] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                ) : field.type === "select" ? (
                  <select
                    className="v3-input"
                    aria-label={field.label}
                    value={values[field.id] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  >
                    <option value="">Select…</option>
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
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

          {showRolesReference ? (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div className="v3-field-label">Key roles (from Mobilise)</div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 6 }}>
                Roles are defined once in the Mobilise phase and referenced here, so the team roster
                stays a single source of truth across phases.
              </div>
              {mobiliseRoles.length === 0 ? (
                <div style={{
                  fontSize: 11,
                  color: "var(--v3-text-muted)",
                  padding: "10px 12px",
                  border: "1px dashed var(--v3-border)",
                  borderRadius: 8,
                }}>
                  No roles defined yet. Add them in the <strong>Mobilise</strong> phase
                  (Key roles) and they will appear here.
                </div>
              ) : (
                <StructuredGrid columns={ROLE_COLS} rows={mobiliseRoles} onChange={() => {}} readOnly />
              )}
            </div>
          ) : null}

          {showKpis ? (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className="v3-field-label">Outcome KPIs (baseline → target)</div>
                {provenanceMatches(provenance.kpis, (existingInputs as Record<string, unknown>).kpis)
                  ? <ProvenanceChip prov={provenance.kpis} />
                  : null}
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 6 }}>
                Define the measurable outcomes for this programme. Baseline and target captured here
                anchor the Benefits Tracker so realisation is measured against your numbers — not estimates.
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
                  <button type="button" className="v3-button ghost" style={{ fontSize: 11 }} onClick={() => removeKpi(index)}>✕</button>
                </div>
              ))}
              <button type="button" className="v3-button ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={addKpi}>
                + Add KPI
              </button>
            </div>
          ) : null}

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
