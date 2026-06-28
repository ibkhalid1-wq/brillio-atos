import React from "react";
import type { ProgramSummary } from "@/new/types";
import { ReadinessArcGauge } from "@/v3/components/ReadinessArcGauge";
import { explainPhaseReadiness, type ReadinessFactor } from "@/v3/lib/readinessModel";

function scoreColor(score: number): string {
  if (score >= 80) return "var(--v3-green)";
  if (score >= 50) return "var(--v3-amber)";
  return "var(--v3-red)";
}

function BlockerRow({ factor }: { factor: ReadinessFactor }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius)",
        background: "var(--v3-surface)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>{factor.label}</div>
        {factor.detail ? (
          <div style={{ fontSize: 10, color: "var(--v3-text-muted)" }}>{factor.detail}</div>
        ) : null}
      </div>
      {factor.expectedGain > 0 ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-green)", whiteSpace: "nowrap" }}>
          +{factor.expectedGain} pts
        </span>
      ) : null}
    </div>
  );
}

export function ReadinessExplainer({
  program,
  phaseId,
  threshold = 70,
}: {
  program: ProgramSummary | null;
  phaseId: string | null;
  threshold?: number;
}) {
  const explanation = React.useMemo(
    () => (program && phaseId ? explainPhaseReadiness(program, phaseId) : null),
    [program, phaseId],
  );

  if (!explanation) {
    return <div className="v3-context-artifacts-empty">No readiness data for this phase yet.</div>;
  }

  const { score, projectedScore, drivers, blockers, summary, derived } = explanation;
  const gain = projectedScore - score;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <ReadinessArcGauge score={score} size={132} threshold={threshold} showLabel={false} showLegend animate={false} />
        <div style={{ flex: 1, minWidth: 170, display: "grid", gap: 6 }}>
          {gain > 0 ? (
            <div style={{ fontSize: 12, color: "var(--v3-text-secondary)" }}>
              Projected <strong style={{ color: scoreColor(projectedScore) }}>{projectedScore}%</strong> once all open items are resolved
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
            {summary}
            {derived ? (
              <span style={{ color: "var(--v3-text-muted)" }}> (derived from artifact coverage — no sign-off yet)</span>
            ) : null}
          </div>
        </div>
      </div>

      {blockers.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Blockers · ranked by expected gain
          </div>
          {blockers.map((factor) => (
            <BlockerRow key={factor.id} factor={factor} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--v3-green)" }}>No open blockers for this phase.</div>
      )}

      {drivers.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Drivers · already helping
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {drivers.map((factor) => (
              <span
                key={factor.id}
                title={factor.detail || undefined}
                style={{
                  fontSize: 11,
                  color: "var(--v3-text-secondary)",
                  border: "1px solid var(--v3-border)",
                  borderLeft: "3px solid var(--v3-green)",
                  borderRadius: "var(--v3-radius)",
                  padding: "3px 8px",
                }}
              >
                {factor.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ReadinessExplainer;
