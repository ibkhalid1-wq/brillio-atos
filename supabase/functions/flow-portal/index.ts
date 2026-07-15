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
import { extractDocumentText, extractRelevant } from "../_shared/extractText.ts";

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
  // Tokens expire: a link forwarded months later must not still open the
  // programme. 30 days covers any realistic response window.
  const created = Date.parse(String((pack ?? invite ?? approval)?.createdAt ?? ""));
  if (Number.isFinite(created) && Date.now() - created > 30 * 86_400_000) return { reason: EXPIRED };
  const kind: "interview" | "demo" | "approval" = pack ? "interview" : invite ? "demo" : "approval";
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
      if (hit.kind === "demo") {
        const showInputs = isRecord(hit.inner.phaseInputs) && isRecord((hit.inner.phaseInputs as Record<string, unknown>).show)
          ? (hit.inner.phaseInputs as Record<string, Record<string, unknown>>).show
          : {};
        const design = designSlice();
        const script = scriptSlice();
        const recipientArea = recipientAreaSlice();
        return jsonResponse({
          ...(design ? { design } : {}),
          ...(script ? { script } : {}),
          ...(recipientArea ? { recipientArea } : {}),
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
          name: String(interview.stakeholder ?? "").replace(/\s*[—–−‑-]\s*TBC\s*$/i, "").trim(),
          role: String(interview.role ?? "").trim(),
        }))
        .filter((person) => person.name && person.name.toLowerCase() !== selfKey)
        .slice(0, 24);
      // Show-movement links (follow-ups asking for demo feedback) carry the
      // wireframe walkthrough — narrated by their demo script — beside the
      // questions.
      const isShowPack = String(hit.pack.movementId ?? "") === "show";
      const interviewDesign = isShowPack ? designSlice() : undefined;
      const interviewScript = isShowPack ? scriptSlice() : undefined;
      const interviewArea = isShowPack ? recipientAreaSlice() : "";
      // DYNAMIC LINKS: a review pack also ships the CURRENT artifact slices so the
      // respond page rebuilds the review LIVE from the latest record — a later
      // regeneration never orphans the link. The frozen `review` stays only as a
      // fallback for very old packs. Slices are the review-relevant docs (the
      // reviewer sees them anyway), keeping the blast radius the same in spirit.
      const isReviewPack = String(hit.pack.role ?? "").startsWith("review:");
      const liveArtifacts = isReviewPack ? {
        currentStateAtlas: isRecord(hit.inner.currentStateAtlas) ? hit.inner.currentStateAtlas : null,
        domainOntology: isRecord(hit.inner.domainOntology) ? hit.inner.domainOntology : null,
        architectureStrategy: isRecord(hit.inner.architectureStrategy) ? hit.inner.architectureStrategy : null,
        agenticBlueprint: isRecord(hit.inner.agenticBlueprint) ? hit.inner.agenticBlueprint : null,
      } : undefined;
      return jsonResponse({
        kind: "interview",
        programme: hit.programName,
        stakeholder: String(hit.pack.stakeholder ?? "Stakeholder"),
        role: String(hit.pack.role ?? ""),
        intro: String(hit.pack.intro ?? ""),
        questions: Array.isArray(hit.pack.questions) ? hit.pack.questions.map(String).slice(0, 12) : [],
        roster,
        ...(interviewDesign ? { design: interviewDesign } : {}),
        ...(interviewScript ? { script: interviewScript } : {}),
        ...(interviewArea ? { recipientArea: interviewArea } : {}),
        // Re-projection inputs (kind + area + the recipient name via `stakeholder`
        // above) and the live slices, so the client rebuilds the current review.
        ...(isReviewPack ? {
          reviewKind: String(hit.pack.reviewKind ?? ""),
          movementId: String(hit.pack.movementId ?? ""),
          ...(typeof hit.pack.recipientArea === "string" ? { recipientArea: hit.pack.recipientArea } : {}),
          liveArtifacts,
        } : {}),
        // A shareable review surface projected at mint — the FALLBACK when live
        // re-projection isn't possible (edge older than the pack, or no slices).
        ...(isRecord(hit.pack.review) ? { review: hit.pack.review } : {}),
        responded: typeof hit.pack.respondedAt === "string",
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
        if (typeof hit.pack.respondedAt === "string") {
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

      // Compare-and-set with reload-and-retry: a run finishing between our
      // read and write must never be clobbered by a portal submission (and
      // vice versa). Same discipline as the run-agent persist path.
      for (let attempt = 0; attempt < 3; attempt++) {
        const hit = await loadPack(token);
        if ("reason" in hit) return jsonResponse({ error: hit.reason }, 404);
        // One response per link: answering EXPIRES it. More to add later
        // travels on a fresh link minted from the kit.
        if (typeof hit.pack.respondedAt === "string") {
          return jsonResponse({ error: "This link has already been used — your earlier answers are safely on the record." }, 410);
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
          nextInner.flowInterviewPacks = (hit.inner.flowInterviewPacks as unknown[]).map((entry) =>
            isRecord(entry) && entry.token === hit.pack.token ? { ...entry, respondedAt: now } : entry,
          );
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
            ? `ATOS Flow — ${hit.programName}: ${approverName || "an approver"} responded to "${String(hit.pack.artifactTitle ?? "a document")}" — recorded automatically.`
            : hit.kind === "demo"
              ? `ATOS Flow — ${hit.programName}: ${stakeholder} returned a demo verdict. It is waiting in the evidence inbox.`
              : `ATOS Flow — ${hit.programName}: ${stakeholder} answered an async interview. It is waiting in the evidence inbox.`);
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
