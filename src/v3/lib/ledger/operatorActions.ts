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
import { isLive, ownerLabel, slotOf, type Claim, type Owner } from "./types";

export const OPERATOR_ACTIONS_FIELD = "_operatorActions";

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

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
/** PIN — a stakeholder LINK WAS SENT carrying this locus to this recipient, so the
 *  question is IN FLIGHT and belongs to them until it comes back, is released, or the
 *  operator decides otherwise. A pin is an EXPLICIT RULE HIT (a link went out, dated,
 *  to a named person) and therefore outranks any fresh derivation of ownership: the
 *  fold honours the pin, and a derivation that DISAGREES surfaces as an operator
 *  decision (`derivePinConflicts`), never an automatic sweep. Not a closure; the
 *  heard-count cannot move. */
export interface PinAction {
  kind: "pin";
  about: string;                 // the locus that went out on the link
  slot: string;                  // for display
  owner: { label: string; isRole: boolean };  // the recipient the question is pinned to
  /** The recipient's ROLE at send time. Lets a disagreement check tell a GENUINE
   *  re-route from a person/function pair that names the same owner in other words. */
  ownerRole?: string;
  /** The link the question rode out on, when the caller has it — the send record. */
  packId?: string;
  sentAt: string;                // ISO — when the link went out
  by: string;                    // operator who sent it
  at: string;                    // ISO
}
/** PIN-RESOLVE — the operator's EXPLICIT decision on a surfaced routing disagreement:
 *  KEEP (the pin stands; the recipient still answers what they were sent) or RELEASE
 *  (the pin is lifted and the standing derivation/assignment takes effect). There is
 *  no third path: nothing moves a pinned question without one of these. */
export interface PinResolveAction {
  kind: "pin-resolve";
  about: string;
  decision: "keep" | "release";
  /** The owner the fresh derivation/assignment wanted. A KEEP silences THAT
   *  disagreement only — a later, different one surfaces again. */
  against: string;
  by: string;
  at: string;
}
export type OperatorAction =
  | AssignAction | ScheduleAction | CaptureAction
  | UnassignAction | DecideFateAction | RedirectAction
  | PinAction | PinResolveAction;

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
 *  unowned); a decide-fate resolves it out of the inbox. Latest action wins.
 *
 *  A PIN is the exception to "latest wins": once a link carrying the locus has gone
 *  out, the pin holds until it is explicitly ENDED — by a release/unassign, by a
 *  decide-fate, or by the operator resolving a surfaced disagreement. A later assign
 *  does NOT overwrite it (that is exactly the silent sweep the pin exists to stop);
 *  it is recorded and surfaces as a decision. */
export interface LocusOwnership {
  owner?: AssignAction;
  fate?: DecideFateAction;
  /** The live pin — set while a link carrying this locus is in flight. */
  pin?: PinAction;
  /** The derived/assigned owner a KEEP decision has already been taken against, so
   *  the same disagreement isn't re-asked every render. */
  ackAgainst?: string;
}
export function foldOwnership(actions: OperatorAction[]): Map<string, LocusOwnership> {
  const m = new Map<string, LocusOwnership>();
  const get = (about: string) => m.get(about) ?? m.set(about, {}).get(about)!;
  for (const a of actions) {
    switch (a.kind) {
      case "assign": { const s = get(a.about); s.owner = a; s.fate = undefined; break; }
      // unassign (operator correction OR a stakeholder "not mine") ENDS the in-flight:
      // the link's claim on the question is over, so the pin goes with it.
      case "unassign": { const s = get(a.about); s.owner = undefined; s.fate = undefined; s.pin = undefined; s.ackAgainst = undefined; break; }
      case "decide-fate": { const s = get(a.about); s.owner = undefined; s.fate = a; s.pin = undefined; s.ackAgainst = undefined; break; }
      case "pin": { const s = get(a.about); s.pin = a; s.ackAgainst = undefined; s.fate = undefined; break; }
      case "pin-resolve": {
        const s = get(a.about);
        if (a.decision === "release") { s.pin = undefined; s.ackAgainst = undefined; }
        else if (s.pin) s.ackAgainst = a.against;   // KEEP — the pin stands, this disagreement is settled
        break;
      }
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

/** The loci currently IN FLIGHT on a sent link (pin still live). */
export function activePins(actions: OperatorAction[]): Map<string, PinAction> {
  const m = new Map<string, PinAction>();
  for (const [about, s] of foldOwnership(actions)) if (s.pin) m.set(about, s.pin);
  return m;
}

/**
 * THE send→pin derivation, in ONE place: a link that goes out carrying LOCI pins each
 * of them to its recipient. A send carrying NO loci pins NOTHING — so "in flight with
 * 0 sent questions" is unrepresentable on this path exactly as it is in TheLine's row
 * builder (`awaiting` requires `questions.length > 0`). Pure; the caller commits the
 * result through the ONE operator write path (useOperatorCommits).
 */
export function pinsForSend(input: {
  abouts: readonly string[];
  owner: { label: string; isRole: boolean };
  ownerRole?: string;
  packId?: string;
  by: string;
  at: string;
}): PinAction[] {
  if (!input.owner.label.trim()) return [];   // never pin to a nameless recipient
  const seen = new Set<string>();
  const out: PinAction[] = [];
  for (const raw of input.abouts) {
    const about = (raw ?? "").trim();
    if (!about || seen.has(about)) continue;
    seen.add(about);
    out.push({
      kind: "pin", about, slot: slotOf(about), owner: input.owner,
      ...(input.ownerRole?.trim() ? { ownerRole: input.ownerRole.trim() } : {}),
      ...(input.packId ? { packId: input.packId } : {}),
      sentAt: input.at, by: input.by, at: input.at,
    });
  }
  return out;
}

/** Does the pin AGREE with a derived owner-label — i.e. is the recipient already THAT
 *  owner, only named differently? True by name, by their role at send time, by being
 *  one party of a joint (seam) label, or via the ledger's own function mapping (passed
 *  in — never re-implemented here). Agreement means there is nothing to decide. */
export function pinAgreesWith(pin: PinAction, derivedLabel: string, functionOf?: (s: string) => string | null): boolean {
  const target = norm(derivedLabel);
  if (!target) return true;                     // nobody else claims it → no disagreement
  const names = [pin.owner.label, pin.ownerRole ?? ""].map(norm).filter(Boolean);
  if (names.includes(target)) return true;
  for (const party of derivedLabel.split("⋈")) if (names.includes(norm(party))) return true;
  if (functionOf) for (const n of [pin.owner.label, pin.ownerRole ?? ""]) {
    if (!n.trim()) continue;
    const fn = functionOf(n);
    if (fn && norm(fn) === target) return true;
  }
  return false;
}

/**
 * THE BASELINE the pins are compared against — "who would own this locus if no link had
 * gone out": the fresh derivation off the pre-overlay claims, overlaid with any standing
 * operator assignment (a bulk "assign all N" is exactly the sweep that must not move a
 * sent question). Computed ONCE and read by both the hook and its tests, so there is no
 * second notion of "what the derivation wanted".
 * Absent for a locus that is no longer an open unknown; "" where nobody owns it (a pin
 * never conflicts with no one).
 */
export function baselineOwnerLabels(claims: Claim[], assigns: Map<string, AssignAction>): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of claims) {
    if (!isLive(c) || (c.status !== "open" && c.status !== "blocked")) continue;
    if (m.has(c.about)) continue;
    m.set(c.about, c.ownerWhileOpen.kind === "unowned" ? "" : ownerLabel(c.ownerWhileOpen));
  }
  for (const [about, a] of assigns) if (m.has(about)) m.set(about, a.owner.label);
  return m;
}

/** A pinned question whose ownership a fresh derivation (or a later routing action)
 *  wants to move. The pin STILL HOLDS in the fold — this is the operator's decision
 *  queue, not a sweep that already happened. */
export interface PinConflict {
  about: string;
  slot: string;
  /** who the question is in flight to (the pin, which holds) */
  pinned: string;
  /** who ownership would be re-derived/assigned to without the pin */
  derived: string;
  pin: PinAction;
}

/**
 * Surface the DISAGREEMENTS between the pins and a fresh ownership derivation.
 * `derivedLabelOf(about)` answers "who would own this WITHOUT the pin" — "" when
 * nobody would (a pin never conflicts with no one) and "" for a locus that is no
 * longer an open unknown (answered work needs no decision).
 */
export function derivePinConflicts(
  fold: Map<string, LocusOwnership>,
  derivedLabelOf: (about: string) => string,
  functionOf?: (s: string) => string | null,
): PinConflict[] {
  const out: PinConflict[] = [];
  for (const [about, s] of fold) {
    if (!s.pin) continue;
    const derived = derivedLabelOf(about);
    if (!derived) continue;
    if (pinAgreesWith(s.pin, derived, functionOf)) continue;
    if (s.ackAgainst && norm(s.ackAgainst) === norm(derived)) continue;   // already decided: keep
    out.push({ about, slot: slotOf(about), pinned: s.pin.owner.label, derived, pin: s.pin });
  }
  return out.sort((a, b) => a.about.localeCompare(b.about));
}

/** Apply the folded operator ownership decisions over the read model's claims, as a
 *  read-model overlay (the frozen store/projections are untouched):
 *   · PIN → the recipient of a SENT link owns it, over any fresh derivation and over
 *     any later assign. This is the in-flight guarantee: a question already on
 *     someone's link cannot change hands behind the operator's back.
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
    if (s.pin) return { ...c, ownerWhileOpen: { kind: "role", role: s.pin.owner.label } as Owner };
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
