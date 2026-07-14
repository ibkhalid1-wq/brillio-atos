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
import { getProgramState, wrapProgramState } from "@/new/lib/programState";

export interface FlowInterviewPack {
  id: string;
  stakeholder: string;
  role: string;
  intro: string;
  questions: string[];
  /** Secret half of the response link (programId.secret). */
  token: string;
  createdAt: string;
  respondedAt?: string;  /** Set on follow-up packs — the movement whose gaps it asks. */
  movementId?: string;
}

export interface FlowPortalItem {
  id: string;
  kind: "interview" | "demo-verdict";
  stakeholder: string;
  role: string;
  receivedAt: string;
  text: string;
  /** Documents the respondent attached — quarantined with the answers. */
  documents?: Array<{ name: string; text: string; question?: number; sourceKey?: string }>;
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

export function listInterviewPacks(program: ProgramSummary): FlowInterviewPack[] {
  const list = innerData(program).flowInterviewPacks;
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((entry): FlowInterviewPack => ({
    id: String(entry.id ?? ""),
    stakeholder: String(entry.stakeholder ?? ""),
    role: String(entry.role ?? ""),
    intro: String(entry.intro ?? ""),
    questions: Array.isArray(entry.questions) ? entry.questions.map(String).filter(Boolean) : [],
    token: String(entry.token ?? ""),
    createdAt: String(entry.createdAt ?? ""),
    respondedAt: typeof entry.respondedAt === "string" ? entry.respondedAt : undefined,
    movementId: typeof entry.movementId === "string" ? entry.movementId : undefined,
  })).filter((pack) => pack.id && pack.token);
}

export function listPortalInbox(program: ProgramSummary): FlowPortalItem[] {
  const list = innerData(program).flowPortalInbox;
  if (!Array.isArray(list)) return [];
  // Artifact-approval verdicts share the quarantine inbox but have their own
  // surface (listApprovalResponses) — keep them out of the interview/demo list.
  return list.filter(isRecord).filter((entry) => entry.kind !== "approval").map((entry): FlowPortalItem => ({
    id: String(entry.id ?? ""),
    kind: entry.kind === "demo-verdict" ? "demo-verdict" : "interview",
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
    if (!held || pack.createdAt > held.createdAt) byKey.set(key, pack);
  }
  return packs.filter((pack) => byKey.get(`${pack.stakeholder.trim().toLowerCase()}|${pack.respondedAt ? "answered" : "waiting"}`) === pack);
}

/** The shareable link for a pack or demo invite. */
export function portalLinkFor(programId: string, holder: { token: string }): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?flowRespond=${encodeURIComponent(`${programId}.${holder.token}`)}`;
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
  const agendaQuestions = (interview: Record<string, unknown>): string[] => {
    const answered = answeredBy.get(String(interview.stakeholder ?? "").trim().toLowerCase());
    return (Array.isArray(interview.agenda) ? interview.agenda.filter(isRecord) : [])
      .flatMap((slot) => (Array.isArray((slot as Record<string, unknown>).questions) ? ((slot as Record<string, unknown>).questions as unknown[]).map(String) : []))
      .filter(Boolean)
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
    if (!iv || typeof pack.respondedAt === "string" || pack.role === "Follow-up") return pack;
    const questions = agendaQuestions(iv);
    const role = String(iv.role ?? "");
    if (JSON.stringify(pack.questions) === JSON.stringify(questions) && pack.role === role) return pack;
    refreshed += 1;
    return { ...pack, role, questions };
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
    flowInterviewPacks: [...updatedExisting, ...additions].slice(-30),
    flowAttestations: [...log, attestation].slice(-200),
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
  return {
    id: `demo-${randomSecret().slice(0, 10)}`,
    stakeholder: String(script.stakeholder ?? "Stakeholder"),
    role: String(script.role ?? ""),
    openingQuote: String(script.openingQuote ?? ""),
    scenario: String(script.scenario ?? ""),
    steps: steps.map((step) => [step.beat, step.show].filter(Boolean).map(String).join(" — ")).filter(Boolean).slice(0, 8),
    acceptanceAsk: String(script.acceptanceAsk ?? "Does this run your workflow the way you need it to?"),
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
    flowAttestations: [...log, attestation].slice(-200),
  }, usesNestedData);
}

/**
 * Mint one follow-up link — the async form of "run the follow-up meeting":
 * ATOS asks exactly the gap questions, the answers come back through the
 * quarantine, and ingest routes them to the right movement's transcript.
 * Today's practical step toward ATOS conducting meetings autonomously.
 */
export function mintFollowUpPack(
  program: ProgramSummary,
  input: { movementId: string; who: string; questions: string[]; captureField: string },
  actor: string,
): Record<string, unknown> | null {
  if (!input.who.trim() || !input.questions.length) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const existing = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]) : [];
  // Idempotent: re-sending the same gaps reuses the SAME link — the latest
  // matching pack stands, no new secret is minted.
  const wanted = input.questions.slice(0, 8).join("");
  const duplicate = [...existing].reverse().filter(isRecord).find((pack) =>
    String(pack.stakeholder ?? "").trim().toLowerCase() === input.who.trim().toLowerCase()
    && String(pack.movementId ?? "") === input.movementId
    && (Array.isArray(pack.questions) ? pack.questions.map(String).join("") : "") === wanted,
  );
  if (duplicate) return null;
  // A NEW ask supersedes the old one: unanswered follow-up links for the
  // same person and movement are retired (their links stop working), so the
  // person only ever holds one live follow-up ask at a time. Answered packs
  // stay — they are part of the record.
  const kept = existing.filter((pack) => {
    if (!isRecord(pack)) return true;
    const sameTarget = String(pack.stakeholder ?? "").trim().toLowerCase() === input.who.trim().toLowerCase()
      && String(pack.movementId ?? "") === input.movementId;
    const unanswered = typeof pack.respondedAt !== "string";
    return !(sameTarget && unanswered && String(pack.role ?? "") === "Follow-up");
  });
  const now = new Date().toISOString();
  const pack = {
    id: `pack-${randomSecret().slice(0, 10)}`,
    stakeholder: input.who.trim(),
    role: "Follow-up",
    intro: "A few points from our last conversation still need your detail — this takes minutes, in your own words.",
    questions: input.questions.slice(0, 8),
    token: randomSecret(),
    createdAt: now,
    movementId: input.movementId,
    captureField: input.captureField,
  };
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: now, agentId: actor, phaseId: input.movementId, tier: 2,
    action: `Created a follow-up link — ${pack.stakeholder}`,
    detail: pack.questions.slice(0, 3).join("; ").slice(0, 160),
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowInterviewPacks: [...kept, pack].slice(-30),
    flowAttestations: [...log, attestation].slice(-200),
  }, usesNestedData);
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
  return found.kind === "demo-verdict"
    ? ingestDemoVerdict(program, itemId, actor)
    : ingestInterviewResponse(program, itemId, actor);
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

  const packs = Array.isArray(inner.flowInterviewPacks) ? (inner.flowInterviewPacks as unknown[]) : [];
  const nextPacks = packs.map((pack) =>
    isRecord(pack) && String(pack.stakeholder ?? "").toLowerCase() === stakeholder.toLowerCase()
      ? { ...pack, respondedAt: pack.respondedAt ?? new Date().toISOString() }
      : pack,
  );

  const words = text ? text.split(/\s+/).length : 0;
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: targetMovement, tier: 2,
    action: `Ingested async response — ${stakeholder}`,
    detail: targetMovement === "listen"
      ? `${words.toLocaleString()} words into the interview transcripts; roster marked Heard.`
      : `${words.toLocaleString()} words into ${targetMovement}'s conversation record.`,
  };

  return wrapProgramState(wrapper, {
    ...inner,
    phaseInputs,
    flowInterviewPacks: nextPacks,
    flowPortalInbox: inbox.filter((entry) => !(isRecord(entry) && entry.id === itemId)),
    flowAttestations: [...log, attestation].slice(-200),
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
    flowAttestations: [...log, attestation].slice(-200),
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
    flowAttestations: [...log, attestation].slice(-200),
  }, usesNestedData);
}
