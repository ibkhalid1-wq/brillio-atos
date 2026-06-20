import { useState } from "react";
import type { PhaseAgentState } from "@/lib/adamPhaseAgentTypes";

interface Props {
  state: PhaseAgentState | null;
  phaseId: string;
  onDismiss: () => void;
  onReset: () => void;
  allAgents?: Record<string, { agentState?: any }>;
  queueSnapshot?: Array<{ phaseId: string; urgencyLevel: string; gateReadiness: number }>;
  activeAgentCount?: number;
  temperaturePreset?: string;
}

interface BenchmarkDelta {
  delta: number;
  message: string;
  sampleSize: number;
}

const COLORS = {
  white: "#ffffff",
  border: "#e2e8f0",
  text: "#1e293b",
  subtext: "#64748b",
  blue: "#2563eb",
  blueSoft: "#eff6ff",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  gray: "#94a3b8",
};

const TYPE_LABELS: Record<string, string> = {
  gate_assessment: "Gate",
  draft_artifact: "Draft",
  extract_adr: "ADR",
  populate_fields: "Fields",
  cross_phase_route: "Route",
  proactive_nudge: "Nudge",
  ask_question: "Question",
  revise_artifact: "Revision",
  generate_briefing: "Briefing",
  generate_handoff: "Handoff",
  rebaseline_strategy: "Rebaseline",
  predict_downstream_risk: "Risk",
  retro_adr_generation: "Retro ADR",
  populate_compliance_controls: "Compliance",
  escalate: "Escalation",
};

function truncate(text: string, max = 72): string {
  const clean = `${text || ""}`.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function formatPhaseLabel(phaseId: string): string {
  return `${phaseId || "phase"}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusDisplay(status: string): { icon: string; color: string } {
  if (status === "done") return { icon: "✓", color: COLORS.green };
  if (status === "failed") return { icon: "✗", color: COLORS.red };
  if (status === "skipped") return { icon: "⏭", color: COLORS.gray };
  if (status === "running") return { icon: "⟳", color: COLORS.blue };
  return { icon: "○", color: COLORS.gray };
}

export function PhaseAgentStatusBar({
  state,
  phaseId,
  onDismiss,
  onReset,
  allAgents,
  queueSnapshot,
  activeAgentCount,
  temperaturePreset,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [portfolioExpanded, setPortfolioExpanded] = useState(false);
  const benchmark = (state?.lastBenchmarkDelta ?? null) as BenchmarkDelta | null;

  if (!state) {
    return null;
  }

  const completedCount = (state.tasks || []).filter((task) => task.status === "done").length;
  const currentTask = [...(state.tasks || [])]
    .reverse()
    .find((task) => task.status === "running" || task.status === "pending" || task.status === "failed" || task.status === "done");
  const taskSummary = currentTask?.description || `Monitoring ${formatPhaseLabel(phaseId)}`;
  const portfolioRows = Object.entries(allAgents || {}).map(([id, agent]) => {
    const readiness = Number(agent?.agentState?.lastObservedReadiness || 0);
    return {
      phaseId: id,
      readiness,
      running: !!agent?.agentState?.running,
      active: !!agent?.agentState,
      ready: readiness >= 85,
      color: readiness >= 85 ? COLORS.green : readiness >= 50 ? COLORS.amber : COLORS.red,
    };
  });
  const portfolioActiveCount = portfolioRows.filter((row) => row.active).length;
  const portfolioRunningCount = portfolioRows.filter((row) => row.running).length;
  const portfolioReadyCount = portfolioRows.filter((row) => row.ready).length;

  const getTypeBadgeStyle = (type: string) => {
    if (type === "ask_question") {
      return { background: "#fef3c7", color: "#d97706" };
    }
    if (type === "revise_artifact") {
      return { background: "#ede9fe", color: "#7c3aed" };
    }
    if (type === "escalate") {
      return { background: "#fee2e2", color: "#dc2626" };
    }
    return { background: "#e2e8f0", color: COLORS.text };
  };

  return (
    <div
      style={{
        marginTop: 14,
        background: COLORS.white,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        dangerouslySetInnerHTML={{
          __html: `
            <style>
              @keyframes adamPhaseAgentPulse {
                0% { opacity: 1; }
                50% { opacity: 0.3; }
                100% { opacity: 1; }
              }
            </style>
          `,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: state.running ? COLORS.blue : COLORS.gray,
              animation: state.running ? "adamPhaseAgentPulse 1.2s infinite" : "none",
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 13, fontWeight: 800, color: COLORS.text }}>Phase Agent</div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 8px",
              borderRadius: 999,
              background: COLORS.blueSoft,
              color: COLORS.blue,
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {formatPhaseLabel(phaseId)}
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            border: "none",
            background: "transparent",
            color: COLORS.subtext,
            fontSize: 14,
            cursor: "pointer",
            padding: 2,
          }}
          aria-label="Dismiss phase agent"
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.text, marginBottom: 4 }}>
            {truncate(taskSummary)}
          </div>
          <div style={{ fontSize: 11.5, color: COLORS.subtext }}>
            {completedCount} / {Math.max((state.tasks || []).length, 0)} tasks
          </div>
          {state?.autonomyMode && state.autonomyMode !== "normal" ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                marginTop: 6,
                background: state.autonomyMode === "cautious" ? "#fef3c7" : "#dcfce7",
                color: state.autonomyMode === "cautious" ? "#92400e" : "#14532d",
              }}
            >
              {state.autonomyMode === "cautious"
                ? "⚠ Cautious mode — high rejection rate"
                : "✓ High autonomy — consistent acceptance"}
              {state.draftOutcomeHistory?.length >= 3 ? (
                <span style={{ opacity: 0.7 }}>
                  ({Math.round((state.rejectionRate ?? 0) * 100)}% rejection over last {Math.min(state.draftOutcomeHistory.length, 10)})
                </span>
              ) : null}
            </div>
          ) : null}
          {temperaturePreset && temperaturePreset !== "balanced" ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                marginTop: 6,
                background: "#f0f9ff",
                color: "#0369a1",
              }}
            >
              {temperaturePreset === "precise" ? "🎯 Precise mode" : "✨ Creative mode"}
            </div>
          ) : null}
          {state?.urgency && state.urgency.level !== "none" ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                marginTop: 6,
                background: state.urgency.level === "overdue"
                  ? "#dc2626"
                  : state.urgency.level === "critical"
                    ? "#fee2e2"
                    : "#fef3c7",
                color: state.urgency.level === "overdue"
                  ? "#ffffff"
                  : state.urgency.level === "critical"
                    ? "#991b1b"
                    : "#92400e",
              }}
            >
              {state.urgency.level === "overdue"
                ? `Gate overdue by ${Math.abs(state.urgency.daysRemaining || 0)} day(s)`
                : `Gate in ${state.urgency.daysRemaining} day(s)`}
            </div>
          ) : null}
          {benchmark ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 10,
                marginTop: 6,
                background: benchmark.delta >= 0 ? "#dcfce7" : "#fef3c7",
                color: benchmark.delta >= 0 ? "#14532d" : "#92400e",
              }}
            >
              📊 {benchmark.message}
              <span style={{ opacity: 0.6, marginLeft: 4 }}>
                (n={benchmark.sampleSize})
              </span>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={onReset}
            style={{
              border: `1px solid ${COLORS.border}`,
              background: COLORS.white,
              color: COLORS.text,
              borderRadius: 10,
              padding: "7px 12px",
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {state.escalated && state.escalationSummary ? (
        <div
          style={{
            background: "rgba(254,242,242,0.98)",
            border: "1px solid #fca5a5",
            borderRadius: 12,
            padding: "12px 14px",
            marginTop: 10,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "#dc2626",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Agent Escalation Required
          </div>
          <div style={{ fontSize: 11.5, color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {state.escalationSummary}
          </div>
        </div>
      ) : null}

      {state.iteration >= 3 ? (
        <div style={{ marginTop: 10, fontSize: 11, color: COLORS.subtext }}>
          {state.escalated
            ? "Escalated after 3 iterations. Resolve the blocker above, then reset."
            : "Session limit reached — reset to allow more iterations."}
        </div>
      ) : null}

      {portfolioRows.length ? (
        <div style={{ marginTop: 12, borderTop: `1px solid ${COLORS.border}`, paddingTop: 12 }}>
          <button
            onClick={() => setPortfolioExpanded((value) => !value)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              border: "none",
              background: "transparent",
              padding: 0,
              color: COLORS.subtext,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>Portfolio</span>
            <span>{portfolioActiveCount} / 9 phases active · {portfolioRunningCount} running · {portfolioReadyCount} gate-ready {portfolioExpanded ? "▲" : "▼"}</span>
          </button>
          {portfolioExpanded ? (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {portfolioRows.map((row) => (
                <div
                  key={row.phaseId}
                  style={{
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 12,
                    padding: "8px 10px",
                    background: "#f8fafc",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.text }}>{formatPhaseLabel(row.phaseId)}</div>
                    <div style={{ fontSize: 10.5, color: COLORS.subtext }}>{row.readiness}%</div>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, row.readiness))}%`, height: "100%", background: row.color, borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        onClick={() => setExpanded((value) => !value)}
        style={{
          marginTop: 12,
          border: "none",
          background: "transparent",
          padding: 0,
          color: COLORS.subtext,
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {expanded ? "▲" : "▼"} Task history
      </button>

      {expanded ? (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {(state.tasks || []).length ? (
            (state.tasks || []).slice().reverse().map((task) => {
              const status = getStatusDisplay(task.status);
              const confidence = typeof task.confidence === "number"
                ? `${Math.round(task.confidence * 100)}%`
                : "";
              return (
                <div
                  key={task.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "18px auto 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 12,
                    padding: "8px 10px",
                    background: "#f8fafc",
                  }}
                >
                  <span style={{ color: status.color, fontWeight: 800, fontSize: 12 }}>{status.icon}</span>
                  {(() => {
                    const badgeStyle = getTypeBadgeStyle(task.type);
                    return (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "3px 7px",
                      borderRadius: 999,
                      background: badgeStyle.background,
                      color: badgeStyle.color,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {TYPE_LABELS[task.type] || task.type}
                  </span>
                    );
                  })()}
                  <span style={{ fontSize: 11.5, color: COLORS.text }}>{truncate(task.description)}</span>
                  <span style={{ fontSize: 10.5, color: COLORS.subtext }}>{confidence}</span>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 11.5, color: COLORS.subtext }}>No task history yet.</div>
          )}
        </div>
      ) : null}

      {queueSnapshot && queueSnapshot.length > 0 ? (
        <div style={{ marginTop: 8, fontSize: 11, color: COLORS.subtext }}>
          <span style={{ fontWeight: 500 }}>{activeAgentCount ?? 0} running</span>
          {" · "}
          <span>{queueSnapshot.length} queued: {queueSnapshot.map((item) => item.phaseId).join(", ")}</span>
        </div>
      ) : null}
    </div>
  );
}
