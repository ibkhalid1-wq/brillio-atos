-- STEP 1 REVERSIBILITY — SCRATCH project only. Editor-safe (paste & Run).
-- Prereq in this project: bootstrap + the migration applied (audit_events exists).
-- This block POPULATES, RUNS THE ROLLBACK, then asserts clean state — returning one
-- result set of PASS/FAIL rows. No RAISE NOTICE, no meta-commands, no file includes.
--
-- AFTER this block: re-run the migration block to prove idempotency, then run BLOCK R6
-- at the bottom to confirm the fresh count is 0.
--
-- Authored, not executed (no local Postgres here). Unverified against a running DB.

drop table if exists _kit_rev;
create table _kit_rev (seq serial primary key, check_name text, status text, reason text);   -- survives the rollback (not one of the dropped objects)

-- 1. populate: synthetic writes so audit_events holds rows before rollback
insert into public.adam_programs(id, data) values ('rev-1','{"k":1}') on conflict (id) do nothing;
do $$
declare n int;
begin
  perform set_config('aura.intent','{"action_type":"rev_seed"}', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','2') where id='rev-1';
  update public.adam_programs set data = jsonb_set(data,'{k}','3') where id='rev-1';
  select count(*) into n from public.audit_events where row_pk='rev-1';
  insert into _kit_rev(check_name,status,reason) values ('R1 audit rows present before rollback', case when n>=2 then 'PASS' else 'FAIL' end, n||' rows');
end $$;

-- 2. ROLLBACK (identical to the migration's rollback block; destructive by design)
drop trigger if exists aura_audit_programs  on public.adam_programs;
drop trigger if exists aura_audit_runs      on public.adam_agent_runs;
drop trigger if exists aura_audit_artifacts on public.adam_program_artifacts;
drop function if exists public.aura_audit();
drop table if exists public.audit_events;         -- this destroys all audit rows, on purpose
drop table if exists public.aura_audit_config;
alter table if exists public.adam_program_events_retired_20260807
  rename to adam_program_events;

-- 3. assert clean state
do $$
begin
  insert into _kit_rev(check_name,status,reason) values
    ('R2 audit_events dropped by rollback', case when to_regclass('public.audit_events') is null then 'PASS' else 'FAIL' end, ''),
    ('R3 aura_audit_config dropped', case when to_regclass('public.aura_audit_config') is null then 'PASS' else 'FAIL' end, ''),
    ('R4 trigger function dropped', case when to_regproc('public.aura_audit') is null then 'PASS' else 'FAIL' end, '');
  if to_regclass('public.adam_program_events') is not null then
    insert into _kit_rev(check_name,status,reason) values ('R5 adam_program_events name restored','PASS','');
  else
    insert into _kit_rev(check_name,status,reason) values ('R5 adam_program_events name restored','N/A','table did not exist in this scratch env');
  end if;
end $$;

select check_name, status, reason from _kit_rev order by seq;

-- CORRECT-BEHAVIOUR ASSERTION, stated loudly:
--   Rollback DROPS audit_events and therefore ALL audit rows with it. This is correct
--   for a full reversal of Step 1, and it is NOT silent — it is right here in the
--   rollback block and in the migration's rollback. CONSEQUENCE: never roll back a
--   POPULATED PRODUCTION audit log without exporting audit_events first. On a throwaway
--   project this is fine.

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK R6 · run AFTER re-applying the migration block. Proves it re-applies clean.
-- Expect audit_events to exist again with a fresh count of 0.
-- ════════════════════════════════════════════════════════════════════════════════
-- select 'R6 re-apply idempotent' as check_name,
--   case when to_regclass('public.audit_events') is not null
--         and (select count(*) from public.audit_events) = 0 then 'PASS' else 'FAIL' end as status,
--   'audit_events exists and is empty after re-apply' as reason;
