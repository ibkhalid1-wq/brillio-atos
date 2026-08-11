import type { CopilotThreadMessage } from "./types.ts";
import {
  type AIProvider,
  type ModelTier,
  defaultModelForProvider,
  getModelCapabilities,
  isAIProvider,
  modelForTier,
} from "./modelCatalog.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

let cachedProviderSettings: { provider: AIProvider; apiKey: string; model: string } | null = null;

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FileAttachment {
  base64: string;
  mimeType: string;
  name?: string;
}

export interface ClaudeCompletionOptions {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  /**
   * Cost-routing tier. When set (and no explicit `model` is given), the call is
   * routed to the active provider's model for this tier — e.g. tier1 → the
   * provider's small/cheap model. An explicit `model` always wins; an unset tier
   * uses the configured default model. Provider knowledge stays here, so callers
   * route by intent ("this is light work") not by model name.
   */
  tier?: ModelTier;
  /** Native file attachment — sent as a document/image content block to the AI */
  fileAttachment?: FileAttachment;
  /** Caller-supplied cancellation. Aborting interrupts the request and the stream read. */
  signal?: AbortSignal;
  /** Wall-clock budget for the whole call. Defaults to DEFAULT_STREAM_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Request a strict JSON object back (OpenAI `response_format: json_object`).
   * Only enable when the caller parses the reply as JSON AND the prompt mentions
   * the word "json" — OpenAI rejects the request otherwise. Plain-text callers
   * (chat, field assist, summaries) must leave this off or the model is forced
   * to wrap its answer in JSON.
   */
  jsonResponse?: boolean;
}

// Hard ceiling so a stalled provider stream can never hang a run indefinitely
// without writing a terminal status. Sized to use the available platform
// wall-clock (Supabase edge limit ~150s) with margin for the post-stream DB
// writes: large artifact generations (4096-token JSON over a big cross-phase
// context) were exceeding the previous 90s cap and failing with a timeout.
const DEFAULT_STREAM_TIMEOUT_MS = 130_000;

export interface ClaudeCompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache (billed at the discounted rate). */
  cachedInputTokens?: number;
  latencyMs: number;
  /** Provider + model that actually served the call (failover-aware) — lets the
   *  cost ledger attribute spend to the right model even after a provider swap. */
  provider: AIProvider;
  model: string;
}

export interface ClaudeStreamResult extends ClaudeCompletionResult {
  chunks: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envProviderSettings(): { provider: AIProvider; apiKey: string; model: string } | null {
  const configuredProvider = (Deno.env.get("ADAM_AI_PROVIDER") || "").toLowerCase();
  const provider = isAIProvider(configuredProvider) ? configuredProvider : null;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const googleKey = Deno.env.get("GOOGLE_GEMINI_API_KEY") || Deno.env.get("GEMINI_API_KEY") || "";
  const configuredModel = Deno.env.get("ADAM_AI_MODEL") || "";

  if (provider === "openai" && openAiKey) return { provider: "openai", apiKey: openAiKey, model: configuredModel || defaultModelForProvider("openai") };
  if (provider === "google" && googleKey) return { provider: "google", apiKey: googleKey, model: configuredModel || defaultModelForProvider("google") };
  if (provider === "anthropic" && anthropicKey) return { provider: "anthropic", apiKey: anthropicKey, model: configuredModel || defaultModelForProvider("anthropic") };
  if (anthropicKey) return { provider: "anthropic", apiKey: anthropicKey, model: configuredModel || defaultModelForProvider("anthropic") };
  if (openAiKey) return { provider: "openai", apiKey: openAiKey, model: configuredModel || defaultModelForProvider("openai") };
  if (googleKey) return { provider: "google", apiKey: googleKey, model: configuredModel || defaultModelForProvider("google") };
  return null;
}

async function getProviderSettings(): Promise<{ provider: AIProvider; apiKey: string; model: string }> {
  const envSettings = envProviderSettings();
  if (envSettings) return envSettings;
  if (cachedProviderSettings) return cachedProviderSettings;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (supabaseUrl && serviceRoleKey) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/adam_ai_provider_settings?select=provider,api_key,model,is_active,updated_at&order=is_active.desc,updated_at.desc&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (response.ok) {
      const rows = await response.json().catch(() => []) as Array<{ provider?: string; api_key?: string; model?: string }>;
      const row = rows.find((item) => isAIProvider(item.provider || "") && item.api_key);
      if (row?.provider && row.api_key && isAIProvider(row.provider)) {
        cachedProviderSettings = { provider: row.provider, apiKey: row.api_key, model: row.model || defaultModelForProvider(row.provider) };
        return cachedProviderSettings;
      }
    }
  }

  throw new Error("AI provider key is not configured. Open AI Settings and connect a provider.");
}

type ProviderSettings = { provider: AIProvider; apiKey: string; model: string };

/**
 * Ordered list of provider configurations to try, primary first. The primary
 * respects ADAM_AI_PROVIDER / the active DB row; any other providers that have
 * env keys are appended as failover targets so a single provider outage (auth
 * error, sustained 5xx/429, network failure) doesn't sink the run. Distinct by
 * provider — the same provider is never tried twice.
 */
async function getProviderFallbackChain(): Promise<ProviderSettings[]> {
  const chain: ProviderSettings[] = [];
  const seen = new Set<AIProvider>();
  const push = (settings: ProviderSettings | null) => {
    if (settings && settings.apiKey && !seen.has(settings.provider)) {
      seen.add(settings.provider);
      chain.push(settings);
    }
  };

  try {
    push(await getProviderSettings());
  } catch {
    // No primary configured — env fallbacks below may still apply.
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
  const googleKey = Deno.env.get("GOOGLE_GEMINI_API_KEY") || Deno.env.get("GEMINI_API_KEY") || "";
  if (anthropicKey) push({ provider: "anthropic", apiKey: anthropicKey, model: defaultModelForProvider("anthropic") });
  if (openAiKey) push({ provider: "openai", apiKey: openAiKey, model: defaultModelForProvider("openai") });
  if (googleKey) push({ provider: "google", apiKey: googleKey, model: defaultModelForProvider("google") });

  return chain;
}

async function fetchWithRetry(
  requestFactory: () => Promise<Response>,
  errorLabel: string,
  attempt = 0,
): Promise<Response> {
  const response = await requestFactory();
  if (response.ok) return response;

  const isRateLimit = response.status === 429;
  const isServerError = response.status >= 500;
  const maxAttempts = isRateLimit ? 4 : 2;

  if ((isRateLimit || isServerError) && attempt < maxAttempts) {
    // Honour the Retry-After header (in seconds) if present, else use exponential back-off.
    // For rate limits we need to wait the full window — typically 5–60 s.
    const retryAfterHeader = response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset-tokens");
    let waitMs: number;
    if (retryAfterHeader) {
      const seconds = parseFloat(retryAfterHeader);
      waitMs = Number.isFinite(seconds) ? Math.ceil(seconds * 1000) + 500 : 10_000;
    } else {
      // Exponential back-off with ±20% jitter to prevent thundering-herd when multiple
      // agents fire simultaneously: 5 s, 12 s, 25 s, 50 s for rate limits; 0.8 s, 1.6 s for server errors
      const base = isRateLimit
        ? ([5_000, 12_000, 25_000, 50_000][attempt] ?? 50_000)
        : 800 * (attempt + 1);
      const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
      waitMs = Math.round(base + jitter);
    }
    await delay(waitMs);
    return fetchWithRetry(requestFactory, errorLabel, attempt + 1);
  }

  // For rate-limit exhaustion give a clean, user-facing message instead of raw JSON.
  if (response.status === 429) {
    throw new Error(
      "The AI service is temporarily busy (rate limit). Please wait a moment and try again.",
    );
  }
  const detail = await response.text().catch(() => "");
  throw new Error(`${errorLabel} API error (${response.status}): ${detail || response.statusText}`);
}

function anthropicFileBlock(file: FileAttachment): Record<string, unknown> {
  const isImage = file.mimeType.startsWith("image/");
  if (isImage) {
    return { type: "image", source: { type: "base64", media_type: file.mimeType, data: file.base64 } };
  }
  // PDF and other documents — Anthropic supports application/pdf natively
  return { type: "document", source: { type: "base64", media_type: file.mimeType, data: file.base64 } };
}

/**
 * Build the `system` field as a cacheable content-block array. Marking the
 * (large, stable) system prompt with `cache_control: ephemeral` lets Anthropic
 * serve it from the prompt cache on repeat calls within the cache TTL, billing
 * those prefix tokens at ~10% instead of full rate. It is a no-op for short
 * prompts below the cache minimum (Anthropic silently ignores cache_control),
 * and never changes what the model sees — pure cost reduction, zero quality
 * impact. Token savings only materialise when the system prefix is identical
 * across calls, which is the whole point of keeping static instructions there.
 */
function anthropicSystemBlocks(system: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

function anthropicPayload(options: ClaudeCompletionOptions, stream: boolean): Record<string, unknown> {
  const model = options.model || defaultModelForProvider("anthropic");
  const caps = getModelCapabilities(model, "anthropic");
  const payload: Record<string, unknown> = {
    model,
    // Cacheable system blocks only when the model supports prompt caching;
    // otherwise send a plain string so we don't attach cache_control needlessly.
    system: caps.promptCaching ? anthropicSystemBlocks(options.system) : options.system,
    messages: options.messages.map((message, idx) => {
      const textBlock = { type: "text", text: message.content };
      // Attach the file to the first user message when the model accepts files.
      if (caps.fileInput && message.role === "user" && idx === 0 && options.fileAttachment) {
        return { role: message.role, content: [anthropicFileBlock(options.fileAttachment), textBlock] };
      }
      return { role: message.role, content: [textBlock] };
    }),
    [caps.tokenParam]: options.maxTokens ?? 4096,
    stream,
  };
  if (caps.acceptsTemperature) payload.temperature = options.temperature ?? 0.2;
  return payload;
}

function openAiPayload(options: ClaudeCompletionOptions, stream: boolean): Record<string, unknown> {
  const model = options.model || defaultModelForProvider("openai");
  const caps = getModelCapabilities(model, "openai");
  const messages: unknown[] = [{ role: "system", content: options.system }];
  options.messages.forEach((message, idx) => {
    if (caps.fileInput && message.role === "user" && idx === 0 && options.fileAttachment) {
      const file = options.fileAttachment;
      const isImage = file.mimeType.startsWith("image/");
      const contentParts: unknown[] = [];
      if (isImage) {
        contentParts.push({ type: "image_url", image_url: { url: `data:${file.mimeType};base64,${file.base64}` } });
      }
      // OpenAI doesn't support PDF as a content block in chat; include text prompt only for non-images
      contentParts.push({ type: "text", text: message.content });
      messages.push({ role: message.role, content: contentParts });
    } else {
      messages.push({ role: message.role, content: message.content });
    }
  });

  const payload: Record<string, unknown> = {
    model,
    messages,
    [caps.tokenParam]: options.maxTokens ?? 4096,
    stream,
  };
  if (caps.acceptsTemperature) payload.temperature = options.temperature ?? 0.2;
  // JSON object mode only when the model supports it AND the caller asked for it.
  if (!stream && options.jsonResponse && caps.jsonMode) {
    payload.response_format = { type: "json_object" };
  }
  return payload;
}

function geminiPayload(options: ClaudeCompletionOptions): Record<string, unknown> {
  const model = options.model || defaultModelForProvider("google");
  const caps = getModelCapabilities(model, "google");
  const generationConfig: Record<string, unknown> = {
    [caps.tokenParam]: options.maxTokens ?? 1400,
  };
  if (caps.acceptsTemperature) generationConfig.temperature = options.temperature ?? 0.2;
  return {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: options.messages.map((message, idx) => {
      const parts: unknown[] = [];
      if (caps.fileInput && message.role === "user" && idx === 0 && options.fileAttachment) {
        const file = options.fileAttachment;
        parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64 } });
      }
      parts.push({ text: message.content });
      return { role: message.role === "assistant" ? "model" : "user", parts };
    }),
    generationConfig,
  };
}

async function providerResponse(
  options: ClaudeCompletionOptions,
  stream: boolean,
  settingsOverride?: ProviderSettings,
): Promise<{ response: Response; provider: AIProvider; model: string }> {
  const settings = settingsOverride ?? await getProviderSettings();
  // Routing precedence: explicit model → tier-routed model for the active
  // provider → the provider's configured/default model. Tier routing is what
  // sends light agents to a cheaper model without any model-name logic upstream.
  const routedModel = options.model
    || (options.tier ? modelForTier(settings.provider, options.tier) : undefined)
    || settings.model;
  const providerOptions = { ...options, model: routedModel };
  if (settings.provider === "openai") {
    const openAiModel = providerOptions.model || defaultModelForProvider("openai");
    const response = await fetchWithRetry(
      () => fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openAiPayload(providerOptions, stream)),
        signal: providerOptions.signal,
      }),
      "OpenAI",
    );
    return { response, provider: settings.provider, model: openAiModel };
  }

  if (settings.provider === "google") {
    const model = providerOptions.model || defaultModelForProvider("google");
    const action = stream ? "streamGenerateContent" : "generateContent";
    const query = stream ? `alt=sse&key=${encodeURIComponent(settings.apiKey)}` : `key=${encodeURIComponent(settings.apiKey)}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?${query}`;
    const response = await fetchWithRetry(
      () => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload(providerOptions)),
        signal: providerOptions.signal,
      }),
      "Google Gemini",
    );
    return { response, provider: settings.provider, model };
  }

  const anthropicModel = providerOptions.model || defaultModelForProvider("anthropic");
  const anthropicHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
  };
  // Send the prompt-caching beta header only for models that support caching —
  // capability flag, never a model-name check.
  if (getModelCapabilities(anthropicModel, "anthropic").promptCaching) {
    anthropicHeaders["anthropic-beta"] = "prompt-caching-2024-07-31";
  }
  const response = await fetchWithRetry(
    () => fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: anthropicHeaders,
      body: JSON.stringify(anthropicPayload(providerOptions, stream)),
      signal: providerOptions.signal,
    }),
    "Anthropic",
  );
  return { response, provider: settings.provider, model: anthropicModel };
}

function parseGeminiText(parsed: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }) {
  return {
    text: (parsed.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim(),
    inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function completeOnce(
  options: ClaudeCompletionOptions,
  settings: ProviderSettings,
): Promise<ClaudeCompletionResult> {
  const startedAt = Date.now();
  const { response, provider, model } = await providerResponse(options, false, settings);

  if (provider === "openai") {
    const parsed = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: (parsed.choices || []).map((choice) => choice.message?.content || "").join("").trim(),
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
      provider,
      model,
    };
  }

  if (provider === "google") {
    const parsed = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const result = parseGeminiText(parsed);
    return { ...result, latencyMs: Date.now() - startedAt, provider, model };
  }

  const parsed = await response.json() as {
    content?: { text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };

  return {
    text: (parsed.content || []).map((item) => item?.text || "").join("").trim(),
    inputTokens: parsed.usage?.input_tokens ?? 0,
    outputTokens: parsed.usage?.output_tokens ?? 0,
    cachedInputTokens: parsed.usage?.cache_read_input_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
    provider,
    model,
  };
}

export async function completeClaudeText(options: ClaudeCompletionOptions): Promise<ClaudeCompletionResult> {
  const chain = await getProviderFallbackChain();
  if (!chain.length) {
    throw new Error("AI provider key is not configured. Open AI Settings and connect a provider.");
  }
  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    if (options.signal?.aborted) throw new Error("AI provider call was aborted.");
    // Fallback providers use their own default model — an explicit model is only
    // valid for the primary provider it was chosen for.
    const attemptOptions = i === 0 ? options : { ...options, model: undefined };
    try {
      return await completeOnce(attemptOptions, chain[i]);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI provider call failed across all configured providers.");
}

function appendToken(token: string, state: { text: string; chunks: string[] }, onToken?: (token: string) => void) {
  if (!token) return;
  state.text += token;
  state.chunks.push(token);
  onToken?.(token);
}

async function streamOnce(
  options: ClaudeCompletionOptions,
  settings: ProviderSettings,
  timeoutMs: number,
  onToken?: (token: string) => void,
): Promise<ClaudeStreamResult> {
  const startedAt = Date.now();

  // Wall-clock guard: a stalled provider stream (no `done`, no error) would otherwise
  // hang the run until the platform kills it — leaving no terminal status. The timeout
  // aborts the request + reader so the caller can write a clean failure.
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const { response, provider, model } = await providerResponse({ ...options, signal: controller.signal }, true, settings);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`${provider} streaming response body is unavailable.`);
    }

    const decoder = new TextDecoder();
    const state = { text: "", chunks: [] as string[] };
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;

    while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventBlock of events) {
      const dataLine = eventBlock
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const rawData = dataLine.slice(6).trim();
      if (!rawData || rawData === "[DONE]") continue;

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (provider === "openai") {
        const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
        appendToken(choices?.[0]?.delta?.content || "", state, onToken);
        const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        inputTokens = usage?.prompt_tokens ?? inputTokens;
        outputTokens = usage?.completion_tokens ?? outputTokens;
        continue;
      }

      if (provider === "google") {
        const gemini = parseGeminiText(parsed as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        });
        appendToken(gemini.text, state, onToken);
        inputTokens = gemini.inputTokens || inputTokens;
        outputTokens = gemini.outputTokens || outputTokens;
        continue;
      }

      const parsedType = typeof parsed.type === "string" ? parsed.type : "";
      if (parsedType === "message_start") {
        const usage = (parsed.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number } } | undefined)?.usage;
        inputTokens = usage?.input_tokens ?? inputTokens;
        cachedInputTokens = usage?.cache_read_input_tokens ?? cachedInputTokens;
      }

      if (parsedType === "content_block_delta") {
        const delta = parsed.delta as { text?: string; type?: string } | undefined;
        appendToken(delta?.type === "text_delta" ? (delta.text || "") : "", state, onToken);
      }

      if (parsedType === "message_delta") {
        const usage = parsed.usage as { output_tokens?: number } | undefined;
        outputTokens = usage?.output_tokens ?? outputTokens;
      }
    }
  }

    return {
      text: state.text.trim(),
      inputTokens,
      outputTokens,
      cachedInputTokens,
      latencyMs: Date.now() - startedAt,
      chunks: state.chunks,
      provider,
      model,
    };
  } catch (error) {
    if (timedOut) {
      throw new Error(`AI provider call timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (options.signal) options.signal.removeEventListener("abort", onExternalAbort);
  }
}

const MIN_FAILOVER_BUDGET_MS = 5_000;

export async function streamClaudeText(
  options: ClaudeCompletionOptions,
  onToken?: (token: string) => void,
): Promise<ClaudeStreamResult> {
  const totalBudgetMs = options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
  const deadline = Date.now() + totalBudgetMs;
  const chain = await getProviderFallbackChain();
  if (!chain.length) {
    throw new Error("AI provider key is not configured. Open AI Settings and connect a provider.");
  }

  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    if (options.signal?.aborted) throw new Error("AI provider call was aborted.");
    const remaining = deadline - Date.now();
    // Don't start another provider attempt once the shared time budget is spent —
    // this bounds total wall-clock to ~timeoutMs regardless of how many providers fail.
    if (i > 0 && remaining < MIN_FAILOVER_BUDGET_MS) break;
    // Fallback providers use their own default model; an explicit model only
    // applies to the primary provider it was chosen for.
    const attemptOptions = i === 0 ? options : { ...options, model: undefined };
    try {
      return await streamOnce(attemptOptions, chain[i], Math.max(remaining, MIN_FAILOVER_BUDGET_MS), onToken);
    } catch (error) {
      lastError = error;
      // An externally-requested abort is intentional — never failover past it.
      if (options.signal?.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI provider call failed across all configured providers.");
}

/**
 * Thread history → Anthropic `messages`.
 *
 * A `CopilotThreadMessage` may carry `role: "system"`. The Messages API takes the system
 * prompt as a TOP-LEVEL parameter, not a message role, so those are dropped here rather
 * than sent. (The OpenAI branch of `openAiPayload` does prepend `{ role: "system" }` — that
 * is correct for OpenAI and is a different wire format, not an inconsistency.)
 *
 * The predicate is a TYPE GUARD rather than a plain filter. `Array.prototype.filter` does
 * not narrow its element type on its own, so the `.map` below still saw
 * `"user" | "assistant" | "system"` and this function did not type-check against its own
 * declared return type. The runtime was always correct; this makes the compiler agree.
 *
 * Worth fixing rather than suppressing: `deno check` is the ONLY type gate this file has —
 * `tsconfig.json` includes `src/**` only, so `tsc --noEmit` never reads it. A module whose
 * check always fails is a module where the NEXT error is invisible.
 */
const isSendableToClaude = (
  message: CopilotThreadMessage,
): message is CopilotThreadMessage & { role: ClaudeMessage["role"] } =>
  message.role === "user" || message.role === "assistant";

export function toClaudeMessages(messages: CopilotThreadMessage[]): ClaudeMessage[] {
  return messages
    .filter(isSendableToClaude)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}
