import React, { useMemo, useState } from "react";
import { NumberCountUp } from "@/v3/components/ui/NumberCountUp";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { AgentActivityFeed, type AgentActivityItem } from "@/v3/components/AgentActivityFeed";
import { computeConfidenceScore } from "@/v3/lib/confidenceScore";
import { getProgramState } from "@/new/lib/programState";
import { ADAM_PHASE_SEQUENCE } from "@/lib/adamMethodology";

interface OversightViewProps {
  programId: string;
  rawData: Record<string, unknown>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
  agentActivity?: AgentActivityItem[];
  onNavigateToPhase?: (phaseId: string) => void;
}

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy", mobilise: "Mobilise", discover: "Discover",
  design: "Design", build: "Build", operate: "Operate",
  govern: "Govern", optimize: "Optimize", valuerealize: "Value Capture",
};

function phaseColor(pct: number): string {
  if (pct >= 80) return "var(--v3-green)";
  if (pct >= 50) return "var(--v3-accent)";
  if (pct >= 20) return "var(--v3-amber)";
  if (pct > 0) return "var(--v3-red)";
  return "var(--v3-surface-3)";
}

function kpiTrend(current: number, target: number): { icon: string; color: string } {
  const ratio = target > 0 ? current / target : 1;
  if (ratio >= 0.95) return { icon: "↑", color: "var(--v3-green)" };
  if (ratio >= 0.7) return { icon: "→", color: "var(--v3-amber)" };
  return { icon: "↓", color: "var(--v3-red)" };
}

export default function OversightView({
  rawData, onRunAgent, anyAgentRunning, agentActivity = [], onNavigateToPhase,
}: OversightViewProps) {
  const [hoveredPhase, setHoveredPhase] = useState<string | null>(null);
  const { inner } = useMemo(() => getProgramState(rawData), [rawData]);

  const phases = useMemo(() =>
    ADAM_PHASE_SEQUENCE.map((id) => {
      const phaseData = (inner as any)[id] ?? {};
      const pct = typeof phaseData.pct === "number" ? phaseData.pct
        : Array.isArray(inner.phases)
          ? ((inner.phases as any[]).find((p: any) => p.id === id)?.pct ?? 0)
          : 0;
      return { id, label: PHASE_LABELS[id] ?? id, pct };
    }),
  [inner]);

  const kpis = useMemo(() => Array.isArray(inner.kpis) ? inner.kpis as any[] : [], [inner]);

  const narrative = useMemo(() => {
    const n = inner.narrative ?? (inner as any).narrativeOutput;
    return typeof n === "string" ? n : null;
  }, [inner]);

  const gateReviews = useMemo(() => {
    const gr = inner.gateReviews;
    return (typeof gr === "object" && gr !== null && !Array.isArray(gr)) ? gr as Record<string, any> : {};
  }, [inner]);

  const openDecisionCount = useMemo(() => {
    const dq = Array.isArray(inner.decisionQueue) ? inner.decisionQueue as any[] : [];
    return dq.filter((d: any) => d.status === "open").length;
  }, [inner]);

  const confidence = useMemo(() => {
    const avgPct = phases.reduce((s, p) => s + p.pct, 0) / Math.max(phases.length, 1);
    const approvedGates = ADAM_PHASE_SEQUENCE.filter((id) => gateReviews[id]?.status === "approved").length;
    const gateReadiness = Math.round((approvedGates / ADAM_PHASE_SEQUENCE.length) * 100);
    return computeConfidenceScore({
      gateReadiness,
      riskPosture: 70,
      milestoneHealth: avgPct,
      openDecisionCount,
      inputCompleteness: avgPct,
    });
  }, [phases, gateReviews, openDecisionCount]);

  // Executive summary metrics
  const approvedGateCount = ADAM_PHASE_SEQUENCE.filter(id => gateReviews[id]?.status === "approved").length;
  const totalPhases = ADAM_PHASE_SEQUENCE.length;
  const avgPct = Math.round(phases.reduce((s, p) => s + p.pct, 0) / Math.max(phases.length, 1));
  const atRiskCount = phases.filter(p => p.pct < 30 && p.pct > 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", height: "100%" }}>
      {/* Soft migration notice */}
      <div style={{
        padding: "8px 16px",
        background: "var(--v3-accent-soft)",
        borderBottom: "1px solid var(--v3-accent-glow)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: "var(--v3-accent)",
        flexShrink: 0,
      }}>
        <span>✦ This view has been upgraded — <strong>Programme Health</strong> now combines gates, decisions, and health in one unified view.</span>
      </div>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", fontSize: 11, color: "var(--v3-text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Programme health dashboard — all stages overview</span>
        <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>Auto-refreshes when agents complete</span>
      </div>
      {/* Executive Summary Strip */}
      <div style={{
        borderBottom: "1px solid var(--v3-border)", background: "var(--v3-surface-2)",
        padding: "10px 16px", flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 0 }}>
          {[
            {
              label: "Gates Approved",
              value: `${approvedGateCount} / ${totalPhases}`,
              color: approvedGateCount > totalPhases / 2 ? "var(--v3-green)" : "var(--v3-text-primary)",
            },
            {
              label: "Avg Completion",
              value: `${avgPct}%`,
              color: "var(--v3-text-primary)",
            },
            {
              label: "Confidence",
              value: `${confidence.score}`,
              color: confidence.color === "green" ? "var(--v3-green)" : confidence.color === "amber" ? "var(--v3-amber)" : confidence.color === "red" ? "var(--v3-red)" : "var(--v3-accent)",
              badge: confidence.label,
            },
            {
              label: "Open Decisions",
              value: `${openDecisionCount}`,
              color: openDecisionCount > 3 ? "var(--v3-amber)" : "var(--v3-text-primary)",
            },
          ].map((stat, i, arr) => (
            <div key={stat.label} style={{
              flex: 1, padding: "6px 14px",
              borderRight: i < arr.length - 1 ? "1px solid var(--v3-border)" : "none",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{stat.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: stat.color, fontVariantNumeric: "tabular-nums" }}>{stat.value}</span>
                {stat.badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
                    background: "var(--v3-surface-3)", color: stat.color,
                  }}>{stat.badge}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Zone 1 — KPI Strip */}
      <div style={{
        borderBottom: "1px solid var(--v3-border)", background: "var(--v3-surface)",
        padding: "12px 16px", flexShrink: 0,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>KPIs</div>
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {kpis.length === 0 ? (
            <button onClick={() => {}} style={{
              background: "var(--v3-surface-2)", border: "1px dashed var(--v3-border)",
              borderRadius: "var(--v3-radius)", padding: "8px 14px", fontSize: 12,
              color: "var(--v3-text-muted)", cursor: "pointer", fontFamily: "var(--v3-font)", whiteSpace: "nowrap",
            }}>+ Define programme KPIs →</button>
          ) : kpis.map((kpi: any, i: number) => {
            const trend = kpiTrend(kpi.current ?? 0, kpi.target ?? 1);
            const ratio = Math.min((kpi.current ?? 0) / Math.max(kpi.target ?? 1, 1), 1);
            return (
              <div key={i} style={{
                background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)",
                borderRadius: "var(--v3-radius-lg)", padding: "8px 14px", flexShrink: 0, minWidth: 140,
              }}>
                <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 2 }}>{kpi.name ?? `KPI ${i + 1}`}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "var(--v3-text-primary)", fontVariantNumeric: "tabular-nums" }}>{kpi.current ?? "—"}</span>
                  {kpi.unit && <span style={{ fontSize: 11, color: "var(--v3-text-secondary)" }}>{kpi.unit}</span>}
                  {kpi.target && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>/ {kpi.target}{kpi.unit ? ` ${kpi.unit}` : ""}</span>}
                  <span style={{ color: trend.color, fontSize: 14, fontWeight: 600 }}>{trend.icon}</span>
                </div>
                <div style={{ height: 2, background: "var(--v3-surface-3)", borderRadius: 1, marginTop: 8 }}>
                  <div style={{ height: "100%", width: `${ratio * 100}%`, background: trend.color, borderRadius: 1 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Zone 2 — Confidence + Narrative */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--v3-border)", flexShrink: 0, minHeight: 160 }}>
        {/* Confidence card */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--v3-border)", padding: "16px", background: "var(--v3-surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Programme Confidence</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <NumberCountUp
              value={confidence.score}
              duration={800}
              suffix=""
              style={{ fontSize: 36, fontWeight: 800, color: "var(--v3-text-primary)" }}
            />
            <span style={{ fontSize: 14, color: confidence.color === "green" ? "var(--v3-green)" : confidence.color === "amber" ? "var(--v3-amber)" : confidence.color === "red" ? "var(--v3-red)" : "var(--v3-accent)" }}>{confidence.label}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {Object.entries(confidence.breakdown).map(([key, val]) => {
              const labels: Record<string, string> = {
                gateReadiness: "Gate Readiness", riskPosture: "Risk Posture",
                milestoneHealth: "Milestone Health", decisionBacklog: "Decision Backlog",
                inputCompleteness: "Input Completeness",
              };
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <span style={{ flex: 1, color: "var(--v3-text-muted)" }}>{labels[key] ?? key}</span>
                  <span style={{ color: "var(--v3-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{val as number}%</span>
                </div>
              );
            })}
          </div>
          {/* Trend hint */}
          <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--v3-surface-2)", borderRadius: "var(--v3-radius)", fontSize: 11, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
            {confidence.score >= 75
              ? "Programme is on track. Continue current delivery pace."
              : confidence.score >= 50
              ? "Some signals need attention. Review gate readiness and open decisions."
              : "Multiple risk signals detected. Immediate leadership review recommended."}
          </div>
        </div>

        {/* Narrative */}
        <div style={{ flex: 1, padding: "16px", background: "var(--v3-surface)", overflowY: "auto", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Programme Narrative</div>
            <button onClick={() => onRunAgent("narrative")} disabled={anyAgentRunning} style={{
              background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)",
              padding: "4px 10px", fontSize: 11, color: "var(--v3-text-secondary)", cursor: "pointer", fontFamily: "var(--v3-font)",
            }}>↻ Regenerate</button>
          </div>
          {narrative ? (
            <p style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.7, margin: 0 }}>{narrative}</p>
          ) : (
            <EmptyState icon="✦" title="No narrative yet" description="Generate a programme narrative to summarise current status."
              action={{ label: "Generate Narrative", onClick: () => onRunAgent("narrative") }} />
          )}
          {/* Agent running overlay */}
          {anyAgentRunning && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(var(--v3-surface-rgb, 26,29,39), 0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: "var(--v3-radius)", zIndex: 2,
            }}>
              <span style={{ fontSize: 12, color: "var(--v3-accent)" }}>Agent running…</span>
            </div>
          )}
        </div>
      </div>

      {/* Zone 3 — Phase Health Heatmap */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Phase Health</div>
          <button onClick={() => onRunAgent("health-heatmap")} disabled={anyAgentRunning} style={{
            background: "var(--v3-surface-2)", border: "1px solid var(--v3-border)", borderRadius: "var(--v3-radius)",
            padding: "4px 10px", fontSize: 11, color: "var(--v3-text-secondary)", cursor: "pointer", fontFamily: "var(--v3-font)",
          }}>Run Health Heatmap</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {phases.map((p) => {
            const color = phaseColor(p.pct);
            const gateStatus = gateReviews[p.id]?.status ?? "pending";
            const isHovered = hoveredPhase === p.id;
            const isClickable = !!onNavigateToPhase;
            return (
              <div
                key={p.id}
                onClick={() => onNavigateToPhase?.(p.id)}
                onMouseEnter={() => setHoveredPhase(p.id)}
                onMouseLeave={() => setHoveredPhase(null)}
                style={{
                  background: isHovered ? "var(--v3-surface-2)" : "var(--v3-surface)",
                  border: `1px solid ${isHovered ? "var(--v3-accent-glow, var(--v3-border))" : "var(--v3-border)"}`,
                  borderRadius: "var(--v3-radius-lg)", padding: "12px 14px",
                  borderTop: `3px solid ${color}`,
                  cursor: isClickable ? "pointer" : "default",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginBottom: 6 }}>{p.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{p.pct}%</div>
                <div style={{ height: 3, background: "var(--v3-surface-3)", borderRadius: 2, marginTop: 6 }}>
                  <div style={{ height: "100%", width: `${p.pct}%`, background: color, borderRadius: 2, transition: "width 0.4s" }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 4 }}>
                  {gateStatus === "approved"
                    ? "✓ Gate approved"
                    : gateStatus === "remediation-requested"
                    ? "⚠ Remediation"
                    : gateStatus === "in-review"
                    ? "In review"
                    : "Gate pending"}
                </div>
              </div>
            );
          })}
        </div>

        {/* Agent activity feed */}
        {agentActivity.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Recent Agent Activity</div>
            <AgentActivityFeed items={agentActivity} maxItems={5} compact />
          </div>
        )}
      </div>
    </div>
  );
}
