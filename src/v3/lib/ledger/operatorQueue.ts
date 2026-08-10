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

/** Per-section counts plus the two sums the surfaces need. Sections that render, terms
 *  that count — the same list, in the same order the Inbox lays them out. */
export interface OperatorQueueCounts {
  /** unowned non-typing questions that need a human owner */
  assign: number;
  /** JOINT QUESTIONS awaiting a date (not seams — see sessionQuestionCount) */
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
  const assign = ledger.assignQueue.length;
  const sessionQuestions = sessionQuestionCount(ledger.sessionQueue);
  const adjudicate = ledger.conflicts.length;
  const pinned = ledger.pinConflicts.length;
  const inFlight = ledger.assignments.length;
  const chase = asksNeedingChase(ledger.artifactAsks).length + (ledger.artifactAsks.unattributed.weight ? 1 : 0);
  const decided = ledger.decideFates.length;
  const total = assign + sessionQuestions + adjudicate + pinned + inFlight + chase;
  return { assign, sessionQuestions, adjudicate, pinned, inFlight, chase, decided, total, rendered: total + decided };
}

/** The one integer a caller that only wants the size of the queue should read. */
export const operatorQueueCount = (ledger: OperatorQueueReads): number => operatorQueueCounts(ledger).total;
