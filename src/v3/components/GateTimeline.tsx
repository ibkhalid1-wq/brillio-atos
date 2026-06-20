import React from "react";

export interface GateEntry {
  phaseId: string;
  phaseLabel: string;
  status: "pending" | "in-review" | "approved" | "remediation-requested";
  readinessScore?: number;
  approvedAt?: string | null;
  approvedBy?: string | null;
  remediationNote?: string | null;
  isCurrent?: boolean;
}

interface GateTimelineProps {
  gates: GateEntry[];
  onSelectGate: (phaseId: string) => void;
  activePhaseId?: string | null;
}

const STATUS_CONFIG = {
  "approved": { color: "var(--v3-green)", icon: "✓", pulse: false },
  "in-review": { color: "var(--v3-accent)", icon: "◎", pulse: true },
  "remediation-requested": { color: "var(--v3-amber)", icon: "⚠", pulse: false },
  "pending": { color: "var(--v3-border)", icon: "○", pulse: false },
};

export function GateTimeline({ gates, onSelectGate, activePhaseId }: GateTimelineProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "var(--v3-space-4) 0" }}>
      {gates.map((gate, idx) => {
        const cfg = STATUS_CONFIG[gate.status];
        const isActive = gate.phaseId === activePhaseId;
        const isLast = idx === gates.length - 1;
        return (
          <div key={gate.phaseId} style={{ display: "flex", gap: 12, paddingBottom: isLast ? 0 : 4 }}>
            {/* Connector + node */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", background: `color-mix(in srgb, ${cfg.color} 15%, var(--v3-surface-2))`,
                border: `2px solid ${cfg.color}`, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, color: cfg.color, flexShrink: 0, cursor: "pointer",
                boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, ${cfg.color} 25%, transparent)` : "none",
                animation: cfg.pulse ? "v3-pulse 1.5s ease-in-out infinite" : "none",
              }} onClick={() => onSelectGate(gate.phaseId)}>
                {cfg.icon}
              </div>
              {!isLast && (
                <div style={{ width: 2, flex: 1, minHeight: 20, background: gate.status === "approved" ? "var(--v3-green)" : "var(--v3-border)", margin: "2px 0", opacity: 0.5 }} />
              )}
            </div>
            {/* Content */}
            <div
              onClick={() => onSelectGate(gate.phaseId)}
              style={{
                flex: 1, paddingBottom: isLast ? 0 : 12, cursor: "pointer",
                paddingTop: 2,
                borderRadius: "var(--v3-radius)", padding: "4px 8px",
                background: isActive ? "var(--v3-accent-soft)" : "transparent",
                border: isActive ? "1px solid var(--v3-accent-glow2)" : "1px solid transparent",
                transition: "background 0.12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? "var(--v3-text-primary)" : "var(--v3-text-secondary)" }}>
                  {gate.phaseLabel}
                </span>
                {gate.readinessScore != null && (
                  <span style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>{gate.readinessScore}%</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                {gate.status === "approved" && gate.approvedBy && `Approved by ${gate.approvedBy}`}
                {gate.status === "remediation-requested" && gate.remediationNote && gate.remediationNote.slice(0, 60)}
                {gate.status === "in-review" && "Gate review in progress"}
                {gate.status === "pending" && "Awaiting gate review"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
