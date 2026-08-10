/**
 * flowInbox — the WHOLE Inbox page as one number, written once.
 *
 * The Inbox has two halves and they used to be counted in three different places:
 *   1. the programme-blob queue (decisions, portal items, approval responses, open
 *      disputes, unresolved roles, coverage names, exceptions on the record), and
 *   2. the LEDGER operator queue (assign / sessions / adjudicate / pinned /
 *      in-flight / dictionary chase / decided) — see lib/ledger/operatorQueue.ts.
 * The rail badge summed only half 1, so an Inbox full of half-2 items showed a bare
 * icon. `inboxWaitingCount` is now the ONE badge definition and it is the sum of
 * both halves, so the badge is the page and the page is the badge.
 *
 * `programInboxItems` returns the LISTS as well as their total: the Inbox renders
 * from the same object it is counted from, which is why the "N items" header, the
 * empty state and the badge cannot disagree — there is nothing to keep in step.
 */
import type { ProgramSummary } from "@/new/types";
import { listOpenFlowDecisions } from "@/v3/components/flow/flowDecisions";
import { listPortalInbox } from "@/v3/components/flow/flowPortal";
import { listApprovalResponses } from "@/v3/components/flow/flowApprovals";
import { readContradictions } from "@/v3/components/flow/flowShellData";
import { readDirectoryPeople, unresolvedCoverageNames } from "@/v3/components/flow/flowStakeholders";
import { governedExceptionsForInbox } from "@/v3/components/flow/flowExceptions";
import { operatorQueueCount, operatorQueueCounts, type OperatorQueueReads } from "@/v3/lib/ledger/operatorQueue";

export interface ProgramInboxItems {
  /** open flow decisions awaiting a confirm / decline */
  decisions: ReturnType<typeof listOpenFlowDecisions>;
  /** quarantined portal evidence awaiting ingest or dismissal */
  portal: ReturnType<typeof listPortalInbox>;
  /** approver replies landed on the record */
  approvals: ReturnType<typeof listApprovalResponses>;
  /** open contradictions to route or settle */
  disputes: ReturnType<typeof readContradictions>;
  /** directory people whose role has not been resolved */
  unresolvedRoles: ReturnType<typeof readDirectoryPeople>;
  /** names named in coverage that are not yet people */
  coverageNames: ReturnType<typeof unresolvedCoverageNames>;
  /** logged deviations standing open for a decision */
  exceptions: ReturnType<typeof governedExceptionsForInbox>;
  /** the number the "Waiting on you" header prints */
  total: number;
}

/** Every programme-blob item the Inbox page lists, plus their count. Rebuilds owed do
 *  NOT belong here: stale documents live on the movement ribbon, not in the Inbox. */
export function programInboxItems(program: ProgramSummary): ProgramInboxItems {
  const decisions = listOpenFlowDecisions(program);
  const portal = listPortalInbox(program);
  const approvals = listApprovalResponses(program);
  const disputes = readContradictions(program, true);
  const unresolvedRoles = readDirectoryPeople(program).filter((entry) => !entry.roleResolved);
  const coverageNames = unresolvedCoverageNames(program);
  const exceptions = governedExceptionsForInbox(program);
  return {
    decisions, portal, approvals, disputes, unresolvedRoles, coverageNames, exceptions,
    total: decisions.length + portal.length + approvals.length + disputes.length
      + unresolvedRoles.length + coverageNames.length + exceptions.length,
  };
}

/** THE rail-badge number, from an ALREADY-BUILT record half. The Inbox page holds
 *  `programInboxItems` to render from, so it asks the same question with the same
 *  expression the badge uses instead of re-stating it as
 *  `items.total === 0 && operatorQueueCount(ledger) === 0` — two spellings of one
 *  predicate that a third term added to the badge would silently break apart. */
export const inboxWaitingCountFrom = (items: ProgramInboxItems, ledger: OperatorQueueReads): number =>
  items.total + operatorQueueCount(ledger);

/** THE rail-badge number: the programme-blob queue plus the ledger operator queue.
 *  0 means nothing is WAITING on the operator, which is exactly when the badge hides. */
export const inboxWaitingCount = (program: ProgramSummary, ledger: OperatorQueueReads): number =>
  inboxWaitingCountFrom(programInboxItems(program), ledger);

/**
 * THE OTHER number: EVERYTHING THE INBOX PAGE DRAWS, the decided trace included.
 *
 * The badge and the page stopped being the same integer the moment `decided` left the
 * badge (45cfa62, correctly — decideFates only ever grows, so a badge carrying it could
 * never return to zero). `operatorQueueCounts` split into `total` (waiting) and
 * `rendered` (drawn) for exactly that reason, and OperatorInbox's own null-render moved
 * to `rendered`. FlowShell's quiet block did NOT move: it still asked `waiting`, so a
 * programme whose only operator action is one `decide-fate` measured
 *
 *     { badge: 0, decidedRows: 1, inboxSections: 1,
 *       quietBlocks: 1, quietHeadline: "Nothing needs you right now." }
 *
 * — the operator rules the last unknown out of scope and lands on a page reading
 * "Decided — 1 unknown the operator ruled on" directly above "Nothing needs you right
 * now". Emptiness is a question about what is DRAWN, so it reads this; the badge stays
 * `inboxWaitingCount`. Two named numbers, each written once, neither re-derived at a
 * call site.
 */
export const inboxRenderedCountFrom = (items: ProgramInboxItems, ledger: OperatorQueueReads): number =>
  items.total + operatorQueueCounts(ledger).rendered;
