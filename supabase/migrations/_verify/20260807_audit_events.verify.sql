-- Verify STEP 1 (audit_events) on a SCRATCH/LOCAL database only.
-- Run after applying 20260807_audit_events.sql. Not idempotent; runs in a rollback.
-- Usage:  psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f this_file.sql
-- Expectation: every RAISE NOTICE line prints ' PASS'. Any ' FAIL' is a defect.

begin;

-- A seed program row we own (service-role context: auth.uid() is null).
-- Use a real-looking text id; adam_programs.id is text in practice.
insert into public.adam_programs (id, owner_id, data)
  values ('verify-prog-1', null, jsonb_build_object('domainOntology', '{}'::jsonb, 'k', 1))
  on conflict (id) do update set data = excluded.data;

-- 1) COMPLETENESS: update WITHOUT intent -> event still written, intent_missing=true
update public.adam_programs set data = jsonb_set(data, '{k}', '2') where id = 'verify-prog-1';
do $$
declare n int;
begin
  select count(*) into n from public.audit_events
    where row_pk='verify-prog-1' and op='UPDATE' and intent_missing;
  raise notice '1 completeness (no-intent write recorded):%', case when n>=1 then ' PASS' else ' FAIL' end;
end $$;

-- 2) RICH: update WITH intent -> rich event, intent_missing=false, action_type set
select set_config('aura.intent',
  '{"action_type":"inputs.saved","affected_kind":"phaseInputs","affected_id":"/phaseInputs/listen","partial":false,"actor":"tester"}',
  true);
update public.adam_programs set data = jsonb_set(data, '{k}', '3') where id = 'verify-prog-1';
do $$
declare r record;
begin
  select * into r from public.audit_events
    where row_pk='verify-prog-1' and op='UPDATE' order by id desc limit 1;
  raise notice '2 rich event (intent honoured):%',
    case when r.intent_missing=false and r.action_type='inputs.saved'
          and r.actor='tester' and r.affected_id='/phaseInputs/listen' then ' PASS' else ' FAIL' end;
end $$;

-- 3) CHANGED KEYS floor: a data-blob update lists only the changed top-level key
select set_config('aura.intent', '{"action_type":"t","actor":"tester"}', true);
update public.adam_programs
   set data = jsonb_set(data, '{newkey}', '"x"') where id='verify-prog-1';
do $$
declare r record;
begin
  select * into r from public.audit_events where row_pk='verify-prog-1' order by id desc limit 1;
  raise notice '3 changed_keys (floor, no deep diff):%',
    case when r.changed_keys @> array['newkey'] then ' PASS' else ' FAIL' end;
end $$;

-- 4) FINGERPRINTS present and differ across a real change
do $$
declare r record;
begin
  select * into r from public.audit_events where row_pk='verify-prog-1' order by id desc limit 1;
  raise notice '4 fingerprints (before<>after):%',
    case when r.before_fp is not null and r.after_fp is not null and r.before_fp <> r.after_fp
         then ' PASS' else ' FAIL' end;
end $$;

-- 5) ENFORCE + service-role: missing intent must RAISE
update public.aura_audit_config set enforce = true;
do $$
begin
  -- reset intent to empty for this statement
  perform set_config('aura.intent', '', true);
  begin
    update public.adam_programs set data = jsonb_set(data, '{k}', '9') where id='verify-prog-1';
    raise notice '5 enforce raises on service-role no-intent: FAIL (did not raise)';
  exception when others then
    raise notice '5 enforce raises on service-role no-intent: PASS (%).', sqlerrm;
  end;
end $$;
update public.aura_audit_config set enforce = false;

-- 6) TRIGGER IS SOLE WRITER: direct INSERT into audit_events is not granted to app roles.
--    (Grant-level; verify by role. Under service_role/authenticated the following is revoked.)
--    Manual check (run as authenticated, expect permission denied):
--      insert into public.audit_events(table_name, op) values ('x','INSERT');
raise notice '6 direct-insert revocation: MANUAL — run the commented insert as authenticated; expect denied';

-- 7) RETIREMENT: the dormant table is renamed, not present under its old name
do $$
declare old_exists boolean; new_exists boolean;
begin
  select exists(select 1 from information_schema.tables
    where table_schema='public' and table_name='adam_program_events') into old_exists;
  select exists(select 1 from information_schema.tables
    where table_schema='public' and table_name='adam_program_events_retired_20260807') into new_exists;
  raise notice '7 dormant table retired (renamed, not dropped):%',
    case when new_exists and not old_exists then ' PASS'
         when not new_exists and not old_exists then ' N/A (table absent in this env)'
         else ' FAIL' end;
end $$;

rollback;   -- verification leaves no trace

-- REVERSIBILITY (run separately, on a populated scratch DB):
--   apply 20260807_audit_events.sql  -> run this file (all PASS)
--   apply the ROLLBACK block          -> confirm audit_events/trigger gone,
--                                        adam_program_events name restored
--   apply 20260807_audit_events.sql again -> re-runs clean (idempotent)
