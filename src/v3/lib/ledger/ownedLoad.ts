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
 * The cap is the pack's, not ours: the mint slices the ask to `LINK_QUESTION_CAP`
 * questions, so a card that promised more than that on a link was promising something
 * the mint would silently drop. There is exactly ONE declaration of that number — the
 * export below — and `flowPortal.ts` IMPORTS it. It used to be a bare `8` in three
 * places kept in step by a test that grepped the other file's source; a lockstep test is
 * what you write when a boundary prevents a shared import, and there is no boundary here
 * (all three sites are client-side TypeScript). The grep is gone; the import is the proof.
 */
import type { QueueItem } from "./projections";
import type { ProgramLedger } from "./useProgramLedger";

/**
 * THE ask cap for a durable link — ONE DEFINITION, read by every site that caps.
 *
 * `mintFollowUpPack` and `mintReviewPack` slice their ask with this exact constant
 * (`flowPortal.ts` imports it), the Discover card's `on this link` bucket is sliced
 * with it here, and `BUCKET_SECTION` names it in the copy. A surface that shows a bigger
 * number beside a "send a link" button is describing a send that will not happen, and
 * the only way that can be true again is if this number is changed — which changes the
 * card and the mint in the same edit.
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

/**
 * How each bucket is HEADED in the expanded question list.
 *
 * This used to be a per-row tag (`BUCKET_NOTE`), repeated beside every locus in the
 * bucket. On a Head of Marketing card with ten typing questions that printed
 * "answered by the data dictionary, not by them" ten times down the right-hand side —
 * one fact, restated until it read as noise, and it crowded out the questions
 * themselves. A property shared by every row in a group belongs to the GROUP.
 *
 * So the list is sectioned by bucket and each fact is stated once, as a heading. The
 * count lives here too, because a header that says how many is the same header doing
 * more work. `title` names the bucket; `note` is the reason, in the operator's terms —
 * what it means for them, not what the ledger calls it.
 *
 * `on-link` is deliberately headed like the rest rather than left bare: an unlabelled
 * first group reads as "the questions", which is exactly the misreading that made the
 * dictionary rows look like part of the ask.
 */
export interface BucketSection {
  title: string;
  note: string;
  /**
   * Whether the section LISTS its questions, or only counts them.
   *
   * The dictionary bucket's own heading says "nobody needs to answer these — one
   * dictionary upload closes all of them", and then it listed all 47. If nobody is
   * going to answer them one by one, the list is not information; the count is.
   * Enumerating them buried the eight questions this person can actually answer
   * under forty-seven they cannot.
   *
   * This is not the F6 defect returning. F6 was loci VANISHING — a blocked
   * question dropped from the card so it looked like it did not exist. Here the
   * bucket keeps its heading, its count and its route, so the headline still
   * reconciles on screen; what goes is a row-by-row transcript of work that is
   * routed elsewhere.
   */
  listRows: boolean;

  /**
   * Whether the section starts OPEN.
   *
   * The dictionary bucket is the one nobody works through: on a real card it is 36
   * rows of "What type of value is Lead.status?", none of which this person will
   * ever answer — one upload closes all of them. Open, it buries the eight
   * questions that ARE addressed to them under a wall of questions that are not.
   * So it starts closed, with its count and its reason still on screen: the miss
   * stays visible, it just stops being the loudest thing on the card.
   */
  defaultOpen: boolean;
}

export const BUCKET_SECTION: Record<OwnedBucket, BucketSection> = {
  "on-link": {
    title: "On this link",
    note: "these go to them when you share their link",
    listRows: true, defaultOpen: true,
  },
  "next-link": {
    title: "On the next link",
    note: `past the ${LINK_QUESTION_CAP}-question cap a single link carries — share again once these are answered`,
    listRows: true, defaultOpen: true,
  },
  blocked: {
    title: "Blocked",
    note: "something upstream has to be settled before these can be asked",
    listRows: true, defaultOpen: true,
  },
  dictionary: {
    title: "Answered by the data dictionary",
    note: "nobody needs to answer these — one dictionary upload closes all of them, and the ask is in the Inbox",
    listRows: false, defaultOpen: false,
  },
};

/** The non-empty buckets in list order, each with its heading and its questions. Readers
 *  never re-derive the order or re-slice the load; a bucket that is empty is absent, so
 *  a section can never head an empty list. */
export function ownedLoadSections<T extends { bucket: OwnedBucket }>(
  items: readonly T[],
): Array<{ bucket: OwnedBucket; section: BucketSection; items: T[] }> {
  const order: OwnedBucket[] = ["on-link", "next-link", "blocked", "dictionary"];
  return order
    .map((bucket) => ({ bucket, section: BUCKET_SECTION[bucket], items: items.filter((i) => i.bucket === bucket) }))
    .filter((g) => g.items.length > 0);
}

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
