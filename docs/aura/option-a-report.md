# Aura — Retire migrate(), run Option A end to end, clear the safe backlog

Autonomous run against the live Postgres + Deno 2.9.5 (both verified present first). Commit-per-item,
tests green each time. The frozen ledger core (store, precedence, reconcile, audit trigger) stayed
untouched except where a genuine core bug was surfaced as a finding and fixed via the finding→task path
(§2). Everything below is numbers off the live DB.

---

## 1 · migrate() retired — Option A is the live path

`buildOptionABatch` (`supabase/functions/_shared/optionA.ts`) is the canonical construction path:
generator + override adapter, each validated at its own boundary, merged for the proven reconcile.
`migrate()` is `@deprecated` — kept callable only as the equivalence baseline; nothing new routes
through it.

**Cold from an empty ledger** (`scripts/ledger/retire-migrate.ts`): reconcile `buildOptionABatch(Laila)`
(generated 1251 · dispositioned 56 · code-derived 4 · 318 elements) into an empty program, vs the
`migrate()` bootstrap, per live locus:

| | count |
|---|---|
| same source | **552** |
| different source (honest `code-derived`→`generated`) | 398 (`exists` 211, `touches` 104, `cardinality` 35, `systemOfRecord` 33, `area` 14, `semantics` 1) |
| only `migrate()` produces | **1** |
| only generator+adapter produces | 347 (`optionality` 178, `valueSet` 147 — the fuller unknowns) |

The **single** only-migrate locus is `el:wf:entity-profile#operatorCorrected`: the log entry
`Entity edited: "Entity Profile"` — migrate resolves the element by `entIdByName.get(name) ?? el:wf`, and
since that entity was removed the lookup misses and it lands on `el:wf:entity-profile` (wrong); Option A
resolves by the note's **declared kind** → `el:entity:entity-profile` (correct). Same claim, better
attribution — **not** a claim migrate uniquely produces. Nothing regressed to the heuristic. Laila
byte-identical. **migrate() is retireable.**

## 2 · Multi-round Option A, generator-fed — the real usage pattern

`scripts/ledger/optiona-multiround.ts`: a 4-round arc where each regeneration is `buildOptionABatch` over
changed inputs, interleaved with stakeholder closures. **All five invariants hold generator-fed:**

1. **no closure lost** — 4/4 accounted (incl. live-but-orphaned);
2. **no accumulation** — total 1304 → 1307 → 1320 → 1321 (same-source Δ3); live-generated flat
   1250 → 1248 → 1255 → 1248;
3. **orphans report == query every round** — 1/1, 2/2, 4/4, 3/3;
4. **precedence stable** — the asserted C1 survives every regeneration;
5. **audit exact** — 1321 claims + 320 elements == 1641 INSERT rows.

**Element maintenance generator-fed:** after R3 dropped Account + added NewThingZZ, Account is absent from
the live element view and NewThingZZ present; C2 (on dropped Account) preserved+live. **orphanedClosures()
matches the reconcile report every round.**

**A core bug this surfaced — and its fix (finding→task, not papered over).** The first run showed
generator-fed re-reconcile spuriously superseding ~107 generated *ref* claims (touches/unresolved-ref/
ref-list) per round. Root cause: reconcile's `valueEq` used `JSON.stringify`, but Postgres `jsonb`
reorders object keys by length, so a batch `{kind:"ref",to:"x"}` reads back as `{"to":"x","kind":"ref"}`
and compares unequal — firing the recency rule. Scalars were unaffected (`kind`<`value` already). It was
masked before because migrate emitted refs as `code-derived` (the generated-only recency rule skipped
them); Option A emits them `generated`, exposing it. Per the stop condition this is a **frozen-core
finding** — I reported it, did **not** patch it mid-item, and spawned `task_faf4824c`. That task's fix
(`valueEq` → a canonical, key-order-independent compare) landed; I **verified** it (churn gone — live-
generated flat above; blob-fed multi-round still green; 44 unit tests pass; Laila untouched) and committed
it separately (`ffe4cf7`).

## 3 · The safe deferred-pile read-model fixes (3a–3d) — all cleared

`buildDeviationRegister` (`projections.ts`), read-model only, core untouched. 4 CI tests (over
`buildReadModel` controlled read models) + a live-DB confirmation.

- **3a — ref-list ignored → fixed.** The substantive filter now includes `ref-list`, the shape imports
  emit. **Proven over the live DB (`loadReadModel`):** a Salesforce picklist (as-is ref-list) vs a FHIR
  value set (to-be ref-list) now registers a deviation (it silently could not before).
- **3b — `[0]` multiplicity → fixed.** Each to-be claim is compared against the *full set* of as-is
  values; one deviation per differing to-be claim, so coexisting values are all surfaced, none hidden.
- **3c — corruptible `backed` → fixed.** Classification reflects the *specific* deviating claim's source,
  not any coexisting one — a truly-unbacked `generated` change stays `unbacked` even when a `document`
  claim coexists on the locus.
- **3d — silent name-join → surfaced.** The removed-element ↔ unresolved-ref match is now marked
  `stillReferencedVia: "name-candidate-unverified"`. A *clean* structural link needs the binder (not
  built); per the prompt this **marked-and-surfaced interim** is the accepted outcome — it is no longer a
  silent name join. *(This is the one deferred item whose clean fix needs the binder; flagged, interim
  shipped.)*

Heard-count untouched (read-model-only changes). tsc + lint + 48 tests green.

## 4 · Housekeeping

- **Background branches confirmed-redundant.** No task worktree/branch exists in this repo; every unique
  contribution is in HEAD — contentId `\x01` + alias/owner/trigger (`b736f8e`), canonical `valueEq`
  (`ffe4cf7`). Safe to discard; not discarded here (nothing to discard in-repo).
- **Claims register clean.** `claims:regen` guard + `claimsRegister.test.ts` pass; no product-facing claim
  wording drifted from the new state (the register tracks grounding/traceability claims, not ledger
  mechanics). The heard-count caveat (**26** attributed closures, per-area still coarse) is unchanged by
  this session and stays accurate.
- **Superseded docs marked.** `ledger-generation-contract.md` ("gated, no Deno, implemented nowhere") and
  `ledger-write-model.md` ("resolved on paper, before persistence; waits on A-vs-B") now carry SUPERSEDED
  banners pointing to the built state; bodies kept as historical record.

## Anything that suggested a core change — reported

- The **`valueEq` jsonb bug** (§2) — a real reconcile core bug. Reported as an Item-2 finding, fixed via
  the finding→task path (`task_faf4824c`), verified non-regressing, committed separately. Not papered over.
- The **migrate `operatorCorrected` attribution quirk** (§1) — a migrate heuristic, not a ledger issue;
  Option A's declared-kind resolution is the cleaner behavior. No change needed.
- **3d's clean structural link** needs the binder — interim marked-and-surfaced, as sanctioned.

## What now stands between here and full Option A

Two things, and I confirm nothing else crept onto the list:

1. **The live model key** — this run's generator proposed content deterministically over Laila's existing
   artifacts (no edge Anthropic key). Production Option A swaps that one step for a model reading raw
   documents; same contract, validator, and reconcile path. Provisioning, not buildable here.
2. **The binder** — reference/rename resolution (and the clean 3d structural link). Its own session.

The persistence substrate is complete and proven: write model exercised across rounds blob- and
generator-fed, no loss, no accumulation, precedence stable, elements maintained, orphans findable and
query==report, collisions isolated, everything audited, migrate retireable, and the deferred read-model
pile cleared. Everything Option A needs downstream of the batch already works.
