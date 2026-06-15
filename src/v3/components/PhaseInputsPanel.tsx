import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary, Workstream } from "@/new/types";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";

interface PhaseInputsPanelProps {
  program: ProgramSummary;
  phaseId: string;
  onSave: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  onUploadDocument: () => void;
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

export default function PhaseInputsPanel({ program, phaseId, onSave, onUploadDocument }: PhaseInputsPanelProps) {
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

  const [values, setValues] = useState<Record<string, string>>(existingInputs);
  const [localWorkstreams, setLocalWorkstreams] = useState<Workstream[]>([]);
  const [localKpis, setLocalKpis] = useState<PhaseKpi[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Always start expanded so document-imported data is immediately visible
  const [open, setOpen] = useState(true);

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
  }, [existingInputs, phaseId]);

  const showKpis = phaseId === "strategy";

  const hasAllRequired = schema.fields
    .filter((field) => field.required)
    .every((field) => values[field.id]?.trim());
  const filledCount = schema.fields.filter((field) => values[field.id]?.trim()).length;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(phaseId, {
        ...values,
        workstreams: JSON.stringify(localWorkstreams),
        // Strategy-only: persist baseline/target KPIs so benefits realisation
        // is measured against the human-entered baseline downstream.
        ...(showKpis ? { kpis: JSON.stringify(localKpis.filter((kpi) => kpi.name.trim())) } : {}),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
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

          <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
            {schema.fields.map((field) => (
              <div key={field.id}>
                <div className="v3-field-label">
                  {field.label}
                  {field.required ? <span style={{ color: "var(--v3-accent)", marginLeft: 3 }}>*</span> : null}
                </div>
                {field.hint ? (
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 4 }}>{field.hint}</div>
                ) : null}
                {field.type === "textarea" ? (
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
              </div>
            ))}
          </div>

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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onUploadDocument}>
              ↑ Upload document instead
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
      ) : null}
    </div>
  );
}
