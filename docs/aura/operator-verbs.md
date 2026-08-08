# Aura — Operator verbs: Assign, Schedule, Respond

The surface redesign made the ledger's state honest and visible; it gave the
operator no way to act on it. This adds the verbs — as **surface + read-model work
over the existing projections**, against migrated Laila. Two verbs (Assign,
Schedule) are operator actions on *ownership* and are buildable now; the third
(Respond) needs the stakeholder write path and ships as the honest operator-capture
interim.

> **Superseded/extended by [operator-inbox.md](operator-inbox.md)** — the inbox folds
> these verbs into one workspace with decide-fate, adjudicate, reassignment, and the
> stakeholder exits. This document is the checkpoint that built and verified the three
> core verbs.

Frozen core untouched: an operator action is a disposition recorded through the
existing attributed-write path (a fingerprint-safe `_operatorActions` field on Listen,
the `_deferredAsks`/`_suggestedVoices` convention), then **applied as a read-model
overlay** in `useProgramLedger` (`buildReadModel` over re-pointed ownership). No store,
precedence, migrate, projection-data-logic, or audit-trigger code was changed.

## How it's wired (build once)

- `src/v3/lib/ledger/operatorActions.ts` — the action types + `readOperatorActions`,
  `applyAssignments` (re-points `ownerWhileOpen` on open claims only), `groupSeams`.
- `useProgramLedger.ts` — reads the log, applies ASSIGN over the migrated read model,
  rebuilds every projection via `buildReadModel`, and exposes `assignments`,
  `schedules`, `captures`, `capturedAbouts`.
- `src/v3/components/flow/OperatorVerbsPanel.tsx` — the three-section panel, mounted
  in Discover. Writes one action at a time through `onSaveInputs("listen", {...},
  {silent:true})` — fingerprint-safe, no artifact staling.

## Verb 1 — ASSIGN (built)

Every unowned unknown carries an owner picker (candidates = the people the kit
already knows, plus "Someone else…" to name one off-roster). Assigning writes an
`assign` action; the overlay re-points that locus's open claim owner from `unowned`
to the chosen role — **unowned → owned-and-open**.

- It records *who owns the question*, not an answer: status/source/value are untouched,
  so **nothing closes and the heard-count cannot move.**
- **Verified on Laila:** assigned `attr:escalation.severity#valueSet` → *Leader - Sales
  Operations*. The unowned count dropped **5 → 4 of 355** open unknowns, the item left
  the Assign list and appeared under Respond as owned-and-open. Heard stayed **0**.

## Verb 2 — SCHEDULE (built)

Every seam (jointly-owned pair) carries a **book joint session** control. Seams
sharing a function pair group into one session (Finance ⋈ Legal with two loci is one
booking). Styled as a **to-do, not an alarm** — purple joint tone, calm — because a
seam is a meeting to book, not a gap.

- Records the two parties + the loci to cover; **closes nothing** (the joint answer
  does, and that's the gated write path). Booked seams flip to a green "session booked".
- **Verified on Laila:** 11 seams surfaced (Sales ⋈ Sales Ops · 10 questions; Delivery
  ⋈ Finance · 6; Finance ⋈ Legal · 2; …), each groupable into one session.

## Verb 3 — RESPOND (gated — operator-capture interim, not a dead button)

An owned-and-open question waits for its owner's answer. The real close is the
stakeholder answering *through the system* → an attributed closure (gated on the model
key + binder). Interim, per the human-bridge pattern:

- The operator records an answer **captured out-of-band**, attributed to who actually
  said it, marked `dispositioned` operator-entered.
- Where a stakeholder would respond directly, the honest state is shown: *"awaiting {owner}'s
  response — captured via the team for now,"* `◇ provisional`. **No dead stakeholder button.**
- **The heard-count boundary is held hard:** an operator-entered capture is a distinct,
  visible category ("Operator-entered captures: N") and is **never** counted as heard.
  Structurally guaranteed — captures are annotations the surface carries; they are never
  injected into the store the `buildHeardRegister` projection reads.
- **Verified on Laila:** recorded a capture on the assigned severity value-set
  ("Sev1…Sev4", said by *Sales Operations lead*). Captures → **1**; heard stayed **0**
  on both the Discover strip and the Work header; convergence unchanged at 56.5%.

## Legibility

- **Unowned now carries a denominator** — "5 of 355 open unknowns nobody owns" — so a
  small orphan reads small, not as a blanket crisis. The strip's red alarm wash is gone;
  the container is neutral, unowned keeps its urgent tag but bounded by "of N".
- **Seams are a distinct to-do treatment** (purple joint), not the unowned red.

## F-1 — the definition of "unowned" (finding, restated)

The surface's number is **unowned open unknowns** (the in-browser `buildKitView`
projection): 5 of 355. The persisted server ledger counts unowned **element loci**
(~30) — a different population (elements whose ownership is unowned, regardless of open
questions). One word, two populations. The surface states the chosen definition
(open-unknowns). If the two should be the same number, that is a **projection change**
(a new "unowned loci" read), reported here, **not made**.

## Anything that suggested a core change — reported

- **F-1** above — the unowned-loci vs unowned-open-unknowns definition. Not changed.
- No other core change surfaced: ASSIGN is an ownership overlay via the existing
  read-model constructor; SCHEDULE and CAPTURE are surface annotations. The store,
  precedence, migrate core, projection data logic and audit trigger are untouched.

**Verification:** `tsc` clean · eslint clean · live preview against `Laila CRM`
(assign 5→4, capture heard-boundary held, 11 seams grouped), no console errors.
Screenshots captured in-session.
