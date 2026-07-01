/**
 * Change-request (PCR) log for the Scope & PCR workspace.
 *
 * The Scope Changes screen surfaces scope-creep *signals* but never listed the
 * actual change-request records they produce. This derives that log from the
 * program's decision queue so the screen shows open change requests awaiting a
 * call and the resolved history behind them.
 *
 * Open change requests are grounded through the same predicate the decision
 * queue, confidence model and phase gates already use
 * ({@link isGroundedFalsePositiveDecision}): a PCR claiming objectives / owners /
 * timeline / KPIs are missing (or demanding gate-derived exit criteria) while the
 * programme already owns them is a stale false positive and is suppressed rather
 * than shown as actionable. Resolved records are left intact — they are audit
 * history, not a call to action.
 */
import type { DecisionPriority, DecisionSummary, ProgramSummary } from "@/new/types";
import { isDecisionOpen } from "@/v3/utils";
import { buildPlanGroundingIndex, isGroundedFalsePositiveDecision } from "@/v3/lib/decisionGrounding";

// A decision is a change request when its type is one of the PCR variants or it
// was raised by the scope-PCR agent (mirrors AppShellV3's isPCR check).
const PCR_TYPES = new Set(["pcr-review", "pcr", "change_request", "change-request"]);

export function isPcrDecision(decision: DecisionSummary): boolean {
  return PCR_TYPES.has(decision.type) || decision.source === "scope-pcr";
}

/** Why a change request sits in history rather than the open list. */
export type ChangeRequestHistoryKind = "resolved" | "auto-filtered";

export interface ChangeRequestItem {
  id: string;
  title: string;
  priority: DecisionPriority;
  phaseId: string;
  createdAt: string;
  rationale: string | null;
  /** Resolution status label for resolved records (e.g. "approved"). */
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Set on history entries: how the request left the open list. */
  historyKind?: ChangeRequestHistoryKind;
}

export interface ChangeRequestLog {
  open: ChangeRequestItem[];
  /**
   * Every change request no longer awaiting a call, newest first — resolved
   * records plus PCRs auto-filtered as grounded false positives. Gives the
   * screen a complete change-request history rather than silently dropping the
   * suppressed ones.
   */
  history: ChangeRequestItem[];
  /** Subset of `history` that was auto-filtered (stale absence-claims). */
  suppressedCount: number;
}

function toItem(decision: DecisionSummary, historyKind?: ChangeRequestHistoryKind): ChangeRequestItem {
  return {
    id: decision.id,
    title: decision.title || decision.question || "Change request",
    priority: decision.priority,
    phaseId: decision.phaseId,
    createdAt: decision.createdAt,
    rationale: decision.recommendation || decision.question || null,
    resolution: decision.status ?? null,
    resolvedAt: decision.resolvedAt ?? null,
    resolvedBy: decision.resolvedBy ?? null,
    historyKind,
  };
}

const byNewest = (a: ChangeRequestItem, b: ChangeRequestItem) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

export function deriveChangeRequests(program: ProgramSummary | null | undefined): ChangeRequestLog {
  const pcrs = (program?.decisionQueue ?? []).filter(isPcrDecision);
  const grounding = buildPlanGroundingIndex(program ?? null);

  const open: ChangeRequestItem[] = [];
  const history: ChangeRequestItem[] = [];
  let suppressedCount = 0;

  for (const decision of pcrs) {
    if (isDecisionOpen(decision)) {
      if (isGroundedFalsePositiveDecision(decision, grounding)) {
        suppressedCount += 1;
        history.push(toItem(decision, "auto-filtered"));
        continue;
      }
      open.push(toItem(decision));
    } else {
      history.push(toItem(decision, "resolved"));
    }
  }

  return {
    open: open.sort(byNewest),
    history: history.sort(byNewest),
    suppressedCount,
  };
}
