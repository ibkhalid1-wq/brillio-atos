import React from "react";
import { HealthHeatmap } from "@/new/components/ui/HealthHeatmap";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";

interface HealthHeatmapViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerHealthHeatmap: () => void;
  onSelectPhase: (phaseId: string) => void;
  /** Run an agent directly from the health management panel */
  onRunAgent?: (agentId: string, phaseId?: string) => void;
}

function trendBadge(trend: string) {
  if (trend === "improving") return "green";
  if (trend === "declining") return "red";
  return "blue";
}

export function HealthHeatmapView({
  program,
  isRunning,
  onTriggerHealthHeatmap,
  onSelectPhase,
  onRunAgent,
}: HealthHeatmapViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Program Health"
        reason="No active program. Connect Supabase and choose a program to begin."
      />
    );
  }

  if (!program.healthHeatmap) {
    return (
      <NotReadyCard
        title="Program Health"
        reason="ATOS needs at least one phase in the lifecycle before it can score overall program health."
        onTrigger={onTriggerHealthHeatmap}
        triggerLabel="Refresh health"
        isRunning={isRunning}
      />
    );
  }

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Program Health</div>
            <div className="adam-body adam-muted">{program.healthHeatmap.summary}</div>
            {program.healthHeatmapGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(program.healthHeatmapGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className={`adam-badge ${program.healthHeatmap.overallRag === "green" ? "green" : program.healthHeatmap.overallRag === "amber" ? "amber" : "red"}`}>
              {program.healthHeatmap.overallHealthScore} overall
            </span>
            <span className={`v3-chip ${confidenceTone(program.healthHeatmap.confidence)}`} title={confidenceLabel(program.healthHeatmap.confidence)}>
              {Math.round(program.healthHeatmap.confidence * 100)}% confidence
            </span>
            <span className={`adam-badge ${trendBadge(program.healthHeatmap.trend)}`}>
              {program.healthHeatmap.trend}
            </span>
            <span className="adam-badge slate">{program.healthHeatmap.programMomentum}</span>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerHealthHeatmap}
              disabled={isRunning}
            >
              {isRunning ? "Refreshing…" : "Refresh health"}
            </button>
          </div>
        </div>
      </section>

      <section className="adam-card p-5">
        <HealthHeatmap
          heatmap={program.healthHeatmap}
          onSelectPhase={onSelectPhase}
        />
      </section>

      {/* ── Health Management Panel — turns health into action (not just status) ── */}
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "center", marginBottom: 16 }}>
          <div className="adam-title">What to do now</div>
          <span className="adam-micro adam-muted">Actions ranked by health impact</span>
        </div>
        {(() => {
          const heatmap = program.healthHeatmap;
          type HealthAction = { icon: string; label: string; reason: string; urgency: "critical" | "high" | "normal"; agentId?: string; phaseId?: string };
          const actions: HealthAction[] = [];
          const redPhases = heatmap.phaseHealth.filter((p) => p.rag === "red");
          const amberPhases = heatmap.phaseHealth.filter((p) => p.rag === "amber");

          // 1. Declining trend — refresh immediately
          if (heatmap.trend === "declining") {
            actions.push({
              icon: "↓",
              label: "Health is declining — run health assessment",
              reason: `Overall health dropped to ${heatmap.overallHealthScore}. A fresh assessment will identify what changed.`,
              urgency: "critical",
              agentId: "health-heatmap",
            });
          }

          // 2. Overall red — a program-level critical that no single phase carries.
          // When nothing has started yet the per-phase RAGs are grey, so the
          // worst-phase action below never fires; surface the overall red here
          // so the recommendation can never read "healthy" while the header is red.
          if (heatmap.overallRag === "red" && redPhases.length === 0) {
            actions.push({
              icon: "⚠",
              label: "Program health is red — immediate action needed",
              reason: heatmap.summary || `Overall health is ${heatmap.overallHealthScore}. Define the plan, milestones, and objectives to get the program moving.`,
              urgency: "critical",
              agentId: "health-heatmap",
            });
          }

          // 3. Red phases — action immediately on worst phase
          if (redPhases.length > 0) {
            const worst = redPhases[0];
            actions.push({
              icon: "⚠",
              label: `Address ${worst.phaseName} — health is critical`,
              reason: worst.topRisk ? `Top risk: ${worst.topRisk}` : (worst.healthNote ?? `${worst.phaseName} health score is red`),
              urgency: "critical",
              agentId: "risk",
              phaseId: worst.phaseId,
            });
          }

          // 4. Stalled / slowing momentum — get the program moving
          if (heatmap.programMomentum === "stalled" || heatmap.programMomentum === "slowing") {
            const stalled = heatmap.programMomentum === "stalled";
            actions.push({
              icon: "▶",
              label: stalled ? "Program is stalled — mobilise the first phase" : "Momentum is slowing — keep phases progressing",
              reason: stalled
                ? "No phases are advancing. Run the daily briefing to surface the fastest path to traction."
                : "Throughput is dropping. Review in-flight phases before they stall.",
              urgency: heatmap.overallRag === "red" ? "critical" : "high",
              agentId: "daily-briefing",
            });
          }

          // 5. Amber phases — prevent escalation
          if (amberPhases.length > 0) {
            actions.push({
              icon: "◷",
              label: `Monitor ${amberPhases.length} amber phase${amberPhases.length > 1 ? "s" : ""} before they turn red`,
              reason: amberPhases.map((p) => p.phaseName).join(", ") + " — risks identified but not yet critical.",
              urgency: "high",
              agentId: "risk",
            });
          }

          // 6. Low confidence — improve input quality
          if (heatmap.confidence < 0.6) {
            actions.push({
              icon: "⊡",
              label: "Improve data quality to increase health confidence",
              reason: `Health confidence is only ${Math.round(heatmap.confidence * 100)}%. Add more phase inputs and run agents to improve accuracy.`,
              urgency: "high",
            });
          }

          // 7. Fallback — only claim "healthy" when the overall RAG agrees.
          // Otherwise surface an amber-grade review prompt so the panel never
          // contradicts a non-green header.
          if (actions.length === 0) {
            actions.push(
              heatmap.overallRag === "green"
                ? {
                    icon: "✓",
                    label: "Health is good — maintain momentum",
                    reason: heatmap.programMomentum === "accelerating"
                      ? "Programme momentum is accelerating. Keep up the pace to maintain green status."
                      : "No immediate health concerns. Run the daily briefing to stay on track.",
                    urgency: "normal",
                    agentId: "daily-briefing",
                  }
                : {
                    icon: "◷",
                    label: "Review program health before it slips",
                    reason: heatmap.summary || "Overall health is amber. Run a health assessment to pinpoint what needs attention.",
                    urgency: "high",
                    agentId: "health-heatmap",
                  },
            );
          }

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {actions.slice(0, 3).map((action, i) => {
                const isCritical = action.urgency === "critical";
                const isHigh = action.urgency === "high";
                const borderColor = isCritical ? "rgba(239,68,68,0.25)" : isHigh ? "rgba(245,158,11,0.25)" : "rgba(34,197,94,0.2)";
                const bgColor = isCritical ? "rgba(239,68,68,0.05)" : isHigh ? "rgba(245,158,11,0.05)" : "rgba(34,197,94,0.04)";
                const textColor = isCritical ? "#ef4444" : isHigh ? "#f59e0b" : "#22c55e";
                return (
                  <div key={i} style={{ border: `1px solid ${borderColor}`, background: bgColor, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ fontSize: 18, color: textColor, flexShrink: 0, lineHeight: 1, marginTop: 1 }}>{action.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{action.label}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3, lineHeight: 1.5 }}>{action.reason}</div>
                      </div>
                      {action.urgency !== "normal" && (
                        <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: isCritical ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)", color: textColor, fontWeight: 700, flexShrink: 0, textTransform: "uppercase" as const }}>
                          {action.urgency}
                        </span>
                      )}
                    </div>
                    {action.agentId && onRunAgent && (
                      <div style={{ marginTop: 10, paddingLeft: 28 }}>
                        <button
                          type="button"
                          className="adam-button-ghost"
                          style={{ fontSize: 12 }}
                          onClick={() => onRunAgent(action.agentId!, action.phaseId)}
                        >
                          Run agent →
                        </button>
                        {action.phaseId && (
                          <button
                            type="button"
                            className="adam-button-ghost"
                            style={{ fontSize: 12, marginLeft: 8 }}
                            onClick={() => onSelectPhase(action.phaseId!)}
                          >
                            Go to {action.phaseId} →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Phase health notes</div>
        <div className="mt-4 adam-list">
          {program.healthHeatmap.phaseHealth.map((phase) => (
            <div key={phase.phaseId} className="adam-list-item">
              <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div className="adam-stack" style={{ gap: 4 }}>
                  <div className="adam-title">{phase.phaseName}</div>
                  <div className="adam-body adam-muted">{phase.healthNote || "No note available yet."}</div>
                  {phase.topRisk ? (
                    <div className="adam-micro" style={{ color: "#fca5a5" }}>Top risk: {phase.topRisk}</div>
                  ) : null}
                </div>
                <div className="adam-row" style={{ gap: 8 }}>
                  <span className={`adam-badge ${phase.rag === "green" ? "green" : phase.rag === "amber" ? "amber" : phase.rag === "red" ? "red" : "slate"}`}>
                    {phase.rag}
                  </span>
                  <span className="adam-badge blue">{Math.round(phase.confidence * 100)}% confidence</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
