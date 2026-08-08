# Aura — Override-log import adapter

The generator lands `generated`. Full retirement of `migrate()` needs the claims the generator correctly
*won't* emit: the `code-derived` and `dispositioned` claims from the engagement's own override log.
Faking them through the generator would launder the source, which the ledger forbids — so they get their
own adapter, the third alongside Salesforce and FHIR. This session builds it: local, deterministic, no
model, proven against the live DB. The frozen core (store, precedence, audit trigger) is untouched.

**Verified:** `deno check` clean on the adapter + validator, Node `tsc` clean, `eslint --max-warnings 0`
clean, 44 ledger unit tests green, run against the live Postgres.

---

## The adapter + the source class it assigns per override-log entry

`supabase/functions/_shared/overrideAdapter.ts` reads the override log and emits the same batch shape
reconcile consumes (`{ elements, claims }`, `AssertInput`-shaped). Source class by entry kind — **never
`asserted`, never `generated`**:

| Override-log entry | Emits | Source class |
|---|---|---|
| `Entity removed: "X"` | `el:removed:X#exists = true` (the source HAD it) | **`code-derived`** (as-is) |
| | `el:removed:X#exists = false` (operator's removal) | **`dispositioned`** (to-be) |
| `Entity/Workflow edited: "X"` | `X#operatorCorrected = <note>` (a touch with a who, no verbatim) | **`dispositioned`**, weak/closed-without-verbatim |
| `Workflow "X" moved to area "Y"` | `el:wf:X#area = Y` (a specific value correction) | **`dispositioned`** |
| `Relation added/removed: "A rel B"` | `el:rel:A-B#exists = true/false` (+ semantics) | **`dispositioned`** |

Every dispositioned claim is `weak` with a `closedBy` that has a `by` (the operator) and **no verbatim** —
the closed-without-verbatim form, distinct from a stakeholder assertion.

## The batch over real Laila — claim counts by source class

49 log entries → **47 classified, 2 skipped** (bare area-companion notes with no keyable slot — recorded,
not fabricated):

- by kind: entity-removed 4 · entity-edited 28 · workflow-edited 1 · workflow-moved-area 1 ·
  relation-added 9 · relation-removed 4 · skipped 2
- **by source class: `dispositioned` 56 · `code-derived` 4** — zero `asserted`, zero `generated`.
- 60 claims total. **Validation (import mode) PASS.** Laundering guard: marking one override `asserted`
  is **rejected by the same validator** (`source-ceiling`).

Notably, **migrate reads only 33/49** entries (Entity removed + X edited); it silently drops the
moved-to-area (1) and all relation add/remove (15). The adapter captures 47/49 — a fidelity gain over
migrate, not a gap.

## Reconcile against the stored ledger

Reconciled generator ∪ override into a clean Option-A program:

- **Sources correct**: `code-derived` 4 live, `dispositioned` 49 live, `generated` 1210 live. The
  override-derived claims land with their own classes; nothing laundered.
- **Prior stakeholder assertion survives**: the log moved a workflow to area *Marketing* (`dispositioned`);
  a stakeholder then asserts *Sales*. After re-importing the override, the live winner is
  **`source=asserted` value=Sales by=vp-sales** — the operator override did **not** beat the stakeholder
  assertion. Precedence held.
- **Heard-count preserved**: stakeholder-heard (asserted/document/regulation/precedent) **1 → 1**,
  unchanged by the import; **0 asserted claims came from the override batch**. Overrides do not inflate
  the stakeholder heard-count. (Nuance below.)
- **Invariants**: audit exact (claims 1265 + elements 318 = **1583 == 1583** INSERT rows).
- **Laila and every other program byte-identical.** Test programs cleaned up.

## migrate() equivalence — is it retireable?

Compared generator ∪ override vs `migrate()` per live locus:

- **363 loci identical** (same source).
- **294 loci, source honestly reclassified**: `exists` 211, `cardinality` 35, `systemOfRecord` 33,
  `area` 14, `semantics` 1 — all things `migrate` marked `code-derived` that the generator marks
  `generated`. This is an **improvement**: the model proposed them, so `generated` is honest;
  `code-derived` only belongs to a real code import (Salesforce), not to migrate's extraction.
- **600 loci only generator+override**: dominated by `optionality` 178 + `valueSet` 147 — the fuller
  unknown emission (the inversion). Improvement.
- **294 loci only migrate** + the step slots' presence in *both* only-lists → **not yet equivalent**,
  for reasons that are **generator gaps, not adapter gaps** (findings below).

**Verdict: the override-claims gap is closed correctly by this adapter, but `migrate()` is NOT yet
retireable** — three things the *generator* must gain first (all reported, none in scope here). Once it
does, generator + override = migrate, with honest sources.

---

## Findings — surfaced, not acted on (the structure is frozen; the generator is a separate component)

1. **Generator `contentId` bug (headline).** The store's `contentId` (`types.ts`) joins parts with a
   **`"\x01"` (SOH) separator** — invisible in a normal file view. The generator's copy (built last
   session) joins with `""`, so `contentId("el:step", …)` **does not match the store**. Every generated
   **step id is wrong**: `migrate` and the generator produce 46 steps each with **zero shared ids**.
   Effect: generated step claims land on different loci than the store's, so a stakeholder closure on a
   store-native step would not survive a generator regeneration. This is the whole reason step slots
   (`touches`/`action`/`actorRole`/`automationDisposition`, ~242 claims) appear in *both* only-migrate and
   only-optionA. **Fix: one character** — the generator's `contentId` must join with `"\x01"` (better:
   import the store's `contentId` instead of copying it). Out of scope this session (generator code);
   reported. *The override adapter is unaffected — all its ids are slug-based.*

2. **Generator omits `workflow#owner`, `workflow#trigger`, and `entity#alias.*`.** `migrate` emits these;
   the generator does not (owner 14, trigger 14, plus aliases). Real coverage gaps for full parity —
   generator changes, reported.

3. **The validator was generalized (shared guard).** Reusing the generator's validator for a second
   source class required parameterizing it (`allowedSources` / `requireSlotCompleteness` / `allowClosedBy`
   / `checkElementIds`). Defaults preserve the generator's behavior exactly — re-run confirms **640
   unknowns, PASS, the same 8-error malformed rejection**. This is a *shared-validator* generalization,
   **not** a change to generation logic or the ledger.

4. **Heard-count definition nuance.** The prompt's invariant — overrides don't move the heard-count —
   holds cleanly for **stakeholder-heard** (asserted/document/regulation/precedent): 1 → 1. But the
   current `isHeardClosure` (from the 2.7 fix) *also* counts operator `dispositioned` closures, so the
   adapter's fuller capture makes the disposition-inclusive count **49** (vs migrate's ~26). Per this
   session's own framing — *an operator override is not a stakeholder's attributed answer* — the honest
   heard-count should **exclude operator dispositions**. Suggested projection refinement, reported.

*Nothing suggested a change to the frozen ledger core.* The adapter conformed to it exactly (`AssertInput[]`
+ `LedgerElement[]`, validated, reconciled, invariants held). Every finding above is in the *generator* or
the *heard-count projection*, not the store/precedence/audit.

---

*Built: `overrideAdapter.ts` (edge adapter), generalized `ledgerGenerator.ts` validator (shared guard),
`scripts/ledger/override-round.ts` (end-to-end proof). The store, precedence, reconcile, and audit trigger
were not touched.*
