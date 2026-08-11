/**
 * Async interviews — evidence autonomy, client side.
 *
 * The Discovery Kit already writes a role-aware question pack per stakeholder;
 * this module turns those into shareable RESPONSE LINKS. Minting is a pure
 * transform over inner.discoveryKit (no model call): each pack gets a random
 * secret, and the public flow-portal edge function serves the pack to whoever
 * holds the link and quarantines what comes back in inner.flowPortalInbox —
 * external input NEVER lands directly in evidence. Ingesting an inbox item is
 * the human confirm: it appends an attributed transcript block (the documented
 * "— Name, Role, Date —" convention), flips the roster row to Heard, and
 * attests. Mutators are pure blob transforms; callers persist via
 * updateProgramData.
 */
import type { ProgramSummary } from "@/new/types";
import { FLOW_ATTESTATION_CAP } from "@/v3/lib/blobGuard";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { parseBeatRecords } from "@/v3/components/flow/flowDemoRun";
import { kitAgendaQuestions } from "@/v3/lib/ledger/kitAgendaCache";

export interface FlowInterviewPack {
  id: string;
  stakeholder: string;
  role: string;
  intro: string;
  questions: string[];
  /** The LEDGER LOCI behind `questions`, index-aligned — `questionLoci[i]` is the
   * `about` (`<elementId>#<slot>`) that `questions[i]` closes.
   *
   * ADDITIVE. A pack minted before this existed simply has none, and the linked
   * page renders its stored strings exactly as before. When loci ARE present the
   * page re-renders each through `renderQuestion(store, about, "stakeholder")` —
   * the same producer the operator queue reads — so the two audiences read one
   * set, and an answer names the point it closes instead of floating free.
   *
   * The strings stay stored beside the loci on purpose: they are the record of
   * what was actually ASKED (the model can be re-rendered later), and the edge
   * validates a deferral against the pack's own question list. */
  questionLoci?: string[];
  /** This ask is the generated kit SCRIPT, not the ledger's open unknowns.
   *
   * A person the ledger owns no loci for still gets a link — their kit script is
   * the fallback (`TheLine.tsx:689-692`). Every question on it then carries
   * `about: ""`, which forces `portalQuestionModel` into `mode: "strings"`, and
   * the page looked IDENTICAL to a locus-backed one: same header, same cards, but
   * no answer on it can be attributed to a point in the model, so answering
   * closes nothing. The flag is the difference made visible — the page states it
   * rather than letting the two read the same.
   *
   * Derived, never guessed: set only where the caller HAD a ledger and it owned
   * nothing for this person. A pack minted with no ledger in hand carries no flag
   * (we do not know), and the page says nothing extra — exactly as before. */
  scripted?: boolean;
  /** Secret half of the response link (programId.secret). */
  token: string;
  createdAt: string;
  respondedAt?: string;
  /** When the current ASK was last changed (mint/refresh). A submission dated
   * before this means there's a fresh follow-up to answer; a submission on or
   * after it means the person is fully caught up (recap-only). */
  askUpdatedAt?: string;
  /** Every response this durable link has received — the recap the returning
   * stakeholder sees, and the signal for whether a new ask is outstanding. */
  submissions?: FlowPackSubmission[];
  /** The movement whose ask this link currently carries. */
  movementId?: string;
  /** The recipient's business area (stamped on area-scoped review links). */
  recipientArea?: string;
  /** Link engagement — where the demo/review loses people: when it was first
   * opened and the furthest beat walked. Stamped by the respond page's pings. */
  engagement?: { openedAt?: string; lastSeenAt?: string; maxStep?: number; totalSteps?: number };
  /** Where ingested answers land (defaults to interviewTranscripts). */
  captureField?: string;
  /** A projected REVIEW surface (workflow-agentify or ontology+atlas) served
   * beside the questions — the pack still answers through the interview path. */
  review?: unknown;
}

/** One recorded response on a durable per-stakeholder link. */
export interface FlowPackSubmission {
  ts: string;
  movementId?: string;
  kind: string;
  /** A short human preview of what they sent (for the recap). */
  preview: string;
}

export interface FlowPortalItem {
  id: string;
  // "question" = a non-design question the person asked on their link, routed
  // here for the operator to handle. "design-feedback" = their feedback on an
  // inline design answer, to fold into the Show demo feedback.
  kind: "interview" | "demo-verdict" | "question" | "design-feedback";
  stakeholder: string;
  role: string;
  receivedAt: string;
  text: string;
  /** Documents the respondent attached — quarantined with the answers. */
  documents?: Array<{ name: string; text: string; question?: number; sourceKey?: string }>;
  /** "Not me — ask X" routing the respondent chose. */
  deferrals?: Array<{ question: string; to: string }>;
  /** "Who else should we speak with?" — new voices the respondent named. */
  suggestedVoices?: Array<{ name: string; role: string; note?: string }>;
  /** Demo verdicts only. */
  verdict?: "accepted" | "accepted-with-changes" | "rework";
}

export interface FlowDemoInvite {
  id: string;
  stakeholder: string;
  role: string;
  openingQuote: string;
  scenario: string;
  steps: string[];
  acceptanceAsk: string;
  /** The recipient's business area — the demo opens scoped to their own flow. */
  recipientArea?: string;
  token: string;
  createdAt: string;
  respondedAt?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

/** `questions` and `questionLoci` are ONE index-aligned pair (the contract on
 * `FlowInterviewPack.questionLoci`), so any cut has to take BOTH together: zip,
 * drop the blank questions, unzip. Dropping a blank from the strings alone would
 * slide every later locus onto the wrong question — the exact desync the edge
 * avoids by cutting both with the same `slice(0, 12)`
 * (`supabase/functions/flow-portal/index.ts:509`+`:519`).
 *
 * Stays ADDITIVE: a pack with no stored loci (or an explicit `undefined`, which
 * is how the kit-agenda refresh drops stale loci) yields no `questionLoci` key at
 * all, exactly as before. A short loci array pads with "" rather than shifting —
 * a falsy locus reads as "no locus for this one" downstream, so the row falls
 * back to its stored string instead of borrowing a neighbour's point. */
function alignedAsk(entry: Record<string, unknown>): { questions: string[]; questionLoci?: string[] } {
  const rawQuestions = Array.isArray(entry.questions) ? entry.questions.map(String) : [];
  const hasLoci = Array.isArray(entry.questionLoci) && entry.questionLoci.length > 0;
  const rawLoci = hasLoci ? (entry.questionLoci as unknown[]).map(String) : [];
  const pairs = rawQuestions
    .map((question, i) => [question, rawLoci[i] ?? ""] as const)
    .filter(([question]) => Boolean(question));
  return {
    questions: pairs.map(([question]) => question),
    ...(hasLoci ? { questionLoci: pairs.map(([, locus]) => locus) } : {}),
  };
}

export function listInterviewPacks(program: ProgramSummary): FlowInterviewPack[] {
  const list = innerData(program).flowInterviewPacks;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowInterviewPack => ({
    id: String(entry.id ?? ""),
    stakeholder: String(entry.stakeholder ?? ""),
    role: String(entry.role ?? ""),
    intro: String(entry.intro ?? ""),
    ...alignedAsk(entry),
    token: String(entry.token ?? ""),
    createdAt: String(entry.createdAt ?? ""),
    respondedAt: typeof entry.respondedAt === "string" ? entry.respondedAt : undefined,
    askUpdatedAt: typeof entry.askUpdatedAt === "string" ? entry.askUpdatedAt : undefined,
    submissions: Array.isArray(entry.submissions)
      ? entry.submissions.filter(isRecord).map((s) => ({
          ts: String(s.ts ?? ""), movementId: typeof s.movementId === "string" ? s.movementId : undefined,
          kind: String(s.kind ?? "interview"), preview: String(s.preview ?? ""),
        }))
      : undefined,
    movementId: typeof entry.movementId === "string" ? entry.movementId : undefined,
    recipientArea: typeof entry.recipientArea === "string" ? entry.recipientArea : undefined,
    // Only ever `true` or absent — a stored `false` is the same statement as
    // "nobody marked this", and inventing a distinction between them would be
    // reading a claim the mint never made.
    scripted: entry.scripted === true ? true : undefined,
    engagement: isRecord(entry.engagement) ? {
      openedAt: typeof entry.engagement.openedAt === "string" ? entry.engagement.openedAt : undefined,
      lastSeenAt: typeof entry.engagement.lastSeenAt === "string" ? entry.engagement.lastSeenAt : undefined,
      maxStep: typeof entry.engagement.maxStep === "number" ? entry.engagement.maxStep : undefined,
      totalSteps: typeof entry.engagement.totalSteps === "number" ? entry.engagement.totalSteps : undefined,
    } : undefined,
  })).filter((pack) => pack.id && pack.token);
}

/** "opened 2d ago · walked 4/7 beats" — the one-line engagement read for a
 * waiting link, so the operator sees where the demo loses people. */
export function engagementLabel(pack: FlowInterviewPack): string {
  const e = pack.engagement;
  if (!e?.openedAt) return "";
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(e.lastSeenAt ?? e.openedAt)) / 86_400_000));
  const when = days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
  const walked = e.maxStep && e.totalSteps ? ` · walked ${Math.min(e.maxStep, e.totalSteps)}/${e.totalSteps} beats`
    : e.maxStep ? ` · walked ${e.maxStep} beat${e.maxStep === 1 ? "" : "s"}` : "";
  return `opened ${when}${walked}`;
}

/** Per-area validation coverage for a design movement: how many stakeholders
 * validated its ask (Envision transformation review / Show demo verdict) and
 * how many links are still waiting. The Envision/Show parallel to Listen's
 * heard-count — an area with links out but zero validations is an open flank. */
export interface AreaValidation { area: string; validated: number; waiting: number }
export function movementValidationCoverage(program: ProgramSummary, movementId: "envision" | "show"): AreaValidation[] {
  const byArea = new Map<string, AreaValidation>();
  const bump = (area: string | undefined, field: "validated" | "waiting") => {
    const key = (area ?? "").trim() || "General";
    const row = byArea.get(key) ?? { area: key, validated: 0, waiting: 0 };
    row[field] += 1;
    byArea.set(key, row);
  };
  // Demo invites only exist for Show — count them first.
  if (movementId === "show") {
    for (const invite of listDemoInvites(program)) bump(invite.recipientArea, invite.respondedAt ? "validated" : "waiting");
  }
  // Durable links carry both movements' asks: a submission stamped with the
  // movement validates it; an OPEN ask for the movement is waiting. Envision
  // counts only review links (the transformation ask); Show counts any Show
  // ask — the self-serve demo rides a Follow-up pack with the walkthrough.
  for (const pack of listInterviewPacks(program)) {
    const subs = pack.submissions ?? [];
    if (subs.some((s) => s.movementId === movementId) || (pack.respondedAt && pack.movementId === movementId && !subs.length)) {
      bump(pack.recipientArea, "validated");
      continue;
    }
    if (pack.movementId !== movementId) continue;
    if (movementId === "envision" && !pack.role.startsWith("review:")) continue;
    const lastTs = subs.reduce((max, s) => (s.ts > max ? s.ts : max), "");
    const askAt = pack.askUpdatedAt ?? pack.createdAt;
    const open = subs.length === 0 ? !pack.respondedAt : askAt > lastTs;
    if (open) bump(pack.recipientArea, "waiting");
  }
  return [...byArea.values()].sort((a, b) => (a.area === "General" ? 1 : b.area === "General" ? -1 : a.area.localeCompare(b.area)));
}

const normName = (name: string): string => name.trim().toLowerCase();

/** A durable per-stakeholder link: EVERY ask a person receives rides one stable
 * token, so a link shared once keeps working through every regeneration and
 * movement. This collapses all of a stakeholder's packs to a single durable
 * record — the earliest token wins (a link already in someone's inbox never
 * breaks), submission history is folded together — and returns it alongside the
 * untouched packs for everyone else. */
function collapseDurable(existing: unknown[], who: string):
  { durable: Record<string, unknown> | null; rest: unknown[] } {
  const isMine = (p: unknown): p is Record<string, unknown> =>
    isRecord(p) && normName(String(p.stakeholder ?? "")) === normName(who);
  const mine = existing.filter(isMine);
  const rest = existing.filter((p) => !isMine(p));
  if (!mine.length) return { durable: null, rest };
  // Earliest createdAt owns the durable token; ties break on id for determinism.
  const ordered = [...mine].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const base: Record<string, unknown> = { ...ordered[0] };
  // Fold every historical response — explicit submissions, or a bare answered
  // stamp on an older one-shot pack — into one recap history.
  const submissions: Record<string, unknown>[] = [];
  for (const p of ordered) {
    if (Array.isArray(p.submissions)) { for (const s of p.submissions) if (isRecord(s)) submissions.push(s); }
    else if (typeof p.respondedAt === "string" && p.respondedAt) {
      submissions.push({ ts: p.respondedAt, movementId: p.movementId,
        kind: String(p.role ?? "").startsWith("review:") ? "review" : p.role === "Follow-up" ? "follow-up" : "interview", preview: "" });
    }
  }
  submissions.sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  if (submissions.length) base.submissions = submissions.slice(-40);
  return { durable: base, rest };
}

/** The answerable core of an ask — used to tell a genuine content change (a new
 * follow-up worth re-asking) from an idempotent re-mint of the same thing. */
function askSignature(pack: Record<string, unknown>): string {
  return JSON.stringify({
    role: String(pack.role ?? ""),
    questions: Array.isArray(pack.questions) ? pack.questions.map(String) : [],
    // The loci are part of the ANSWERABLE CORE: the same words backed by a
    // different set of open points is a different ask (and the same words newly
    // backed by loci is a genuinely new, closable ask).
    questionLoci: Array.isArray(pack.questionLoci) ? pack.questionLoci.map(String) : [],
    reviewKind: String(pack.reviewKind ?? ""),
    movementId: String(pack.movementId ?? ""),
    review: pack.review ?? null,
  });
}

export function listPortalInbox(program: ProgramSummary): FlowPortalItem[] {
  const list = innerData(program).flowPortalInbox;
  if (!Array.isArray(list)) return [];
  // Artifact-approval verdicts share the quarantine inbox but have their own
  // surface (listApprovalResponses) — keep them out of the interview/demo list.
  return list.filter(isRecord).filter((entry) => entry.kind !== "approval").map((entry): FlowPortalItem => ({
    id: String(entry.id ?? ""),
    kind: entry.kind === "demo-verdict" ? "demo-verdict"
      : entry.kind === "question" ? "question"
      : entry.kind === "design-feedback" ? "design-feedback"
      : "interview",
    stakeholder: String(entry.stakeholder ?? "Stakeholder"),
    role: String(entry.role ?? ""),
    receivedAt: String(entry.receivedAt ?? ""),
    text: String(entry.text ?? ""),
    documents: Array.isArray(entry.documents)
      ? (entry.documents as unknown[]).filter(isRecord).map((doc) => ({
          name: String(doc.name ?? "document"),
          text: String(doc.text ?? ""),
          question: typeof doc.question === "number" ? doc.question : undefined,
          sourceKey: typeof doc.sourceKey === "string" ? doc.sourceKey : undefined,
        }))
      : undefined,
    verdict: entry.verdict === "accepted" || entry.verdict === "accepted-with-changes" || entry.verdict === "rework"
      ? entry.verdict
      : undefined,
  })).filter((item) => item.id && (item.text || item.verdict || item.documents?.length));
}

export function listDemoInvites(program: ProgramSummary): FlowDemoInvite[] {
  const list = innerData(program).flowDemoInvites;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowDemoInvite => ({
    id: String(entry.id ?? ""),
    stakeholder: String(entry.stakeholder ?? ""),
    role: String(entry.role ?? ""),
    openingQuote: String(entry.openingQuote ?? ""),
    scenario: String(entry.scenario ?? ""),
    steps: Array.isArray(entry.steps) ? entry.steps.map(String).filter(Boolean) : [],
    acceptanceAsk: String(entry.acceptanceAsk ?? ""),
    recipientArea: typeof entry.recipientArea === "string" ? entry.recipientArea : undefined,
    token: String(entry.token ?? ""),
    createdAt: String(entry.createdAt ?? ""),
    respondedAt: typeof entry.respondedAt === "string" ? entry.respondedAt : undefined,
  })).filter((invite) => invite.id && invite.token);
}

/**
 * The links a surface should SHOW: per person, the newest waiting link (the
 * one live ask) and the newest answered one (the record that they replied).
 * Older duplicates — minted before superseding existed, or answered several
 * times — stay in the blob but not on screen.
 */
export function visibleLinks(packs: FlowInterviewPack[]): FlowInterviewPack[] {
  const byKey = new Map<string, FlowInterviewPack>();
  for (const pack of packs) {
    const key = `${pack.stakeholder.trim().toLowerCase()}|${pack.respondedAt ? "answered" : "waiting"}`;
    const held = byKey.get(key);
    // Tie-break same-second mints on id so duplicates never both survive.
    if (!held || pack.createdAt > held.createdAt || (pack.createdAt === held.createdAt && pack.id > held.id)) byKey.set(key, pack);
  }
  return packs.filter((pack) => byKey.get(`${pack.stakeholder.trim().toLowerCase()}|${pack.respondedAt ? "answered" : "waiting"}`) === pack);
}

/** The shareable link for a pack or demo invite. */
export function portalLinkFor(programId: string, holder: { token: string }): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?flowRespond=${encodeURIComponent(`${programId}.${holder.token}`)}`;
}

/** Bound the interview-pack list without ever dropping a DURABLE per-stakeholder
 *  link — its shared token must keep resolving forever, so any pack that carries
 *  the durable markers (askUpdatedAt / submissions) or is a live review link is
 *  exempt from the recency cap; only legacy one-shot packs are trimmed. */
function capInterviewPacks(packs: unknown[]): unknown[] {
  const isDurable = (p: unknown): boolean => isRecord(p) && (
    typeof p.askUpdatedAt === "string" || Array.isArray(p.submissions)
    || (String(p.role ?? "").startsWith("review:") && typeof p.respondedAt !== "string"));
  const live = packs.filter(isDurable);
  const others = packs.filter((p) => !isDurable(p));
  return [...others.slice(-30), ...live].slice(-120);
}

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint response links for every Discovery Kit interview that doesn't have one
 * yet. Pure transform over the kit — no model call. Null when the kit is
 * missing or every interview is already packed.
 */
export function mintInterviewPacks(program: ProgramSummary, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const kit = isRecord(inner.discoveryKit) ? inner.discoveryKit : null;
  const interviews = kit && Array.isArray(kit.interviews) ? kit.interviews.filter(isRecord) : [];
  if (!interviews.length) return null;

  const existing = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]).filter(isRecord) : [];
  const now = new Date().toISOString();
  // Asked-and-answered guard: the questions each person has ALREADY answered
  // (their responded packs). A refreshed or new link must never re-ask them —
  // the answer is on the record, and re-asking burns the stakeholder's
  // goodwill fastest of anything we could do.
  const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const answeredBy = new Map<string, Set<string>>();
  for (const pack of existing) {
    if (typeof pack.respondedAt !== "string" || !Array.isArray(pack.questions)) continue;
    const key = String(pack.stakeholder ?? "").trim().toLowerCase();
    const set = answeredBy.get(key) ?? new Set<string>();
    for (const question of pack.questions) {
      const norm = normalise(String(question ?? ""));
      if (norm) set.add(norm);
    }
    answeredBy.set(key, set);
  }
  // The kit's agenda strings are a CACHE of rendered question text — read through
  // the ONE accessor (versioned cache field, else the legacy inline blocks). A pack
  // that carries LOCI renders through renderQuestion on the linked page; these
  // strings are what a pack without them falls back to.
  const agendaQuestions = (interview: Record<string, unknown>): string[] => {
    const answered = answeredBy.get(String(interview.stakeholder ?? "").trim().toLowerCase());
    return kitAgendaQuestions(interview)
      .filter((question) => !answered?.has(normalise(question)))
      .slice(0, 12);
  };

  // Refresh UNANSWERED interview links in place to the current agenda, keeping
  // the token — a link always asks what the kit currently asks. Answered packs
  // (on the record) and follow-up packs (gap-specific) stay frozen.
  const byName = new Map(interviews.map((iv) => [String(iv.stakeholder ?? "").trim().toLowerCase(), iv]));
  let refreshed = 0;
  const updatedExisting = existing.map((pack) => {
    const iv = byName.get(String(pack.stakeholder ?? "").trim().toLowerCase());
    // Leave answered, follow-up, AND review-carrying links alone — a review link
    // holds a projected surface, not a plain agenda; blindly refreshing it would
    // wipe that ask. Only plain discovery question packs track the kit agenda.
    if (!iv || typeof pack.respondedAt === "string" || pack.role === "Follow-up"
      || String(pack.role ?? "").startsWith("review:")) return pack;
    const questions = agendaQuestions(iv);
    const role = String(iv.role ?? "");
    if (JSON.stringify(pack.questions) === JSON.stringify(questions) && pack.role === role) return pack;
    refreshed += 1;
    // The agenda refresh replaces the question STRINGS, so any loci that were
    // index-aligned to the old strings are dropped with them — never left
    // pointing at questions that moved.
    return { ...pack, role, questions, questionLoci: undefined };
  });

  const packed = new Set(existing.map((p) => String(p.stakeholder ?? "").trim().toLowerCase()));
  const additions = interviews
    .filter((interview) => {
      const name = String(interview.stakeholder ?? "").trim();
      return name && !packed.has(name.toLowerCase());
    })
    .map((interview) => ({
      id: `pack-${randomSecret().slice(0, 10)}`,
      stakeholder: String(interview.stakeholder ?? "Stakeholder").trim(),
      role: String(interview.role ?? ""),
      intro: "Specifics (numbers, delays, system names, workarounds) are exactly what we need.",
      questions: agendaQuestions(interview),
      token: randomSecret(),
      createdAt: now,
    }));
  if (!additions.length && !refreshed) return null;

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const parts: string[] = [];
  if (additions.length) parts.push(`created ${additions.length}`);
  if (refreshed) parts.push(`refreshed ${refreshed} to the current script`);
  const attestation = {
    ts: now, agentId: actor, phaseId: "listen", tier: 2,
    action: `Async interview links — ${parts.join(", ")}`,
    detail: additions.map((p) => p.stakeholder).join(", ").slice(0, 160),
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowInterviewPacks: capInterviewPacks([...updatedExisting, ...additions]),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/**
 * Mint demo links for every Demo Script that doesn't have one yet — the tour
 * goes out as links, verdicts come back through the same quarantine. Pure
 * transform over inner.demoScripts. Null when scripts are missing or every
 * stakeholder already has an invite.
 */
/** One demo invite from one script — shared by first-wave minting and the
 * re-demo resolver, so both waves carry identical shape. */
export function buildDemoInviteFromScript(script: Record<string, unknown>, now: string): Record<string, unknown> {
  const steps = Array.isArray(script.steps) ? (script.steps as unknown[]).filter(isRecord) : [];
  // The recipient's business area — the generator tags each demo script with it
  // (via the same model that tags the experience-design flows), so the served
  // pack can default the walker to their own area's flow and name it, the
  // Show-phase parallel to how Listen reviews scope by area. Omitted for an
  // untagged/General script so a single-area programme stays a graceful no-op.
  const recipientArea = String(script.area ?? "").trim();
  return {
    id: `demo-${randomSecret().slice(0, 10)}`,
    stakeholder: String(script.stakeholder ?? "Stakeholder"),
    role: String(script.role ?? ""),
    openingQuote: String(script.openingQuote ?? ""),
    scenario: String(script.scenario ?? ""),
    steps: steps.map((step) => [step.beat, step.show].filter(Boolean).map(String).join(" — ")).filter(Boolean).slice(0, 8),
    acceptanceAsk: String(script.acceptanceAsk ?? "Does this run your workflow the way you need it to?"),
    ...(recipientArea && recipientArea !== "General" ? { recipientArea } : {}),
    token: randomSecret(),
    createdAt: now,
  };
}

export function mintDemoInvites(program: ProgramSummary, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const doc = isRecord(inner.demoScripts) ? inner.demoScripts : null;
  const scripts = doc && Array.isArray(doc.scripts) ? doc.scripts.filter(isRecord) : [];
  if (!scripts.length) return null;

  const existing = Array.isArray(inner.flowDemoInvites) ? (inner.flowDemoInvites as unknown[]) : [];
  const invited = new Set(existing.filter(isRecord).map((entry) => String(entry.stakeholder ?? "").toLowerCase()));
  const now = new Date().toISOString();

  const additions = scripts
    .filter((script) => !invited.has(String(script.stakeholder ?? "").toLowerCase()))
    .map((script) => buildDemoInviteFromScript(script, now));
  if (!additions.length) return null;

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: now, agentId: actor, phaseId: "show", tier: 2,
    action: `Created demo links for ${additions.length} stakeholder${additions.length === 1 ? "" : "s"}`,
    detail: additions.map((invite) => invite.stakeholder).join(", ").slice(0, 160),
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowDemoInvites: [...existing, ...additions].slice(-30),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/**
 * Mint one follow-up link — the async form of "run the follow-up meeting":
 * AURA asks exactly the gap questions, the answers come back through the
 * quarantine, and ingest routes them to the right movement's transcript.
 * Today's practical step toward AURA conducting meetings autonomously.
 */
export function mintFollowUpPack(
  program: ProgramSummary,
  input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean;
    /** The ledger loci behind `questions`, index-aligned. Optional and additive:
     *  a caller with no ledger in hand mints exactly the pack it always did. */
    loci?: string[];
    /** The caller had a ledger and it owned NOTHING for this person, so these
     *  questions are their generated kit SCRIPT, not open unknowns. Stated on
     *  the pack so the page can say so — see `FlowInterviewPack.scripted`. */
    scripted?: boolean },
  actor: string,
): Record<string, unknown> | null {
  if (!input.who.trim() || !input.questions.length) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const existing = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]) : [];
  const now = new Date().toISOString();
  // The follow-up ask rides the person's ONE durable link — a plain question
  // pack (no review surface), superseding whatever ask stood before on the same
  // token. Their prior answers stay in the recap; only these new gaps are open.
  // The 8-question cap applies to BOTH arrays together, so `questionLoci[i]`
  // never stops pointing at `questions[i]`.
  const askQuestions = input.questions.slice(0, 8);
  const askLoci = (input.loci ?? []).slice(0, askQuestions.length);
  const askFields: Record<string, unknown> = {
    role: "Follow-up",
    intro: "A few points from our last conversation still need your detail — this takes minutes, in your own words.",
    questions: askQuestions,
    // Always SET (like reviewKind/review below), so a new ask without loci clears
    // a previous ask's loci off the durable pack rather than leaving them pointing
    // at questions that are no longer there. `undefined` is dropped on serialise,
    // so a loci-less mint stores exactly what it always stored.
    questionLoci: askLoci.some((a) => a && a.trim()) ? askLoci : undefined,
    movementId: input.movementId,
    captureField: input.captureField,
    reviewKind: undefined,
    review: undefined,
    unnamed: input.unnamed || undefined,
    // Always SET, for the same reason as `questionLoci`: a later locus-backed ask
    // on the same durable token must CLEAR the scripted mark rather than leave the
    // page saying the questions are a script when they are now open unknowns.
    // Not added to `askSignature` — it is derived from whether loci were passed,
    // and `questionLoci` is already in that signature, so it carries no
    // independent information about whether the ask changed.
    scripted: input.scripted || undefined,
  };
  const { durable, rest } = collapseDurable(existing, input.who);
  let pack: Record<string, unknown>;
  if (durable) {
    const updated = { ...durable, ...askFields };
    // Idempotent: re-sending the identical gaps stands — reuse the standing link.
    if (askSignature(updated) === askSignature(durable)) return null;
    updated.askUpdatedAt = now;
    pack = updated;
  } else {
    pack = {
      id: `pack-${randomSecret().slice(0, 10)}`,
      stakeholder: input.who.trim(),
      ...askFields,
      token: randomSecret(),
      createdAt: now,
      askUpdatedAt: now,
    };
  }
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: now, agentId: actor, phaseId: input.movementId, tier: 2,
    action: `Created a follow-up link — ${String(pack.stakeholder ?? "")}`,
    detail: input.questions.slice(0, 3).join("; ").slice(0, 160),
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowInterviewPacks: capInterviewPacks([...rest, pack]),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/**
 * Mint a shareable REVIEW link — a visual input surface (workflow-agentify or
 * ontology+atlas) projected from the record and stored on the pack. The edge
 * serves the review beside a short fallback agenda; answers come back through
 * the same quarantine → evidence path as any interview. Idempotent per person ×
 * movement × review-kind: re-sharing reuses the standing link, and a fresh
 * projection supersedes an unanswered older one.
 */
export function mintReviewPack(
  program: ProgramSummary,
  input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean;
    /** Ledger loci behind `questions`, index-aligned — optional and additive. */
    loci?: string[] },
  actor: string,
): Record<string, unknown> | null {
  if (!input.who.trim() || !input.review) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const existing = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]) : [];
  const now = new Date().toISOString();
  // Store the re-projection inputs (reviewKind + recipientArea) alongside the
  // frozen review snapshot. The respond page rebuilds the review LIVE from the
  // current record using these, so a later artifact regeneration never orphans
  // the link — the `review` snapshot is only a fallback for old/edge-less packs.
  const recipientArea = isRecord(input.review) && typeof input.review.recipientArea === "string"
    ? input.review.recipientArea : undefined;
  // The ask this share sets on the person's ONE durable link. Reprojecting a
  // fresh review supersedes the old ask on the SAME token — no new secret, so a
  // link already in their inbox keeps working.
  const reviewQuestions = input.questions.slice(0, 8);
  const reviewLoci = (input.loci ?? []).slice(0, reviewQuestions.length);
  const askFields: Record<string, unknown> = {
    role: `review:${input.reviewKind}`,
    intro: input.intro,
    questions: reviewQuestions,
    // Same rule as the follow-up mint: always SET, so re-sharing without loci
    // can never leave a previous ask's loci pointing at different questions.
    questionLoci: reviewLoci.some((a) => a && a.trim()) ? reviewLoci : undefined,
    movementId: input.movementId,
    captureField: input.captureField,
    reviewKind: input.reviewKind,
    recipientArea: recipientArea ?? undefined,
    review: input.review,
    // A link minted for an UNBOUND role placeholder greets nobody by name.
    unnamed: input.unnamed || undefined,
  };
  const { durable, rest } = collapseDurable(existing, input.who);
  let pack: Record<string, unknown>;
  if (durable) {
    const updated = { ...durable, ...askFields };
    // Idempotent: an identical re-share of the same content stands — the
    // standing link is returned by the caller's fallback.
    if (askSignature(updated) === askSignature(durable)) return null;
    updated.askUpdatedAt = now;
    // The review they LAST saw becomes the baseline for the follow-up's
    // "what changed since your last visit" band — only meaningful when they
    // actually answered the superseded ask.
    const answeredBefore = Array.isArray(durable.submissions) && durable.submissions.length > 0;
    if (answeredBefore && isRecord(durable.review)) updated.priorReview = durable.review;
    pack = updated;
  } else {
    pack = {
      id: `pack-${randomSecret().slice(0, 10)}`,
      stakeholder: input.who.trim(),
      ...askFields,
      token: randomSecret(),
      createdAt: now,
      askUpdatedAt: now,
    };
  }
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: now, agentId: actor, phaseId: input.movementId, tier: 2,
    action: `Shared a ${input.reviewKind === "agentify" ? "workflow agentification" : "ontology & current-state"} review — ${String(pack.stakeholder ?? "")}`,
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowInterviewPacks: capInterviewPacks([...rest, pack]),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/** Newest review pack for a person × movement × kind — the link to copy after minting. */
export function latestReviewPackFor(program: ProgramSummary, movementId: string, who: string, reviewKind: string): FlowInterviewPack | null {
  const roleTag = `review:${reviewKind}`;
  const packs = listInterviewPacks(program).filter((pack) =>
    pack.stakeholder.trim().toLowerCase() === who.trim().toLowerCase()
    && (pack.movementId ?? "") === movementId && pack.role === roleTag);
  return packs.length ? packs[packs.length - 1] : null;
}

/** Newest pack for a stakeholder — the link to copy right after minting. */
export function latestPackFor(program: ProgramSummary, who: string): FlowInterviewPack | null {
  const packs = listInterviewPacks(program).filter(
    (pack) => pack.stakeholder.trim().toLowerCase() === who.trim().toLowerCase(),
  );
  return packs.length ? packs[packs.length - 1] : null;
}

/**
 * Confirm a quarantined item. Interviews land as attributed transcript +
 * roster flip; demo verdicts land in the tour ledger, the demo-feedback
 * transcript, AND as a show pass on the track that demos to that stakeholder.
 * Null when the item is unknown.
 */
/** Where an inbox item's evidence will land — the same source-pack lookup
 * ingestion uses, exposed so callers can aim follow-on agents (the
 * contradiction detector) at the right movement. */
export function portalItemTargetMovement(program: ProgramSummary, itemId: string): string {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]).filter(isRecord) : [];
  const item = inbox.find((entry) => entry.id === itemId);
  if (!item) return "listen";
  if (item.kind === "demo-verdict") return "show";
  const stakeholder = String(item.stakeholder ?? "").trim().toLowerCase();
  const allPacks = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]).filter(isRecord) : [];
  const sourcePack = [...allPacks].reverse().find((pack) => String(pack.stakeholder ?? "").trim().toLowerCase() === stakeholder);
  return sourcePack && typeof sourcePack.movementId === "string" && sourcePack.movementId ? sourcePack.movementId : "listen";
}

export function ingestPortalResponse(program: ProgramSummary, itemId: string, actor: string): Record<string, unknown> | null {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]) : [];
  const found = inbox.filter(isRecord).find((entry) => entry.id === itemId);
  if (!found) return null;
  if (found.kind === "demo-verdict") return ingestDemoVerdict(program, itemId, actor);
  // A "question" is the operator's to answer out of band — not evidence; it is
  // resolved by Dismiss once handled, never folded into the record.
  if (found.kind === "question") return null;
  if (found.kind === "design-feedback") return ingestDesignFeedback(program, itemId, actor);
  return ingestInterviewResponse(program, itemId, actor);
}

/**
 * Fold a stakeholder's inline design feedback into the Show movement's demo
 * feedback — the same channel the Prototype Loop reads to raise change requests
 * — attributed and dated, without touching the Listen roster.
 */
function ingestDesignFeedback(program: ProgramSummary, itemId: string, _actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]) : [];
  const item = inbox.filter(isRecord).find((entry) => entry.id === itemId);
  if (!item) return null;
  const stakeholder = String(item.stakeholder ?? "Stakeholder");
  const role = String(item.role ?? "");
  const text = String(item.text ?? "").trim();
  if (!text) return null;
  const today = new Date().toISOString().slice(0, 10);

  const phaseInputs = isRecord(inner.phaseInputs) ? { ...(inner.phaseInputs as Record<string, unknown>) } : {};
  const show = isRecord(phaseInputs.show) ? { ...(phaseInputs.show as Record<string, unknown>) } : {};
  const header = `— ${[stakeholder, role, today].filter(Boolean).join(", ")} —`;
  const existing = typeof show.demoFeedback === "string" ? show.demoFeedback as string : "";
  show.demoFeedback = [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n");
  phaseInputs.show = show;

  const nextInner = { ...inner, flowPortalInbox: inbox.filter((entry) => !isRecord(entry) || entry.id !== itemId), phaseInputs };
  return usesNestedData ? { ...wrapper, data: nextInner } : nextInner;
}

function ingestInterviewResponse(program: ProgramSummary, itemId: string, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]) : [];
  const item = inbox.filter(isRecord).find((entry) => entry.id === itemId);
  if (!item) return null;
  const stakeholder = String(item.stakeholder ?? "Stakeholder");
  const role = String(item.role ?? "");
  const text = String(item.text ?? "").trim();
  const today = new Date().toISOString().slice(0, 10);

  // Follow-up packs carry their own destination — a Frame follow-up's answers
  // belong in the sponsor conversation, not the interview transcripts.
  const allPacks = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]).filter(isRecord) : [];
  const sourcePack = [...allPacks].reverse().find(
    (pack) => String(pack.stakeholder ?? "").trim().toLowerCase() === stakeholder.trim().toLowerCase(),
  );
  const targetMovement = sourcePack && typeof sourcePack.movementId === "string" && sourcePack.movementId ? sourcePack.movementId : "listen";
  const targetField = sourcePack && typeof sourcePack.captureField === "string" && sourcePack.captureField ? sourcePack.captureField : "interviewTranscripts";

  const phaseInputs = isRecord(inner.phaseInputs) ? { ...(inner.phaseInputs as Record<string, unknown>) } : {};
  const bucket = isRecord(phaseInputs[targetMovement]) ? { ...(phaseInputs[targetMovement] as Record<string, unknown>) } : {};

  const header = `— ${[stakeholder, role, today].filter(Boolean).join(", ")} —`;
  const existingTranscripts = typeof bucket[targetField] === "string" ? bucket[targetField] as string : "";
  // Attached documents land as their OWN named evidence blocks — the Library
  // lists each by title, provided by the respondent.
  const documents = Array.isArray(item.documents) ? (item.documents as unknown[]).filter(isRecord) : [];
  const documentBlocks = documents
    .filter((doc) => String(doc.text ?? "").trim() || doc.sourceKey)
    .map((doc) => {
      // Respondent attachments merge their text INTO the answer; the block is
      // just the downloadable original with a pointer. Operator-added docs
      // (with text, no answer) keep their full content.
      const docBody = String(doc.text ?? "").trim() || "Original file attached — its content is captured in the response above.";
      return `— Document: ${String(doc.name ?? "document")}${typeof doc.question === "number" ? ` (re: question ${doc.question})` : ""}, provided by ${stakeholder}, ${today} —\n${typeof doc.sourceKey === "string" && doc.sourceKey ? `[source: ${doc.sourceKey}]\n` : ""}${docBody}`;
    });
  bucket[targetField] = [existingTranscripts.trimEnd(), ...(text ? [`${header}\n${text}`] : []), ...documentBlocks].filter(Boolean).join("\n\n");

  // Roster only tracks Listen coverage — flip the matching row to Heard there.
  if (targetMovement === "listen") {
    let rosterRows: Array<Record<string, string>> = [];
    if (typeof bucket.interviewRoster === "string" && bucket.interviewRoster.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(bucket.interviewRoster);
        if (Array.isArray(parsed)) rosterRows = parsed.filter((r) => r && typeof r === "object");
      } catch { /* rebuilt below */ }
    }
    const match = rosterRows.find((row) => (row.name ?? "").trim().toLowerCase() === stakeholder.trim().toLowerCase());
    if (match) {
      match.status = "Heard";
      if (!match.date) match.date = today;
    } else {
      rosterRows.push({ name: stakeholder, role, status: "Heard", date: today });
    }
    bucket.interviewRoster = JSON.stringify(rosterRows);
  }
  phaseInputs[targetMovement] = bucket;

  // Deferred questions are ROUTING facts, saved fingerprint-safe on Listen:
  // the script derivation gives each to its target's card and drops it from
  // everyone else's, and answered-suppression skips them (deferred ≠ answered).
  const deferrals = Array.isArray(item.deferrals) ? (item.deferrals as unknown[]).filter(isRecord) : [];
  if (deferrals.length) {
    const listenBucket = targetMovement === "listen"
      ? bucket
      : (isRecord(phaseInputs.listen) ? { ...(phaseInputs.listen as Record<string, unknown>) } : {});
    let existingDefs: unknown[] = [];
    try {
      const parsed = typeof listenBucket._deferredAsks === "string" ? JSON.parse(listenBucket._deferredAsks) : [];
      if (Array.isArray(parsed)) existingDefs = parsed;
    } catch { /* reset */ }
    const nextDefs = [...existingDefs, ...deferrals.map((entry) => ({
      question: String(entry.question ?? ""), to: String(entry.to ?? ""), from: stakeholder, ts: today,
    }))].slice(-60);
    listenBucket._deferredAsks = JSON.stringify(nextDefs);
    phaseInputs.listen = listenBucket;
  }

  // Suggested voices — new people a respondent named as "who else should we
  // speak with?". Saved fingerprint-safe on Listen for the operator to add or
  // dismiss on the People page; never straight into the cast.
  const suggested = Array.isArray(item.suggestedVoices) ? (item.suggestedVoices as unknown[]).filter(isRecord) : [];
  if (suggested.length) {
    const listenBucket = targetMovement === "listen"
      ? bucket
      : (isRecord(phaseInputs.listen) ? { ...(phaseInputs.listen as Record<string, unknown>) } : {});
    let existing: unknown[] = [];
    try {
      const parsed = typeof listenBucket._suggestedVoices === "string" ? JSON.parse(listenBucket._suggestedVoices) : [];
      if (Array.isArray(parsed)) existing = parsed;
    } catch { /* reset */ }
    const seen = new Set(existing.filter(isRecord).map((entry) => String(entry.name ?? "").trim().toLowerCase()));
    const additions = suggested
      .map((entry) => ({
        name: String(entry.name ?? "").trim(), role: String(entry.role ?? "").trim(),
        note: String(entry.note ?? "").trim(), from: stakeholder, ts: today,
      }))
      .filter((entry) => entry.name && !seen.has(entry.name.toLowerCase()));
    if (additions.length) {
      listenBucket._suggestedVoices = JSON.stringify([...existing, ...additions].slice(-40));
      phaseInputs.listen = listenBucket;
    }
  }

  const packs = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]) : [];
  const nextPacks = packs.map((pack) =>
    isRecord(pack) && String(pack.stakeholder ?? "").toLowerCase() === stakeholder.toLowerCase()
      ? { ...pack, respondedAt: pack.respondedAt ?? new Date().toISOString() }
      : pack,
  );

  // A scenario run's ✗ beats and flagged screen fields distil into a DESIGN-FIX
  // proposal: confirming appends the distilled feedback to Show's demoFeedback
  // input (fingerprint-visible → the Experience Design goes stale → the rebuild
  // loop carries it). "You flagged this Wednesday, here it is fixed Friday" —
  // the ✗ tap becomes a change, not a comment that dies in a transcript.
  const beats = parseBeatRecords(text);
  const flaggedBeats = beats.filter((b) => b.verdict === "not");
  const flaggedFields = text.match(/Screen data flagged:\n((?:• .*\n?)+)/)?.[1]?.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
  let decisions = Array.isArray(inner.flowDecisions) ? (inner.flowDecisions as unknown[]) : [];
  if (flaggedBeats.length || flaggedFields.length) {
    const summaryLines = [
      ...flaggedBeats.map((b) => `✗ ${b.flow} · step ${b.step + 1}: ${b.action}${b.note ? ` — "${b.note}"` : ""}`),
      ...flaggedFields,
    ].slice(0, 12);
    const decisionId = `demo-fix-${itemId.slice(0, 10)}`;
    if (!decisions.filter(isRecord).some((d) => d.id === decisionId)) {
      decisions = [...decisions, {
        id: decisionId, tier: 2, status: "open", agentId: "demo-run", movementId: "show",
        title: `Fold ${stakeholder}'s demo feedback into the design`,
        summary: `${flaggedBeats.length ? `${flaggedBeats.length} beat${flaggedBeats.length === 1 ? "" : "s"} flagged ✗` : "Screen fields flagged"} in their scenario run. Confirming appends the distilled feedback to Show's inputs — the Experience Design goes stale and the rebuild carries the change.`,
        blocking: "", recommendation: null,
        createdAt: new Date().toISOString(),
        payload: { phaseInputAppend: { movementId: "show", field: "demoFeedback",
          text: `— Demo feedback distilled from ${stakeholder}'s scenario run, ${today} —\n${summaryLines.join("\n")}` } },
      }].slice(-40);
    }
  }

  const words = text ? text.split(/\s+/).length : 0;
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: targetMovement, tier: 2,
    action: `Ingested async response — ${stakeholder}`,
    detail: `${targetMovement === "listen"
      ? `${words.toLocaleString()} words into the interview transcripts; roster marked Heard.`
      : `${words.toLocaleString()} words into ${targetMovement}'s conversation record.`}${deferrals.length
      ? ` ${deferrals.length} question${deferrals.length === 1 ? "" : "s"} deferred → ${[...new Set(deferrals.map((entry) => String(entry.to ?? "")))].join(", ")}.`
      : ""}${flaggedBeats.length || flaggedFields.length ? " Demo feedback distilled into a design-fix proposal." : ""}`,
  };

  return wrapProgramState(wrapper, {
    ...inner,
    phaseInputs,
    flowInterviewPacks: nextPacks,
    flowDecisions: decisions,
    flowPortalInbox: inbox.filter((entry) => !(isRecord(entry) && entry.id === itemId)),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

const TOUR_VERDICT_LABEL: Record<string, string> = {
  "accepted": "Accepted",
  "accepted-with-changes": "Accepted with changes",
  "rework": "Objection",
};

function ingestDemoVerdict(program: ProgramSummary, itemId: string, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]) : [];
  const item = inbox.filter(isRecord).find((entry) => entry.id === itemId);
  if (!item) return null;
  const stakeholder = String(item.stakeholder ?? "Stakeholder");
  const role = String(item.role ?? "");
  const verdict = String(item.verdict ?? "accepted");
  const tourLabel = TOUR_VERDICT_LABEL[verdict] ?? "Accepted";
  const comment = String(item.text ?? "").trim();
  const today = new Date().toISOString().slice(0, 10);

  const phaseInputs = isRecord(inner.phaseInputs) ? { ...(inner.phaseInputs as Record<string, unknown>) } : {};
  const show = isRecord(phaseInputs.show) ? { ...(phaseInputs.show as Record<string, unknown>) } : {};

  // The tour ledger IS the gate — the verdict lands there first.
  let tourRows: Array<Record<string, string>> = [];
  if (typeof show.demoTour === "string" && show.demoTour.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(show.demoTour);
      if (Array.isArray(parsed)) tourRows = parsed.filter((row) => row && typeof row === "object");
    } catch { /* rebuilt below */ }
  }
  const row = tourRows.find((entry) => (entry.stakeholder ?? "").trim().toLowerCase() === stakeholder.trim().toLowerCase());
  if (row) {
    row.verdict = tourLabel;
    row.date = row.date || today;
    if (comment) row.reaction = comment.slice(0, 160);
  } else {
    tourRows.push({ stakeholder, date: today, verdict: tourLabel, reaction: comment.slice(0, 160) });
  }
  show.demoTour = JSON.stringify(tourRows);

  // Which track demos to this stakeholder — named in the evidence header AND
  // receiving the show pass, so the reaction stays attributed to its track.
  const tracks = Array.isArray(inner.tracks) ? (inner.tracks as unknown[]) : [];
  const matchedTrack = tracks.filter(isRecord).find((track) =>
    String(track.leadStakeholder ?? "").trim().toLowerCase() === stakeholder.trim().toLowerCase());
  const matchedName = matchedTrack ? String(matchedTrack.name ?? "") : "";

  // The reaction is evidence too — demo feedback feeds Blueprint diffs.
  if (comment) {
    const session = matchedName ? `Demo session (${matchedName})` : "Demo session";
    const header = `— ${[stakeholder, role, session, today].filter(Boolean).join(", ")} —`;
    const existingFeedback = typeof show.demoFeedback === "string" ? show.demoFeedback : "";
    show.demoFeedback = [existingFeedback.trimEnd(), `${header}\nVerdict: ${tourLabel}\n${comment}`].filter(Boolean).join("\n\n");
  }
  phaseInputs.show = show;

  // Automation ladder: the same verdict is a show pass on the track that
  // demos to this stakeholder — one confirm moves ledger AND acceptance loop.
  let passRecordedOn: string | null = null;
  const nextTracks = tracks.map((track) => {
    if (!isRecord(track) || passRecordedOn) return track;
    const lead = String(track.leadStakeholder ?? "").trim().toLowerCase();
    if (!lead || lead !== stakeholder.trim().toLowerCase()) return track;
    passRecordedOn = String(track.name ?? track.id ?? "track");
    const passes = Array.isArray(track.showPasses) ? track.showPasses : [];
    const pass: Record<string, unknown> = { ts: new Date().toISOString(), stakeholder, verdict };
    if (comment) pass.note = comment.slice(0, 160);
    return { ...track, showPasses: [...passes, pass].slice(-20) };
  });

  const invites = Array.isArray(inner.flowDemoInvites) ? (inner.flowDemoInvites as unknown[]) : [];
  const nextInvites = invites.map((invite) =>
    isRecord(invite) && String(invite.stakeholder ?? "").toLowerCase() === stakeholder.toLowerCase()
      ? { ...invite, respondedAt: invite.respondedAt ?? new Date().toISOString() }
      : invite,
  );

  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: "show", tier: 2,
    action: `Ingested demo verdict — ${stakeholder}: ${tourLabel}`,
    detail: passRecordedOn
      ? `Tour ledger updated; show pass recorded on "${passRecordedOn}".`
      : "Tour ledger updated; no track demos to this stakeholder, so no pass recorded.",
  };

  return wrapProgramState(wrapper, {
    ...inner,
    phaseInputs,
    tracks: nextTracks,
    flowDemoInvites: nextInvites,
    flowPortalInbox: inbox.filter((entry) => !(isRecord(entry) && entry.id === itemId)),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}

/** Dismiss a quarantined response without ingesting it (attested). */
export function dismissPortalResponse(program: ProgramSummary, itemId: string, actor: string): Record<string, unknown> | null {
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const inbox = Array.isArray(inner.flowPortalInbox) ? (inner.flowPortalInbox as unknown[]) : [];
  const item = inbox.filter(isRecord).find((entry) => entry.id === itemId);
  if (!item) return null;
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: "listen", tier: 2,
    action: `Dismissed an async response — ${String(item.stakeholder ?? "unknown")}`,
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowPortalInbox: inbox.filter((entry) => !(isRecord(entry) && entry.id === itemId)),
    flowAttestations: [...log, attestation].slice(-FLOW_ATTESTATION_CAP),
  }, usesNestedData);
}
