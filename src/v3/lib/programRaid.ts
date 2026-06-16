/**
 * programRaid — SINGLE SOURCE OF TRUTH for the risk / blocker / decision (action)
 * lists every surface shows. Each concept resolves to ONE canonical filter so the
 * same (program, scope) always yields the same set — and therefore the same count —
 * whether it is reached from the Programme screen, the Action Center, the Executive
 * summary or the Today feed.
 *
 * Before this module each surface filtered independently and drifted apart:
 *   • Today (InsightFeedView) read `program.risks`, which MIXES open risks AND
 *     blockers and excludes "monitoring" — so it over-counted vs the risk-only
 *     surfaces and silently dropped monitored risks.
 *   • Programme / Executive read `raidEntries.filter(type==="risk" && status!=="closed")`.
 *   • Action Center counted `deriveOpenRecommendedActions`; Executive counted the
 *     raw `decisionQueue` — two different "open decision" sets for the same concept.
 *
 * Canonical definitions (open = not closed):
 *   risks     = raidEntries, type "risk",    status ≠ closed, in scope, severity-sorted
 *   blockers  = raidEntries, type "blocker",  status ≠ closed, in scope, severity-sorted
 *   decisions = the open recommended-actions queue (synthesised + persisted resolution),
 *               in scope, priority-sorted — ie. "actions" and "decisions" are ONE set.
 */
import type { DecisionSummary, ProgramSummary, RAIDEntry } from "@/new/types";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";

/** Programme-wide, or scoped to a single phase by id. */
export type RaidScope = "programme" | { phaseId: string };

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function inScope(phase: string | undefined, scope: RaidScope): boolean {
  return scope === "programme" || phase === scope.phaseId;
}

function selectOpenRaid(
  program: ProgramSummary | null | undefined,
  type: RAIDEntry["type"],
  scope: RaidScope,
): RAIDEntry[] {
  return (program?.raidEntries || [])
    .filter((entry) => entry.type === type && entry.status !== "closed" && inScope(entry.phase, scope))
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2));
}

/** Open risks (severity-sorted), programme-wide or scoped to a phase. */
export function selectRisks(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
): RAIDEntry[] {
  return selectOpenRaid(program, "risk", scope);
}

/** Open blockers (severity-sorted), programme-wide or scoped to a phase. */
export function selectBlockers(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
): RAIDEntry[] {
  return selectOpenRaid(program, "blocker", scope);
}

/** The high/critical slice of {@link selectRisks} — the "needs attention" set. */
export function selectHighRisks(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
): RAIDEntry[] {
  return selectRisks(program, scope).filter(
    (risk) => risk.severity === "critical" || risk.severity === "high",
  );
}

/**
 * Open decisions = the recommended-actions queue. This is the SAME set the Action
 * Center shows; the Executive summary's "escalations" are just the high-priority
 * slice (see {@link selectEscalatedDecisions}), so the two can never disagree.
 */
export function selectDecisions(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
  personaId?: string,
): DecisionSummary[] {
  const queue = deriveOpenRecommendedActions(program, personaId);
  const scoped =
    scope === "programme" ? queue : queue.filter((decision) => decision.phaseId === scope.phaseId);
  return [...scoped].sort(
    (a, b) => (SEVERITY_ORDER[a.priority] ?? 2) - (SEVERITY_ORDER[b.priority] ?? 2),
  );
}

/** High/critical slice of {@link selectDecisions} — the executive escalation set. */
export function selectEscalatedDecisions(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
  personaId?: string,
): DecisionSummary[] {
  return selectDecisions(program, scope, personaId).filter(
    (decision) => decision.priority === "critical" || decision.priority === "high",
  );
}
