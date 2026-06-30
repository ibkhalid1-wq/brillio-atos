/**
 * Shared program-confidence derivation — SINGLE SOURCE OF TRUTH.
 *
 * Every surface that shows a program's health (the rail badge in AppShellV3,
 * the Portfolio program cards, the Programme/Workspaces health KPI) must derive
 * it from this one function so the same program never reads "On Track" on one
 * screen and "At Risk" on another. The logic is lifted verbatim from the
 * authoritative inline calculation that previously lived only in AppShellV3, so
 * the headline score for the active program is unchanged — it is simply now
 * reusable for *every* program, not just the one in focus.
 *
 * This replaces the prior practice of reading `healthHeatmap.overallRag`
 * (opaque, agent-supplied, defaults to "amber") for card/KPI health. That
 * signal is not traceable or explainable and could contradict the computed
 * confidence; per the charter (Explainability > Trust) the computed score wins.
 */
import type { ProgramSummary } from "@/new/types";
import { computeConfidenceScore, computeRiskPosture, type ConfidenceScore } from "@/v3/lib/confidenceScore";
import { computePhaseReadiness } from "@/v3/lib/phaseReadiness";
import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";
import { computeScheduleAdherence } from "@/v3/lib/phaseSchedule";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { selectRisks } from "@/v3/lib/programRaid";
import { isDecisionOpen } from "@/v3/utils";

/**
 * Derive the unified confidence score for any program. Mirrors the multi-signal
 * model (gate readiness, risk posture, milestone health, decision backlog,
 * input completeness) exactly as AppShellV3 computed it for the active program.
 *
 * @param program       The program to score.
 * @param activePhaseId Phase to evaluate readiness against. Defaults to the
 *                      program's own `activePhaseId`, so cards score the same
 *                      phase the program shell would.
 */
export function deriveProgramConfidence(
  program: ProgramSummary,
  activePhaseId?: string | null,
): ConfidenceScore {
  const phaseId = activePhaseId ?? program.activePhaseId ?? null;
  const rawData = (program.rawData || {}) as Record<string, unknown>;

  const phases = program.phases || [];
  const approved = (Object.values(program.gateReviews || {}) as unknown as Array<Record<string, unknown>>).filter(
    (g) => g?.status === "approved",
  ).length;
  const totalGates = phases.length;

  // Gate readiness blends locked-in progress with current-phase readiness. The
  // current phase's readiness alone resets to ~0 at every phase transition, so a
  // programme that has cleared four of nine gates and just opened the fifth read a
  // 0 here — scoring a healthy, mid-journey programme as if it were at the start
  // line. Floor the signal at the approved-gate ratio (4/9 ≈ 44%, the same figure
  // the "Progress" KPI shows) so completed gates can't be thrown away, while the
  // current phase's own readiness still drives the score up as it nears the gate.
  const phaseReadiness = phaseId ? computePhaseReadiness(program, phaseId) : null;
  const currentPhaseReadiness = phaseReadiness ? phaseReadiness.score : 0;
  const approvedGateRatio = totalGates > 0 ? Math.round((approved / totalGates) * 100) : 0;
  const activePhaseReadiness = Math.max(currentPhaseReadiness, approvedGateRatio);

  // Risk posture: severity-weighted open risk penalty. Read the canonical open
  // risk set (selectRisks) — the SAME set the Executive/Programme risk KPI and
  // the Action Center show — not the raw top-level `raidEntries`. RAID is not
  // persisted there; it lives in data.raidLog.entries and is surfaced via the
  // normalised program.raidEntries. Reading the raw field found zero risks, so
  // risk posture read a misleading 100% on programmes that had open risks.
  const openRisks = selectRisks(program);
  const riskPosture = computeRiskPosture(openRisks);
  const openCriticalRisks = openRisks.filter((r) => r.severity === "critical").length;
  const openHighRisks = openRisks.filter((r) => r.severity === "high").length;

  // Milestone health measures whether IN-FLIGHT milestones are slipping — not the
  // raw on-track ratio, which punished a programme for milestones that simply
  // haven't been reached yet and, worse, for stale milestones left "delayed" on a
  // phase whose gate is already approved (the phase is done; the milestone is
  // historical). Treat a milestone as historical when it is complete or belongs to
  // an already-approved phase, and score only the remainder by how many are
  // actually at risk. All-historical → fully healthy; no milestones at all →
  // neutral default, unchanged.
  const gateApproved = (id: unknown): boolean =>
    typeof id === "string" &&
    (program.gateReviews?.[id] as { status?: string } | undefined)?.status === "approved";
  const milestones = (program.milestones || []) as unknown as Array<Record<string, unknown>>;
  const inFlightMilestones = milestones.filter(
    (m) => m.status !== "complete" && !gateApproved(m.phaseId),
  );
  const milestonesAtRisk = inFlightMilestones.filter(
    (m) => m.status === "at-risk" || m.status === "delayed",
  ).length;
  const milestoneHealth =
    milestones.length === 0
      ? 70
      : inFlightMilestones.length === 0
      ? 100
      : Math.round(((inFlightMilestones.length - milestonesAtRisk) / inFlightMilestones.length) * 100);

  // Input completeness: read from the SAME schema-grounded assessment the phase
  // header "Input quality" KPI renders (derivePhaseInputQuality.overallScore),
  // falling back to readiness.inputScore exactly as the header does. This keeps
  // the Today confidence breakdown in sync with the phase page header — they no
  // longer compute input quality two different ways.
  const phaseInputs =
    typeof rawData?.phaseInputs === "object"
      ? (rawData.phaseInputs as Record<string, Record<string, unknown>>)
      : {};
  const activeInputs = phaseId ? phaseInputs[phaseId] ?? {} : {};
  const inputQuality = phaseId
    ? derivePhaseInputQuality(phaseId, activeInputs, getDynamicSchemaStore(rawData), rawData)
    : null;
  const inputCompleteness = inputQuality
    ? inputQuality.overallScore
    : phaseReadiness?.inputScore ?? 0;

  // Schedule adherence: are in-flight phases keeping pace with their planned
  // windows? Computed from the SAME roadmap rows the Strategic Roadmap workspace
  // renders (buildRoadmapRows), so the confidence signal and the Gantt agree on
  // who is behind. Null (no parseable schedule) falls back to a neutral 70 —
  // mirroring milestone health — so programmes without roadmap dates aren't
  // penalised for a signal they can't yet produce.
  const scheduleAdherenceRaw = computeScheduleAdherence(rawData, phases);
  const scheduleAdherence = scheduleAdherenceRaw ?? 70;

  // Decision metrics
  const openDecisions = (program.decisionQueue || []).filter(isDecisionOpen);
  const overdueDecisions = openDecisions.filter((d) => {
    const created = d.createdAt as string | undefined;
    return created && Date.now() - new Date(created).getTime() > 14 * 86_400_000;
  }).length;

  return computeConfidenceScore({
    gateReadiness: activePhaseReadiness,
    currentPhaseReadiness,
    riskPosture,
    milestoneHealth,
    scheduleAdherence,
    openDecisionCount: openDecisions.length,
    inputCompleteness,
    openCriticalRisks,
    openHighRisks,
    openRiskCount: openRisks.length,
    approvedGates: approved,
    totalGates,
    overdueDecisions,
    milestonesAtRisk,
  });
}
