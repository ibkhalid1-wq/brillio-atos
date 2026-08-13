/**
 * operatorQueue — ONE definition of "how many ledger items the Inbox is holding".
 *
 * The Inbox page renders the ledger operator queue (OperatorInbox): assign, joint
 * sessions, adjudication, pinned routing decisions, in-flight assignments, the
 * dictionary chase, and the decided-fate trace. Every one of those items lives on
 * the Inbox page, so every one of them belongs in the number the left-rail INBOX
 * badge shows. It did not: the badge summed only the programme-blob terms, so an
 * Inbox reading "8 awaiting a date" plus 5 dictionary asks sat behind a bare icon.
 *
 * RENDERED is not the same as WAITING, and this module now says both. The decided
 * trace is work the operator has ALREADY ruled on; it only ever grows, so counting it
 * as "waiting on you" made the badge monotonic — rule the last unknown out of scope
 * and the badge still burns. `total` is the badge (waiting); `rendered` is the page
 * (waiting + the trace). One extra term, written once, not a second copy of a count.
 *
 * This module is the ONLY place either sum is written. Two readers:
 *   · OperatorInbox  — `rendered === 0` IS its whole-inbox empty state (returns null),
 *                      and the per-section stats read the same breakdown.
 *   · FlowShell      — the rail badge, via flowInbox.inboxWaitingCount → `total`.
 * Neither one re-adds the terms, so they cannot drift apart again.
 *
 * Pure over the ledger's own reads (no store mutation, no second derivation): each
 * term is a `.length` of a list useProgramLedger already computed once, plus the
 * chase list from artifactAsks.ts. Nothing here counts anything the page does not
 * render, and nothing the page renders is missing here.
 */
import { asksNeedingChase } from "./artifactAsks";
import type { ProgramLedger } from "./useProgramLedger";

/** The ledger reads the operator queue is made of — a subset of ProgramLedger, so a
 *  rename on the ledger breaks compilation here rather than silently zeroing a term. */
export type OperatorQueueReads = Pick<ProgramLedger,
  "assignQueue" | "sessionQueue" | "conflicts" | "assignments" | "pinConflicts" | "decideFates" | "artifactAsks">;

/** THE definition of "how many joint QUESTIONS the session queue is holding".
 *
 *  A seam is a CONTAINER; a question is the work. The Inbox header speaks one unit —
 *  questions (its row is suffixed "· questions", and the burn-down above it counts the
 *  same way) — so the sessions term has to be questions too. It was `sessionQueue.length`
 *  (SEAMS), which put "11 awaiting a date · questions" in the header fifteen lines above
 *  the section's own "11 seams, 49 questions". Two numbers for one section on one screen,
 *  and the header's was the mislabelled one.
 *
 *  Exported because the SessionsSection summary line reads THIS function, not a second
 *  reduce of its own — the header stat and the section summary are now literally the
 *  same call. (Chosen over relabelling the header "seams": the row's unit is questions,
 *  and per-stat unit labels would have made the header a glossary.) */
export const sessionQuestionCount = (sessionQueue: OperatorQueueReads["sessionQueue"]): number =>
  sessionQueue.reduce((n, s) => n + s.abouts.length, 0);

/**
 * THE UNFROZEN QUEUES — the terms of the sum, with frozen loci removed exactly once.
 *
 * A locus held by two or more live contradicting claims is FROZEN: it is already the
 * adjudicate term and already a row in the adjudicate section. But the same locus can
 * simultaneously be an open unowned question (assign) or a joint one (sessions), and
 * `store.assert` produces contradictions on its own — escalating, or letting same-world
 * claims coexist — with no explicit `contradict()` call anywhere. So the terms were not
 * disjoint: one locus counted twice in the badge and drew a row in two Inbox sections,
 * asking the operator to route a question that is frozen until they adjudicate it first.
 *
 * Derived HERE, once, and read by BOTH surfaces, because that is the only shape that
 * cannot drift: the Inbox draws assign/sessions from this function and the rail badge
 * counts those same lists. Filtering in the page instead would leave the badge counting
 * a set the page does not draw. Filtering in `useProgramLedger.assignQueue` instead would
 * fork the partition conservation asserts on (all-unowned = assignQueue + the unowned
 * slice of typingLoci) — a different and much larger change.
 *
 * Adjudication is the ONLY term that keeps a frozen locus, which is what makes the
 * operator's next move unambiguous: unfreeze it, and it reappears wherever it belongs.
 */
export function unfrozenQueues(ledger: OperatorQueueReads): {
  frozen: ReadonlySet<string>;
  assign: OperatorQueueReads["assignQueue"];
  sessions: OperatorQueueReads["sessionQueue"];
} {
  const frozen: ReadonlySet<string> = new Set(ledger.conflicts.map((c) => c.about));
  // Overwhelmingly the common case (0 conflicts): return the originals by reference so
  // no surface pays a copy, and identity-based memoisation upstream still holds.
  if (frozen.size === 0) return { frozen, assign: ledger.assignQueue, sessions: ledger.sessionQueue };
  return {
    frozen,
    assign: ledger.assignQueue.filter((it) => !frozen.has(it.about)),
    // A seam whose every question is frozen is not a conversation to schedule, so it
    // stops being a seam here too — otherwise the section prints "0 joint questions"
    // beside a live "propose a time" button.
    sessions: ledger.sessionQueue
      .map((s) => ({
        ...s,
        abouts: s.abouts.filter((a) => !frozen.has(a)),
        items: s.items.filter((i) => !frozen.has(i.about)),
      }))
      .filter((s) => s.abouts.length > 0),
  };
}

/** Per-section counts plus the two sums the surfaces need. Sections that render, terms
 *  that count — the same list, in the same order the Inbox lays them out. */
export interface OperatorQueueCounts {
  /** unowned non-typing questions that need a human owner */
  assign: number;
  /**
   * JOINT QUESTIONS, and they are no longer a term in the badge.
   *
   * A seam used to sit in this queue as "propose a session", and it was the ONLY
   * route a jointly-owned question had: it reached neither owner until the operator
   * booked a meeting. It now goes out on BOTH owners' links like any other question,
   * so there is nothing here for an operator to decide — and a number that cannot be
   * acted on does not belong in a count of things waiting on them.
   *
   * Kept as a READING, because the seam is still worth seeing (Discover states which
   * pairs share questions) and because removing a term from a published shape would
   * break every reader at once. It is simply not summed.
   */
  sessionQuestions: number;
  /** loci frozen by two or more live contradicting claims — until adjudicated */
  adjudicate: number;
  /** pinned questions a re-derivation wants to move — an operator decision */
  pinned: number;
  /** questions currently owned through an assignment */
  inFlight: number;
  /** dictionary asks still owed, plus ONE for the unattributed residue when it
   *  carries weight (the Inbox draws that residue as a single row, not per locus) */
  chase: number;
  /** unknowns the operator ALREADY ruled on (out-of-scope / escalate) — the decided
   *  trace. History, not a queue: it is in `rendered`, never in `total`. */
  decided: number;
  /** WAITING ON YOU — the rail badge, whose label reads "responses and decisions
   *  waiting on you". `decided` is deliberately absent: it only ever grows, so
   *  including it made the badge monotonic and "Nothing needs you right now"
   *  unreachable on any programme where an operator had ruled on anything. */
  total: number;
  /** EVERYTHING THE INBOX PAGE DRAWS, the decided trace included. The page's own
   *  null-render reads this so ruling the last unknown out of scope silences the
   *  badge without also deleting the history that explains why. */
  rendered: number;
}

export function operatorQueueCounts(ledger: OperatorQueueReads): OperatorQueueCounts {
  // Frozen loci are the adjudicate term and nothing else — see unfrozenQueues.
  const unfrozen = unfrozenQueues(ledger);
  const assign = unfrozen.assign.length;
  const sessionQuestions = sessionQuestionCount(unfrozen.sessions);
  const adjudicate = ledger.conflicts.length;
  const pinned = ledger.pinConflicts.length;
  const inFlight = ledger.assignments.length;
  const chase = asksNeedingChase(ledger.artifactAsks).length + (ledger.artifactAsks.unattributed.weight ? 1 : 0);
  const decided = ledger.decideFates.length;
  // `sessionQuestions` is deliberately NOT summed: see the field's own note. Both
  // owners are asked directly, so a seam is a fact about the board, not a decision
  // waiting on the operator.
  const total = assign + adjudicate + pinned + inFlight + chase;
  return { assign, sessionQuestions, adjudicate, pinned, inFlight, chase, decided, total, rendered: total + decided };
}

/** The one integer a caller that only wants the size of the queue should read. */
export const operatorQueueCount = (ledger: OperatorQueueReads): number => operatorQueueCounts(ledger).total;
