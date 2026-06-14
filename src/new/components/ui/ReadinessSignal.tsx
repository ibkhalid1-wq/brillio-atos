import React from "react";
import type { AppView } from "@/new/types";

export interface ReadinessSignalProps {
  canProceed: boolean;
  readinessScore: number;
  blockers: { label: string; severity: "critical" | "high" | "medium"; action?: string; actionView?: AppView }[];
  topRisks: { label: string; severity: "high" | "medium" | "low" }[];
  phase: string;
  onAction?: (view: AppView) => void;
}

function severityTone(severity: "critical" | "high" | "medium" | "low"): string {
  switch (severity) {
    case "critical":
      return "red";
    case "high":
      return "amber";
    case "medium":
      return "blue";
    default:
      return "green";
  }
}

export function ReadinessSignal({ canProceed, blockers, topRisks, phase, onAction }: ReadinessSignalProps) {
  const topBlocker = blockers[0];
  return (
    <section className="adam-card adam-stack p-5">
      <div className="adam-stack" style={{ gap: 8 }}>
        <div className="adam-micro adam-muted">Readiness for {phase}</div>
        <div className="adam-heading-lg" style={{ color: canProceed ? "#86efac" : "#fca5a5" }}>
          {canProceed ? "Ready to advance" : "Not ready yet"}
        </div>
        <div className="adam-body adam-muted">
          {canProceed
            ? "ADAM sees enough evidence to move this phase forward cleanly."
            : topBlocker
              ? topBlocker.label
              : "A few critical conditions still need attention."}
        </div>
      </div>

      <div className="adam-divider" />

      <div className="adam-stack">
        <div className="adam-title">What is blocking us?</div>
        {blockers.length ? (
          <div className="adam-list">
            {blockers.map((blocker) => (
              <button
                key={blocker.label}
                type="button"
                className="adam-list-item adam-row adam-space-between"
                onClick={() => blocker.actionView && onAction?.(blocker.actionView)}
              >
                <div className="adam-stack" style={{ gap: 4, alignItems: "flex-start" }}>
                  <span className="adam-body">{blocker.label}</span>
                  {blocker.action ? <span className="adam-micro adam-muted">{blocker.action}</span> : null}
                </div>
                <span className={`adam-badge ${severityTone(blocker.severity)}`}>{blocker.severity}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="adam-list-item adam-body" style={{ color: "#86efac" }}>
            No blockers.
          </div>
        )}
      </div>

      <div className="adam-stack">
        <div className="adam-title">What risk exists?</div>
        {topRisks.length ? (
          <div className="adam-list">
            {topRisks.slice(0, 3).map((risk) => (
              <div key={risk.label} className="adam-list-item adam-row adam-space-between">
                <span className="adam-body">{risk.label}</span>
                <span className={`adam-badge ${severityTone(risk.severity)}`}>{risk.severity}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="adam-list-item adam-body" style={{ color: "#86efac" }}>
            No critical risks.
          </div>
        )}
      </div>
    </section>
  );
}
