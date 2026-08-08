# Aura — reconcile maintains ledger_elements (write-path fix)

The multi-round audit found one root cause behind two silent findings: `reconcile` wrote claims but
never maintained `ledger_elements`, so from round 2 the element table was a photograph of round 1 while
the claims moved on — stale element-driven projections (Finding A) and `orphanedClosures()` reading a
frozen table and missing real orphans (Finding B). This session applies the fix and proves it against
the live DB with the same four-round arc.

**Result: one fix closed both, exactly as diagnosed.** `orphanedClosures()` now agrees with the
reconcile report every round (R3 was report 4 vs query 2 — now 4 = 4); the ontology projection tracks the
current blob, not round 1. All five invariants still hold, element writes are audited, two-program
element isolation is clean, and every other stored program (claims **and** elements) is byte-identical.

Live Postgres; writes to `reconcile`/schema and to test program `mr-test` only. Full validate green:
`tsc` clean, `eslint --max-warnings 0` clean, 44 ledger unit tests pass.

---

## The change (element handling only — claims/precedence/concurrency/audit-trigger untouched)

**Schema (`scripts/ledger/pg-schema.sql`).** `ledger_elements` gains `dropped boolean not null default
false` (idempotent `add column if not exists`). The proven Step-1 `aura_audit()` trigger is attached to
`ledger_elements` as well as `ledger_claims`, so element maintenance is audited like any other write.
The trigger *function* is unchanged; it already derives `program_id`/`row_pk` server-side from the row.

**`PgLedger.reconcile` (`src/v3/lib/ledger/pgStore.ts`).** Signature changed from
`(incoming, incomingElementIds: Set<string>)` to `(incoming, incomingElements: LedgerElement[])` — it
needs the full elements to upsert, and derives the id set internally for the (unchanged) report pass.
After the claim loop it calls a new `maintainElements(els)`:

- **upsert** each incoming element `on conflict (program_id, id) do update … dropped=false`, with a
  `where … is distinct from …` guard so an unchanged element is a true no-op (no write, no audit row);
- **mark dropped** — `update ledger_elements set dropped=true where program_id=$1 and not dropped and
  not (id = any($2))` — elements the batch no longer produces. **The row STAYS**, marked, because a
  stakeholder closure may still point at it (that is the orphan). Nothing is ever deleted.

Every statement carries `program_id` in the row and in the `on conflict` target — the same discipline
the collision audit confirmed. One transaction, `aura.intent` set so the writes are audited.

**The two element reads now honor `dropped` (live status, not a snapshot):**
- `loadReadModel` selects `where program_id=$1 and not dropped` → the projection's element list is the
  live set (closes Finding A);
- `orphanedClosures()`'s subquery is `select id from ledger_elements where program_id=$1 and not
  dropped` → a closure on a dropped-or-absent element surfaces as an orphan (closes Finding B).

**The claim path is byte-for-byte unchanged** — assert, precedence, the per-locus advisory lock, the
recency rule, and the claim audit trigger are exactly as they were. (`persistFrom` had one safe tweak:
its `aura.intent` is now set *before* the bootstrap element inserts, so those are audited too.)

## Finding A closed — the R3 projection before/after

After R3 drops `Account` and adds `NewThingZZ`:

| | before fix | after fix |
|---|---|---|
| `Account` (dropped) in live element view | **present** (stale) | **absent** — PASS |
| `NewThingZZ` (added) in live element view | **absent** (missing) | **present** — PASS |
| ontology projection includes `NewThingZZ` (2 stored claims) | no | **yes** — PASS |
| ontology projection still shows dropped `Account` | yes | **no** — PASS |

The projection matches the claims, not round 1's photograph.

## Finding B closed — orphanedClosures() vs reconcile report, agreeing every round

| round | report | query (before fix) | query (after fix) | agree |
|---|---|---|---|---|
| R2 same-blob | 2 | 2 | **2** | PASS |
| R3 changed-blob | 4 | **2** ✗ | **4** | PASS |
| R4 back-to-orig | 3 | (n/a) | **3** | PASS |

R3 is the proof: the report caught 4 orphans (incl. `Account`, dropped that round); the frozen-table
query saw only 2. After the fix the durable query — the one the kit will actually read — sees all 4. A
closure on a dropped element now surfaces as an orphan through the query, so the human gets prompted.
(Side effect confirmed in `persistence-proof` 2.3: the dropped-`Opportunity` orphan is now
`queryable via orphanedClosures(): YES` — it was `no` before.)

## The five invariants — re-confirmed, none regressed

| # | invariant | result |
|---|---|---|
| 1 | no attributed closure lost | 4/4 accounted (C1–C4 live; C2/C3 live-but-orphaned) — PASS |
| 2 | no silent accumulation | live-generated **528 → 525 → 528 → 527** (flat) — PASS |
| 3 | orphans preserved + now queryable | report == query every round — PASS |
| 4 | precedence stable under repetition | C1 live through every regen; recency deterministic — PASS |
| 5 | audit == writes (incl. elements) | claims 964 + elements 312 = **1276** == audit INSERT **1276** — PASS |

The fix touched elements, not claims, and no claim-side invariant moved. Recency is still a benign
no-op: changed value supersedes (`gen-v1` dead, `gen-v2` live), identical batch run twice is **Δ0 rows /
Δ0 audit**. Orphan re-add (same id) is still a clean reattach.

## Element writes are audited

Attaching the trigger to `ledger_elements` makes element maintenance a first-class audited write.
Bootstrap R1 now emits 1265 audit INSERTs (955 claims + 310 elements); after four rounds, **audit INSERT
1276 == 964 claims + 312 elements** — one INSERT audit per stored row, none silent, none doubled. The
conditional-upsert guard means unchanged elements emit *no* audit row, so the count tracks real writes,
not no-ops.

## Two-program element isolation — clean

The collision-audit harness's reconcile-isolation test now checksums **claims and elements**: with two
programs loaded, `reconcile(A)` runs and program B's full ledger (claims + elements) is **byte-identical
before and after**. `maintainElements` is program-scoped in the row, the `on conflict` target, and the
dropped-mark's `where` — the un-scoped-element-write leak the last audit warned about is not
reintroduced.

## Laila / other programs untouched

Every non-`mr-test` program: claim checksum identical, element checksum identical, before and after the
arc. The fix and its test data touched nothing else.

## Did one fix close both, as diagnosed?

**Yes.** The single root cause — `reconcile` never maintaining `ledger_elements` — was the whole of it.
Maintaining the element table (with the dropped-vs-deleted distinction) and having the two element reads
honor `dropped` is one coherent change: Finding A closed through `loadReadModel`, Finding B through
`orphanedClosures()`, both reading the same now-maintained `dropped` status. No separate projection
staleness and no separate orphan-query staleness surfaced — the diagnosis held. The only judgment call
the fix added was making the dropped element *stay as a marked row* rather than vanish; deleting it would
have relocated Finding B one layer down (an unfindable orphan), which is exactly the silent-loss the
finding was about.
