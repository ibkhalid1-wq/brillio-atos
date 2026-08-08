-- STEP 1 CONTRACT CHECKS — SCRATCH project only. Two blocks; paste each and Run.
-- Prereq in this project: bootstrap, then the migration.
-- Every check returns a row with PASS/FAIL and a reason. Any FAIL blocks Step 1b /
-- the enforce flip. No RAISE NOTICE, no psql meta-commands, no file includes.
--
-- WHY TWO BLOCKS — what is editor-safe vs what needs a direct connection:
--   BLOCK A (C1,C2,C3,C5,C7): the trigger's trust-domain split keys off auth.uid()
--     (the JWT GUC), which we set with set_config. NO role switch is needed, so
--     these run correctly in any SQL editor, including a hosted dashboard.
--   BLOCK B (C4 grant-denial, C6 RLS read): these MUST run as the unprivileged
--     'authenticated' role. A hosted editor usually connects as a superuser/owner
--     role that BYPASSES grants and RLS — under which C4/C6 would be meaningless.
--     Block B attempts `set role authenticated`; if that is rejected, or if you are
--     connected as a BYPASSRLS superuser, run Block B over a DIRECT psql connection
--     with a non-superuser role, or via the MCP Postgres connector (db-access-options.md).
--     Do NOT record C4/C6 as passed from a hosted editor alone.
--
-- Authored, not executed (no local Postgres here). Unverified against a running DB.

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK A · EDITOR-SAFE CONTRACT CHECKS  (C1, C2, C3, C5, C7)
-- ════════════════════════════════════════════════════════════════════════════════
drop table if exists _kit_contract;
create table _kit_contract (seq serial primary key, check_name text, status text, reason text);

insert into public.adam_programs(id, owner_id, data)
  values ('cc-prog-1','00000000-0000-0000-0000-000000000001','{"k":1}'::jsonb)
  on conflict (id) do update set data = excluded.data;

-- C3 (CRITICAL): intent set INSIDE a SECURITY DEFINER function reaches the trigger.
-- The entire run-agent RPC design rests on this. If it FAILS, stop — Step 1b changes.
create or replace function public._test_definer_write(p_id text) returns void
  language plpgsql security definer set search_path = public as $fn$
begin
  perform set_config('aura.intent','{"action_type":"definer_test","actor":"rpc"}', true);
  update public.adam_programs set data = jsonb_set(data,'{via}','"definer"') where id = p_id;
end $fn$;
do $$
declare r record;
begin
  perform public._test_definer_write('cc-prog-1');
  select * into r from public.audit_events where row_pk='cc-prog-1' order by id desc limit 1;
  insert into _kit_contract(check_name,status,reason) values (
    'C3 SECURITY DEFINER intent reaches trigger',
    case when r.intent_missing=false and r.action_type='definer_test' and r.actor='rpc' then 'PASS' else 'FAIL' end,
    'RPC design depends on this — actor='||coalesce(r.actor,'null')||' action_type='||coalesce(r.action_type,'null'));
end $$;
drop function if exists public._test_definer_write(text);

-- C5 / C5b / C5c: a CLIENT session (JWT present) — trigger writes; actor is the JWT,
-- never the client-supplied intent.actor; a differing claim is kept, not dropped.
-- Keys off the JWT GUC only, so no role switch is needed for the actor-provenance assertion.
do $$
declare r record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
  perform set_config('aura.intent','{"action_type":"client_edit","actor":"spoofed"}', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','2') where id='cc-prog-1';
  select * into r from public.audit_events where row_pk='cc-prog-1' and action_type='client_edit' order by id desc limit 1;
  insert into _kit_contract(check_name,status,reason) values
    ('C5 trigger writes under client caller', case when r.id is not null then 'PASS' else 'FAIL' end,
       'audit row id='||coalesce(r.id::text,'null')),
    ('C5b actor from JWT not client intent', case when r.actor='00000000-0000-0000-0000-000000000001' then 'PASS' else 'FAIL' end,
       'actor='||coalesce(r.actor,'null')||' (JWT must win over intent.actor "spoofed")'),
    ('C5c spoofed actor recorded not dropped', case when r.actor_intent_mismatch='spoofed' then 'PASS' else 'FAIL' end,
       'actor_intent_mismatch='||coalesce(r.actor_intent_mismatch,'null'));
end $$;

-- C7: `partial` is 3-state. NULL = nobody asserted (default), never false by default.
do $$
declare p_missing boolean; p_asserted boolean; n_bad int;
begin
  update public.aura_audit_config set enforce = false;      -- ensure warn mode for the no-intent write
  perform set_config('request.jwt.claims','', true);        -- service context is fine here
  perform set_config('aura.intent','', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','71') where id='cc-prog-1';   -- intent_missing => partial NULL
  perform set_config('aura.intent','{"action_type":"asserted_complete","partial":false}', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','72') where id='cc-prog-1';   -- affirmatively complete
  select partial is null   into p_missing  from public.audit_events where row_pk='cc-prog-1' and intent_missing order by id desc limit 1;
  select partial = false   into p_asserted from public.audit_events where row_pk='cc-prog-1' and action_type='asserted_complete' order by id desc limit 1;
  select count(*)          into n_bad      from public.audit_events where row_pk='cc-prog-1' and intent_missing and partial is not null;
  insert into _kit_contract(check_name,status,reason) values
    ('C7a intent_missing => partial NULL', case when p_missing  then 'PASS' else 'FAIL' end, ''),
    ('C7b asserted partial=false recorded', case when p_asserted then 'PASS' else 'FAIL' end, ''),
    ('C7c NULL distinct from false', case when n_bad=0 then 'PASS' else 'FAIL' end, n_bad||' intent_missing rows carried a non-null partial');
end $$;

-- C1 / C2: enforce-mode trust-domain split.
do $$
begin
  update public.aura_audit_config set enforce = true;
  -- C1: client session (JWT present) + missing intent -> recorded, NOT raised.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
  perform set_config('aura.intent','', true);
  begin
    update public.adam_programs set data = jsonb_set(data,'{k}','3') where id='cc-prog-1';
    insert into _kit_contract(check_name,status,reason) values ('C1 client missing-intent recorded not raised','PASS','JWT gives actor, so no need to fail fast');
  exception when others then
    insert into _kit_contract(check_name,status,reason) values ('C1 client missing-intent recorded not raised','FAIL','it raised: '||sqlerrm);
  end;
  -- C2: service role (no JWT) + missing intent -> RAISES.
  perform set_config('request.jwt.claims','', true);
  perform set_config('aura.intent','', true);
  begin
    update public.adam_programs set data = jsonb_set(data,'{k}','4') where id='cc-prog-1';
    insert into _kit_contract(check_name,status,reason) values ('C2 service missing-intent raises','FAIL','it did not raise');
  exception when others then
    insert into _kit_contract(check_name,status,reason) values ('C2 service missing-intent raises','PASS',sqlerrm);
  end;
  update public.aura_audit_config set enforce = false;
end $$;

select check_name, status, reason from _kit_contract order by seq;

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK B · DIRECT-CONNECTION CHECKS  (C4 grant-denial, C6 RLS read)
-- Run this SEPARATELY. It needs to execute AS the unprivileged 'authenticated' role.
-- If the first result row says 'BLOCKED', your editor could not switch roles — run
-- this block over a direct psql connection (non-superuser) or the MCP connector.
-- ════════════════════════════════════════════════════════════════════════════════
drop table if exists _kit_direct;
create table _kit_direct (seq serial primary key, check_name text, status text, reason text);

-- grant the app role the same table privileges the real app has, and seed two
-- programs owned by different users (done as the owner/postgres, before the switch).
grant select, insert, update, delete on public.adam_programs to authenticated;
insert into public.adam_programs(id,owner_id,data)
  values ('cc-prog-1','00000000-0000-0000-0000-000000000001','{"k":1}') on conflict (id) do update set data=excluded.data;
insert into public.adam_programs(id,owner_id,data)
  values ('cc-prog-2','00000000-0000-0000-0000-000000000002','{"k":1}') on conflict (id) do nothing;
do $$ begin
  perform set_config('aura.intent','{"action_type":"seed"}', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','5') where id='cc-prog-1';
  update public.adam_programs set data = jsonb_set(data,'{k}','5') where id='cc-prog-2';
end $$;

do $$
declare role_ok boolean := true; c4a text; c4b text; c4c text; mine int; theirs int;
begin
  begin execute 'set local role authenticated';
  exception when others then role_ok := false; end;

  if not role_ok then
    insert into _kit_direct(check_name,status,reason) values
      ('C4/C6 role switch','BLOCKED','set role authenticated was rejected — run this block over a direct psql connection (non-superuser) or the MCP connector; see db-access-options.md');
    return;
  end if;

  -- C4: the trigger is the SOLE writer — a direct write by the app role is denied.
  begin execute 'insert into public.audit_events(table_name, op) values (''x'',''INSERT'')'; c4a := 'FAIL (it succeeded)';
  exception when others then c4a := 'PASS ('||sqlerrm||')'; end;
  begin execute 'update public.audit_events set partial = true'; c4b := 'FAIL (it succeeded)';
  exception when others then c4b := 'PASS ('||sqlerrm||')'; end;
  begin execute 'delete from public.audit_events'; c4c := 'FAIL (it succeeded)';
  exception when others then c4c := 'PASS ('||sqlerrm||')'; end;

  -- C6: owner-only RLS read — authenticated sees its own program's audit rows, not others'.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
  select count(*) into mine   from public.audit_events where program_id='cc-prog-1';
  select count(*) into theirs from public.audit_events where program_id='cc-prog-2';

  execute 'reset role';   -- back to owner so we can write the results table

  insert into _kit_direct(check_name,status,reason) values
    ('C4a direct INSERT denied', split_part(c4a,' ',1), c4a),
    ('C4b direct UPDATE denied', split_part(c4b,' ',1), c4b),
    ('C4c direct DELETE denied', split_part(c4c,' ',1), c4c),
    ('C6 owner-only RLS read', case when mine>=1 and theirs=0 then 'PASS' else 'FAIL' end,
       'mine='||mine||' theirs='||theirs||' (a superuser/BYPASSRLS connection makes this meaningless — see block header)');
end $$;

select check_name, status, reason from _kit_direct order by seq;
