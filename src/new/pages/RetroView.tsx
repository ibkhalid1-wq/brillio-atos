import React, { useEffect, useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";

interface RetroViewProps {
  program: ProgramSummary | null;
  runningPhases: Set<string>;
  onTriggerRetro: (phaseId: string) => void;
  onOpenIntelligence: () => void;
}

const CATEGORY_TONES: Record<string, string> = {
  people: "blue",
  process: "green",
  technology: "amber",
  governance: "slate",
};

const PRIORITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function RetroView({
  program,
  runningPhases,
  onTriggerRetro,
  onOpenIntelligence,
}: RetroViewProps) {
  const availablePhases = useMemo(
    () => (program?.phases || []).filter((phase) => phase.pct >= 80),
    [program],
  );
  const [selectedPhaseId, setSelectedPhaseId] = useState(availablePhases[0]?.id || "strategy");

  useEffect(() => {
    if (!availablePhases.length) return;
    if (!availablePhases.some((phase) => phase.id === selectedPhaseId)) {
      setSelectedPhaseId(availablePhases[0].id);
    }
  }, [availablePhases, selectedPhaseId]);

  if (!program) {
    return (
      <NotReadyCard
        title="Retrospectives"
        reason="No active program. Connect Supabase and choose a program to review lessons learned."
      />
    );
  }

  if (!availablePhases.length) {
    return (
      <NotReadyCard
        title="Retrospectives"
        reason="ADAM generates a retrospective once a phase reaches 90% completion."
      />
    );
  }

  const phase = availablePhases.find((entry) => entry.id === selectedPhaseId) || availablePhases[0];
  const retro = program.retros[phase.id] || null;
  const isRunning = runningPhases.has(phase.id);
  const generatedAt = program.retrosGeneratedAt[phase.id] || null;
  const sortedActions = retro
    ? [...retro.actionItems].sort((left, right) => (
      PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority]
    ))
    : [];

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Phase Retrospectives</div>
            <div className="adam-body adam-muted">
              Capture what accelerated the work, what created drag, and what the next phase should inherit.
            </div>
            {generatedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(generatedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="v3-button ghost"
            style={{ fontSize: 12 }}
            onClick={onOpenIntelligence}
          >
            View history & autonomy →
          </button>
          <button
            type="button"
            className="adam-button-ghost"
            onClick={() => onTriggerRetro(phase.id)}
            disabled={isRunning}
          >
            {isRunning ? "Generating…" : "Generate retrospective"}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {availablePhases.map((entry) => {
            const hasRetro = Boolean(program.retros[entry.id]);
            return (
              <button
                key={entry.id}
                type="button"
                className={`adam-chip ${entry.id === phase.id ? "is-active" : ""}`}
                onClick={() => setSelectedPhaseId(entry.id)}
              >
                <span>{entry.displayName}</span>
                <span className="adam-micro adam-muted">{hasRetro ? "ready" : `${entry.pct}%`}</span>
              </button>
            );
          })}
        </div>
      </section>

      {!retro ? (
        <NotReadyCard
          title={`${phase.displayName} retrospective`}
          reason="ADAM generates a retrospective once a phase reaches 90% completion."
          onTrigger={() => onTriggerRetro(phase.id)}
          triggerLabel="Generate retrospective"
          isRunning={isRunning}
        />
      ) : (
        <>
          <section className="adam-card p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="adam-row" style={{ gap: 10, flexWrap: "wrap" }}>
                <span className={`adam-badge ${retro.overallSentiment === "positive" ? "green" : retro.overallSentiment === "mixed" ? "amber" : "red"}`}>
                  {retro.overallSentiment}
                </span>
                <span className="adam-badge blue">{retro.healthScore} health score</span>
                <span className={`v3-chip ${confidenceTone(retro.confidence)}`} title={confidenceLabel(retro.confidence)}>
                  {Math.round(retro.confidence * 100)}% confidence
                </span>
              </div>
            </div>
            <div className="adam-retro-key-learning mt-4">
              <div className="adam-micro adam-muted">Key learning</div>
              <div className="adam-heading-lg">{retro.keyLearning}</div>
            </div>
          </section>

          <div className="adam-grid two">
            <section className="adam-card p-5" style={{ background: "rgba(22,163,74,0.08)", borderColor: "rgba(22,163,74,0.18)" }}>
              <div className="adam-title">What went well</div>
              <div className="mt-4 adam-stack">
                {retro.wentWell.length ? retro.wentWell.map((item, index) => (
                  <div key={`${item.observation}-${index}`} className="adam-list-item">
                    <div className="adam-body">{item.observation}</div>
                    <div className="mt-2 adam-micro adam-muted">{item.impact}</div>
                    <div className="mt-3">
                      <span className={`adam-badge ${CATEGORY_TONES[item.category] || "slate"}`}>{item.category}</span>
                    </div>
                  </div>
                )) : (
                  <div className="adam-list-item adam-body adam-muted">No accelerators were captured for this phase yet.</div>
                )}
              </div>
            </section>

            <section className="adam-card p-5" style={{ background: "rgba(217,119,6,0.08)", borderColor: "rgba(217,119,6,0.18)" }}>
              <div className="adam-title">Improvements</div>
              <div className="mt-4 adam-stack">
                {retro.improvements.length ? retro.improvements.map((item, index) => (
                  <div key={`${item.observation}-${index}`} className="adam-list-item">
                    <div className="adam-body">{item.observation}</div>
                    <div className="mt-2 adam-micro adam-muted">{item.rootCause}</div>
                    <div className="mt-3">
                      <span className={`adam-badge ${CATEGORY_TONES[item.category] || "slate"}`}>{item.category}</span>
                    </div>
                  </div>
                )) : (
                  <div className="adam-list-item adam-body adam-muted">No major friction patterns were recorded for this phase.</div>
                )}
              </div>
            </section>
          </div>

          <section className="adam-card p-5">
            <div className="adam-title">Action items to carry forward</div>
            <div className="mt-4 adam-stack">
              {sortedActions.length ? sortedActions.map((item, index) => (
                <div key={`${item.action}-${index}`} className="adam-list-item">
                  <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div className="adam-stack" style={{ gap: 4 }}>
                      <div className="adam-body">{item.action}</div>
                      <div className="adam-micro adam-muted">
                        {item.owner ? `Owner ${item.owner}` : "Owner to assign"} · {item.targetPhase}
                      </div>
                    </div>
                    <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <span className={`adam-badge ${item.priority === "high" ? "red" : item.priority === "medium" ? "amber" : "green"}`}>
                        {item.priority} priority
                      </span>
                      <span className={`adam-badge ${item.effort === "high" ? "red" : item.effort === "medium" ? "amber" : "blue"}`}>
                        {item.effort} effort
                      </span>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No carry-forward actions were proposed from this phase.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
