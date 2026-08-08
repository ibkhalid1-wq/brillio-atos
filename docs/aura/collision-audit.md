# Aura — Collision-completeness audit (read-only)

**Question:** the persistence build fixed one silent cross-engagement defect — `contentId` is
program-agnostic, so a global row PK let a second program's inserts vanish through `ON CONFLICT DO
NOTHING`. Was that fix applied *everywhere*, or only where the row-count test happened to catch it?

**Verdict: COMPLETE.** Every write path that touches a ledger table is program-scoped; every `ON
CONFLICT` targets `(program_id, id)`; the only UNIQUE constraints are the composite PKs; `contentId` is
used solely as the `id` half of a composite key and nowhere as a global unique key; audit linkage
derives `program_id` server-side from the row. A two-program runtime test — both programs loaded from
the same Laila snapshot so they share the entire `contentId` key space — passed every isolation check.
**Zero findings.** Notes (provably-safe, not leaks) are listed for completeness.

Read-only: no schema changes, no code changes, no fix. The only DB writes were additive test programs
`audit-A` / `audit-B`, deleted at the end; no other program's stored ledger was touched. Source of
truth for constraints/indexes was queried live from the database, not just read from the schema file.
Harness: `scripts/ledger/collision-audit.ts` (bundle `--external:pg`, run with
`NODE_PATH=~/aura-ledger-pg/node_modules`).

---

## 1 · Every `ON CONFLICT` clause, with scoping verdict

The only code that writes ledger tables is `src/v3/lib/ledger/pgStore.ts`; the audit trigger lives in
`supabase/migrations/20260807_audit_events.sql`. Every `ON CONFLICT` in either:

| # | Location | Clause | Conflict target | Verdict |
|---|---|---|---|---|
| 1 | `pgStore.ts:61` `persistClaim` | `DO UPDATE` | `(program_id, id)` | **SAFE** — scoped; updates only the same program's row |
| 2 | `pgStore.ts:152` `persistFrom` elements | `DO NOTHING` | `(program_id, id)` | **SAFE** — scoped; the original bug, now fixed here |
| 3 | `pgStore.ts:158` `persistFrom` claims | `DO NOTHING` | `(program_id, id)` | **SAFE** — scoped; the original bug, now fixed here |
| 4 | `20260807_audit_events.sql:74` config seed | `DO NOTHING` | `(id)` on `aura_audit_config` | **SAFE** — a global singleton config row, program-agnostic *by design*; not a ledger/program row |
| — | `20260807_audit_events.sql:179` audit insert | *(none)* | append-only INSERT, IDENTITY `id` | **SAFE** — no conflict clause; every event is a fresh row |

There is **no `DO NOTHING` (or `DO UPDATE`) on any program-agnostic key** anywhere. The original
defect's shape — `DO NOTHING` on a global `id` — exists in zero places now.

## 2 · Every id-only lookup / insert / delete / constraint

Every SQL statement in `pgStore.ts` that resolves a claim/element carries `program_id`:

- `assert` existence check `where program_id=$1 and id=$2` (`:74`) — scoped.
- `patch` `where program_id=$1 and id=$2` (`:66`) — scoped.
- `liveOnLocus` / `liveClaimsAbout` `where program_id=$1 and about=$2 …` (`:54`, `:136`) — scoped.
- `orphanedClosures` (`:141-142`) scopes **both** the outer query **and** the `ledger_elements`
  subquery to `$1` — an un-scoped subquery here would let program B's elements suppress program A's
  orphans; it does not.
- `reconcile`'s orphan pass (`:123`) and both `loadReadModel` selects (`:169`, `:171`) — scoped.
- `persistFrom` inserts (`:152`, `:158`) carry `program_id` in the values and the conflict target.
- `recordRenameIntent` (`:132`) inserts `program_id`; the table's PK is an IDENTITY `id`.

**Constraints/indexes (queried live from the DB):**

| Table | UNIQUE | Verdict |
|---|---|---|
| `ledger_claims` | PK `(program_id, id)` only | **SAFE** — the sole unique key is program-scoped |
| `ledger_elements` | PK `(program_id, id)` only | **SAFE** |
| `ledger_rename_intents` | PK `(id)` IDENTITY | **SAFE** — auto-generated, not content-derived; can't collide |
| `audit_events` | PK `(id)` IDENTITY | **SAFE** — append-only; no unique on `row_pk`/fingerprints |

**Notes (reading suggests un-scoped, but provably safe — not findings):**

- `ledger_claims_live` index on `(about, world)` (partial, `where superseded_by is null`) omits
  `program_id`. It is **non-unique**, so it can neither reject nor collide a row — it only affects query
  plans. Provably safe. (Cosmetic: adding `program_id` would let more program-scoped queries use it;
  harmless as-is.)
- `buildReadModel` resolves `contradicts` by bare `id` (`claims.find(x => x.id === otherId)`,
  `pgStore.ts:184`), and `superseded_by` / `contradicts` columns store bare `contentId`s. Every one is
  dereferenced **only within a single program's already-loaded, program-scoped array** (`loadReadModel`
  fetched `where program_id=$1`). No cross-program dereference exists. Provably safe.
- `rowToClaim` drops `program_id` from the in-memory `Claim`, but those objects are only ever built from
  a program-scoped query, so the projections never see a foreign program's row. Provably safe.

## 3 · `contentId` and everything derived from it

`contentId(about, world, source, value)` is program-agnostic **by design** (the same fact in two
programs *should* hash the same). Confirmed nothing treats bare `contentId` as a global unique key: the
row PK is `(program_id, id)`; `superseded_by`/`contradicts` hold bare ids but are resolved only within a
program; there is no other table, cache, or in-memory map keyed on bare `contentId`. The design intent
(same fact → same hash) and the persistence scoping (program_id disambiguates) are consistent.

## 4 · The audit linkage

`aura_audit()` derives `program_id` **server-side from the row**:
`v_program_id := coalesce(v_new->>'program_id', v_old->>'program_id', …)`
(`20260807_audit_events.sql:122`), and the migration comment is explicit that `program_id`, `row_pk`,
and fingerprints are "server-derived from NEW/OLD and never take intent." `aura.intent` carries no
`program_id`, so it *cannot* mis-attribute — the audit row inherits its claim's own `program_id`.
`audit_events` is append-only (IDENTITY PK, no unique on `row_pk`), so two programs writing a claim with
the same `contentId` produce two independent audit rows. No cross-program write to the append-only table
is possible.

---

## Two-program runtime test — results

Both programs migrated from Laila → identical ids/abouts → **955 shared claim ids** across A and B (the
collision condition is *present*, not avoided). All checks **PASS**:

| Test | Result |
|---|---|
| **Row counts** — neither swallowed | A 955 / B 955 / total **1910**; 955 shared ids — PASS |
| **Projection isolation** — B-only marker | marker present in B, **absent from A**; A ontology view 250 elements, unchanged — PASS |
| **Same-locus, same-value closure** | A & B assert identical `contentId` `cl:22747923` → **2 distinct rows** (`audit-A:vp-A`, `audit-B:vp-B`); A's live closure `vp-A`, B's `vp-B` — **no cross-contamination** — PASS |
| **Reconcile isolation** | `reconcile(A)` applied 528; B checksum **byte-identical** before/after (`a129b4941346`) — PASS |
| **Audit isolation** | A 959 / B 958 audit rows; **0** A rows whose `row_pk` isn't an A claim; **0** B rows from a wrong table — PASS |

The sharpest test is the third: two programs writing the *same* `contentId` on the *same* locus. Under
the original global PK, one would have swallowed the other; under `(program_id, id)` they coexist as two
rows, each live only in its own program, each with its own attributed closure.

---

## Verdict

**The collision fix is complete.** No un-scoped write path, no program-agnostic unique key, no
`contentId`-as-global-key, no cross-program audit mis-attribution. Reading found every query already
scoped; running — with two programs deliberately sharing the whole key space — found no leak reading
missed. There is nothing to rank, because there is no finding: the one silent failure mode that started
this (a `DO NOTHING` on a global key, a read that returns the wrong program's rows) does not exist
anywhere else in the ledger surface.

The single note worth a future glance is the `ledger_claims_live` index omitting `program_id` — but it
is non-unique and therefore incapable of the collision class this audit was about; it is a query-plan
nicety, not a correctness gap.
