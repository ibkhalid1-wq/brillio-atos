/**
 * Programme setup — a moment, not a movement. Sixty seconds of identity
 * (name, client) and baseline (industry, sponsor, first-demo date), then the
 * loop starts with a conversation. Every programme is an agentic system
 * build on ATOS Flow, so there is nothing to pick — the wizard captures
 * facts, and the baseline lands in Frame's inputs as early evidence.
 */
import { useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { supabase } from "@/integrations/supabase/client";
import { parseDocumentToText } from "@/new/lib/parseDocumentToText";
import { getPhaseSequence, INDUSTRY_OPTIONS, INDUSTRY_SEGMENTS, type MethodologyVariant } from "@/v3/lib/methodology";

interface ProgramSetupWizardProps {
  program: ProgramSummary;
  onSave: (patch: ProgramSetupPatch) => Promise<void>;
  onClose: () => void;
  isSaving: boolean;
}

export interface ProgramSetupPatch {
  name: string;
  client: string;
  /** Methodology variant. Always "atos-flow" — kept in the shape for the save path. */
  methodology?: MethodologyVariant;
  /** Baseline mandate facts, written into Frame's inputs — early evidence,
   * captured at setup, so the first generator runs are grounded. */
  frameBaseline?: { industry?: string; segment?: string; sponsor?: string; sponsorEmail?: string; targetFirstDemoDate?: string };
  phases: Array<{
    id: string;
    pct: number;
    targetDate: string;
  }>;
}

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
  const isNew = program.name === "New Program" || program.name === "New Programme" || !program.name;
  const [name, setName] = useState(isNew ? "" : program.name || "");
  const [client, setClient] = useState(typeof projectMeta.client === "string" ? projectMeta.client : program.client || "");

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
  const [segment, setSegment] = useState<string>(typeof frameInputs.segment === "string" ? frameInputs.segment : "");
  const segmentOptions = INDUSTRY_SEGMENTS[industry] ?? null;
  const [sponsor, setSponsor] = useState<string>(typeof frameInputs.sponsor === "string" ? frameInputs.sponsor : "");
  const [sponsorEmail, setSponsorEmail] = useState<string>(typeof frameInputs.sponsorEmail === "string" ? frameInputs.sponsorEmail : "");
  const [firstDemoDate, setFirstDemoDate] = useState<string>(typeof frameInputs.targetFirstDemoDate === "string" ? frameInputs.targetFirstDemoDate : "");

  const phases = useMemo(() => program.phases.map((phase) => ({
    id: phase.id,
    pct: Math.max(0, Math.min(100, Math.round(phase.pct ?? 0))),
    targetDate: targetDates[phase.id] || "",
  })), [program.phases, targetDates]);

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
    } catch (error: unknown) {
      setPrefillError(error instanceof Error ? error.message : "Couldn't extract fields automatically. Please fill them in manually.");
    } finally {
      setPrefilling(false);
    }
  }

  const prefillMark = (field: string) => (prefilledFields.has(field) && !prefilling ? " is-prefilled" : "");

  const canSave = name.trim().length > 0 && client.trim().length > 0 && industry.trim().length > 0;

  return (
    <div className="v3-wizard-overlay" role="dialog" aria-modal="true" aria-label="Programme setup">
      <div className="v3-wizard v3-wizard--setup">
        <div className="v3-wizard-head">
          <span className="v3-wizard-eyebrow">ATOS Flow · {isNew ? "New programme" : "Programme setup"}</span>
          <h2 className="v3-wizard-title">{isNew ? "Set up the engagement" : "Programme setup"}</h2>
        </div>

        <section>
          <div className="v3-wizard-section-label">Programme</div>
          <div className="v3-wizard-grid">
            <label>
              <div className="v3-field-label">Programme name <em aria-hidden="true">*</em></div>
              <input className={`v3-input${prefillMark("name")}`} required aria-required="true"
                title={prefilledFields.has("name") ? "Extracted from the uploaded document — verify before saving" : undefined}
                aria-label="Programme name" type="text" placeholder="e.g. Commercial Ops Copilot" autoFocus={isNew}
                value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Client / organisation <em aria-hidden="true">*</em></div>
              <input className={`v3-input${prefillMark("client")}`} required aria-required="true"
                title={prefilledFields.has("client") ? "Extracted from the uploaded document — verify before saving" : undefined}
                aria-label="Client or organisation" type="text" placeholder="e.g. Acme Corp"
                value={client} onChange={(event) => setClient(event.target.value)} />
            </label>
          </div>
        </section>

        <section>
          <div className="v3-wizard-section-label">Baseline</div>
          <div className="v3-wizard-grid">
            <label>
              <div className="v3-field-label">Industry / sector <em aria-hidden="true">*</em></div>
              <select className="v3-input" required aria-required="true" aria-label="Industry" value={industry}
                onChange={(event) => setIndustry(event.target.value)}>
                <option value="">Select…</option>
                {INDUSTRY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <div className="v3-field-hint">
                Selects the ontology&apos;s standards vocabulary — FIBO, FHIR, GS1, IEC CIM, EBUCore, W3C ORG or schema.org.
              </div>
            </label>
            {/* The slot is always reserved so the grid never reflows; it only
                becomes visible for the sectors whose grounding forks. */}
            <label style={{ visibility: segmentOptions ? "visible" : "hidden" }} aria-hidden={!segmentOptions}>
              <div className="v3-field-label">Value-chain segment</div>
              <select className="v3-input" aria-label="Value-chain segment" disabled={!segmentOptions}
                tabIndex={segmentOptions ? undefined : -1}
                value={segmentOptions?.includes(segment) ? segment : ""}
                onChange={(event) => setSegment(event.target.value)}>
                <option value="">Not sure yet — infer from evidence</option>
                {(segmentOptions ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <div className="v3-field-hint">Sharpens the vocabulary and discovery scope.</div>
            </label>
            <label>
              <div className="v3-field-label">Executive sponsor</div>
              <input className="v3-input" aria-label="Executive sponsor" type="text" placeholder="Name and title"
                value={sponsor} onChange={(event) => setSponsor(event.target.value)} />
              <div className="v3-field-label">Sponsor email</div>
              <input className="v3-input" aria-label="Sponsor email" type="email" placeholder="name@company.com"
                value={sponsorEmail} onChange={(event) => setSponsorEmail(event.target.value)} />
            </label>
            <label>
              <div className="v3-field-label">Target first-demo date</div>
              <input className="v3-input" aria-label="Target first-demo date" type="date"
                value={firstDemoDate} onChange={(event) => setFirstDemoDate(event.target.value)} />
              <div className="v3-field-hint">
                The headline metric — days to the first stakeholder demonstration.
              </div>
            </label>
          </div>
        </section>

        <section>
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
            className={`v3-wizard-prefill${prefilling ? " is-busy" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={prefilling}
          >
            <span aria-hidden="true">{prefilling ? "◌" : "↑"}</span>
            {prefilling ? "Extracting details…" : "Or upload a charter / SOW and ATOS pre-fills what it can"}
          </button>
          {prefillError ? <div className="v3-wizard-note is-warn">{prefillError}</div> : null}
        </section>

        {!canSave ? (
          <div className="v3-wizard-note">Programme name, client and industry are required.</div>
        ) : null}

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
              // Every programme is an agentic system build: seed the Flow spine,
              // carrying over progress and target dates for shared phase ids.
              const phasePatch = getPhaseSequence("atos-flow").map((id) => {
                const existing = phases.find((phase) => phase.id === id);
                return { id, pct: existing?.pct ?? 0, targetDate: existing?.targetDate ?? "" };
              });
              const baseline: Record<string, string> = {};
              if (industry.trim()) baseline.industry = industry.trim();
              const validSegment = (INDUSTRY_SEGMENTS[industry.trim()] ?? []).includes(segment) ? segment : "";
              if (validSegment) baseline.segment = validSegment;
              if (sponsor.trim()) baseline.sponsor = sponsor.trim();
              if (sponsorEmail.trim()) baseline.sponsorEmail = sponsorEmail.trim();
              if (firstDemoDate) baseline.targetFirstDemoDate = firstDemoDate;
              return onSave({
                name: name.trim(),
                client: client.trim(),
                methodology: "atos-flow",
                phases: phasePatch,
                ...(Object.keys(baseline).length ? { frameBaseline: baseline } : {}),
              });
            }}
          >
            {isSaving ? "Saving…" : isNew ? "Begin the engagement" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
