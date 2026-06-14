import React, { useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { supabase } from "@/integrations/supabase/client";
import { parseDocumentToText } from "@/new/lib/parseDocumentToText";

interface ProgramSetupWizardProps {
  program: ProgramSummary;
  onSave: (patch: ProgramSetupPatch) => Promise<void>;
  onClose: () => void;
  isSaving: boolean;
}

export interface ProgramSetupPatch {
  name: string;
  client: string;
  industry: string;
  objective: string;
  startDate: string;
  targetEndDate: string;
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

const ARCHETYPES: Array<{ id: string; icon: string; label: string; description: string; popular?: boolean }> = [
  { id: "technology-implementation", icon: "⚙", label: "Technology Implementation", description: "Deploying a platform, system migration, or software rollout", popular: true },
  { id: "business-transformation", icon: "◈", label: "Business Transformation", description: "Operating model change, org redesign, or strategic shift" },
  { id: "regulatory-programme", icon: "⊞", label: "Regulatory Programme", description: "Compliance-driven with mandated controls and formal governance" },
  { id: "agile-delivery", icon: "◎", label: "Agile Delivery", description: "Iterative delivery using sprints, backlogs, and continuous release" },
];

export default function ProgramSetupWizard({ program, onSave, onClose, isSaving }: ProgramSetupWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  const projectMeta = useMemo(() => readProjectMeta(program), [program]);
  const targetDates = useMemo(() => phaseTargetDates(program), [program]);
  const [prefilling, setPrefilling] = useState(false);
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(new Set());
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [name, setName] = useState(program.name === "New Program" ? "" : program.name || "");
  const [client, setClient] = useState(typeof projectMeta.client === "string" ? projectMeta.client : program.client || "");
  const [industry, setIndustry] = useState(typeof projectMeta.industry === "string" ? projectMeta.industry : program.industry || "");
  const [startDate, setStartDate] = useState(typeof projectMeta.startDate === "string" ? projectMeta.startDate : "");
  const [targetEndDate, setTargetEndDate] = useState(typeof projectMeta.targetEndDate === "string" ? projectMeta.targetEndDate : "");
  const [objective, setObjective] = useState(program.objective || "");
  const [phases, setPhases] = useState<PhaseForm[]>(
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
      if (typeof fields.industry === "string" && fields.industry.trim()) {
        setIndustry(fields.industry.trim());
        nextPrefilled.add("industry");
      }
      if (Array.isArray(fields.objectives) && fields.objectives.length) {
        setObjective(fields.objectives.filter((value): value is string => typeof value === "string").join(". "));
        nextPrefilled.add("objective");
      }
      if (typeof fields.startDate === "string" && fields.startDate) {
        setStartDate(fields.startDate.slice(0, 10));
        nextPrefilled.add("startDate");
      }
      if (typeof fields.endDate === "string" && fields.endDate) {
        setTargetEndDate(fields.endDate.slice(0, 10));
        nextPrefilled.add("targetEndDate");
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

  return (
    <div className="v3-wizard-overlay" role="dialog" aria-modal="true" aria-label="Program setup">
      <div className="v3-wizard">
        {step === 0 ? (
          <>
            <div>
              <h2 className="v3-wizard-title">What kind of programme is this?</h2>
              <p style={{ fontSize: 13, color: "var(--v3-text-muted)", marginTop: 4 }}>
                ADAM will tailor the methodology, gates, and suggested KPIs to match your programme type.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "16px 0" }}>
              {ARCHETYPES.map((archetype) => {
                const selected = selectedArchetype === archetype.id;
                return (
                  <button
                    key={archetype.id}
                    type="button"
                    onClick={() => setSelectedArchetype(archetype.id)}
                    style={{
                      position: "relative",
                      border: selected ? "2px solid var(--v3-accent)" : "1.5px solid var(--v3-border)",
                      background: selected ? "var(--v3-accent-soft)" : "var(--v3-surface-2)",
                      borderRadius: 10,
                      padding: 16,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                    aria-pressed={selected}
                  >
                    {archetype.popular ? (
                      <span style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--v3-accent)",
                        background: "var(--v3-accent-soft)",
                        border: "1px solid var(--v3-accent-glow)",
                        borderRadius: 4,
                        padding: "1px 6px",
                        letterSpacing: "0.04em",
                      }}>Most popular</span>
                    ) : null}
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{archetype.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--v3-text-primary)", marginBottom: 4 }}>{archetype.label}</div>
                    <div style={{ fontSize: 12, color: "var(--v3-text-muted)", lineHeight: 1.4 }}>{archetype.description}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="v3-button primary"
                disabled={!selectedArchetype}
                onClick={() => setStep(1)}
              >
                Next
              </button>
              <button
                type="button"
                style={{ fontSize: 12, color: "var(--v3-text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                onClick={() => setStep(1)}
              >
                Skip — I&apos;ll configure manually
              </button>
            </div>
          </>
        ) : (
        <>
        <div>
          <h2 className="v3-wizard-title">Program setup</h2>
        </div>

        <section>
          <div className="v3-wizard-section-label">Pre-fill from a document</div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginBottom: 8 }}>
            Upload a project charter, SOW, or briefing document and we&apos;ll pre-fill what we can.
          </div>
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
          <button type="button" className="v3-button ghost" onClick={() => fileInputRef.current?.click()} disabled={prefilling}>
            {prefilling ? "Extracting…" : "Upload and pre-fill"}
          </button>
          {prefillError ? (
            <div style={{ fontSize: 11, color: "var(--v3-amber)", marginTop: 8 }}>{prefillError}</div>
          ) : null}
        </section>

        <section>
          <div className="v3-wizard-section-label">Program details</div>
          <div className="v3-wizard-grid">
            <label>
              <div className="v3-field-label">Program name</div>
              <input className={prefillClass("name")} title={prefilledFields.has("name") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Program name" type="text" placeholder="e.g. ERP Transformation" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Client / organisation</div>
              <input className={prefillClass("client")} title={prefilledFields.has("client") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Client or organisation" type="text" placeholder="e.g. Acme Corp" value={client} onChange={(event) => setClient(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Industry</div>
              <input className={prefillClass("industry")} title={prefilledFields.has("industry") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Industry" type="text" placeholder="e.g. Financial Services" value={industry} onChange={(event) => setIndustry(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Program start date</div>
              <input className={prefillClass("startDate")} title={prefilledFields.has("startDate") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Program start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Target end date</div>
              <input className={prefillClass("targetEndDate")} title={prefilledFields.has("targetEndDate") ? "Extracted from uploaded document — verify before saving" : undefined} aria-label="Target end date" type="date" value={targetEndDate} onChange={(event) => setTargetEndDate(event.target.value)} />
            </label>
          </div>
        </section>

        <section>
          <div className="v3-wizard-section-label">Program objective</div>
          <label>
            <textarea
              className={`${prefillClass("objective")} v3-textarea`}
              aria-label="Program objective"
              rows={4}
              maxLength={500}
              placeholder="Describe what this transformation is trying to achieve and why it matters."
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <div className="v3-char-count">{objective.length} / 500</div>
        </section>

        <section>
          <div className="v3-wizard-section-label">Phase progress</div>
          <div style={{ display: "grid", gap: 4 }}>
            {phases.map((phase) => (
              <div key={phase.id} className="v3-wizard-phase-row">
                <div className="v3-wizard-phase-row-name">{phase.label}</div>
                <input
                  className="v3-range"
                  aria-label={`${phase.label} progress`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={phase.pct}
                  onChange={(event) => {
                    const nextPct = Number(event.target.value);
                    setPhases((current) => current.map((entry) => entry.id === phase.id ? { ...entry, pct: nextPct } : entry));
                  }}
                />
                <div className="v3-wizard-phase-row-pct">{phase.pct}%</div>
                <input
                  className="v3-input"
                  aria-label={`${phase.label} target date`}
                  type="date"
                  value={phase.targetDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setPhases((current) => current.map((entry) => entry.id === phase.id ? { ...entry, targetDate: nextDate } : entry));
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="v3-button ghost" onClick={onClose}>
            Skip for now
          </button>
          <button
            type="button"
            className="v3-button primary"
            disabled={isSaving}
            onClick={() => onSave({
              name: name.trim() || "New Program",
              client: client.trim(),
              industry: industry.trim(),
              objective: objective.trim(),
              startDate,
              targetEndDate,
              phases: phases.map((phase) => ({ id: phase.id, pct: phase.pct, targetDate: phase.targetDate })),
            })}
          >
            {isSaving ? "Saving…" : "Save & close"}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
