/**
 * Model routing / intelligence tiering — pick the cheapest model that can do
 * the job, not one large model for everything.
 *
 * Today every agent runs on a single strong model (claudeClient
 * DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"), so a one-line classification
 * costs the same per token as an executive narrative. The mandate calls for
 * three tiers:
 *   • Tier 1 (small)  — classification, routing, trigger/change detection,
 *                       evidence ranking, fingerprinting, dedup, drift, scoring.
 *   • Tier 2 (medium) — the analytical core: risk/issue/readiness/confidence/
 *                       governance/artifact analysis. The default.
 *   • Tier 3 (large)  — executive narratives, SteerCo/board packs, artifact
 *                       merges, strategic recommendations, contradiction
 *                       resolution, outcome forecasting. Only the heavy work.
 *
 * This is a pure registry + resolver. It maps known agent ids to a tier, falls
 * back to a conservative name heuristic for unknown agents (quality-first: never
 * downgrade below Tier 2 unless the agent is clearly detection/scoring), and
 * exposes the model id per tier so Increment 7 can wire routing into run-agent.
 * No backend changes here; fully unit-testable.
 */

export type ModelTier = "tier1" | "tier2" | "tier3";

export interface TierProfile {
  tier: ModelTier;
  /** Anthropic model id this tier routes to (the routing target). */
  model: string;
  label: string;
  /** Relative output-token cost vs Tier 2 (=1.0); used by the cost estimator. */
  relativeCost: number;
}

/**
 * Tier → model + relative cost. Tier 2 is the current production default, so its
 * relative cost is the 1.0 baseline. Tier 1 is materially cheaper; Tier 3 is the
 * premium model reserved for narrative/strategic work. Model ids are the routing
 * targets wired in Increment 7 and can be overridden centrally here.
 */
export const TIER_PROFILES: Record<ModelTier, TierProfile> = {
  tier1: { tier: "tier1", model: "claude-3-5-haiku-latest", label: "Small / fast", relativeCost: 0.08 },
  tier2: { tier: "tier2", model: "claude-sonnet-4-6", label: "Medium / analytical", relativeCost: 1 },
  tier3: { tier: "tier3", model: "claude-opus-4-1", label: "Large / strategic", relativeCost: 5 },
};

/**
 * Explicit agent → tier registry. Anything not listed resolves via the name
 * heuristic. Keep this list quality-first: only the genuinely light agents
 * (detection / scoring / extraction / validation) go to Tier 1; only narrative /
 * strategic / synthesis agents go to Tier 3; the analytical majority stay Tier 2.
 */
export const AGENT_TIER: Record<string, ModelTier> = {
  // ── Tier 1: detection, scoring, validation, extraction, routing ──
  "input-quality": "tier1",
  "artifact-staleness-check": "tier1",
  "phase-readiness-monitor": "tier1",
  "phase-completion-estimator": "tier1",
  "workstream-health-scorer": "tier1",
  "budget-anomaly-detector": "tier1",
  "scope-creep-monitor": "tier1",
  "dependency-check": "tier1",
  "kpi-validator": "tier1",
  "compliance-checker": "tier1",
  "setup-prefill": "tier1",
  "meeting-notes": "tier1",
  "meeting-notes-extractor": "tier1",
  "agent-schedule-optimiser": "tier1",
  "pattern-query": "tier1",

  // ── Tier 2: analytical core (default; listed for explicitness) ──
  risk: "tier2",
  "risk-review": "tier2",
  milestone: "tier2",
  plan: "tier2",
  "gate-review": "tier2",
  "gate-readiness-coach": "tier2",
  escalation: "tier2",
  stakeholder: "tier2",
  "stakeholder-risk-assessor": "tier2",
  "stakeholder-comms-drafter": "tier2",
  adoption: "tier2",
  budget: "tier2",
  "benefits-tracker": "tier2",
  "decision-advisor": "tier2",
  "contradiction-detector": "tier2",
  "health-heatmap": "tier2",
  retro: "tier2",
  "scope-pcr": "tier2",
  "critical-path": "tier2",
  "change-impact": "tier2",
  "handoff-quality": "tier2",
  "exit-criteria-generator": "tier2",
  "artifact-reviewer": "tier2",
  "benchmark-comparator": "tier2",
  "pattern-extract": "tier2",
  "vendor-risk-assessor": "tier2",
  "capacity-assessor": "tier2",
  "discovery-guide-generator": "tier2",
  "sprint-planner": "tier2",
  "onboarding-briefer": "tier2",
  "twin-sync": "tier2",
  chat: "tier2",
  titan: "tier2",
  // Phase artifact builders are large generators, but generation is Tier-2 work.
  strategy: "tier2",
  mobilise: "tier2",
  discover: "tier2",
  design: "tier2",
  build: "tier2",
  operate: "tier2",
  govern: "tier2",
  optimize: "tier2",
  valuerealize: "tier2",
  delivery: "tier2",

  // ── Tier 3: narrative, strategic synthesis, executive deliverables ──
  narrative: "tier3",
  "narrative-refine": "tier3",
  deck: "tier3",
  "deck-section": "tier3",
  "board-pack": "tier3",
  "executive-brief": "tier3",
  "steerco-prep": "tier3",
  "steerco-agenda-builder": "tier3",
  "daily-briefing": "tier3",
  "weekly-digest": "tier3",
  closure: "tier3",
  "benefit-forecast": "tier3",
  "lessons-synthesiser": "tier3",
};

/** Substrings that mark an agent as light (Tier 1) when not explicitly mapped. */
const TIER1_HINTS = [
  "detector",
  "detection",
  "checker",
  "validator",
  "monitor",
  "fingerprint",
  "dedup",
  "drift",
  "staleness",
  "classify",
  "classifier",
  "router",
  "ranking",
  "estimator",
  "scorer",
  "extractor",
  "prefill",
];

/** Substrings that mark an agent as heavy (Tier 3) when not explicitly mapped. */
const TIER3_HINTS = [
  "narrative",
  "brief",
  "briefing",
  "digest",
  "deck",
  "board-pack",
  "steerco",
  "forecast",
  "synthesis",
  "synthesiser",
  "synthesizer",
  "merge",
  "executive",
];

function matches(agentId: string, hints: string[]): boolean {
  const id = agentId.toLowerCase();
  return hints.some((hint) => id.includes(hint));
}

/**
 * Resolve the model tier for an agent. Registry first, then a conservative name
 * heuristic, then Tier 2 (the safe analytical default — never silently route
 * unknown work to the cheapest model).
 */
export function resolveAgentModelTier(agentId: string): ModelTier {
  const explicit = AGENT_TIER[agentId];
  if (explicit) return explicit;
  // Heavy wins over light when both match (e.g. a hypothetical "narrative-checker").
  if (matches(agentId, TIER3_HINTS)) return "tier3";
  if (matches(agentId, TIER1_HINTS)) return "tier1";
  return "tier2";
}

export interface AgentModelChoice {
  agentId: string;
  tier: ModelTier;
  model: string;
  relativeCost: number;
  /** Whether the tier came from the explicit registry vs the name heuristic. */
  source: "registry" | "heuristic" | "default";
}

/** Resolve the full model choice (tier + concrete model + cost weight). */
export function resolveAgentModel(agentId: string): AgentModelChoice {
  const explicit = AGENT_TIER[agentId];
  const tier = resolveAgentModelTier(agentId);
  const profile = TIER_PROFILES[tier];
  const source: AgentModelChoice["source"] = explicit
    ? "registry"
    : tier === "tier2"
      ? "default"
      : "heuristic";
  return { agentId, tier, model: profile.model, relativeCost: profile.relativeCost, source };
}
