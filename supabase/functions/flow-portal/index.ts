/**
 * flow-portal — the PUBLIC face of ATOS Flow's async evidence loop.
 *
 * Deployed with --no-verify-jwt: the audience is an external stakeholder
 * holding a response link, not an authenticated user. Access is gated by the
 * link's token (`programId.secret`) minted client-side into
 * inner.flowInterviewPacks. The blast radius is deliberately tiny:
 *   GET  ?token=…   → the pack's own fields only (programme display name,
 *                     stakeholder, intro, questions) — nothing else leaves.
 *   POST {token, answers} → size-capped plain text QUARANTINED into
 *                     inner.flowPortalInbox; it never touches evidence until
 *                     a signed-in human ingests it in the app. Attested.
 * Unknown or stale tokens 404 without confirming whether the programme exists.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const MAX_ANSWER_CHARS = 20_000;
const MIN_ANSWER_CHARS = 20;
const INBOX_CAP = 20;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Both persisted rawData shapes: {data: inner} or inner at the root. */
function innerOf(raw: Record<string, unknown>): { inner: Record<string, unknown>; nested: boolean } {
  return isRecord(raw.data)
    ? { inner: raw.data as Record<string, unknown>, nested: true }
    : { inner: raw, nested: false };
}

async function loadPack(token: string) {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const programId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{20,64}$/i.test(programId) || !/^[0-9a-f]{24,64}$/.test(secret)) return null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: row } = await admin
    .from("adam_programs")
    .select("id, name, data")
    .eq("id", programId)
    .maybeSingle();
  if (!row) return null;
  const raw = isRecord(row.data) ? row.data as Record<string, unknown> : {};
  const { inner, nested } = innerOf(raw);
  const packs = Array.isArray(inner.flowInterviewPacks) ? inner.flowInterviewPacks.filter(isRecord) : [];
  const pack = packs.find((entry) => entry.token === secret);
  if (!pack) return null;
  return { admin, programId, programName: String(row.name ?? "the programme"), raw, inner, nested, pack };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token") || "";
      const hit = await loadPack(token);
      if (!hit) return jsonResponse({ error: "This link is not valid." }, 404);
      return jsonResponse({
        programme: hit.programName,
        stakeholder: String(hit.pack.stakeholder ?? "Stakeholder"),
        role: String(hit.pack.role ?? ""),
        intro: String(hit.pack.intro ?? ""),
        questions: Array.isArray(hit.pack.questions) ? hit.pack.questions.map(String).slice(0, 12) : [],
        responded: typeof hit.pack.respondedAt === "string",
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const token = isRecord(body) && typeof body.token === "string" ? body.token : "";
      const answersRaw = isRecord(body) && typeof body.answers === "string" ? body.answers : "";
      const answers = answersRaw.trim().slice(0, MAX_ANSWER_CHARS);
      if (answers.length < MIN_ANSWER_CHARS) {
        return jsonResponse({ error: "Please write a little more — a sentence or two at minimum." }, 400);
      }
      const hit = await loadPack(token);
      if (!hit) return jsonResponse({ error: "This link is not valid." }, 404);

      const stakeholder = String(hit.pack.stakeholder ?? "Stakeholder");
      const now = new Date().toISOString();
      const inbox = Array.isArray(hit.inner.flowPortalInbox) ? [...hit.inner.flowPortalInbox] : [];
      inbox.push({
        id: crypto.randomUUID(),
        kind: "interview",
        stakeholder,
        role: String(hit.pack.role ?? ""),
        receivedAt: now,
        text: answers,
      });
      const packs = (hit.inner.flowInterviewPacks as unknown[]).map((entry) =>
        isRecord(entry) && entry.token === hit.pack.token ? { ...entry, respondedAt: now } : entry,
      );
      const log = Array.isArray(hit.inner.flowAttestations) ? [...hit.inner.flowAttestations] : [];
      log.push({
        ts: now, agentId: "portal", phaseId: "listen", tier: 1,
        action: `Received an async interview response — ${stakeholder}`,
        detail: `${answers.split(/\s+/).length.toLocaleString()} words, quarantined in the evidence inbox for your review.`,
      });

      const nextInner = {
        ...hit.inner,
        flowPortalInbox: inbox.slice(-INBOX_CAP),
        flowInterviewPacks: packs,
        flowAttestations: log.slice(-200),
      };
      const nextRaw = hit.nested ? { ...hit.raw, data: nextInner } : nextInner;
      const { error } = await hit.admin
        .from("adam_programs")
        .update({ data: nextRaw, updated_at: now })
        .eq("id", hit.programId);
      if (error) return jsonResponse({ error: "Could not record the response. Please try again." }, 500);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed." }, 405);
  } catch {
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
