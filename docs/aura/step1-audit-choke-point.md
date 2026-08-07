# Aura Spine — Step 1: Audit Choke-Point (handover)

**Status:** authored, **NOT APPLIED**, **NOT EXECUTED**. No local Postgres, node,
docker, or supabase CLI was available in the authoring environment, so nothing
below has run. This is the Q3 "you apply, I verify on your numbers" path.

**Delivered files**
- `supabase/migrations/20260807_audit_events.sql` — the migration (inline rollback at bottom).
- `supabase/migrations/_verify/20260807_audit_events.verify.sql` — run on a scratch DB after apply.

## The decision this implements
`audit_events` is the single authoritative, append-only, trigger-enforced log for
every state change to the three state-bearing tables: `adam_programs`,
`adam_agent_runs`, `adam_program_artifacts`. The trigger is the **sole writer**;
the app publishes semantics via a transaction-local `set_config('aura.intent', …, true)`
and the trigger reads it. Missing intent still writes an event, flagged
`intent_missing` — completeness is guaranteed, the gap is visible not silent.
Ships in **warn mode** (`aura_audit_config.enforce = false`) so applying is
additive-safe; flip to enforce only after every write path sets intent and
`intent_missing = 0`.

## Authority decision (recorded — this was the flagged spec question)
Four partial audit trails exist; none was authoritative:
`flowAttestations` (in-blob, capped, opt-in), `adam_audit_log` (client, best-effort,
**live** via `adamSync.writeAuditLog`), `adam_program_events` (dormant, double-defined),
`adam_decision_audit` (RLS, no writer). **Resolution: `audit_events` is the system
of record from this migration forward.** The others are **demoted, not deleted**:
they keep writing during warn mode and are retired only after enforce-flip with
`intent_missing = 0`. Only the fully-dormant `adam_program_events` is retired now
(renamed to `adam_program_events_retired_20260807`, INSERT revoked — never dropped).

## PREREQUISITES you must run before applying (I cannot reach these)
1. **Establish the real shape of `adam_program_events` in each environment** —
   two incompatible historical definitions exist (`20260613093000` uuid/event_type
   vs `20260714` bigint/kind); which is live is an application-order fact, not a
   repo fact. Run in local, staging, prod:
   ```sql
   select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name='adam_program_events' order by ordinal_position;
   select count(*) from public.adam_program_events;   -- rows = partial record
   ```
   The migration's retirement is **shape-agnostic** (a rename), so it is safe
   either way. **If the table holds rows, do NOT migrate them into `audit_events`**
   — that would contaminate a complete log with an incomplete one. Leave them in
   the retired table.
2. **Confirm the three state-bearing tables are the complete set.** I verified
   these three carry mutable state; if a fourth table holds engagement state,
   the trigger must attach there too or completeness covers only part.

## What local could NOT verify (needs your run)
- **Everything functional** — the SQL has never executed. Run the verify script;
  every line must print ` PASS`.
- **Grant-level sole-writer** (verify step 6) — needs a role switch to
  `authenticated`; confirm the direct insert is denied.
- **Real concurrency** — simultaneous client-session and edge service-role writes
  under load; single-user verification will not surface interleaving.
- **Trigger cost at production blob sizes** — O(blob size) on every write. Treat any
  local timing as indicative; **re-measure on a production-sized `adam_programs.data`
  after apply.** If cost is unacceptable, the expensive part is **`md5(doc::text)`**,
  which serializes the entire JSONB to text before hashing; the changed-top-level-key
  comparison operates on the already-parsed jsonb structure and is comparatively cheap.
  So **drop or defer the fingerprints and keep `changed_keys`** — not the reverse.

## Assumptions baked into the SQL that you should sanity-check
- `auth.uid() IS NULL` reliably distinguishes service-role from client session in
  trigger context (standard Supabase, but confirm for your edge invocation path).
- The trigger function is `SECURITY DEFINER` owned by a role that bypasses RLS on
  `audit_events` (table owner, RLS not FORCEd) — so it can insert while all app
  roles have INSERT revoked. Confirm the migration runs as such an owner.
- `adam_programs.id` is text in practice; `audit_events.program_id`/`row_pk` are text.

## Next unit (do NOT fold into Step 1; sequence after apply + warn-mode bake)
1. **Wire intent at write sites.** Set `aura.intent` immediately before each state
   write. Census of sites to wrap:
   - `adam_programs`: `src/lib/adamSync.ts` (`saveProgramToSupabase`),
     `src/v3/AppShellV3.tsx:1238` (upsert), `:2005` (rename), `:1770`/`:1856` (clone);
     edge `supabase/functions/flow-portal/index.ts:699,737,771`,
     `supabase/functions/run-agent/index.ts:5264` (`persistProgramData`).
   - `adam_agent_runs`: ~20 sites in `run-agent/index.ts` (status/output writes).
   - `adam_program_artifacts`: `run-agent/index.ts:5012,5025,5043`.
   All are `.from("<table>")` double-quoted → amenable to a static enumeration test.
2. **run-agent RPC.** Wrap the three un-transactioned writes
   (`persistAgentArtifact` + `persistProgramData` + run-row `complete`) in ONE
   `SECURITY DEFINER` RPC **at that single call site only** — fixes the cross-table
   partial + `outputRepaired` truncation gap. Do not rewrite other call sites.
3. **Two helpers, two signatures (trust encoded in types, not discipline).** The
   client intent helper takes **no `actor` parameter at all** — its signature makes
   supplying one impossible (a client's actor is the JWT, server-derived). The edge
   helper **requires** `actor` (service-role has no JWT). This mirrors the trigger's
   actor rule; a client that somehow sends actor anyway is not trusted (JWT wins) and
   the attempt is recorded in `actor_intent_mismatch`.
4. **CI enumeration test (vitest, static).** Assert every `.from("<state table>")`
   write is preceded by an intent publish; fail CI on a bare write. Additionally
   assert **no client-side call site passes `actor`** and **every edge-side call site
   does**. Additionally assert **every published `action_type` is a member of the
   committed `ACTION_TYPES` set** (the closed vocabulary decided in
   `docs/aura/action-type-vocabulary.md`) — so no synonym for an existing action can
   enter the audit trail. Secondary guard; the trigger remains the completeness
   guarantee.
5. **Watch `intent_missing`.** `select count(*) from audit_events where intent_missing`
   must trend to 0. Then set `aura_audit_config.enforce = true` and, in a follow-up,
   retire `adam_audit_log` (rename + revoke insert; make `writeAuditLog` a shim that
   sets intent) and demote `flowAttestations` to a derived UX projection.

## Definition-of-done status for Step 1
- [x] Invariant designed and expressed as a migration + verify script.
- [ ] Migration applied and reversible — **blocked on your environment** (author-side had no DB).
- [ ] Real data run through it, numbers reported — **blocked**; verify script ready.
- [x] Nothing downstream removed (retirement is additive rename; legacy trails still write).
- [ ] Claims register updated — pending apply; on success, "auditable" moves from
  false to true (complete + affected_id), per the Step-6 claims register.
