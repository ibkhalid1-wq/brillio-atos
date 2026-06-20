import React, { useEffect, useMemo, useState } from "react";

const LEVELS = ["low", "medium", "high"] as const;

const CELL_COLORS: Record<string, string> = {
  "1x1": "#dcfce7",
  "1x2": "#dcfce7",
  "2x1": "#dcfce7",
  "1x3": "#fef3c7",
  "3x1": "#fef3c7",
  "2x2": "#fef3c7",
  "2x3": "#ffedd5",
  "3x2": "#ffedd5",
  "3x3": "#fee2e2",
};

const CELL_LABELS: Record<string, string> = {
  "1x1": "Accept",
  "1x2": "Accept",
  "2x1": "Accept",
  "1x3": "Monitor",
  "3x1": "Monitor",
  "2x2": "Monitor",
  "2x3": "Mitigate",
  "3x2": "Mitigate",
  "3x3": "Escalate",
};

interface Risk {
  id: string;
  title: string;
  description: string;
  phaseId: string;
  likelihoodScore: number;
  impactScore: number;
  quadrantKey: string;
  quadrant: { label: string; color: string; bg: string };
  owner: string | null;
}

interface RiskMatrixViewProps {
  risks: Risk[];
  focusRiskIds?: string[];
  focusToken?: number;
  onSelectRisk: (id: string) => void;
  onDismissRisk: (id: string) => void;
}

export function RiskMatrixView({
  risks,
  focusRiskIds = [],
  focusToken = 0,
  onSelectRisk,
  onDismissRisk,
}: RiskMatrixViewProps) {
  const [selected, setSelected] = useState<Risk | null>(null);
  const focusedRiskIds = useMemo(() => new Set(focusRiskIds.filter(Boolean)), [focusRiskIds]);
  const focusedRisk = useMemo(
    () => risks.find((risk) => focusedRiskIds.has(risk.id)) || null,
    [focusedRiskIds, risks],
  );

  const getRisksAt = (likelihood: number, impact: number) => (
    risks.filter((risk) => risk.likelihoodScore === likelihood && risk.impactScore === impact)
  );

  useEffect(() => {
    if (!focusRiskIds.length) return;
    const nextSelected = risks.find((risk) => focusedRiskIds.has(risk.id));
    if (nextSelected) setSelected(nextSelected);
  }, [focusRiskIds, focusToken, focusedRiskIds, risks]);

  return (
    <div style={{ padding: 24 }}>
      {focusedRisk ? (
        <div
          style={{
            margin: "0 0 16px",
            borderRadius: 10,
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginBottom: 4 }}>
            Review requested
          </div>
          <div style={{ fontSize: 12, color: "#1e3a8a", lineHeight: 1.5 }}>
            ADAM brought you to the risk matrix focused on "{focusedRisk.title}" so you can assess the quadrant and open the source risk directly.
          </div>
        </div>
      ) : null}
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Risk Matrix</h2>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>
        {risks.length} open risk{risks.length !== 1 ? "s" : ""} · click any risk to view details
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", writingMode: "vertical-rl", transform: "rotate(180deg)", height: 200, textAlign: "center" }}>
              Likelihood →
            </div>
            <div>
              {[3, 2, 1].map((likelihood) => (
                <div key={likelihood} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                  <div style={{ width: 40, display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: 11, color: "#9ca3af", paddingRight: 4 }}>
                    {LEVELS[likelihood - 1]}
                  </div>
                  {[1, 2, 3].map((impact) => {
                    const key = `${likelihood}x${impact}`;
                    const cellRisks = getRisksAt(likelihood, impact);
                    return (
                      <div
                        key={impact}
                        style={{
                          width: 90,
                          height: 66,
                          borderRadius: 6,
                          background: CELL_COLORS[key] ?? "#f9fafb",
                          border: "1px solid #e5e7eb",
                          padding: 4,
                          overflow: "hidden",
                          position: "relative",
                        }}
                      >
                        <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2 }}>{CELL_LABELS[key]}</div>
                        {cellRisks.slice(0, 3).map((risk) => (
                          <div
                            key={risk.id}
                            onClick={() => setSelected(risk)}
                            title={risk.title}
                            style={{
                              fontSize: 9,
                              padding: "1px 4px",
                              borderRadius: 3,
                              marginBottom: 2,
                              background: selected?.id === risk.id || focusedRiskIds.has(risk.id) ? "#eff6ff" : "white",
                              border: `1px solid ${selected?.id === risk.id || focusedRiskIds.has(risk.id) ? "#2563eb" : risk.quadrant.color}`,
                              color: risk.quadrant.color,
                              cursor: "pointer",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              boxShadow: selected?.id === risk.id || focusedRiskIds.has(risk.id) ? "0 0 0 1px rgba(37,99,235,0.18)" : undefined,
                            }}
                          >
                            {risk.title.slice(0, 18)}
                          </div>
                        ))}
                        {cellRisks.length > 3 ? (
                          <div style={{ fontSize: 9, color: "#9ca3af" }}>+{cellRisks.length - 3} more</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{ display: "flex", gap: 4, marginLeft: 44, marginTop: 4 }}>
                {LEVELS.map((level) => (
                  <div key={level} style={{ width: 90, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>{level}</div>
                ))}
              </div>
              <div style={{ marginLeft: 44, textAlign: "center", fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", marginTop: 2 }}>
                Impact →
              </div>
            </div>
          </div>
        </div>

        {selected ? (
          <div style={{ flex: 1, minWidth: 240, border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: selected.quadrant.bg, color: selected.quadrant.color }}>
                {selected.quadrant.label}
              </span>
              <button type="button" onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16 }}>×</button>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{selected.title}</div>
            <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, marginBottom: 10 }}>{selected.description}</div>
            <div style={{ display: "flex", gap: 8, fontSize: 11, color: "#9ca3af", marginBottom: 16 }}>
              <span>Phase: {selected.phaseId}</span>
              {selected.owner ? <span>Owner: {selected.owner}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => onSelectRisk(selected.id)} style={{ padding: "5px 12px", borderRadius: 6, background: "#2563eb", color: "white", border: "none", cursor: "pointer", fontSize: 12 }}>
                View in RAID Log
              </button>
              <button
                type="button"
                onClick={() => {
                  onDismissRisk(selected.id);
                  setSelected(null);
                }}
                style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d1d5db", cursor: "pointer", fontSize: 12 }}
              >
                Resolve
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
