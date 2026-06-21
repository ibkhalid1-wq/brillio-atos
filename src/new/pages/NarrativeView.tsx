import React, { useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";
import { exportAsPDF, exportAsDocx, narrativeToHtml } from "@/v3/lib/documentExport";
import DocumentRefinePanel from "@/v3/components/DocumentRefinePanel";

interface NarrativeViewProps {
  program: ProgramSummary | null;
  onRefresh: () => void;
  isRunning?: boolean;
  onSaveCorrection: (note: string) => Promise<void>;
  onOpenIntelligence: () => void;
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

function isStale(timestamp: string): boolean {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > ONE_DAY_MS;
}

export function NarrativeView({
  program,
  onRefresh,
  isRunning = false,
  onSaveCorrection,
  onOpenIntelligence,
}: NarrativeViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Program narrative"
        reason="No active program. Connect Supabase and select a program to generate an executive narrative."
      />
    );
  }

  const activePhase = program.phases.find((phase) => phase.id === program.activePhaseId) || program.phases[0] || null;
  const hasNarrative = !!program.narrative;
  const freshness = hasNarrative && program.narrativeGeneratedAt ? !isStale(program.narrativeGeneratedAt) : false;
  const confidence = typeof program.narrativeConfidence === "number"
    ? Math.max(0, Math.min(1, program.narrativeConfidence))
    : null;
  const openDecisions = program.decisionQueue.filter((entry) => entry.status !== "resolved").length;
  const [audience, setAudience] = useState("Executive");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showRefinePanel, setShowRefinePanel] = useState(false);
  const narrative = program.narrative || "";
  const programId = program?.id ?? null;

  return (
    <div className="adam-stack" style={{ maxWidth: 980 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Program Narrative</div>
            <div className="adam-body adam-muted">
              ATOS’s executive summary of the current transformation posture and what matters next.
            </div>
            {hasNarrative && program.narrativeGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Generated {new Date(program.narrativeGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {confidence !== null ? (
              <span className={`v3-chip ${confidenceTone(confidence)}`} title={confidenceLabel(confidence)}>
                {Math.round(confidence * 100)}% confidence
              </span>
            ) : null}
            {hasNarrative ? (
              <span className={`adam-badge ${freshness ? "green" : "amber"}`}>
                {freshness ? "Fresh" : "Stale"}
              </span>
            ) : null}
            <button
              type="button"
              className="v3-button ghost"
              style={{ fontSize: 12 }}
              onClick={onOpenIntelligence}
            >
              View history & autonomy →
            </button>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", color: "var(--v3-text-secondary)", cursor: "pointer" }}
            >
              {["Executive", "Project Team", "Regulator", "Board"].map((a) => <option key={a}>{a}</option>)}
            </select>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onRefresh}
              disabled={isRunning}
            >
              {isRunning ? "Refreshing…" : hasNarrative ? "Refresh" : "Generate narrative"}
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", cursor: "pointer", color: "var(--v3-text-secondary)" }}
                onClick={() => setShowExportMenu((v) => !v)}
              >
                Export ▾
              </button>
              {showExportMenu && narrative && (
                <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", zIndex: 50, minWidth: 130 }}>
                  {([["PDF", () => { exportAsPDF(`Programme Narrative — ${program?.name || ""}`, narrativeToHtml({ name: program?.name, client: program?.client }, narrative, confidence ?? 0, program?.narrativeGeneratedAt || new Date().toISOString())); setShowExportMenu(false); }], ["Word Doc", () => { exportAsDocx(`Programme Narrative — ${program?.name || ""}`, narrativeToHtml({ name: program?.name, client: program?.client }, narrative, confidence ?? 0, program?.narrativeGeneratedAt || new Date().toISOString())); setShowExportMenu(false); }]] as Array<[string, () => void]>).map(([label, fn]) => (
                    <button key={label} type="button" onClick={fn} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--v3-text-primary)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--v3-surface-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setShowRefinePanel((v) => !v)}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid var(--v3-border)", background: showRefinePanel ? "var(--v3-accent)" : "var(--v3-surface-2)", cursor: "pointer", color: showRefinePanel ? "#fff" : "var(--v3-text-secondary)" }}>
              ✨ Refine
            </button>
          </div>
        </div>
      </section>

      {hasNarrative ? (
        <section className="adam-card p-6">
          <div style={{ position: "relative" }}>
          {showRefinePanel && programId && (
            <DocumentRefinePanel
              programId={programId}
              artifactType="narrative"
              currentContent={narrative}
              onRefined={() => {
                void onRefresh();
                setShowRefinePanel(false);
              }}
              onClose={() => setShowRefinePanel(false)}
            />
          )}
          <div className="max-w-4xl border-l-4 border-blue-500 pl-5">
            <p className="adam-heading-lg" style={{ fontWeight: 400, lineHeight: 1.7 }}>
              {program.narrative}
            </p>
          </div>

          <div className="mt-5 adam-row adam-space-between" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span className="adam-micro adam-muted">
              Generated {program.narrativeGeneratedAt ? new Date(program.narrativeGeneratedAt).toLocaleString() : "just now"}
            </span>
            <span className={`adam-badge ${freshness ? "green" : "amber"}`}>
              {freshness ? "Fresh context" : "Refresh recommended"}
            </span>
          </div>

          <div className="mt-5 adam-stack" style={{ gap: 8 }}>
            <div className="adam-title">ATOS confidence</div>
            <div style={{ height: 10, borderRadius: 999, background: "rgba(148,163,184,0.2)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.round((confidence ?? 0) * 100)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: confidence !== null && confidence >= 0.7
                    ? "#16a34a"
                    : confidence !== null && confidence >= 0.45
                      ? "#d97706"
                      : "#dc2626",
                }}
              />
            </div>
            <div className="adam-micro adam-muted">
              {confidence !== null ? `${Math.round(confidence * 100)}% confidence based on current program signals.` : "Confidence will appear after the first generated narrative."}
            </div>
          </div>
          </div>
        </section>
      ) : (
        <NotReadyCard
          title="Program narrative"
          reason="ATOS will write a 2–3 sentence executive summary once a phase has measurable progress. No plan required."
          onTrigger={onRefresh}
          triggerLabel="Generate narrative"
          isRunning={isRunning}
        />
      )}

      <section className="adam-card p-5">
        <div className="adam-title">What influences this narrative</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="adam-chip">{activePhase ? activePhase.displayName : "No active phase"}</span>
          <span className="adam-chip">{program.readiness}% readiness</span>
          <span className="adam-chip">{openDecisions} open decisions</span>
        </div>
        <div className="mt-4 adam-body adam-muted">
          ATOS uses current phase progress, open decisions, active risks, milestones, and approved artifacts to shape the executive story.
        </div>
      </section>

      <CorrectionPanel onSave={onSaveCorrection} />
    </div>
  );
}

function CorrectionPanel({ onSave }: { onSave: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="v3-card-sm" style={{ marginTop: 8 }}>
      <button
        type="button"
        className="v3-button ghost"
        style={{ fontSize: 12, width: "100%", justifyContent: "space-between" }}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Add correction or context for ATOS</span>
        <span>{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", lineHeight: 1.6 }}>
            This note will be included as context the next time the narrative is regenerated.
          </div>
          <textarea
            className="v3-input v3-textarea"
            aria-label="Narrative correction"
            placeholder="e.g. The programme is actually tracking ahead of schedule in Mobilise. The board approved early go-live."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => { setOpen(false); setNote(""); }}>Cancel</button>
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              disabled={!note.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(note.trim());
                  setNote("");
                  setOpen(false);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
