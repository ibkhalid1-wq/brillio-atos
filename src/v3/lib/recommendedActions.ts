import type { DecisionSummary, ProgramSummary } from "@/new/types";
import { buildDecisionQueue } from "@/lib/adamDecisionUtils";
import { getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { isDecisionOpen } from "@/v3/utils";

// Single source of truth for the "Recommended Actions" queue shown in the Action
// Center (DecideView) and counted by the rail badge. The queue is synthesised on
// the fly (escalations, draft reviews, revisions) from agent state, then any
// persisted resolution is merged on BEFORE the open filter so resolved actions
// drop out instead of reappearing every render. Keeping this in one place stops
// the rail badge and the surface from drifting apart.
export function deriveOpenRecommendedActions(
  program: ProgramSummary | null | undefined,
  personaId: string = "delivery_lead",
): DecisionSummary[] {
  if (!program) return [];
  const raw = (program.rawData || {}) as Record<string, unknown>;
  const nested = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
  const phaseAgentStates = typeof nested.phaseAgentStates === "object" && nested.phaseAgentStates !== null
    ? nested.phaseAgentStates as Record<string, unknown>
    : {};
  const phaseAgents = Object.fromEntries(
    (program.phases || []).map((phase) => [phase.id, { agentState: phaseAgentStates[phase.id] ?? null }]),
  );
  const synthesized = buildDecisionQueue(phaseAgents as Parameters<typeof buildDecisionQueue>[0], nested, personaId);
  const persisted = program.decisionQueue || [];
  const byId = new Map(persisted.map((decision) => [decision.id, decision]));
  const synthesizedIds = new Set(synthesized.map((decision) => decision.id));
  const mergedSynthesized = synthesized.map((decision) => {
    const merged = { status: "open", ...decision, ...(byId.get(decision.id) || {}) } as DecisionSummary & { artifactId?: string };
    // Synthesised draft/revision/plan actions carry the artifact they concern
    // as `artifactId`; surface it as the drill-down target so the action links
    // to the exact artifact under review unless an explicit one was persisted.
    if (!merged.relatedArtifactId && merged.artifactId) merged.relatedArtifactId = merged.artifactId;
    return merged as DecisionSummary;
  });
  // Persisted decisions the synthesiser does not regenerate (e.g. an action a PM
  // raises by hand in the Action Center) must still surface — otherwise raising
  // one writes it to the queue but it never appears and the count never moves.
  const persistedOnly = persisted.filter((decision) => !synthesizedIds.has(decision.id));
  // Locked (future) phases sit behind an unapproved gate, so their actions are
  // not yet workable. Filtering them HERE — the single source the rail badge,
  // the Action Center tab, the connections summary and the Executive view all
  // read — stops those surfaces disagreeing about how many actions are open (the
  // tab used to apply this filter alone, so it showed one fewer than the badge).
  // Programme-level / "all" items are never phase-gated.
  const locked = getLockedPhaseIds(program);
  const isActionable = (phaseId: string | null | undefined) =>
    !phaseId || phaseId === "all" || !locked.has(phaseId);
  return [...mergedSynthesized, ...persistedOnly]
    .filter((decision) => isDecisionOpen(decision))
    .filter((decision) => isActionable(decision.phaseId));
}
