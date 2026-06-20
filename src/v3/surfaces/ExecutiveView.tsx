import React, { useMemo, useState } from "react";
import type { ProgramSummary, RAIDEntry } from "@/new/types";
import { PHASE_LABELS, confidenceColor, healthLabel, severityChipClass, priorityChipClass } from "@/v3/lib/uiHelpers";
import AdamExplainsTooltip from "@/v3/components/AdamExplainsTooltip";
import { Kpi } from "@/v3/components/ui/Kpi";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { derivePhaseStatusRings } from "@/v3/lib/phaseStatusRings";
import { computePhaseReadiness, getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { selectBlockers, selectDecisions, selectEscalatedDecisions, selectHighRisks, selectRisks } from "@/v3/lib/programRaid";
import type { ConfidenceScore } from "@/v3/lib/confidenceScore";

interface ExecutiveViewProps {
  program: ProgramSummary | null;
  programs: ProgramSummary[];
  confidenceScore: number | null;
  /** Full confidence result — drives the signal breakdown (moved from Today). */
  confidenceResult?: ConfidenceScore;
  onApproveGate: (phaseId: string) => Promise<void>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  anyAgentRunning: boolean;
  narrativeRunning: boolean;
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

// Subheading inside the Leadership Review pack. tone tints the label for the
// blocker/contradiction sections so the eye lands on the at-risk content first.
function SteercoHeading({ children, tone }: { children: React.ReactNode; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "var(--v3-red, #ef4444)" : tone === "amber" ? "var(--v3-amber)" : "var(--v3-text-secondary)";
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontFamily: "var(--v3-font)",
      }}
    >
      {children}
    </div>
  );
}

function PhaseProgressRow({
  program,
  phaseId,
  label,
  status,
  onClick,
}: {
  program: ProgramSummary;
  phaseId: string;
  label: string;
  status: string;
  onClick: () => void;
}) {
  const rings = derivePhaseStatusRings(program, phaseId);
  // Phase progress is the gate score — the same composite the outer ring shows
  // (average of approved-artifact completeness and artifact quality), NOT the
  // phase-estimator pct. So the bar/number agree with the ring and a phase with
  // no signed-off output reads its real readiness, not a soft 5% estimate.
  const pct = computePhaseReadiness(program, phaseId).score;
  // Visual state still keys off phase STATUS so an active phase reads "In
  // Progress" even before its gate score climbs; the bar/number show magnitude.
  const phaseState: "complete" | "in-progress" | "not-started" =
    status === "complete" || pct >= 100
      ? "complete"
      : status === "active" || status === "ready" || pct > 0
      ? "in-progress"
      : "not-started";

  const barColor =
    phaseState === "complete"
      ? "var(--v3-green)"
      : phaseState === "in-progress"
      ? "var(--v3-accent)"
      : "var(--v3-border)";

  const chipCls =
    phaseState === "complete"
      ? "v3-chip green"
      : phaseState === "in-progress"
      ? "v3-chip blue"
      : "v3-chip muted";

  const chipLabel =
    phaseState === "complete"
      ? "Complete"
      : phaseState === "in-progress"
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
      <PhaseStatusRings values={rings} size={34} />
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
      <div style={{ width: 104, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
        <span className={chipCls} style={{ fontSize: 11 }}>
          <span className="v3-chip-dot" />
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
  confidenceResult,
  onApproveGate,
  onRunAgent,
  anyAgentRunning,
  narrativeRunning,
  onNavigateToDecide,
  onNavigateToGates,
  onNavigateToPipeline,
  onNavigateToPhase,
  onNavigateToRisks,
}: ExecutiveViewProps) {
  const [approvingPhase, setApprovingPhase] = useState<string | null>(null);

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
      executiveSummary?: string;
      agenda?: Array<{ item: string; type?: string; owner?: string; durationMins?: number; context?: string; details?: string[]; decisionRequired?: string | null }>;
      criticalBlockers?: Array<{ blocker: string; impact?: string; owner?: string; neededBy?: string }>;
      contradictions?: Array<{ description: string; sources?: string[] }>;
      preReadItems?: string[];
      parkingLot?: string[];
      generatedAt?: string;
    };
  }, [innerData]);

  const todayLabelCopy = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const phases = program?.phases ?? [];
  // Phase Progress lists only phases that are "in play" — approved (locked-in)
  // or the active frontier. Future phases sit behind an unapproved gate
  // (getLockedPhaseIds) and must not appear with a soft estimator % (e.g.
  // Operate reading "32% in-progress" before its phase has even started).
  const visiblePhases = useMemo(() => {
    if (!program) return [] as typeof phases;
    const locked = getLockedPhaseIds(program);
    return phases.filter((phase) => !locked.has(phase.id));
  }, [program, phases]);
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
  // Programme completion is measured by approved artifacts, not the phase-estimator
  // pct. Each phase contributes its share of required artifacts that PMs have
  // actually reviewed and approved (computePhaseReadiness.artifactsComplete — the
  // same "Artifacts approved" metric shown on the phase screen); we average those
  // across phases so the executive headline reflects real, signed-off output.
  const avgPctCopy = useMemo(() => {
    if (!program || phases.length === 0) return 0;
    const perPhaseApproved = program.phases.map(
      (p) => computePhaseReadiness(program, p.id).artifactsComplete,
    );
    return Math.round(
      perPhaseApproved.reduce((s, v) => s + v, 0) / perPhaseApproved.length,
    );
  }, [program, phases.length]);

  // handleCopyBrief is defined after useMemo hooks below — see bottom of component

  const todayLabel = todayLabelCopy;

  // ── Critical risks (severity high/critical, capped at 3) ─────────────────
  const criticalRisks = useMemo<RAIDEntry[]>(() => selectHighRisks(program).slice(0, 3), [program]);

  // ── Decision escalations (open + critical/high) — the high-priority slice of
  //    the SAME open-decisions set the Action Center shows, so counts agree. ───
  const escalatedDecisions = useMemo(
    () => selectEscalatedDecisions(program, "programme", "executive"),
    [program],
  );

  // Total open decisions for this persona — the SAME canonical set the escalation
  // list below slices from, so the KPI can never read lower than the list it caps.
  const openDecisionCount = useMemo(
    () => selectDecisions(program, "programme", "executive").length,
    [program],
  );

  const shownDecisions = escalatedDecisions.slice(0, 3);
  const extraDecisions = escalatedDecisions.length - shownDecisions.length;

  // ── Open RAID counts for the header block ─────────────────────────────────
  // Programme-wide open blockers and risks (canonical programRaid selectors, so
  // these agree with every other surface that counts them).
  const blockerCount = useMemo(() => selectBlockers(program).length, [program]);
  const riskCount = useMemo(() => selectRisks(program).length, [program]);

  // Current phase = first not-yet-complete phase (prefer an active/ready one),
  // falling back to the last phase once everything is closed. Drives the
  // Gates Approved drill-down to the live phase screen.
  const currentPhaseId = useMemo(() => {
    const list = program?.phases ?? [];
    const active = list.find((p) => p.status === "active" || p.status === "ready");
    if (active) return active.id;
    const incomplete = list.find((p) => p.status !== "complete");
    return incomplete?.id ?? list[list.length - 1]?.id ?? "strategy";
  }, [program]);

  // ── Gate counts (use pre-declared above) ─────────────────────────────────
  const approvedGates = approvedGatesCopy;
  const avgPct = avgPctCopy;

  const health = healthLabel(confidenceScore);

  // ── Copy brief to clipboard ───────────────────────────────────────────────
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
          Select a programme from the top bar to view the executive summary, confidence score, critical risks, and actions awaiting your input.
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

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 14 }}>
          {/* Executive actions live in the header so the primary controls are
              reachable without scrolling to the foot of the brief. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* Dummy for now — will initiate the change-request flow for editing locked stages. */}
            <button
              type="button"
              className="v3-button secondary v3-button-inline-sm"
              onClick={() => { /* TODO: wire change-request flow for locked stages */ }}
            >
              Change Request
            </button>
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
      </div>

      {/* ── Executive summary — generated on demand, never auto-run ─────────── */}
      <div style={{
        padding: "12px 16px",
        background: "var(--v3-surface-2)",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius)",
        fontSize: 12,
        color: "var(--v3-text-secondary)",
        lineHeight: 1.6,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            ✦ Executive summary
          </span>
          <button
            type="button"
            className="v3-button ghost v3-button-inline-xs"
            onClick={() => onRunAgent("narrative", "program")}
            disabled={narrativeRunning}
          >
            {narrativeRunning ? "Generating…" : program.narrative ? "Refresh" : "Generate summary"}
          </button>
        </div>
        {narrativeRunning ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--v3-accent)" }}>
            <span style={{ animation: "v3-spin 1.2s linear infinite", display: "inline-block" }}>◎</span>
            <span>ATOS is generating the summary…</span>
          </div>
        ) : program.narrative ? (
          <div style={{ whiteSpace: "pre-wrap" }}>
            {typeof program.narrative === "string" ? program.narrative : ""}
          </div>
        ) : (
          <div style={{ color: "var(--v3-text-muted)" }}>
            No summary yet — click Generate summary to have ATOS analyse this programme.
          </div>
        )}
      </div>

      {/* ── 2. Confidence & Health row ─────────────────────────────────────── */}
      <div>
        <SectionLabel>Programme Metrics</SectionLabel>
        <div className="v3-exec-metrics">
          {confidenceScore !== null && (
            <Kpi
              label="Confidence"
              value={`${confidenceScore}%`}
              color={confidenceColor(confidenceScore)}
              emphasis
              onClick={onNavigateToGates}
            />
          )}
          <Kpi
            label="Gates Approved"
            value={`${approvedGates} of ${totalGates}`}
            onClick={() => onNavigateToPhase(currentPhaseId)}
          />
          <Kpi
            label="Blockers"
            value={blockerCount}
            color={blockerCount > 0 ? "var(--v3-red)" : undefined}
            onClick={onNavigateToDecide}
          />
          <Kpi
            label="Risks"
            value={riskCount}
            color={riskCount > 0 ? "var(--v3-amber)" : undefined}
            onClick={onNavigateToDecide}
          />
        </div>
      </div>

      {/* ── 2b. Confidence breakdown — per-signal scores behind the headline % ── */}
      {confidenceResult && confidenceResult.signals && confidenceResult.signals.length > 0 && (
        <div>
          <SectionLabel>
            Confidence Breakdown
            {confidenceResult.explanation ? ` — ${confidenceResult.explanation}` : ""}
          </SectionLabel>
          <div
            style={{
              background: "var(--v3-surface)",
              border: "1px solid var(--v3-border-soft)",
              borderRadius: "var(--v3-radius)",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {confidenceResult.signals.map((sig) => {
              const barColor = sig.status === "good" ? "var(--v3-green)" : sig.status === "warn" ? "var(--v3-amber)" : "var(--v3-red, #ef4444)";
              return (
                <div key={sig.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 160, fontSize: 12, color: "var(--v3-text-secondary)", flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sig.label}>
                    {sig.label}
                  </div>
                  <div style={{ flex: 1, height: 6, background: "var(--v3-border-soft)", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, sig.score))}%`, background: barColor, borderRadius: 3, transition: "width 0.4s" }} />
                  </div>
                  <div style={{ width: 38, fontSize: 12, fontWeight: 600, color: barColor, textAlign: "right", flexShrink: 0 }}>
                    {Math.round(sig.score)}
                  </div>
                  <div style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 10,
                    background: sig.status === "good" ? "rgba(34,197,94,0.12)" : sig.status === "warn" ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
                    color: barColor,
                    fontWeight: 600,
                    flexShrink: 0,
                    letterSpacing: 0.2,
                    textTransform: "uppercase",
                  }}>
                    {sig.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {/* ── 4. Actions awaiting executive input ───────────────────────────── */}
      <div>
        <SectionLabel>Actions Awaiting Executive Input</SectionLabel>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <SectionLabel>Phase Progress</SectionLabel>
          {/* Ring legend — canonical KPI mapping */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            {[
              { color: "var(--v3-accent-b)", label: "Gate Score" },
              { color: "#A78BFA", label: "Artifact Quality" },
              { color: "#2DD4BF", label: "Input Quality" },
            ].map(({ color, label }) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--v3-text-muted)" }}>
                <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
                  <circle cx={5} cy={5} r={4} fill="none" stroke={color} strokeWidth={2.4} />
                </svg>
                {label}
              </span>
            ))}
          </div>
        </div>
        <div
          style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            padding: "4px 16px 8px",
          }}
        >
          {visiblePhases.map((phase) => (
            <PhaseProgressRow
              key={phase.id}
              program={program}
              phaseId={phase.id}
              label={PHASE_LABELS[phase.id] ?? phase.displayName}
              status={phase.status}
              onClick={() => onNavigateToPhase(phase.id)}
            />
          ))}
          {visiblePhases.length === 0 && (
            <div style={{ padding: "16px 0", fontSize: 13, color: "var(--v3-text-muted)" }}>
              No phase data available.
            </div>
          )}
        </div>
      </div>

      {/* ── 6. Daily Briefing output ──────────────────────────────────────── */}
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

      {/* ── 8. Leadership Review (SteerCo pack) — generated on demand from the card ─ */}
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
              gap: 12,
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--v3-text-primary)" }}>{steercoAgenda?.title || "Steering Committee Meeting"}</div>
                <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 3 }}>
                  {steercoAgenda?.date && <span>{steercoAgenda.date}</span>}
                  {steercoAgenda?.duration && <span> · {steercoAgenda.duration}</span>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {steercoAgenda?.generatedAt && (
                  <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                    {new Date(steercoAgenda.generatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <button
                  type="button"
                  className="v3-button ghost v3-button-inline-xs"
                  disabled={anyAgentRunning}
                  onClick={() => onRunAgent("steerco-prep", "program")}
                >
                  {anyAgentRunning ? "Building…" : steercoAgenda ? "Refresh" : "Generate"}
                </button>
              </div>
            </div>
            {steercoAgenda ? (
              <>
            {steercoAgenda.attendees && steercoAgenda.attendees.length > 0 && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--v3-border-soft)", fontSize: 12, color: "var(--v3-text-secondary)" }}>
                <span style={{ fontWeight: 600, color: "var(--v3-text-muted)", marginRight: 8 }}>ATTENDEES</span>
                {steercoAgenda.attendees.join(" · ")}
              </div>
            )}

            {/* Executive summary — leading paragraph */}
            {steercoAgenda.executiveSummary && (
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--v3-border-soft)" }}>
                <SteercoHeading>Executive Summary</SteercoHeading>
                <p style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.6, margin: "8px 0 0" }}>
                  {steercoAgenda.executiveSummary}
                </p>
              </div>
            )}

            {/* Critical blockers — bulleted specifics */}
            {steercoAgenda.criticalBlockers && steercoAgenda.criticalBlockers.length > 0 && (
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--v3-border-soft)" }}>
                <SteercoHeading tone="red">Critical Blockers</SteercoHeading>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                  {steercoAgenda.criticalBlockers.map((b, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "var(--v3-red, #ef4444)", fontSize: 13, lineHeight: 1.5 }}>•</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 600, lineHeight: 1.5 }}>{b.blocker}</div>
                        {b.impact && <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5, marginTop: 2 }}>Impact: {b.impact}</div>}
                        {(b.owner || b.neededBy) && (
                          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 3 }}>
                            {b.owner && <span>{b.owner}</span>}
                            {b.owner && b.neededBy && <span> · </span>}
                            {b.neededBy && <span>needed by {b.neededBy}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contradictions — bulleted specifics */}
            {steercoAgenda.contradictions && steercoAgenda.contradictions.length > 0 && (
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--v3-border-soft)" }}>
                <SteercoHeading tone="amber">Contradictions & Inconsistencies</SteercoHeading>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                  {steercoAgenda.contradictions.map((c, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ color: "var(--v3-amber)", fontSize: 13, lineHeight: 1.5 }}>•</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "var(--v3-text-primary)", lineHeight: 1.5 }}>{c.description}</div>
                        {c.sources && c.sources.length > 0 && (
                          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 3 }}>Conflicting: {c.sources.join(" ↔ ")}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agenda — each item with a subheader, framing paragraph and bulleted details */}
            {steercoAgenda.agenda && steercoAgenda.agenda.length > 0 && (
              <div style={{ padding: "14px 16px 4px" }}>
                <SteercoHeading>Agenda</SteercoHeading>
                <div style={{ marginTop: 8 }}>
                  {steercoAgenda.agenda.map((item, i) => (
                    <div key={i} style={{
                      padding: "11px 0",
                      borderBottom: i < (steercoAgenda.agenda?.length ?? 0) - 1 ? "1px solid var(--v3-border-soft)" : undefined,
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                    }}>
                      <span style={{ fontSize: 12, color: "var(--v3-text-muted)", minWidth: 24, textAlign: "right", paddingTop: 1 }}>{i + 1}.</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 600 }}>{item.item}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                          {item.type && <span style={{ fontSize: 11, color: "var(--v3-text-muted)", textTransform: "capitalize" }}>{item.type}</span>}
                          {item.owner && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>· {item.owner}</span>}
                          {item.durationMins && <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>· {item.durationMins}min</span>}
                        </div>
                        {item.context && <p style={{ fontSize: 12, color: "var(--v3-text-secondary)", margin: "4px 0 0", lineHeight: 1.5 }}>{item.context}</p>}
                        {item.details && item.details.length > 0 && (
                          <ul style={{ margin: "6px 0 0", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                            {item.details.map((d, di) => (
                              <li key={di} style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{d}</li>
                            ))}
                          </ul>
                        )}
                        {item.decisionRequired && (
                          <div style={{ fontSize: 12, color: "var(--v3-text-primary)", marginTop: 6, padding: "6px 10px", background: "var(--v3-surface-2)", borderRadius: "var(--v3-radius)", borderLeft: "2px solid var(--v3-accent)" }}>
                            <span style={{ fontWeight: 600 }}>Decision required: </span>{item.decisionRequired}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {steercoAgenda.preReadItems && steercoAgenda.preReadItems.length > 0 && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--v3-border-soft)", background: "var(--v3-surface-2)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Pre-Read</div>
                {steercoAgenda.preReadItems.map((p, i) => <div key={i} style={{ fontSize: 12, color: "var(--v3-text-secondary)", padding: "2px 0" }}>• {p}</div>)}
              </div>
            )}
            {steercoAgenda.parkingLot && steercoAgenda.parkingLot.length > 0 && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid var(--v3-border-soft)", background: "var(--v3-surface-2)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Parking Lot</div>
                {steercoAgenda.parkingLot.map((p, i) => <div key={i} style={{ fontSize: 12, color: "var(--v3-text-secondary)", padding: "2px 0" }}>• {p}</div>)}
              </div>
            )}
              </>
            ) : (
              <div style={{ padding: "16px", fontSize: 12, color: "var(--v3-text-muted)", lineHeight: 1.6 }}>
                No leadership review yet — generate a SteerCo pack to build the agenda, critical blockers, and decisions for your next steering committee.
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
