import React, { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import type { V3MoreView } from "@/v3/types";
import { phaseName } from "@/v3/utils";

type SheetTab = "summary" | "adam" | "detail";

interface PhaseSheetProps {
  phaseId: string;
  program: ProgramSummary;
  triggers: {
    triggerGateReview?: (phaseId: string) => void;
    gateReviewRunningPhaseSet?: Set<string>;
    triggerRetro?: (phaseId: string) => void;
    retroRunningPhases?: Set<string>;
  };
  onClose: () => void;
  onOpenMoreView: (view: V3MoreView) => void;
}

const DETAIL_LINKS: Array<{ label: string; view: V3MoreView }> = [
  { label: "Risks & issues", view: "risks" },
  { label: "Stakeholder map", view: "stakeholders" },
  { label: "Change impact", view: "change-impact" },
  { label: "Adoption tracker", view: "adoption" },
  { label: "Critical path", view: "critical-path" },
  { label: "Pattern library", view: "intelligence" },
];

export default function PhaseSheet({
  phaseId,
  program,
  triggers,
  onClose,
  onOpenMoreView,
}: PhaseSheetProps) {
  const [tab, setTab] = useState<SheetTab>("summary");

  const phase = useMemo(
    () => program.phases.find((entry) => entry.id === phaseId) || program.phases[0] || null,
    [phaseId, program.phases],
  );

  if (!phase) return null;

  const gateReview = program.gateReviews?.[phase.id];
  const exitCriteria = gateReview?.exitCriteriaStatus || [];
  const phaseActions = (program.plan?.nextThreeActions || []).filter((action) => (
    typeof action.phase === "string" && action.phase.toLowerCase().includes(phase.id.toLowerCase())
  ));
  const completion = Math.round(phase.pct || 0);
  const canRunRetro = completion >= 90;
  const isGateRunning = triggers.gateReviewRunningPhaseSet?.has(phase.id) ?? false;
  const isRetroRunning = triggers.retroRunningPhases?.has(phase.id) ?? false;

  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div className="v3-sheet">
        <div className="v3-sheet-header">
          <div>
            <div className="v3-sheet-title">{phaseName(phase)}</div>
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
              {completion}% complete
            </div>
          </div>
          <button className="v3-sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="v3-sheet-body">
          <div className="v3-sheet-tabs">
            {(["summary", "adam", "detail"] as SheetTab[]).map((item) => (
              <button
                key={item}
                className={`v3-sheet-tab ${tab === item ? "active" : ""}`}
                onClick={() => setTab(item)}
              >
                {item === "summary" ? "Summary" : item === "adam" ? "Insight" : "Detail"}
              </button>
            ))}
          </div>

          {tab === "summary" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>Completion</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{completion}%</span>
                </div>
                <div className="v3-phase-progress-bar" style={{ width: "100%", height: 6 }}>
                  <div className="v3-phase-progress-fill" style={{ width: `${completion}%` }} />
                </div>
              </div>

              <div>
                <div className="v3-card-title">Exit criteria</div>
                {exitCriteria.length ? exitCriteria.map((criterion) => (
                  <div
                    key={criterion.criterion}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "6px 0",
                      borderBottom: "1px solid var(--v3-border-soft)",
                    }}
                  >
                    <span style={{ color: criterion.met ? "var(--v3-green)" : "var(--v3-text-muted)", fontSize: 14 }}>
                      {criterion.met ? "✓" : "○"}
                    </span>
                    <span style={{ fontSize: 13, color: criterion.met ? "var(--v3-text-secondary)" : "var(--v3-text-primary)" }}>
                      {criterion.criterion}
                    </span>
                  </div>
                )) : (
                  <div style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>No exit criteria tracked yet.</div>
                )}
              </div>

              {phaseActions[0]?.action ? (
                <div className="v3-card-sm">
                  <div className="v3-card-title">Next action</div>
                  <div style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>{phaseActions[0].action}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "adam" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="v3-card-sm">
                <div className="v3-card-title">Gate readiness</div>
                {gateReview ? (
                  <div>
                    <span
                      className={`v3-chip ${
                        gateReview.status === "approved" || gateReview.status === "ready"
                          ? "green"
                          : gateReview.status === "remediation-requested"
                            ? "red"
                            : "amber"
                      }`}
                    >
                      {gateReview.status.replace(/-/g, " ").toUpperCase()}
                    </span>
                    <p style={{ fontSize: 13, color: "var(--v3-text-secondary)", marginTop: 10, lineHeight: 1.5 }}>
                      {gateReview.recommendation || "Gate review ready."}
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>No gate review yet.</p>
                )}
                <button
                  className="v3-button ghost"
                  style={{ marginTop: 12, fontSize: 12 }}
                  disabled={isGateRunning}
                  onClick={() => triggers.triggerGateReview?.(phase.id)}
                >
                  {isGateRunning ? "Checking…" : "Check readiness"}
                </button>
              </div>

              {phaseActions.length ? (
                <div>
                  <div className="v3-card-title">Recommendations</div>
                  {phaseActions.map((action, index) => (
                    <div key={`${action.phase}-${action.action}-${index}`} className="v3-card-sm" style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
                        {action.action}
                      </div>
                      {action.rationale ? (
                        <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 6 }}>
                          {action.rationale}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {canRunRetro ? (
                <div className="v3-card-sm">
                  <div className="v3-card-title">Retrospective</div>
                  <p style={{ fontSize: 13, color: "var(--v3-text-muted)", marginBottom: 12 }}>
                    This phase is nearly complete. Run a retrospective to capture learnings.
                  </p>
                  <button
                    className="v3-button ghost"
                    style={{ fontSize: 12 }}
                    disabled={isRetroRunning}
                    onClick={() => triggers.triggerRetro?.(phase.id)}
                  >
                    {isRetroRunning ? "Running retro…" : "Run retrospective"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "detail" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="v3-card-title">Dig deeper</div>
              {DETAIL_LINKS.map((item) => (
                <div
                  key={item.view}
                  className="v3-more-item"
                  onClick={() => onOpenMoreView(item.view)}
                >
                  <span>{item.label}</span>
                  <span style={{ color: "var(--v3-text-muted)" }}>›</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
