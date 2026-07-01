/**
 * Change-request log for the Scope & PCR workspace.
 *
 * "Change requests" here are the governed change-control records
 * ({@link ChangeRequest} from `@/v3/lib/changeControl`) that a user raises
 * against a locked phase and a reviewer approves or rejects — NOT the scope-PCR
 * signals the agent emits into the decision queue. They live on the program's
 * inner state at `changeRequests[]`, the single source the gate-review hook reads
 * and writes.
 *
 * This splits them into the open requests still awaiting a decision and the
 * decided history (approved / rejected), so the screen shows both what needs a
 * call and the audit trail of changes already implemented.
 */
import type { ProgramSummary } from "@/new/types";
import {
  getChangeRequests,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "@/v3/lib/changeControl";

export type { ChangeRequest, ChangeRequestStatus };

export interface ChangeRequestLog {
  /** Requests still awaiting a decision (status "open"), newest first. */
  open: ChangeRequest[];
  /** Decided requests (approved / rejected), newest decision first. */
  history: ChangeRequest[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The inner program state that carries `changeRequests[]` (rawData.data ?? rawData). */
function innerState(program: ProgramSummary | null | undefined): Record<string, unknown> {
  const raw = isRecord(program?.rawData) ? (program!.rawData as Record<string, unknown>) : {};
  return isRecord(raw.data) ? (raw.data as Record<string, unknown>) : raw;
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

export function deriveChangeRequests(program: ProgramSummary | null | undefined): ChangeRequestLog {
  const all = getChangeRequests(innerState(program));

  const open = all
    .filter((cr) => cr.status === "open")
    .sort((a, b) => time(b.requestedAt) - time(a.requestedAt));

  const history = all
    .filter((cr) => cr.status === "approved" || cr.status === "rejected")
    .sort((a, b) => time(b.decidedAt ?? b.requestedAt) - time(a.decidedAt ?? a.requestedAt));

  return { open, history };
}
