import { useEffect, useMemo } from "react";
import { getRiskTrend, recordGateRiskSnapshot, type PredictedRisk } from "@/lib/adamGateRisk";

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
};

function getTrendArrow(trend: string): string {
  if (trend === "improving") return "↑";
  if (trend === "worsening") return "↓";
  return "→";
}

function getLevelLabel(level: string): string {
  if (level === "critical") return "🔴 Critical";
  if (level === "high") return "🟠 High";
  return "🟡 Watch";
}

function getLevelClasses(level: string): string {
  if (level === "critical") return "bg-red-50 border-red-300";
  if (level === "high") return "bg-orange-50 border-orange-300";
  return "bg-yellow-50 border-yellow-200";
}

function getLevelTheme(level: string): {
  panelBg: string;
  panelBorder: string;
  labelColor: string;
  dotColor: string;
} {
  if (level === "critical") {
    return {
      panelBg: "rgba(254, 242, 242, 0.98)",
      panelBorder: "rgba(248, 113, 113, 0.45)",
      labelColor: "#b91c1c",
      dotColor: "#ef4444",
    };
  }
  if (level === "high") {
    return {
      panelBg: "rgba(255, 247, 237, 0.98)",
      panelBorder: "rgba(251, 146, 60, 0.42)",
      labelColor: "#c2410c",
      dotColor: "#f97316",
    };
  }
  return {
    panelBg: "rgba(254, 252, 232, 0.98)",
    panelBorder: "rgba(250, 204, 21, 0.4)",
    labelColor: "#a16207",
    dotColor: "#eab308",
  };
}

export function GateRiskPanel({ risks, projectId }: { risks: PredictedRisk[]; projectId: string }) {
  const programId = `${projectId ?? ""}`.trim();

  useEffect(() => {
    if (!programId) return;
    risks.forEach((risk) => {
      recordGateRiskSnapshot(risk.phaseId, risk, programId);
    });
  }, [programId, risks]);

  const trends = useMemo(() => {
    if (!programId) return {};
    return risks.reduce<Record<string, string>>((acc, risk) => {
      acc[risk.phaseId] = getRiskTrend(risk.phaseId, programId);
      return acc;
    }, {});
  }, [programId, risks]);

  if (!risks.length) {
    return (
      <div
        style={{
          marginBottom: 12,
          borderRadius: 18,
          border: "1px solid rgba(134, 239, 172, 0.55)",
          background: "rgba(240, 253, 244, 0.98)",
          padding: "14px 16px",
          fontSize: 13,
          fontWeight: 700,
          color: "#15803d",
          boxShadow: "0 10px 24px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.82)",
        }}
      >
        ✅ All active phases on track — no gate failures predicted
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 12,
        borderRadius: 24,
        border: "1px solid rgba(226,232,240,0.95)",
        background: "rgba(255,255,255,0.985)",
        padding: "16px 18px",
        boxShadow: "0 18px 36px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.92)",
      }}
    >
      <div
        style={{
          marginBottom: 12,
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "#64748b",
        }}
      >
        Predictive Gate Risk
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {risks.map((risk) => {
          const trend = trends[risk.phaseId] ?? "stable";
          const visibleReasons = (risk.reasons ?? []).slice(0, 3);
          const hiddenCount = Math.max(0, (risk.reasons ?? []).length - visibleReasons.length);
          const theme = getLevelTheme(risk.level);
          return (
            <div
              key={risk.phaseId}
              style={{
                borderRadius: 20,
                border: `1px solid ${theme.panelBorder}`,
                background: theme.panelBg,
                padding: "14px 16px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      color: theme.labelColor,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: theme.dotColor,
                        boxShadow: `0 0 0 4px ${theme.dotColor}22`,
                        flexShrink: 0,
                      }}
                    />
                    <span>{getLevelLabel(risk.level).replace(/^[^\s]+\s/, "")}</span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 21,
                      fontWeight: 900,
                      color: "#0f172a",
                      lineHeight: 1.08,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    {PHASE_LABELS[risk.phaseId] ?? risk.phaseId}
                  </div>
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.92)",
                    border: "1px solid rgba(203,213,225,0.95)",
                    padding: "6px 10px",
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: "#334155",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
                    flexShrink: 0,
                  }}
                >
                  Score {risk.riskScore}
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(226,232,240,0.9)",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Readiness</div>
                  <div style={{ marginTop: 4, fontSize: 17, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{risk.readiness}%</div>
                </div>
                <div
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(226,232,240,0.9)",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Trend</div>
                  <div style={{ marginTop: 4, fontSize: 17, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{getTrendArrow(trend)} {trend}</div>
                </div>
                <div
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.82)",
                    border: "1px solid rgba(226,232,240,0.9)",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Weeks</div>
                  <div style={{ marginTop: 4, fontSize: 17, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{risk.projectedWeeksToGate}</div>
                </div>
              </div>

              <ul
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  paddingLeft: 20,
                  display: "grid",
                  gap: 8,
                  fontSize: 13,
                  color: "#334155",
                  lineHeight: 1.55,
                }}
              >
                {visibleReasons.map((reason, index) => (
                  <li key={`${risk.phaseId}-${index}`} style={{ paddingLeft: 2 }}>
                    {reason.msg}
                  </li>
                ))}
                {hiddenCount > 0 ? (
                  <li style={{ listStyle: "none", marginLeft: -18, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
                    + {hiddenCount} more
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
