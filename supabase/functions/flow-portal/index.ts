/**
 * flow-portal — the PUBLIC face of AURA Flow's async evidence loop.
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
import { stripUnnamedSuffix } from "../_shared/unnamedSuffix.ts";
import { extractDocumentText, extractRelevant } from "../_shared/extractText.ts";
import { completeClaudeText } from "../_shared/claudeClient.ts";
// THE STAKEHOLDER'S PROTOTYPE. `pilotSliceFor` assembles it deterministically from
// the committed ontology + atlas via the SAME `assemblePrototype` the operator's
// studio renders — not a Deno copy of it. `_shared` is importable from both runtimes
// (Deno by relative path, Vite/vitest via the `@shared` alias), which is why the
// assembly cluster lives there and nowhere else. The stored, model-authored
// `prototypeBuild.html` stays operator-only; see the module's own doc comment.
import { pilotSliceFor, type PilotSlice } from "../_shared/prototypePilot.ts";

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

// ── Design grounding (portal Q&A) ────────────────────────────────────────────
// When a stakeholder asks a DESIGN question on their link, we answer it grounded
// in the Experience Design + the discovery evidence (who said what, when), and
// cite the evidence as [E#]. Built here (not the client) because the linked page
// only holds its own pack, never the full programme blob.
interface PortalEvidence { id: string; who: string; when: string; quote: string; }

const clipText = (s: string, n: number): string => { const t = s.trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/** A prose summary of the Experience Design the question is likely about. */
function designSummaryFor(inner: Record<string, unknown>): string {
  const ed = isRecord(inner.experienceDesign) ? inner.experienceDesign : null;
  if (!ed) return "";
  const parts: string[] = [];
  const intent = isRecord(ed.designIntent) ? ed.designIntent : {};
  if (typeof intent.personality === "string" && intent.personality.trim()) parts.push(`Design intent: ${clipText(intent.personality, 220)}`);
  const screens = Array.isArray(ed.screens) ? ed.screens.filter(isRecord) : [];
  if (screens.length) {
    parts.push(`Screens: ${screens.slice(0, 12).map((s) => `${String(s.name ?? "").trim()}${typeof s.purpose === "string" && s.purpose.trim() ? ` — ${clipText(s.purpose, 90)}` : ""}`).filter((l) => l.trim()).join("; ")}`);
  }
  const flows = Array.isArray(ed.flows) ? ed.flows.filter(isRecord) : [];
  const pains = flows.map((f) => {
    const p = isRecord(f.painAnswered) ? f.painAnswered : {};
    return typeof p.quote === "string" && p.quote.trim() ? `${String(f.name ?? "").trim()} answers "${clipText(p.quote, 120)}"${typeof p.who === "string" && p.who.trim() ? ` — ${p.who}` : ""}` : "";
  }).filter(Boolean);
  if (pains.length) parts.push(`Flows and the pain each dissolves: ${pains.slice(0, 8).join("; ")}`);
  return parts.join("\n");
}

/** Speaker-attributed excerpts from the Frame + Listen transcripts. Mirrors the
 * client's transcript convention: blocks headed by "— Name, Role, Date —". */
function extractPortalEvidence(inner: Record<string, unknown>): PortalEvidence[] {
  const pi = isRecord(inner.phaseInputs) ? inner.phaseInputs : {};
  const frame = isRecord(pi.frame) ? pi.frame : {};
  const listen = isRecord(pi.listen) ? pi.listen : {};
  const sources = [listen.interviewTranscripts, frame.sponsorConversation, listen.sponsorConversation, frame.interviewTranscripts]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  const out: PortalEvidence[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    // Split on speaker header lines, capturing the header text between the dashes.
    const parts = src.split(/^\s*—\s*(.+?)\s*—\s*$/m);
    for (let i = 1; i < parts.length; i += 2) {
      const header = (parts[i] || "").trim();
      const body = (parts[i + 1] || "").trim();
      if (!header || body.length < 20) continue;
      const dateM = header.match(/(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/);
      const when = dateM ? dateM[1] : "";
      const who = header.replace(/,?\s*\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?\s*$/, "").trim() || header;
      const quote = clipText(body.replace(/\s+/g, " "), 240);
      const key = `${who}|${quote.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `E${out.length + 1}`, who, when, quote });
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }
  return out;
}

/** The evidence whose [E#] tag appears in the answer, first-mention order. */
function citedEvidence(answer: string, evidence: PortalEvidence[]): PortalEvidence[] {
  const cited: PortalEvidence[] = [];
  const seen = new Set<string>();
  const re = /\[(E\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (seen.has(m[1])) continue;
    const hit = evidence.find((e) => e.id === m[1]);
    if (hit) { seen.add(m[1]); cited.push(hit); }
  }
  return cited;
}

/** Parse a model reply that should be {"topic","answer"} JSON, tolerating fences. */
function parseTriage(text: string): { topic: string; answer: string } {
  const raw = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      return { topic: String(o.topic ?? "").toLowerCase(), answer: typeof o.answer === "string" ? o.answer : "" };
    } catch { /* fall through */ }
  }
  return { topic: "", answer: "" };
}

/** Optional heads-up ping (Slack-compatible webhook). Fire-and-forget:
 * a missing SLACK_WEBHOOK_URL or a failed post never blocks the loop. */
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";
function notifyWebhook(text: string): void {
  if (!SLACK_WEBHOOK_URL) return;
  fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => { /* best effort */ });
}

/** Both persisted rawData shapes: {data: inner} or inner at the root. */
function innerOf(raw: Record<string, unknown>): { inner: Record<string, unknown>; nested: boolean } {
  return isRecord(raw.data)
    ? { inner: raw.data as Record<string, unknown>, nested: true }
    : { inner: raw, nested: false };
}

// Distinct, honest failure reasons — the old code collapsed every one of these
// into a single "This link is not valid.", which made the common case (a fresh
// programme whose links never reached the cloud) indistinguishable from a typo
// or an expired link. Each caller returns `reason` when present.
const MALFORMED = "This link is malformed — check it was copied in full.";
const NO_PROGRAMME = "We couldn't find this programme. If it was just created, its links may not have finished saving to the cloud yet — reopen the programme and re-mint the link.";
const NO_LINK = "This link isn't recognised for this programme — it may have been replaced by a newer one. Ask for a fresh link.";
const EXPIRED = "This link has expired. Ask for a fresh one.";

async function loadPack(token: string): Promise<{ reason: string } | {
  admin: ReturnType<typeof createClient>; programId: string; programName: string;
  raw: Record<string, unknown>; inner: Record<string, unknown>; nested: boolean;
  kind: "interview" | "demo" | "approval"; pack: Record<string, unknown>; updatedAt: string | null;
}> {
  const dot = token.indexOf(".");
  if (dot <= 0) return { reason: MALFORMED };
  const programId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{20,64}$/i.test(programId) || !/^[0-9a-f]{24,64}$/.test(secret)) return { reason: MALFORMED };

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: row } = await admin
    .from("adam_programs")
    .select("id, name, data, updated_at")
    .eq("id", programId)
    .maybeSingle();
  if (!row) return { reason: NO_PROGRAMME };
  const raw = isRecord(row.data) ? row.data as Record<string, unknown> : {};
  const { inner, nested } = innerOf(raw);
  const packs = Array.isArray(inner.flowInterviewPacks) ? inner.flowInterviewPacks.filter(isRecord) : [];
  const invites = Array.isArray(inner.flowDemoInvites) ? inner.flowDemoInvites.filter(isRecord) : [];
  const approvals = Array.isArray(inner.flowApprovalPacks) ? inner.flowApprovalPacks.filter(isRecord) : [];
  const pack = packs.find((entry) => entry.token === secret);
  const invite = pack ? undefined : invites.find((entry) => entry.token === secret);
  const approval = (pack || invite) ? undefined : approvals.find((entry) => entry.token === secret);
  if (!pack && !invite && !approval) return { reason: NO_LINK };
  const kind: "interview" | "demo" | "approval" = pack ? "interview" : invite ? "demo" : "approval";
  // Interview packs are the DURABLE per-stakeholder link — one stable token that
  // carries every ask across movements and shows the person their own recap, so
  // it must never expire. Demo/approval links are one-shot and still age out
  // after 30 days so a stale forwarded link can't reopen the programme.
  if (kind !== "interview") {
    const created = Date.parse(String((invite ?? approval)?.createdAt ?? ""));
    if (Number.isFinite(created) && Date.now() - created > 30 * 86_400_000) return { reason: EXPIRED };
  }
  return {
    admin, programId, programName: String(row.name ?? "the programme"),
    raw, inner, nested, kind, pack: (pack ?? invite ?? approval) as Record<string, unknown>,
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
      // Sponsor briefs: a dated, read-only snapshot of the board pack. The
      // token gates it exactly like response links; nothing else leaves.
      const briefToken = new URL(req.url).searchParams.get("brief") || "";
      if (briefToken) {
        const dot = briefToken.indexOf(".");
        const programId = dot > 0 ? briefToken.slice(0, dot) : "";
        const secret = dot > 0 ? briefToken.slice(dot + 1) : "";
        if (!programId || !secret) return jsonResponse({ error: "This link is not valid." }, 404);
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: row } = await admin
          .from("adam_programs")
          .select("id, name, data")
          .eq("id", programId)
          .maybeSingle();
        if (!row) return jsonResponse({ error: "This link is not valid." }, 404);
        const { inner } = innerOf(isRecord(row.data) ? row.data as Record<string, unknown> : {});
        const briefs = Array.isArray(inner.flowBriefs) ? inner.flowBriefs.filter(isRecord) : [];
        const brief = briefs.find((entry) => entry.token === secret);
        if (!brief || !isRecord(brief.snapshot)) return jsonResponse({ error: "This link is not valid." }, 404);
        // Briefs age out like response links — a quarter is plenty.
        const created = Date.parse(String(brief.createdAt ?? ""));
        if (Number.isFinite(created) && Date.now() - created > 90 * 86_400_000) {
          return jsonResponse({ error: "This link is not valid." }, 404);
        }
        return jsonResponse({ kind: "brief", programme: String(row.name ?? ""), createdAt: String(brief.createdAt ?? ""), snapshot: brief.snapshot });
      }
      const token = new URL(req.url).searchParams.get("token") || "";
      const hit = await loadPack(token);
      if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
      if (hit.kind === "approval") {
        // `responded` guards against an empty-string stamp reading as answered;
        // the recorded verdict + date ride along so a re-opened link can SAY
        // what was recorded instead of a bare "done its job".
        const respondedAt = typeof hit.pack.respondedAt === "string" && hit.pack.respondedAt ? hit.pack.respondedAt : "";
        return jsonResponse({
          kind: "approval",
          programme: hit.programName,
          artifactTitle: String(hit.pack.artifactTitle ?? "document"),
          movement: String(hit.pack.movementId ?? ""),
          approver: isRecord(hit.pack.approver)
            ? { name: String((hit.pack.approver as Record<string, unknown>).name ?? ""), role: String((hit.pack.approver as Record<string, unknown>).role ?? "") }
            : { name: "", role: "" },
          snapshot: String(hit.pack.snapshot ?? ""),
          responded: Boolean(respondedAt),
          verdict: hit.pack.verdict === "approved" ? "approved" : hit.pack.verdict === "changes" ? "changes" : "",
          respondedAt,
        });
      }
      // The INTERPRETIVE PROTOTYPE slice: when an Experience Design exists,
      // links that show the prototype carry its flows + the screens they
      // reference — capped and stripped, nothing else leaves. Rides demo
      // invites AND Show-movement interview links (a Show follow-up asks for
      // demo feedback; walking the wireframes belongs beside the questions).
      const designSlice = (): Record<string, unknown> | undefined => {
        const xd = hit.inner.experienceDesign;
        if (!isRecord(xd) || !Array.isArray(xd.screens) || !Array.isArray(xd.flows)) return undefined;
        // PERSONA-FIRST: the holder of this link lands on THEIR flow — flows
        // whose persona matches the pack's stakeholder/role sort ahead, so
        // the walker opens on their own workflow. Follow-up packs carry the
        // role "Follow-up", so the REAL role is resolved from the kit roster.
        let holderRole = String(hit.pack.role ?? "");
        if (!holderRole || /follow-?up/i.test(holderRole)) {
          const kitDoc = isRecord(hit.inner.discoveryKit) ? hit.inner.discoveryKit as Record<string, unknown> : null;
          const holderKey = String(hit.pack.stakeholder ?? "").trim().toLowerCase();
          const rosterHit = (kitDoc && Array.isArray(kitDoc.interviews) ? kitDoc.interviews : []).filter(isRecord)
            .find((interview) => String(interview.stakeholder ?? "").trim().toLowerCase() === holderKey);
          if (rosterHit) holderRole = String(rosterHit.role ?? "");
        }
        const who = `${String(hit.pack.stakeholder ?? "")} ${holderRole}`.toLowerCase();
        const affinity = (flow: Record<string, unknown>): number => {
          const persona = String(flow.persona ?? "").trim().toLowerCase();
          if (persona && (who.includes(persona) || persona.split(/\s+/).some((token) => token.length > 3 && who.includes(token)))) return 0;
          return 1;
        };
        const flows = (xd.flows as unknown[]).filter(isRecord)
          .map((flow, index) => ({ flow, index }))
          .sort((a, b) => affinity(a.flow) - affinity(b.flow) || a.index - b.index)
          .map((entry) => entry.flow)
          .slice(0, 6);
        const wanted = new Set(flows.flatMap((flow) =>
          (Array.isArray(flow.steps) ? flow.steps : []).filter(isRecord).map((step) => String(step.screen ?? "").toLowerCase())));
        const screens = (xd.screens as unknown[]).filter(isRecord)
          .filter((screen) => wanted.has(String(screen.id ?? "").toLowerCase()) || wanted.has(String(screen.name ?? "").toLowerCase()))
          .slice(0, 12);
        return flows.length && screens.length ? { flows, screens } : undefined;
      };
      // The FUNCTIONAL demo slice: the state machines the scenario runner
      // executes, the prototype pack's seeded fixtures (their records, their
      // field names) that populate the screens, THEIR seed scenario, and the
      // operator's live-agent opt-in. Everything capped and stripped.
      const runSlice = (): Record<string, unknown> => {
        const xd = hit.inner.experienceDesign;
        const machines = isRecord(xd) && Array.isArray((xd as Record<string, unknown>).workflowMachines)
          ? ((xd as Record<string, unknown>).workflowMachines as unknown[]).filter(isRecord).slice(0, 6)
          : [];
        const proto = hit.inner.prototypePack;
        const fixtures = isRecord(proto) && Array.isArray((proto as Record<string, unknown>).fixtures)
          ? ((proto as Record<string, unknown>).fixtures as unknown[]).filter(isRecord).slice(0, 12)
          : [];
        const scenarios = isRecord(proto) && Array.isArray((proto as Record<string, unknown>).seedScenarios)
          ? ((proto as Record<string, unknown>).seedScenarios as unknown[]).filter(isRecord)
          : [];
        const holderKey = String(hit.pack.stakeholder ?? "").trim().toLowerCase();
        const scenario = scenarios.find((s) => {
          const name = String(s.stakeholder ?? "").trim().toLowerCase();
          return name && (name === holderKey || name.split(/\s+/)[0] === holderKey.split(/\s+/)[0]);
        });
        const showBucket = isRecord(hit.inner.phaseInputs) && isRecord((hit.inner.phaseInputs as Record<string, unknown>).show)
          ? (hit.inner.phaseInputs as Record<string, Record<string, unknown>>).show
          : {};
        return {
          ...(machines.length ? { machines } : {}),
          ...(fixtures.length ? { fixtures } : {}),
          ...(scenario ? { seedScenario: {
            scenario: String(scenario.scenario ?? "").slice(0, 400),
            sourceQuote: String(scenario.sourceQuote ?? "").slice(0, 300),
            ...(typeof scenario.data === "string" ? { data: scenario.data.slice(0, 400) } : {}),
          } } : {}),
          ...(showBucket._liveDemoAgents === "on" ? { liveDemo: true } : {}),
        };
      };
      // THEIR demo script narrates the walk: opening quote, scenario, the
      // per-beat talk track and callbacks, and the closing acceptance ask.
      const scriptSlice = (): Record<string, unknown> | undefined => {
        const doc = hit.inner.demoScripts;
        if (!isRecord(doc) || !Array.isArray(doc.scripts)) return undefined;
        const key = String(hit.pack.stakeholder ?? "").trim().toLowerCase();
        const script = (doc.scripts as unknown[]).filter(isRecord).find((entry) => {
          const name = String(entry.stakeholder ?? "").trim().toLowerCase();
          return name && (name === key || name.split(/\s+/)[0] === key.split(/\s+/)[0]);
        });
        if (!script) return undefined;
        return {
          openingQuote: String(script.openingQuote ?? "").slice(0, 300),
          scenario: String(script.scenario ?? "").slice(0, 400),
          acceptanceAsk: String(script.acceptanceAsk ?? "").slice(0, 300),
          steps: (Array.isArray(script.steps) ? script.steps : []).filter(isRecord).slice(0, 10).map((step) => ({
            beat: String(step.beat ?? "").slice(0, 200),
            say: String(step.say ?? "").slice(0, 300),
            callback: String(step.callback ?? "").slice(0, 200),
          })),
        };
      };
      // The recipient's business AREA — lets the walker default to their own
      // area's flow and name it ("This demo covers your area — X"), the Show
      // parallel to Listen's area-scoped reviews. Prefer the value stamped on the
      // invite; fall back to the matched demo script's area (Show follow-up packs
      // carry no invite). Empty/General → no scoping (a graceful no-op).
      const recipientAreaSlice = (): string => {
        const stamped = String(hit.pack.recipientArea ?? "").trim();
        if (stamped) return stamped;
        const doc = hit.inner.demoScripts;
        if (!isRecord(doc) || !Array.isArray(doc.scripts)) return "";
        const key = String(hit.pack.stakeholder ?? "").trim().toLowerCase();
        const script = (doc.scripts as unknown[]).filter(isRecord).find((entry) => {
          const name = String(entry.stakeholder ?? "").trim().toLowerCase();
          return name && (name === key || name.split(/\s+/)[0] === key.split(/\s+/)[0]);
        });
        const area = script ? String(script.area ?? "").trim() : "";
        return area && area !== "General" ? area : "";
      };
      // The prototype the pilot validates is EITHER an external build (a linked
      // URL) OR the in-app one — never both. When an external URL is set it wins:
      // send it as demoUrl and SUPPRESS the internal pilot entirely (no html, and
      // no gap either — nothing is missing, the build simply lives elsewhere), so
      // the linked page shows "Open the prototype" pointing at the external build
      // (which commonly can't be iframed) instead of the internal one.
      const showPhaseInputs = isRecord(hit.inner.phaseInputs) && isRecord((hit.inner.phaseInputs as Record<string, unknown>).show)
        ? (hit.inner.phaseInputs as Record<string, Record<string, unknown>>).show
        : {};
      const externalProtoUrl = typeof showPhaseInputs.prototypeLocation === "string" ? showPhaseInputs.prototypeLocation.trim() : "";
      const pilot: PilotSlice = externalProtoUrl ? {} : pilotSliceFor(hit.inner);
      if (hit.kind === "demo") {
        const showInputs = showPhaseInputs;
        const design = designSlice();
        const script = scriptSlice();
        const recipientArea = recipientAreaSlice();
        // The ASSEMBLED prototype (deterministic, derived from the record) is the
        // pilot the stakeholder validates — closest to production. When present it
        // renders as the whole experience; the interpreted walk is the fallback,
        // and `pilotGap` explains any absence. An external build (linked URL)
        // takes over: `pilot` is empty then, so the page shows the demoUrl.
        return jsonResponse({
          ...(design ? { design } : {}),
          ...(script ? { script } : {}),
          ...(design ? runSlice() : {}),
          ...(recipientArea ? { recipientArea } : {}),
          ...pilot,
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
      // The programme's cast rides along so the respondent can DEFER a
      // question to the right person ("not me — ask our Partner Ops lead").
      const kitRecord = isRecord(hit.inner.discoveryKit) ? hit.inner.discoveryKit as Record<string, unknown> : null;
      const selfKey = String(hit.pack.stakeholder ?? "").trim().toLowerCase();
      const roster = (kitRecord && Array.isArray(kitRecord.interviews) ? kitRecord.interviews : [])
        .filter(isRecord)
        .map((interview) => ({
          name: stripUnnamedSuffix(String(interview.stakeholder ?? "")),
          role: String(interview.role ?? "").trim(),
        }))
        .filter((person) => person.name && person.name.toLowerCase() !== selfKey)
        .slice(0, 24);
      // Show links carry the walkthrough as the DEMO; Envision links carry it
      // as the STORYBOARD ("what we intend to build") beside the transformation
      // The design/storyboard + demo run slice ships on SHOW packs only — that
      // is where clients watch the built prototype run and validate it. Envision
      // is the delivery team's build studio; its links are internal working
      // links, not client demo pages.
      const isShowPack = String(hit.pack.movementId ?? "") === "show";
      const wantsDesign = isShowPack;
      const interviewDesign = wantsDesign ? designSlice() : undefined;
      const interviewScript = wantsDesign ? scriptSlice() : undefined;
      const interviewArea = isShowPack ? recipientAreaSlice() : "";
      // DYNAMIC LINKS: a review pack also ships the CURRENT artifact slices so the
      // respond page rebuilds the review LIVE from the latest record — a later
      // regeneration never orphans the link. The frozen `review` stays only as a
      // fallback for very old packs. Slices are the review-relevant docs (the
      // reviewer sees them anyway), keeping the blast radius the same in spirit.
      const isReviewPack = String(hit.pack.role ?? "").startsWith("review:");
      // Old interview packs predate movementId storage. On this path hit.kind is
      // always "interview", so a plain (non-review) pack IS a Listen discovery
      // pack by construction — default it to "listen" when unstamped. If the guess
      // is ever wrong, client re-projection fails gracefully and the plain
      // questions render (and the pack's own questions survive into any review).
      const packMovementId = String(hit.pack.movementId ?? "").trim()
        || (isReviewPack ? "" : "listen");
      const isListenPack = packMovementId === "listen";
      // Listen packs — even plain QUESTION packs — ship the live atlas + ontology
      // so the respond page rebuilds the SAME visual review a review pack gets:
      // every Listen stakeholder validates their area's terms + workflows first,
      // then answers. If their area has no model yet, the client falls back to the
      // plain questions. Architecture/blueprint stay review-only (Envision docs).
      const shipLive = isReviewPack || isListenPack;
      const liveArtifacts = shipLive ? {
        currentStateAtlas: isRecord(hit.inner.currentStateAtlas) ? hit.inner.currentStateAtlas : null,
        domainOntology: isRecord(hit.inner.domainOntology) ? hit.inner.domainOntology : null,
        architectureStrategy: isReviewPack && isRecord(hit.inner.architectureStrategy) ? hit.inner.architectureStrategy : null,
        agenticBlueprint: isReviewPack && isRecord(hit.inner.agenticBlueprint) ? hit.inner.agenticBlueprint : null,
      } : undefined;
      // A plain-language programme objective for the stakeholder — the charter's
      // business objective (client-appropriate: the goal, not the internal plan).
      const charterDoc = isRecord(hit.inner.transformationCharter) ? hit.inner.transformationCharter : {};
      const objective = [
        charterDoc.businessObjective,
        charterDoc.mandate,
        Array.isArray(charterDoc.objectives) ? charterDoc.objectives[0] : "",
      ].map((v) => String(v ?? "").trim()).find(Boolean)?.slice(0, 320) ?? "";
      // The recipient's REAL role (from the kit roster, self included) — lets the
      // client compute their primary AREA from the live artifacts and scope the
      // workflows/ontology/questions to it, even for packs with no stored area.
      const recipientRole = shipLive
        ? ((kitRecord && Array.isArray(kitRecord.interviews) ? kitRecord.interviews : [])
            .filter(isRecord)
            .map((iv) => ({
              name: stripUnnamedSuffix(String(iv.stakeholder ?? "")).toLowerCase(),
              role: String(iv.role ?? "").trim(),
            }))
            .find((p) => p.name && (p.name === selfKey || p.name.split(/\s+/)[0] === selfKey.split(/\s+/)[0]))?.role ?? "")
        : "";
      // Durable-link recap: every response this link has taken, plus whether the
      // current ask post-dates the last answer (a real follow-up to respond to).
      const rawSubs = (Array.isArray(hit.pack.submissions) ? hit.pack.submissions : [])
        .filter(isRecord)
        .map((s) => ({
          ts: String(s.ts ?? ""), movementId: typeof s.movementId === "string" ? s.movementId : undefined,
          kind: String(s.kind ?? "interview"), preview: String(s.preview ?? "").slice(0, 240),
        }))
        .filter((s) => s.ts);
      // Legacy links answered before submission history existed carry only a bare
      // respondedAt — fold it in so they show a recap, not a re-openable form.
      if (!rawSubs.length && typeof hit.pack.respondedAt === "string" && hit.pack.respondedAt) {
        rawSubs.push({ ts: hit.pack.respondedAt, movementId: typeof hit.pack.movementId === "string" ? hit.pack.movementId : undefined,
          kind: String(hit.pack.role ?? "").startsWith("review:") ? "review" : hit.pack.role === "Follow-up" ? "follow-up" : "interview", preview: "" });
      }
      const interviewSubmissions = rawSubs.slice(-40);
      const lastSubTs = interviewSubmissions.reduce((max, s) => (s.ts > max ? s.ts : max), "");
      const askUpdatedAt = String(hit.pack.askUpdatedAt ?? hit.pack.createdAt ?? "");
      const interviewFollowUp = interviewSubmissions.length > 0 && (!lastSubTs || askUpdatedAt > lastSubTs);
      return jsonResponse({
        kind: "interview",
        programme: hit.programName,
        stakeholder: String(hit.pack.stakeholder ?? "Stakeholder"),
        // A role-placeholder link (no person bound to the role yet) must never
        // greet the role title as a first name — the client skips the greeting.
        ...(hit.pack.unnamed === true ? { unnamed: true } : {}),
        // This ask is the generated kit SCRIPT, not the ledger's open unknowns —
        // stamped at mint, where the ledger was in hand and owned nothing for this
        // person. Pass-through only; the client STATES it on the page instead of
        // rendering a script identically to a locus-backed ask that can actually
        // close something. Absent on every pack minted before the flag existed, and
        // the page then says nothing extra — we don't know, so we don't claim.
        ...(hit.pack.scripted === true ? { scripted: true } : {}),
        role: String(hit.pack.role ?? ""),
        intro: String(hit.pack.intro ?? ""),
        questions: Array.isArray(hit.pack.questions) ? hit.pack.questions.map(String).slice(0, 12) : [],
        // The LEDGER LOCI behind those questions, index-aligned and cut with the
        // SAME slice(0,12) so questionLoci[i] never stops pointing at
        // questions[i]. Pass-through only — no projection here. The client
        // re-renders each locus through the one question renderer against the
        // liveArtifacts already shipped below, so the stakeholder and the
        // operator read one set of questions in two voices, and an answer names
        // the point it closes. Omitted when the pack has none (every pack minted
        // before this existed), and the client then renders the stored strings
        // exactly as before.
        ...(Array.isArray(hit.pack.questionLoci) && hit.pack.questionLoci.length
          ? { questionLoci: hit.pack.questionLoci.map(String).slice(0, 12) } : {}),
        roster,
        ...(objective ? { objective } : {}),
        ...(interviewDesign ? { design: interviewDesign } : {}),
        ...(interviewScript ? { script: interviewScript } : {}),
        ...(interviewDesign ? runSlice() : {}),
        ...(interviewArea ? { recipientArea: interviewArea } : {}),
        // A Show follow-up carries the prototype so the pilot renders in place
        // of the interpreted walk: the external build's URL when one is linked,
        // otherwise the assembly derived from the record (or the gap saying why
        // there isn't one). External wins — never both.
        ...(isShowPack && externalProtoUrl ? { demoUrl: externalProtoUrl } : {}),
        ...(isShowPack ? pilot : {}),
        // Re-projection inputs (kind + area + the recipient name via `stakeholder`
        // above) and the live slices, so the client rebuilds the current review.
        // A Listen QUESTION pack ships reviewKind "listen-workflow" too, so the
        // client upgrades it to the visual review when its area has a model.
        ...(shipLive ? {
          // Derive the kind from the "review:<kind>" role when not stored, so
          // links minted BEFORE dynamic projection existed also rebuild live.
          // A non-review Listen pack is a workflow review by construction.
          reviewKind: isReviewPack
            ? (String(hit.pack.reviewKind ?? "").trim() || String(hit.pack.role ?? "").replace(/^review:/, ""))
            : "listen-workflow",
          movementId: packMovementId,
          ...(typeof hit.pack.recipientArea === "string" ? { recipientArea: hit.pack.recipientArea } : {}),
          ...(recipientRole ? { recipientRole } : {}),
          liveArtifacts,
        } : {}),
        // A shareable review surface projected at mint — the FALLBACK when live
        // re-projection isn't possible (edge older than the pack, or no slices).
        ...(isRecord(hit.pack.review) ? { review: hit.pack.review } : {}),
        // On a follow-up, the review they LAST saw — the client diffs it against
        // the live review to render "what changed since your last visit".
        ...(interviewFollowUp && isRecord(hit.pack.priorReview) ? { priorReview: hit.pack.priorReview } : {}),
        // The durable link's recap + follow-up state. `submissions` is what the
        // person already sent (shown read-only on return); `answered` is whether
        // they've responded at all; `followUp` is true when the ask changed AFTER
        // their last answer — a genuinely new thing to respond to. A spent link
        // with nothing new shows a recap, never a dead-end error.
        submissions: interviewSubmissions,
        answered: interviewSubmissions.length > 0,
        followUp: interviewFollowUp,
        responded: interviewSubmissions.length > 0 && !interviewFollowUp,
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const token = isRecord(body) && typeof body.token === "string" ? body.token : "";

      // Attachment extraction for respondents: the live token IS the access.
      // Returns text only — nothing is stored until the answers are sent, and
      // even then the response is quarantined for operator review.
      if (isRecord(body) && isRecord(body.extract)) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        // Interview links are durable — a returning stakeholder attaching a file
        // to a follow-up answer is fine. One-shot demo/approval links stay closed.
        if (hit.kind !== "interview" && typeof hit.pack.respondedAt === "string") {
          return jsonResponse({ error: "This link has already been used." }, 410);
        }
        const extract = body.extract as Record<string, unknown>;
        const fileB64 = typeof extract.file === "string" ? extract.file : "";
        if (!fileB64) return jsonResponse({ error: "Missing file" }, 400);
        let bytes: Uint8Array;
        try {
          const binary = atob(fileB64);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        } catch {
          return jsonResponse({ error: "file is not valid base64" }, 400);
        }
        if (bytes.length > 10 * 1024 * 1024) return jsonResponse({ error: "File too large — cap is 10MB" }, 413);
        const result = await extractDocumentText(bytes, fileB64,
          typeof extract.mime === "string" ? extract.mime : "",
          typeof extract.filename === "string" ? extract.filename : "", 60_000);
        if ("error" in result) return jsonResponse({ error: result.error }, result.status);
        // When the attachment answers a specific question, keep only the
        // relevant passages (verbatim) — the ORIGINAL file is stored whole,
        // so nothing is lost; the record just stays focused.
        let refined = false;
        if (typeof extract.question === "string" && extract.question.trim()) {
          const focused = await extractRelevant(result.text, extract.question.trim().slice(0, 500));
          result.text = focused.text;
          refined = focused.refined;
        }
        // Store the original so the operator can download it in its native
        // format from the Library once the response is ingested.
        let sourceKey: string | undefined;
        try {
          try { await hit.admin.storage.createBucket("flow-source-docs", { public: false }); } catch { /* exists */ }
          const safeName = (typeof extract.filename === "string" ? extract.filename : "document").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
          const key = `${hit.programId}/${crypto.randomUUID()}-${safeName}`;
          const { error } = await hit.admin.storage.from("flow-source-docs").upload(key, bytes, {
            contentType: typeof extract.mime === "string" && extract.mime ? extract.mime : "application/octet-stream",
          });
          if (!error) sourceKey = key;
        } catch { /* extraction still succeeds without the original */ }
        return jsonResponse({ ...result, ...(sourceKey ? { sourceKey } : {}), refined });
      }

      // LIVE demo-beat execution: run ONE blueprint agent step against the
      // seed data. Operator opt-in only (show._liveDemoAgents === "on"),
      // read-only — nothing is stored, the outcome returns to the runner and
      // lands on the record only when the stakeholder submits their response.
      if (isRecord(body) && isRecord(body.demoRun)) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        const showBucket = isRecord(hit.inner.phaseInputs) && isRecord((hit.inner.phaseInputs as Record<string, unknown>).show)
          ? (hit.inner.phaseInputs as Record<string, Record<string, unknown>>).show : {};
        if (showBucket._liveDemoAgents !== "on") {
          return jsonResponse({ error: "Live demo agents are not enabled for this programme." }, 403);
        }
        const run = body.demoRun as Record<string, unknown>;
        const action = String(run.action ?? "").slice(0, 200);
        const actor = String(run.actor ?? "").slice(0, 80);
        if (!action) return jsonResponse({ error: "Missing step" }, 400);
        const bp = isRecord(hit.inner.agenticBlueprint) ? hit.inner.agenticBlueprint as Record<string, unknown> : {};
        const agents = Array.isArray(bp.agents) ? (bp.agents as unknown[]).filter(isRecord).slice(0, 12) : [];
        const agent = agents.find((a) => String(a.name ?? "").trim().toLowerCase() === actor.trim().toLowerCase()) ?? agents[0];
        const proto = isRecord(hit.inner.prototypePack) ? hit.inner.prototypePack as Record<string, unknown> : {};
        const seed = Array.isArray(proto.fixtures) ? JSON.stringify(proto.fixtures).slice(0, 4000) : "[]";
        try {
          const result = await completeClaudeText({
            system: `You are "${agent ? String(agent.name) : actor || "the workflow agent"}"${agent && agent.purpose ? ` — ${String(agent.purpose)}` : ""}, running ONE step of an agentic-system demonstration for a stakeholder watching live. Execute the step against the seed data and report the outcome in ONE short sentence (max 30 words) — concrete, grounded in the actual seed values (use their record labels and numbers). Never make a judgement call reserved for a human (denials, approvals, negotiations) — prepare it and say so.`,
            messages: [{ role: "user", content: `Step to execute: ${action}\n\nSeed data (the demo records):\n${seed}` }],
            maxTokens: 120,
            tier: "tier1",
            timeoutMs: 20_000,
          });
          const outcome = result.text.trim().replace(/\s+/g, " ").slice(0, 240);
          if (!outcome) return jsonResponse({ error: "No outcome" }, 502);
          return jsonResponse({ outcome });
        } catch {
          return jsonResponse({ error: "The live agent could not run this beat." }, 502);
        }
      }

      // ASK ON YOUR LINK: a stakeholder asks a question. We CLASSIFY it —
      //  • a DESIGN question (about the future system: its screens, flows, why a
      //    step works this way) is answered right here, grounded in the
      //    Experience Design + the discovery evidence, citing who said what and
      //    when as [E#], and we invite their feedback so a question becomes a
      //    validation signal.
      //  • ANYTHING ELSE (scope, timeline, a fact, a complaint) can't be answered
      //    from the design, so it is quarantined into the operator's Inbox and
      //    the person is told the team will follow up.
      if (isRecord(body) && typeof body.ask === "string" && body.ask.trim()) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        const question = body.ask.trim().slice(0, 400);
        const design = designSummaryFor(hit.inner);
        const evidence = extractPortalEvidence(hit.inner);
        const evidenceBlock = evidence.length
          ? evidence.map((e) => `[${e.id}] "${e.quote}" — ${e.who || "unattributed"}${e.when ? ` (${e.when})` : ""}`).join("\n")
          : "(no attributed discovery evidence on record yet)";
        try {
          const result = await completeClaudeText({
            system: `You triage and answer a client stakeholder's question during their review of the future system's design. Decide the question's TOPIC:
- "design": it is about the FUTURE SYSTEM being designed — a screen, a flow, why a step is automated or stays human, what the app does. Answer it in 2-4 warm, plain-language sentences grounded ONLY in the DESIGN and the EVIDENCE provided. When a point rests on a piece of evidence, cite it inline as [E#] using ONLY the ids listed, so the person sees who asked for it and when. Never invent facts, prices, commitments, or a citation.
- "other": anything else — scope, timeline, budget, staffing, a fact about their business, a complaint, a request unrelated to the design. Do NOT answer it; set answer to "".
Return ONLY JSON: {"topic":"design"|"other","answer":"..."}.`,
            messages: [{ role: "user", content: `THE DESIGN:\n${design || "(no experience design on record yet)"}\n\nEVIDENCE (cite as [E#]):\n${evidenceBlock}\n\nSTAKEHOLDER QUESTION: ${question}` }],
            maxTokens: 380,
            tier: "tier1",
            timeoutMs: 25_000,
          });
          const { topic, answer } = parseTriage(result.text);
          if (topic === "design" && answer.trim()) {
            const cleaned = answer.trim().slice(0, 1200);
            return jsonResponse({
              topic: "design",
              answer: cleaned,
              citations: citedEvidence(cleaned, evidence),
              feedbackPrompt: "Does that answer it? Tell us what you think of this part of the design — your feedback goes straight to the delivery team.",
            });
          }
          // "other" (or an un-answerable design question) → quarantine to Inbox.
          const now = new Date().toISOString();
          for (let attempt = 0; attempt < 3; attempt++) {
            const h = await loadPack(token);
            if ("reason" in h) break;
            const inbox = Array.isArray(h.inner.flowPortalInbox) ? (h.inner.flowPortalInbox as unknown[]).filter((x) => x != null) : [];
            inbox.push({
              id: crypto.randomUUID(), kind: "question",
              stakeholder: String(h.pack.stakeholder ?? ""), role: String(h.pack.role ?? ""),
              receivedAt: now, text: question,
            });
            const nextInner = { ...h.inner, flowPortalInbox: inbox.slice(-INBOX_CAP) };
            const nextRaw = h.nested ? { ...h.raw, data: nextInner } : nextInner;
            let upd = h.admin.from("adam_programs").update({ data: nextRaw, updated_at: now }).eq("id", h.programId);
            upd = h.updatedAt ? upd.eq("updated_at", h.updatedAt) : upd.is("updated_at", null);
            const { data: rows, error } = await upd.select("id");
            if (error) break;
            if (rows && rows.length > 0) {
              notifyWebhook(`AURA Flow — ${hit.programName}: ${String(hit.pack.stakeholder ?? "a stakeholder")} asked a question. It is waiting in the evidence inbox.`);
              break;
            }
          }
          return jsonResponse({ topic: "other", routed: true, message: "Thanks — that's one for the delivery team. I've passed it to them and they'll follow up with you here." });
        } catch {
          return jsonResponse({ error: "Couldn't answer that right now — add it as a comment and the team will follow up." }, 502);
        }
      }

      // DESIGN FEEDBACK: the stakeholder replies to an inline design answer with
      // their feedback. Quarantined to the Inbox like any public-link content;
      // the operator folds it into the design loop.
      if (isRecord(body) && isRecord(body.designFeedback)) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        const fb = body.designFeedback as Record<string, unknown>;
        const feedback = String(fb.feedback ?? "").trim().slice(0, 2000);
        if (feedback.length < 2) return jsonResponse({ error: "Add a little more." }, 400);
        const aboutQ = String(fb.question ?? "").trim().slice(0, 400);
        const now = new Date().toISOString();
        for (let attempt = 0; attempt < 3; attempt++) {
          const h = await loadPack(token);
          if ("reason" in h) return jsonResponse({ error: h.reason }, 404);
          const inbox = Array.isArray(h.inner.flowPortalInbox) ? (h.inner.flowPortalInbox as unknown[]).filter((x) => x != null) : [];
          inbox.push({
            id: crypto.randomUUID(), kind: "design-feedback",
            stakeholder: String(h.pack.stakeholder ?? ""), role: String(h.pack.role ?? ""),
            receivedAt: now,
            text: aboutQ ? `On "${aboutQ}": ${feedback}` : feedback,
          });
          const nextInner = { ...h.inner, flowPortalInbox: inbox.slice(-INBOX_CAP) };
          const nextRaw = h.nested ? { ...h.raw, data: nextInner } : nextInner;
          let upd = h.admin.from("adam_programs").update({ data: nextRaw, updated_at: now }).eq("id", h.programId);
          upd = h.updatedAt ? upd.eq("updated_at", h.updatedAt) : upd.is("updated_at", null);
          const { data: rows, error } = await upd.select("id");
          if (error) return jsonResponse({ error: "Could not record that. Please try again." }, 500);
          if (rows && rows.length > 0) {
            notifyWebhook(`AURA Flow — ${hit.programName}: ${String(hit.pack.stakeholder ?? "a stakeholder")} gave design feedback. It is waiting in the evidence inbox.`);
            return jsonResponse({ ok: true });
          }
        }
        return jsonResponse({ error: "The programme is busy right now — please try again." }, 409);
      }

      // Lightweight ENGAGEMENT telemetry: the respond page reports how far the
      // holder got (opened, furthest beat) so the operator can see where a demo
      // loses people. Best-effort single write, no CAS retry — losing one ping
      // is fine; quarantined content never rides this path.
      if (isRecord(body) && isRecord(body.progress)) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        if (hit.kind !== "interview") return jsonResponse({ ok: true });
        const progress = body.progress as Record<string, unknown>;
        const now = new Date().toISOString();
        const nextPacks = (hit.inner.flowInterviewPacks as unknown[]).map((entry) => {
          if (!isRecord(entry) || entry.token !== hit.pack.token) return entry;
          const prev = isRecord(entry.engagement) ? entry.engagement as Record<string, unknown> : {};
          return { ...entry, engagement: {
            openedAt: typeof prev.openedAt === "string" ? prev.openedAt : now,
            lastSeenAt: now,
            maxStep: Math.max(Number(prev.maxStep ?? 0) || 0, Math.min(Number(progress.maxStep ?? 0) || 0, 99)),
            totalSteps: Math.min(Number(progress.totalSteps ?? 0) || 0, 99) || (Number(prev.totalSteps ?? 0) || 0),
          } };
        });
        const nextInner = { ...hit.inner, flowInterviewPacks: nextPacks };
        const nextRaw = hit.nested ? { ...hit.raw, data: nextInner } : nextInner;
        await hit.admin.from("adam_programs").update({ data: nextRaw, updated_at: now }).eq("id", hit.programId);
        return jsonResponse({ ok: true });
      }

      // Compare-and-set with reload-and-retry: a run finishing between our
      // read and write must never be clobbered by a portal submission (and
      // vice versa). Same discipline as the run-agent persist path.
      for (let attempt = 0; attempt < 3; attempt++) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        // Demo/approval links are one-shot — answering closes them. Interview
        // links are the DURABLE per-stakeholder link: a response never closes it,
        // it just adds to the recap. We only reject a repeat submission when
        // there's nothing new to answer (the ask hasn't changed since their last
        // response) — a genuine follow-up is always accepted.
        if (hit.kind !== "interview") {
          if (typeof hit.pack.respondedAt === "string") {
            return jsonResponse({ error: "This link has already been used — your earlier answers are safely on the record." }, 410);
          }
        } else {
          const prior = (Array.isArray(hit.pack.submissions) ? hit.pack.submissions : []).filter(isRecord);
          const lastTs = prior.reduce((max, s) => (String(s.ts ?? "") > max ? String(s.ts ?? "") : max), "");
          const askAt = String(hit.pack.askUpdatedAt ?? hit.pack.createdAt ?? "");
          if (prior.length > 0 && (!lastTs || askAt <= lastTs)) {
            return jsonResponse({ error: "Your answers are already on the record — there's nothing new to add right now. If we need more, a fresh question will appear on this same link." }, 409);
          }
        }

        const stakeholder = String(hit.pack.stakeholder ?? "Stakeholder");
        const approverName = isRecord(hit.pack.approver) ? String((hit.pack.approver as Record<string, unknown>).name ?? "") : "";
        const now = new Date().toISOString();
        const inbox = Array.isArray(hit.inner.flowPortalInbox) ? [...hit.inner.flowPortalInbox] : [];
        const log = Array.isArray(hit.inner.flowAttestations) ? [...hit.inner.flowAttestations] : [];
        const nextInner: Record<string, unknown> = { ...hit.inner };

        if (hit.kind === "approval") {
          const verdict = isRecord(body) && body.verdict === "approved" ? "approved"
            : isRecord(body) && body.verdict === "changes" ? "changes" : "";
          if (!verdict) return jsonResponse({ error: "Choose approve or request changes." }, 400);
          const comment = isRecord(body) && typeof body.comment === "string"
            ? body.comment.trim().slice(0, MAX_ANSWER_CHARS) : "";
          // A change request must say what to change — an approval need not.
          if (verdict === "changes" && !comment) {
            return jsonResponse({ error: "Add a note so the team knows what to change." }, 400);
          }
          const movementId = String(hit.pack.movementId ?? "frame");
          const artifactId = String(hit.pack.artifactId ?? "");
          const artifactTitle = String(hit.pack.artifactTitle ?? "document");
          const approver = isRecord(hit.pack.approver)
            ? { name: approverName, role: String((hit.pack.approver as Record<string, unknown>).role ?? "") }
            : { name: approverName, role: "" };
          // Auto-record with a PER-STAKEHOLDER rollup: the verdict stamps this
          // approver's pack, then the artifact's status derives from EVERYONE's
          // latest verdicts — approved only when every asked approver approved,
          // back to draft the moment anyone requests changes, in-review while
          // any ask is still open. No operator inbox step.
          const stampedPacks = (Array.isArray(hit.inner.flowApprovalPacks) ? hit.inner.flowApprovalPacks : []).map((entry) =>
            isRecord(entry) && entry.token === hit.pack.token ? { ...entry, respondedAt: now, verdict, comment: comment || undefined } : entry,
          );
          nextInner.flowApprovalPacks = stampedPacks;
          // Latest pack per approver for this artifact — later sends supersede.
          const latestByApprover = new Map<string, Record<string, unknown>>();
          for (const entry of stampedPacks) {
            if (!isRecord(entry) || String(entry.movementId) !== movementId || String(entry.artifactId) !== artifactId) continue;
            const key = isRecord(entry.approver) ? String((entry.approver as Record<string, unknown>).name ?? "").trim().toLowerCase() : "";
            if (!key) continue;
            const held = latestByApprover.get(key);
            if (!held || String(entry.createdAt ?? "") > String(held.createdAt ?? "")) latestByApprover.set(key, entry);
          }
          const latest = [...latestByApprover.values()];
          const allApproved = latest.length > 0 && latest.every((entry) => entry.verdict === "approved");
          const anyChanges = latest.some((entry) => entry.verdict === "changes");
          const phaseArtifacts = isRecord(hit.inner.phaseArtifacts) ? { ...(hit.inner.phaseArtifacts as Record<string, unknown>) } : {};
          const bucket = isRecord(phaseArtifacts[movementId]) ? { ...(phaseArtifacts[movementId] as Record<string, unknown>) } : {};
          const record = isRecord(bucket[artifactId]) ? { ...(bucket[artifactId] as Record<string, unknown>) } : {};
          record.status = anyChanges ? "draft" : allApproved ? "approved" : "in-review";
          record.approval = { approver, verdict, decidedAt: now, comment: comment || undefined };
          bucket[artifactId] = record;
          phaseArtifacts[movementId] = bucket;
          nextInner.phaseArtifacts = phaseArtifacts;
          log.push({
            ts: now, agentId: approverName || "approver", phaseId: movementId, tier: 2,
            action: verdict === "approved" ? `Approved — ${artifactTitle}` : `Changes requested — ${artifactTitle}`,
            detail: `${approverName || "The approver"}${approver.role ? ` (${approver.role})` : ""}${comment ? ` — "${comment.slice(0, 120)}"` : ""}. Recorded automatically.`,
          });
        } else if (hit.kind === "demo") {
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
          // Attached documents: capped and sanitised; they ride the quarantined
          // item and become NAMED evidence only when the operator ingests.
          const documents = (isRecord(body) && Array.isArray(body.documents) ? body.documents : [])
            .filter(isRecord)
            .slice(0, 3)
            .map((doc) => ({
              name: String(doc.name ?? "document").slice(0, 120),
              text: String(doc.text ?? "").trim().slice(0, 60_000),
              question: typeof doc.question === "number" ? doc.question : undefined,
              // Only keys under THIS programme's prefix — a foreign key is dropped.
              sourceKey: typeof doc.sourceKey === "string" && doc.sourceKey.startsWith(`${hit.programId}/`) ? doc.sourceKey : undefined,
            }))
            .filter((doc) => doc.text.length > 0 || doc.sourceKey);
          // Deferrals: "not me — this is for X". Only questions actually ON
          // this pack can be deferred; the target is a short label matched
          // against the cast at ingest time. Routing happens on the operator's
          // side — nothing here trusts the respondent beyond a string.
          const packQuestions = new Set((Array.isArray(hit.pack.questions) ? hit.pack.questions : []).map((q) => String(q)));
          const deferrals = (isRecord(body) && Array.isArray(body.deferrals) ? body.deferrals : [])
            .filter(isRecord)
            .map((entry) => ({ question: String(entry.question ?? ""), to: String(entry.to ?? "").trim().slice(0, 80) }))
            .filter((entry) => entry.to && packQuestions.has(entry.question))
            .slice(0, 12);
          // "Who else should we speak with?" — new voices the respondent names.
          // Nothing is trusted beyond short strings; the operator decides whether
          // to add them (they land as a suggestion, never straight into the cast).
          const suggestedVoices = (isRecord(body) && Array.isArray(body.suggestedVoices) ? body.suggestedVoices : [])
            .filter(isRecord)
            .map((entry) => ({
              name: String(entry.name ?? "").trim().slice(0, 80),
              role: String(entry.role ?? "").trim().slice(0, 80),
              note: String(entry.note ?? "").trim().slice(0, 200),
            }))
            .filter((entry) => entry.name)
            .slice(0, 8);
          if (answers.length < MIN_ANSWER_CHARS && documents.length === 0 && deferrals.length === 0 && suggestedVoices.length === 0) {
            return jsonResponse({ error: "Please write a little more — a sentence or two at minimum." }, 400);
          }
          inbox.push({
            id: crypto.randomUUID(),
            kind: "interview",
            stakeholder,
            role: String(hit.pack.role ?? ""),
            receivedAt: now,
            text: answers,
            ...(documents.length ? { documents } : {}),
            ...(deferrals.length ? { deferrals } : {}),
            ...(suggestedVoices.length ? { suggestedVoices } : {}),
          });
          // Append to the durable link's recap instead of closing it — the person
          // keeps the same link and sees what they've sent when they return.
          const subKind = String(hit.pack.role ?? "").startsWith("review:") ? "review"
            : hit.pack.role === "Follow-up" ? "follow-up" : "interview";
          const preview = (answers || (deferrals.length ? `Routed ${deferrals.length} question${deferrals.length === 1 ? "" : "s"} to others` : "")
            || (documents.length ? `${documents.length} document${documents.length === 1 ? "" : "s"} attached` : "Response sent")).slice(0, 240);
          nextInner.flowInterviewPacks = (hit.inner.flowInterviewPacks as unknown[]).map((entry) => {
            if (!isRecord(entry) || entry.token !== hit.pack.token) return entry;
            const submissions = (Array.isArray(entry.submissions) ? entry.submissions.filter(isRecord) : [])
              .concat([{ ts: now, movementId: entry.movementId, kind: subKind, preview }]).slice(-40);
            return { ...entry, respondedAt: now, submissions };
          });
          log.push({
            ts: now, agentId: "portal", phaseId: "listen", tier: 1,
            action: `Received an async interview response — ${stakeholder}`,
            detail: `${answers.split(/\s+/).filter(Boolean).length.toLocaleString()} words${(isRecord(body) && Array.isArray(body.documents) && body.documents.length) ? ` + ${body.documents.length} document${body.documents.length === 1 ? "" : "s"}` : ""}, quarantined in the evidence inbox for your review.`,
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
          notifyWebhook(hit.kind === "approval"
            ? `AURA Flow — ${hit.programName}: ${approverName || "an approver"} responded to "${String(hit.pack.artifactTitle ?? "a document")}" — recorded automatically.`
            : hit.kind === "demo"
              ? `AURA Flow — ${hit.programName}: ${stakeholder} returned a demo verdict. It is waiting in the evidence inbox.`
              : `AURA Flow — ${hit.programName}: ${stakeholder} answered an async interview. It is waiting in the evidence inbox.`);
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
