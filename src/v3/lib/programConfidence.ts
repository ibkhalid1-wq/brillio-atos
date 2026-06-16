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
  const approved = Object.values(program.gateReviews || {}).filter(
    (g: Record<string, unknown>) => g?.status === "approved",
  ).length;
  const totalGates = phases.length;

  // Gate readiness: active phase readiness score (or ratio of approved gates).
  // Computed once and reused below so the Today confidence breakdown reads the
  // exact same readiness object the phase header KPIs render from.
  const phaseReadiness = phaseId ? computePhaseReadiness(program, phaseId) : null;
  const activePhaseReadiness = phaseReadiness
    ? phaseReadiness.score
    : approved > 0
    ? Math.round((approved / Math.max(totalGates, 1)) * 100)
    : 0;

  // Risk posture: severity-weighted open risk penalty
  const riskEntries = Array.isArray(rawData?.raidEntries)
    ? (rawData.raidEntries as Array<{ type: string; severity?: string; status?: string }>)
    : [];
  const openRisks = riskEntries.filter((r) => r.type === "risk");
  const riskPosture = computeRiskPosture(openRisks);
  const openCriticalRisks = openRisks.filter(
    (r) => (r.severity || "").toLowerCase() === "critical" && r.status !== "closed",
  ).length;
  const openHighRisks = openRisks.filter(
    (r) => (r.severity || "").toLowerCase() === "high" && r.status !== "closed",
  ).length;

  // Milestone health: on-track ratio
  const milestones = program.milestones || [];
  const onTrack = milestones.filter(
    (m: Record<string, unknown>) => m.status === "on-track" || m.status === "complete",
  ).length;
  const milestoneHealth = milestones.length > 0 ? Math.round((onTrack / milestones.length) * 100) : 70;
  const milestonesAtRisk = milestones.filter(
    (m: Record<string, unknown>) => m.status === "at-risk" || m.status === "overdue",
  ).length;

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
  const inputQuality = phaseId ? derivePhaseInputQuality(phaseId, activeInputs) : null;
  const inputCompleteness = inputQuality
    ? inputQuality.overallScore
    : phaseReadiness?.inputScore ?? 0;

  // Decision metrics
  const openDecisions = (program.decisionQueue || []).filter(isDecisionOpen);
  const overdueDecisions = openDecisions.filter((d: Record<string, unknown>) => {
    const created = d.createdAt as string | undefined;
    return created && Date.now() - new Date(created).getTime() > 14 * 86_400_000;
  }).length;

  return computeConfidenceScore({
    gateReadiness: activePhaseReadiness,
    riskPosture,
    milestoneHealth,
    openDecisionCount: openDecisions.length,
    inputCompleteness,
    openCriticalRisks,
    openHighRisks,
    approvedGates: approved,
    totalGates,
    overdueDecisions,
    milestonesAtRisk,
  });
}
