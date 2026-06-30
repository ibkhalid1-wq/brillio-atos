/**
 * programMetrics — SINGLE SOURCE OF TRUTH for the headline numbers every surface
 * shows (confidence, readiness, gate thresholds, gate/progress counts).
 *
 * Before this module each surface derived these independently: Today read the
 * composite `computePhaseReadiness().score`, the Action Center read the raw
 * persisted `gateReviews[phaseId].readinessScore`, and StageView recomputed
 * confidence per phase. The same phase could therefore show three different
 * "readiness %" values across screens. These selectors centralise the
 * derivation so a given (program, phase) always yields the same numbers.
 *
 * Canonical rule: "readiness %" for a phase = `computePhaseReadiness().score`
 * (a composite of the persisted gate-review score, artifact quality and input
 * quality). The raw gate-review agent score is an *input* to that composite and
 * is exposed separately as `gateReviewScore` for callers that need the agent's
 * own assessment — never as a second, competing "readiness" number.
 */
import type { ProgramSummary } from "@/new/types";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { computePhaseReadiness, type PhaseReadinessResult } from "@/v3/lib/phaseReadiness";
import { getGateThreshold, type ConfidenceScore } from "@/v3/lib/confidenceScore";

export interface PhaseMetrics {
  phaseId: string;
  /** Canonical readiness % — the ONE number every surface shows for this phase. */
  readiness: number;
  /** Persisted gate-review agent score (an input to `readiness`); null until a review runs. */
  gateReviewScore: number | null;
  /** Phase-calibrated gate threshold the readiness score must clear to approve. */
  threshold: number;
  gateApproved: boolean;
  canApproveGate: boolean;
  /** Phase completion %, from the phase model. */
  progressPct: number;
  /** Full readiness breakdown for callers that need detail (missing items, actions). */
  detail: PhaseReadinessResult;
}

export function selectPhaseMetrics(program: ProgramSummary, phaseId: string): PhaseMetrics {
  const detail = computePhaseReadiness(program, phaseId);
  const gate = program.gateReviews?.[phaseId];
  const phase = (program.phases || []).find((p) => p.id === phaseId);
  return {
    phaseId,
    readiness: detail.score,
    gateReviewScore: typeof gate?.readinessScore === "number" ? gate.readinessScore : null,
    threshold: detail.threshold,
    gateApproved: gate?.status === "approved",
    canApproveGate: detail.canApproveGate,
    progressPct: typeof phase?.pct === "number" ? phase.pct : 0,
    detail,
  };
}

export interface ProgramMetrics {
  confidence: ConfidenceScore;
  score: number;
  activePhaseId: string | null;
  activePhase: PhaseMetrics | null;
  /**
   * Active-phase readiness — identical to `activePhase.readiness` and the
   * standalone phase selector (all resolve to `computePhaseReadiness().score`).
   * This is the CURRENT phase's own gate readiness, shown on phase surfaces.
   * It is NOT necessarily equal to `confidence.breakdown.gateReadiness`: the
   * confidence gate signal floors that value at the approved-gate ratio so a
   * freshly-opened phase (readiness ~0) doesn't drag the programme score to zero
   * while four of nine gates are already cleared (see deriveProgramConfidence).
   */
  gateReadiness: number;
  /** Active-phase gate threshold. */
  threshold: number;
  approvedGates: number;
  totalGates: number;
  avgProgressPct: number;
}

/**
 * Derive every programme-level headline metric in one pass, scoped to a phase.
 * Pass `activePhaseIdOverride` to score against a specific phase (e.g. the phase
 * a surface is focused on); omit it to use the program's own active phase.
 */
export function selectProgramMetrics(
  program: ProgramSummary,
  activePhaseIdOverride?: string | null,
): ProgramMetrics {
  const activePhaseId = activePhaseIdOverride ?? program.activePhaseId ?? null;
  const confidence = deriveProgramConfidence(program, activePhaseId);
  const phases = program.phases || [];
  const activePhase = activePhaseId ? selectPhaseMetrics(program, activePhaseId) : null;
  const approvedGates = Object.values(program.gateReviews || {}).filter(
    (g) => (g as { status?: string } | null)?.status === "approved",
  ).length;
  const avgProgressPct = phases.length
    ? Math.round(
        phases.reduce((sum, p) => sum + (typeof p.pct === "number" ? p.pct : 0), 0) / phases.length,
      )
    : 0;

  return {
    confidence,
    score: confidence.score,
    activePhaseId,
    activePhase,
    gateReadiness: activePhase ? activePhase.readiness : confidence.breakdown.gateReadiness,
    threshold: activePhase ? activePhase.threshold : getGateThreshold(activePhaseId ?? ""),
    approvedGates,
    totalGates: phases.length,
    avgProgressPct,
  };
}
