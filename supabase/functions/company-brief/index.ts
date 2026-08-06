/**
 * company-brief — drafts a web-grounded brief of what a company does, for the
 * operator to CONFIRM OR OVERRIDE before it lands in phaseInputs.frame
 * .companyBrief. The function only ever returns a draft; the operator's save
 * is the write, so the record keeps its evidence-first discipline: nothing
 * enters grounding without a human putting it there.
 *
 * Provider-aware: Anthropic (messages + web_search_20250305) when an
 * anthropic key exists, else OpenAI (responses + web_search) — the shared
 * claudeClient is provider-generic and has no tool support, so the calls are
 * made directly here.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/** Both Anthropic (messages + web_search_20250305) and OpenAI (responses +
 * web_search) can ground the brief. Resolve whichever key exists — env first,
 * then adam_ai_provider_settings rows, anthropic preferred. */
async function searchProvider(): Promise<{ provider: "anthropic" | "openai"; key: string; model: string } | null> {
  const envAnthropic = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (envAnthropic) return { provider: "anthropic", key: envAnthropic, model: "claude-sonnet-4-6" };
  const envOpenAi = Deno.env.get("OPENAI_API_KEY") || "";
  if (envOpenAi) return { provider: "openai", key: envOpenAi, model: "gpt-4.1" };
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/adam_ai_provider_settings?select=provider,api_key,model,is_active,updated_at&order=is_active.desc,updated_at.desc`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []) as Array<{ provider?: string; api_key?: string; model?: string }>;
  const byProvider = (name: string) => rows.find((row) =>
    (row.provider || "").trim().toLowerCase() === name && row.api_key);
  const anthropic = byProvider("anthropic");
  if (anthropic?.api_key) return { provider: "anthropic", key: anthropic.api_key, model: "claude-sonnet-4-6" };
  const openai = byProvider("openai");
  if (openai?.api_key) return { provider: "openai", key: openai.api_key, model: "gpt-4.1" };
  return null;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function authenticate(req: Request): Promise<void> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Missing Bearer token.");
  const token = authHeader.slice("Bearer ".length).trim();
  if (token === SUPABASE_SERVICE_ROLE_KEY) return;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error(error?.message || "Authentication failed.");
}

interface ContentBlock {
  type: string;
  text?: string;
  citations?: Array<{ type?: string; url?: string; title?: string }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);
  try {
    await authenticate(req);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unauthorized" }, 401);
  }
  const settings = await searchProvider();
  if (!settings) {
    return jsonResponse({ error: "No web-search-capable AI provider configured. Open AI Settings and connect Anthropic or OpenAI." }, 500);
  }

  let company = "", industry = "", hint = "";
  try {
    const body = await req.json();
    company = typeof body.company === "string" ? body.company.trim() : "";
    industry = typeof body.industry === "string" ? body.industry.trim() : "";
    hint = typeof body.hint === "string" ? body.hint.trim() : "";
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  if (!company) return jsonResponse({ error: "company is required." }, 400);

  const user = [
    `Company: ${company}`,
    industry ? `Industry: ${industry}` : "",
    hint ? `Disambiguation hint from the operator: ${hint}` : "",
  ].filter(Boolean).join("\n");
  const system = [
    "You write a COMPANY BRIEF for a transformation programme's grounding record.",
    "Search the web for the company, then write 150-250 words of plain prose covering: what the company does, its market and customers, main products/services, rough scale (revenue/headcount/geography when stated by a source), and anything structurally notable (business model, recent strategic shifts).",
    "FACTS ONLY, each traceable to a page you actually read — no speculation, no marketing gloss. If the name is ambiguous and the industry hint does not settle it, say so in one line and brief the most likely match.",
    "End with a 'Sources:' section listing the URLs you relied on, one per line.",
    "Return ONLY the brief text — no preamble, no headings other than Sources.",
  ].join("\n");

  try {
    const brief = settings.provider === "anthropic"
      ? await anthropicBrief(settings.key, settings.model, system, user)
      : await openAiBrief(settings.key, settings.model, system, user);
    return jsonResponse({ brief });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
});

/** Provenance always travels with the text, even when the model skips the
 * Sources section it was asked for. */
function withSources(text: string, cited: string[]): string {
  return /sources:/i.test(text) || !cited.length ? text : `${text}\n\nSources:\n${cited.join("\n")}`;
}

async function anthropicBrief(key: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 1400,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const payload = await res.json();
  const blocks: ContentBlock[] = Array.isArray(payload.content) ? payload.content : [];
  const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string).join("").trim();
  if (!text) throw new Error("The model returned no brief.");
  const cited = [...new Set(blocks.flatMap((b) => (b.citations ?? [])
    .map((c) => c.url).filter((u): u is string => !!u)))];
  return withSources(text, cited);
}

async function openAiBrief(key: string, model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }],
      instructions: system,
      input: user,
      max_output_tokens: 1400,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const payload = await res.json();
  const items = Array.isArray(payload.output) ? payload.output : [];
  let text = "";
  const cited = new Set<string>();
  for (const item of items) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        text += part.text;
        for (const note of part.annotations ?? []) {
          if (note?.type === "url_citation" && typeof note.url === "string") cited.add(note.url);
        }
      }
    }
  }
  text = text.trim();
  if (!text) throw new Error("The model returned no brief.");
  return withSources(text, [...cited]);
}
