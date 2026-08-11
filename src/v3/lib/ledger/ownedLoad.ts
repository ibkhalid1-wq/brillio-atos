/**
 * ownedLoad — ONE reconciled shape for "how many questions does this person carry",
 * so a Discover card can never again print three unreconciled numbers.
 *
 * THE DEFECT THIS EXISTS TO KILL (F6). The "Head of Sales" row simultaneously showed
 * a button reading "10 owned questions", a sub-line reading "9 open on loci they own",
 * and minted a link that actually carried 8 questions. All three were individually
 * defensible — the link is capped, blocked loci cannot be asked, typing loci route to
 * the data dictionary rather than to a person — but the card explained none of it, so
 * the operator's only honest reading was "which number is true?". On a card whose whole
 * job is to be trusted, that is the defect.
 *
 * The fix is NOT a fourth derivation. It is ONE partition of the loci an owner owns,
 * computed here once, whose buckets ADD UP to the headline:
 *
 *     owned = onLink + nextLink + blocked + toDictionary
 *
 * and every reader takes its number out of the same object:
 *   · the card's headline button        → `owned.length`
 *   · the card's breakdown line         → `ownedLoadBreakdown(load)`
 *   · the card's expanded question list → `load.owned` (blocked and dictionary loci
 *                                          stay VISIBLE, tagged with why they can't ride)
 *   · the link the operator mints       → `load.onLink` — literally the bucket the
 *                                          breakdown promised, so the count on the card
 *                                          and the count on the link are one number.
 *
 * Each bucket is a SLICE of a definition that already exists, never a new count:
 *   · `soloByOwner`  (useProgramLedger) — solo-answerable OPEN loci an owner-label owns.
 *   · `typingLoci`   (dictionaryBucket) — open typing unknowns, rerouted to the data
 *                     dictionary by construction and therefore never on a person's link.
 *   · `queue.items`  (buildUnknownQueue) — the one unknown queue, read here only to pick
 *                     out the BLOCKED loci an owner owns, which `soloByOwner` drops.
 * Nothing is invented, and nothing is dropped: a locus an owner owns lands in exactly
 * one bucket, and `assertOwnedLoad` is the identity the tests hold it to.
 *
 * The cap is the pack's, not ours: `mintFollowUpPack` slices the ask to 8 questions, so
 * a card that promised more than 8 on a link was promising something the mint would
 * silently drop. `LINK_QUESTION_CAP` is the client-side name for that literal and
 * `ownedLoad.test.ts` holds the two in lockstep (the answerCapLockstep idiom).
 */
import type { QueueItem } from "./projections";
import type { ProgramLedger } from "./useProgramLedger";

/**
 * The pack's ask cap — `mintFollowUpPack` stores `input.questions.slice(0, 8)`.
 * A surface that shows a bigger number beside a "send a link" button is describing
 * a send that will not happen. Held in lockstep with flowPortal.ts by test.
 */
export const LINK_QUESTION_CAP = 8;

/** Why a locus this person owns is, or is not, on the link they'd be sent now. */
export type OwnedBucket = "on-link" | "next-link" | "blocked" | "dictionary";

export interface OwnedLoadItem {
  about: string;
  slot: string;
  bucket: OwnedBucket;
}

export interface OwnedLoad {
  /** the ledger owner-label(s) this person answers for — [] when nothing binds to them */
  ownerLabels: string[];
  /** THE HEADLINE. Every locus they own, deduped, in bucket order. */
  owned: OwnedLoadItem[];
  /** rides a link minted right now (cap applied) */
  onLink: OwnedLoadItem[];
  /** sendable, but past the pack's cap — the next link carries these */
  nextLink: OwnedLoadItem[];
  /** blocked on the ledger: it cannot be asked until it is unstuck */
  blocked: OwnedLoadItem[];
  /** typing unknowns — a data dictionary answers these, not this person */
  toDictionary: OwnedLoadItem[];
}

/** The ledger reads an owned-load needs — a subset of ProgramLedger, so a rename on the
 *  ledger breaks compilation here instead of silently zeroing a bucket. */
export type OwnedLoadReads = Pick<ProgramLedger, "soloByOwner" | "typingLoci" | "queue">;

export const emptyOwnedLoad = (): OwnedLoad => ({
  ownerLabels: [], owned: [], onLink: [], nextLink: [], blocked: [], toDictionary: [],
});

const item = (q: QueueItem, bucket: OwnedBucket): OwnedLoadItem => ({ about: q.about, slot: q.slot, bucket });

/**
 * Partition everything the given owner-label(s) own into the four buckets above.
 *
 * Dedup is by LOCUS across labels: a person bound to two owner-labels that both own the
 * same locus carries it once — the same rule the card's question list always used, now
 * applied to the counts as well, which is what stopped them agreeing.
 */
export function ownedLoadFor(
  ledger: OwnedLoadReads,
  ownerLabels: Iterable<string>,
  cap: number = LINK_QUESTION_CAP,
): OwnedLoad {
  const labels = [...new Set([...ownerLabels].map((l) => l.trim()).filter(Boolean))];
  if (!labels.length) return emptyOwnedLoad();
  const labelSet = new Set(labels);
  const seen = new Set<string>();
  const sendable: OwnedLoadItem[] = [];
  const toDictionary: OwnedLoadItem[] = [];
  const blocked: OwnedLoadItem[] = [];
  // 1 · SENDABLE — the one definition of "solo-answerable open loci this owner owns".
  //     Seams are absent by construction (joint owners never enter soloByOwner): they
  //     are session questions and belong to the session queue, not to an async list.
  for (const label of labels) {
    for (const q of ledger.soloByOwner.get(label) ?? []) {
      if (seen.has(q.about)) continue;
      seen.add(q.about);
      sendable.push(item(q, "on-link"));
    }
  }
  // 2 · DICTIONARY — open typing unknowns. Rerouted off individual lists upstream, so
  //     they are owned but never asked of a person: one dictionary upload closes them.
  for (const q of ledger.typingLoci) {
    if (!labelSet.has(q.ownerLabel) || seen.has(q.about)) continue;
    seen.add(q.about);
    toDictionary.push(item(q, "dictionary"));
  }
  // 3 · BLOCKED — owned, open on the burn-down, and unaskable until unstuck. soloByOwner
  //     drops these; dropping them from the card too is what made a miss invisible.
  for (const q of ledger.queue.items) {
    if (q.status !== "blocked" || q.owner.kind !== "role") continue;
    if (!labelSet.has(q.ownerLabel) || seen.has(q.about)) continue;
    seen.add(q.about);
    blocked.push(item(q, "blocked"));
  }
  const onLink = sendable.slice(0, Math.max(0, cap));
  const nextLink = sendable.slice(Math.max(0, cap)).map((i) => ({ ...i, bucket: "next-link" as const }));
  return {
    ownerLabels: labels,
    owned: [...onLink, ...nextLink, ...blocked, ...toDictionary],
    onLink, nextLink, blocked, toDictionary,
  };
}

/** Everything that could be sent, cap or no cap — the "real owned load" a sort or a
 *  "ready to engage" state should rank on. `onLink` is the slice that fits today. */
export const sendableCount = (load: OwnedLoad): number => load.onLink.length + load.nextLink.length;

/**
 * THE reconciliation sentence — the card's one line, so the operator never has to
 * subtract two numbers themselves: "10 owned = 8 on this link · 1 next link · 1 blocked".
 * Empty buckets are omitted; with a single bucket the equals-clause is dropped (there is
 * nothing to reconcile, and "8 owned = 8 on this link" reads like a defect).
 */
export function ownedLoadBreakdown(load: OwnedLoad): string {
  const total = load.owned.length;
  if (total === 0) return "0 owned questions";
  const parts: string[] = [];
  if (load.onLink.length) parts.push(`${load.onLink.length} on this link`);
  if (load.nextLink.length) parts.push(`${load.nextLink.length} on the next link`);
  if (load.blocked.length) parts.push(`${load.blocked.length} blocked`);
  if (load.toDictionary.length) parts.push(`${load.toDictionary.length} → dictionary`);
  const head = `${total} owned`;
  return parts.length <= 1 ? `${head} — ${parts[0] ?? "unbucketed"}` : `${head} = ${parts.join(" · ")}`;
}

/** Why a bucket is not on the link — the tag the expanded list shows beside a locus so
 *  the miss is visible rather than merely absent. */
export const BUCKET_NOTE: Record<OwnedBucket, string> = {
  "on-link": "on this link",
  "next-link": `past the link's ${LINK_QUESTION_CAP}-question cap — next link`,
  blocked: "blocked — unstick it before it can be asked",
  dictionary: "answered by the data dictionary, not by them",
};

/** The identity every reader depends on. Exported so surfaces (and tests) can assert it
 *  rather than trusting it: the headline IS the sum of the buckets. */
export const assertOwnedLoad = (load: OwnedLoad): boolean =>
  load.owned.length === load.onLink.length + load.nextLink.length + load.blocked.length + load.toDictionary.length
  && new Set(load.owned.map((i) => i.about)).size === load.owned.length;

// ── OWNED BY NOBODY ON THE ROSTER ───────────────────────────────────────────────────
/**
 * Role owner-labels that own OPEN questions and have no roster person behind them.
 *
 * On the real Laila CRM programme this is 27 open questions across Executive Sponsor,
 * Sales Ops, Talent Acquisition and Finance: questions with an owner in the ledger's
 * sense and literally nobody to ask. Nothing on any surface said so, so they read as
 * covered. The count comes straight out of `soloByOwner` — no person is invented to
 * fill the gap and no number is invented to describe it; the miss stays visible.
 */
export interface UnboundOwner { label: string; open: number }

export function unboundOwners(
  ledger: Pick<ProgramLedger, "soloByOwner">,
  boundLabels: Iterable<string>,
): UnboundOwner[] {
  const bound = new Set([...boundLabels].map((l) => l.trim().toLowerCase()).filter(Boolean));
  const out: UnboundOwner[] = [];
  for (const [label, items] of ledger.soloByOwner) {
    if (!items.length || bound.has(label.trim().toLowerCase())) continue;
    out.push({ label, open: items.length });
  }
  return out.sort((a, b) => b.open - a.open || a.label.localeCompare(b.label));
}

/** The one number for the strip's headline — questions, not roles. */
export const unboundOpenTotal = (owners: UnboundOwner[]): number => owners.reduce((n, o) => n + o.open, 0);
