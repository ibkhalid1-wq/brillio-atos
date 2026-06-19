import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { defaultModelForProvider, isAIProvider } from "../_shared/modelCatalog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Provider membership is the only allowlist we keep — models are NOT allowlisted.
// A model the catalog hasn't seen yet still saves and runs (provider-default
// capabilities), so a newer model never requires a code change here.
const RUNTIME_READY_PROVIDERS = new Set(["anthropic", "openai", "google"]);
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: defaultModelForProvider("anthropic"),
  openai: defaultModelForProvider("openai"),
  google: defaultModelForProvider("google"),
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Cloud settings backend is not configured." }, 500);
  }

  const authHeader = request.headers.get("Authorization") || "";
  const apiKeyHeader = request.headers.get("apikey") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Verify the request is from a trusted Supabase client.
  // Priority: valid user JWT → anon key from same project → reject.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let userId: string | null = null;

  if (token && token !== SUPABASE_ANON_KEY) {
    // Try to resolve a user session from the bearer token
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (!userError && userData.user) {
      userId = userData.user.id;
    }
    // If the token isn't the anon key AND didn't resolve a user, reject
    if (!userId && apiKeyHeader !== SUPABASE_ANON_KEY && token !== SUPABASE_ANON_KEY) {
      return json({ error: "Your session could not be verified." }, 401);
    }
  } else if (token === SUPABASE_ANON_KEY || apiKeyHeader === SUPABASE_ANON_KEY) {
    // Request from the app client without a user session — allow (single-tenant deployment)
    userId = null;
  } else {
    return json({ error: "Sign in is required to update AI settings." }, 401);
  }

  const payload = await request.json().catch(() => ({})) as {
    provider?: string;
    apiKey?: string;
    model?: string;
    action?: "status" | "save" | "pause" | "resume";
  };
  const provider = (payload.provider || "anthropic").trim().toLowerCase();
  if (!isAIProvider(provider)) {
    return json({ error: "Unsupported AI provider." }, 400);
  }

  if (payload.action === "status") {
    const { data, error } = await admin
      .from("adam_ai_provider_settings")
      .select("provider, model, updated_at, is_active")
      .eq("provider", provider)
      .maybeSingle();

    if (error) {
      return json({ error: error.message }, 500);
    }

    return json({
      provider,
      model: data?.model ?? DEFAULT_MODELS[provider],
      configured: Boolean(data),
      updatedAt: data?.updated_at ?? null,
      active: Boolean(data?.is_active),
      runtimeReady: RUNTIME_READY_PROVIDERS.has(provider),
    });
  }

  // ── Pause: set is_active = false without touching the key ──
  if (payload.action === "pause") {
    const { data: existing } = await admin
      .from("adam_ai_provider_settings")
      .select("provider, model, is_active")
      .eq("provider", provider)
      .maybeSingle();

    if (!existing) {
      return json({ error: "No saved settings found for this provider." }, 404);
    }

    const { error: pauseError } = await admin
      .from("adam_ai_provider_settings")
      .update({ is_active: false })
      .eq("provider", provider);

    if (pauseError) return json({ error: pauseError.message }, 500);

    return json({ provider, paused: true, active: false, configured: true });
  }

  // ── Resume: set is_active = true, deactivate others ──
  if (payload.action === "resume") {
    const { data: existing } = await admin
      .from("adam_ai_provider_settings")
      .select("provider, model, api_key, is_active")
      .eq("provider", provider)
      .maybeSingle();

    if (!existing?.api_key) {
      return json({ error: "No API key saved for this provider. Configure it first." }, 400);
    }

    // Deactivate all others
    await admin
      .from("adam_ai_provider_settings")
      .update({ is_active: false })
      .neq("provider", provider);

    const { error: resumeError } = await admin
      .from("adam_ai_provider_settings")
      .update({ is_active: true })
      .eq("provider", provider);

    if (resumeError) return json({ error: resumeError.message }, 500);

    return json({ provider, paused: false, active: true, configured: true, model: existing.model });
  }

  if (!RUNTIME_READY_PROVIDERS.has(provider)) {
    return json({
      error: "This AI provider is not connected to the ATOS agent runtime yet. Select Anthropic for live agent runs.",
      provider,
      runtimeReady: false,
    }, 400);
  }

  // No model allowlist: accept any non-empty model id and fall back to the
  // provider default when none is supplied. Unknown ids run on provider-default
  // capabilities, so newer models work without a code change.
  const requestedModel = (payload.model || DEFAULT_MODELS[provider] || "").trim();
  if (!requestedModel) {
    return json({ error: "Enter a model id for this provider." }, 400);
  }

  const providedApiKey = (payload.apiKey || "").trim();
  let apiKey = providedApiKey;
  if (!apiKey) {
    const { data: existing, error: existingError } = await admin
      .from("adam_ai_provider_settings")
      .select("api_key")
      .eq("provider", provider)
      .maybeSingle();

    if (existingError) {
      return json({ error: existingError.message }, 500);
    }
    apiKey = existing?.api_key || "";
  }

  if (!apiKey) {
    return json({ error: "Enter an API key before saving this provider." }, 400);
  }

  // No provider-specific key-prefix validation: prefixes change over time and a
  // wrong-but-well-formed key fails fast at call time anyway. We only require a
  // non-empty key (checked above) — the provider is the authority on validity.

  const { error: deactivateError } = await admin
    .from("adam_ai_provider_settings")
    .update({ is_active: false })
    .neq("provider", provider);

  if (deactivateError) {
    return json({ error: deactivateError.message }, 500);
  }

  const upsertPayload: Record<string, unknown> = {
    provider,
    model: requestedModel,
    api_key: apiKey,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  if (userId) upsertPayload.configured_by = userId;

  const { error } = await admin
    .from("adam_ai_provider_settings")
    .upsert(upsertPayload, { onConflict: "provider" });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({
    provider,
    model: requestedModel,
    configured: true,
    active: true,
    updatedAt: new Date().toISOString(),
    runtimeReady: true,
  });
});
