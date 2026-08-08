# Aura — Multi-round reconcile (against the live DB)

`reconcile` had been run exactly once. A live engagement is many rounds: assert, regenerate, assert
again on the changed ledger, regenerate again — closures accumulating, elements coming and going. This
session ran a realistic **four-round arc** against the local Postgres and measured the five cross-round
invariants, the recency rule, and orphan re-add behavior.

**Verdict, up front.** The **data layer is safe for repeated live use** — across four rounds no closure
was lost, nothing accumulated, precedence stayed stable, and the audit trail matched the writes exactly.
The recency rule is a **benign no-op**, not a leak. **But two silent cross-round defects exist in the
read/orphan layer**, both from the same root: `reconcile` writes claims but never maintains
`ledger_elements`, so the element table freezes at the bootstrap and drifts from reality every round
after. No data is lost, but the projections and the durable orphan query go quietly wrong across rounds.

Read-mostly: the only writes were the test rounds on the additive program `mr-test` (deleted at the
end). All other programs were checksummed before/after — **byte-identical** (2871 rows, checksum
unchanged). Harness: `scripts/ledger/reconcile-multiround.ts`.

---

## The four-round arc + per-round counts

- **R1** bootstrap from the Laila blob (`persistFrom(migrate(S))`).
- **R2** stakeholder asserts 3 closures — C1 grounded (`opportunity.stage#valueSet`), C2 grounded
  (`account#definition`), C3 ungrounded (`ghostzz#definition`) — then a **same-blob** regeneration.
- **R3** a **changed blob**: `Account` dropped, `NewThingZZ` added, and a tracked generated value
  changes (`gen-v1` → `gen-v2`). Reconcile.
- **R4** a closure C4 on the R3-added element, then regeneration **back to the original blob**; the R4
  batch is run **twice** to probe the identical-blob no-op.

| Round | total | live | superseded | live generated | orphans (report) | orphans (query) | audit INSERT |
|---|---|---|---|---|---|---|---|
| R1 bootstrap | 955 | 955 | 0 | 528 | 0 | 1 | 955 |
| R2 assert + same-blob regen | 959 | 955 | 4 | 525 | 2 | 2 | 959 |
| R3 changed-blob regen | 963 | 958 | 5 | 528 | **4** | **2** | 963 |
| R4 assert + regen (orig) | 964 | 958 | 6 | 527 | 3 | 3 | 964 |

Total grows by only the genuine new content (3 closures + the tracked claim + `NewThingZZ`), never by a
re-batched generation. Live-generated oscillates in a tight band (525–528) — flat, not climbing.

## The five invariants

**1 · No attributed closure lost — HOLD.** All four closures (C1–C4) present and live after every round,
each with its stated attributor (`vp-sales`, `cro`, `ghost-owner`, `new-owner`). Asserted 4, accounted 4.
C2 and C3 survive as *live-but-orphaned* (see #3) — preserved, never deleted.

**2 · No silent accumulation — HOLD.** Live-generated across the four rounds: **528 → 525 → 528 → 527**.
It does not grow. The same-blob regenerations (R2, R4) add zero net generated rows; the changed-blob
round (R3) supersedes one stale generation and adds the new element's claims. Total claim growth is
bounded to real new content. No hoarding.

**3 · Orphans behave across rounds — HOLD for preservation, but see Finding B for visibility.** C2's
element (`Account`) is dropped in R3: the closure is **preserved and flagged** (report). It is never
deleted. When R4 re-adds `Account` (same id), the report un-flags it — the closure was never detached,
so this is a clean **reattach** (no duplicate, no loss). *However*, the durable `orphanedClosures()`
query disagrees with the report every round (Finding B).

**4 · Precedence stable under repetition — HOLD.** C1 (`vp-sales`) stays live and unbeaten through every
regeneration. The tracked generated claim resolves identically each time against the same standing
state — the changed value supersedes, the identical value no-ops, deterministically.

**5 · Audit grows by exactly the writes — HOLD.** After four rounds, `ledger_claims` total **964** =
audit `INSERT` rows **964** — one audit INSERT per stored claim, no round skipped, nothing double-emitted.

## Recency verdict — BENIGN no-op (proven both ways)

The suspect, settled with row counts:

- **Changed-blob round.** The tracked locus held generated `gen-v1` after R2. R3's blob changed it to
  `gen-v2`. After R3 the locus has **two rows: `gen-v1` superseded, `gen-v2` live** — the recency rule
  *fires correctly* when a value actually changes.
- **Identical-blob round.** Running R4's batch twice: total `964 → 964` (**Δ0**), audit INSERT `964 →
  964` (**Δ0**). The identical batch is a **true no-op** — no new rows, no `ON CONFLICT` swallow, no
  duplicate. `assert` returns the existing row on the corroboration path *before* any insert, so nothing
  reaches `ON CONFLICT`.

So "barely fires on same-blob regeneration" is the **benign** reading: nothing changed, so nothing
needed superseding, and the code correctly did nothing. It is not stale accumulation.

## Orphan re-add behavior — REATTACH (correct)

Element dropped in R3, re-added with the **same id** in R4 → the closure was never detached from its
locus (the element row persists, the claim stays live), so it simply stops being flagged when the
element returns to the incoming set. **Reattach**, no duplicate, no loss — the correct outcome of the
three possible ones. The **rename case** (re-add under a *different* id) leaves the closure on the old
id, permanently orphaned rather than silently moved — also correct (reattachment there needs the unbuilt
binder, per the write-model doc).

---

## Findings — two silent cross-round defects (same root cause)

Neither violates the five invariants; neither loses data. Both are **silent** and both grow every round,
so they outrank any loud failure (there were none). Root cause for both: **`reconcile` writes
`ledger_claims` (via `assert`) but never touches `ledger_elements` — only the bootstrap `persistFrom`
does.** The element table is a photograph of round 1.

### Finding A — element-driven projections go stale after round 1 (silent)

`buildOntologyView` / `buildAtlasView` iterate `store.elements()`. After R3:

- `el:entity:account` was dropped by the regeneration but **still appears** in the read model's element
  list (stale) — the projection shows an element the current blob no longer produces.
- `el:entity:newthingzz` was **added** by the regeneration — its **2 claims are stored and queryable**,
  but it is **absent from the element list**, so the ontology projection **does not include it at all**
  (`ontology projection includes it: false`).

Since projections are the only read path (A7), a live engagement's ontology/atlas views silently drift:
added elements are invisible, dropped elements linger. Claims are safe; the *element index over them* is
frozen at bootstrap.

### Finding B — `orphanedClosures()` diverges from the reconcile report (silent)

Two orphan mechanisms disagree because they read different sources:

- the **reconcile report** flags orphans against the `incomingElementIds` **Set passed in** (current
  reality) — R3: **4** orphans;
- the **durable `orphanedClosures()` query** flags against the **`ledger_elements` table** (frozen at
  bootstrap) — R3: **2**.

The query is wrong in **both** directions:

- it **misses real orphans** — C2 (`Account`, dropped in R3) is a genuine orphan the report caught, but
  the query never surfaces it because `Account`'s element row still lingers in the table;
- it will **false-flag live closures** — a closure on a reconcile-added element (`NewThingZZ`) would be
  reported as an orphan by the query, because that element's row was never written, even though the
  regeneration actively produces it.

Orphans are "surfaced conflicts requiring a human." The report catches them for the round, but the
*durable, queryable* surface a human consults later (`orphanedClosures()`) is unreliable after round 1 —
a missed orphan is a human never prompted. Silent.

### Ranking

Both findings are **silent** and share one root cause, so one fix closes both: **`reconcile` must
maintain `ledger_elements` — upsert the elements the regeneration produces, and mark/remove the ones it
drops** (mirroring what `persistFrom` does at bootstrap, but every round). A "loud" failure would have
errored and failed safe; these instead let the read path drift while every count still looks healthy —
exactly the failure class this audit exists to catch. *No fix applied — that is a separate decision.*

---

## Verdict

**Is the write model safe for repeated live use?**

- **At the data layer — yes.** Four rounds, including changed and identical blobs and drop/re-add of a
  closed-against element: no closure lost, no accumulation, precedence stable, audit exact, recency
  benign, Laila untouched. Repeated `reconcile` does not corrupt or hoard.
- **At the read/orphan layer — not round-safe.** Because `reconcile` never maintains `ledger_elements`,
  the element table freezes at bootstrap; element-driven projections show stale/missing elements
  (Finding A) and the durable orphan query silently diverges from truth (Finding B) from round 2 onward.

First use is correct. Repeated use keeps the *claims* correct but lets the *element index and the
durable orphan surface* drift — silently. That is the thing that accumulates across rounds that does not
across one.
