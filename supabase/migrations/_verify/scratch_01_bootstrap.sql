-- STEP 1 SCRATCH BOOTSTRAP — throwaway Supabase project ONLY. NEVER production.
-- Creates the minimum schema the trigger depends on, matching PRODUCTION REALITY
-- (not the original DDL). Then you apply the Step 1 migration on top (see runbook).
-- No production data. No export. Synthetic only.
--
-- HOW TO RUN: paste this whole file into the scratch project's SQL editor and Run.
-- No CLI, no psql, no file includes needed. It ends with a confirmation result set.
-- The Supabase SQL editor shows the LAST statement's result, so the final SELECT is
-- your PASS/FAIL that the three tables exist.
--
-- TARGET: a fresh Supabase project (the auth schema and the roles anon,
-- authenticated, service_role exist; auth.uid() reads request.jwt.claims).
-- If you run on BARE Postgres, uncomment the auth.uid() shim at the bottom.
--
-- CRITICAL: adam_programs.id is TEXT here, and the child program_id FKs are TEXT,
-- because that is the live shape (the original uuid DDL was altered out of band).
-- Building this with uuid would verify the trigger against a shape that does not
-- exist in production.

create extension if not exists pgcrypto;   -- gen_random_uuid()

create table if not exists public.adam_programs (
  id         text primary key,
  owner_id   uuid,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create table if not exists public.adam_agent_runs (
  id         uuid primary key default gen_random_uuid(),
  program_id text references public.adam_programs(id) on delete cascade,
  agent_id   text,
  phase_id   text,
  status     text not null default 'queued',
  output     jsonb
);

create table if not exists public.adam_program_artifacts (
  id         uuid primary key default gen_random_uuid(),
  program_id text references public.adam_programs(id) on delete cascade,
  agent_id   text,
  phase_id   text,
  version    int not null default 1,
  content    jsonb not null default '{}'::jsonb
);

-- NOTE: do NOT create adam_program_events here. Its ABSENCE is a valid scratch
-- state; the Step 1 rename is a guarded no-op when it is absent. If you want to
-- exercise the rename path in scratch, create a stub first:
--   create table public.adam_program_events (id bigint generated always as identity primary key, program_id text);

-- ── OPTIONAL: bare-Postgres shim (DO NOT run on Supabase — it already has these) ──
-- create schema if not exists auth;
-- create or replace function auth.uid() returns uuid language sql stable as $$
--   select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid;
-- $$;
-- do $$ begin
--   if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
--   if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
--   if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
-- end $$;

-- ── confirmation result set (the last statement — this is what the editor shows) ──
select 'bootstrap' as step,
  case when to_regclass('public.adam_programs') is not null
        and to_regclass('public.adam_agent_runs') is not null
        and to_regclass('public.adam_program_artifacts') is not null
       then 'PASS' else 'FAIL' end as status,
  string_agg(t, ', ') filter (where to_regclass('public.'||t) is not null) as tables_present
from unnest(array['adam_programs','adam_agent_runs','adam_program_artifacts']) as t;

-- NEXT: paste the migration (supabase/migrations/20260807_audit_events.sql) into the
-- SQL editor and Run, then run scratch_02_contract_checks.sql, scratch_03_cost_measure.sql,
-- scratch_04_reversibility.sql — all in this same scratch project.
