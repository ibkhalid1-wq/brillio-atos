-- STEP 1 CONTRACT CHECKS — throwaway Supabase project ONLY. Runs in a rollback.
-- Prereq: scratch_01_bootstrap.sql applied, then 20260807_audit_events.sql applied.
-- Every check prints ' PASS' or ' FAIL'. Any ' FAIL' blocks the enforce flip / Step 1b.
-- Usage: psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f scratch_02_contract_checks.sql

begin;

-- roles/claims used to simulate the two trust domains
--   service-role  = no jwt (auth.uid() IS NULL)     -> default psql session
--   client session= jwt sub set + role authenticated -> auth.uid() = that sub
\set owner_uuid '00000000-0000-0000-0000-000000000001'

-- seed a program owned by owner_uuid; grant the app-role table privileges the
-- real app would have (scratch mirrors prod grants so the trigger path is exercised)
insert into public.adam_programs(id, owner_id, data)
  values ('cc-prog-1', :'owner_uuid', '{"k":1}'::jsonb)
  on conflict (id) do update set data = excluded.data;
grant select, insert, update, delete on public.adam_programs to authenticated;

-- ── C3 (CRITICAL): intent set INSIDE a SECURITY DEFINER function reaches the trigger.
-- This is the assumption the entire run-agent RPC design rests on.
create or replace function public._test_definer_write(p_id text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform set_config('aura.intent', '{"action_type":"definer_test","actor":"rpc"}', true);
  update public.adam_programs set data = jsonb_set(data, '{via}', '"definer"') where id = p_id;
end $$;
select public._test_definer_write('cc-prog-1');
do $$
declare r record;
begin
  select * into r from public.audit_events where row_pk='cc-prog-1' order by id desc limit 1;
  raise notice 'C3 SECURITY DEFINER intent reaches trigger:%',
    case when r.intent_missing=false and r.action_type='definer_test' and r.actor='rpc'
         then ' PASS' else ' FAIL (intent not seen across definer boundary)' end;
end $$;

-- ── C4: trigger is the SOLE writer — a direct write to audit_events by the app role is denied.
set local role authenticated;
do $$
begin
  begin insert into public.audit_events(table_name, op) values ('x','INSERT');
    raise notice 'C4a direct INSERT denied: FAIL (it succeeded)';
  exception when others then raise notice 'C4a direct INSERT denied: PASS (%)', sqlerrm; end;
  begin update public.audit_events set partial=true where true;
    raise notice 'C4b direct UPDATE denied: FAIL (it succeeded)';
  exception when others then raise notice 'C4b direct UPDATE denied: PASS (%)', sqlerrm; end;
  begin delete from public.audit_events where true;
    raise notice 'C4c direct DELETE denied: FAIL (it succeeded)';
  exception when others then raise notice 'C4c direct DELETE denied: PASS (%)', sqlerrm; end;
end $$;
reset role;

-- ── C5: definer trigger insert fires when the CALLER is the unprivileged app role.
select set_config('request.jwt.claims', json_build_object('sub', :'owner_uuid')::text, true);
set local role authenticated;
select set_config('aura.intent', '{"action_type":"client_edit","actor":"spoofed"}', true);
update public.adam_programs set data = jsonb_set(data, '{k}', '2') where id = 'cc-prog-1';
reset role;
do $$
declare r record;
begin
  select * into r from public.audit_events
    where row_pk='cc-prog-1' and action_type='client_edit' order by id desc limit 1;
  raise notice 'C5 trigger writes under app-role caller:%',
    case when r.id is not null then ' PASS' else ' FAIL (no row written)' end;

  -- C5b ACTOR PROVENANCE (FLAGGED DEFECT). For a CLIENT session, actor must come
  -- from the JWT (auth.uid), never from client-supplied intent, or a client can
  -- spoof attribution. Step 1 Q1 model: "JWT supplies actor" for client sessions.
  -- The CURRENTLY COMMITTED trigger does coalesce(intent.actor, auth.uid()), so
  -- intent.actor wins and this FAILS until the trigger is corrected. See runbook
  -- section "Trigger correction found during kit authoring".
  raise notice 'C5b actor from JWT not client intent:%',
    case when r.actor = '00000000-0000-0000-0000-000000000001' then ' PASS'
         else ' FAIL (actor='||coalesce(r.actor,'null')||'; client intent overrode JWT — trigger fix needed)' end;
end $$;

-- ── C6: owner-only RLS read — authenticated sees only its own program's audit rows.
insert into public.adam_programs(id, owner_id, data)
  values ('cc-prog-2', '00000000-0000-0000-0000-000000000002', '{"k":1}') on conflict (id) do nothing;
select set_config('aura.intent', '{"action_type":"seed_other"}', true);
update public.adam_programs set data = jsonb_set(data,'{k}','9') where id='cc-prog-2';
select set_config('request.jwt.claims', json_build_object('sub', :'owner_uuid')::text, true);
set local role authenticated;
do $$
declare mine int; theirs int;
begin
  select count(*) into mine   from public.audit_events where program_id='cc-prog-1';
  select count(*) into theirs from public.audit_events where program_id='cc-prog-2';
  raise notice 'C6 owner-only read (see mine, not theirs):%',
    case when mine >= 1 and theirs = 0 then ' PASS' else ' FAIL (mine='||mine||' theirs='||theirs||')' end;
end $$;
reset role;

-- ── C1 / C2: enforce-mode trust-domain split.
update public.aura_audit_config set enforce = true;

-- C1: client session (jwt present) + missing intent -> recorded, NOT raised.
select set_config('request.jwt.claims', json_build_object('sub', :'owner_uuid')::text, true);
set local role authenticated;
select set_config('aura.intent','', true);
do $$
begin
  begin
    update public.adam_programs set data = jsonb_set(data,'{k}','3') where id='cc-prog-1';
    raise notice 'C1 client missing-intent recorded not raised: PASS';
  exception when others then
    raise notice 'C1 client missing-intent recorded not raised: FAIL (it raised: %)', sqlerrm;
  end;
end $$;
reset role;

-- C2: service role (no jwt, auth.uid NULL) + missing intent -> RAISES.
select set_config('request.jwt.claims','', true);
select set_config('aura.intent','', true);
do $$
begin
  begin
    update public.adam_programs set data = jsonb_set(data,'{k}','4') where id='cc-prog-1';
    raise notice 'C2 service missing-intent raises: FAIL (it did not raise)';
  exception when others then
    raise notice 'C2 service missing-intent raises: PASS (%)', sqlerrm;
  end;
end $$;

update public.aura_audit_config set enforce = false;
drop function if exists public._test_definer_write(text);

rollback;   -- leaves no trace
