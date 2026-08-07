-- Aura spine — STEP 1: the audit choke-point.  DELIVERED, NOT APPLIED.
-- (audit contract Rule 6: never touch the shared database autonomously.
--  Apply intentionally: supabase db push.  Rollback at the bottom.)
--
-- AUTHORED, NOT EXECUTED: no local Postgres was available (no docker / no
-- supabase CLI). Every statement below is unverified against a running DB.
-- Apply on a scratch/local DB first and run _verify/20260807_audit_events.verify.sql.
--
-- WHAT THIS IS
-- The single authoritative, append-only event log for every state change to the
-- three state-bearing tables (adam_programs, adam_agent_runs,
-- adam_program_artifacts). It replaces four partial, non-authoritative trails:
--   * flowAttestations  (in-blob, capped 200, opt-in, silently dropped)
--   * adam_audit_log     (client-side, opt-in, best-effort; adamSync.writeAuditLog)
--   * adam_program_events (dormant, double-defined, unreferenced) -- retired below
--   * adam_decision_audit (RLS but no writer; vestigial)
-- Those are DEMOTED, not deleted: they keep writing during warn mode; they are
-- retired only after enforce mode is on and intent_missing has reached zero.
-- Deciding which trail is authoritative is a spec decision recorded here:
-- audit_events is the system of record from this migration forward.
--
-- ENFORCEMENT MODEL (trigger-only writer + transaction-local intent)
-- The trigger is the SOLE writer of audit_events. The app never inserts one.
-- Before a state write, the write path publishes semantics transaction-locally:
--   select set_config('aura.intent',
--     '{"action_type":"...","affected_kind":"...","affected_id":"...",
--       "partial":false,"actor":"..."}', true);   -- is_local = true
-- The trigger fires unconditionally and reads current_setting('aura.intent',true):
--   intent present  -> rich event.
--   intent absent   -> event STILL written, marked intent_missing=true, carrying
--                      fingerprints + changed top-level doc keys. No silent gap.
-- Completeness is the trigger's job; it fires however the app spells the table.
-- intent_missing is a first-class, countable defect (like UnresolvedReference).
--
-- FAILURE MODES BY TRUST DOMAIN, gated behind aura_audit_config.enforce:
--   * enforce=false (DEFAULT, warn mode): missing intent -> record intent_missing,
--     never raise. Applying is additive-safe; nothing breaks; the counter climbs.
--   * enforce=true: service-role write (auth.uid() IS NULL) with missing intent
--     -> RAISE (actor is unrecoverable there; fail fast). Client-session write
--     with missing intent -> still recorded as intent_missing (JWT gives actor),
--     not blocked.
-- Flip to enforce ONLY after every write path sets intent and intent_missing=0.
--
-- ACTOR PROVENANCE: a client session's actor is ALWAYS the JWT (auth.uid), never
-- the client-supplied intent.actor; a differing claim is recorded in
-- actor_intent_mismatch (a spoof attempt kept as evidence, not dropped). Intent
-- supplies actor only for service-role (no JWT). See the FIELD-TRUST AUDIT note at
-- the insert: actor was the only intent field with a server-derived value to defend.
--
-- COST GUARD: no blob deep-diff. Floor = changed top-level doc keys + row
-- fingerprints. affected_id stays a JSON-pointer path where no stable id exists
-- yet (blob elements get ids only at steps 2-4); no synthetic id scheme.
-- If this trigger is too slow on a multi-MB blob, the expensive part is
-- md5(doc::text) (it serializes the whole JSONB before hashing), NOT the
-- top-level-key compare (which works on parsed jsonb). Drop/defer the
-- fingerprints and KEEP changed_keys — not the reverse.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. enforce toggle (single row). Starts in warn mode.
create table if not exists public.aura_audit_config (
  id      boolean primary key default true check (id),   -- single-row guard
  enforce boolean not null default false,
  note    text
);
insert into public.aura_audit_config (id, enforce, note)
  values (true, false, 'warn mode until intent_missing=0, then flip to true')
  on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. the authoritative log
create table if not exists public.audit_events (
  id             bigint generated always as identity primary key,
  ts             timestamptz not null default now(),      -- server clock, not client
  table_name     text        not null,
  op             text        not null,                    -- INSERT | UPDATE | DELETE
  row_pk         text,                                    -- affected row id (text)
  program_id     text,                                    -- for owner-scoped RLS
  actor          text,                                    -- server-derived (JWT) for client; intent.actor for service-role
  actor_intent_mismatch text,                              -- non-null = a client intent claimed a DIFFERENT actor than its JWT; holds the rejected claim
  action_type    text,                                    -- from intent (app-asserted; no server truth to defend)
  affected_kind  text,                                    -- from intent
  affected_id    text,                                    -- from intent; JSON-pointer where no id
  partial        boolean     not null default false,      -- from intent
  intent_missing boolean     not null default false,      -- true when no intent published
  before_fp      text,                                    -- md5 fingerprint of OLD doc/row
  after_fp       text,                                    -- md5 fingerprint of NEW doc/row
  changed_keys   text[],                                  -- changed top-level doc keys (floor)
  intent         jsonb                                    -- raw intent snapshot, forensics
);

create index if not exists audit_events_program_ts
  on public.audit_events (program_id, ts desc);
create index if not exists audit_events_intent_missing
  on public.audit_events (intent_missing) where intent_missing;
create index if not exists audit_events_actor_mismatch
  on public.audit_events (actor_intent_mismatch) where actor_intent_mismatch is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. the sole writer: SECURITY DEFINER trigger function
create or replace function public.aura_audit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent_txt text := current_setting('aura.intent', true);   -- null if unset
  v_intent     jsonb;
  v_enforce    boolean := coalesce((select enforce from public.aura_audit_config limit 1), false);
  v_is_service boolean := (auth.uid() is null);                 -- no JWT => service role
  v_new        jsonb   := case when TG_OP <> 'DELETE' then to_jsonb(NEW) else null end;
  v_old        jsonb   := case when TG_OP <> 'INSERT' then to_jsonb(OLD) else null end;
  v_new_doc    jsonb   := coalesce(v_new->'data', v_new->'content');   -- adam_programs.data | artifacts.content
  v_old_doc    jsonb   := coalesce(v_old->'data', v_old->'content');
  v_row_pk     text    := coalesce(v_new->>'id', v_old->>'id');
  v_program_id text    := coalesce(v_new->>'program_id', v_old->>'program_id',
                            case when TG_TABLE_NAME = 'adam_programs' then coalesce(v_new->>'id', v_old->>'id') end);
  v_changed    text[]  := null;
  v_jwt        text;                                            -- server-derived identity (null under service-role)
  v_claimed    text;                                            -- actor the intent asked for
  v_actor      text;                                            -- resolved actor written to the event
  v_mismatch   text;                                            -- non-null iff a client claimed a different actor
  v_missing    boolean := (v_intent_txt is null or v_intent_txt = '' or v_intent_txt = 'null');
begin
  -- fail fast only in enforce mode and only for service-role writes
  if v_missing and v_enforce and v_is_service then
    raise exception 'aura audit: state write without intent (service-role) on %.% (%).',
      TG_TABLE_NAME, TG_OP, coalesce(v_row_pk, '?');
  end if;

  -- changed top-level doc keys (floor; only when a doc exists and it is an UPDATE)
  if TG_OP = 'UPDATE' and v_new_doc is not null then
    select array_agg(k) into v_changed
    from (
      select key as k from jsonb_object_keys(coalesce(v_new_doc, '{}'::jsonb)) as key
      union
      select key as k from jsonb_object_keys(coalesce(v_old_doc, '{}'::jsonb)) as key
    ) keys
    where (v_new_doc -> k) is distinct from (v_old_doc -> k);
  end if;

  if not v_missing then
    begin
      v_intent := v_intent_txt::jsonb;
    exception when others then
      v_intent := null; v_missing := true;   -- malformed intent degrades to missing
    end;
  end if;

  -- ACTOR PROVENANCE. For a client session (JWT present) the server-derived
  -- identity ALWAYS wins; a differing client-supplied actor is a spoof attempt,
  -- RECORDED (actor_intent_mismatch), never silently dropped — same philosophy as
  -- intent_missing. Only service-role (auth.uid() null) takes actor from intent.
  v_jwt := nullif(auth.uid()::text, '');
  v_claimed := v_intent->>'actor';
  if v_jwt is not null then
    v_actor := v_jwt;
    if v_claimed is not null and v_claimed <> v_jwt then
      v_mismatch := v_claimed;
    end if;
  else
    v_actor := v_claimed;
  end if;

  -- FIELD-TRUST AUDIT (one pass over every intent-sourced field): actor was the
  -- ONLY field with a server-derived counterpart being overridden. action_type,
  -- affected_kind, affected_id, partial have no server source of truth (the DB
  -- cannot know "this was a rename" or "the run truncated"), so they are legitimately
  -- app-asserted — trustworthy only to the extent the app code is, never elevated to
  -- user assertion. row_pk, program_id, before/after_fp, changed_keys are all
  -- server-derived from NEW/OLD and never take intent. No other coalesce-client-over-
  -- server exists here.
  insert into public.audit_events(
    table_name, op, row_pk, program_id, actor, actor_intent_mismatch, action_type,
    affected_kind, affected_id, partial, intent_missing, before_fp, after_fp, changed_keys, intent)
  values(
    TG_TABLE_NAME, TG_OP, v_row_pk, v_program_id,
    v_actor, v_mismatch,
    v_intent->>'action_type', v_intent->>'affected_kind', v_intent->>'affected_id',
    coalesce((v_intent->>'partial')::boolean, false),
    v_missing,
    md5(coalesce(v_old_doc::text, v_old::text, '')),
    md5(coalesce(v_new_doc::text, v_new::text, '')),
    v_changed, v_intent);

  return null;   -- AFTER trigger: return value ignored
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. attach to all three state-bearing tables (drop-then-create for idempotency)
drop trigger if exists aura_audit_programs  on public.adam_programs;
create trigger aura_audit_programs  after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit();

drop trigger if exists aura_audit_runs      on public.adam_agent_runs;
create trigger aura_audit_runs      after insert or update or delete on public.adam_agent_runs
  for each row execute function public.aura_audit();

drop trigger if exists aura_audit_artifacts on public.adam_program_artifacts;
create trigger aura_audit_artifacts after insert or update or delete on public.adam_program_artifacts
  for each row execute function public.aura_audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: owner-only read until step 6; NO client insert/update/delete.
-- The trigger (SECURITY DEFINER, owned by the migration role) is the only writer
-- and bypasses RLS as table owner. Revoking table grants makes the trigger the
-- SOLE writer at the grant level too.
alter table public.audit_events enable row level security;

revoke all on public.audit_events from anon, authenticated;
-- service_role bypasses RLS; it still must not INSERT/UPDATE/DELETE directly:
revoke insert, update, delete on public.audit_events from anon, authenticated, service_role;
grant  select on public.audit_events to authenticated;   -- gated by the policy below

drop policy if exists audit_events_owner_read on public.audit_events;
create policy audit_events_owner_read on public.audit_events
  for select using (
    program_id in (select id::text from public.adam_programs where owner_id = auth.uid())
  );
-- No INSERT / UPDATE / DELETE policies exist, by design.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. retire the dormant, double-defined adam_program_events (rename, do NOT drop).
-- Shape-agnostic: rename works whichever of the two historical definitions is live.
-- Preserving the table preserves the schema-history evidence this build exists to
-- protect. INSERT is revoked so nothing can resume writing to it.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'adam_program_events') then
    execute 'alter table public.adam_program_events rename to adam_program_events_retired_20260807';
    execute 'comment on table public.adam_program_events_retired_20260807 is '
         || quote_literal('Retired 2026-08-07: superseded by audit_events (trigger-enforced authoritative log). '
                        || 'Dormant/double-defined across 20260613093000 and 20260714; unreferenced by app code. '
                        || 'Kept (not dropped) to preserve schema history; INSERT revoked.');
    execute 'revoke insert on public.adam_program_events_retired_20260807 from anon, authenticated, service_role';
    -- drop any insert policies from either historical definition, if present
    execute 'drop policy if exists adam_program_events_insert on public.adam_program_events_retired_20260807';
    execute 'drop policy if exists "insert_program_events"   on public.adam_program_events_retired_20260807';
  end if;
end $$;

-- SUPERSEDES (recorded here, not by editing historical migrations, to avoid
-- breaking their checksums): 20260613093000_event_access_foundation.sql and
-- 20260714_event_journal.sql are both superseded by this file.

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (apply intentionally; reverses everything above)
-- ─────────────────────────────────────────────────────────────────────────────
-- drop trigger if exists aura_audit_programs  on public.adam_programs;
-- drop trigger if exists aura_audit_runs      on public.adam_agent_runs;
-- drop trigger if exists aura_audit_artifacts on public.adam_program_artifacts;
-- drop function if exists public.aura_audit();
-- drop table if exists public.audit_events;
-- drop table if exists public.aura_audit_config;
-- alter table if exists public.adam_program_events_retired_20260807
--   rename to adam_program_events;   -- restore the dormant table's name
