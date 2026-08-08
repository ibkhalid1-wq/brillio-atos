# Aura — Persistence build: BLOCKED (no database)

**Status: not started. The point-of-no-return step was not taken because its precondition — a live
database — is absent.** This is the specified stop condition ("No database connection — stop before
anything"), recorded here so the next attempt knows exactly what unblocks it and does not re-do the
in-memory work already done.

## Readiness check (2026-08-08) — what was verified before stopping

| Requirement | Result |
|---|---|
| `supabase` CLI | NOT installed |
| `psql` client | NOT installed |
| `pg_isready` | NOT installed |
| `pg` node driver (in repo `node_modules`) | NOT present |
| `deno` (for edge) | NOT installed |
| local Postgres on `:5432` / `:54322` | both ports closed |
| `DATABASE_URL` / any `postgres://` string in `.env*` | none |
| Supabase config in `.env.local` | only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` |

## Why the anon Supabase config does not count

The only database-adjacent credential present is the **client publishable (anon) key** for the browser.
That reaches Supabase via **PostgREST / the edge**, not a direct SQL connection. This session needs a
direct Postgres connection because:

- **Schema creation is DDL** — the `claims` table, indexes, the audit linkage. PostgREST cannot run DDL.
- **The write is a per-locus read-modify-write** — the specified concurrency control is a lock scoped to
  one `about` (`SELECT … FOR UPDATE` on the locus rows, or an advisory lock on `hashtext(about)`).
  Advisory/row locks are SQL-level and unavailable over PostgREST.
- **The concurrency proof** (two writers on one locus, no closure lost, order-independent outcome)
  requires holding that lock across a transaction — impossible without a SQL session.

So even pointing at the live project with the anon key would not satisfy build steps 1–2, and there is
no driver or client in this environment to attempt any connection regardless.

## What did NOT happen (deliberately)

- **No Supabase project was provisioned.** No credentials to do so; provisioning an external service
  autonomously is out of scope, and the throwaway-project path is only "fine and correct" when a
  connection is *provided*.
- **Nothing was re-built against the in-memory store.** The prompt is explicit that this just re-does
  finished work — the merge (`reconcile`, 6 tests), the owner-fix spec, and the write-model design are
  already committed (`merge.ts`, `ledger-write-model.md`).

## Preconditions to run this session (any one of these makes it buildable)

1. A **direct Postgres connection string** to a throwaway Supabase project (Project Settings → Database →
   Connection string, the *direct* URI, not the pooler) exported as `DATABASE_URL`, **plus** a Postgres
   client the environment can use — either the `pg` node driver added to the repo, or `psql`/`supabase`
   CLI on PATH.
2. Or a **local Postgres** (`supabase start`, or Docker Postgres) listening on `:5432`/`:54322`, again
   with `pg`/`psql` available.

With either, the build order is unchanged and everything it needs is already specified and tested on
paper:

1. Persistence adapter behind `LedgerStore` (schema keyed by `contentId`; durable FKs on element ids /
   `(about, world)`, never claim ids; per-locus lock; each write emits a Step-1 `audit_events` entry).
2. `reconcile` replaces the no-merge re-migrate — proven against the *stored* ledger (closure survives;
   orphan flagged + queryable).
3. The owner fix in `migrate.ts` (`unowned` where no area maps; `joint(A ⋈ B)` by the stated rule) — run
   into the DB; compare stored numbers to the paper prediction (~24 unowned / ~60 joint / 8 seams).
4. Rename-intent capture on the edit path (old id → new id), durable — before the first rename.
5. Point the projections at the adapter; measure projection cost against the DB at Laila scale.
6. Honest heard-count = attributed closures per area/total; update the claims register.

The design for all six is settled (`ledger-spec.md`, `ledger-precedence.md`, `ledger-write-model.md`,
`ledger-critique.md`, `ledger-cold-review.md`). **The only missing input is the database.**
