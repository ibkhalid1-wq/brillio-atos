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
 * This module is the ONLY place that sum is written. Two readers:
 *   · OperatorInbox  — `total === 0` IS its whole-inbox empty state (returns null),
 *                      and the per-section stats read the same breakdown.
 *   · FlowShell      — the rail badge, via flowInbox.inboxWaitingCount.
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

/** Per-section counts plus their sum. Sections that render, terms that count — the
 *  same list, in the same order the Inbox lays them out. */
export interface OperatorQueueCounts {
  /** unowned non-typing questions that need a human owner */
  assign: number;
  /** seam (jointly-owned) question groups awaiting a date */
  sessions: number;
  /** loci with two live claims — frozen until adjudicated */
  adjudicate: number;
  /** pinned questions a re-derivation wants to move — an operator decision */
  pinned: number;
  /** questions currently owned through an assignment */
  inFlight: number;
  /** dictionary asks still owed, plus ONE for the unattributed residue when it
   *  carries weight (the Inbox draws that residue as a single row, not per locus) */
  chase: number;
  /** unknowns the operator ruled on (out-of-scope / escalate) — the decided trace */
  decided: number;
  total: number;
}

export function operatorQueueCounts(ledger: OperatorQueueReads): OperatorQueueCounts {
  const assign = ledger.assignQueue.length;
  const sessions = ledger.sessionQueue.length;
  const adjudicate = ledger.conflicts.length;
  const pinned = ledger.pinConflicts.length;
  const inFlight = ledger.assignments.length;
  const chase = asksNeedingChase(ledger.artifactAsks).length + (ledger.artifactAsks.unattributed.weight ? 1 : 0);
  const decided = ledger.decideFates.length;
  return {
    assign, sessions, adjudicate, pinned, inFlight, chase, decided,
    total: assign + sessions + adjudicate + pinned + inFlight + chase + decided,
  };
}

/** The one integer a caller that only wants the size of the queue should read. */
export const operatorQueueCount = (ledger: OperatorQueueReads): number => operatorQueueCounts(ledger).total;
