// Change-control model for locked phases. Once a phase clears its gate it is
// frozen; the only sanctioned way to edit it again is to raise a change request,
// have it approved, and let that approval reopen the gate. These pure helpers own
// the changeRequests[] array on the program's inner state so the hook layer stays
// thin and the rules stay unit-testable.

export type ChangeRequestStatus = "open" | "approved" | "rejected";

export interface ChangeRequest {
  id: string;
  /** The locked phase the change targets. */
  phaseId: string;
  title: string;
  reason: string;
  status: ChangeRequestStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidChangeRequest(value: unknown): value is ChangeRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.phaseId === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string"
  );
}

/** Read the change requests off a program's inner state, tolerating legacy/empty shapes. */
export function getChangeRequests(inner: Record<string, unknown> | null | undefined): ChangeRequest[] {
  const raw = inner?.changeRequests;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidChangeRequest);
}

export function openChangeRequests(list: ChangeRequest[]): ChangeRequest[] {
  return list.filter((cr) => cr.status === "open");
}

export function openRequestsForPhase(list: ChangeRequest[], phaseId: string): ChangeRequest[] {
  return list.filter((cr) => cr.status === "open" && cr.phaseId === phaseId);
}

export function makeChangeRequest(input: {
  phaseId: string;
  title: string;
  reason: string;
  requestedBy: string;
  now?: string;
}): ChangeRequest {
  const now = input.now ?? new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    id: `cr-${input.phaseId}-${Date.now()}-${rand}`,
    phaseId: input.phaseId,
    title: input.title.trim(),
    reason: input.reason.trim(),
    status: "open",
    requestedBy: input.requestedBy,
    requestedAt: now,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };
}

/**
 * Phases an approved change targeting `targetPhaseId` should reopen: the target
 * itself plus every prior phase (earlier in program order) that is currently
 * closed (gate-approved). Editing a closed phase invalidates the closed phases it
 * was built on, so the whole prior chain reopens together for a coherent edit.
 * Returned in program order so the caller reopens them deterministically.
 */
export function phasesToReopenForChange(
  orderedPhaseIds: string[],
  approvedPhaseIds: Iterable<string>,
  targetPhaseId: string,
): string[] {
  const approved = new Set(approvedPhaseIds);
  const targetIdx = orderedPhaseIds.indexOf(targetPhaseId);
  if (targetIdx === -1) return [targetPhaseId];
  const result = orderedPhaseIds
    .slice(0, targetIdx + 1)
    .filter((id) => approved.has(id) || id === targetPhaseId);
  if (!result.includes(targetPhaseId)) result.push(targetPhaseId);
  return result;
}

/** Mark one open request approved/rejected. No-op for unknown ids or already-decided requests. */
export function applyDecision(
  list: ChangeRequest[],
  id: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  note?: string,
  now?: string,
): ChangeRequest[] {
  const ts = now ?? new Date().toISOString();
  return list.map((cr) =>
    cr.id === id && cr.status === "open"
      ? { ...cr, status: decision, decidedBy, decidedAt: ts, decisionNote: note?.trim() || null }
      : cr,
  );
}
