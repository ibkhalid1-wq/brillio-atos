# "61 questions need an owner" — investigation

**Where it comes from (exact arithmetic, not impression).** The 61 is the surgery
program, and it is the fabrication fix (`6e523be`) working as designed — conservation,
not a counting bug:

```
before fix:  106 open = 45 → dictionary + 11 need-an-owner + 50 falsely owned by Chief
after  fix:  106 open = 45 → dictionary + 61 need-an-owner + 0 fabricated
                                          ^^ 11 + 50 = 61  (the Chief's stripped pile)
```

The Chief's 50 questions didn't vanish — they lost their fabricated "Sales Ops" owner
and became **visibly ownerless**, joining the original 11. `functionOf` (the CRM turf
table) matches **zero** clinical areas, so on surgery every non-typing open question is
now unowned. Laila is unaffected: need-an-owner there is **9** (traced on the snapshot;
conservation `16 unowned-open = 9 owner + 7 dict-unowned` holds). Trace re-run
2026-08-09 on the current code: surgery-shape role-owned = 0, conservation true on both
programs.

**What the 61 is made of** (live decomposition, reconstructed from the program's known
shape — 8 workflows / 24 steps; provisional until read live):

| slot | count | kind |
|---|---|---|
| automationDisposition | 24 | step design question |
| actorRole | 24 | step design question |
| phase | 8 | workflow — PHASE |
| decision | ~5 | step — DECISION |

So **~13 of the 61 are the PHASE/DECISION questions** the assign queue was defined for;
**~48 are step-level design questions** (automate? who does it?) that were previously
invisible only because the fabricated constant owner soaked them up.

## Finding: the definition drifted

The standing definition of "needs a human owner" is **"open unknowns whose kind is
PHASE or DECISION and whose owner is unassigned"**. It was implemented as *unowned +
open + non-typing* (`isOwnerQuestion`), with a comment noting that for Laila and
surgery the two were identical. That identity held **only because the fabricated owner
absorbed automationDisposition/actorRole**. The fabrication fix broke it: non-typing ⊃
phase/decision, and the assign queue inflated 13 → 61 with design questions.

## Remedies (decision needed — none applied)

- **A (recommended, previously flagged): atlas-grounded owner derivation.** The correct
  owners are IN THE DATA — `workflow.owner` / `step.actor` name all 8 clinical roles.
  Falling back to them where `functionOf` misses is an explicit, data-grounded rule hit
  (not fabrication) and would drain ~56 of the 61. **Caveat that blocks a naive build:**
  roster matching. A locus owned by "Anesthesiologist" matches no roster person whose
  role is "Anesthesiology Lead", so the question would leave the assign queue yet appear
  on *nobody's* list — owned-but-invisible, worse than unowned. Needs a person↔atlas-role
  binding step (exact-normalized match, or operator confirm), shipped together.
- **B (surface-only, buildable now): restore the literal definition.** Tighten
  `isOwnerQuestion` to PHASE/DECISION (assign queue reads ~13) and give the ~48 design
  questions their own **visible** bucket (like the dictionary bucket), with three-way
  conservation: `unowned-open = owner-queue + dict-unowned + design-unowned`. Nothing
  hidden, nothing double-counted; the inbox conservation test extends to three ways.
- **C (do nothing):** 61 is honest; the operator assigns via the existing per-element
  cascade (~35 element groups, not 61 clicks). Tolerable but noisy.

A and B compose: B fixes the definition drift now; A drains both buckets with
data-grounded owners after the binding question is settled.
