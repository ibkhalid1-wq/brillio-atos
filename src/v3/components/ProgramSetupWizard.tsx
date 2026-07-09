import React, { useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { supabase } from "@/integrations/supabase/client";
import { parseDocumentToText } from "@/new/lib/parseDocumentToText";
import { PROGRAM_ARCHETYPES, getPhaseSequence, type MethodologyVariant } from "@/v3/lib/methodology";

interface ProgramSetupWizardProps {
  program: ProgramSummary;
  onSave: (patch: ProgramSetupPatch) => Promise<void>;
  onClose: () => void;
  isSaving: boolean;
}

export interface ProgramSetupPatch {
  name: string;
  client: string;
  /** Optional programme archetype selected in the wizard's "What are you building?" step. */
  archetype?: string;
  /** Methodology variant derived from the archetype. Persisted to program data. */
  methodology?: MethodologyVariant;
  phases: Array<{
    id: string;
    pct: number;
    targetDate: string;
  }>;
}

type PhaseForm = {
  id: string;
  pct: number;
  targetDate: string;
  label: string;
};

function readProjectMeta(program: ProgramSummary): Record<string, unknown> {
  const raw = program.rawData || {};
  if (typeof raw.projectMeta === "object" && raw.projectMeta !== null && !Array.isArray(raw.projectMeta)) {
    return raw.projectMeta as Record<string, unknown>;
  }
  if (typeof raw.data === "object" && raw.data !== null && !Array.isArray(raw.data)) {
    const nested = raw.data as Record<string, unknown>;
    if (typeof nested.projectMeta === "object" && nested.projectMeta !== null && !Array.isArray(nested.projectMeta)) {
      return nested.projectMeta as Record<string, unknown>;
    }
  }
  return {};
}

function phaseTargetDates(program: ProgramSummary): Record<string, string> {
  const raw = program.rawData || {};
  const source = typeof raw.data === "object" && raw.data !== null && !Array.isArray(raw.data)
    ? (raw.data as Record<string, unknown>)
    : raw;
  const phases = Array.isArray(source.phases) ? source.phases : [];
  return phases.reduce<Record<string, string>>((acc, phase) => {
    if (typeof phase === "object" && phase !== null && !Array.isArray(phase)) {
      const item = phase as Record<string, unknown>;
      if (typeof item.id === "string" && typeof item.targetDate === "string") acc[item.id] = item.targetDate;
    }
    return acc;
  }, {});
}

export default function ProgramSetupWizard({ program, onSave, onClose, isSaving }: ProgramSetupWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectMeta = useMemo(() => readProjectMeta(program), [program]);
  const targetDates = useMemo(() => phaseTargetDates(program), [program]);
  const [prefilling, setPrefilling] = useState(false);
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(new Set());
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [name, setName] = useState(program.name === "New Program" || program.name === "New Programme" ? "" : program.name || "");
  const [client, setClient] = useState(typeof projectMeta.client === "string" ? projectMeta.client : program.client || "");
  // Pre-select the programme's stored archetype so re-opening setup neither
  // loses the choice nor re-seeds the spine (same spine → detail-edit merge).
  const [archetypeId, setArchetypeId] = useState<string>(
    typeof projectMeta.archetype === "string" ? projectMeta.archetype : "",
  );
  // Agentic System Build (ATOS Flow) leads — it is the flagship delivery model;
  // the stage-gate archetypes follow.
  const orderedArchetypes = useMemo(() => {
    const flow = PROGRAM_ARCHETYPES.filter((a) => a.methodologyVariant === "atos-flow");
    const rest = PROGRAM_ARCHETYPES.filter((a) => a.methodologyVariant !== "atos-flow");
    return [...flow, ...rest];
  }, []);
  // Phases keep their existing progress/target dates; the wizard no longer edits
  // them inline (the phase-progress section was removed), so the setter is unused.
  const [phases] = useState<PhaseForm[]>(
    program.phases.map((phase) => ({
      id: phase.id,
      pct: Math.max(0, Math.min(100, Math.round(phase.pct ?? 0))),
      targetDate: targetDates[phase.id] || "",
      label: phase.displayName,
    })),
  );

  async function handleDocumentUpload(file: File) {
    if (!supabase || !program.id) return;
    setPrefilling(true);
    setPrefillError(null);
    try {
      const parsed = await parseDocumentToText(file);
      if (!parsed.ok) throw new Error(parsed.error);
      const response = await supabase.functions.invoke("run-agent", {
        body: {
          agentId: "setup-prefill",
          programId: program.id,
          phaseId: "program",
          triggeredBy: "user",
          docText: parsed.text,
        },
      });
      const fields = (response.data as { output?: Record<string, unknown>; fields?: Record<string, unknown> } | null)?.output
        || (response.data as { fields?: Record<string, unknown> } | null)?.fields
        || {};
      const nextPrefilled = new Set<string>();
      if (typeof fields.programName === "string" && fields.programName.trim()) {
        setName(fields.programName.trim());
        nextPrefilled.add("name");
      }
      if (typeof fields.clientName === "string" && fields.clientName.trim()) {
        setClient(fields.clientName.trim());
        nextPrefilled.add("client");
      }
      setPrefilledFields(nextPrefilled);
      if (!nextPrefilled.size) {
        setPrefillError("Couldn't extract fields automatically. Please fill them in manually.");
      }
    } catch (error: any) {
      setPrefillError(error?.message || "Couldn't extract fields automatically. Please fill them in manually.");
    } finally {
      setPrefilling(false);
    }
  }

  const prefillClass = (field: string) => prefilling || !prefilledFields.has(field) ? "v3-input" : "v3-input ring-1 ring-amber-400";

  // Programme name and client are mandatory in the new-programme flow: the user
  // must provide both before the setup can be saved.
  const canSave = name.trim().length > 0 && client.trim().length > 0;

  return (
    <div className="v3-wizard-overlay" role="dialog" aria-modal="true" aria-label="Programme setup">
      <div className="v3-wizard v3-wizard--setup">
        <div className="v3-wizard-head">
          <span className="v3-wizard-eyebrow" aria-hidden="true">
            <span className="v3-wizard-eyebrow-glyph">✦</span>
            New programme
          </span>
          <h2 className="v3-wizard-title">Name the programme</h2>
          <p className="v3-wizard-subtitle">
            Give your transformation a name and client. ATOS plans every phase from there.
          </p>
        </div>

        <section>
          <div className="v3-wizard-section-label">Pre-fill from a document</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleDocumentUpload(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className={`v3-wizard-dropzone${prefilling ? " is-busy" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={prefilling}
          >
            <span className="v3-wizard-dropzone-icon" aria-hidden="true">{prefilling ? "◌" : "↑"}</span>
            <span className="v3-wizard-dropzone-text">
              <span className="v3-wizard-dropzone-title">
                {prefilling ? "Extracting details…" : "Upload and pre-fill"}
              </span>
              <span className="v3-wizard-dropzone-sub">
                Project charter, SOW, or briefing — we&apos;ll fill what we can.
              </span>
            </span>
          </button>
          {prefillError ? (
            <div style={{ fontSize: 11, color: "var(--v3-amber)", marginTop: 8 }}>{prefillError}</div>
          ) : null}
        </section>

        <section>
          <div className="v3-wizard-section-label">Programme details</div>
          <div className="v3-wizard-grid">
            <label>
              <div className="v3-field-label">Programme name <span style={{ color: "var(--v3-accent)" }} aria-hidden="true">*</span></div>
              <input className={prefillClass("name")} required aria-required="true" title={prefilledFields.has("name") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Programme name" type="text" placeholder="e.g. ERP Transformation" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Client / organisation <span style={{ color: "var(--v3-accent)" }} aria-hidden="true">*</span></div>
              <input className={prefillClass("client")} required aria-required="true" title={prefilledFields.has("client") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Client or organisation" type="text" placeholder="e.g. Acme Corp" value={client} onChange={(event) => setClient(event.target.value)} />
            </label>
          </div>
          {!canSave ? (
            <div style={{ fontSize: 11, color: "var(--v3-amber)", marginTop: 8 }}>
              Programme name and client / organisation are required.
            </div>
          ) : null}
        </section>

        <section>
          <div className="v3-wizard-section-label">What are you building?</div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Optional — sets the delivery methodology. <strong>Agentic System Build</strong> runs ATOS Flow:
            conversations in, systems out; the gate is a demo, not a document.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {orderedArchetypes.map((archetype) => {
              const selected = archetypeId === archetype.id;
              const isFlow = archetype.methodologyVariant === "atos-flow";
              return (
                <button
                  key={archetype.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setArchetypeId(selected ? "" : archetype.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "var(--v3-radius)",
                    cursor: "pointer",
                    background: selected ? "var(--v3-surface-2)" : "var(--v3-surface)",
                    border: selected ? "1.5px solid var(--v3-accent)" : "1px solid var(--v3-border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span aria-hidden="true">{archetype.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>{archetype.label}</span>
                    {isFlow ? <span className="v3-chip indigo" style={{ fontSize: 9 }}>ATOS Flow</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4, lineHeight: 1.4 }}>
                    {archetype.description}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="v3-wizard-footer">
          <button type="button" className="v3-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="v3-button primary"
            disabled={isSaving || !canSave}
            title={!canSave ? "Enter a programme name and client / organisation to continue" : undefined}
            onClick={() => {
              const archetype = PROGRAM_ARCHETYPES.find((entry) => entry.id === archetypeId) ?? null;
              // An archetype pick seeds the spine of ITS methodology — Flow's
              // movements for Agentic System Build — carrying over progress and
              // target dates for any phase ids the spines share. No archetype
              // keeps the programme's current phases untouched.
              const phasePatch = archetype
                ? getPhaseSequence(archetype.methodologyVariant).map((id) => {
                    const existing = phases.find((phase) => phase.id === id);
                    return { id, pct: existing?.pct ?? 0, targetDate: existing?.targetDate ?? "" };
                  })
                : phases.map((phase) => ({ id: phase.id, pct: phase.pct, targetDate: phase.targetDate }));
              return onSave({
                name: name.trim(),
                client: client.trim(),
                ...(archetype ? { archetype: archetype.id, methodology: archetype.methodologyVariant } : {}),
                phases: phasePatch,
              });
            }}
          >
            {isSaving ? "Saving…" : "Save & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
