import React, { useMemo, useState } from "react";
import type { ProgramSummary, RAIDEntry } from "@/new/types";
import { PHASE_LABELS, confidenceColor, healthLabel, severityChipClass, priorityChipClass } from "@/v3/lib/uiHelpers";
import AdamExplainsTooltip from "@/v3/components/AdamExplainsTooltip";
import { Kpi } from "@/v3/components/ui/Kpi";

interface ExecutiveViewProps {
  program: ProgramSummary | null;
  programs: ProgramSummary[];
  confidenceScore: number | null;
  onApproveGate: (phaseId: string) => Promise<void>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
  onNavigateToDecide: () => void;
  onNavigateToGates: () => void;
  onNavigateToPipeline: () => void;
  onNavigateToPhase: (phaseId: string) => void;
  onNavigateToRisks: () => void;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--v3-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        marginBottom: 12,
        fontFamily: "var(--v3-font)",
      }}
    >
      {children}
    </div>
  );
}

function PhaseProgressRow({
  label,
  pct,
  status,
  onClick,
}: {
  label: string;
  pct: number;
  status: string;
  onClick: () => void;
}) {
  const barColor =
    pct >= 80
      ? "var(--v3-green)"
      : pct > 0
      ? "var(--v3-accent)"
      : "var(--v3-border)";

  const chipCls =
    pct >= 80
      ? "v3-chip green"
      : pct > 0
      ? "v3-chip muted"
      : "v3-chip muted";

  const chipLabel =
    status === "complete" || pct >= 100
      ? "Complete"
      : pct > 0
      ? "In Progress"
      : "Not Started";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid var(--v3-border-soft)",
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        background: "transparent",
        fontFamily: "var(--v3-font)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--v3-accent) 5%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div
        style={{
          width: 110,
          flexShrink: 0,
          fontSize: 12,
          color: "var(--v3-text-secondary)",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, position: "relative", height: 6, background: "var(--v3-surface-3)", borderRadius: 99 }}>
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: `${Math.min(pct, 100)}%`,
            background: barColor,
            borderRadius: 99,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <div style={{ width: 34, textAlign: "right", fontSize: 12, color: "var(--v3-text-muted)", fontWeight: 600 }}>
        {pct}%
      </div>
      <div style={{ width: 86, flexShrink: 0 }}>
        <span className={chipCls} style={{ fontSize: 11 }}>
          {chipLabel}
        </span>
      </div>
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ExecutiveView({
  program,
  confidenceScore,
  onApproveGate,
  onRunAgent,
  anyAgentRunning,
  onNavigateToDecide,
  onNavigateToGates,
  onNavigateToPipeline,
  onNavigateToPhase,
  onNavigateToRisks,
}: ExecutiveViewProps) {
  const [approvingPhase, setApprovingPhase] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Extract inner program data for agent-generated artifacts ─────────────
  const innerData = useMemo<Record<string, unknown>>(() => {
    if (!program?.rawData) return {};
    const rd = program.rawData as Record<string, unknown>;
    if (typeof rd.data === "object" && rd.data !== null) return rd.data as Record<string, unknown>;
    return rd;
  }, [program?.rawData]);

  const dailyBriefing = useMemo(() => {
    const b = innerData.dailyBriefing;
    if (!b || typeof b !== "object") return null;
    return b as {
      headline?: string;
      focusItems?: Array<{ item: string; urgency?: string; owner?: string; action?: string }>;
      blockers?: Array<{ description: string; phase?: string; impact?: string }>;
      decisionsNeeded?: string[];
      progressHighlight?: string;
      ragStatus?: "green" | "amber" | "red";
      generatedAt?: string;
      reason?: string;
    };
  }, [innerData]);

  const steercoAgenda = useMemo(() => {
    const a = innerData.steercoAgenda;
    if (!a || typeof a !== "object") return null;
    return a as {
      title?: string;
      date?: string;
      duration?: string;
      attendees?: string[];
      agenda?: Array<{ item: string; type?: string; owner?: string; durationMins?: number; context?: string }>;
      preReadItems?: string[];
      parkingLot?: string[];
      generatedAt?: string;
    };
  }, [innerData]);

  const todayLabelCopy = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const phases = program?.phases ?? [];
  const totalGates = program?.phases.length ?? 0;
  // Only count gate reviews that correspond to an actual phase in this programme —
  // stale/orphaned keys (e.g. from a prior methodology) must not inflate the count.
  const phaseIdSet = new Set(program?.phases.map((p) => p.id) ?? []);
  const approvedGatesCopy = program?.gateReviews
    ? Object.entries(program.gateReviews).filter(
        ([phaseId, g]) =>
          phaseIdSet.has(phaseId) &&
          typeof g === "object" &&
          g !== null &&
          (g as { status: string }).status === "approved",
      ).length
    : 0;
  const avgPctCopy = phases.length > 0
    ? Math.round(phases.reduce((s, p) => s + p.pct, 0) / phases.length)
    : 0;

  // handleCopyBrief is defined after useMemo hooks below — see bottom of component

  const todayLabel = todayLabelCopy;

  // ── Critical risks (severity high/critical, capped at 3) ─────────────────
  const criticalRisks = useMemo<RAIDEntry[]>(() => {
    if (!program?.raidEntries) return [];
    return program.raidEntries
      .filter(
        (r) =>
          r.type === "risk" &&
          (r.severity === "high" || r.severity === "critical") &&
          r.status !== "closed",
      )
      .slice(0, 3);
  }, [program]);

  // ── Decision escalations (open + critical/high, capped at 3) ─────────────
  const escalatedDecisions = useMemo(() => {
    if (!program?.decisionQueue) return [];
    return program.decisionQueue
      .filter(
        (d) =>
          d.status === "open" &&
          (d.priority === "critical" || d.priority === "high"),
      )
      .sort((a, b) => {
        const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
      });
  }, [program]);

  const shownDecisions = escalatedDecisions.slice(0, 3);
  const extraDecisions = escalatedDecisions.length - shownDecisions.length;

  // ── Gate counts (use pre-declared above) ─────────────────────────────────
  const approvedGates = approvedGatesCopy;
  const avgPct = avgPctCopy;

  const health = healthLabel(confidenceScore);

  // ── Copy brief to clipboard ───────────────────────────────────────────────
  const handleCopyBrief = () => {
    if (!program) return;
    const topRisks = (program.raidEntries || [])
      .filter((r) => r.type === "risk" && (r.severity === "high" || r.severity === "critical") && r.status !== "closed")
      .slice(0, 3);
    const topDecisions = (program.decisionQueue || [])
      .filter((d) => d.status === "open" && (d.priority === "critical" || d.priority === "high"))
      .slice(0, 3);
    const lines = [
      `EXECUTIVE BRIEF — ${program.name}`,
      `As of ${todayLabelCopy}`,
      ``,
      `Confidence: ${confidenceScore !== null ? confidenceScore + "%" : "N/A"} | Gates: ${approvedGatesCopy}/${totalGates} | Completion: ${avgPctCopy}%`,
      ``,
      topRisks.length > 0
        ? `CRITICAL RISKS:\n${topRisks.map((r) => `• ${r.title} [${r.severity}]`).join("\n")}`
        : "CRITICAL RISKS: None",
      ``,
      topDecisions.length > 0
        ? `DECISIONS AWAITING INPUT:\n${topDecisions.map((d) => `• ${(d.title || d.question)} [${d.priority}]`).join("\n")}`
        : "DECISIONS AWAITING INPUT: None",
      ``,
      `PHASE PROGRESS:`,
      ...phases.map((p) => `• ${PHASE_LABELS[p.id] ?? (p as { displayName?: string }).displayName ?? p.id}: ${p.pct}%`),
    ];
    const text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        // Fallback: create a temporary textarea and use execCommand
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      // No clipboard API — show the text in a prompt so user can copy manually
      window.prompt("Copy the brief below (Ctrl+A, Ctrl+C):", text);
    }
  };

  // ── Gate approve handler ──────────────────────────────────────────────────
  async function handleApprove(phaseId: string) {
    setApprovingPhase(phaseId);
    try {
      await onApproveGate(phaseId);
    } finally {
      setApprovingPhase(null);
    }
  }

  if (!program) {
    return (
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "80px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          fontFamily: "var(--v3-font)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 36, opacity: 0.3 }}>◇</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--v3-text-primary)" }}>
          Executive View
        </div>
        <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.6, maxWidth: 360 }}>
          Select a programme from the top bar to view the executive summary, confidence score, critical risks, and decisions awaiting your input.
        </div>
      </div>
    );
  }

  return (
    <div
      data-print="executive-brief"
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "28px 24px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 32,
        fontFamily: "var(--v3-font)",
      }}
    >
      {/* ── 1. Programme header ────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          paddingBottom: 20,
          borderBottom: "1px solid var(--v3-border-soft)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: "var(--v3-text-primary)",
              letterSpacing: "-0.025em",
              lineHeight: 1.15,
              marginBottom: 8,
            }}
          >
            {program.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className={health.cls} style={{ fontSize: 12, fontWeight: 600 }}>
              {health.text}
            </span>
            <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>As of {todayLabel}</span>
          </div>
        </div>

        {confidenceScore !== null && (
          <AdamExplainsTooltip metric="confidence" value={confidenceScore} placement="left">
            <div style={{ textAlign: "right", cursor: "help" }}>
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 900,
                  lineHeight: 1,
                  color: confidenceColor(confidenceScore),
                  letterSpacing: "-0.03em",
                }}
              >
                {confidenceScore}
              </div>
              <div style={{ fontSize: 11, color: "var(--v3-text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Confidence
              </div>
            </div>
          </AdamExplainsTooltip>
        )}
      </div>

      {/* ── 2. Confidence & Health row ─────────────────────────────────────── */}
      <div>
        <SectionLabel>Programme Metrics</SectionLabel>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {confidenceScore !== null && (
            <Kpi
              label="Confidence"
              value={`${confidenceScore}%`}
              color={confidenceColor(confidenceScore)}
              emphasis
              onClick={onNavigateToGates}
            />
          )}
          <Kpi label="Gates Approved" value={`${approvedGates} of ${totalGates}`} onClick={onNavigateToGates} />
          <Kpi label="Completion" value={`${avgPct}%`} onClick={onNavigateToPipeline} />
          <Kpi
            label="Open Decisions"
            value={program.decisionQueue?.filter((d) => d.status === "open").length ?? 0}
            color={
              (program.decisionQueue?.filter((d) => d.status === "open").length ?? 0) > 0
                ? "var(--v3-amber)"
                : undefined
            }
            onClick={onNavigateToDecide}
          />
        </div>
      </div>

      {/* ── 3. Critical risks ─────────────────────────────────────────────── */}
      <div>
        <SectionLabel>Critical Risks</SectionLabel>
        <div
          style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            overflow: "hidden",
          }}
        >
          {criticalRisks.length === 0 ? (
            <div
              style={{
                padding: "18px 20px",
                fontSize: 13,
                color: "var(--v3-text-muted)",
                fontStyle: "italic",
              }}
            >
              No critical risks recorded.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    background: "var(--v3-surface-2)",
                    borderBottom: "1px solid var(--v3-border-soft)",
                  }}
                >
                  {["Risk", "Severity", "Status"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "9px 14px",
                        textAlign: "left",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--v3-text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {criticalRisks.map((risk, i) => (
                  <tr
                    key={risk.id}
                    onClick={onNavigateToRisks}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onNavigateToRisks();
                      }
                    }}
                    style={{
                      borderBottom:
                        i < criticalRisks.length - 1 ? "1px solid var(--v3-border-soft)" : undefined,
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--v3-accent) 5%, transparent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <td
                      style={{
                        padding: "11px 14px",
                        fontSize: 13,
                        color: "var(--v3-text-primary)",
                        lineHeight: 1.45,
                      }}
                    >
                      {risk.title}
                    </td>
                    <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
                      <span className={severityChipClass(risk.severity)} style={{ fontSize: 11 }}>
                        {risk.severity}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "11px 14px",
                        fontSize: 12,
                        color: "var(--v3-text-muted)",
                        textTransform: "capitalize",
                      }}
                    >
                      {risk.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── 4. Decisions awaiting executive input ─────────────────────────── */}
      <div>
        <SectionLabel>Decisions Awaiting Executive Input</SectionLabel>
        {shownDecisions.length === 0 ? (
          <div
            style={{
              background: "var(--v3-surface)",
              border: "1px solid var(--v3-border-soft)",
              borderRadius: "var(--v3-radius)",
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>✓</span>
            <span style={{ fontSize: 13, color: "var(--v3-green)", fontWeight: 500 }}>
              No escalations pending.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shownDecisions.map((d) => {
              const phaseLabel = PHASE_LABELS[d.phaseId] ?? d.phaseId;
              const isGateDecision = d.type === "gate" || d.title?.toLowerCase().includes("gate");
              return (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "14px 16px",
                    background: "var(--v3-surface)",
                    border: "1px solid var(--v3-border-soft)",
                    borderRadius: "var(--v3-radius)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--v3-text-primary)",
                        marginBottom: 4,
                      }}
                    >
                      {d.title || d.question}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className={priorityChipClass(d.priority)} style={{ fontSize: 11 }}>
                        {d.priority}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>
                        {phaseLabel}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                    {isGateDecision ? (
                      <button
                        disabled={approvingPhase === d.phaseId}
                        onClick={() => handleApprove(d.phaseId)}
                        style={{
                          padding: "6px 14px",
                          background: "var(--v3-accent)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "var(--v3-radius)",
                          cursor: approvingPhase === d.phaseId ? "not-allowed" : "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                          fontFamily: "var(--v3-font)",
                          opacity: approvingPhase === d.phaseId ? 0.6 : 1,
                        }}
                      >
                        {approvingPhase === d.phaseId ? "Approving…" : "Approve Gate"}
                      </button>
                    ) : (
                      <button
                        onClick={onNavigateToDecide}
                        style={{
                          padding: "6px 14px",
                          background: "var(--v3-surface-2)",
                          color: "var(--v3-text-primary)",
                          border: "1px solid var(--v3-border-soft)",
                          borderRadius: "var(--v3-radius)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                          fontFamily: "var(--v3-font)",
                        }}
                      >
                        Review →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {extraDecisions > 0 && (
              <button
                onClick={onNavigateToDecide}
                style={{
                  background: "none",
                  border: "none",
                  padding: "4px 0",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--v3-accent)",
                  fontWeight: 500,
                  fontFamily: "var(--v3-font)",
                  textAlign: "left",
                }}
              >
                View all {escalatedDecisions.length} decisions →
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── 5. Stage progress ─────────────────────────────────────────────── */}
      <div>
        <SectionLabel>Phase Progress</SectionLabel>
        <div
          style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            padding: "4px 16px 8px",
          }}
        >
          {phases.map((phase) => (
            <PhaseProgressRow
              key={phase.id}
              label={PHASE_LABELS[phase.id] ?? phase.displayName}
              pct={phase.pct}
              status={phase.status}
              onClick={() => onNavigateToPhase(phase.id)}
            />
          ))}
          {phases.length === 0 && (
            <div style={{ padding: "16px 0", fontSize: 13, color: "var(--v3-text-muted)" }}>
              No phase data available.
            </div>
          )}
        </div>
      </div>

      {/* ── 6. Executive actions ──────────────────────────────────────────── */}
      <div>
        <SectionLabel>Actions</SectionLabel>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            disabled={anyAgentRunning}
            onClick={() => onRunAgent("executive-brief", "program")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              background: "var(--v3-accent)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--v3-radius)",
              cursor: anyAgentRunning ? "not-allowed" : "pointer",
              fontFamily: "var(--v3-font)",
              fontSize: 13,
              fontWeight: 600,
              opacity: anyAgentRunning ? 0.55 : 1,
              transition: "opacity 0.15s",
            }}
          >
            <span>◇</span>
            <span>{anyAgentRunning ? "Preparing your brief…" : "What should I know today?"}</span>
          </button>

          <button
            disabled={anyAgentRunning}
            onClick={() => onRunAgent("steerco-prep", "program")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              background: "var(--v3-surface)",
              color: "var(--v3-text-primary)",
              border: "1px solid var(--v3-border)",
              borderRadius: "var(--v3-radius)",
              cursor: anyAgentRunning ? "not-allowed" : "pointer",
              fontFamily: "var(--v3-font)",
              fontSize: 13,
              fontWeight: 600,
              opacity: anyAgentRunning ? 0.55 : 1,
              transition: "opacity 0.15s",
            }}
          >
            <span>⬡</span>
            <span>{anyAgentRunning ? "Building agenda…" : "Prepare Leadership Review"}</span>
          </button>

          <button
            onClick={handleCopyBrief}
            style={{
              background: "none",
              border: "1px solid var(--v3-border)",
              borderRadius: "var(--v3-radius)",
              padding: "8px 16px",
              fontSize: 13,
              color: copied ? "var(--v3-green)" : "var(--v3-text-secondary)",
              cursor: "pointer",
              fontFamily: "var(--v3-font)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "color 0.15s",
            }}
          >
            {copied ? "✓ Copied" : "⎘ Copy Summary"}
          </button>
          {/* Print button removed — low-frequency action, browser print available via browser menu */}
        </div>
      </div>

      {/* ── 7. Daily Briefing output ──────────────────────────────────────── */}
      {dailyBriefing && !dailyBriefing.reason && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <SectionLabel>Today's Programme Brief</SectionLabel>
            {dailyBriefing.ragStatus && (
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 10,
                background: dailyBriefing.ragStatus === "green" ? "rgba(34,197,94,0.12)" : dailyBriefing.ragStatus === "amber" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
                color: dailyBriefing.ragStatus === "green" ? "var(--v3-green)" : dailyBriefing.ragStatus === "amber" ? "var(--v3-amber)" : "var(--v3-red, #ef4444)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 12,
              }}>{dailyBriefing.ragStatus.toUpperCase()}</span>
            )}
            {dailyBriefing.generatedAt && (
              <span style={{ fontSize: 11, color: "var(--v3-text-muted)", marginLeft: "auto", marginBottom: 12 }}>
                {new Date(dailyBriefing.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {dailyBriefing.headline && (
              <div style={{
                background: "var(--v3-surface)",
                border: "1px solid var(--v3-border-soft)",
                borderRadius: "var(--v3-radius)",
                padding: "14px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--v3-text-primary)",
                lineHeight: 1.5,
              }}>
                {dailyBriefing.headline}
              </div>
            )}
            {dailyBriefing.progressHighlight && (
              <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", fontStyle: "italic", paddingLeft: 4 }}>
                ◎ {dailyBriefing.progressHighlight}
              </div>
            )}
            {dailyBriefing.focusItems && dailyBriefing.focusItems.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Focus Today</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {dailyBriefing.focusItems.map((f, i) => (
                    <div key={i} style={{
                      background: "var(--v3-surface)",
                      border: "1px solid var(--v3-border-soft)",
                      borderRadius: "var(--v3-radius)",
                      padding: "10px 14px",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                    }}>
                      <span style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 6,
                        background: f.urgency === "now" ? "rgba(239,68,68,0.1)" : f.urgency === "today" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)",
                        color: f.urgency === "now" ? "var(--v3-red, #ef4444)" : f.urgency === "today" ? "var(--v3-amber)" : "var(--v3-accent)",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        flexShrink: 0,
                        marginTop: 1,
                      }}>{f.urgency || "today"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 500, lineHeight: 1.4 }}>{f.item}</div>
                        {f.action && <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 2 }}>→ {f.action}</div>}
                        {f.owner && <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>Owner: {f.owner}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {dailyBriefing.blockers && dailyBriefing.blockers.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-red, #ef4444)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Blockers</div>
                {dailyBriefing.blockers.map((b, i) => (
                  <div key={i} style={{ fontSize: 13, color: "var(--v3-text-primary)", padding: "6px 0", borderBottom: i < (dailyBriefing.blockers?.length ?? 0) - 1 ? "1px solid var(--v3-border-soft)" : undefined }}>
                    ⊘ {b.description}
                    {b.impact && <span style={{ fontSize: 12, color: "var(--v3-text-muted)", marginLeft: 8 }}>— {b.impact}</span>}
                  </div>
                ))}
              </div>
            )}
            {dailyBriefing.decisionsNeeded && dailyBriefing.decisionsNeeded.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-amber)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Decisions Needed</div>
                {dailyBriefing.decisionsNeeded.map((d, i) => (
                  <div key={i} style={{ fontSize: 13, color: "var(--v3-text-primary)", padding: "4px 0" }}>⊖ {d}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 8. SteerCo Agenda output ──────────────────────────────────────── */}
      {steercoAgenda && (
        <div>
          <SectionLabel>Leadership Review</SectionLabel>
          <div style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            overflow: "hidden",
          }}>
            <div style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--v3-border-soft)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--v3-text-primary)" }}>{steercoAgenda.title || "Steering Committee Meeting"}</div>
                <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 3 }}>
                  {steercoAgenda.date && <span>{steercoAgenda.date}</span>}
                  {steercoAgenda.duration && <span> · {steercoAgenda.duration}</span>}
                </div>
              </div>
              {steercoAgenda.generatedAt && (
                <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                  {new Date(steercoAgenda.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            {steercoAgenda.attendees && steercoAgenda.attendees.length > 0 && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--v3-border-soft)", fontSize: 12, color: "var(--v3-text-secondary)" }}>
                <span style={{ fontWeight: 600, color: "var(--v3-text-muted)", marginRight: 8 }}>ATTENDEES</span>
                {steercoAgenda.attendees.join(" · ")}
              </div>
            )}
            {steercoAgenda.agenda && steercoAgenda.agenda.length > 0 && (
              <div>
                {steercoAgenda.agenda.map((item, i) => (
                  <div key={i} style={{
                    padding: "11px 16px",
                    borderBottom: i < (steercoAgenda.agenda?.length ?? 0) - 1 ? "1px solid var(--v3-border-soft)" : undefined,
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}>
                    <span style={{ fontSize: 12, color: "var(--v3-text-muted)", minWidth: 24, textAlign: "right", paddingTop: 1 }}>{i + 1}.</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 500 }}>{item.item}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                        {item.type && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{item.type}</span>}
                        {item.owner && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>· {item.owner}</span>}
                        {item.durationMins && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>· {item.durationMins}min</span>}
                      </div>
                      {item.context && <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 4, lineHeight: 1.5 }}>{item.context}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {steercoAgenda.preReadItems && steercoAgenda.preReadItems.length > 0 && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--v3-border-soft)", background: "var(--v3-surface-2)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Pre-Read</div>
                {steercoAgenda.preReadItems.map((p, i) => <div key={i} style={{ fontSize: 12, color: "var(--v3-text-secondary)", padding: "2px 0" }}>• {p}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
