/**
 * Phase Executive Summary — the "15-second condensed" read of a phase.
 *
 * The phase workspace is dense by design: inputs, artifacts, blockers, the
 * progression gate. But a busy PM (or a sponsor glancing over their shoulder)
 * often needs only the headline: *can this phase progress, and if not, what is
 * the single most important thing standing in the way?* This composes the three
 * authoritative signals already computed elsewhere — readiness, confidence and
 * the consolidated blocker model — into one glanceable verdict. It introduces no
 * new scoring of its own; it is a pure projection so the executive view can never
 * disagree with the detailed view it summarises.
 */
import type { ProgramSummary } from "@/new/types";
import { computePhaseReadiness } from "@/v3/lib/phaseReadiness";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { derivePhaseBlockers, type PhaseBlocker } from "@/v3/lib/phaseBlockers";

export type PhaseVerdict = "ready" | "progressing" | "blocked";

export interface PhaseExecutiveSummary {
  /** Overall one-word stance, drives colour + headline. */
  verdict: PhaseVerdict;
  /** One-line plain-English headline a sponsor can read in a glance. */
  headline: string;
  /** Composite readiness score (0–100). */
  readinessScore: number;
  /** Gate threshold this phase must clear to progress. */
  threshold: number;
  /** Whether the gate can be approved right now. */
  canProgress: boolean;
  /** Composite confidence score (0–100). */
  confidenceScore: number;
  /** Total active blockers on this phase. */
  blockerCount: number;
  /** How many of those are critical. */
  criticalCount: number;
  /** The single highest-priority blocker, if any. */
  topBlocker: PhaseBlocker | null;
  /** The single highest-impact next action, if any. */
  nextAction: { label: string; agentId?: string; workspaceId?: string } | null;
  /** Count of critical logical contradictions ATOS has detected programme-wide. */
  contradictionCount: number;
  /** One-line description of the most pressing contradiction, if any. */
  topContradiction: string | null;
}

/**
 * Derive the condensed executive read of `phaseId`. Returns null when there is
 * no program or phase so the caller can simply hide the panel.
 */
export function derivePhaseExecutiveSummary(
  program: ProgramSummary | null,
  phaseId: string | null,
): PhaseExecutiveSummary | null {
  if (!program || !phaseId) return null;

  const readiness = computePhaseReadiness(program, phaseId);
  const confidence = deriveProgramConfidence(program, phaseId);
  const blockers = derivePhaseBlockers(program, phaseId);

  const topBlocker = blockers[0] ?? null;
  const criticalCount = blockers.filter((b) => b.severity === "critical").length;

  // Prefer the readiness model's ranked actions (they carry the largest impact);
  // fall back to the top blocker's own remediation, then the confidence top action.
  const topReadinessAction = readiness.recommendedActions[0];
  const nextAction = topReadinessAction
    ? {
        label: topReadinessAction.label,
        agentId: topReadinessAction.agentId,
        workspaceId: topReadinessAction.workspaceId,
      }
    : topBlocker?.action
      ? { label: topBlocker.action.label, agentId: topBlocker.action.agentId, workspaceId: topBlocker.action.workspaceId }
      : null;

  // Critical contradictions are surfaced from the programme's raw agent output
  // (same source the detailed surfaces read) so the header carries the signal.
  const rawData = program.rawData;
  const source = typeof rawData === "object" && rawData !== null
    ? ("data" in rawData && typeof (rawData as Record<string, unknown>).data === "object" && (rawData as Record<string, unknown>).data !== null
        ? (rawData as Record<string, unknown>).data as Record<string, unknown>
        : rawData as Record<string, unknown>)
    : null;
  const criticalContradictions = Array.isArray(source?.contradictions)
    ? (source!.contradictions as Array<{ severity?: string; description?: string }>).filter((item) => item?.severity === "critical")
    : [];
  const contradictionCount = criticalContradictions.length;
  const topContradiction = criticalContradictions[0]?.description?.slice(0, 140) ?? null;

  let verdict: PhaseVerdict;
  if (readiness.canApproveGate) verdict = "ready";
  else if (criticalCount > 0) verdict = "blocked";
  else verdict = "progressing";

  let headline: string;
  if (verdict === "ready") {
    headline = `Ready to progress — readiness ${readiness.score}% clears the ${readiness.threshold}% gate.`;
  } else if (verdict === "blocked") {
    headline = topBlocker
      ? `Blocked — ${topBlocker.label}.`
      : `Blocked — ${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} to resolve.`;
  } else {
    const gap = Math.max(0, readiness.threshold - readiness.score);
    headline = topBlocker
      ? `On track — ${gap} pts to the gate; next: ${topBlocker.label}.`
      : `On track — ${gap} pts of readiness to the gate.`;
  }

  return {
    verdict,
    headline,
    readinessScore: readiness.score,
    threshold: readiness.threshold,
    canProgress: readiness.canApproveGate,
    confidenceScore: confidence.score,
    blockerCount: blockers.length,
    criticalCount,
    topBlocker,
    nextAction,
    contradictionCount,
    topContradiction,
  };
}
