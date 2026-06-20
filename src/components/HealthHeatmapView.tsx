import React, { useState } from "react";

const DIMENSION_LABELS: Record<string, string> = {
  completeness: "Completeness",
  quality: "Quality",
  risk: "Risk",
  timeline: "Timeline",
  agent_activity: "Agent Activity",
};

const ADAM_PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

function scoreColor(score: number): string {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#d97706";
  if (score >= 25) return "#ef4444";
  return "#991b1b";
}

function scoreBg(score: number): string {
  if (score >= 75) return "#dcfce7";
  if (score >= 50) return "#fef3c7";
  if (score >= 25) return "#fee2e2";
  return "#fecaca";
}

interface HealthHeatmapViewProps {
  matrix: Record<string, Record<string, number>>;
  onNavigate: (phaseId: string) => void;
}

export function HealthHeatmapView({ matrix, onNavigate }: HealthHeatmapViewProps) {
  const [hover, setHover] = useState<{ phase: string; dim: string } | null>(null);
  const dimensions = Object.keys(DIMENSION_LABELS);

  const dimAverages = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      Math.round(ADAM_PHASES.reduce((sum, phaseId) => sum + (matrix[phaseId]?.[dimension] ?? 0), 0) / ADAM_PHASES.length),
    ]),
  );

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Program Health Heatmap</h2>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>Phase × dimension view. Click any phase to navigate.</p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "#9ca3af", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>
                Phase
              </th>
              {dimensions.map((dimension) => (
                <th
                  key={dimension}
                  style={{ padding: "8px 10px", textAlign: "center", fontSize: 11, color: "#6b7280", fontWeight: 600, borderBottom: "2px solid #e5e7eb", whiteSpace: "nowrap" }}
                >
                  {DIMENSION_LABELS[dimension]}
                </th>
              ))}
              <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 11, color: "#6b7280", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>
                Avg
              </th>
            </tr>
          </thead>
          <tbody>
            {ADAM_PHASES.map((phaseId) => {
              const row = matrix[phaseId] ?? {};
              const rowAvg = dimensions.length
                ? Math.round(dimensions.reduce((sum, dimension) => sum + (row[dimension] ?? 0), 0) / dimensions.length)
                : 0;
              return (
                <tr
                  key={phaseId}
                  onClick={() => onNavigate(phaseId)}
                  style={{ cursor: "pointer", transition: "background 0.1s" }}
                  onMouseEnter={(event) => { event.currentTarget.style.background = "#f9fafb"; }}
                  onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 500, color: "#374151", borderBottom: "1px solid #f3f4f6", textTransform: "capitalize" }}>
                    {phaseId}
                  </td>
                  {dimensions.map((dimension) => {
                    const score = row[dimension] ?? 0;
                    const isHovered = hover?.phase === phaseId && hover?.dim === dimension;
                    return (
                      <td
                        key={dimension}
                        onMouseEnter={() => setHover({ phase: phaseId, dim: dimension })}
                        onMouseLeave={() => setHover(null)}
                        style={{ padding: "6px 8px", textAlign: "center", borderBottom: "1px solid #f3f4f6" }}
                      >
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 48,
                            height: 32,
                            borderRadius: 6,
                            background: scoreBg(score),
                            color: scoreColor(score),
                            fontSize: 13,
                            fontWeight: 700,
                            border: isHovered ? `2px solid ${scoreColor(score)}` : "2px solid transparent",
                            transition: "border 0.1s",
                          }}
                        >
                          {score}
                        </div>
                      </td>
                    );
                  })}
                  <td style={{ padding: "6px 8px", textAlign: "center", borderBottom: "1px solid #f3f4f6" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 48,
                        height: 32,
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 13,
                        background: scoreBg(rowAvg),
                        color: scoreColor(rowAvg),
                      }}
                    >
                      {rowAvg}
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: "#f9fafb" }}>
              <td style={{ padding: "10px 12px", fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>Avg</td>
              {dimensions.map((dimension) => (
                <td key={dimension} style={{ padding: "6px 8px", textAlign: "center" }}>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 48,
                      height: 32,
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: 12,
                      background: scoreBg(dimAverages[dimension]),
                      color: scoreColor(dimAverages[dimension]),
                    }}
                  >
                    {dimAverages[dimension]}
                  </div>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        {[
          { label: "75-100 Healthy", bg: "#dcfce7", color: "#16a34a" },
          { label: "50-74 Caution", bg: "#fef3c7", color: "#d97706" },
          { label: "25-49 At Risk", bg: "#fee2e2", color: "#ef4444" },
          { label: "0-24 Critical", bg: "#fecaca", color: "#991b1b" },
        ].map((legend) => (
          <div key={legend.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b7280" }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: legend.bg, border: `1px solid ${legend.color}` }} />
            {legend.label}
          </div>
        ))}
      </div>
    </div>
  );
}
