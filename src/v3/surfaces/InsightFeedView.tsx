import React, { useMemo, useEffect } from "react";
import type { ProgramSummary } from "@/new/types";
import { PHASE_LABELS, confidenceChipClass } from "@/v3/lib/uiHelpers";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { derivePhaseStatusRings } from "@/v3/lib/phaseStatusRings";
import AdamExplainsTooltip from "@/v3/components/AdamExplainsTooltip";
import type { ConfidenceScore, ConfidenceForecast } from "@/v3/lib/confidenceScore";
import { forecastConfidence, getGateThreshold } from "@/v3/lib/confidenceScore";
import type { V3MoreView } from "@/v3/types";
import { ExecCommandPanel } from "@/v3/components/ExecCommandPanel";
import { Kpi } from "@/v3/components/ui/Kpi";

interface InsightFeedViewProps {
  program: ProgramSummary | null;
  programs: ProgramSummary[];
  activePhaseId: string | null;
  confidenceScore: number | null;
  /** Full confidence result — provides signal breakdown and top recommendation (Priority 7). */
  confidenceResult?: ConfidenceScore;
  openDecisionCount: number;
  anyAgentRunning: boolean;
  agentsAvailable: boolean;
  onNavigateToDecide: () => void;
  onNavigateToGates: () => void;
  onNavigateToPipeline: () => void;
  onNavigateToPhase: (phaseId: string) => void;
  onOpenPhase: (phaseId: string) => void;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onNavigateToPortfolio: () => void;
  onOpenMoreView?: (view: V3MoreView) => void;
}

function getGreeting(): string {
  return "Today's update";
}

/** Returns a human-readable relative time string, e.g. "2 hours ago". */
function getRelativeTime(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

// ─── InsightCard ────────────────────────────────────────────────────────────

interface InsightCardProps {
  priority: 1 | 2 | 3;
  accent: string;
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function InsightCard({ priority, accent, icon, title, description, actionLabel, onAction }: InsightCardProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "20px 20px 20px 0",
        borderRadius: "var(--v3-radius)",
        background: "var(--v3-surface)",
        border: "1px solid var(--v3-border-soft)",
        borderLeft: `4px solid ${accent}`,
        paddingLeft: 16,
        position: "relative",
      }}
    >
      {/* Priority number */}
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: accent + "22",
          color: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 13,
          fontFamily: "var(--v3-font)",
        }}
      >
        {priority}
      </div>

      {/* Icon */}
      <div style={{ flexShrink: 0, fontSize: 22, lineHeight: 1, marginTop: 2 }}>{icon}</div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--v3-font)",
            fontWeight: 600,
            fontSize: 15,
            color: "var(--v3-text-primary)",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--v3-font)",
            fontSize: 13,
            color: "var(--v3-text-secondary)",
            lineHeight: 1.6,
            marginBottom: actionLabel ? 14 : 0,
          }}
        >
          {description}
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "var(--v3-font)",
              fontSize: 13,
              fontWeight: 600,
              color: accent,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── MetricPill ─────────────────────────────────────────────────────────────
// Compact inline metric used in the welcome header strip (replaces the full Programme card).


// ─── AgentActionButton ───────────────────────────────────────────────────────

interface AgentActionButtonProps {
  icon: string;
  label: string;
  estimate: string;
  disabled: boolean;
  agentsAvailable: boolean;
  onClick: () => void;
}

function AgentActionButton({ icon, label, estimate, disabled, agentsAvailable, onClick }: AgentActionButtonProps) {
  const offline = !agentsAvailable;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={offline ? "Sign in to use AI agents" : undefined}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "14px 12px",
        background: disabled ? "var(--v3-surface-2)" : "var(--v3-surface)",
        border: `1px solid ${offline ? "var(--v3-border)" : "var(--v3-border-soft)"}`,
        borderRadius: "var(--v3-radius)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : offline ? 0.7 : 1,
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--v3-accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = offline ? "var(--v3-border)" : "var(--v3-border-soft)";
      }}
    >
      <span style={{ fontSize: 20 }}>{offline ? "🔒" : icon}</span>
      <span
        style={{
          fontFamily: "var(--v3-font)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--v3-text-primary)",
          textAlign: "center",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--v3-font)",
          fontSize: 11,
          color: offline ? "var(--v3-amber)" : "var(--v3-text-muted)",
          fontWeight: offline ? 600 : 400,
        }}
      >
        {disabled ? "Working…" : offline ? "Sign in required" : estimate}
      </span>
    </button>
  );
}

function DecisionQueueCard({
  program,
  onNavigateToDecide,
}: {
  program: ProgramSummary;
  onNavigateToDecide: () => void;
}) {
  const openDecisions = (program.decisionQueue || [])
    .filter((decision) => decision.status !== "resolved" && decision.status !== "approved" && decision.status !== "rejected")
    .slice(0, 4);

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        padding: 18,
        borderRadius: "var(--v3-radius)",
        border: "1px solid var(--v3-border-soft)",
        background: "var(--v3-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--v3-text-primary)" }}>Decision Queue</div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
            {openDecisions.length ? `${openDecisions.length} item${openDecisions.length === 1 ? "" : "s"} need review` : "No open decisions blocking progress"}
          </div>
        </div>
        <button type="button" className="v3-button ghost sm" onClick={onNavigateToDecide}>
          View all →
        </button>
      </div>

      {openDecisions.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {openDecisions.map((decision) => {
            const phase = decision.phaseId ? (PHASE_LABELS[decision.phaseId] ?? decision.phaseId) : "Programme";
            const priorityColor = decision.priority === "critical" || decision.priority === "high"
              ? "var(--v3-amber)"
              : "var(--v3-text-muted)";
            return (
              <button
                key={decision.id}
                type="button"
                onClick={onNavigateToDecide}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid var(--v3-border-soft)",
                  background: "var(--v3-surface-2)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 650, color: "var(--v3-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {decision.title || decision.question || "Untitled decision"}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--v3-text-muted)", marginTop: 3 }}>
                    {phase} · {decision.type || "decision"}
                  </span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: priorityColor, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {decision.priority || "medium"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--v3-surface-2)", color: "var(--v3-text-muted)", fontSize: 12 }}>
          Decision queue is clear. New gate, risk, or sponsor decisions will appear here.
        </div>
      )}
    </div>
  );
}

// ─── PhaseStripCard ──────────────────────────────────────────────────────────

function PhaseStripCard({
  program,
  phase,
  active,
  isNext,
  onClick,
}: {
  program: ProgramSummary;
  phase: ProgramSummary["phases"][number];
  active: boolean;
  isNext: boolean;
  onClick: () => void;
}) {
  const rings = derivePhaseStatusRings(program, phase.id);
  const label = PHASE_LABELS[phase.id] ?? phase.displayName ?? phase.id;

  // Rich tooltip — canonical KPI breakdown (inner Input · middle Artifact · outer Gate)
  const tooltipLines = [
    rings.hasGate ? `Gate: ${rings.gate}%` : "Gate: no review yet",
    `Artifact: ${rings.artifact}%`,
    `Input: ${rings.input}%`,
    `Overall: ${rings.overall}%`,
  ].join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltipLines}
      aria-label={`${label} — ${tooltipLines}`}
      style={{
        flex: "0 0 auto",        // C1: don't shrink; strip scrolls instead
        width: 96,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "14px 8px 12px",
        borderRadius: "var(--v3-radius)",
        background: active
          ? "color-mix(in srgb, var(--v3-accent) 8%, transparent)"
          : isNext
          ? "color-mix(in srgb, var(--v3-accent) 4%, var(--v3-surface))"
          : "var(--v3-surface)",
        border: `1px solid ${
          active ? "var(--v3-accent)" : isNext ? "color-mix(in srgb, var(--v3-accent) 35%, var(--v3-border-soft))" : "var(--v3-border-soft)"
        }`,
        cursor: "pointer",
        position: "relative",
        overflow: "visible",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--v3-accent)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor =
          isNext ? "color-mix(in srgb, var(--v3-accent) 35%, var(--v3-border-soft))" : "var(--v3-border-soft)";
      }}
    >
      {/* Active glow stripe */}
      {active && (
        <span style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          borderRadius: "var(--v3-radius) var(--v3-radius) 0 0",
          background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
        }} />
      )}

      {/* C2: "Up next" badge on the first upcoming phase */}
      {isNext && !active && (
        <span style={{
          position: "absolute", top: -8, right: -4,
          fontSize: 9, fontWeight: 700,
          color: "var(--v3-accent)",
          background: "color-mix(in srgb, var(--v3-accent) 15%, var(--v3-surface))",
          border: "1px solid color-mix(in srgb, var(--v3-accent) 40%, transparent)",
          borderRadius: 8,
          padding: "1px 5px",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          lineHeight: 1.6,
          fontFamily: "var(--v3-font)",
          whiteSpace: "nowrap",
        }}>
          Next →
        </span>
      )}

      {/* Canonical 3-ring phase status — inner Input · middle Artifact · outer Gate.
          Overall score sits inside the rings for consistency with other screens. */}
      <PhaseStatusRings values={rings} size={56} showCenter />

      {/* Phase name */}
      <span style={{
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        color: active ? "var(--v3-text-primary)" : "var(--v3-text-secondary)",
        textAlign: "center",
        lineHeight: 1.3,
        marginTop: 2,
      }}>
        {label}
      </span>
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function InsightFeedView({
  program,
  programs,
  activePhaseId,
  confidenceScore,
  confidenceResult,
  openDecisionCount,
  anyAgentRunning,
  agentsAvailable,
  onNavigateToDecide,
  onNavigateToGates,
  onNavigateToPipeline,
  onNavigateToPhase,
  onOpenPhase,
  onRunAgent,
  onNavigateToPortfolio,
  onOpenMoreView,
}: InsightFeedViewProps) {
  const todayLabel = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── Derive insight cards ─────────────────────────────────────────────────
  const insights = useMemo(() => {
    type Card = InsightCardProps;
    const cards: Card[] = [];

    // Decisions are owned solely by the Decision Queue card below — no duplicate
    // insight card here.

    // "Active phase" must resolve to the same phase the rest of the app treats as
    // active (the phase strip highlight and Quick Nav both key off activePhaseId).
    // Prefer activePhaseId; only fall back to the in-progress heuristic when no
    // phase is explicitly active, so Home never contradicts itself.
    const activePhase =
      (activePhaseId ? program?.phases.find((p) => p.id === activePhaseId) : null) ??
      program?.phases.find((p) => p.pct >= 10 && p.pct <= 90) ??
      null;

    if (activePhase) {
      const label = PHASE_LABELS[activePhase.id] ?? activePhase.displayName;
      cards.push({
        priority: 2 as 1 | 2 | 3,
        accent: "var(--v3-accent)",
        icon: "→",
        title: `Active Phase: ${label}`,
        description: `Your programme is currently in ${label}. Keep momentum by reviewing phase readiness and updating progress.`,
        actionLabel: `Go to ${label} →`,
        onAction: () => onNavigateToPhase(activePhase.id),
      });
    }

    if (program?.gateReviews) {
      const atRiskGate = Object.entries(program.gateReviews).find(
        ([, gate]) =>
          typeof gate === "object" &&
          gate !== null &&
          (gate as { readinessScore?: number; status?: string }).readinessScore !== undefined &&
          ((gate as { readinessScore: number }).readinessScore < 70) &&
          (gate as { status: string }).status !== "approved",
      );

      if (atRiskGate) {
        const [gatePhaseId, gate] = atRiskGate as [string, { readinessScore: number; status: string }];
        const score = gate.readinessScore;
        const gateAccent = score < 50 ? "var(--v3-red)" : "var(--v3-amber)";
        const phaseLabel = PHASE_LABELS[gatePhaseId] ?? gatePhaseId;
        cards.push({
          priority: 3 as 1 | 2 | 3,
          accent: gateAccent,
          icon: "⬡",
          title: "Gate Readiness Alert",
          description: `The ${phaseLabel} gate shows ${score}% readiness — below the 70% threshold. Check gate readiness to identify what's blocking progress.`,
          actionLabel: "View Gates →",
          onAction: onNavigateToGates,
        });
      }
    }

    if (cards.length === 0) {
      cards.push({
        priority: 1,
        accent: "var(--v3-green)",
        icon: "✓",
        title: "No critical issues detected",
        description: "Programme is on track. Use the actions below to stay ahead.",
        actionLabel: "View programme status →",
        onAction: onNavigateToGates,
      });
    }

    return cards.slice(0, 3).map((c, i) => ({ ...c, priority: (i + 1) as 1 | 2 | 3 }));
  }, [program, activePhaseId, openDecisionCount, onNavigateToDecide, onNavigateToGates, onNavigateToPhase, onRunAgent]);

  // Route the confidence "Top Action" to the surface that actually owns the
  // weakest signal, rather than always sending the user to Risks.
  const topActionHandler = useMemo<(() => void) | null>(() => {
    const category = confidenceResult?.topRecommendationCategory;
    if (!category) return null;
    switch (category) {
      case "gate":
        return onNavigateToGates;
      case "decision":
        return onNavigateToDecide;
      case "risk":
        return onOpenMoreView ? () => onOpenMoreView("risks") : null;
      case "milestone":
        return onOpenMoreView ? () => onOpenMoreView("milestones") : null;
      case "input":
        return activePhaseId ? () => onOpenPhase(activePhaseId) : onNavigateToPipeline;
      default:
        return null;
    }
  }, [confidenceResult?.topRecommendationCategory, activePhaseId, onNavigateToGates, onNavigateToDecide, onOpenMoreView, onOpenPhase, onNavigateToPipeline]);

  // ── Metrics ──────────────────────────────────────────────────────────────
  const phases = program?.phases ?? [];
  const avgPct =
    phases.length > 0
      ? Math.round(phases.reduce((s, p) => s + p.pct, 0) / phases.length)
      : 0;
  // Fresh programme = no phase progress yet. Used to suppress confidence-heavy
  // sections (they're noise before any signal exists) and to show the welcome guide.
  const totalPct = phases.reduce((sum, p) => sum + (p.pct ?? 0), 0);
  const isFresh = totalPct === 0 && phases.length > 0;
  const phaseIdSetFeed = new Set(program?.phases.map((p) => p.id) ?? []);
  const gatesApproved = program?.gateReviews
    ? Object.entries(program.gateReviews).filter(
        ([phaseId, g]) =>
          phaseIdSetFeed.has(phaseId) &&
          typeof g === "object" &&
          g !== null &&
          (g as { status: string }).status === "approved",
      ).length
    : 0;

  // C2: index of the first "upcoming" phase after the active one
  const nextPhaseId = useMemo(() => {
    if (!activePhaseId || phases.length === 0) return null;
    const activeIdx = phases.findIndex((p) => p.id === activePhaseId);
    if (activeIdx < 0) return null;
    for (let i = activeIdx + 1; i < phases.length; i++) {
      if (phases[i].pct < 5 && phases[i].status !== "complete") {
        return phases[i].id;
      }
    }
    return null;
  }, [phases, activePhaseId]);

  // Auto-trigger daily briefing once per 24 hours
  useEffect(() => {
    if (!program || anyAgentRunning) return;
    const storageKey = `adam-daily-briefing-${program.id ?? "program"}`;
    const lastRun = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (lastRun && now - parseInt(lastRun, 10) < oneDayMs) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, String(now));
    }
    onRunAgent("daily-briefing");
  }, [program?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastUpdated = getRelativeTime((program as (ProgramSummary & { updatedAt?: string }) | null)?.updatedAt);

  // ── Confidence trajectory forecast (Priority — forecastConfidence integration) ──
  // Build a history from stored confidence snapshots or synthesise a 2-point history
  // from previousConfidenceScore (if available in rawData) and current score.
  const confidenceForecast = useMemo((): ConfidenceForecast | null => {
    if (confidenceScore === null || confidenceScore === undefined) return null;
    const rawSource = program
      ? (typeof program.rawData === "object" && program.rawData !== null
        ? ("data" in program.rawData && typeof (program.rawData as Record<string,unknown>).data === "object"
          ? (program.rawData as Record<string,unknown>).data as Record<string,unknown>
          : program.rawData as Record<string,unknown>)
        : null)
      : null;
    // Use stored confidence history if available (array of {ts, score}), else synthesise
    const storedHistory = Array.isArray(rawSource?.confidenceHistory)
      ? (rawSource.confidenceHistory as Array<{ts: number; score: number}>)
      : null;
    const history: Array<{ts: number; score: number}> = storedHistory
      ?? [
        // Synthesise: assume score was ~5 pts lower 7 days ago if we have no history
        { ts: Date.now() - 7 * 86_400_000, score: Math.max(0, confidenceScore - 5) },
        { ts: Date.now(), score: confidenceScore },
      ];
    const target = getGateThreshold(activePhaseId ?? "build");
    return forecastConfidence(history, target);
  }, [confidenceScore, program, activePhaseId]);

  if (!program) {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 64px", fontFamily: "var(--v3-font)" }}>
        <div style={{ textAlign: "center", padding: "60px 24px", color: "var(--v3-text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>◎</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 8 }}>No programme selected</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Select a programme from the portfolio or create a new one to get started.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 860,
        margin: "0 auto",
        padding: "32px 24px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 36,
        fontFamily: "var(--v3-font)",
      }}
    >
      {/* ── 0. Fresh-program entry guidance — shown only when programme is brand new ── */}
      {(() => {
        if (!isFresh) return null;
        const firstPhase = phases[0];
        const ENTRY_STEPS = [
          { n: 1, icon: "⊡", label: "Complete Strategy phase inputs", why: "Tell ATOS your programme objective, sponsor, and budget — this bootstraps all AI analysis.", action: firstPhase ? () => onOpenPhase(firstPhase.id) : undefined, cta: "Open Strategy phase →" },
          { n: 2, icon: "◎", label: "Build your programme brief", why: "Creates the programme narrative — the primary summary referenced by all downstream analysis.", action: () => onRunAgent("narrative", firstPhase?.id ?? "strategy"), cta: "Build brief →" },
          { n: 3, icon: "⬡", label: "Check phase readiness", why: "Assesses what's missing before you can progress to Mobilise. Surfaces blockers early.", action: () => onRunAgent("gate-review", firstPhase?.id ?? "strategy"), cta: "Check readiness →" },
          { n: 4, icon: "→", label: "Work through the phase checklist", why: "Each phase has specific exit criteria. ATOS will guide you step-by-step.", action: undefined, cta: null },
        ];
        return (
          <div style={{
            background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0.02) 100%)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: "var(--v3-radius)",
            padding: "20px 22px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 22 }}>◎</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--v3-text-primary)" }}>Welcome — let's get your programme started</div>
                <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>Follow these 4 steps and ATOS will guide you the rest of the way</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ENTRY_STEPS.map((step) => (
                <div key={step.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: "rgba(99,102,241,0.15)",
                    color: "var(--v3-accent)",
                    fontSize: 11, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, marginTop: 1,
                  }}>{step.n}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>{step.label}</div>
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2, lineHeight: 1.5 }}>Why: {step.why}</div>
                  </div>
                  {step.cta && step.action && (
                    <button
                      type="button"
                      className="v3-button primary sm"
                      onClick={step.action}
                      style={{ flexShrink: 0 }}
                    >{step.cta}</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── 1. Welcome header + inline metrics ──────────────────────────────── */}
      {/* D: metrics moved inline below greeting; no separate Programme card */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--v3-text-primary)",
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                marginBottom: 6,
              }}
            >
              {getGreeting()}
            </div>
            <div
              style={{
                fontSize: 15,
                color: "var(--v3-text-secondary)",
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              {program.name}
            </div>
            {/* E1: last updated */}
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>
              {todayLabel}
              {lastUpdated ? ` — Updated ${lastUpdated}` : " — Active programme"}
            </div>
            {/* Executive verdict — one sentence CEO can read in 3 seconds */}
            {confidenceResult && (() => {
              const score = confidenceScore ?? 0;
              const label = confidenceResult.label;
              const gatesApproved = phases.filter((p) => program.gateReviews?.[p.id]?.status === "approved").length;
              const openDecisions = (program as unknown as { decisionQueue?: Array<{status?: string}> }).decisionQueue?.filter((d) => !d.status || d.status === "open").length ?? 0;
              const topSignal = [...(confidenceResult.signals)].sort((a, b) => {
                const order = { poor: 0, warn: 1, good: 2 };
                return order[a.status] - order[b.status];
              })[0];

              let verdict = "";
              if (score >= 80) {
                verdict = `${label} — ${gatesApproved} of ${phases.length} gates approved. Programme is on track for successful delivery.`;
              } else if (score >= 60) {
                verdict = `${label} — ${gatesApproved} of ${phases.length} gates approved. ${topSignal?.status !== "good" ? `Focus area: ${topSignal?.label.toLowerCase()}.` : ""}`;
              } else if (score >= 40) {
                verdict = `At Risk (${score}%) — ${topSignal?.explanation ?? "Key signals need attention before gate progression."} ${openDecisions > 0 ? `${openDecisions} open decision${openDecisions > 1 ? "s" : ""} contributing to risk.` : ""}`;
              } else {
                verdict = `Critical (${score}%) — Immediate attention required. ${topSignal?.topAction ?? "Run gate readiness coach to identify blockers."}`;
              }

              const verdictColor = score >= 80 ? "var(--v3-green)" : score >= 60 ? "var(--v3-text-secondary)" : score >= 40 ? "var(--v3-amber)" : "var(--v3-red, #ef4444)";
              return (
                <div style={{ fontSize: 13, color: verdictColor, marginTop: 8, lineHeight: 1.5, fontWeight: score < 60 ? 500 : 400, maxWidth: 460 }}>
                  {verdict}
                </div>
              );
            })()}
          </div>

          {confidenceScore !== null && (
            <AdamExplainsTooltip metric="confidence" value={confidenceScore} placement="bottom">
              <div
                className={confidenceChipClass(confidenceScore)}
                style={{ fontSize: 13, fontWeight: 600, padding: "6px 14px", cursor: "help" }}
              >
                {confidenceScore}% confidence
              </div>
            </AdamExplainsTooltip>
          )}
        </div>

        {/* Inline metric pills strip */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Kpi variant="pill" label="Completion" value={`${avgPct}%`} onClick={onNavigateToPipeline} />
          <Kpi variant="pill" label="Gates" value={`${gatesApproved}/${phases.length}`} onClick={onNavigateToGates} />
          <AdamExplainsTooltip metric="open-decisions" value={openDecisionCount} placement="top">
            <Kpi
              variant="pill"
              label="Open Decisions"
              value={openDecisionCount}
              color={openDecisionCount > 0 ? "var(--v3-amber)" : undefined}
              onClick={onNavigateToDecide}
            />
          </AdamExplainsTooltip>
        </div>
      </div>

      {/* ── 1a. Today's Focus — lead with the one thing that needs attention ──── */}
      <div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 4 }}>
            Today's Focus
          </div>
          {/* A2: dynamic subtitle */}
          <div style={{ fontSize: 13, color: "var(--v3-text-muted)" }}>
            {insights.length} thing{insights.length !== 1 ? "s" : ""} that need{insights.length === 1 ? "s" : ""} your attention
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {insights.map((card) => (
            <InsightCard key={card.priority} {...card} />
          ))}
        </div>
      </div>

      {/* ── 1b. Phase Pipeline — horizontal scroll (C1) ──────────────────────── */}
      {phases.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Programme Phases
            </div>
            {/* Ring legend — canonical KPI mapping (outer→inner) */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

          {/* C1: horizontal scroll container with fade-out at right edge */}
          <div style={{ position: "relative" }}>
            <div
              className="adam-phase-scroll"
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                paddingBottom: 8,
                paddingTop: 12,
                scrollbarWidth: "none",
              }}
            >
              {phases.map((phase) => (
                <PhaseStripCard
                  key={phase.id}
                  program={program}
                  phase={phase}
                  active={phase.id === activePhaseId}
                  isNext={phase.id === nextPhaseId}
                  onClick={() => onOpenPhase(phase.id)}
                />
              ))}
            </div>
            {/* Fade-out gradient at right to hint at scrollability */}
            {phases.length > 5 && (
              <div style={{
                position: "absolute", right: 0, top: 0, bottom: 8, width: 48, pointerEvents: "none",
                background: "linear-gradient(to right, transparent, var(--v3-bg, var(--v3-surface-2)))",
              }} />
            )}
          </div>
        </div>
      )}

      {/* ── 1c. Confidence Signal Breakdown — hidden until the programme has signal ── */}
      {!isFresh && confidenceResult && confidenceResult.signals && confidenceResult.signals.length > 0 && (
        <div
          style={{
            background: "var(--v3-surface)",
            border: "1px solid var(--v3-border-soft)",
            borderRadius: "var(--v3-radius)",
            padding: "16px 18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Confidence Breakdown
            </span>
            {confidenceResult.explanation && (
              <span style={{ fontSize: 12, color: "var(--v3-text-muted)", fontStyle: "italic" }}>
                — {confidenceResult.explanation}
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {confidenceResult.signals.map((sig) => {
              const barColor = sig.status === "good" ? "var(--v3-green)" : sig.status === "warn" ? "var(--v3-amber)" : "var(--v3-red, #ef4444)";
              return (
                <div key={sig.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Label */}
                  <div style={{ width: 140, fontSize: 12, color: "var(--v3-text-secondary)", flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sig.label}>
                    {sig.label}
                  </div>
                  {/* Bar */}
                  <div style={{ flex: 1, height: 6, background: "var(--v3-border-soft)", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, sig.score))}%`, background: barColor, borderRadius: 3, transition: "width 0.4s" }} />
                  </div>
                  {/* Score */}
                  <div style={{ width: 38, fontSize: 12, fontWeight: 600, color: barColor, textAlign: "right", flexShrink: 0 }}>
                    {Math.round(sig.score)}
                  </div>
                  {/* Status chip */}
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

          {confidenceResult.topRecommendation && (
            <div style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "rgba(99,102,241,0.07)",
              borderRadius: 8,
              borderLeft: "3px solid var(--v3-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-accent)", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 }}>
                  Top Action
                </div>
                <div style={{ fontSize: 13, color: "var(--v3-text-primary)" }}>
                  {confidenceResult.topRecommendation}
                </div>
              </div>
              {topActionHandler && (
                <button
                  type="button"
                  className="v3-button primary sm"
                  onClick={topActionHandler}
                  style={{ flexShrink: 0 }}
                >
                  Open →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 1c. Confidence Trajectory — compact one-line trend (full chart retired) ── */}
      {!isFresh && confidenceForecast && confidenceScore !== null && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 16px",
          background: "var(--v3-surface)",
          border: "1px solid var(--v3-border-soft)",
          borderRadius: "var(--v3-radius)",
          fontSize: 12.5,
        }}>
          <span style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 10,
            fontWeight: 600,
            background: confidenceForecast.trend === "improving" ? "rgba(34,197,94,0.12)" : confidenceForecast.trend === "declining" ? "rgba(239,68,68,0.12)" : "rgba(148,163,184,0.12)",
            color: confidenceForecast.trend === "improving" ? "var(--v3-green)" : confidenceForecast.trend === "declining" ? "var(--v3-red, #ef4444)" : "var(--v3-text-muted)",
          }}>
            {confidenceForecast.trend === "improving" ? "↑ Improving" : confidenceForecast.trend === "declining" ? "↓ Declining" : "→ Stable"}
          </span>
          <strong style={{ color: confidenceForecast.weeklyVelocity > 0 ? "var(--v3-green)" : confidenceForecast.weeklyVelocity < 0 ? "var(--v3-red, #ef4444)" : "var(--v3-text-primary)" }}>
            {confidenceForecast.weeklyVelocity > 0 ? "+" : ""}{confidenceForecast.weeklyVelocity.toFixed(1)} pts/wk
          </strong>
          <span style={{ color: "var(--v3-text-muted)" }}>·</span>
          <span style={{ color: "var(--v3-text-secondary)" }}>
            {confidenceScore >= confidenceForecast.targetScore
              ? <span style={{ color: "var(--v3-green)", fontWeight: 600 }}>✓ At {confidenceForecast.targetScore}% gate target</span>
              : confidenceForecast.estimatedDaysToTarget !== null
              ? <>~<strong style={{ color: "var(--v3-text-primary)" }}>{confidenceForecast.estimatedDaysToTarget} days</strong> to {confidenceForecast.targetScore}% gate target</>
              : <>Not improving toward {confidenceForecast.targetScore}% gate target</>}
          </span>
        </div>
      )}

      {/* ── 4. Executive Command Panel — consequence-driven next actions ─────── */}
      <ExecCommandPanel
        program={program}
        confidenceResult={confidenceResult}
        confidenceScore={confidenceScore}
        decisionQueue={(program as unknown as { decisionQueue?: import("@/new/types").DecisionSummary[] }).decisionQueue ?? []}
        onRunAgent={(agentId) => onRunAgent(agentId, activePhaseId ?? "program")}
        onOpenMoreView={onOpenMoreView}
        anyAgentRunning={anyAgentRunning}
      />

      {/* ── 5. Decision Queue (D: moved below agent actions) ─────────────────── */}
      {program ? (
        <DecisionQueueCard program={program} onNavigateToDecide={onNavigateToDecide} />
      ) : null}

      {/* ── 6. Top Risks — inline summary (eliminates navigation trip to Risks workspace) ── */}
      {program && program.risks && program.risks.filter((r) => r.severity === "high" || r.severity === "critical").length > 0 && (() => {
        const topRisks = program.risks
          .filter((r) => r.severity === "high" || r.severity === "critical")
          .slice(0, 3);
        return (
          <div
            style={{
              padding: 18,
              borderRadius: "var(--v3-radius)",
              border: "1px solid rgba(239,68,68,0.25)",
              background: "rgba(239,68,68,0.04)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--v3-text-primary)" }}>
                  △ Top Risks
                </div>
                <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
                  {topRisks.length} high or critical risk{topRisks.length !== 1 ? "s" : ""} requiring attention
                </div>
              </div>
              {onOpenMoreView && (
                <button
                  type="button"
                  className="v3-button ghost sm"
                  onClick={() => onOpenMoreView("risks")}
                >
                  See all →
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {topRisks.map((risk) => {
                const severityColor = risk.severity === "critical" ? "var(--v3-red)" : "var(--v3-amber)";
                return (
                  <div
                    key={risk.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: "var(--v3-surface)",
                      border: "1px solid var(--v3-border-soft)",
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: severityColor, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
                      {risk.severity}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--v3-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {risk.label}
                    </span>
                    {risk.owner && (
                      <span style={{ fontSize: 11, color: "var(--v3-text-muted)", flexShrink: 0 }}>{risk.owner}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── 8. Portfolio quick-link ───────────────────────────────────────────── */}
      {programs.length > 1 && (
        <div
          style={{
            borderTop: "1px solid var(--v3-border-soft)",
            paddingTop: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            onClick={onNavigateToPortfolio}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--v3-font)",
              fontSize: 13,
              color: "var(--v3-accent)",
              fontWeight: 500,
              padding: 0,
            }}
          >
            Viewing 1 of {programs.length} programmes — View Portfolio →
          </button>
        </div>
      )}
    </div>
  );
}
