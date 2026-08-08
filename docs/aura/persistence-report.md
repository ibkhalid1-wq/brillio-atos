# Aura — Persistence build: DONE, run against a real Postgres

**Status: built and proven.** Phases 1 and 2.1–2.7 ran against a live local PostgreSQL
(embedded-postgres **18.4**, `127.0.0.1:5433`, db `aura_ledger`) — no cloud account, no sudo. Every
number below is a `SELECT` against stored rows, not a paper estimate. The one thing this session was
built to produce — *everything that behaved differently in the database than on paper* — is the last
section; it is the reason the session ran against a real DB rather than the mock.

**What is NOT built (per the prompt, deliberately):** Step 1b intent wiring across the app's write
paths; reattachment of renamed closures (needs the binder); the claims-emitting generator;
post-persistence read-model rework beyond wiring the projections. The write model stays **Option B**
(migration reads-existing-and-merges via `reconcile`); **Option A** lands when the generator does.

Harness (local Postgres only, never the live engagement blob): `scripts/ledger/persistence-proof.ts`
(2.1–2.3), `owner-proof.ts` (2.4), `persistence-proof2.ts` (2.5–2.7). Adapter
`src/v3/lib/ledger/pgStore.ts`; schema `scripts/ledger/pg-schema.sql`. All 44 ledger unit tests green;
`tsc` clean; `eslint --max-warnings 0` clean.

---

## Phase 1 — audit foundation (applied + verified first)

Committed `5443903`. The Step 1 migration (`20260807_audit_events.sql`) + the 14-check kit ran in the
same database, **24 verification rows PASS / 0 FAIL** via `scripts/ledger/apply-step1.mjs`: trigger
fires on the three state-bearing tables; direct `authenticated` inserts to `audit_events` denied;
SECURITY-DEFINER intent reaches the trigger; reversible on populated data; actor-provenance (JWT wins
for client, intent-actor only for service-role, mismatch recorded); re-apply idempotent. The ledger is
built **on top of** this: every ledger write emits an append-only `audit_events` row through the same
`aura_audit()` trigger.

## Phase 2 — persistence, proven with stored numbers

### 2.1 · persistence adapter + the no-overwrite core promise
- `persistFrom(migrate(Laila))` → **310 elements / 955 claims** stored in ~190ms; `SELECT count` MATCH.
- **Audit linkage:** `audit_events` holds **955** `ledger.bootstrap` rows (one per stored claim) + **11**
  `ledger.write` rows from the subsequent asserts — the trigger fires on every ledger write.
- **No-overwrite HELD:** a stakeholder closes `opportunity.stage#valueSet` firmly (`asserted`,
  `by: vp-sales`); a regeneration then asserts a *different* `generated` value on the same locus. In the
  stored rows the generated claim is `superseded_by` the closure; the closure is the sole live row.
  **A `generated` claim cannot overwrite an attributed closure — proven against Postgres, not asserted.**

### 2.2 · concurrency (per-locus advisory lock)
Each write is one transaction holding `pg_advisory_xact_lock(hashtext(program_id#about))` (transaction-
scoped) with `aura.intent` set. Four **concurrent** generated writers (2 distinct values) raced one
locus that already carried a seeded `by: cro` closure. Result: the closure **survived every race** and
is the **sole live row**; all three competing generated rows (one pre-existing bootstrap definition +
two new values) are `superseded`. **No closure lost; outcome deterministic** — the lock serialises
writers per `about`, so different loci never contend.

### 2.3 · reconcile against the stored ledger
- Reconciled **528** regenerated `generated` claims in ~436ms: `preservedClosures=2`,
  `supersededGenerated=2`, `filledUnknowns=394`, `newClaims=132`. The `vp-sales` stage closure is
  **preserved** after regeneration.
- **Orphan case** (regeneration drops `Opportunity` upstream): the attributed closure on
  `el:entity:opportunity#definition` is **preserved**, **flagged** in the merge report, **and queryable**
  via `orphanedClosures()` (returns it; total 1). Never silently deleted.

### 2.4 · owner-fabrication fix, run into the DB
`migrate.ts` no longer bottoms out in `return {role:"Sales Ops"}`. A `functionOf()` maps an area/actor
to a primary function or **null → `unowned`**; a relation whose endpoints have different functions, and
a step whose actor-area differs from its workflow area, emit **`joint(A ⋈ B)`**. Stored numbers (955
claims):

| owner.kind | stored | paper (lower bound) |
|---|---|---|
| role | 836 | ~871 |
| unowned | **30** | ~24 |
| joint | **89** | ~60 |
| distinct seams | **11** | 8 |

**Finance ⋈ Legal present (11 claims)** — the documented Contract→Revenue seam the cold review said
must appear. The fabricated "0 unowned / 0 joint" is gone. Stored seams, by weight: Marketing⋈Sales 23,
Practices⋈Sales 22, **Finance⋈Legal 11**, Delivery⋈Finance 9, Legal⋈Practices 6, then Alliances⋈Sales,
Finance⋈Sales, Delivery⋈{Practices,Marketing,Sales}, Marketing⋈Practices at 3 each.

### 2.5 · rename intent, durable
`recordRenameIntent(old, new, by)` writes `ledger_rename_intents`. Two intents
(`opportunity→deal` by vp-sales, `account→client-org` by cro) were **read back through a fresh pool
connection** (a later session), both **timestamped** — durable, not in-memory.

### 2.6 · projections over the stored ledger + cost
`loadReadModel()` builds a read model from **955 claims / 310 elements in 6.5ms**; the existing sync
projections run over it unchanged:

| projection | cost | result |
|---|---|---|
| unknown queue | 6.8ms | 406 unknowns (blocking 166, unowned 5, blocked 11) |
| kit view | 0.7ms | 19 bands, 57.5% closed |
| ontology view | **15.2ms** | 250 element views |
| atlas view | 7.7ms | 14 workflows |
| deviation register | 0.7ms | 4 deviations |

**Parity IDENTICAL** to the in-memory projection (queue 406, burn-down closed 549, 250 element views) —
the stored ledger projects exactly as the in-memory one. The ontology view is the heaviest (the known
O(n²)), but at Laila scale everything is sub-16ms.

### 2.7 · honest heard-count
`buildKitView` + new `buildHeardRegister` now count only **attributed human closures** (`isHeardClosure`:
attributed source, non-import method, human `by`), not the machine `{by:"prototype", method:"import"}`
imports migrate stamps on nearly every slot.

- **honest heard = 26** (the operator corrections) · **old conflated closed|weak = 549**.
- The old register **overstated "heard" by 523** machine imports.
- Per area: all 26 under **Sales Leaders** (see divergence #4 below).

### RLS read-visibility (enumerated)
Engagement-scoped, owner-only. With two claims stored under a program owned by user A: **owner A sees 2,
non-owner B sees 0 — ENFORCED**. Policy: `program_id in (select id from adam_programs where owner_id =
auth.uid())`, from table creation.

---

## Everything that behaved differently in the database than on paper

1. **The shipped `LedgerStore` is synchronous; persistence is inherently async.** Postgres forced an
   `AsyncLedgerStore` (the `PgLedger` class) that the sync interface can't express. Resolved without
   rewriting the projections: `loadReadModel()` snapshots stored rows into a sync read model the
   projections consume unchanged. *This is the first and most structural divergence.*

2. **`contentId` is a program-agnostic content hash, so a global row PK collides across engagements.**
   The paper's rule was "durable FKs reference element ids / `(about,world)`, never claim ids." True, but
   it missed that the *row's own primary key* is `contentId` — program-agnostic. Two engagements
   migrating the same blob share claim/element ids; a global `id` PK made the second program's inserts
   collide and vanish via `ON CONFLICT DO NOTHING` (owner-proof stored **0 rows** until this was found).
   **Fix: PK is `(program_id, id)`; every conflict target and id lookup is program-scoped.** This defect
   was invisible on paper and only surfaced against a real second program in a real DB.

3. **Owner numbers exceed the paper's lower bound, in the predicted direction.** Paper: ~24 unowned /
   ~60 joint / 8 seams (explicitly a *lower bound*, "excludes workflow-crossing seams"). Stored: 30 / 89 /
   11 — higher because the DB run *includes* the step actor-vs-workflow-area crossings the paper excluded
   (Marketing⋈Sales, Practices⋈Sales dominate) and `functionOf` added the Alliances/Practices functions
   the seam vocabulary needs. Direction and the flagship Finance⋈Legal seam match; magnitude is larger
   and honest.

4. **Honest heard-count is per-owner but not yet truly per-area.** All 26 human closures land under
   `Sales Leaders` because `migrate` attributes *every* operator override to `ownerFor("sales")` rather
   than to the corrected element's own area. The heard-count is now honest (26, not 549); making it
   *per-area* needs finer override attribution in `migrate` — a migration limitation, not a persistence
   one, and out of this session's scope.

5. **`reconcile`'s recency rule barely fires on a same-blob regeneration.** `supersededGenerated=2`, not
   dozens: re-running the same blob produces identical generated values that *corroborate* (one row
   kept); recency only supersedes where a value actually changed. On paper the recency rule reads as a
   frequent event; against the real (idempotent) regeneration it is rare. It still matters — without it,
   a *changed* generation would accumulate a stale row every run — but its stored footprint is small.

6. **The projection O(n²) the cold review feared is not yet a practical problem.** At Laila scale (955
   claims) the heaviest projection (ontology view) is 15ms. The quadratic is real in the code and would
   bite at ~10× scale, but "expensive" was a paper worry; measured, it is cheap here. Flagged, not fixed.

7. **Bare-Postgres auth fidelity has two seams a throwaway Supabase wouldn't.** The RLS predicate calls
   `auth.uid()`, so `authenticated` needs `GRANT USAGE ON SCHEMA auth` — real Supabase grants it; the
   shim had to state it (now in `pg-schema.sql`). And the RLS enumerated test must run inside one
   transaction, because `set_config('request.jwt.claims', …, true)` is transaction-local — autocommit
   silently resets it and `auth.uid()` reads NULL. Both are local-fidelity truths, not product defects.

---

## Design docs (settled; unchanged this session)
`ledger-spec.md`, `ledger-precedence.md`, `ledger-write-model.md`, `ledger-critique.md`,
`ledger-cold-review.md`, `ledger-generation-contract.md`, `import-adapters.md`,
`ledger-implementation-report.md`.
