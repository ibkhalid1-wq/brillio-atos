# Aura — The write model (resolved on paper, before persistence)

> **SUPERSEDED (2026-08-08) — persistence is built and the A-vs-B sequencing call is made: Option A is
> LIVE.** Change now flows generator + override adapter → reconcile (`option-a-report.md`); `migrate()` is
> retired to a deprecated bootstrap/equivalence baseline. The "resolved on paper, before persistence" and
> "persistence waits on the A-vs-B call" framing below is historical. The merge (`reconcile`) landed and is
> proven multi-round, generator-fed (`reconcile-multiround.md`, `option-a-report.md`); the owner fix,
> element maintenance, and honest heard-count all shipped (`persistence-report.md`).

The cold review returned "not safe to build persistence on" for one structural reason: the write model
is undefined — `migrate()` rebuilds the ledger from the blob every time and never reads an existing
ledger, so a regeneration silently discards every ledger-side closure. This session resolves it as a
**specification, tested against the real code**, and ends with a recommendation. It writes no
persistence and nothing that round-trips. The choice is Ibrahim's.

**Headline:** the two options share one merge algorithm and one persistence contract; they differ only
in *where the incoming claims come from* and *whether migration re-runs*. The dangerous path is neither
A nor B — it is the current implicit "re-migrate with no merge," which loses closures. Adopt the merge;
then A-vs-B is a sequencing call. One case neither handles cleanly: a **rename** strands an attributed
closure, and reattaching it needs the (unbuilt) binder.

---

## The two options

**Option A — migration is a one-time bootstrap.** The blob is imported once. Thereafter every change —
including regeneration output — flows through the store as claims and is `reconcile`d by precedence, so
the no-overwrite promise applies. Migration never runs twice on a live ledger. *Requires the
claims-emitting generator (gated) to produce the incoming claims with stable ids.*

**Option B — migration is repeatable.** It re-runs on the new blob whenever artifacts regenerate, and is
therefore obligated to **read the existing ledger and merge** — preserve every attributed closure, apply
new generated claims by precedence, never overwrite. *Buildable now (migrate() exists); no dependency on
the gated generator.*

They are not as different as they look: **both feed a batch of incoming claims through the same merge**
(`reconcile`). A's batch comes from the generator; B's batch comes from re-running `migrate()`. The
persistence contract below is identical for both.

## The merge algorithm (specified and tested — `merge.ts`, `ledgerMerge.test.ts`)

Regeneration output is always `generated` (the generation contract's source ceiling), and the import
batch (data dictionary, FHIR/Salesforce adapters) is always `code-derived`. So the decision table that
actually runs is **incoming `generated` or `code-derived` vs one existing claim on the same locus** —
driven by precedence, with **three rules precedence does not have**, because `resolvePrecedence` compares
`(source × world)` and knows nothing about **time** or **provenance**.

| Existing claim on the locus | Outcome | Why |
|---|---|---|
| any source, **different world** (as-is) | **coexist-deviation** | cross-world is the deviation register's job; regeneration (to-be) never touches as-is |
| `?unknown` (open) | **fill-unknown** | the incoming value answers the open slot |
| `generated`, **same value** | **corroborate** | identical claim; one row kept |
| `generated`, **different value** (incoming `generated`) | **supersede-existing** | **recency rule 1** — the new generation replaces the stale one |
| `code-derived`, **same import provenance**, different value | **supersede-existing** | **recency rule 2 (N-4)** — the same system re-uploaded a *correction*, not a rival opinion |
| `code-derived`, **different import provenance**, different value | **coexist-conflict** | two *different* systems disagree — a genuine, routable contradiction; not flattened |
| **same value**, any two sources | **corroborate** | **rule 3 (N-5)** — agreement is one answer; the stronger source stays live, the weaker is kept as history |
| anything else | **preserve-existing** / precedence | deferred to `resolvePrecedence` — one definition of who outranks whom |

Every row is unit-tested (`mergeDecision`, `ledgerMergeProvenance.test.ts`). The "preserve-existing" row
is the no-overwrite guarantee, inherited from `resolvePrecedence` and proven by the store.

### Rule 2 — a corrected re-upload CORRECTS (N-4, decided 2026-08-11)

Before this, re-uploading a dictionary with a fixed data type left **both** readings live: one `coexist`
conflict, `burnDown.weak` +1, the slot rendering `state:"conflict"`. Meanwhile the field layer promised
the opposite — `writeDictionaryField`'s own test is titled *"re-uploading for a system REPLACES its
dictionary"*. **The field replaced; the ledger accumulated.** An operator fixing a typo was punished
for it. The ledger now honours the promise the product already makes.

**Same provenance** is read from **`closedBy.by`, and only when `closedBy.method === "import"`**
(`importProvenance` in `merge.ts`). That is the *only* field on a `Claim` that records which system a
row came from — there is no `Claim.provenance`. It is fine-grained enough for the path that matters:
`readDictionarySources` names every source from its **stored key** (`"<SoR> dictionary"`, or
`"uploaded-dictionary"` for the global one) and `writeDictionaryField` matches keys case-insensitively,
so the same system of record yields the same token on every upload while two different systems never
collide. `dictionaryProvenance()` is the single shared definition of the token, used by the emitter and
the merge rule alike.

Two limits, stated rather than guessed at:

- **An absent provenance never matches another absent provenance.** A `code-derived` claim with no
  import closure falls through to precedence and still coexists — *"I cannot tell which system this came
  from"* must not be read as *"the same system"*. The miss stays visible.
- **`migrate.ts` stamps every one of its imports `prototype`,** so for migrated rows the token identifies
  the *pipeline*, not a system of record. Telling two systems apart **within one migrate pass** would
  need a real field — `Claim.provenance` / `AssertInput.provenance`, a stable system-of-record id
  independent of `closedBy` — which is a frozen-core (`types.ts`, `store.ts`) change. Recorded below,
  not guessed at here.

### Rule 3 — two writers, one value (N-5, corrected 2026-08-11)

See "the redundant row" under corollary 2 below: this rule is what now prevents it, on the `reconcile`
path only.

**The case that breaks naive merges — a closure whose underlying generated claim disappears.** A
stakeholder asserts something about `Opportunity`; regeneration then drops `Opportunity` upstream, so the
incoming batch has no claim on that locus. The merge **preserves the attributed closure and flags it as
an orphan** (`orphanedClosures`) — it is never silently deleted. It cannot be auto-resolved: either the
removal is right (retire the assertion) or the assertion is right (the removal is wrong). This is a
**surfaced conflict requiring a human**, and it is the honest outcome for both options.

## The regeneration case, run against real code (numbers)

Migrated Laila, closed the stage set through the store as a firm assertion (`by: vp-sales`), then
regenerated (re-migrated the blob):

```
attributed closures made through the ledger, before regen:   1 (the vp-sales assertion)
  ... after the CURRENT migrate() re-runs fresh:             0   ← LOST (silent overwrite)
  ... after reconcile() merges the regeneration in:          1   ← PRESERVED
reconcile report: preservedClosures=1, filledUnknowns=394, supersededGenerated=0, orphans flagged=1
```

The 26 operator corrections survive a naive re-migrate only because they are re-derived from the
override log in the blob each run; **anything a stakeholder closes *through the ledger* after migration —
the entire point of the ledger — is lost by the current re-migrate, and preserved by `reconcile`.** For
a live engagement that is every stakeholder assertion, not one. Both A (store-merge) and B
(read-existing-merge) call the same `reconcile` and preserve it; only the current no-merge path loses it.

## The two corollaries the review raised — resolved per option

Both corollaries resolve **identically for A and B**, because both share the store and the merge.

**1 · The store is not append-only — a write is a read-modify-write across the locus.** `assert` mutates
prior claims (`supersededBy`, and `status = "blocked"` on a bound loser). So a claim **cannot be a
persist-once immutable row.** Two shapes are possible; the shipped store is the first:

- **Mutable rows (matches the shipped code).** A `claims` row with mutable `status` / `supersededBy`. A
  write = *read the live claims on this `about`, run precedence, update the losers, insert the new row* —
  atomic across the locus. **Concurrency control required:** serialize writers per locus — a transaction
  holding a lock keyed by the locus (e.g. `SELECT … WHERE about = $1 FOR UPDATE`, or a Postgres advisory
  lock on `hashtext(about)`). Lock scope is **one `about`**, not the table — different loci never
  conflict, so contention is low. The store interface does not express this today; persistence must add it.
- **Append-only events (matches the audit philosophy, heavier reads).** Never mutate; a supersession is a
  new event; the live set is *folded* from events per locus at read. This makes the ledger append-only
  like the audit table, but pays the fold cost on every read — compounding the O(n²) projection finding.

Either is viable; **the mutable-rows shape is the least surprise given the shipped store, and its
concurrency requirement is a per-locus lock.** This is a persistence-binding decision, the same for A and B.

**2 · `contentId` hashes the source, so an "upgrade" is a new row, not an update.** A generated value a
stakeholder later confirms becomes an `asserted` claim with the same `about`/`world`/`value` but a
**different id** (source is in the hash). This is handled as *two rows, precedence decides* — correct,
and what the store already does (the asserted row wins; the generated is superseded). **What breaks:**
any external reference that holds a **claim id** across a source change goes stale. Therefore a
persistence layer must make durable foreign keys reference **element ids or `(about, world)` tuples,
never claim ids.** (Internally, `contradicts`/`supersededBy` hold claim ids and are filtered by
`isLive`, so a stale link is harmless; the rule is only for *durable/external* references.)

**The redundant row — CORRECTED 2026-08-11 (N-5). This document was wrong.** It previously said an
upgrade with the same value leaves "a redundant row the projection hides — cosmetic, not a correctness
issue". **The projection does not hide it.** `projections.ts:179-188` builds the burn-down from *every
live claim*:

```
const closed = all.filter(c => c.status === "closed").length;
const weak   = all.filter(c => c.status === "weak").length;
const open   = all.filter(c => c.status === "open" || c.status === "blocked").length;
const total  = closed + weak + open;
```

So a duplicate identical closure inflates **both the numerator and the denominator**: one answer is
counted as two rows, `total` grows by one, and `pctClosed` / `pctSettled` both skew. Concretely — a
`generated · weak` value that a stakeholder later confirms as `asserted · closed` with the *same* value
reads `total 2 · closed 1 · weak 1 · pctClosed 50.0` where the honest answer is `total 1 · closed 1 ·
pctClosed 100.0`. A fully-answered locus reports half-answered. That is a correctness issue, not a
cosmetic one, and it gets worse the more machine pre-fill a stakeholder agrees with.

The mechanism: `store.ts:97` gates precedence on `valueConflicts`, which requires the two values to be
substantive **and unequal**. Two writers who *agree* therefore never call `resolvePrecedence`, so neither
supersedes and both rows stay live.

**What was done about it.** Preventing the row beats hiding it, so the duplicate is now collapsed at
**write** time on the one path outside the frozen core — `reconcile` (`merge.ts`, rule 3 above). After
`assert` returns, any live claim on the same locus *and same world* carrying an equal substantive value
is put to `resolvePrecedence` — the question it would have been asked had the two disagreed. On a clean
`wins` the weaker row is retained as **history** (`supersededBy`, never deleted, attribution intact). On
`escalate` or `coexist` **both rows stay live**: where the lattice cannot decide, flattening would erase
a routable signal.

**What is NOT fixed, and why.** `reconcile` is not the only writer. A duplicate created by two direct
`store.assert` calls — the operator-action and disposition paths — still leaves two live rows, because
the gate that causes it is in `store.ts`, which is frozen. This is pinned by a test
(`ledgerMergeProvenance.test.ts`, *"FROZEN-CORE FINDING, still true"*) so it cannot drift unnoticed. The
precise edit, for when the core is opened, is recorded under **Frozen-core findings** below.

## Audit vs ledger — the system-of-record distinction (stated once)

They are, and must remain, **different stores answering different questions:**

- **The audit log (`audit_events`, Step 1)** is **append-only, trigger-enforced, immutable.** It is the
  system of record for **who changed what, when** — the mutation history. It is never projected into
  believed-state; it is the forensic trail.
- **The claims ledger** is **mutable (or event-folded) and precedence-resolved.** It is the system of
  record for **what is currently claimed and how certain it is** — believed state and its provenance-
  by-source. It is queried and projected.

A ledger write **produces** an audit event; the audit event **is not** the ledger. **Do not conflate
"the audit log is append-only" with "the ledger is append-only"** — the ledger needs mutable
supersession that the audit table forbids. If the ledger were forced append-only "to match audit," it
would either lose precedence resolution or duplicate the audit's job. One is the trail; the other is the
truth-as-currently-claimed.

## The owner-fabrication fix (specified, not built) — and the honest Laila numbers

`ownerFor` bottoms out in `return { role: "Sales Ops" }` and can emit neither `unowned` nor `joint`, so
every migrated ledger shows **0 unowned, 0 seam** — the kit's two loudest signals, suppressed. The fix:

- **Emit `unowned`** where the element's area maps to no known function (no `area`, or an area string
  matching no function) — replace the `return Sales Ops` default with `return { kind: "unowned" }`.
- **Emit `joint(A ⋈ B)`** where a locus is **genuinely shared**, by a stated rule:
  - a **relation** `A→B` whose endpoint entities have **different primary functions** → its claims
    (cardinality/optionality/semantics) are owned `fn(A) ⋈ fn(B)`;
  - a **workflow step or handoff** whose actor-area differs from the workflow's owning area → that
    crossing claim is `fn(area) ⋈ fn(actorArea)`.
  "Primary function" = the first function its area string maps to (Laila entities carry multi-area
  strings; the first match is the owner, the crossing is the seam).

**Honest Laila numbers** (independent recompute under the rule above, over entity/attribute/relation
loci — *not* the shipped code, which I did not change):

```
shipped (fabricated):   role 955 · unowned 0 · joint 0
under the fixed rule:   role ~871 · unowned ~24 · joint ~60   across 8 distinct seams
seams surfaced: Finance ⋈ Legal · Delivery ⋈ Finance · Delivery ⋈ Legal · Delivery ⋈ Sales ·
                Alliances ⋈ Sales · Finance ⋈ Marketing · Finance ⋈ Practices · Finance ⋈ Sales
```

The fabricated **"0"** becomes **~24 unowned and ~60 joint claims across 8 seams — Finance ⋈ Legal among
them**, the documented Contract→Revenue seam the cold review said should appear. (Lower bound: the
recompute excludes workflow-crossing seams, which would raise `joint` further.) **That number, not "0,"
is the true distance-from-readiness the kit should show.**

## Recommendation, with evidence

**Adopt the merge algorithm now; make migration read-existing-and-merge (Option B) as the interim; retire
it to a one-time bootstrap (Option A) when the claims-emitting generator lands.** Evidence:

- **The persistence contract is identical for both** (mutable rows + per-locus lock; durable FKs on
  element ids / `(about,world)`), so choosing B now does not foreclose A — no rework at the persistence
  layer when the generator arrives and migration retires to bootstrap.
- **B is buildable today** (`migrate()` + `reconcile` both exist and are tested); A depends on the gated
  generator. Shipping persistence should not wait on the edge.
- **A is the cleaner end state** — once generation emits claims directly, re-running a blob→ledger
  migration is a legacy concept; bootstrap-once is simpler and removes a whole class of re-migration
  churn (e.g. content-derived step ids shifting on text edits, which B must absorb every run).

So: **B until the generator; A after.** The one thing that must land before persistence regardless is
`reconcile` (the merge) replacing the current no-merge re-migrate — without it, B loses closures exactly
as the current code does.

## What the merge report states (and what it used to lie about)

`MergeReport` is the caller's only evidence of what a reconcile actually did. It is **one type**
(`mergeRules.ts`), filled by both `merge.reconcile` and `PgLedger.reconcile`, so a field cannot exist on
one runtime and be silently absent on the other — which is precisely what F4 turned out to be:

| Field | Means |
|---|---|
| `applied` | rows processed from the batch |
| `preservedClosures` | attributed closures that survived an incoming conflict (the no-overwrite guarantee, counted) |
| `supersededGenerated` | stale generations replaced by newer ones — recency rule 1 |
| `correctedReimports` | earlier `code-derived` rows superseded by a later import from the **same** provenance — recency rule 2 (N-4). Never counts a different system's disagreement |
| `collapsedDuplicates` | live rows collapsed because a second writer landed the **same** value — rule 3 (N-5) |
| `filledUnknowns` | open `?unknown` slots the batch answered |
| `newClaims` | rows added that neither filled an unknown nor met a closure |
| `deviations` | incoming claims that, once live, stand in a **cross-world deviation** on their locus |
| `orphanedClosures` | attributed closures about elements the regeneration dropped |

**`deviations` was a dead branch until 2026-08-11 (N-11).** `reconcile` filtered `liveBefore` to
`c.world === input.world` and *then* asked whether that list contained an `as-is` claim while
`input.world === "to-be"` — unsatisfiable, so the field could only ever read `0`. A real cross-world
deviation was registered by `buildDeviationRegister` and reported as `0` by the very merge that created
it: two readers, two contradictory numbers. It was **fixed, not deleted** — a number that cannot move is
worse than no number, and deviation reporting is a thing the merge genuinely knows. The incoming claim is
now compared against the live claims of the **other** world using the *same predicate the register uses*
(`scalar`/`ref`/`ref-list` on both sides; the incoming value matching none of the other world's values),
so the two counts are one number rather than two. Pinned by
`expect(rep.deviations).toBe(buildDeviationRegister(store).length)`.

## Frozen-core findings — the edits to make when the core is opened

`store.ts`, `types.ts`, `precedence.ts` and `projections.ts` are frozen. Three changes belong in them and
were **not** made; each is recorded here with the exact edit.

**F1 · `store.ts:97` — agreement should still resolve precedence (N-5, the root cause).** The
`reconcile`-side collapse above fixes one write path; every other caller of `assert` still creates the
duplicate. The root fix is one line:

```ts
// current — an AGREEING pair never reaches precedence, so two live rows remain
if (!valueConflicts(x.value, claim.value)) continue;

// proposed — agreement is one answer: resolve it, keep the loser as history
if (!substantive(x.value) || !substantive(claim.value)) continue;
if (valueEq(x.value, claim.value)) {
  const rEq = resolvePrecedence({ source: claim.source, world: claim.world }, { source: x.source, world: x.world });
  if (rEq.outcome === "wins") {                       // escalate/coexist: leave BOTH live — the
    if (rEq.winner === "a") x.supersededBy = claim.id; // lattice cannot decide, so nothing is flattened
    else claim.supersededBy = x.id;
  }
  continue;
}
```

Same change in `PgLedger.assert`, which mirrors this loop for the persisted path. **It must land on
both at once.** `pgStore.ts` is not frozen and the edit could be made there alone today — which is
exactly what would recreate F4: `assert` would collapse an agreeing pair in Postgres and not in memory,
and the two ledgers would again disagree about a number. The two `assert`s are a matched pair; F1 waits
for the core to open.

**F2 · `projections.ts:179-188` — count answers, not rows.** F1 is the better fix (prevent the row); if
instead the counting is to be made defensive, the burn-down must de-duplicate by locus before counting:

```ts
// current: const all = store.claims().filter(isLive);
// proposed: one row per (about, world) — the STRONGEST live claim on it — so an agreeing
// duplicate cannot inflate both the numerator and the denominator.
const best = new Map<string, Claim>();
for (const c of store.claims().filter(isLive)) {
  const k = `${c.about}|${c.world}`;
  const prior = best.get(k);
  if (!prior || (strengthRank[c.source] ?? 0) > (strengthRank[prior.source] ?? 0)) best.set(k, c);
}
const all = [...best.values()];
```
Note this also changes what a *genuine* coexist conflict contributes (one row, not two) — which is a
product decision about whether an unresolved contradiction should read as one open question or two, and
is **not** decided here.

**F3 · `types.ts` / `store.ts` — a first-class provenance field.** N-4's rule reads provenance out of
`closedBy.by`, which works because every `code-derived` producer happens to set `method: "import"` and a
system token. It is a convention, not a contract: nothing stops a producer from writing a person's name
there, and `migrate.ts` writes `prototype` for every system it merges. The durable fix is
`provenance?: string` on `Claim` (and on `AssertInput`, threaded through `assert`), carrying a stable
system-of-record id set by each adapter. `importProvenance()` in `merge.ts` would then read that field
and fall back to `closedBy.by` for rows written before it.

**F4 · `pgStore.ts` — the persisted path had a different merge. ~~Reported.~~ CLOSED 2026-08-11.**

F4 was raised as one line: `closedBy` sat *inside* a trailing `//` comment in `rowToClaim`, so every
claim rehydrated from Postgres came back with `closedBy === undefined` — and because N-4 reads provenance
out of `closedBy.by`, **the correction rule could not fire on the persisted path at all**. That one-liner
was fixed and pinned by `pgRowToClaimComplete.test.ts` (a source-level scan: if the row carries it, the
claim must carry it back).

Fixing it exposed the larger finding underneath. `PgLedger.reconcile` was a **second, independent merge
implementation** carrying its own recency rule and **none of N-4, N-5 or N-11** — its `MergeReport` did
not even declare `correctedReimports`, `collapsedDuplicates` or `deviations`. So the in-memory ledger and
the persisted ledger disagreed about what a re-uploaded dictionary *means*: one definition per number,
violated across a runtime boundary rather than within a file, which is the place no gate was looking.

**The fix is not a second copy of the rules — it is one copy.** `mergeRules.ts` now holds every merge
DECISION as a pure, synchronous, `pg`-free predicate (`recencySupersedes`, `recencyKind`,
`collapseDecision`, `deviates`, `valueEq`/`substantive`, `isAttributedClosure`, and the single
`MergeReport` shape). `merge.ts` and `pgStore.ts` keep only what genuinely differs — sync object mutation
vs a locked transaction and `update … set superseded_by` — and ask that module what every claim means.
Two consequences worth stating:

- the persisted path's decisions became **testable without a database**, which matters because this repo
  has never had one in its suite;
- three counting divergences unrelated to the named rules fell out with them: `pgStore` tested
  `filledUnknowns` against the whole locus rather than the input's world, counted every applied input as
  a `newClaim` even when `assert` added no row, and compared values with a different equality than
  `merge.ts` did (see F5).

Pinned three ways by `mergeRulesLockstep.test.ts`: the predicates called directly; a **source lockstep**
that fails if either file re-declares a rule or stops *calling* one (absence, not wrongness, was the
original defect); and an end-to-end run of `PgLedger.reconcile` against a query shim, compared
field-for-field with `merge.reconcile` over a 9-locus batch. **What that shim does not prove is stated in
its header** — it models `superseded_by` liveness, `coalesce` patch semantics and jsonb key reordering,
and throws on any SQL it does not recognise, but it is not Postgres: locking, transaction isolation, the
`aura.intent` audit trigger and FK behaviour remain unverified here and are **not** claimed otherwise.

**F5 · `store.ts:18` / `projections.ts:246,253` — value equality is `JSON.stringify`, which is
order-dependent.** Postgres `jsonb` stores object keys by (length, bytewise), not insertion order, so the
same value read back from the database and the same value straight from a batch stringify differently.
`mergeRules.valueEq` is therefore order-independent (`canonical`), and both merges now use it. The frozen
core still uses the bare compare in two places:

```ts
// store.ts:18 — proposed
import { valueEq } from "./mergeRules";        // delete the local const

// projections.ts:246,253 — proposed: the same import, then
const asIsVals = new Set(asIs.map((c) => canonical(c.value)));
…
if (asIsVals.has(canonical(t.value))) continue;
```

Where the two spellings disagree, `canonical` is correct and `JSON.stringify` is the false negative —
never the reverse — so the divergence can only under-report agreement (a spurious conflict, a spurious
deviation), never invent it. It is latent today because in-memory values are built at construction sites
with stable key order; it becomes reachable the moment a projection is run over a ledger loaded through
`PgLedger.loadReadModel`. `MergeReport.deviations` is pinned equal to `buildDeviationRegister(store)`, so
if this is left unfixed while a projection reads persisted rows, that identity is where it will show.

## The single case neither option handles cleanly

**A rename strands an attributed closure.** Element ids are name/content-derived; renaming `Opportunity`
→ `Deal` changes its id, so a stakeholder's assertion sits on the *old* id while regeneration lands on
the *new* one. The merge preserves the old closure (never deletes it) and flags it orphaned — but it
**cannot move it to the renamed element**, because that requires a rename map (old-id → new-id) that only
the **binder** provides, and the binder is not built. So a rename produces a surfaced orphan that a human
must reattach, and the reattachment cannot be automated pre-binder. This is inherent to both options and
is the honest residue: the write model is safe (no silent loss), but **rename-reattachment is a gated
follow-on, not solved here.**

---

*Stop. Persistence waits on the A-vs-B sequencing call and on `reconcile` landing in place of the
no-merge re-migrate. Both are Ibrahim's to schedule; this session specified and tested the design, it
did not build persistence.*
