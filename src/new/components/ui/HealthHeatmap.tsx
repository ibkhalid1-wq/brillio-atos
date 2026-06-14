import React from "react";
import type { HealthHeatmapSummary } from "@/new/types";

interface HealthHeatmapProps {
  heatmap: HealthHeatmapSummary;
  compact?: boolean;
  onSelectPhase?: (phaseId: string) => void;
}

function ragClass(rag: HealthHeatmapSummary["overallRag"] | "grey") {
  if (rag === "green") return "green";
  if (rag === "amber") return "amber";
  if (rag === "red") return "red";
  return "slate";
}

function trendLabel(trend: HealthHeatmapSummary["trend"]) {
  if (trend === "improving") return "Improving";
  if (trend === "declining") return "Declining";
  return "Stable";
}

export function HealthHeatmap({
  heatmap,
  compact = false,
  onSelectPhase,
}: HealthHeatmapProps) {
  const visiblePhases = compact ? heatmap.phaseHealth.slice(0, 13) : heatmap.phaseHealth;

  return (
    <div className="adam-stack" style={{ gap: compact ? 10 : 16 }}>
      {!compact ? (
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-title">Program health</div>
            <div className="adam-body adam-muted">{heatmap.summary}</div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className={`adam-badge ${ragClass(heatmap.overallRag)}`}>
              {heatmap.overallRag.toUpperCase()}
            </span>
            <span className="adam-badge blue">{trendLabel(heatmap.trend)}</span>
            <span className="adam-badge slate">{heatmap.programMomentum}</span>
          </div>
        </div>
      ) : null}

      <div className={compact ? "adam-health-grid is-compact" : "adam-health-grid"}>
        {visiblePhases.map((phase) => (
          <button
            key={phase.phaseId}
            type="button"
            className={`adam-health-cell ${phase.rag}`}
            title={`${phase.phaseName}: ${phase.score}% · ${phase.healthNote}${phase.topRisk ? ` · Top risk: ${phase.topRisk}` : ""}`}
            onClick={() => onSelectPhase?.(phase.phaseId)}
            style={{ cursor: onSelectPhase ? "pointer" : "default" }}
          >
            <div className="adam-health-cell-name">{phase.phaseName}</div>
            <div className="adam-health-cell-score">{phase.score}%</div>
            {!compact ? (
              <div className="adam-health-cell-note">
                {phase.healthNote || "No health note yet."}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
