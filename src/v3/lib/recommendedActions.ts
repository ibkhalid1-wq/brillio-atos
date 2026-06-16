import type { DecisionSummary, ProgramSummary } from "@/new/types";
import { buildDecisionQueue } from "@/lib/adamDecisionUtils";
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
  const synthesized = buildDecisionQueue(phaseAgents, nested, personaId);
  const byId = new Map((program.decisionQueue || []).map((decision) => [decision.id, decision]));
  return synthesized
    .map((decision) => ({ status: "open", ...decision, ...(byId.get(decision.id) || {}) }) as DecisionSummary)
    .filter((decision) => isDecisionOpen(decision));
}
