import React from "react";

interface PortfolioEntry {
  programId: string;
  programName: string;
  isActive: boolean;
  lastUpdated: string;
  healthScore: number | null;
  healthLevel: string;
  avgReadiness: number;
  completedPhases: number;
  totalPhases: number;
  escalationCount: number;
}

interface PortfolioDashboardViewProps {
  entries: PortfolioEntry[];
  onSwitchProgram: (programId: string) => void;
  onNewProgram: () => void;
}

const HEALTH_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  healthy: { bg: "#dcfce7", color: "#14532d", label: "Healthy" },
  at_risk: { bg: "#fef3c7", color: "#92400e", label: "At Risk" },
  critical: { bg: "#fee2e2", color: "#991b1b", label: "Critical" },
  unknown: { bg: "#f3f4f6", color: "#6b7280", label: "Unknown" },
};

export function PortfolioDashboardView({
  entries,
  onSwitchProgram,
  onNewProgram,
}: PortfolioDashboardViewProps) {
  const totalEscalations = entries.reduce((sum, entry) => sum + entry.escalationCount, 0);
  const criticalCount = entries.filter((entry) => entry.healthLevel === "critical").length;
  const healthEntries = entries.filter((entry) => entry.healthScore !== null);
  const avgHealth = healthEntries.length
    ? Math.round(healthEntries.reduce((sum, entry) => sum + (entry.healthScore ?? 0), 0) / healthEntries.length)
    : null;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Portfolio Dashboard</h2>
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>{entries.length} program{entries.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          type="button"
          onClick={onNewProgram}
          style={{ padding: "8px 16px", borderRadius: 8, background: "#2563eb", color: "white", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
        >
          + New Program
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Programs", value: entries.length, color: "#1e293b" },
          {
            label: "Avg Health",
            value: avgHealth !== null ? `${avgHealth}/100` : "—",
            color: avgHealth !== null && avgHealth >= 70 ? "#16a34a" : avgHealth !== null && avgHealth >= 50 ? "#d97706" : "#dc2626",
          },
          { label: "Escalations", value: totalEscalations, color: totalEscalations > 0 ? "#dc2626" : "#16a34a" },
          { label: "Critical", value: criticalCount, color: criticalCount > 0 ? "#dc2626" : "#16a34a" },
        ].map((kpi) => (
          <div key={kpi.label} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, background: "white" }}>
            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>{kpi.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {entries.map((entry) => {
          const hc = HEALTH_COLORS[entry.healthLevel] ?? HEALTH_COLORS.unknown;
          return (
            <div
              key={entry.programId}
              onClick={() => onSwitchProgram(entry.programId)}
              style={{
                border: `2px solid ${entry.isActive ? "#2563eb" : "#e5e7eb"}`,
                borderRadius: 10,
                padding: 16,
                background: "white",
                cursor: "pointer",
                transition: "box-shadow 0.15s",
              }}
              onMouseEnter={(event) => { event.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.08)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{entry.programName}</span>
                    {entry.isActive ? (
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}>ACTIVE</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                    Updated {new Date(entry.lastUpdated).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {entry.escalationCount > 0 ? (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                      {entry.escalationCount} escalation{entry.escalationCount > 1 ? "s" : ""}
                    </span>
                  ) : null}
                  {entry.healthScore !== null ? (
                    <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 10, background: hc.bg, color: hc.color, fontWeight: 600 }}>
                      {entry.healthScore} · {hc.label}
                    </span>
                  ) : null}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>
                  {entry.completedPhases}/{entry.totalPhases} phases · avg readiness {entry.avgReadiness}%
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${entry.avgReadiness}%`,
                      height: "100%",
                      borderRadius: 3,
                      background: entry.avgReadiness >= 70 ? "#16a34a" : entry.avgReadiness >= 40 ? "#d97706" : "#dc2626",
                      transition: "width 0.4s",
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
