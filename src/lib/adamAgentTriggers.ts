export type TriggerEvent =
  | "artifact_approved"
  | "gate_passed"
  | "decision_resolved"
  | "readiness_threshold_met"
  | "program_created";

export interface AgentTriggerRule {
  event: TriggerEvent;
  sourcePhaseId?: string;
  targetAgentId: string;
  targetPhaseId: string;
  condition?: (programState: unknown) => boolean;
  delayMs?: number;
}

type TriggerContext = {
  phaseId?: string;
  programId: string;
  artifactId?: string;
  programState?: unknown;
};

const CONTEXT_PHASE_AGENT = "context-phase-agent";
const CONTEXT_PHASE_TARGET = "context-phase";

export const DEFAULT_TRIGGER_RULES: AgentTriggerRule[] = [
  {
    event: "artifact_approved",
    sourcePhaseId: "discover",
    targetAgentId: "design",
    targetPhaseId: "design",
  },
  {
    event: "gate_passed",
    sourcePhaseId: "design",
    targetAgentId: "build",
    targetPhaseId: "build",
  },
  {
    event: "decision_resolved",
    targetAgentId: CONTEXT_PHASE_AGENT,
    targetPhaseId: CONTEXT_PHASE_TARGET,
  },
  {
    event: "readiness_threshold_met",
    targetAgentId: CONTEXT_PHASE_AGENT,
    targetPhaseId: CONTEXT_PHASE_TARGET,
  },
  {
    event: "program_created",
    targetAgentId: "strategy",
    targetPhaseId: "strategy",
    delayMs: 2000,
  },
];

function resolveDynamicRule(rule: AgentTriggerRule, context: TriggerContext): AgentTriggerRule {
  return {
    ...rule,
    targetAgentId: rule.targetAgentId === CONTEXT_PHASE_AGENT
      ? (context.phaseId || rule.targetAgentId)
      : rule.targetAgentId,
    targetPhaseId: rule.targetPhaseId === CONTEXT_PHASE_TARGET
      ? (context.phaseId || rule.targetPhaseId)
      : rule.targetPhaseId,
  };
}

export function evaluateTriggers(
  event: TriggerEvent,
  context: TriggerContext,
  rules: AgentTriggerRule[],
  onTrigger: (rule: AgentTriggerRule) => void,
): void {
  const matchingRules = rules
    .filter((rule) => rule.event === event)
    .filter((rule) => !rule.sourcePhaseId || rule.sourcePhaseId === context.phaseId)
    .map((rule) => resolveDynamicRule(rule, context))
    .filter((rule) => !rule.condition || rule.condition(context.programState));

  matchingRules.forEach((rule) => {
    if (rule.delayMs && rule.delayMs > 0) {
      globalThis.setTimeout(() => onTrigger(rule), rule.delayMs);
      return;
    }
    onTrigger(rule);
  });
}
