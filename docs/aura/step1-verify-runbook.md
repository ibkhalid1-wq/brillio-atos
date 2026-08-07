# Aura Step 1 — Verification Runbook

**Goal:** answer the four gate items with numbers, so Step 1b can begin. Follow
top to bottom. Every step states its command, its expected output, and what a
wrong result means. Record results in `step1-verify-results-template.md`.

> ## ⚠️ PRODUCTION SAFETY — READ FIRST
> **Exactly ONE script touches production, and it is READ-ONLY:**
> `adam_program_events_shape.sql` (information_schema queries; no write, no DDL).
> **Everything else runs on a THROWAWAY Supabase project only** — a fresh project
> you create, apply schema to, fill with synthetic rows, and delete afterward.
> **No production data is exported or copied anywhere in this kit.** If a step
> below does not explicitly say "PRODUCTION (read-only)", it must not be pointed
> at production.

Set two connection strings so you cannot mix them up:
```
export PROD_DB_URL="…the real project… (only used for the one read-only script)"
export SCRATCH_DB_URL="…a fresh throwaway project you just created…"
```

---

## Part A — Prerequisite, against every environment (PRODUCTION read-only)

**A1. `adam_program_events` shape.** Run the SAME read-only script against local,
staging, and production, independently:
```
psql "$LOCAL_DB_URL"    -f supabase/migrations/_verify/adam_program_events_shape.sql
psql "$STAGING_DB_URL"  -f supabase/migrations/_verify/adam_program_events_shape.sql
psql "$PROD_DB_URL"     -f supabase/migrations/_verify/adam_program_events_shape.sql   # READ-ONLY
```
Expected: for each env, a PRESENT/ABSENT line, a column list, and a row count.
Meaning:
- columns `event_type/actor_id/prev_snapshot` → the `20260613093000` shape is live there.
- columns `kind/detail`, `id` bigint → the `20260714` shape is live there.
- ABSENT → never applied there; the Step 1 rename is a safe no-op there.
- **row_count > 0 anywhere → a partial record. The migration preserves it (rename).
  Do NOT migrate those rows into `audit_events`.** Record the count.

---

## Part B — On the THROWAWAY project only

**B1. Create a fresh Supabase project.** Nothing else lives in it. Do NOT use a
branch of production (a branch copies real content; step 0 does not exist yet).

**B2. Bootstrap the minimum schema (matches production reality: `id` is TEXT):**
```
psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/_verify/scratch_01_bootstrap.sql
```
Expected: three tables created, no error. Wrong result: if it complains about
`auth.uid()` or roles, you are on bare Postgres — uncomment the shim block at the
bottom of the bootstrap and re-run.

**B3. Apply the Step 1 migration:**
```
psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260807_audit_events.sql
```
Expected: no error; `audit_events`, `aura_audit_config`, the trigger function, and
three triggers exist. Wrong result: any error here is a real migration defect —
record it verbatim and stop; it changes the trigger contract.

**B4. Functional verify:**
```
psql "$SCRATCH_DB_URL" -f supabase/migrations/_verify/20260807_audit_events.verify.sql
```
Expected: every line ` PASS` (plus the one MANUAL note for direct-insert, which B5
covers). Any ` FAIL` is a contract defect.

**B5. Contract checks (trust-domain split, SECURITY DEFINER, grants, RLS):**
```
psql "$SCRATCH_DB_URL" -f supabase/migrations/_verify/scratch_02_contract_checks.sql
```
Expected:
- `C3 SECURITY DEFINER intent reaches trigger: PASS` — **this is the check the
  whole run-agent RPC design depends on. If it FAILS, stop; Step 1b's RPC changes.**
- `C4a/b/c direct INSERT/UPDATE/DELETE denied: PASS` — trigger is the sole writer.
- `C5 trigger writes under app-role caller: PASS`.
- `C5b actor from JWT not client intent: PASS`.
- `C5c spoofed actor recorded (not dropped): PASS` — the differing client claim is
  kept in `actor_intent_mismatch` as evidence, not silently discarded.
- `C6 owner-only read: PASS`.
- `C1 client missing-intent recorded not raised: PASS`.
- `C2 service missing-intent raises: PASS`.
- `C7a/b/c partial three-state: PASS` — an intent_missing event has `partial` NULL,
  an affirmative `partial=false` is recorded, and NULL (never asserted) is distinct
  from false. `partial` is never defaulted to false.

**B6. Trigger cost at blob size:**
```
psql "$SCRATCH_DB_URL" -f supabase/migrations/_verify/scratch_03_cost_measure.sql
```
Expected: `actual_size` near 1/5/10 MB (tune the three integer params if not), and
three `ms_per_write` numbers per size. Compute and record: trigger cost = full −
baseline; md5 cost = full − nofp; changed_keys cost = nofp − baseline. Meaning: if
`full` at 10 MB is an unacceptable per-write penalty, adopt the proven fallback —
drop md5 fingerprints, keep `changed_keys`.

**B7. Reversibility:**
```
psql "$SCRATCH_DB_URL" -f supabase/migrations/_verify/scratch_04_reversibility.sql
psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260807_audit_events.sql   # re-apply
psql "$SCRATCH_DB_URL" -c "select count(*) as should_be_zero from public.audit_events;"
```
Expected: R1 PASS (rows before), R2–R4 PASS (rollback drops cleanly), R5 N/A on
scratch; re-apply succeeds; final count = 0. Meaning: **rollback destroys audit
rows by design — never blind-rollback a populated PRODUCTION audit log without
exporting `audit_events` first.**

**B8. Delete the throwaway project.** No synthetic data needs to linger.

---

## Trigger correction (APPLIED)

A real Step-1 trigger-contract defect was found and fixed. The trigger now resolves
`actor` so that for a client session (JWT present) the **server-derived identity
always wins**; a differing client-supplied `intent.actor` is a spoof attempt and is
**recorded** in `actor_intent_mismatch` (kept as evidence, never silently dropped —
same philosophy as `intent_missing`). Only service-role (no JWT) takes `actor` from
intent. C5b/C5c assert this; both should read PASS.

**Field-trust audit (done in the same pass):** `actor` was the ONLY intent-sourced
field with a server-derived counterpart to defend. `action_type`, `affected_kind`,
`affected_id`, `partial` have no server source of truth (the DB cannot know a write
was "a rename" or that a run "truncated"), so they are legitimately app-asserted —
trustworthy only as far as the app code is, never elevated to user assertion.
`row_pk`, `program_id`, and the fingerprints/`changed_keys` are all server-derived
from NEW/OLD and never take intent. No other client-over-server coalesce exists.

**Binding requirement carried to Step 1b** (encode in types, not discipline): the
client intent helper must have **no `actor` parameter at all** (its signature makes
sending one impossible); the edge helper **requires** one. The enumeration test must
assert no client-side call site passes `actor` and every edge-side call site does.

---

## Definition of done for this kit
Someone with DB access runs Part A (read-only, prod) and Part B (throwaway) end to
end with no further instruction, and the results template comes back with: the
`adam_program_events` shape + row counts per env; every contract check PASS except
the flagged C5b; three cost numbers per blob size; and reversibility confirmed.
