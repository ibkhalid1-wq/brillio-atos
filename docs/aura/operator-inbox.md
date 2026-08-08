# Aura — The operator inbox and stakeholder routing exits

The operator's workspace and the stakeholder's escape hatches, in one model. The
inbox is the **subset** of the ledger that needs an operator move — distinct from
the burn-down, which is the goal and lives above it. Surface + read-model work over
the existing projections; the frozen core (store, precedence, migrate, projections'
data logic, audit trigger) is untouched. Built and verified against migrated Laila.

Everything routes through one persisted, fingerprint-safe operator-action log
(`_operatorActions` on Listen, the `_deferredAsks` convention) applied as a read-model
overlay in `useProgramLedger` (`buildReadModel` over re-derived ownership/status). New
files: `src/v3/lib/ledger/operatorActions.ts`, `src/v3/components/flow/OperatorInbox.tsx`.

## Framing — burn-down is the goal, inbox is the subset (shown distinct)

Verified on Laila, the Discover surface now leads with **one denominator**:

> **The goal — close the burn-down:** `355 open unknowns · 0 answered · 4 unowned ·
> 11 seams` · 56.5% closed/weak · **0 attributed closures · provisional**

and beneath it, clearly subordinate:

> **INBOX · 3 need an owner · 10 need a session** — the small operator-action subset.

Four orphaned questions no longer look like the whole job: the goal is the 355, the
inbox is the handful that needs a move.

## The four inbox sources, each with its verb

| # | Source | Verb | Buildable now? | What it does |
|---|---|---|---|---|
| 1 | Unowned, owner exists | **ASSIGN** | ✅ | unowned → owned-and-open; grouped by element, cascades to its questions |
| 2 | Unowned, no owner | **DECIDE FATE** | ✅ | operator rules: disposition out-of-scope (reason) → `n/a`, or escalate → `blocked` |
| 3 | Seams | **mark for a joint SESSION** | ✅ (scheduling gated) | records intent; groups by function pair |
| 4 | Conflicts | **ADJUDICATE** | ◇ read-side | two live claims on one locus; frozen, no auto-winner; resolution gated |

**Verified on Laila:** assigned "What values can status take?" (Escalation) → *Leader -
Sales Operations*; unowned dropped **5 → 4** and the item moved to Owned & in-flight.
Conflicts read **0** for this program (precedence resolved cleanly) — an honest empty
state, not a hidden section.

## Reassignment — first-class, reversible, both directions

An assignment is not a closure, so it's always reversible.

- **Operator corrects own routing (now):** every owned-but-open item carries *reassign*
  (pick a new owner → supersedes) and *unassign* (→ back to unowned). The `foldOwnership`
  reducer takes the latest action per locus, so reassign/unassign just work.
- **Operator actions a stakeholder redirect/release (now):** a captured REDIRECT shows a
  one-tap *confirm → reassign to X*; a captured RELEASE unassigns (→ unowned → decide-fate).

## The stakeholder's three exits (four with request-meeting — see joint-meeting-model.md)

An owned-and-open question the holder can't or won't answer has exits beyond answering.
All are **gated** on the write path; the interim is operator capture (attributed to who
said it, marked operator-entered). No dead stakeholder buttons.

- **ANSWER** → closes it. The only exit that ticks the heard-count. (Gated; interim =
  operator-captured answer, which does **not** tick heard.)
- **REDIRECT** ("ask X") → a referral; operator confirms with one tap → reassign. Not heard.
- **RELEASE** ("not mine") → back to unowned → operator inbox as decide-fate. The honest
  signal that routing was wrong — without it a mis-assigned question sits under a name,
  owned-looking, and silently never closes. Not heard.

## The heard-count boundary — held HARD, structurally

Only a genuine stakeholder ANSWER through the system ticks the heard-count. **Assign,
reassign, unassign, decide-fate, mark-session, redirect, release, and operator-captured
entries never do** — even when attributed to a person. This is guaranteed structurally:
none of these is injected into the store that `buildHeardRegister` reads. Captures are
surface annotations; ownership actions change owner/status only, never `source`/`value`.

**Verified on Laila:** after an assign and an operator-captured answer, `heard` stayed
**0** on the Work header, the Discover goal, and the Record strip; convergence unchanged
at 56.5%. The exact seam where "21 of 21 heard" could creep back one entry at a time —
closed.

## Legibility

- **Plain-language questions** are the primary label everywhere ("What values can status
  take?", "Which phase does staffing and resource allocation belong to?"); the raw locus
  id is on hover. See [operator-surface-legibility.md](operator-surface-legibility.md).
- **Inbox count honest against the burn-down:** "3 need an owner · 10 need a session" of
  355 open — the small actionable queue reads small.
- **Three distinct treatments:** unowned (bounded orphan, denominatored), seams (purple
  joint to-do, not alarm), conflicts (amber frozen/contested).
- Button labels say only what the action does; the resulting ledger state is shown (assign
  → new owner; mark-session → "marked · N grouped · no date yet").

## F-1 — the "unowned" definition (finding, restated)

The surface shows **4 of 355** — the in-browser open-unknowns count (`buildKitView`). The
persisted server ledger counts unowned **loci** (~30) — a different population. The surface
states its definition (open-unknowns); if the two should be one number, a new "unowned
loci" projection is needed — **reported, not made**.

## Anything that suggested a core change — reported

- **F-1** (unowned loci vs open-unknowns) — a projection change, not made.
- **No core change was needed for the verbs:** ASSIGN/DECIDE-FATE are an ownership/status
  overlay via the existing read-model constructor; SCHEDULE/REDIRECT/CAPTURE are surface
  annotations; conflicts are read via the store's own `resolve`. Store, precedence,
  migrate, projection data logic and audit trigger untouched.
- **Note (not a defect):** operator actions persist via `onSaveInputs` (verified: an
  assign + capture + mark survived a hard reload). The Laila demo program therefore holds
  a few `_operatorActions` entries in that additive, fingerprint-safe workspace field; the
  stored ledger (ontology/atlas/claims/artifacts) is byte-identical and untouched.

**Verification:** `tsc` clean · eslint clean · live preview against `Laila CRM`
(assign 5→4 + persisted, heard boundary held at 0, questions render, one-denominator
header), no console errors. Screenshots in-session.
