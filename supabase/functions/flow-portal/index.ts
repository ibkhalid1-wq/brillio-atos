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
    .select("id, name, data, updated_at")
    .eq("id", programId)
    .maybeSingle();
  if (!row) return null;
  const raw = isRecord(row.data) ? row.data as Record<string, unknown> : {};
  const { inner, nested } = innerOf(raw);
  const packs = Array.isArray(inner.flowInterviewPacks) ? inner.flowInterviewPacks.filter(isRecord) : [];
  const invites = Array.isArray(inner.flowDemoInvites) ? inner.flowDemoInvites.filter(isRecord) : [];
  const pack = packs.find((entry) => entry.token === secret);
  const invite = pack ? undefined : invites.find((entry) => entry.token === secret);
  if (!pack && !invite) return null;
  // Tokens expire: a link forwarded months later must not still open the
  // programme. 30 days covers any realistic response window.
  const created = Date.parse(String((pack ?? invite)?.createdAt ?? ""));
  if (Number.isFinite(created) && Date.now() - created > 30 * 86_400_000) return null;
  const kind: "interview" | "demo" = pack ? "interview" : "demo";
  return {
    admin, programId, programName: String(row.name ?? "the programme"),
    raw, inner, nested, kind, pack: (pack ?? invite) as Record<string, unknown>,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

const DEMO_VERDICTS = new Set(["accepted", "accepted-with-changes", "rework"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (req.method === "GET") {
      const token = new URL(req.url).searchParams.get("token") || "";
      const hit = await loadPack(token);
      if (!hit) return jsonResponse({ error: "This link is not valid." }, 404);
      if (hit.kind === "demo") {
        const showInputs = isRecord(hit.inner.phaseInputs) && isRecord((hit.inner.phaseInputs as Record<string, unknown>).show)
          ? (hit.inner.phaseInputs as Record<string, Record<string, unknown>>).show
          : {};
        return jsonResponse({
          kind: "demo",
          programme: hit.programName,
          stakeholder: String(hit.pack.stakeholder ?? "Stakeholder"),
          role: String(hit.pack.role ?? ""),
          openingQuote: String(hit.pack.openingQuote ?? ""),
          scenario: String(hit.pack.scenario ?? ""),
          steps: Array.isArray(hit.pack.steps) ? hit.pack.steps.map(String).slice(0, 8) : [],
          acceptanceAsk: String(hit.pack.acceptanceAsk ?? ""),
          demoUrl: typeof showInputs.prototypeLocation === "string" ? showInputs.prototypeLocation : "",
          responded: typeof hit.pack.respondedAt === "string",
        });
      }
      return jsonResponse({
        kind: "interview",
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

      // Compare-and-set with reload-and-retry: a run finishing between our
      // read and write must never be clobbered by a portal submission (and
      // vice versa). Same discipline as the run-agent persist path.
      for (let attempt = 0; attempt < 3; attempt++) {
        const hit = await loadPack(token);
        if (!hit) return jsonResponse({ error: "This link is not valid." }, 404);

        const stakeholder = String(hit.pack.stakeholder ?? "Stakeholder");
        const now = new Date().toISOString();
        const inbox = Array.isArray(hit.inner.flowPortalInbox) ? [...hit.inner.flowPortalInbox] : [];
        const log = Array.isArray(hit.inner.flowAttestations) ? [...hit.inner.flowAttestations] : [];
        const nextInner: Record<string, unknown> = { ...hit.inner };

        if (hit.kind === "demo") {
          const verdict = isRecord(body) && typeof body.verdict === "string" ? body.verdict : "";
          if (!DEMO_VERDICTS.has(verdict)) {
            return jsonResponse({ error: "Pick a verdict before sending." }, 400);
          }
          const comment = isRecord(body) && typeof body.comment === "string"
            ? body.comment.trim().slice(0, MAX_ANSWER_CHARS)
            : "";
          inbox.push({
            id: crypto.randomUUID(),
            kind: "demo-verdict",
            stakeholder,
            role: String(hit.pack.role ?? ""),
            receivedAt: now,
            verdict,
            text: comment,
          });
          nextInner.flowDemoInvites = (hit.inner.flowDemoInvites as unknown[]).map((entry) =>
            isRecord(entry) && entry.token === hit.pack.token ? { ...entry, respondedAt: now } : entry,
          );
          log.push({
            ts: now, agentId: "portal", phaseId: "show", tier: 1,
            action: `Received a demo verdict — ${stakeholder}: ${verdict.replace(/-/g, " ")}`,
            detail: comment ? `"${comment.slice(0, 120)}" — quarantined for your review.` : "Quarantined for your review.",
          });
        } else {
          const answersRaw = isRecord(body) && typeof body.answers === "string" ? body.answers : "";
          const answers = answersRaw.trim().slice(0, MAX_ANSWER_CHARS);
          if (answers.length < MIN_ANSWER_CHARS) {
            return jsonResponse({ error: "Please write a little more — a sentence or two at minimum." }, 400);
          }
          inbox.push({
            id: crypto.randomUUID(),
            kind: "interview",
            stakeholder,
            role: String(hit.pack.role ?? ""),
            receivedAt: now,
            text: answers,
          });
          nextInner.flowInterviewPacks = (hit.inner.flowInterviewPacks as unknown[]).map((entry) =>
            isRecord(entry) && entry.token === hit.pack.token ? { ...entry, respondedAt: now } : entry,
          );
          log.push({
            ts: now, agentId: "portal", phaseId: "listen", tier: 1,
            action: `Received an async interview response — ${stakeholder}`,
            detail: `${answers.split(/\s+/).length.toLocaleString()} words, quarantined in the evidence inbox for your review.`,
          });
        }

        nextInner.flowPortalInbox = inbox.slice(-INBOX_CAP);
        nextInner.flowAttestations = log.slice(-200);
        const nextRaw = hit.nested ? { ...hit.raw, data: nextInner } : nextInner;
        let update = hit.admin
          .from("adam_programs")
          .update({ data: nextRaw, updated_at: now })
          .eq("id", hit.programId);
        update = hit.updatedAt ? update.eq("updated_at", hit.updatedAt) : update.is("updated_at", null);
        const { data: updatedRows, error } = await update.select("id");
        if (error) return jsonResponse({ error: "Could not record the response. Please try again." }, 500);
        if (updatedRows && updatedRows.length > 0) {
          // Freshness push: the app listens on this channel and refreshes the
          // blob immediately instead of waiting for its poll cycle.
          try {
            await hit.admin.channel(`program-${hit.programId}-agents`).send({
              type: "broadcast",
              event: "program_data_changed",
              payload: { source: "flow-portal", kind: hit.kind, at: now },
            });
          } catch { /* best effort — the poll still catches it */ }
          return jsonResponse({ ok: true });
        }
        // CAS miss — another writer landed in between; reload and retry.
      }
      return jsonResponse({ error: "The programme is busy right now — please try again." }, 409);
    }

    return jsonResponse({ error: "Method not allowed." }, 405);
  } catch {
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
