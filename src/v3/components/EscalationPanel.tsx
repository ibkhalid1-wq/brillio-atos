import React from "react";
import type { Escalation } from "@/new/types";
import { timeAgo } from "@/v3/utils";

interface EscalationPanelProps {
  escalations: Escalation[];
  onAcknowledge: (id: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function EscalationPanel({ escalations, onAcknowledge, onResolve, onClose }: EscalationPanelProps) {
  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div className="v3-sheet">
        <div className="v3-sheet-header">
          <div className="v3-sheet-title">Escalations</div>
          <button className="v3-sheet-close" onClick={onClose}>×</button>
        </div>
        <div className="v3-sheet-body">
          {escalations.length === 0 ? (
            <div className="v3-empty">
              <div className="v3-empty-icon">◎</div>
              <div className="v3-empty-title">No open escalations</div>
            </div>
          ) : escalations.map((escalation) => (
            <div key={escalation.id} className="v3-card-sm" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span className={`v3-chip ${escalation.severity === "critical" || escalation.severity === "high" ? "red" : "amber"}`}>{escalation.severity}</span>
                <span className="v3-chip muted">{escalation.linkedPhaseId || "Programme"}</span>
                <span className="v3-chip muted">{timeAgo(escalation.raisedAt)}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--v3-text-primary)", marginBottom: 4 }}>{escalation.title}</div>
              {escalation.summary ? <div style={{ fontSize: 13, color: "var(--v3-text-muted)", marginBottom: 10, lineHeight: 1.55 }}>{escalation.summary}</div> : null}
              {escalation.status === "acknowledged" ? (
                <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 8 }}>
                  Acknowledged {escalation.acknowledgedAt ? timeAgo(escalation.acknowledgedAt) : "recently"}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                {escalation.status === "open" ? (
                  <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => void onAcknowledge(escalation.id)}>
                    Acknowledge
                  </button>
                ) : null}
                <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={() => void onResolve(escalation.id)}>
                  Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
