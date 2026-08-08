/**
 * Operator verbs — ASSIGN / SCHEDULE / RESPOND(capture) — as a SURFACE layer over
 * the read model. An operator action is a disposition recorded through the existing
 * attributed-write path (a fingerprint-safe `_operatorActions` field on Listen,
 * exactly like `_deferredAsks` / `_suggestedVoices`), then applied over the migrated
 * read model here. The frozen core (store, precedence, migrate, projections, audit
 * trigger) is untouched: ASSIGN re-derives ownership over the read model; SCHEDULE
 * and CAPTURE are annotations the surface carries, never injected as ledger closures.
 *
 * Why capture is NOT a store write: an operator-entered capture must not count toward
 * the heard-count (heard = a genuine stakeholder closure). If it were injected as a
 * `dispositioned` closure it would be counted by `buildHeardRegister` (dispositioned ∈
 * attributed sources) — the exact boundary the brief says to hold. So captures live
 * here as a distinct, visible category and never enter the store the projections read.
 */
import type { Claim, Owner } from "./types";

export const OPERATOR_ACTIONS_FIELD = "_operatorActions";

/** ASSIGN — route an unowned unknown to a person/role. Records who it's now on;
 *  does NOT close it and does NOT touch the heard-count. */
export interface AssignAction {
  kind: "assign";
  about: string;                 // the locus (claim `about`) being assigned
  slot: string;                  // for display
  owner: { label: string; isRole: boolean };  // the new owner
  by: string;                    // operator who assigned
  at: string;                    // ISO
}
/** SCHEDULE — mark a seam (a joint-owned pair) for a joint session. Records the two
 *  parties and the loci to cover; closes nothing (the joint answer does, and that's
 *  the gated write path). */
export interface ScheduleAction {
  kind: "schedule";
  pair: string;                  // "A ⋈ B" — the seam owner label
  parties: [string, string];
  abouts: string[];              // the loci the session covers
  by: string;
  at: string;
}
/** CAPTURE — the stakeholder-ANSWER interim: an answer captured out-of-band and
 *  entered by the operator, attributed to who actually said it, marked operator-entered.
 *  NEVER the same as a stakeholder's attributed answer, and never counted as heard. */
export interface CaptureAction {
  kind: "capture";
  about: string;
  slot: string;
  answer: string;
  saidByName: string;
  saidByRole: string;
  by: string;                    // operator who entered it
  at: string;
}
/** UNASSIGN — the operator corrects their own routing back to unowned, OR actions a
 *  stakeholder RELEASE ("not mine"). Reversible; not a closure; never counts as heard. */
export interface UnassignAction {
  kind: "unassign";
  about: string;
  /** "operator" = operator corrected own routing · "release" = actioned a stakeholder's release. */
  reason: "operator" | "release";
  saidByName?: string;           // for a captured release
  by: string;
  at: string;
}
/** DECIDE-FATE — an unowned unknown nobody can own. The operator does NOT answer; they
 *  decide: disposition out-of-scope (reason recorded) or escalate. An honest trace. */
export interface DecideFateAction {
  kind: "decide-fate";
  about: string;
  slot: string;
  decision: "out-of-scope" | "escalate";
  reason: string;
  by: string;
  at: string;
}
/** REDIRECT — the stakeholder-REDIRECT interim: the holder said "ask X instead". A
 *  captured referral naming the right owner. The operator confirms with one tap, which
 *  writes an `assign` to that owner. Not an answer; never counts as heard. */
export interface RedirectAction {
  kind: "redirect";
  about: string;
  slot: string;
  toOwner: string;
  saidByName: string;
  by: string;
  at: string;
}
export type OperatorAction =
  | AssignAction | ScheduleAction | CaptureAction
  | UnassignAction | DecideFateAction | RedirectAction;

/** Read the operator-action log off the program (fingerprint-safe Listen field). */
export function readOperatorActions(listenInputs: Record<string, unknown> | undefined): OperatorAction[] {
  const raw = listenInputs?.[OPERATOR_ACTIONS_FIELD];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OperatorAction[]) : [];
  } catch {
    return [];
  }
}

/** Serialize for the write path (append + cap, newest kept). */
export function serializeOperatorActions(actions: OperatorAction[]): string {
  return JSON.stringify(actions.slice(-500));
}

/** Fold the action log into the latest ownership state per locus. Ownership is
 *  reversible: an assign sets the owner; a later unassign/release clears it (back to
 *  unowned); a decide-fate resolves it out of the inbox. Latest action wins. */
export interface LocusOwnership { owner?: AssignAction; fate?: DecideFateAction; }
export function foldOwnership(actions: OperatorAction[]): Map<string, LocusOwnership> {
  const m = new Map<string, LocusOwnership>();
  const get = (about: string) => m.get(about) ?? m.set(about, {}).get(about)!;
  for (const a of actions) {
    switch (a.kind) {
      case "assign": { const s = get(a.about); s.owner = a; s.fate = undefined; break; }
      case "unassign": { const s = get(a.about); s.owner = undefined; s.fate = undefined; break; }
      case "decide-fate": { const s = get(a.about); s.owner = undefined; s.fate = a; break; }
      default: break; // capture/schedule/redirect don't change ownership state
    }
  }
  return m;
}

/** The active owner assignments (loci currently owned via an operator routing). */
export function activeAssignments(actions: OperatorAction[]): Map<string, AssignAction> {
  const m = new Map<string, AssignAction>();
  for (const [about, s] of foldOwnership(actions)) if (s.owner) m.set(about, s.owner);
  return m;
}

/** Loci the operator decided the fate of (out-of-scope / escalate) — resolved out of
 *  the assignable inbox, kept as an honest trace. */
export function decidedFates(actions: OperatorAction[]): Map<string, DecideFateAction> {
  const m = new Map<string, DecideFateAction>();
  for (const [about, s] of foldOwnership(actions)) if (s.fate) m.set(about, s.fate);
  return m;
}

/** Apply the folded operator ownership decisions over the read model's claims, as a
 *  read-model overlay (the frozen store/projections are untouched):
 *   · ASSIGN → re-point `ownerWhileOpen` (unowned → owned-and-open). NOT a close.
 *   · DECIDE-FATE out-of-scope → status `n/a` (the slot no longer applies).
 *   · DECIDE-FATE escalate → status `blocked` (held for a named authority).
 *  None of these is a stakeholder answer, so `source`/`value` are untouched and the
 *  heard-count cannot move. Returns a NEW array (no mutation). */
export function applyOwnership(claims: Claim[], fold: Map<string, LocusOwnership>): Claim[] {
  if (!fold.size) return claims;
  return claims.map((c) => {
    const s = fold.get(c.about);
    if (!s) return c;
    if (c.status !== "open" && c.status !== "blocked") return c; // only open unknowns are ownable/decidable
    if (s.owner) return { ...c, ownerWhileOpen: { kind: "role", role: s.owner.owner.label } as Owner };
    if (s.fate?.decision === "out-of-scope") return { ...c, status: "n/a" as Claim["status"] };
    if (s.fate?.decision === "escalate") return { ...c, status: "blocked" as Claim["status"] };
    return c;
  });
}

/** Back-compat helper (tests): apply only ASSIGN. */
export function applyAssignments(claims: Claim[], assigns: Map<string, AssignAction>): Claim[] {
  if (!assigns.size) return claims;
  return claims.map((c) => {
    const a = assigns.get(c.about);
    if (!a) return c;
    if (c.status !== "open" && c.status !== "blocked") return c;
    return { ...c, ownerWhileOpen: { kind: "role", role: a.owner.label } as Owner };
  });
}

/** Group SCHEDULE-eligible seams by function pair — Finance ⋈ Legal with two loci is
 *  one session, not two. Returns pair → the loci it covers. */
export function groupSeams(items: Array<{ about: string; ownerLabel: string }>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const it of items) {
    const list = m.get(it.ownerLabel) ?? m.set(it.ownerLabel, []).get(it.ownerLabel)!;
    list.push(it.about);
  }
  return m;
}
