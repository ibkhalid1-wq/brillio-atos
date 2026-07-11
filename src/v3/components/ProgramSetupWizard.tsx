import React, { useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { supabase } from "@/integrations/supabase/client";
import { parseDocumentToText } from "@/new/lib/parseDocumentToText";
import { PROGRAM_ARCHETYPES, getPhaseSequence, INDUSTRY_OPTIONS, type MethodologyVariant } from "@/v3/lib/methodology";

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
  /** Baseline mandate facts, written into Frame's inputs — early evidence,
   * captured at setup, so the first generator runs are grounded. */
  frameBaseline?: { industry?: string; sponsor?: string; targetFirstDemoDate?: string };
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
  // ATOS Flow is the only delivery model — every programme is an Agentic
  // System Build. The card states the identity; there is nothing to pick.
  const flowArchetype = useMemo(
    () => PROGRAM_ARCHETYPES.find((a) => a.methodologyVariant === "atos-flow") ?? null,
    [],
  );
  // Baseline mandate facts — identity the consultant knows before any
  // conversation. Written into Frame's inputs so gates tick from minute one
  // and the ontology's vocabulary steering never falls back silently.
  const frameInputs = useMemo(() => {
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
    const buckets = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
      ? inner.phaseInputs as Record<string, Record<string, unknown>> : {};
    return buckets.frame ?? {};
  }, [program]);
  const [industry, setIndustry] = useState<string>(typeof frameInputs.industry === "string" ? frameInputs.industry : "");
  const [sponsor, setSponsor] = useState<string>(typeof frameInputs.sponsor === "string" ? frameInputs.sponsor : "");
  const [firstDemoDate, setFirstDemoDate] = useState<string>(typeof frameInputs.targetFirstDemoDate === "string" ? frameInputs.targetFirstDemoDate : "");
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
  const canSave = name.trim().length > 0 && client.trim().length > 0 && industry.trim().length > 0;

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
              Programme name, client / organisation and industry are required.
            </div>
          ) : null}
        </section>

        <section>
          <div className="v3-wizard-section-label">Baseline — grounds the first generations</div>
          <div className="v3-wizard-grid">
            <label>
              <div className="v3-field-label">Industry / sector <span style={{ color: "var(--v3-accent)" }} aria-hidden="true">*</span></div>
              <select className="v3-input" required aria-required="true" aria-label="Industry" value={industry}
                onChange={(event) => setIndustry(event.target.value)}>
                <option value="">Select…</option>
                {INDUSTRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <div style={{ fontSize: 10.5, color: "var(--v3-text-muted)", marginTop: 4, lineHeight: 1.4 }}>
                Steers the ontology&apos;s shared vocabulary — FIBO, GS1, FHIR, or schema.org.
              </div>
            </label>
            <label>
              <div className="v3-field-label">Executive sponsor</div>
              <input className="v3-input" aria-label="Executive sponsor" type="text" placeholder="Name and title"
                value={sponsor} onChange={(event) => setSponsor(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Target first-demo date</div>
              <input className="v3-input" aria-label="Target first-demo date" type="date"
                value={firstDemoDate} onChange={(event) => setFirstDemoDate(event.target.value)} />
              <div style={{ fontSize: 10.5, color: "var(--v3-text-muted)", marginTop: 4, lineHeight: 1.4 }}>
                Flow&apos;s headline metric — days to the first stakeholder demonstration.
              </div>
            </label>
          </div>
        </section>

        <section>
          <div className="v3-wizard-section-label">What are you building?</div>
          {flowArchetype ? (
            <div
              style={{
                textAlign: "left", padding: "12px 14px", borderRadius: "var(--v3-radius)",
                background: "var(--v3-surface-2)", border: "1.5px solid var(--v3-accent)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span aria-hidden="true">{flowArchetype.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>{flowArchetype.label}</span>
                <span className="v3-chip indigo" style={{ fontSize: 9 }}>ATOS Flow</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4, lineHeight: 1.4 }}>
                Conversations in, systems out — the gate is a demonstration, not a document. Every programme runs the engagement loop: Frame → Listen → Envision → Show → Ship → Evolve.
              </div>
            </div>
          ) : null}
        </section>

        <div className="v3-wizard-footer">
          <button type="button" className="v3-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="v3-button primary"
            disabled={isSaving || !canSave}
            title={!canSave ? "Enter a programme name, client and industry to continue" : undefined}
            onClick={() => {
              // Every programme is an Agentic System Build: seed the Flow spine,
              // carrying over progress and target dates for shared phase ids.
              const phasePatch = getPhaseSequence("atos-flow").map((id) => {
                const existing = phases.find((phase) => phase.id === id);
                return { id, pct: existing?.pct ?? 0, targetDate: existing?.targetDate ?? "" };
              });
              const baseline: Record<string, string> = {};
              if (industry.trim()) baseline.industry = industry.trim();
              if (sponsor.trim()) baseline.sponsor = sponsor.trim();
              if (firstDemoDate) baseline.targetFirstDemoDate = firstDemoDate;
              return onSave({
                name: name.trim(),
                client: client.trim(),
                ...(flowArchetype ? { archetype: flowArchetype.id } : {}),
                methodology: "atos-flow",
                phases: phasePatch,
                ...(Object.keys(baseline).length ? { frameBaseline: baseline } : {}),
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
