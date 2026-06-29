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
import type { DecisionSummary, Escalation, ProgramSummary, RAIDEntry } from "@/new/types";
import { deriveOpenRecommendedActions, deriveReclassifiedRiskActions } from "@/v3/lib/recommendedActions";
import { getLockedPhaseIds } from "@/v3/lib/phaseReadiness";

/** Programme-wide, or scoped to a single phase by id. */
export type RaidScope = "programme" | { phaseId: string };

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function inScope(phase: string | undefined, scope: RaidScope): boolean {
  return scope === "programme" || phase === scope.phaseId;
}

// A locked (future) phase sits behind an unapproved gate, so its items are not
// yet workable. On programme-wide lists they only add noise, so we hide them —
// matching the same filter the recommended-actions queue applies. But when the
// caller scopes INTO a specific phase they navigated there deliberately, so we
// show everything for that phase even if it is still locked.
function isActionablePhase(
  phase: string | undefined,
  scope: RaidScope,
  locked: Set<string>,
): boolean {
  if (scope !== "programme") return true;
  return !phase || phase === "all" || !locked.has(phase);
}

function selectOpenRaid(
  program: ProgramSummary | null | undefined,
  type: RAIDEntry["type"],
  scope: RaidScope,
): RAIDEntry[] {
  const locked = scope === "programme" && program ? getLockedPhaseIds(program) : new Set<string>();
  return (program?.raidEntries || [])
    .filter(
      (entry) =>
        entry.type === type &&
        entry.status !== "closed" &&
        inScope(entry.phase, scope) &&
        isActionablePhase(entry.phase, scope, locked),
    )
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2));
}

function priorityToSeverity(priority: string): RAIDEntry["severity"] {
  if (priority === "critical") return "critical";
  if (priority === "high") return "high";
  if (priority === "medium") return "medium";
  return "low";
}

// A reclassified decision (milestone slip / incomplete artifacts) presented as a
// synthetic open risk so it flows through the same Risks list every surface reads.
function decisionToRiskEntry(decision: DecisionSummary): RAIDEntry {
  const summary = (decision as { summary?: string }).summary;
  return {
    id: decision.id,
    type: "risk",
    title: decision.title,
    description: summary || decision.question || "",
    severity: priorityToSeverity(decision.priority),
    phase: decision.phaseId,
    owner: null,
    mitigation: null,
    status: "open",
    source: "agent",
    createdAt: decision.createdAt,
    closedAt: null,
    closedBy: null,
    closureNote: null,
    relatedArtifactId: decision.relatedArtifactId ?? null,
    relatedInputIds: decision.relatedInputIds,
  };
}

/**
 * Open risks (severity-sorted), programme-wide or scoped to a phase. Combines
 * the agent-authored RAID risk entries with the synthetic risks reclassified out
 * of the actions queue (milestone slips, incomplete artifacts) — the latter
 * already carry the programme-wide locked-phase filter from the actions
 * derivation, so only the phase-scope narrowing is reapplied here.
 */
export function selectRisks(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
): RAIDEntry[] {
  const synthetic = deriveReclassifiedRiskActions(program)
    .filter((decision) => inScope(decision.phaseId, scope))
    .map(decisionToRiskEntry);
  return [...selectOpenRaid(program, "risk", scope), ...synthetic].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2),
  );
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
 * Center shows; the Executive summary's "needs a decision now" list is just the
 * high-priority slice (see {@link selectHighPriorityDecisions}), so the two can
 * never disagree.
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

/** High/critical slice of {@link selectDecisions} — the "needs a decision now" set. */
export function selectHighPriorityDecisions(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
  personaId?: string,
): DecisionSummary[] {
  return selectDecisions(program, scope, personaId).filter(
    (decision) => decision.priority === "critical" || decision.priority === "high",
  );
}

/**
 * Open, actionable formal escalations — the canonical set behind the "N
 * escalations" pill, the Escalation panel and the critical-event alerts. An
 * escalation tied to a locked (future) phase is not yet workable, so it is
 * filtered out for the same reason locked-phase risks/blockers/actions are: the
 * surfaces should only ever surface things the team can act on now.
 */
export function selectOpenEscalations(
  program: ProgramSummary | null | undefined,
): Escalation[] {
  if (!program) return [];
  const locked = getLockedPhaseIds(program);
  return (program.escalations || []).filter(
    (entry) =>
      entry.status === "open" &&
      (!entry.linkedPhaseId || !locked.has(entry.linkedPhaseId)),
  );
}
