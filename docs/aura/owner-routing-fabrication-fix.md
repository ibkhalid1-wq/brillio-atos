# Owner-routing fabrication — diagnosis & fix

**Symptom.** Every owner-queue question routed to one stakeholder. Surgery: Chief of
Surgery held 50/50; five roles at 0; Anesthesiology showed *in-flight / awaiting /
0 owned*.

## Diagnosis (traced, not guessed)

A person owns a question iff `functionOf(their role/label/area)` equals the ledger
owner-label stamped on the question. For open questions that label was either
`functionOf(area)` **or a hardcoded constant** `ownerFor("sales ops")`.

Trace harness: `src/v3/__tests__/ownerRoutingRegression.test.ts` (was the diagnostic).

| Population | Class (a) genuine | (b) broad-swallow | (c) fabricated constant |
|---|---|---|---|
| Surgery synthetic — Chief's pile (12) | 0 | 2 | **10** |
| Laila "Sales Ops" pile (273) | 3 | — | **270** (dataType 178, automationDisposition 46, actorRole 46) |

**Dominant class = (c) fabricated owner.** Two root causes:

1. **Fabricated constant owner (c).** `migrate.ts` stamped `ownerFor("sales ops")` on
   `dataType` (L120), `automationDisposition` (L156), `actorRole` (L157), and used a
   `"sales ops"` fallback inside `jointOrOwner` (L130/154) — an owner unrelated to the
   locus's own area. So every step's disposition/actor-role and every attribute's type
   piled onto whoever mapped to Sales Ops (the Chief).
2. **Broad-swallow (b).** `functionOf`'s rule `/sales ops|ops|operation/` false-matched
   any "…Operations" area (Surgical Operations, Perioperative Operations) into Sales Ops.

Duplicated across four sites: `migrate.ts` (the live read path), its edge mirror
`ledgerGenerator.ts` (lockstep), `adapters.ts:19`, `overrideAdapter.ts:13`.

## Fix

**(c) — no fabricated owners.** Each slot inherits its OWN element/step area owner; a
double-miss is UNOWNED, never a constant.
- `dataType` → the attribute's entity-area owner (`owner`), not `ownerFor("sales ops")`.
- `automationDisposition` / `actorRole` → the step's own owner (`stepOwner`).
- `jointOrOwner(a, b)` drops its `fallback` param: a double-miss returns `{unowned}`.

**(b) — most-specific wins.** The Sales-Ops rule now requires the sales context:
`/sales ?op/`. "Sales Ops" / "Sales Operations" still map to Sales Ops; a bare
"…Operations" maps to none and stays unowned. Verified every Laila ops/operation area
legitimately carries "Sales Ops"/"Sales Operations", so nothing regresses there.

Applied identically to `migrate.ts` **and** `ledgerGenerator.ts` (lockstep preserved —
`programTextsLockstep` green). The generator was already correct on
dataType/disposition/actorRole; `migrate.ts` had drifted worse, and is now realigned.

## Verification (before → after)

- **Surgery synthetic:** Chief owns 12 → **0**; all surgical areas map to none, so every
  surgery question is **unowned** and visible in burn-down. The false magnet is gone.
- **Laila conservation (nothing vanishes):** open **395** = dict 244 + role + joint +
  unowned, before AND after. The 34 questions that left "role" moved to their real owners
  (joint +28, unowned +6) — re-owned, not deleted. The "Sales Ops" pile fell **273 → 9**.
- **Regression test** (`ownerRoutingRegression.test.ts`, 7 cases): a locus matching two
  overlapping areas → most-specific wins; a locus matching none → unowned; **never** a
  default owner; conservation; dataType spreads across entity areas (not one owner).
- tsc + eslint clean; **1230** tests green.

## Anesthesiology in-flight / 0-owned

Root cause is the same fabrication (their sent questions were re-attributed to the Chief),
plus a **two-reads** split: engagement in-flight came from *a link pack existing*
(`awaiting`) while the owned count came from `soloByOwner`.

- **Done here (locally verifiable):** `awaiting` now requires the pack to actually carry
  questions (`TheLine.tsx` row builder), so *in-flight with 0 sent questions is
  unrepresentable* — the stated invariant.
- **Done (2026-08-10) — the PINNING RULE is built** (surface layer; frozen core untouched).
  A question on a SENT link is PINNED to its recipient (an explicit rule hit: a link went
  out, dated, to a named person), so re-derivation can never move it; a routing change that
  would affect an in-flight link surfaces as an operator decision, never a sweep.

  | piece | where |
  |---|---|
  | `pin` / `pin-resolve` verbs on the existing `_operatorActions` field | `operatorActions.ts` |
  | send→pin derivation, ONE place (0 loci ⇒ 0 pins) | `pinsForSend` |
  | fold: a pin ends only on release / unassign / decide-fate | `foldOwnership` |
  | overlay: pin beats the derivation **and** a later assign | `applyOwnership` |
  | baseline — "who would own it without the pin" | `baselineOwnerLabels` |
  | disagreement test (name · role · seam party · function map) | `pinAgreesWith` / `derivePinConflicts` |
  | the write, at the send moment, on the ONE operator path | `TheLine.tsx` `copyLink` → `useOperatorCommits` |
  | the operator DECISION row (keep / release) | `OperatorInbox.tsx` §4 `ib-pinned` |

  Proven by `src/v3/__tests__/inFlightPinning.test.ts` (23 cases) against a **real
  re-derivation**: the same atlas re-migrated with a changed `workflow.owner` moves
  `el:wf:…#phase` and `el:step:…#decision` between owners while the locus ids hold — the
  exact shape of this bug. Without a pin they move; with one they do not, and each becomes
  one inbox decision. Conservation re-checked at Laila scale (the four buckets sum to
  total-open, identical before/after an 8-question send); heard total 0 either way.

  **Judgment calls, recorded:**
  1. A later **ASSIGN also loses to the pin** and surfaces as a decision. A bulk
     "assign all N" is exactly the silent sweep the rule forbids, and the fold cannot tell
     a deliberate per-locus reroute from a group action. Cost: confirming a stakeholder
     REDIRECT on an in-flight locus is two taps (assign, then release).
  2. A **KEEP is scoped to the owner it was taken against** (`ackAgainst`), so a *different*
     later disagreement re-surfaces instead of being permanently waived.
  3. **Pins are recorded, not derived from packs.** A pack looks like a send record but is
     not a durable one — `mintInterviewPacks` drops `questionLoci` on an agenda refresh
     (`flowPortal.ts:393`) and every follow-up/review mint replaces the standing ask. The
     append-only action log is the honest record of what went out, to whom, when.

- **Still requires the live program (not reachable locally):** restoring the *specific*
  questions Anesthesiology held at link-send time in the existing Supabase blob. Packs
  minted before this change carry no pins, so they pin on their **next** send; there is
  deliberately no back-fill — inventing a send date and recipient for an old pack would be
  a fabrication. The surgery/Laila packs live in the DB, absent in this environment.

## Remaining findings (not this bug's live path, flagged not patched)

- `adapters.ts:19` `const OWNER = { role: "Sales Ops" }` — the Salesforce import stamps a
  blanket Sales-Ops owner on every imported record. Defensible for sales-domain data but a
  constant owner nonetheless; should derive per-record area or stay unowned. Not in the
  surgery/Laila read path (those don't import Salesforce).
- `overrideAdapter.ts:13` `OP_OWNER = "Sales Leaders"` — stamped on operator corrections,
  which are `closed`/`weak` (never open questions), so they never reach the owner queue.
