import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary, Workstream } from "@/new/types";
import { getPhaseInputSchema, type GridColumn } from "@/v3/lib/phaseInputSchema";
import { availableModes, FIELD_ASSIST_MODE_LABEL, type FieldAssistMode } from "@/v3/lib/fieldAssist";
import { prioritizePhaseFields } from "@/v3/lib/phaseInputPriority";
import StructuredGrid, { type GridRow, parseRows, serializeRows, filledRowCount } from "@/v3/components/StructuredGrid";

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
}

interface PhaseInputsPanelProps {
  program: ProgramSummary;
  phaseId: string;
  onSave: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  onUploadDocument: () => void;
  /** Optional AI assist for a single field; resolves with the new field text. */
  onAssistField?: (phaseId: string, request: FieldAssistRequest) => Promise<string>;
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
export function assessField(value: string | undefined, type: string): { label: string; tone: "green" | "amber" | "muted" } {
  const v = (value ?? "").trim();
  if (!v) return { label: "Empty", tone: "muted" };
  if (type === "textarea") {
    const words = v.split(/\s+/).filter(Boolean).length;
    if (words < 8) return { label: "Brief", tone: "amber" };
    if (words < 20) return { label: "Fair", tone: "amber" };
    return { label: "Complete", tone: "green" };
  }
  return { label: "Complete", tone: "green" };
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

export default function PhaseInputsPanel({ program, phaseId, onSave, onUploadDocument, onAssistField }: PhaseInputsPanelProps) {
  const schema = getPhaseInputSchema(phaseId);
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
  }, [existingInputs, phaseId]);

  const showKpis = phaseId === "strategy";
  const showActuals = phaseId === "valuerealize";
  // Roles are defined once at Mobilise (canonical roster). Every other phase
  // references that roster read-only — single source of truth for people,
  // mirroring the Strategy→Value Realize KPI define-once/reference pattern.
  const showRolesReference = phaseId !== "mobilise";
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

  const hasAllRequired = schema.fields
    .filter((field) => field.required)
    .every((field) => isFieldFilled(field));
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
    if (showKpis && JSON.stringify(localKpis) !== JSON.stringify(parseKpis((existingInputs as Record<string, unknown>).kpis))) return true;
    if (showActuals && JSON.stringify(localActuals) !== JSON.stringify(parseKpiActuals((existingInputs as Record<string, unknown>).kpiActuals))) return true;
    return false;
  }, [schema.fields, values, existingInputs, localWorkstreams, localKpis, localActuals, grids, program.workstreams, phaseId, showKpis, showActuals]);

  // Prioritise inputs by impact: required gaps first, then optional gaps, then
  // complete — so "what matters now" is at the top. Ranked from the *persisted*
  // snapshot (existingInputs), never the live edit buffer, so a field can't jump
  // under the cursor while the user is typing into it.
  const prioritized = useMemo(
    () => prioritizePhaseFields(schema.fields, existingInputs as Record<string, string | undefined>),
    [schema.fields, existingInputs],
  );
  const firstGapLabel = prioritized.firstGapId
    ? schema.fields.find((field) => field.id === prioritized.firstGapId)?.label ?? null
    : null;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(phaseId, {
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
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  // Revert the live edit buffer back to the last persisted snapshot, mirroring
  // the reset run by the existingInputs effect.
  function handleCancel() {
    setValues(existingInputs);
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
  }

  function addWorkstream() {
    setLocalWorkstreams((current) => [
      ...current,
      {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `ws-${Date.now()}`,
        label: "",
        phaseId,
        weight: 0,
        pct: 0,
        gateScore: null,
        owner: null,
        status: "active",
      },
    ]);
  }

  function updateWorkstream(index: number, key: keyof Workstream, value: string | number | null) {
    setLocalWorkstreams((current) => current.map((workstream, itemIndex) => {
      if (itemIndex !== index) return workstream;
      return {
        ...workstream,
        [key]: value,
      };
    }));
  }

  function removeWorkstream(index: number) {
    setLocalWorkstreams((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

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
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginBottom: 12, lineHeight: 1.55 }}>
            {schema.description}
          </div>
          {freshnessLabel((existingInputs as Record<string, unknown>).savedAt) ? (
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 12 }}>
              {freshnessLabel((existingInputs as Record<string, unknown>).savedAt)}
            </div>
          ) : null}

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
            {prioritized.fields.map(({ field }) => {
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
                    </div>
                    {field.hint ? (
                      <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>{field.hint}</div>
                    ) : null}
                  </div>
                  <span className={`v3-chip ${verdict.tone}`} style={{ fontSize: 10, flexShrink: 0 }}>{verdict.label}</span>
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
                    placeholder={field.placeholder}
                    value={values[field.id] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  />
                ) : field.type === "select" ? (
                  <select
                    className="v3-input"
                    value={values[field.id] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  >
                    <option value="">Select…</option>
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    className="v3-input"
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
                      availableModes(values[field.id] ?? "").map((mode) => (
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

          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <div className="v3-field-label">Workstreams (optional)</div>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 6 }}>
              Define parallel workstreams if this phase runs concurrent tracks.
            </div>
            {localWorkstreams.map((workstream, index) => (
              <div key={workstream.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input
                  type="text"
                  className="v3-input"
                  style={{ flex: 1 }}
                  value={workstream.label}
                  placeholder="e.g. Technology"
                  onChange={(event) => updateWorkstream(index, "label", event.target.value)}
                />
                <input
                  type="number"
                  className="v3-input"
                  style={{ width: 64 }}
                  min={0}
                  max={100}
                  value={Math.round(workstream.pct)}
                  onChange={(event) => updateWorkstream(index, "pct", Number(event.target.value))}
                  placeholder="%"
                />
                {typeof (workstream as Record<string,unknown>).health === "number" ? (
                  <span
                    title={Array.isArray((workstream as Record<string,unknown>).healthIssues) ? ((workstream as Record<string,unknown>).healthIssues as string[]).join(" · ") : ""}
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: (workstream as Record<string,unknown>).healthColor === "red" ? "var(--v3-red)"
                        : (workstream as Record<string,unknown>).healthColor === "amber" ? "#f59e0b"
                        : "var(--v3-green)",
                    }}
                  />
                ) : null}
                <button type="button" className="v3-button ghost" style={{ fontSize: 11 }} onClick={() => removeWorkstream(index)}>✕</button>
              </div>
            ))}
            <button type="button" className="v3-button ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={addWorkstream}>
              + Add workstream
            </button>
          </div>

          {showKpis ? (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div className="v3-field-label">Outcome KPIs (baseline → target)</div>
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onUploadDocument}>
              ↑ Upload document instead
            </button>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="v3-button ghost"
                style={{ fontSize: 12 }}
                disabled={saving || !isDirty}
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v3-button primary"
                style={{ fontSize: 12 }}
                disabled={saving || !hasAllRequired}
                onClick={() => void handleSave()}
              >
                {saved ? "Saved ✓" : saving ? "Saving…" : "Save inputs"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
