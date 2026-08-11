// Single source of truth for AI models — pure data, zero behavioural branching
// on specific model names anywhere in the app. The runtime reads three things
// from here and nothing else:
//   1. the model CATALOG (id / provider / tier / pricing) — what exists,
//   2. a per-model CAPABILITY profile (feature flags) — what a model can do,
//   3. a thin set of resolvers (default model, profile lookup, provider check).
//
// Why this shape: previously model knowledge was smeared across the codebase as
// `if (model === "gpt-4o")`-style branches and hard allowlists that REJECTED any
// model not enumerated. That made adding a model a code change in many files and
// silently broke newer models. Here, capabilities are looked up by id with a
// PROVIDER-LEVEL FALLBACK, so an unknown model still runs with safe provider
// defaults instead of erroring. Adding/retiring a model is a one-line data edit.

export type AIProvider = "anthropic" | "openai" | "google";

// Coarse cost/capability tier used by the model router. Kept here (not in the
// router) so tier travels with the catalog entry — the single fact table.
export type ModelTier = "tier1" | "tier2" | "tier3";

/**
 * What a model can do. These flags — never the model NAME — drive payload
 * construction in the provider adapter. A new model only needs an entry here (or
 * it inherits its provider's defaults) to behave correctly.
 */
export interface ModelCapabilityProfile {
  /** Anthropic-style ephemeral prompt caching via cache_control + beta header. */
  promptCaching: boolean;
  /** Strict JSON object response mode (OpenAI response_format json_object). */
  jsonMode: boolean;
  /** Accepts a native file/image content block in the first user message. */
  fileInput: boolean;
  /** Accepts a `temperature` sampling parameter. */
  acceptsTemperature: boolean;
  /** Name of the max-output-tokens request field for this model's API. */
  tokenParam: "max_tokens" | "max_output_tokens" | "maxOutputTokens";
}

export interface ModelCatalogEntry {
  id: string;
  provider: AIProvider;
  tier: ModelTier;
  /** USD per 1M input / output tokens — used by the token cost ledger. */
  inputPricePerM: number;
  outputPricePerM: number;
  /** Relative cost multiplier vs the tier2 baseline, for quick routing math. */
  costMultiplier: number;
  /**
   * Superseded by a newer model. Still SELECTABLE — an already-configured
   * programme keeps resolving its real pricing and capabilities — but never an
   * auto-routing target: `modelForTier` skips these. Retiring a model is
   * therefore a one-field edit, not a deletion that would silently strand
   * existing configurations on provider-default pricing.
   */
  legacy?: true;
  /**
   * PAST ITS RETIREMENT DATE — the provider no longer serves this id, so a call
   * returns 404. Distinct from `legacy`, and the distinction is the whole point:
   * a legacy model still WORKS and is a defensible thing to stay pinned to, while
   * a retired one cannot run at all. Collapsing them is how the picker came to
   * tell an operator that `claude-opus-4-1` was "kept selectable for programmes
   * already pinned to it" five days after it stopped answering — a promise the
   * API will not keep, one line above an entry that stated the honest version.
   *
   * Retired implies not auto-routed (see `modelForTier`), and the surface must
   * say so rather than offering it as an ordinary choice. The entry STAYS in the
   * catalog regardless: an already-pinned programme must keep resolving its real
   * price and rendering honestly instead of falling through to provider-default
   * pricing — the same reason `legacy` entries are kept at all.
   */
  retired?: true;
  /**
   * This entry's list price is PROVISIONAL — the numbers below are real
   * published list prices (never placeholders, so tier and routing math stay
   * sound), but they are not what a call actually bills right now, e.g. a
   * time-boxed introductory rate is in force. Any surface that reports DOLLARS
   * derived from this entry — today that is the run-agent cost ledger, which
   * writes `costUsd` into its `response_received` observation payload — must
   * present that figure as provisional, not as billed spend.
   */
  priceUnverified?: true;
  capabilities: ModelCapabilityProfile;
}

// Provider-API-shaped capability defaults. An unknown model inherits these so it
// still runs (graceful degradation) rather than being rejected by an allowlist.
const PROVIDER_DEFAULT_CAPABILITIES: Record<AIProvider, ModelCapabilityProfile> = {
  anthropic: { promptCaching: true, jsonMode: false, fileInput: true, acceptsTemperature: true, tokenParam: "max_tokens" },
  openai: { promptCaching: false, jsonMode: true, fileInput: true, acceptsTemperature: true, tokenParam: "max_tokens" },
  google: { promptCaching: false, jsonMode: false, fileInput: true, acceptsTemperature: true, tokenParam: "maxOutputTokens" },
};

// Anthropic's 4.7-and-later generation REMOVED the sampling parameters: sending
// `temperature` to Fable 5, Opus 4.8, or Sonnet 5 is rejected with a 400. For
// those models the provider-level fallback above is not the safe default it is
// everywhere else — it is the single setting that breaks them, on every call.
// So they carry an EXPLICIT profile: the graceful-degradation rule ("an unknown
// model inherits provider defaults and still runs") inverts the moment a
// provider retires a request field, because the inherited value stops being a
// neutral guess and becomes affirmatively wrong.
// `claudeClient.ts` consults only `acceptsTemperature` when deciding whether to
// attach the field, so clearing it here is the entire fix — still no branching
// on model name anywhere in the runtime.
const ANTHROPIC_NO_SAMPLING_PARAMS: ModelCapabilityProfile = {
  ...PROVIDER_DEFAULT_CAPABILITIES.anthropic,
  acceptsTemperature: false,
};

// The known catalog. Pricing in USD/1M tokens (list prices; cache/discount math
// lives in the ledger). costMultiplier is relative to the tier2 anchor (Sonnet)
// and is exactly inputPricePerM / 3 for every entry — one rule, no hand-tuning.
//
// PRICING PROVENANCE: Anthropic rows carry published list prices. Where the
// price in force differs from list (claude-sonnet-5 is under a time-boxed
// introductory rate), the entry is flagged `priceUnverified` and keeps its LIST
// price — a real number, so routing stays sound, with the caveat carried on the
// entry rather than papered over. Never invent a price to fill a row: an
// unpriced model must be left out, not guessed at.
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ── Anthropic ── (current; list prices per the Anthropic model catalog)
  { id: "claude-haiku-4-5", provider: "anthropic", tier: "tier1", inputPricePerM: 1, outputPricePerM: 5, costMultiplier: 0.33, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  { id: "claude-sonnet-5", provider: "anthropic", tier: "tier2", inputPricePerM: 3, outputPricePerM: 15, costMultiplier: 1, priceUnverified: true, capabilities: ANTHROPIC_NO_SAMPLING_PARAMS },
  { id: "claude-fable-5", provider: "anthropic", tier: "tier2", inputPricePerM: 10, outputPricePerM: 50, costMultiplier: 3.33, capabilities: ANTHROPIC_NO_SAMPLING_PARAMS },
  { id: "claude-opus-4-8", provider: "anthropic", tier: "tier3", inputPricePerM: 5, outputPricePerM: 25, costMultiplier: 1.67, capabilities: ANTHROPIC_NO_SAMPLING_PARAMS },
  // ── Anthropic (superseded / retired) ── priced and resolvable, never auto-routed.
  // `retired` means the id 404s: opus-4-1 passed its date on 2026-08-05, haiku-3-5 on
  // 2026-02-19. They stay so an already-pinned programme resolves its real price.
  { id: "claude-sonnet-4-6", provider: "anthropic", tier: "tier2", inputPricePerM: 3, outputPricePerM: 15, costMultiplier: 1, legacy: true, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  { id: "claude-opus-4-1", provider: "anthropic", tier: "tier3", inputPricePerM: 15, outputPricePerM: 75, costMultiplier: 5, legacy: true, retired: true, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  { id: "claude-3-5-haiku-latest", provider: "anthropic", tier: "tier1", inputPricePerM: 0.8, outputPricePerM: 4, costMultiplier: 0.27, legacy: true, retired: true, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  // ── OpenAI ──
  { id: "gpt-4o-mini", provider: "openai", tier: "tier1", inputPricePerM: 0.15, outputPricePerM: 0.6, costMultiplier: 0.05, capabilities: PROVIDER_DEFAULT_CAPABILITIES.openai },
  { id: "gpt-4o", provider: "openai", tier: "tier2", inputPricePerM: 2.5, outputPricePerM: 10, costMultiplier: 0.83, capabilities: PROVIDER_DEFAULT_CAPABILITIES.openai },
  { id: "gpt-4.1", provider: "openai", tier: "tier3", inputPricePerM: 5, outputPricePerM: 15, costMultiplier: 1.67, capabilities: PROVIDER_DEFAULT_CAPABILITIES.openai },
  // ── Google ──
  { id: "gemini-1.5-flash", provider: "google", tier: "tier1", inputPricePerM: 0.075, outputPricePerM: 0.3, costMultiplier: 0.025, capabilities: PROVIDER_DEFAULT_CAPABILITIES.google },
  { id: "gemini-2.0-flash", provider: "google", tier: "tier1", inputPricePerM: 0.1, outputPricePerM: 0.4, costMultiplier: 0.033, capabilities: PROVIDER_DEFAULT_CAPABILITIES.google },
  { id: "gemini-1.5-pro", provider: "google", tier: "tier2", inputPricePerM: 1.25, outputPricePerM: 5, costMultiplier: 0.42, capabilities: PROVIDER_DEFAULT_CAPABILITIES.google },
];

const CATALOG_BY_ID = new Map(MODEL_CATALOG.map((entry) => [entry.id, entry]));

// Default model per provider, derived from the catalog (the current non-legacy
// tier2 entry, or the first listed). No hardcoded constants scattered elsewhere.
const DEFAULT_BY_PROVIDER: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o",
  google: "gemini-1.5-pro",
};

export function isAIProvider(value: string): value is AIProvider {
  return value === "anthropic" || value === "openai" || value === "google";
}

export function defaultModelForProvider(provider: AIProvider): string {
  return DEFAULT_BY_PROVIDER[provider] ?? MODEL_CATALOG.find((m) => m.provider === provider)?.id ?? "";
}

export function getCatalogEntry(modelId: string | undefined | null): ModelCatalogEntry | undefined {
  if (!modelId) return undefined;
  return CATALOG_BY_ID.get(modelId);
}

/**
 * Capabilities for a model id. Known models use their catalog profile; unknown
 * models inherit the provider's defaults so they still run. `provider` is the
 * provider actually being called (the adapter knows it), used as the fallback
 * key when the id isn't in the catalog.
 */
export function getModelCapabilities(modelId: string | undefined | null, provider: AIProvider): ModelCapabilityProfile {
  const entry = getCatalogEntry(modelId);
  if (entry) return entry.capabilities;
  return PROVIDER_DEFAULT_CAPABILITIES[provider];
}

export function modelsForProvider(provider: AIProvider): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => entry.provider === provider);
}

/**
 * Concrete model id for a provider at a given tier — the routing target. Picks
 * the cheapest NON-LEGACY catalog entry for that provider+tier (so tier1 lands
 * on the smallest current model). Legacy entries are excluded outright rather
 * than merely deprioritised: a superseded model stays selectable by an operator
 * but must never be reached by automatic routing. Returns undefined when the
 * provider has no current model at that tier, letting the caller fall back to
 * the configured default — a visible miss, not a silent hop onto old hardware.
 */
export function modelForTier(provider: AIProvider, tier: ModelTier): string | undefined {
  const candidates = MODEL_CATALOG
    .filter((entry) => entry.provider === provider && entry.tier === tier && !entry.legacy && !entry.retired)
    .sort((a, b) => a.costMultiplier - b.costMultiplier);
  return candidates[0]?.id;
}

// ── Agent → model tier registry (provider-agnostic) ──
// Quality-first: only genuinely light work (detection / scoring / validation /
// extraction / routing) is tier1; narrative / strategic / synthesis is tier3;
// the analytical majority stays tier2 (the safe default). Unknown agents resolve
// via the name heuristic below, then default to tier2 — never silently cheap.
const AGENT_TIER: Record<string, ModelTier> = {
  // Tier 1 — light
  "phase-completion-estimator": "tier1",
  "dependency-check": "tier1",
  "kpi-validator": "tier1",
  "compliance-checker": "tier1",
  "setup-prefill": "tier1",
  "meeting-notes": "tier1",
  "meeting-notes-extractor": "tier1",
  "pattern-query": "tier1",
  // Tier 3 — narrative / strategic / synthesis
  narrative: "tier3",
  "narrative-refine": "tier3",
  deck: "tier3",
  "deck-section": "tier3",
  "board-pack": "tier3",
  "steerco-agenda-builder": "tier3",
  "daily-briefing": "tier3",
  "weekly-digest": "tier3",
  closure: "tier3",
  "benefit-forecast": "tier3",
  "lessons-synthesiser": "tier3",
};

const TIER1_HINTS = ["detector", "detection", "checker", "validator", "monitor", "fingerprint", "dedup", "drift", "staleness", "classify", "classifier", "router", "ranking", "estimator", "scorer", "extractor", "prefill"];
const TIER3_HINTS = ["narrative", "brief", "briefing", "digest", "deck", "board-pack", "steerco", "forecast", "synthesis", "synthesiser", "synthesizer", "merge", "executive"];

/**
 * Resolve an agent's model tier: explicit registry first, then a conservative
 * name heuristic (heavy wins over light on a tie), then tier2.
 */
export function resolveAgentTier(agentId: string): ModelTier {
  const explicit = AGENT_TIER[agentId];
  if (explicit) return explicit;
  const id = agentId.toLowerCase();
  if (TIER3_HINTS.some((h) => id.includes(h))) return "tier3";
  if (TIER1_HINTS.some((h) => id.includes(h))) return "tier1";
  return "tier2";
}

/**
 * USD cost for a single model call, derived from catalog list pricing. Unknown
 * models fall back to their provider's default model pricing so a cost is always
 * produced (graceful degradation, never throws). Cached input tokens are billed
 * at the discounted prompt-cache read rate (default 10% of the input rate), and
 * they are subtracted from fresh input so they're never double-counted.
 */
export function estimateCostUsd(params: {
  model: string | undefined | null;
  provider: AIProvider;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number {
  const entry = getCatalogEntry(params.model)
    ?? getCatalogEntry(defaultModelForProvider(params.provider));
  const inputPerM = entry?.inputPricePerM ?? 3;
  const outputPerM = entry?.outputPricePerM ?? 15;
  const cachedPerM = inputPerM * 0.1; // prompt-cache read ≈ 10% of fresh input.
  const input = Math.max(params.inputTokens, 0);
  const output = Math.max(params.outputTokens, 0);
  const cached = Math.min(Math.max(params.cachedInputTokens ?? 0, 0), input);
  const freshInput = input - cached;
  const cost =
    (freshInput / 1_000_000) * inputPerM +
    (cached / 1_000_000) * cachedPerM +
    (output / 1_000_000) * outputPerM;
  return Math.round(cost * 1e6) / 1e6;
}
