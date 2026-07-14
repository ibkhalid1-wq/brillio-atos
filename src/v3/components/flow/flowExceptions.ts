/**
 * Governed exceptions — the sanctioned escape valve for the edit-lock.
 *
 * Artifacts are DERIVED, not authored: the operator can't hand-edit a charter
 * or an atlas, because every document is a view of the evidence record. But
 * real programmes need a way to say "we are knowingly deviating here, and here
 * is why" — a cutover before a sign-off lands, a domain heard from one voice
 * instead of two, a constraint waived for a deadline. A governed exception is
 * exactly that: a FIRST-CLASS LOGGED record, attributed and dated, with a
 * justification, an authority, and a review date. It never changes an artifact
 * — it records a decision ALONGSIDE the evidence, auditable like any other
 * operator judgement.
 *
 * Stored per-movement under `_governedExceptions` (JSON). The underscore keeps
 * it out of the evidence fingerprint — logging an exception is an operator
 * decision, not new stakeholder evidence, so it must never flag a document
 * stale (the same contract as `_roleBindings` and `_dismissedListenRoles`).
 */
import type { ProgramSummary } from "@/new/types";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";

export interface GovernedException {
  id: string;
  /** What is being excepted — the deviation itself, in one line. */
  scope: string;
  /** Why the deviation is justified. */
  justification: string;
  /** On whose authority / what evidence the exception rests. */
  basis: string;
  /** When it should be revisited (YYYY-MM-DD); optional. */
  reviewBy?: string;
  status: "open" | "resolved";
  createdAt: string;
  createdBy: string;
  resolvedAt?: string;
  /** How it was closed — the deviation ended, or was folded back into the record. */
  resolution?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** This movement's governed exceptions, newest first. */
export function readGovernedExceptions(program: ProgramSummary, movementId: string): GovernedException[] {
  const raw = readMovementInputs(program, movementId)._governedExceptions;
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isRecord)
    .map((row): GovernedException => ({
      id: str(row.id),
      scope: str(row.scope),
      justification: str(row.justification),
      basis: str(row.basis),
      reviewBy: str(row.reviewBy) || undefined,
      status: row.status === "resolved" ? "resolved" : "open",
      createdAt: str(row.createdAt),
      createdBy: str(row.createdBy) || "you",
      resolvedAt: str(row.resolvedAt) || undefined,
      resolution: str(row.resolution) || undefined,
    }))
    .filter((row) => row.id && row.scope)
    .sort((a, b) => {
      // Open before resolved, then newest first — the live deviations lead.
      if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
}

function newId(): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `gex-${Date.now().toString(36)}-${rand}`;
}

/** The list with a new exception appended (validated; returns unchanged when
 * scope/justification are empty). */
export function withNewException(
  list: GovernedException[],
  input: { scope: string; justification: string; basis: string; reviewBy?: string },
  actor: string,
): GovernedException[] {
  const scope = input.scope.trim();
  const justification = input.justification.trim();
  if (!scope || !justification) return list;
  return [
    ...list,
    {
      id: newId(),
      scope,
      justification,
      basis: input.basis.trim(),
      reviewBy: input.reviewBy?.trim() || undefined,
      status: "open" as const,
      createdAt: new Date().toISOString(),
      createdBy: actor || "you",
    },
  ].slice(-100);
}

/** The list with one exception marked resolved. */
export function withResolvedException(
  list: GovernedException[],
  id: string,
  resolution: string,
  actor: string,
): GovernedException[] {
  return list.map((row) => row.id === id
    ? { ...row, status: "resolved" as const, resolvedAt: new Date().toISOString(), resolution: resolution.trim() || `Closed by ${actor || "you"}` }
    : row);
}
