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
- `C5b actor from JWT not client intent:` — **expected FAIL against the currently
  committed trigger** (see "Trigger correction" below). This is a known, flagged
  defect, not a kit error.
- `C6 owner-only read: PASS`.
- `C1 client missing-intent recorded not raised: PASS`.
- `C2 service missing-intent raises: PASS`.

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

## Trigger correction found during kit authoring (decide before Step 1b)

While writing C5b I found a real Step-1 trigger-contract defect. The committed
trigger resolves:
```
actor = coalesce(v_intent->>'actor', nullif(auth.uid()::text,''))
```
so a **client session can spoof `actor`** by putting one in intent — but the Step 1
model is "client session: JWT supplies actor." Intent-actor should only win for
service-role (where `auth.uid()` is null). Minimal correction:
```
actor = case when auth.uid() is not null then auth.uid()::text
             else v_intent->>'actor' end
```
This is a one-line change to `aura_audit()` in `20260807_audit_events.sql`. It is
NOT applied — it changes the trigger contract, so per the gate it is yours to
confirm. Once confirmed, C5b flips to PASS. **Do not wire Step 1b intent helpers
until this is settled**, because the helpers' `actor` handling depends on it
(client helper should not bother sending actor; edge helper must).

---

## Definition of done for this kit
Someone with DB access runs Part A (read-only, prod) and Part B (throwaway) end to
end with no further instruction, and the results template comes back with: the
`adam_program_events` shape + row counts per env; every contract check PASS except
the flagged C5b; three cost numbers per blob size; and reversibility confirmed.
