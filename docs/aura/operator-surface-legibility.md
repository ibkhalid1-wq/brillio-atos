# Aura — Operator surface legibility & honesty

Three defects on the operator surface, all the same discipline the ledger enforces
applied to presentation: it led with internal ids, its numbers contradicted, and a
button claimed a thing that didn't happen. Surface + read-model work over existing
projections and existing operator actions — nothing gated, frozen core untouched.
Verified against migrated Laila.

## Problem 1 — ids → plain-language questions

Loci rendered as raw addresses ("Value Set / attr:escalation.status#valueSet").
Now each open unknown renders as a **question a person can answer**, derived in
`src/v3/lib/ledger/phrasing.ts` from the element name + slot; the raw id moves to hover.

`questionForLocus(about, nameOf)` resolves the element's display name and maps the slot
to a template:

| Slot | Question (verified on Laila) |
|---|---|
| `valueSet` | **What values can status take?** |
| `phase` | **Which phase does staffing and resource allocation belong to?** |
| `decision` | **What decides the outcome of receive staffing request and review required skills…?** |
| `owner` | Who performs {step}? |
| `optionality` | Is {attr} required or optional? |
| `automationDisposition` | Should {step} be automated, assisted, or kept manual? |

The slot-type stays as a small tag (`Values`, `Phase`, `Decision`); the question is the
primary line. The full slot template list is in `phrasing.ts` (`Q`).

**Finding (unphrased slots):** any slot without a template falls back to "{name} —
{slot}?" (never the raw id as primary) and is collected in `UNPHRASED_SLOTS`. On Laila the
common slots (valueSet, phase, decision, owner, optionality, semantics, cardinality,
exists, automationDisposition, dataType, area, systemOfRecord) all phrase; exotic
shape-slots would surface here. Reported so the template set can grow — not a core change.

## Problem 2 — one denominator, no contradiction

Three numbers described one engagement and the first two contradicted ("21 of 21
linked/responded" = done; "0 attributed closures" = nothing answered). Fixed:

- **The burn-down is the headline, one denominator:** `355 open unknowns · 0 answered ·
  4 unowned · 11 seams`, with the convergence bar and `0 attributed closures · provisional`.
- **"21 of 21 linked/responded" removed** — it was the "21 of 21 heard" family, a
  roster count reading as completion over a ledger with 0 real closures. Demoted to a
  plain, non-progress **"21 on the roster."**
- **The inbox is the subset beneath the goal:** "3 need an owner · 10 need a session,"
  visually subordinate — four orphaned questions no longer look like the whole job.

## Problem 3 — button honesty (the real defect)

"book joint session" → "session booked" asserted a calendar event that never happened.
Audited every action label; the label now says only what the action does and the
resulting ledger state is shown.

| Was | Now | What the action actually does |
|---|---|---|
| **book joint session** | **mark for joint session** | records intent on the seam; scheduling is gated |
| **session booked** | **marked · Sales ⋈ Sales Ops · 10 questions grouped · no date yet** | states what was recorded and what's still missing |
| Assigned toast "…" | "Assigned to X — owned-and-open now (not counted as heard)" | writes an owner; item moves to Owned & in-flight |
| Schedule toast "Joint session booked" | "Marked for a joint session — {pair} (N questions). No date yet — scheduling is gated." | records intent, no date |
| "needs refresh ↻" (prior pass) | "evidence moved" | the claims under it moved; rebuild re-grounds |

No "booked/done/sent/confirmed" survives that doesn't correspond to a thing that
happened. After every action the surface shows the resulting ledger state (assign → the
new owner; mark → the grouped seam + pending-date), not just a button flip.

## Area-vs-question assignment shape

Unowned questions are **grouped by their element** (the area-cascade shape): one "assign
an owner to {element}" that **cascades** to all the element's questions (a single batch of
assign actions), not N inbox cards. Verified: Laila's 4 unowned render as **3 element
groups** — *Escalation* (1), *Escalation Management* (1), *Staffing and Resource
Allocation* (2, with "→ assign all 2"). Only a question with no possible owner drops to a
per-item decide-fate.

**Finding:** the grouping key is the locus's **parent element** (entity/workflow), a
faithful in-browser proxy for "area." A true program-**area** cascade (one prompt per
Frame area) needs an element→area projection the in-browser read model doesn't carry —
reported, not built. The parent-element grouping already removes the flooding the brief
flagged.

## F-1 — the "unowned" definition

The surface uses **unowned open unknowns** ("4 of 355", the in-browser `buildKitView`
count). The persisted ledger counts unowned **loci** (~30) — a different population. Stated
on the surface; if they must match, a new "unowned loci" projection is the fix — reported
as a finding, not made.

## Anything that suggested a core change — reported

- **F-1** (unowned definition) and the **area→element proxy** (true area cascade needs an
  area projection) and **unphrased exotic slots** — three findings, none made.
- The phrasing, header rebalance and label audit are pure presentation over existing
  reads and existing operator actions. Store, precedence, migrate, projections' data
  logic and audit trigger untouched.

**Verification:** `tsc` clean · eslint clean · live preview against `Laila CRM` — goal
reads "355 open · 0 answered · 4 unowned · 11 seams", questions render as plain language,
seams show "marked · no date yet" vs "mark for joint session", no console errors.
Screenshots in-session.
