# Aura Step 1 — Verification Runbook (SQL-editor first; no CLI required)

**Goal:** answer the four gate items with numbers, so Step 1b can begin. Every step
below is a SQL block you paste into a browser SQL editor and Run — **the Supabase CLI
is not required.** (If you happen to have the CLI, the `psql`/`db push` equivalent is
given alongside each step.) Record results in `step1-verify-results-template.md`.

New to the Supabase dashboard? Start with **`step1-scratch-setup.md`** (zero to
kit-ready, ~20 min). Choosing between the editor, a direct `psql`, and the MCP
connector? See **`db-access-options.md`** — the short version: the dashboard editor is
fine for this one-time Step-1 run; the MCP connector is the better path for steps 2–4.

> ## ⚠️ PRODUCTION SAFETY — READ FIRST
> **Exactly ONE block touches production, and it is READ-ONLY:** `adam_program_events_shape.sql`
> (catalog/`information_schema` SELECTs — no write, no DDL, no temp tables). **Everything
> else runs on a THROWAWAY Supabase project only** — a fresh project you create, apply
> schema to, fill with synthetic rows, and delete afterward. **No production data is
> exported or copied anywhere in this kit.** If a step does not say "PRODUCTION
> (read-only)", it must not be pointed at production. The kit is structured so the prod
> block lives in its own file and every scratch block names the scratch project in its header.

How the editor surfaces results: the Supabase SQL editor shows the **last statement's
result set**. Every scratch block is written to END in a single `SELECT` that returns
one row per check with a `status` (PASS/FAIL) column and a reason — not `RAISE NOTICE`,
which a hosted editor may not surface.

---

## Part A — Prerequisite (PRODUCTION, read-only)

**A1. `adam_program_events` shape, per environment.** Open each environment's project →
SQL editor → paste `supabase/migrations/_verify/adam_program_events_shape.sql`.
- Run **BLOCK P1** (presence + shape + column list). If it says PRESENT, also run
  **BLOCK P2** (exact row count). If ABSENT, skip P2.
- Record per env: PRESENT/ABSENT, which shape (`20260613093000` / `20260714`), row_count.
- Meaning: `event_type/actor_id/prev_snapshot` → the `20260613093000` shape is live;
  `kind/detail` → the `20260714` shape; ABSENT → never applied, the Step 1 rename is a
  safe no-op there. **row_count > 0 anywhere → a partial record. The migration preserves
  it (rename). Do NOT migrate those rows into `audit_events`.**
- *CLI equivalent:* `psql "$PROD_DB_URL" -f …/adam_program_events_shape.sql` (read-only).

---

## Part B — On the THROWAWAY project only

See `step1-scratch-setup.md` for creating the project and finding the SQL editor. Then,
in that project's editor, run these blocks **in order**. Each is one file; paste the
whole file and Run.

**B1. Bootstrap** — paste `_verify/scratch_01_bootstrap.sql`. Expected: the final row
reads `bootstrap | PASS`. Wrong result: if it complains about `auth.uid()` or roles,
you are on bare Postgres, not a Supabase project — uncomment the shim block at the
bottom and re-run (on a real Supabase project you never need it).

**B2. Apply the migration** — paste the whole of `supabase/migrations/20260807_audit_events.sql`
and Run. It is plain DDL (no meta-commands). Then confirm with this one-liner:
```sql
select to_regclass('public.audit_events') as audit_events,
       to_regproc('public.aura_audit')     as trigger_fn,
       (select enforce from public.aura_audit_config) as enforce_should_be_false;
```
Expected: `audit_events` and `trigger_fn` non-null, `enforce=false`. Any error applying
is a real migration defect — record it verbatim and stop; it changes the trigger contract.
*CLI equivalent:* `supabase db push`, or `psql "$SCRATCH_DB_URL" -f …/20260807_audit_events.sql`.

**B3. Functional verify** — paste `_verify/20260807_audit_events.verify.sql`. Expected:
every row `PASS` (check 7 may read `N/A` on scratch — you did not create the dormant-table
stub, which is fine). Any `FAIL` is a contract defect.

**B4. Contract checks** — paste `_verify/scratch_02_contract_checks.sql`.
- **BLOCK A (editor-safe: C1, C2, C3, C5, C7)** runs correctly in any editor. Expected all
  `PASS`. **C3 (SECURITY DEFINER intent reaches trigger) is the check the whole run-agent
  RPC design depends on — if it FAILS, stop; Step 1b changes.** C5b/C5c assert actor comes
  from the JWT and a spoofed claim is recorded, not dropped.
- **BLOCK B (C4 grant-denial, C6 RLS read)** must run **as the `authenticated` role**. Run
  it separately. If the first row says `BLOCKED`, your editor runs as a fixed/superuser
  role that can't switch — these two are **possibly-needing-a-direct-connection**: run
  Block B over a direct `psql` connection (non-superuser) or the MCP connector. Do **not**
  record C4/C6 as passed from a hosted editor that returned BLOCKED. See `db-access-options.md`.

**B5. Trigger cost** — paste `_verify/scratch_03_cost_measure.sql`, running its blocks in
order: **4.0 setup**, then **4.1 (1 MB)**, **4.2 (5 MB)**, **4.3 (10 MB)**, then **4.4 summary**.
Split by size so no single statement times out and a slow 10 MB run can't lose the smaller
results. Expected: `actual_size` near each target (tune the three `_gen_blob` ints if not),
and the 4.4 summary gives `trigger_cost_ms` (= full − baseline) and `md5_cost_ms` (= full −
nofp) per size. Meaning: if `full` at 10 MB is an unacceptable per-write penalty, adopt the
proven fallback — drop md5 fingerprints, keep `changed_keys`.

**B6. Reversibility** — paste `_verify/scratch_04_reversibility.sql`. Expected: R1 `PASS`
(rows before), R2–R4 `PASS` (rollback drops cleanly), R5 `N/A` on scratch. Then **re-apply
the migration** (B2) and run **BLOCK R6** (commented at the file's end) to confirm
`audit_events` exists again with count 0. Meaning: **rollback destroys audit rows by
design — never blind-rollback a populated PRODUCTION audit log without exporting
`audit_events` first.**

**B7. Delete the throwaway project.** No synthetic data needs to linger.

---

## Which checks are editor-safe vs need a direct connection

| Check | Editor-safe? | Why |
|---|---|---|
| A1 shape (prod, read-only) | ✅ | pure catalog SELECTs |
| B1 bootstrap, B2 apply, B3 functional (1–5,7) | ✅ | key off the JWT GUC via `set_config`, no role switch |
| B4 Block A — C1, C2, C3, C5, C7 | ✅ | trust-domain split reads `auth.uid()`, not the DB role |
| B4 Block B — **C4 grant-denial, C6 RLS read** | ⚠️ needs `authenticated` role | a hosted editor as superuser BYPASSES grants + RLS, so these must run as a non-superuser role — direct `psql` or MCP |
| B5 cost, B6 reversibility | ✅ | owner-role DDL + synthetic writes only |

Two of fourteen checks (C4, C6) may need a direct connection. They are **not dropped** —
Block B attempts them and tells you if it couldn't, with the alternative named.

---

## Trigger correction (APPLIED)

A real Step-1 trigger-contract defect was found and fixed. For a client session (JWT
present) the **server-derived identity always wins**; a differing client-supplied
`intent.actor` is a spoof attempt and is **recorded** in `actor_intent_mismatch` (kept as
evidence, never silently dropped). Only service-role (no JWT) takes `actor` from intent.
C5b/C5c assert this. **Field-trust audit:** `actor` was the ONLY intent field with a
server-derived counterpart to defend; `action_type`, `affected_kind`, `affected_id`,
`partial` have no server source of truth (legitimately app-asserted); `row_pk`,
`program_id`, fingerprints, `changed_keys` are server-derived and never take intent.

**Binding requirement carried to Step 1b** (encode in types, not discipline): the client
intent helper must have **no `actor` parameter at all**; the edge helper **requires** one.
The enumeration test asserts no client call site passes `actor` and every edge site does.

---

## Definition of done for this kit
Someone with **dashboard access and no CLI** runs Part A (read-only, prod) and Part B
(throwaway) end to end with no further instruction, pasting each block into the SQL editor,
and the results template comes back with: the `adam_program_events` shape + row counts per
env; every contract check PASS except any that reported BLOCKED (run those over a direct
connection); three cost numbers per blob size; and reversibility confirmed. Estimated time
on a fresh project: **~20 minutes** (see `step1-scratch-setup.md`).
