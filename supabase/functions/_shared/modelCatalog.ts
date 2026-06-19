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
  capabilities: ModelCapabilityProfile;
}

// Provider-API-shaped capability defaults. An unknown model inherits these so it
// still runs (graceful degradation) rather than being rejected by an allowlist.
const PROVIDER_DEFAULT_CAPABILITIES: Record<AIProvider, ModelCapabilityProfile> = {
  anthropic: { promptCaching: true, jsonMode: false, fileInput: true, acceptsTemperature: true, tokenParam: "max_tokens" },
  openai: { promptCaching: false, jsonMode: true, fileInput: true, acceptsTemperature: true, tokenParam: "max_tokens" },
  google: { promptCaching: false, jsonMode: false, fileInput: true, acceptsTemperature: true, tokenParam: "maxOutputTokens" },
};

// The known catalog. Pricing in USD/1M tokens (list prices; cache/discount math
// lives in the ledger). costMultiplier is relative to the tier2 anchor (Sonnet).
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ── Anthropic ──
  { id: "claude-haiku-4-5", provider: "anthropic", tier: "tier1", inputPricePerM: 1, outputPricePerM: 5, costMultiplier: 0.33, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  { id: "claude-3-5-haiku-latest", provider: "anthropic", tier: "tier1", inputPricePerM: 0.8, outputPricePerM: 4, costMultiplier: 0.27, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  { id: "claude-sonnet-4-6", provider: "anthropic", tier: "tier2", inputPricePerM: 3, outputPricePerM: 15, costMultiplier: 1, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
  { id: "claude-opus-4-1", provider: "anthropic", tier: "tier3", inputPricePerM: 15, outputPricePerM: 75, costMultiplier: 5, capabilities: PROVIDER_DEFAULT_CAPABILITIES.anthropic },
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

// Default model per provider, derived from the catalog (the tier2 entry, or the
// first listed). No hardcoded constants scattered elsewhere.
const DEFAULT_BY_PROVIDER: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-6",
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
