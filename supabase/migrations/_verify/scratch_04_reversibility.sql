-- STEP 1 REVERSIBILITY — throwaway Supabase project ONLY.
-- Prereq: bootstrap + 20260807_audit_events.sql applied (audit_events exists).
-- This file POPULATES, then RUNS THE ROLLBACK, then asserts clean state.
-- Afterwards, RE-APPLY 20260807_audit_events.sql (see runbook) to prove idempotency.
-- Usage: psql "$SCRATCH_DB_URL" -f scratch_04_reversibility.sql

-- 1. populate: synthetic writes so audit_events holds rows before rollback
insert into public.adam_programs(id, data) values ('rev-1','{"k":1}') on conflict (id) do nothing;
select set_config('aura.intent','{"action_type":"rev_seed"}', true);
update public.adam_programs set data = jsonb_set(data,'{k}','2') where id='rev-1';
update public.adam_programs set data = jsonb_set(data,'{k}','3') where id='rev-1';
do $$
declare n int;
begin
  select count(*) into n from public.audit_events where row_pk='rev-1';
  raise notice 'R1 audit rows present before rollback:%', case when n>=2 then ' PASS ('||n||')' else ' FAIL ('||n||')' end;
end $$;

-- 2. ROLLBACK (identical to the migration's rollback block; destructive by design)
drop trigger if exists aura_audit_programs  on public.adam_programs;
drop trigger if exists aura_audit_runs      on public.adam_agent_runs;
drop trigger if exists aura_audit_artifacts on public.adam_program_artifacts;
drop function if exists public.aura_audit();
drop table if exists public.audit_events;         -- << this destroys all audit rows, on purpose
drop table if exists public.aura_audit_config;
alter table if exists public.adam_program_events_retired_20260807
  rename to adam_program_events;

-- 3. assert clean state
do $$
begin
  raise notice 'R2 audit_events dropped by rollback:%',
    case when to_regclass('public.audit_events') is null then ' PASS' else ' FAIL (still present)' end;
  raise notice 'R3 aura_audit_config dropped:%',
    case when to_regclass('public.aura_audit_config') is null then ' PASS' else ' FAIL' end;
  raise notice 'R4 trigger function dropped:%',
    case when to_regproc('public.aura_audit') is null then ' PASS' else ' FAIL' end;
  -- rename-restore only meaningful where the dormant table existed pre-apply.
  if to_regclass('public.adam_program_events') is not null then
    raise notice 'R5 adam_program_events name restored: PASS';
  else
    raise notice 'R5 adam_program_events name restored: N/A (table did not exist in this env)';
  end if;
end $$;

-- CORRECT-BEHAVIOUR ASSERTION, stated loudly:
--   Rollback DROPS audit_events and therefore ALL audit rows with it. This is
--   correct for a full reversal of Step 1. It is NOT silent — it is right here in
--   the rollback block. CONSEQUENCE: never roll back a POPULATED PRODUCTION audit
--   log without exporting audit_events first. On a throwaway project this is fine.
--
-- 4. NEXT: re-apply supabase/migrations/20260807_audit_events.sql on this project.
--    Expect: audit_events exists again, count(*) = 0 (fresh), triggers reinstalled.
--    That proves the migration is idempotent/re-appliable on a populated schema.
