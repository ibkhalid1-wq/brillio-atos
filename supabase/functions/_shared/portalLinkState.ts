/**
 * The DURABLE stakeholder link's state machine — one definition, both runtimes.
 *
 * An interview pack is documented (and minted) as "the DURABLE per-stakeholder
 * link — one stable token that carries every ask across movements". The edge
 * honoured that in storage (it appends to `submissions` instead of nulling the
 * token) but not in BEHAVIOUR: any first submission made the link recap-only, so
 * a stakeholder who answered 1 of 8 questions and pressed send lost the other 7.
 * The remaining asks were only reachable if the operator noticed and re-minted.
 *
 * The rule now: a submission is PARTIAL unless the person says otherwise.
 *   · partial ("send what I have so far") — filed, link stays open, and the asks
 *     they already answered are marked as on-record so they aren't re-asked.
 *   · final ("I'm done") — stamps `closedAt`; the link goes recap-only.
 *   · `closedAt` set by anything else (an operator closing action) closes it too.
 *   · a NEW ask posted after the last submission (`askUpdatedAt`) re-opens it —
 *     that is the existing follow-up behaviour and is unchanged.
 *
 * QUARANTINE IS UNTOUCHED. Every submission is still a separate, attributed item
 * in `flowPortalInbox` for the operator to review before anything enters the
 * record; a second send never overwrites or merges over the first. This module
 * only decides whether the link accepts another one, and what it says on return.
 *
 * Lives in `_shared` because both sides must agree: the edge enforces it and the
 * respond page renders from it. The Deno boundary is one-directional — `_shared`
 * is importable from Deno (relative path) and from Vite/vitest (`@shared`), and
 * `src/v3` is importable from neither. Pure: no Deno APIs, no I/O.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** One recorded response on a durable link — the recap row the person sees. */
export interface PortalSubmission {
  ts: string;
  movementId?: string;
  kind: string;
  /** A short human preview of what they sent. */
  preview: string;
  /** They declared themselves DONE with this send — it closed the link. */
  final?: boolean;
  /** The asks this send covered, AS THE PACK STORED THEM (a question string) or
   * as the locus behind one. Recorded so a returning stakeholder is not asked
   * again for something already on the record. */
  answered?: string[];
}

/** Everything the page and the edge need to know about a durable link's state. */
export interface PortalLinkState {
  /** Every response the link has taken, oldest first. */
  submissions: PortalSubmission[];
  /** They have responded at least once. */
  answered: boolean;
  /** The link is finished: the person said they were done, an operator closed
   * it, or it is a legacy one-shot link answered before partials existed. */
  closed: boolean;
  /** A new ask was posted AFTER their last answer — there is something to do. */
  followUp: boolean;
  /** Recap-only: finished, with nothing new outstanding. */
  responded: boolean;
  /** The union of asks already on the record — never re-asked as if unanswered. */
  answeredAsks: string[];
  /** ISO stamp of the most recent submission ("" when there is none). */
  lastSubmittedAt: string;
}

/** The asks a pack can be answered against — its stored question strings and the
 *  loci behind them. A client may only claim to have answered one of these. */
export function packAskKeys(pack: Record<string, unknown> | null | undefined): Set<string> {
  const keys = new Set<string>();
  const p = isRecord(pack) ? pack : {};
  for (const q of Array.isArray(p.questions) ? p.questions : []) {
    const s = String(q).trim();
    if (s) keys.add(s);
  }
  for (const a of Array.isArray(p.questionLoci) ? p.questionLoci : []) {
    const s = String(a).trim();
    if (s) keys.add(s);
  }
  return keys;
}

/** Cap on the asks recorded per submission — the pack itself caps at 12 asks. */
export const MAX_ANSWERED_KEYS = 24;

/** Sanitise a client-claimed "I answered these" list against the pack's OWN asks.
 *  Nothing outside the pack survives — the same discipline the deferral path
 *  uses, so a respondent can never write an arbitrary string onto the record. */
export function sanitiseAnsweredKeys(
  claimed: unknown,
  pack: Record<string, unknown> | null | undefined,
): string[] {
  const allowed = packAskKeys(pack);
  const out: string[] = [];
  for (const entry of Array.isArray(claimed) ? claimed : []) {
    const key = String(entry ?? "").trim();
    if (!key || !allowed.has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= MAX_ANSWERED_KEYS) break;
  }
  return out;
}

function readSubmissions(pack: Record<string, unknown>): { rows: PortalSubmission[]; stored: boolean } {
  const raw = Array.isArray(pack.submissions) ? pack.submissions.filter(isRecord) : [];
  const rows: PortalSubmission[] = raw
    .map((s) => ({
      ts: str(s.ts),
      ...(typeof s.movementId === "string" ? { movementId: s.movementId } : {}),
      kind: str(s.kind) || "interview",
      preview: str(s.preview).slice(0, 240),
      ...(s.final === true ? { final: true } : {}),
      ...(Array.isArray(s.answered) ? { answered: s.answered.map((a) => String(a)).filter(Boolean) } : {}),
    }))
    .filter((s) => s.ts);
  if (rows.length) return { rows, stored: true };
  // LEGACY. A link answered before submission history existed carries only a
  // bare `respondedAt`. It was one-shot by construction and we hold no record of
  // WHICH asks it covered, so re-opening it would re-ask everything as if the
  // person had never answered — worse than the recap. It stays closed.
  const respondedAt = str(pack.respondedAt);
  if (!respondedAt) return { rows: [], stored: false };
  return {
    rows: [{
      ts: respondedAt,
      ...(typeof pack.movementId === "string" ? { movementId: pack.movementId } : {}),
      kind: str(pack.role).startsWith("review:") ? "review" : pack.role === "Follow-up" ? "follow-up" : "interview",
      preview: "",
      final: true,
    }],
    stored: false,
  };
}

/** Read a stored interview pack into its link state. Pure. */
export function portalLinkState(pack: Record<string, unknown> | null | undefined): PortalLinkState {
  const p = isRecord(pack) ? pack : {};
  const { rows } = readSubmissions(p);
  const submissions = rows.slice(-40);
  const lastSubmittedAt = submissions.reduce((max, s) => (s.ts > max ? s.ts : max), "");
  const askUpdatedAt = str(p.askUpdatedAt) || str(p.createdAt);
  const answered = submissions.length > 0;
  const followUp = answered && (!lastSubmittedAt || askUpdatedAt > lastSubmittedAt);
  const closed = answered
    && (!!str(p.closedAt) || submissions.some((s) => s.final === true));
  const answeredAsks: string[] = [];
  for (const s of submissions) {
    for (const key of s.answered ?? []) if (!answeredAsks.includes(key)) answeredAsks.push(key);
  }
  return {
    submissions, answered, closed, followUp,
    // A follow-up always re-opens the page, closed or not: a NEW ask is
    // something to respond to, and that behaviour predates this module.
    responded: closed && !followUp,
    answeredAsks, lastSubmittedAt,
  };
}

/** What the person is told when a genuinely finished link is posted to again. */
export const LINK_CLOSED_MESSAGE =
  "Your answers are already on the record and this link is closed — there's nothing new to add right now. If we need more, a fresh question will appear on this same link.";

/** May this durable link take another submission? The ONE rule the edge enforces
 *  and the page renders. Open links accept partial after partial; only a
 *  finished link with nothing new outstanding is refused. */
export function acceptsSubmission(
  pack: Record<string, unknown> | null | undefined,
): { ok: true } | { ok: false; status: number; error: string } {
  const state = portalLinkState(pack);
  if (state.responded) return { ok: false, status: 409, error: LINK_CLOSED_MESSAGE };
  return { ok: true };
}
