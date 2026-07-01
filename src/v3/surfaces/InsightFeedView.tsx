import React, { useMemo, useEffect } from "react";
import type { ProgramSummary } from "@/new/types";
import { PHASE_LABELS, confidenceChipClass } from "@/v3/lib/uiHelpers";
import AdamExplainsTooltip from "@/v3/components/AdamExplainsTooltip";
import type { ConfidenceScore } from "@/v3/lib/confidenceScore";
import type { V3MoreView } from "@/v3/types";
import { Kpi } from "@/v3/components/ui/Kpi";
import { PhaseStripCard } from "@/v3/components/PhaseStripCard";
import { selectBlockers, selectDecisions, selectRisks } from "@/v3/lib/programRaid";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { ONE_DAY_MS, isSameUtcDay, isWithinMs } from "@/v3/lib/freshness";

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
  onNavigateToExecutive: () => void;
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

// ─── NowItem — a single row in the consolidated "What needs you now" queue ────
// One ranked list merges three previously separate surfaces (heuristic focus
// cards, the briefing's focus items, and the recommended-actions queue) so the
// user sees exactly one prioritised to-do list instead of three overlapping ones.

interface NowItem {
  id: string;
  /** 0 = now/critical, 1 = today/high, 2 = soon — drives sort order and tone. */
  rank: 0 | 1 | 2;
  badge: string;
  text: string;
  detail?: string;
  meta?: string;
}

const RANK_TONE = ["var(--v3-red, #ef4444)", "var(--v3-amber)", "var(--v3-text-muted)"] as const;

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
  onNavigateToExecutive,
  onOpenMoreView,
}: InsightFeedViewProps) {
  const todayLabel = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // The daily-briefing agent ("What should I know today?") writes its structured
  // output to program.rawData.data.dailyBriefing — headline + ≤3 focus items. This
  // is the genuine "focus for today" (distinct from the programme narrative, which
  // is the full brief shown on Executive).
  const dailyBriefing = useMemo(() => {
    const rd = program?.rawData as Record<string, unknown> | undefined;
    if (!rd) return null;
    const data = (typeof rd.data === "object" && rd.data !== null ? rd.data : rd) as Record<string, unknown>;
    const b = data.dailyBriefing;
    if (!b || typeof b !== "object") return null;
    return b as {
      headline?: string;
      focusItems?: Array<{ item: string; urgency?: string; owner?: string; action?: string }>;
      progressHighlight?: string;
      ragStatus?: "green" | "amber" | "red";
      reason?: string;
      generatedAt?: string;
      dateOf?: string;
    };
  }, [program?.rawData]);

  // ── Metrics ──────────────────────────────────────────────────────────────
  const phases = program?.phases ?? [];
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
  // Gate completion = share of phase gates approved — the programme's progress
  // through its governance milestones (distinct from input/artifact completion).
  const gateCompletionPct = phases.length ? Math.round((gatesApproved / phases.length) * 100) : 0;
  // The Today dashboard reports where the PROGRAMME stands, so the canonical frontier
  // the model owns (program.activePhaseId — the first phase whose gate isn't approved)
  // is authoritative here. The route/state activePhaseId prop is a drill-in selection
  // that can go stale (e.g. left pointing at "strategy" after the gate advanced to
  // "build"); it only fills in when the model names no active phase. Never silently
  // fall back to phases[0] (Strategy), which made the pill disagree with the rings.
  const resolvedActiveId =
    (program?.activePhaseId && phaseIdSetFeed.has(program.activePhaseId)
      ? program.activePhaseId
      : null) ??
    (activePhaseId && phaseIdSetFeed.has(activePhaseId) ? activePhaseId : null);
  // Active phase resolved the same way the insight cards do, so the header pill
  // and "Active Phase" insight never disagree.
  const headerActivePhase =
    (resolvedActiveId ? phases.find((p) => p.id === resolvedActiveId) : null) ??
    phases.find((p) => p.pct >= 10 && p.pct <= 90) ??
    phases[0] ??
    null;
  const headerActivePhaseLabel = headerActivePhase
    ? (PHASE_LABELS[headerActivePhase.id] ?? headerActivePhase.displayName)
    : "—";
  const blockerCount = program ? selectBlockers(program).length : 0;
  const riskCount = program ? selectRisks(program).length : 0;
  const goToProgramme = () => (headerActivePhase ? onNavigateToPhase(headerActivePhase.id) : onNavigateToGates());

  // The daily briefing is frozen agent prose with no embedded phase/timestamp, so a
  // briefing generated when the programme sat in an earlier phase keeps asserting that
  // phase forever ("stalled in the Mobilise phase" on a Build-stage programme). Detect
  // that drift deterministically: if the briefing text names a phase the programme has
  // already moved past (one before the live active phase) and never names the current
  // phase, it predates today's reality — flag it so the UI prompts a refresh instead of
  // presenting stale prose as current. Phase names come from the registry, not literals.
  const briefingStale = useMemo(() => {
    if (!dailyBriefing?.headline || !headerActivePhase) return false;
    // A briefing generated today reflects today's reality by construction — the
    // auto-trigger regenerates whenever the active phase advances. So never flag a
    // same-day briefing as "predating the current phase" just because its prose
    // mentions an earlier phase by name (the agent often narrates phase history).
    // Without this guard a fresh briefing whose prose references an earlier phase is
    // suppressed forever: every Refresh regenerates similar prose and re-trips the
    // heuristic, so the card permanently shows the stale warning instead of content.
    if (isSameUtcDay(dailyBriefing.dateOf ?? dailyBriefing.generatedAt)) return false;
    const activeIdx = phases.findIndex((p) => p.id === headerActivePhase.id);
    if (activeIdx <= 0) return false;
    const text = `${dailyBriefing.headline} ${dailyBriefing.progressHighlight ?? ""}`.toLowerCase();
    const labelFor = (id: string) =>
      (PHASE_LABELS[id] ?? phases.find((p) => p.id === id)?.displayName ?? "").toLowerCase();
    const activeLabel = labelFor(headerActivePhase.id);
    if (activeLabel && text.includes(activeLabel)) return false;
    return phases
      .slice(0, activeIdx)
      .some((p) => {
        const l = labelFor(p.id);
        return l.length > 0 && text.includes(l);
      });
  }, [dailyBriefing?.headline, dailyBriefing?.progressHighlight, dailyBriefing?.dateOf, dailyBriefing?.generatedAt, headerActivePhase, phases]);

  // Strict sequential gating: a phase is reachable only once its predecessor's
  // gate is approved. Reuse the canonical lock set (same source the status rings
  // use to mute locked phases) so the strip's clickability and ring muting never
  // disagree. A brand-new programme (no gates approved) exposes only its first phase.
  const lockedPhaseIds = useMemo(
    () => (program ? getLockedPhaseIds(program) : new Set<string>()),
    [program],
  );

  // C2: index of the first "upcoming" phase after the active one
  const nextPhaseId = useMemo(() => {
    if (!resolvedActiveId || phases.length === 0) return null;
    const activeIdx = phases.findIndex((p) => p.id === resolvedActiveId);
    if (activeIdx < 0) return null;
    for (let i = activeIdx + 1; i < phases.length; i++) {
      if (phases[i].pct < 5 && phases[i].status !== "complete") {
        return phases[i].id;
      }
    }
    return null;
  }, [phases, resolvedActiveId]);

  // The auto-trigger throttle is keyed to the timestamp of the briefing that
  // actually LANDED (its server-stamped generatedAt) plus the phase it was
  // generated under — recorded here, only when a new briefing arrives. The
  // trigger effect below must NOT pre-stamp before running: a run that fails
  // (rate limit, AI offline, network) would otherwise poison the 24h window and
  // suppress every retry until tomorrow. Recording only on success means a
  // failed run leaves no marker and is retried on the next mount or phase change.
  // Declared before the trigger effect so the marker is fresh when it reads.
  useEffect(() => {
    if (!program?.id || !dailyBriefing?.generatedAt || typeof window === "undefined") return;
    const stampKey = `adam-daily-briefing-${program.id}`;
    const phaseKey = `${stampKey}-phase`;
    if (window.localStorage.getItem(stampKey) === dailyBriefing.generatedAt) return;
    window.localStorage.setItem(stampKey, dailyBriefing.generatedAt);
    if (resolvedActiveId) window.localStorage.setItem(phaseKey, resolvedActiveId);
  }, [program?.id, dailyBriefing?.generatedAt, resolvedActiveId]);

  // Auto-trigger daily briefing once per 24 hours, OR immediately when the active
  // phase has advanced since the last landed briefing — a briefing that still
  // describes a superseded phase is worse than none, so a phase change invalidates
  // the cache. No pre-run stamp: the record effect above stamps only on success.
  useEffect(() => {
    if (!program || anyAgentRunning || typeof window === "undefined") return;
    const stampKey = `adam-daily-briefing-${program.id ?? "program"}`;
    const phaseKey = `${stampKey}-phase`;
    const lastPhase = window.localStorage.getItem(phaseKey);
    // isWithinMs treats a legacy epoch-millis stamp (pre-ISO) as not-fresh →
    // one migrating run re-stamps it as ISO.
    const fresh = isWithinMs(window.localStorage.getItem(stampKey), ONE_DAY_MS);
    const phaseUnchanged = !resolvedActiveId || lastPhase === resolvedActiveId;
    if (fresh && phaseUnchanged) return;
    onRunAgent("daily-briefing");
  }, [program?.id, resolvedActiveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastUpdated = getRelativeTime((program as (ProgramSummary & { updatedAt?: string }) | null)?.updatedAt);

  // ── Open actions — the same delivery-lead recommended-action queue the header
  //    pill and Action Center count from. ──
  const openActions = useMemo(() => {
    if (!program) return [] as ReturnType<typeof deriveOpenRecommendedActions>;
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...deriveOpenRecommendedActions(program, "delivery_lead")].sort(
      (a, b) => (order[a.priority as string] ?? 2) - (order[b.priority as string] ?? 2),
    );
  }, [program]);

  // ── Consolidated "What needs you now" queue ──────────────────────────────
  // ONE prioritised to-do list, merged from the three sources that used to render
  // as separate, overlapping panels: open blockers (RAID), the daily briefing's
  // focus items (AI-curated), and the recommended-actions queue (decisions). Items
  // are de-duplicated by normalised text so a blocker that also appears as a focus
  // item or action shows once, and ranked: now/critical → today/high → soon.
  const nowQueue = useMemo<NowItem[]>(() => {
    if (!program) return [];
    const items: NowItem[] = [];
    const seen = new Set<string>();
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const push = (key: string, item: NowItem) => {
      const k = norm(key);
      if (!k || seen.has(k)) return;
      seen.add(k);
      items.push(item);
    };
    const phaseLabel = (id?: string | null) =>
      id && id !== "all" ? (PHASE_LABELS[id] ?? id) : undefined;

    for (const b of selectBlockers(program)) {
      push(b.title, {
        id: `blk-${b.id}`,
        rank: 0,
        badge: "Blocker",
        text: b.title,
        detail: b.description || undefined,
        meta: phaseLabel(b.phase),
      });
    }
    for (const [i, f] of (briefingStale ? [] : (dailyBriefing?.focusItems ?? [])).entries()) {
      const u = (f.urgency ?? "").toLowerCase();
      const rank: 0 | 1 | 2 = u === "now" ? 0 : u === "today" ? 1 : 2;
      push(f.item, {
        id: `foc-${i}`,
        rank,
        badge: u ? u.replace("-", " ") : "Focus",
        text: f.item,
        detail: f.action || undefined,
        meta: f.owner ? `Owner: ${f.owner}` : undefined,
      });
    }
    for (const a of openActions) {
      const p = a.priority as string;
      const rank: 0 | 1 | 2 = p === "critical" ? 0 : p === "high" ? 1 : 2;
      push(a.question || a.title, {
        id: `act-${a.id}`,
        rank,
        badge: p,
        text: a.question || a.title,
        meta: phaseLabel(a.phaseId),
      });
    }
    return items.sort((a, b) => a.rank - b.rank);
  }, [program, dailyBriefing, openActions, briefingStale]);

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
              const openDecisions = selectDecisions(program).length;
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
                verdict = `At Risk (${score}%) — ${topSignal?.explanation ?? "Key signals need attention before gate progression."} ${openDecisions > 0 ? `${openDecisions} open action${openDecisions > 1 ? "s" : ""} contributing to risk.` : ""}`;
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

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
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
        </div>

        {/* Inline metric pills strip. Gates / Active phase / Progress drill into
            the Programme screen; Actions / Blockers / Risks open the Action Center. */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Kpi variant="pill" label="Gates" value={`${gatesApproved}/${phases.length}`} onClick={goToProgramme} />
          <Kpi variant="pill" label="Active phase" value={headerActivePhaseLabel} onClick={goToProgramme} />
          <Kpi variant="pill" label="Progress" value={`${gateCompletionPct}%`} onClick={goToProgramme} />
          <AdamExplainsTooltip metric="open-decisions" value={openDecisionCount} placement="top">
            <Kpi
              variant="pill"
              label="Actions"
              value={openDecisionCount}
              color={openDecisionCount > 0 ? "var(--v3-amber)" : undefined}
              onClick={onNavigateToDecide}
            />
          </AdamExplainsTooltip>
          <Kpi
            variant="pill"
            label="Blockers"
            value={blockerCount}
            color={blockerCount > 0 ? "var(--v3-red)" : undefined}
            onClick={onNavigateToDecide}
          />
          <Kpi
            variant="pill"
            label="Risks"
            value={riskCount}
            color={riskCount > 0 ? "var(--v3-amber)" : undefined}
            onClick={onNavigateToDecide}
          />
        </div>
      </div>

      {/* ── 1a. Today's briefing — the daily-briefing agent's headline for today ─
          The narrative hero: a one-line read on where the programme stands. Its
          actionable focus items now flow into the single "What needs you now"
          queue below, so this box stays a hero, not a competing list. Always
          rendered so the "What should I know today?" CTA and its Preparing → result
          state have a home even on a fresh programme. */}
      <div style={{
          padding: "16px 18px",
          background: "var(--v3-surface-2)",
          border: "1px solid var(--v3-border)",
          borderRadius: "var(--v3-radius)",
          fontSize: 13,
          color: "var(--v3-text-secondary)",
          lineHeight: 1.6,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ✦ Today's briefing
            </span>
            <button
              type="button"
              className="v3-button primary v3-button-inline-sm"
              onClick={() => onRunAgent("daily-briefing")}
              disabled={anyAgentRunning}
            >
              <span>◇</span>
              <span>{anyAgentRunning ? "Preparing…" : dailyBriefing?.headline ? "Refresh" : "What should I know today?"}</span>
            </button>
          </div>
          {dailyBriefing?.headline && briefingStale ? (
            <div style={{ color: "var(--v3-text-muted)" }}>
              This briefing predates the current phase ({headerActivePhaseLabel}) and no longer
              reflects where the programme stands — tap “Refresh” for today’s focus.
            </div>
          ) : dailyBriefing?.headline ? (
            <>
              {/* Lead sentence — where the programme stands today */}
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--v3-text-primary)", lineHeight: 1.5 }}>
                {dailyBriefing.headline}
              </div>
              {dailyBriefing.progressHighlight && (
                <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", fontStyle: "italic", marginTop: 8 }}>
                  ◎ {dailyBriefing.progressHighlight}
                </div>
              )}
              {program.narrative && (
                <button
                  type="button"
                  onClick={onNavigateToExecutive}
                  style={{
                    marginTop: 12,
                    padding: 0,
                    background: "none",
                    border: "none",
                    color: "var(--v3-accent)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Read full summary →
                </button>
              )}
            </>
          ) : anyAgentRunning ? (
            <div style={{ color: "var(--v3-text-muted)" }}>
              Preparing today’s briefing…
            </div>
          ) : dailyBriefing && dailyBriefing.reason === "insufficient_data" ? (
            <div style={{ color: "var(--v3-text-muted)" }}>
              Not enough programme activity yet to brief on — add phase progress, risks, or milestones, then regenerate.
            </div>
          ) : (
            <div style={{ color: "var(--v3-text-muted)" }}>
              No briefing yet — tap “What should I know today?” to generate today’s focus.
            </div>
          )}
        </div>

      {/* ── 2. What needs you now — the single consolidated action queue ───────
          Blockers + briefing focus items + recommended actions, de-duplicated and
          ranked. Replaces the three overlapping lists this page used to show. */}
      {nowQueue.length > 0 && (
        <div
          style={{
            padding: 18,
            borderRadius: "var(--v3-radius)",
            border: "1px solid var(--v3-border-soft)",
            background: "var(--v3-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--v3-text-primary)" }}>
                What needs you now
              </div>
              <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
                {nowQueue.length} item{nowQueue.length !== 1 ? "s" : ""} that need{nowQueue.length === 1 ? "s" : ""} your attention, most urgent first
              </div>
            </div>
            <button type="button" className="v3-button ghost sm" onClick={onNavigateToDecide}>
              See all →
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {nowQueue.slice(0, 6).map((item) => (
              <div
                key={item.id}
                onClick={onNavigateToDecide}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "var(--v3-surface-2)",
                  border: "1px solid var(--v3-border-soft)",
                  borderLeft: `3px solid ${RANK_TONE[item.rank]}`,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: RANK_TONE[item.rank], textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, marginTop: 2, minWidth: 52 }}>
                  {item.badge}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", lineHeight: 1.45 }} title={item.text}>
                    {item.text}
                  </div>
                  {item.detail && (
                    <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.45, marginTop: 2 }}>{item.detail}</div>
                  )}
                </div>
                {item.meta && (
                  <span style={{ fontSize: 11, color: "var(--v3-text-muted)", flexShrink: 0, marginTop: 2 }}>{item.meta}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                  active={phase.id === resolvedActiveId}
                  isNext={phase.id === nextPhaseId}
                  locked={lockedPhaseIds.has(phase.id)}
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

      {/* ── 3. Portfolio quick-link ───────────────────────────────────────────── */}
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
            View Portfolio →
          </button>
        </div>
      )}
    </div>
  );
}
