import React from "react";

export interface CoachAction {
  action: string;
  effort: "quick" | "hours" | "days";
  owner: "user" | "agent";
  agentId: string | null;
}

function effortColor(effort: CoachAction["effort"]): string {
  if (effort === "quick") return "var(--br-green)";
  if (effort === "hours") return "var(--v3-amber)";
  return "var(--v3-red, #ef4444)";
}

export function GateCoachPanel({
  actions,
  onRunAgent,
}: {
  actions: CoachAction[];
  onRunAgent: (id: string) => void;
}) {
  if (!actions.length) return null;

  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(245, 158, 11, 0.25)", background: "rgba(245, 158, 11, 0.08)", padding: 16, display: "grid", gap: 10, marginTop: 12 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
        How to close your gate
      </p>
      {actions.map((action, index) => (
        <div key={`${action.action}-${index}`} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--v3-text-secondary)", lineHeight: 1.5, flex: 1 }}>
            <span style={{ marginTop: 6, width: 8, height: 8, borderRadius: "999px", background: effortColor(action.effort), flexShrink: 0 }} />
            <span>{action.action}</span>
          </div>
          {action.owner === "agent" && action.agentId ? (
            <button type="button" className="v3-button ghost" style={{ fontSize: 11, flexShrink: 0 }} onClick={() => onRunAgent(action.agentId || "")}>
              Run agent
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default GateCoachPanel;
