/**
 * Token & cost observability — make AI spend measurable.
 *
 * The mandate requires (admin-only) visibility into tokens per capability /
 * program / artifact / action, cache-hit rate, skip rate, model used, cost,
 * latency, and unit economics (cost per recommendation / artifact / insight).
 * Without measurement there is no way to prove the optimisation goals are met.
 *
 * This pure module supplies the measurement primitives:
 *   • estimateTokens()  — deterministic token estimate for a string.
 *   • estimateCost()    — USD cost from token counts + per-model pricing,
 *                         pricing cached-input tokens at the discounted rate.
 *   • AgentRunLedgerEntry — the shape of one recorded AI run (or skip).
 *   • summarizeLedger() — roll a ledger up into the admin observability view:
 *                         totals, per-capability / per-model / per-program /
 *                         per-artifact tokens & cost, cache-hit rate, skip rate,
 *                         latency, and cost-per-unit economics.
 *
 * Pure and deterministic; no backend. The ledger persistence + admin surface are
 * wired separately (Increment 7); this is the math and schema they build on.
 */
import { resolveAgentModel, type ModelTier } from "@/v3/lib/modelRouting";

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** USD per 1M cached input tokens (prompt-cache read). Defaults to 10% of input. */
  cachedInputPerMillion?: number;
}

/**
 * Representative Anthropic list pricing (USD / 1M tokens) for the three routing
 * targets. Approximate and centrally overridable — used for relative cost
 * comparison, not billing.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-3-5-haiku-latest": { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
  "claude-opus-4-1": { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5 },
};

/** Fallback pricing when a model id is unknown (use the analytical default). */
const DEFAULT_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-4-6"];

/**
 * Deterministic token estimate (~4 chars/token, the common English heuristic).
 * Not a tokenizer — a stable approximation good enough for budgeting and
 * before/after comparison. Empty/blank input estimates 0.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

export interface CostInputs {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of inputTokens served from prompt cache (priced at cached rate). */
  cachedInputTokens?: number;
}

/** USD cost for a single call, honouring the cached-input discount. */
export function estimateCost({ model, inputTokens, outputTokens, cachedInputTokens = 0 }: CostInputs): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion * 0.1;
  const cached = Math.min(Math.max(cachedInputTokens, 0), Math.max(inputTokens, 0));
  const freshInput = Math.max(inputTokens, 0) - cached;
  const cost =
    (freshInput / 1_000_000) * pricing.inputPerMillion +
    (cached / 1_000_000) * cachedRate +
    (Math.max(outputTokens, 0) / 1_000_000) * pricing.outputPerMillion;
  // Round to 6 dp (sub-cent precision) to keep sums stable.
  return Math.round(cost * 1e6) / 1e6;
}

export interface AgentRunLedgerEntry {
  programId: string;
  agentId: string;
  /** Capability bucket (delivery/governance/executive/artifact/…) if known. */
  capability?: string | null;
  /** Artifact this run produced/updated, if any. */
  artifactId?: string | null;
  /** What triggered the run (user/trigger/cascade/schedule). */
  action?: string | null;
  model: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  costUsd: number;
  latencyMs?: number;
  /** True when the prompt cache served the static prefix. */
  cacheHit?: boolean;
  /** True when the run was skipped entirely (reuse / cascade-skip / no-event). */
  skipped?: boolean;
  /** Output unit counts for unit economics. */
  outputs?: { recommendations?: number; artifacts?: number; insights?: number };
  timestamp: string;
}

/**
 * Build a ledger entry, deriving tier/model from the agent registry and cost
 * from token counts. The caller supplies measured token counts (or estimates).
 * A skipped run records zero tokens/cost but still counts toward skip rate.
 */
export function buildLedgerEntry(params: {
  programId: string;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
  capability?: string | null;
  artifactId?: string | null;
  action?: string | null;
  cachedInputTokens?: number;
  latencyMs?: number;
  cacheHit?: boolean;
  skipped?: boolean;
  outputs?: AgentRunLedgerEntry["outputs"];
  /** Override the routed model (else resolved from the agent registry). */
  model?: string;
}): AgentRunLedgerEntry {
  const choice = resolveAgentModel(params.agentId);
  const model = params.model ?? choice.model;
  const inputTokens = params.skipped ? 0 : Math.max(params.inputTokens, 0);
  const outputTokens = params.skipped ? 0 : Math.max(params.outputTokens, 0);
  const cachedInputTokens = params.skipped ? 0 : params.cachedInputTokens ?? 0;
  const costUsd = params.skipped ? 0 : estimateCost({ model, inputTokens, outputTokens, cachedInputTokens });
  return {
    programId: params.programId,
    agentId: params.agentId,
    capability: params.capability ?? null,
    artifactId: params.artifactId ?? null,
    action: params.action ?? null,
    model,
    tier: choice.tier,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd,
    latencyMs: params.latencyMs,
    cacheHit: params.cacheHit ?? false,
    skipped: params.skipped ?? false,
    outputs: params.outputs,
    timestamp: params.timestamp,
  };
}

export interface LedgerBucket {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface LedgerSummary {
  totalRuns: number;
  executedRuns: number;
  skippedRuns: number;
  /** Fraction of runs skipped entirely (0–1). */
  skipRate: number;
  /** Fraction of executed runs that hit the prompt cache (0–1). */
  cacheHitRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number | null;
  byCapability: Record<string, LedgerBucket>;
  byModel: Record<string, LedgerBucket>;
  byProgram: Record<string, LedgerBucket>;
  byArtifact: Record<string, LedgerBucket>;
  unitEconomics: {
    recommendations: number;
    artifacts: number;
    insights: number;
    costPerRecommendation: number | null;
    costPerArtifact: number | null;
    costPerInsight: number | null;
  };
}

function emptyBucket(): LedgerBucket {
  return { runs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
}

function addToBucket(map: Record<string, LedgerBucket>, key: string, entry: AgentRunLedgerEntry): void {
  const bucket = (map[key] ??= emptyBucket());
  bucket.runs += 1;
  bucket.inputTokens += entry.inputTokens;
  bucket.outputTokens += entry.outputTokens;
  bucket.totalTokens += entry.inputTokens + entry.outputTokens;
  bucket.costUsd = Math.round((bucket.costUsd + entry.costUsd) * 1e6) / 1e6;
}

/** Roll a ledger up into the admin observability summary. */
export function summarizeLedger(entries: AgentRunLedgerEntry[]): LedgerSummary {
  const byCapability: Record<string, LedgerBucket> = {};
  const byModel: Record<string, LedgerBucket> = {};
  const byProgram: Record<string, LedgerBucket> = {};
  const byArtifact: Record<string, LedgerBucket> = {};

  let executedRuns = 0;
  let skippedRuns = 0;
  let cacheHits = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let recommendations = 0;
  let artifacts = 0;
  let insights = 0;

  for (const entry of entries) {
    if (entry.skipped) {
      skippedRuns += 1;
      continue; // skipped runs carry no tokens/cost; they only affect skip rate.
    }
    executedRuns += 1;
    if (entry.cacheHit) cacheHits += 1;
    totalInputTokens += entry.inputTokens;
    totalOutputTokens += entry.outputTokens;
    totalCostUsd += entry.costUsd;
    if (typeof entry.latencyMs === "number") {
      latencySum += entry.latencyMs;
      latencyCount += 1;
    }
    recommendations += entry.outputs?.recommendations ?? 0;
    artifacts += entry.outputs?.artifacts ?? 0;
    insights += entry.outputs?.insights ?? 0;

    addToBucket(byCapability, entry.capability ?? "uncategorized", entry);
    addToBucket(byModel, entry.model, entry);
    addToBucket(byProgram, entry.programId, entry);
    if (entry.artifactId) addToBucket(byArtifact, entry.artifactId, entry);
  }

  const totalRuns = executedRuns + skippedRuns;
  totalCostUsd = Math.round(totalCostUsd * 1e6) / 1e6;

  const safeDiv = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1e6) / 1e6 : null);

  return {
    totalRuns,
    executedRuns,
    skippedRuns,
    skipRate: totalRuns > 0 ? Math.round((skippedRuns / totalRuns) * 1000) / 1000 : 0,
    cacheHitRate: executedRuns > 0 ? Math.round((cacheHits / executedRuns) * 1000) / 1000 : 0,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalCostUsd,
    avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
    byCapability,
    byModel,
    byProgram,
    byArtifact,
    unitEconomics: {
      recommendations,
      artifacts,
      insights,
      costPerRecommendation: safeDiv(totalCostUsd, recommendations),
      costPerArtifact: safeDiv(totalCostUsd, artifacts),
      costPerInsight: safeDiv(totalCostUsd, insights),
    },
  };
}
