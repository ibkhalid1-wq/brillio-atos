// ─── ExecCommandPanel ────────────────────────────────────────────────────────
// Synthesises confidence signals, open decisions, and readiness actions into
// a ranked "What to do now" command panel for executives and programme leads.
// Replaces generic agent buttons with consequence-driven actions.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import type { ConfidenceScore } from "@/v3/lib/confidenceScore";
import type { DecisionSummary, ProgramSummary } from "@/new/types";
import type { V3MoreView } from "@/v3/types";

interface ExecAction {
  id: string;
  label: string;
  icon: string;
  reason: string;
  consequence: string;
  agentId?: string;
  workspaceId?: V3MoreView;
  urgency: "critical" | "high" | "normal";
  estimatedImpact?: string;
}

interface ExecCommandPanelProps {
  program: ProgramSummary;
  confidenceResult: ConfidenceScore | undefined;
  confidenceScore: number | null;
  decisionQueue: DecisionSummary[];
  onRunAgent: (agentId: string) => void;
  onOpenMoreView?: (view: V3MoreView) => void;
  /** When an agent is already running, action buttons should be disabled */
  anyAgentRunning?: boolean;
}

export function ExecCommandPanel({
  program,
  confidenceResult,
  confidenceScore,
  decisionQueue,
  onRunAgent,
  onOpenMoreView,
  anyAgentRunning = false,
}: ExecCommandPanelProps) {
  // Build ranked action list from signals
  const actions: ExecAction[] = [];

  // 1. Gate readiness — highest weight signal
  const gateReadiness = confidenceResult?.breakdown.gateReadiness ?? 0;
  if (gateReadiness < 60) {
    actions.push({
      id: "gate-check",
      label: "Check phase readiness",
      icon: "⬡",
      reason: `Gate readiness is ${gateReadiness}% — below the minimum 60% to proceed`,
      consequence: "Cannot approve any phase gate until readiness improves",
      agentId: "gate-review",
      urgency: gateReadiness < 40 ? "critical" : "high",
      estimatedImpact: "+10–20 pts confidence",
    });
  }

  // 2. Overdue decisions — most damaging to team velocity
  const now = Date.now();
  const overdueDecisions = decisionQueue.filter((d) => {
    if (!d.createdAt || d.status !== "open" && d.status !== undefined && d.status !== "") return false;
    const ageDays = (now - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays >= 14;
  });
  const agingDecisions = decisionQueue.filter((d) => {
    if (!d.createdAt || d.status !== "open" && d.status !== undefined && d.status !== "") return false;
    const ageDays = (now - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays >= 7 && ageDays < 14;
  });

  if (overdueDecisions.length > 0) {
    const oldest = overdueDecisions.reduce((a, b) => {
      const aDays = (now - new Date(a.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const bDays = (now - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      return aDays > bDays ? a : b;
    });
    const oldestDays = Math.floor((now - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    actions.push({
      id: "resolve-decisions",
      label: `Resolve ${overdueDecisions.length} overdue decision${overdueDecisions.length > 1 ? "s" : ""}`,
      icon: "⊖",
      reason: `Oldest: "${oldest.title}" — ${oldestDays} days overdue`,
      consequence: `Each week of delay reduces programme confidence by ~2%. Current cost: ~${Math.floor(oldestDays / 7) * 2}% confidence`,
      workspaceId: "decision-audit",
      urgency: "critical",
      estimatedImpact: `-${overdueDecisions.length * 10} pts confidence penalty`,
    });
  } else if (agingDecisions.length > 0) {
    actions.push({
      id: "aging-decisions",
      label: `Review ${agingDecisions.length} aging decision${agingDecisions.length > 1 ? "s" : ""}`,
      icon: "⊖",
      reason: `${agingDecisions.length} decision(s) approaching the 14-day overdue threshold`,
      consequence: "Will become overdue within a week — escalate now to prevent confidence penalty",
      workspaceId: "decision-audit",
      urgency: "high",
      estimatedImpact: "Prevents upcoming confidence drop",
    });
  }

  // 3. Risk posture — critical risks block gates
  const riskPosture = confidenceResult?.breakdown.riskPosture ?? 100;
  const riskSignal = confidenceResult?.signals.find((s) => s.label === "Risk posture");
  if (riskPosture < 60) {
    actions.push({
      id: "mitigate-risks",
      label: "Mitigate critical risks",
      icon: "⚠",
      reason: riskSignal?.explanation ?? `Risk posture is ${riskPosture}% — critical risks are unmitigated`,
      consequence: "Unmitigated critical risks can cascade to gate failures and delivery delays",
      workspaceId: "risks",
      urgency: riskPosture < 40 ? "critical" : "high",
      estimatedImpact: riskSignal?.topAction ?? "Review and close open critical risks",
    });
  }

  // 4. Milestone health
  const milestoneHealth = confidenceResult?.breakdown.milestoneHealth ?? 100;
  const milestoneSignal = confidenceResult?.signals.find((s) => s.label === "Milestone health");
  if (milestoneHealth < 60) {
    actions.push({
      id: "milestone-review",
      label: "Review at-risk milestones",
      icon: "◷",
      reason: milestoneSignal?.explanation ?? `Milestone health is ${milestoneHealth}% — deliverables are slipping`,
      consequence: "Milestone slippage compounds delivery risk — address before phase gate",
      workspaceId: "milestones",
      urgency: milestoneHealth < 40 ? "critical" : "high",
      estimatedImpact: "+5–10 pts once overdue milestones are resolved",
    });
  }

  // 5. Input completeness — agents can't generate quality output without data
  const inputCompleteness = confidenceResult?.breakdown.inputCompleteness ?? 100;
  if (inputCompleteness < 40) {
    actions.push({
      id: "complete-inputs",
      label: "Complete phase inputs",
      icon: "⊡",
      reason: `Phase input quality is ${inputCompleteness}% — reliable analysis requires more complete data`,
      consequence: "Low input quality reduces the accuracy of all generated summaries and recommendations by up to 40%",
      urgency: "high",
      estimatedImpact: "+8–15 pts confidence once inputs reach 70%+",
    });
  }

  // 6. If everything is healthy, recommend running daily briefing
  if (actions.length === 0) {
    actions.push({
      id: "daily-briefing",
      label: "Get today's programme brief",
      icon: "◎",
      reason: "All signals are healthy — get a summary of today's priorities",
      consequence: "",
      agentId: "daily-briefing",
      urgency: "normal",
      estimatedImpact: "Keeps team aligned on daily priorities",
    });
  }

  // Sort: critical → high → normal
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, normal: 2 };
  actions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  // Show top 3 max
  const topActions = actions.slice(0, 3);

  return (
    <div>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: "var(--v3-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 12,
      }}>
        What Needs Your Attention
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {topActions.map((action, i) => {
          const isCritical = action.urgency === "critical";
          const isHigh = action.urgency === "high";
          const bgColor = isCritical ? "rgba(239,68,68,0.07)" : isHigh ? "rgba(245,158,11,0.07)" : "var(--v3-surface-2)";
          const borderColor = isCritical ? "rgba(239,68,68,0.25)" : isHigh ? "rgba(245,158,11,0.25)" : "var(--v3-border-soft)";
          const urgencyColor = isCritical ? "var(--v3-red, #ef4444)" : isHigh ? "var(--v3-amber)" : "var(--v3-text-muted)";

          return (
            <div
              key={action.id}
              style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: "var(--v3-radius)",
                padding: "12px 14px",
              }}
            >
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{action.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--v3-text-primary)", marginBottom: 2 }}>
                    {i + 1}. {action.label}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>
                    {action.reason}
                  </div>
                </div>
                {/* Urgency chip */}
                {action.urgency !== "normal" && (
                  <span style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 10,
                    background: isCritical ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                    color: urgencyColor,
                    fontWeight: 700,
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                  }}>
                    {action.urgency}
                  </span>
                )}
              </div>

              {/* Consequence */}
              {action.consequence && (
                <div style={{
                  fontSize: 11,
                  color: urgencyColor,
                  fontStyle: "italic",
                  marginTop: 6,
                  paddingLeft: 26,
                  lineHeight: 1.5,
                }}>
                  {action.consequence}
                </div>
              )}

              {/* Action buttons row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingLeft: 26 }}>
                {action.agentId && (
                  <button
                    type="button"
                    disabled={anyAgentRunning}
                    onClick={() => !anyAgentRunning && onRunAgent(action.agentId!)}
                    title={anyAgentRunning ? "An agent is already running — please wait" : undefined}
                    style={{
                      fontSize: 12,
                      padding: "4px 12px",
                      borderRadius: 6,
                      background: anyAgentRunning ? "var(--v3-surface-2)" : "var(--v3-accent)",
                      color: anyAgentRunning ? "var(--v3-text-muted)" : "#fff",
                      border: anyAgentRunning ? "1px solid var(--v3-border)" : "none",
                      cursor: anyAgentRunning ? "not-allowed" : "pointer",
                      fontWeight: 500,
                      opacity: anyAgentRunning ? 0.6 : 1,
                      transition: "all 0.15s",
                    }}
                  >
                    {anyAgentRunning ? "Analysing…" : "Analyse now →"}
                  </button>
                )}
                {action.workspaceId && onOpenMoreView && (
                  <button
                    type="button"
                    onClick={() => onOpenMoreView(action.workspaceId!)}
                    style={{
                      fontSize: 12,
                      padding: "4px 12px",
                      borderRadius: 6,
                      background: "var(--v3-surface)",
                      color: "var(--v3-text-primary)",
                      border: "1px solid var(--v3-border)",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Review →
                  </button>
                )}
                {action.estimatedImpact && (
                  <span style={{ fontSize: 11, color: "var(--v3-text-muted)", marginLeft: "auto" }}>
                    {action.estimatedImpact}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
