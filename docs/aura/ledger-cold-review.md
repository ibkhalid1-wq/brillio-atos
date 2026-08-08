# Aura — Cold hostile review of the claims-ledger structure

An outside read of the artifacts and code, run against the five pressure points with concrete cases.
Read-only; nothing changed. Experiments bundled the shipped `precedence.ts` / `migrate.ts` / `store.ts`
/ `projections.ts` / `adapters.ts` and ran them against Laila's committed snapshot and against
constructed as-is-heavy inputs the migration never produces.

**Verdict up front:** *not yet safe to build persistence on.* Two things force a change **before**
persistence — the write model (a re-migration silently discards ledger-side closures) and migration's
owner fabrication (the kit's core signal is suppressed at birth). Both are demonstrated below with
inputs and outputs. The precedence lattice itself largely holds.

---

## 1 · The world machinery is validated at n=4 — and n=4 hid two register defects

**What the migration produced:** 951 to-be claims, **4 as-is** — and all 4 as-is claims are
`el:removed:*#exists`, source `code-derived`. So the entire **as-is half of the per-world precedence
vector is exercised by exactly one source class**, and every mechanism keyed on as-is/to-be
(deviation register, confirm-or-deviate) has run almost entirely on the to-be side.

**Case A — dense both-worlds, coexisting to-be claims.** One locus, one as-is value + two *coexisting*
generated to-be values (`TOBE-1`, `TOBE-2`, both live — precedence coexists same-source):

```
live to-be values on locus: [ 'TOBE-1', 'TOBE-2' ]
deviation register reports toBe = [ 'TOBE-1' ]      // TOBE-2 is invisible
```

`buildDeviationRegister` compares `asIs[0]` vs `toBe[0]` — **array order, ignoring precedence and
multiplicity.** With sparse worlds (one claim per locus each) this is always right by accident. Make a
locus dense and the register silently reports one arbitrary claim and hides the rest. At n=4 as-is this
could never surface.

**Case B — the register is blind to `ref-list` (the value-set case imports produce).** As-is stages
`[Prospecting, Qualification]` vs to-be `[Discover, Scope, Win]` — a real, material value-set deviation:

```
deviation register catches it?  false     // ref-list is filtered out of asIs/toBe → invisible
```

The register's filter is `value.kind === "scalar" || "ref"` — it **excludes `ref-list`**. But a
Salesforce picklist imports as `ref-list` and a FHIR/standard value set imports as `ref`/`ref-list`, so
the *primary* deviation an import produces — "your current stages vs the target's" — **cannot register.**
The one machine that surfaces cross-world value disagreement is blind to the exact shape the import
adapters emit. n=4 hid this because no import had been run into the migrated ledger.

**Case C — `backed` is computed inconsistently.** The register reports `toBe[0]`'s *value* but classifies
`document-backed` from `.some()` over *all* to-be claims:

```
reports toBe='DOC-OTHER' but classification='document-backed'
// a genuinely unbacked generated CHANGE is masked as deliberate by a different, coexisting doc claim
```

A truly unbacked change can be labelled "deliberate" because some *other* claim on the same locus is
document-sourced. The register's core signal — deliberate vs unbacked — is corruptible by multiplicity.

**Where it held:** the precedence *function* itself behaves identically at any density (it is per-pair
and pure — density doesn't touch it). The defect is entirely in the deviation register's selection
logic, not the lattice.

---

## 2 · "0 unowned" is the migration's default, not a result (CONFIRMED — suppressed at birth)

**Case:** migrate Laila, count ownership kinds.

```
owner kinds: { role: 955 }        // every claim
unowned claims: 0
joint(seam) claims: 0
kit bands: all 6 are kind "function" (Sales Leaders, Sales Ops, Finance, Marketing, Delivery, Legal)
```

`ownerFor(area)` in `migrate.ts` is a total area→role map whose **final line is
`return { kind: "role", role: "Sales Ops" }`.** It can return neither `unowned` nor `joint`. So:

- The documented **Legal×Finance unwitnessed seam** — a slot no single person owns — is assigned to
  "Legal" or "Finance" by keyword match. It never surfaces as `unowned`, and never as the joint
  `Legal ⋈ Finance` the kit's seam band exists to show.
- The kit's **two most important signals — unowned (pinned, loud) and seam (joint)** — are **structurally
  absent from any migrated ledger.** The lens renders six function bands and zero of either.

This is the review's sharpest concrete contradiction: the implementation report cites "0 unowned" beside
a queue of 406 items, and the surrounding docs describe stakeholders as single-area with unwitnessed
seams. Those cannot both be true. **The "0" is the fabricated default masking the real answer** — which
is "we do not know who owns most of these," i.e. a large *unowned* population the kit is designed to make
loud. Persisting fabricated ownership hard-codes the suppression.

**Where it held:** the *ownership model* (role / joint / unowned as first-class) is sound and the kit
projection renders all three band kinds correctly when they exist (verified by constructing joint/unowned
owners directly). The defect is only that **migration never emits the two that matter.**

---

## 3 · The write model does not exist, and the no-overwrite promise does not cross a re-migration

This is the finding most likely to force a structure change.

**Case:** migrate Laila → assert a stage set *through the store* as a firm closure → re-migrate from the
same blob (what happens whenever an artifact regenerates):

```
after asserting through the store:  closed by 'vp-sales', status 'closed'
re-migrate() from the blob → the asserted closure survives?  false
```

`migrate()` builds a **fresh store from the blob every time** and never consults an existing ledger. The
store's central promise — *a generated claim can never supersede an asserted closure* — is proven and
holds, but **only within one store instance.** The path that brings new/regenerated data into an
*existing* ledger is either (a) re-migration, which **discards every ledger-side assertion** (shown
above — the exact overwrite the project exists to prevent, moved up one level), or (b) a merge through
`store.assert`, which **is not built and not specified** — the generation contract describes it in prose
but nothing runs it, and `migrate.ts` does not use it.

Two structural corollaries the read-only proof could not reach:

- **The store is not append-only.** `assert` mutates *prior* claims (`x.supersededBy = claim.id`,
  `x.status = "blocked"`). A persistence adapter therefore cannot treat a claim as an immutable row — an
  insert is a read-modify-write across the whole locus, so concurrent writers on one locus need a
  transaction/lock the interface does not express. "Append-only event log" language elsewhere in the
  codebase does not describe this store.
- **A claim's identity encodes its source.** `contentId` hashes `(about, world, source, value)`. So
  "the same fact, upgraded generated→asserted" is a *different id*, not an updated row — correct for the
  lattice, but it means a persistence layer must reconcile "two rows, same locus, precedence decides"
  rather than "update in place," and any external reference to a claim by id breaks when its source
  changes. The write model has to be designed around this, not discovered after.

**Where it held:** intra-store, the promise is real and tested. The gap is that *migration and the store
are two write paths into one ledger with no reconciliation*, and only one of them honours the promise.

---

## 4 · Precedence totality — mostly honest, one genuine gap

`resolvePrecedence(a,b)` is pure and total. Pressed for cells where a confident answer hides missing
context:

- **`escalate` and `coexist` are honest hedges, not silent-wrongs.** Two conflicting assertions →
  `escalate`; two conflicting documents → `coexist`. Both *surface* the conflict rather than deciding it.
  That is the honest behaviour when the two claims lack deciding context. This half holds.
- **The genuine gap: `wins` is an unroutable silent overwrite, and `regulation` wins with no
  applicability gate.** `R("regulation","to-be","document","to-be")` → regulation wins, loser → history,
  **silently** — there is no "wins but low-confidence" or "wins, surfaced" outcome; a win demotes the
  loser with no routable trace. The lattice trusts the *label* `regulation` and the *locus placement*
  absolutely: a **mis-scoped or mislabelled regulation claim** (a data-entry or import error — nothing
  gates it; the generation contract's source-ceiling guards only the generator, not imports or manual
  entry) **silently beats a correct `document`/`code-derived` claim and buries it in history.** Because
  `wins` is not routable like `escalate`/`coexist`, nothing asks a human to check. This is the
  silent-wrong class the project exists to kill, reachable through the one outcome that doesn't surface
  itself.

  This is narrower than a "the lattice is a lie" claim — the lattice is right about the *class* layer;
  it cannot see *instance* facts (does this regulation apply, is this label correct), and it has no
  low-confidence-win to express that limit.

**Where it held:** the six documented hard cases resolve as claimed; escalate/coexist are legitimate;
determinism holds. The gap is the absence of an applicability gate and a surfaced/low-confidence win.

---

## 5 · The reification read-tax has a measured O(n²) floor

**Case:** measured `buildOntologyView` on the migrated ledger, then on the ledger cloned ×2/×4/×8:

```
Laila (310 el / 955 claims):  buildOntologyView 10–12 ms · buildAtlasView 5 ms · buildDeviationReg 0.2 ms
  x2:  521 el / 1453 claims →  28.5 ms
  x4:  943 el / 2449 claims →  84.6 ms
  x8: 1787 el / 4441 claims → 276.6 ms
```

Claims ×4.65, elements ×5.76, time **×27** — i.e. **O(elements × claims) ≈ O(n²).** The cause is in
`slotViews`: for each element it filters *all* claims, and for each `about` it calls `store.resolve` →
`liveClaimsAbout` → *another* full-claims scan. The projection *does* hide the reification from the
reader, but it is code that runs on every build, and the lens re-`migrate()`s + rebuilds on every open.

Extrapolated to a genuinely large engagement (~20× Laila ≈ 6k elements / 19k claims) a full ontology
projection is **~2–3 s** to build — per open, uncached. Not a correctness bug, but an un-budgeted
performance floor on the honesty: the more slots you make into first-class claims, the more a projection
costs, quadratically.

**Where it held:** the numbers are small enough that Laila and near-term engagements are fine
(milliseconds). This is a floor to measure and cap, not a fire.

---

## Findings found by reading, not on the list

- **The deviation register does a name join — the one thing the structure forbids.** `stillReferenced`
  is computed as `referencedNames.has(el.name.toLowerCase())`, matching a removed element to an
  unresolved-ref **by lowercased name.** The spec's first constraint is "no name joins; an unresolvable
  reference is a first-class object." Here the register silently name-matches; two removed elements
  sharing a name, or a coincidental match, mis-flags. It is semi-forced (unresolved-refs carry only a
  name) but it is an *unmarked* name join in the module that reports coherence.
- **32-bit content ids collide at ~114k claims** (measured; birthday bound ~82k). When two *distinct*
  claims hash-collide, `store.assert` finds the existing id and returns it as "identical — corroboration,"
  **silently dropping the second, different claim.** Per-engagement (~1k claims) this is negligible; a
  fleet-wide or pooled store, or a very large engagement, is exposed. Scope decides severity — but the
  failure mode (a distinct claim silently swallowed) is the bad kind.
- **`migrate` mis-buckets an edited-then-removed entity.** For `"Entity edited: X"` it uses
  `entIdByName.get(name) ?? el:wf:${slug(name)}` — if X is not a current entity it files the correction
  under a *workflow* id. Minor data-quality noise.

---

## The single thing most likely to force a structure change — and when

**The write model (Point 3): re-migration vs merge is undefined, and the store's no-overwrite guarantee
does not survive a re-migration.** This forces a decision **before persistence**, because it is a
question about the *shape* of every future write, not a bug in a read model:

- If migration is a **one-time bootstrap** and all later change flows through `store.assert`, then the
  merge path (generation output → existing store) must be built and is the critical untested piece — and
  the store must become effectively append-only-with-supersession for persistence to be safe.
- If migration is **repeatable** (re-run when artifacts regenerate), then it must *merge and preserve*
  attributed closures — which it does not, and cannot without reading the existing ledger.

Either way the answer changes the store/persistence contract. Once edits round-trip to a database, a
wrong choice here is data loss, not a refactor. **Point 2 (owner fabrication) is co-urgent** but smaller
in blast radius — it is a `migrate.ts` correction (emit `unowned`/`joint` instead of a default role), not
a change to the tiers — yet it too must land before persistence, or the persisted ledger encodes false
ownership from birth.

Everything else — the deviation register defects (1), the O(n²) projections (5), the precedence
applicability gate (4), the name-join and id-collision reads — are **after-persistence** fixes: they live
in derived read models or are scope-bounded, and can be corrected without rewriting stored data.

## What I attacked and it held

- **The precedence lattice math** — per-world vectors, the six hard cases, escalate/coexist as honest
  hedges. Density does not perturb it; determinism holds.
- **The core store promise within a store** — a generated claim cannot supersede an asserted closure.
  Real and tested; the failure is only that migration bypasses it.
- **The tier structure** — nothing in these findings requires a tier to move or a new tier. The defects
  are in migration logic, a read model, and the (unbuilt) write path — not in the five tiers.
- **The ownership *model*** — role/joint/unowned is the right vocabulary; only migration's use of it is wrong.

## Plain verdict

**Not safe to build persistence on yet.** Fix two things first, both before edits round-trip:

1. **Define the write model** and make the no-overwrite promise survive whatever migration becomes
   (merge that preserves attributed closures, or a one-time bootstrap plus a built generation-merge
   path). This is the structure decision — it belongs to Ibrahim, not this session.
2. **Stop migration fabricating owners** — emit `unowned`/`joint` where ownership is genuinely unknown or
   shared, so the persisted ledger carries the real signal instead of a default.

The deviation register (ignores `ref-list`, picks `[0]`, inconsistent `backed`, name-join), the O(n²)
projection floor, and the precedence applicability gate are real but **post-persistence** — they are
derived and cheap to change later. The lattice and the tiers earned their holds.
