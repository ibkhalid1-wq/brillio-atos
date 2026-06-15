import React, { useMemo } from "react";
import type { GateReview, ProgramSummary, RAIDEntry } from "@/new/types";
import type { PhaseReadinessResult } from "@/v3/lib/phaseReadiness";
import { explainPhaseReadiness } from "@/v3/lib/readinessModel";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { ReadinessArcGauge } from "@/v3/components/ReadinessArcGauge";
import { isDecisionOpen } from "@/v3/utils";
import type { V3MoreView } from "@/v3/types";

// ─── Phase Progression Card ──────────────────────────────────────────────────
//
// The single decision-making widget for the phase workspace. It answers three
// questions a Program Manager has the moment they open a phase:
//
//   1. Can I progress?   → readiness vs. the gate threshold + a verdict line
//   2. Why not?          → the highest-leverage blockers (missing artifacts,
//                          unmet exit criteria, open decisions/risks)
//   3. What next?        → ranked recommended actions + estimated effort
//
// It is pure composition over the existing engines — computePhaseReadiness
// (score / canApproveGate / recommendedActions / missing), explainPhaseReadiness
// (blockers ranked by expectedGain) and deriveProgramConfidence (confidence
// band). Nothing here re-derives a score; this consolidates the previously
// scattered "Gate readiness" card + "Top actions" panel into one surface.
// ─────────────────────────────────────────────────────────────────────────────

interface PhaseProgressionCardProps {
  program: ProgramSummary;
  phaseId: string;
  /** Pre-computed readiness from the parent (avoids recomputation). */
  readiness: PhaseReadinessResult;
  gateStatus: GateReview["status"] | null;
  onRunAgent: (agentId: string) => void;
  onOpenMoreView?: (view: V3MoreView) => void;
  onOpenDecide: () => void;
}

const EFFORT_HOURS: Record<string, number> = { quick: 1, hours: 4, days: 12 };

/** Roll the ranked actions' effort buckets into a single human-readable estimate. */
function estimateEffortRemaining(
  actions: PhaseReadinessResult["recommendedActions"],
): string | null {
  if (!actions.length) return null;
  const totalHours = actions.reduce((sum, a) => sum + (EFFORT_HOURS[a.effort] ?? 4), 0);
  if (totalHours <= 6) return `~${totalHours}h remaining`;
  const days = Math.round(totalHours / 8);
  return days <= 1 ? "~1 day remaining" : `~${days} days remaining`;
}

interface ProgressionVerdict {
  label: string;
  tone: "green" | "amber" | "red";
  detail: string;
}

function deriveVerdict(
  readiness: PhaseReadinessResult,
  gateStatus: GateReview["status"] | null,
): ProgressionVerdict {
  if (gateStatus === "approved") {
    return { label: "Gate approved", tone: "green", detail: "This phase has passed its gate. You can advance." };
  }
  if (gateStatus === "remediation-requested") {
    return {
      label: "Remediation requested",
      tone: "red",
      detail: "A reviewer asked for changes before this gate can be approved.",
    };
  }
  if (readiness.canApproveGate) {
    return {
      label: "Ready to progress",
      tone: "green",
      detail: `Readiness ${readiness.score}% meets the ${readiness.threshold}% gate threshold.`,
    };
  }
  const gap = Math.max(0, readiness.threshold - readiness.score);
  return {
    label: "Not ready to progress",
    tone: "amber",
    detail: `${gap}% short of the ${readiness.threshold}% gate threshold — close the blockers below.`,
  };
}

const TONE_COLOR: Record<string, string> = {
  green: "var(--v3-green)",
  amber: "var(--v3-amber)",
  red: "var(--v3-red)",
};

export function PhaseProgressionCard({
  program,
  phaseId,
  readiness,
  gateStatus,
  onRunAgent,
  onOpenMoreView,
  onOpenDecide,
}: PhaseProgressionCardProps) {
  const explanation = useMemo(() => explainPhaseReadiness(program, phaseId), [program, phaseId]);
  const confidence = useMemo(() => deriveProgramConfidence(program, phaseId), [program, phaseId]);

  // Open RAID/decisions scoped to this phase — the "why not" supporting signals.
  const raidEntries: RAIDEntry[] = program.raidEntries || [];
  const openRisks = raidEntries.filter(
    (e) => e.phase === phaseId && e.type === "risk" && e.status !== "closed",
  );
  const openDependencies = raidEntries.filter(
    (e) => e.phase === phaseId && e.type === "dependency" && e.status !== "closed",
  );
  const openDecisions = (program.decisionQueue || [])
    .filter(isDecisionOpen)
    .filter((d) => !d.phaseId || d.phaseId === phaseId);

  const verdict = deriveVerdict(readiness, gateStatus);
  const blockers = explanation?.blockers ?? [];
  const topActions = readiness.recommendedActions.slice(0, 3);
  const effort = estimateEffortRemaining(readiness.recommendedActions);
  const missing = readiness.missing.slice(0, 4);

  const canApprove = readiness.canApproveGate && gateStatus !== "approved";

  return (
    <div className="v3-card v3-progression-card" style={{ marginTop: 12 }}>
      {/* ── Headline: readiness gauge + verdict + confidence ── */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <ReadinessArcGauge
          score={readiness.score}
          size={104}
          strokeWidth={9}
          showLabel={false}
          showLegend={false}
          threshold={readiness.threshold}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              className="v3-chip"
              style={{ background: `${TONE_COLOR[verdict.tone]}22`, color: TONE_COLOR[verdict.tone], fontWeight: 600 }}
            >
              {verdict.label}
            </span>
            <span
              className="v3-chip muted"
              title={confidence.explanation}
              style={{ fontSize: 11 }}
            >
              Confidence {confidence.score}% · {confidence.label}
            </span>
            {effort ? (
              <span className="v3-chip muted" style={{ fontSize: 11 }}>{effort}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 8, lineHeight: 1.45 }}>
            {verdict.detail}
          </div>
          {/* Open RAID/decision counts — the supporting governance signals */}
          <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="v3-progression-stat"
              onClick={onOpenDecide}
              title="Open the decision queue"
            >
              <span className="v3-progression-stat-num">{openDecisions.length}</span>
              <span className="v3-progression-stat-label">Open decision{openDecisions.length === 1 ? "" : "s"}</span>
            </button>
            <button
              type="button"
              className="v3-progression-stat"
              onClick={() => onOpenMoreView?.("risks")}
              title="Open the RAID log"
            >
              <span className="v3-progression-stat-num" style={{ color: openRisks.length ? "var(--v3-amber)" : undefined }}>
                {openRisks.length}
              </span>
              <span className="v3-progression-stat-label">Open risk{openRisks.length === 1 ? "" : "s"}</span>
            </button>
            <button
              type="button"
              className="v3-progression-stat"
              onClick={() => onOpenMoreView?.("risks")}
              title="Open the RAID log"
            >
              <span className="v3-progression-stat-num">{openDependencies.length}</span>
              <span className="v3-progression-stat-label">Dependenc{openDependencies.length === 1 ? "y" : "ies"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Why not: missing requirements + blockers ── */}
      {!canApprove && (blockers.length > 0 || missing.length > 0) ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--v3-border-soft)", paddingTop: 12 }}>
          <div className="v3-inline-list-label">What's holding the gate back</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {(blockers.length > 0
              ? blockers.slice(0, 4).map((b) => ({ key: b.id, label: b.label, detail: b.detail, gain: b.expectedGain }))
              : missing.map((m, i) => ({ key: `missing-${i}`, label: m, detail: null as string | null, gain: 0 }))
            ).map((item) => (
              <div key={item.key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "var(--v3-amber)", fontSize: 12, lineHeight: 1.5 }}>•</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "var(--v3-text-primary)" }}>{item.label}</span>
                  {item.detail ? (
                    <span style={{ fontSize: 11, color: "var(--v3-text-muted)", marginLeft: 6 }}>{item.detail}</span>
                  ) : null}
                </div>
                {item.gain > 0 ? (
                  <span className="v3-chip green" style={{ fontSize: 10 }}>+{item.gain} pts</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── What next: ranked recommended actions ── */}
      {!canApprove && topActions.length > 0 ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--v3-border-soft)", paddingTop: 12 }}>
          <div className="v3-inline-list-label">Recommended next actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {topActions.map((action, idx) => (
              <div key={action.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div className="v3-readiness-action-rank">{idx + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--v3-text-primary)", fontWeight: 500 }}>{action.label}</div>
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)", lineHeight: 1.4, marginTop: 2 }}>
                    {action.description}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <span
                      className={`v3-chip ${action.priority === "critical" ? "red" : action.priority === "high" ? "amber" : "muted"}`}
                      style={{ fontSize: 10 }}
                    >
                      {action.priority}
                    </span>
                    <span className="v3-chip muted" style={{ fontSize: 10 }}>{action.effort}</span>
                    {action.estimatedImpact > 0 ? (
                      <span className="v3-chip green" style={{ fontSize: 10 }}>+{action.estimatedImpact} pts</span>
                    ) : null}
                  </div>
                </div>
                {action.agentId ? (
                  <button
                    type="button"
                    className="v3-button ghost v3-button-inline-xs"
                    onClick={() => onRunAgent(action.agentId!)}
                  >
                    Analyse →
                  </button>
                ) : action.workspaceId ? (
                  <button
                    type="button"
                    className="v3-button ghost v3-button-inline-xs"
                    onClick={() => onOpenMoreView?.(action.workspaceId as V3MoreView)}
                  >
                    Open →
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Ready-to-progress confirmation ── */}
      {canApprove ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--v3-border-soft)", paddingTop: 12, fontSize: 12, color: "var(--v3-green)", fontWeight: 600 }}>
          ✓ All gate conditions met — approve below to unlock the next phase.
        </div>
      ) : explanation?.summary ? (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--v3-border-soft)", paddingTop: 12, fontSize: 11, color: "var(--v3-text-muted)", lineHeight: 1.45 }}>
          {explanation.summary}
        </div>
      ) : null}
    </div>
  );
}

export default PhaseProgressionCard;
