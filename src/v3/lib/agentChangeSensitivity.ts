import type { ProgramVelocity } from "@/v3/lib/programVelocity";

type SensitivityConfig = {
  watchedFields: string[];
  minIntervalMs: number;
  maxIntervalMs: number;
  velocityMultiplier: number;
};

export const AGENT_CHANGE_SENSITIVITY: Record<string, SensitivityConfig> = {
  "health-heatmap": { watchedFields: ["milestones", "raidEntries", "healthScore"], minIntervalMs: 3_600_000, maxIntervalMs: 86_400_000, velocityMultiplier: 0.5 },
  risk: { watchedFields: ["raidEntries", "decisionQueue", "milestones"], minIntervalMs: 3_600_000, maxIntervalMs: 86_400_000, velocityMultiplier: 0.6 },
  "critical-path": { watchedFields: ["milestones", "dependencies"], minIntervalMs: 7_200_000, maxIntervalMs: 172_800_000, velocityMultiplier: 0.4 },
  milestone: { watchedFields: ["milestones"], minIntervalMs: 3_600_000, maxIntervalMs: 86_400_000, velocityMultiplier: 0.5 },
  stakeholder: { watchedFields: ["stakeholders", "decisionQueue"], minIntervalMs: 86_400_000, maxIntervalMs: 604_800_000, velocityMultiplier: 1.5 },
  adoption: { watchedFields: ["healthScore", "stakeholders"], minIntervalMs: 86_400_000, maxIntervalMs: 604_800_000, velocityMultiplier: 1.2 },
  "scope-creep-monitor": { watchedFields: ["scopeLog", "decisionQueue"], minIntervalMs: 7_200_000, maxIntervalMs: 86_400_000, velocityMultiplier: 0.3 },
  "gate-readiness-coach": { watchedFields: ["gateReviews", "phaseInputs", "raidEntries"], minIntervalMs: 3_600_000, maxIntervalMs: 86_400_000, velocityMultiplier: 0.4 },
  "phase-completion-estimator": { watchedFields: ["milestones", "exitCriteria", "phaseArtifacts", "phaseAgentTasks"], minIntervalMs: 3_600_000, maxIntervalMs: 86_400_000, velocityMultiplier: 0.4 },
};

function getPathValue(state: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, state);
}

export function computeAgentInterval(agentId: string, velocity: ProgramVelocity): number {
  const cfg = AGENT_CHANGE_SENSITIVITY[agentId];
  if (!cfg) return 86_400_000;

  const velocityFactor = Math.max(0.1, 1 - (velocity.changesLast24h / 50) * cfg.velocityMultiplier);
  const interval = cfg.maxIntervalMs * velocityFactor;
  return Math.max(cfg.minIntervalMs, Math.min(cfg.maxIntervalMs, interval));
}

export function hasWatchedFieldChanged(
  agentId: string,
  currentState: Record<string, unknown>,
  lastRunSnapshot: Record<string, unknown> | null,
): boolean {
  if (!lastRunSnapshot) return true;
  const cfg = AGENT_CHANGE_SENSITIVITY[agentId];
  if (!cfg) return false;

  return cfg.watchedFields.some((field) => {
    const current = JSON.stringify(getPathValue(currentState, field));
    const previous = JSON.stringify(lastRunSnapshot[field]);
    return current !== previous;
  });
}

export function captureSnapshot(agentId: string, state: Record<string, unknown>): Record<string, unknown> {
  const cfg = AGENT_CHANGE_SENSITIVITY[agentId];
  if (!cfg) return {};
  return Object.fromEntries(cfg.watchedFields.map((field) => [field, getPathValue(state, field)]));
}
