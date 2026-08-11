-- STEP 1 FUNCTIONAL VERIFY — SCRATCH project only. Editor-safe (paste & Run).
-- Prereq in this project: scratch_01_bootstrap.sql, then 20260807_audit_events.sql.
-- Output: a single result set, one row per check, each PASS/FAIL + reason. The
-- editor shows the last statement, which is that SELECT. No RAISE NOTICE (a hosted
-- editor may not surface notices), no psql meta-commands, no file includes.
--
-- These are the checks that need NO role switch — the trigger's trust-domain split
-- keys off auth.uid() (the JWT GUC), which we set with set_config. Grant-denial and
-- RLS-read live in scratch_02 (they DO need the authenticated role).
--
-- Each check is fully self-contained inside its own DO block: it sets its GUCs and
-- performs its write together, so it behaves the same whether the editor runs the
-- script as one transaction or one statement at a time.
--
-- Authored, not executed (no local Postgres here). Unverified against a running DB.

drop table if exists _kit_verify;
create table _kit_verify (seq serial primary key, check_name text, status text, reason text);

-- seed a program we own (service context: auth.uid() null)
insert into public.adam_programs (id, owner_id, data)
  values ('verify-prog-1', null, jsonb_build_object('domainOntology','{}'::jsonb,'k',1))
  on conflict (id) do update set data = excluded.data;

-- 1) COMPLETENESS: an UPDATE with NO intent is still recorded, intent_missing=true.
do $$
declare n int;
begin
  perform set_config('aura.intent','', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','2') where id='verify-prog-1';
  select count(*) into n from public.audit_events
    where row_pk='verify-prog-1' and op='UPDATE' and intent_missing;
  insert into _kit_verify(check_name,status,reason)
    values ('1 completeness — no-intent write recorded', case when n>=1 then 'PASS' else 'FAIL' end,
            n||' intent_missing rows (a missing write must never be a silent gap)');
end $$;

-- 2) RICH: an UPDATE WITH intent is honoured (action_type/actor/affected_id set).
do $$
declare r record;
begin
  perform set_config('aura.intent',
    '{"action_type":"inputs.saved","affected_kind":"phaseInputs","affected_id":"/phaseInputs/listen","partial":false,"actor":"tester"}', true);
  update public.adam_programs set data = jsonb_set(data,'{k}','3') where id='verify-prog-1';
  select * into r from public.audit_events where row_pk='verify-prog-1' and op='UPDATE' order by id desc limit 1;
  insert into _kit_verify(check_name,status,reason)
    values ('2 rich event — intent honoured',
      case when r.intent_missing=false and r.action_type='inputs.saved' and r.actor='tester'
                and r.affected_id='/phaseInputs/listen' then 'PASS' else 'FAIL' end,
      'action_type='||coalesce(r.action_type,'null')||' actor='||coalesce(r.actor,'null'));
end $$;

-- 3) CHANGED KEYS floor: a data-blob update lists the changed top-level key.
do $$
declare r record;
begin
  perform set_config('aura.intent','{"action_type":"t","actor":"tester"}', true);
  update public.adam_programs set data = jsonb_set(data,'{newkey}','"x"') where id='verify-prog-1';
  select * into r from public.audit_events where row_pk='verify-prog-1' order by id desc limit 1;
  insert into _kit_verify(check_name,status,reason)
    values ('3 changed_keys — floor, no deep diff',
      case when r.changed_keys @> array['newkey'] then 'PASS' else 'FAIL' end,
      'changed_keys='||coalesce(r.changed_keys::text,'null'));
end $$;

-- 4) FINGERPRINTS ARE OFF BY DECISION, and `changed_keys` carries the "what".
--
-- This check used to assert before_fp <> after_fp. The cost measure (scratch_03,
-- run 2026-08-11) showed md5(doc::text) dominating the trigger — 1282 ms of a
-- 1419 ms overhead at a 933 kB blob, and the live store holds a 1.58 MB and a
-- 5.3 MB row — so the migration takes the COST GUARD's own advice and drops the
-- fingerprints while keeping changed_keys.
--
-- So the check now holds the DECISION rather than the old behaviour, and it is
-- deliberately two-sided: it fails if the fingerprints come back, because the
-- line that re-enables them is the line that decides whether saving a programme
-- is instant or takes three seconds. Anyone re-enabling should have to re-run
-- the cost measure and update this check on purpose.
do $$
declare r record;
begin
  select * into r from public.audit_events where row_pk='verify-prog-1' order by id desc limit 1;
  insert into _kit_verify(check_name,status,reason)
    values ('4 fingerprints off by decision; changed_keys carries the what',
      case when r.before_fp is null and r.after_fp is null and r.changed_keys is not null
           then 'PASS' else 'FAIL' end,
      case when r.before_fp is not null or r.after_fp is not null
           then 'fingerprints are BACK ON — re-run scratch_03 against real blob sizes before accepting this'
           else 'fp=null (by decision) changed_keys='||coalesce(r.changed_keys::text,'null') end);
end $$;

-- 5) ENFORCE + service-role: missing intent must RAISE (fail fast; actor unrecoverable).
do $$
begin
  update public.aura_audit_config set enforce = true;
  perform set_config('request.jwt.claims','', true);   -- service context (auth.uid null)
  perform set_config('aura.intent','', true);
  begin
    update public.adam_programs set data = jsonb_set(data,'{k}','9') where id='verify-prog-1';
    insert into _kit_verify(check_name,status,reason)
      values ('5 enforce raises on service no-intent','FAIL','did not raise');
  exception when others then
    insert into _kit_verify(check_name,status,reason)
      values ('5 enforce raises on service no-intent','PASS',sqlerrm);
  end;
  update public.aura_audit_config set enforce = false;
end $$;

-- 7) RETIREMENT: the dormant table is renamed (present under the retired name, not the old one).
do $$
declare old_exists boolean; new_exists boolean;
begin
  select to_regclass('public.adam_program_events') is not null into old_exists;
  select to_regclass('public.adam_program_events_retired_20260807') is not null into new_exists;
  insert into _kit_verify(check_name,status,reason)
    values ('7 dormant table retired (renamed not dropped)',
      case when new_exists and not old_exists then 'PASS'
           when not new_exists and not old_exists then 'N/A'
           else 'FAIL' end,
      case when not new_exists and not old_exists then 'table absent in this scratch env (expected — you did not create the stub)' else 'old='||old_exists||' retired='||new_exists end);
end $$;

-- (Check 6 — direct-insert revocation — needs the authenticated role; it is in
--  scratch_02_contract_checks.sql, direct-connection section, as C4.)

select check_name, status, reason from _kit_verify order by seq;
