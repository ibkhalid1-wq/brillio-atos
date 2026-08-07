-- STEP 1 TRIGGER COST — throwaway Supabase project ONLY. Synthetic blobs, no real data.
-- Answers: what does the trigger add to every write at production blob size, and
-- how much of that is md5(doc::text) vs changed_keys.
-- Prereq: bootstrap + 20260807_audit_events.sql applied.
-- Usage: psql "$SCRATCH_DB_URL" -f scratch_03_cost_measure.sql
-- Read the three ms/write numbers per size and fill the results template:
--   trigger cost   = full - baseline
--   md5 cost       = full - nofp
--   changed_keys   = nofp - baseline

-- ── helpers ──────────────────────────────────────────────────────────────────
-- Structurally resembles adam_programs.data: many top-level keys, each an array
-- of small objects with a realistic text field. Tune params to hit target size;
-- actual size is printed so you calibrate, not guess.
create or replace function public._gen_blob(n_keys int, arr_len int, txt_len int)
returns jsonb language sql as $$
  select jsonb_object_agg('key_'||k,
    (select jsonb_agg(jsonb_build_object(
        'id',   'e'||k||'_'||i,
        'name', left(md5(k::text||'_'||i::text), 8),
        'text', repeat('x', txt_len)))
     from generate_series(1, arr_len) as i))
  from generate_series(1, n_keys) as k;
$$;

-- Timed loop of UPDATEs; returns average ms per write. jsonb_set cost is present
-- in every variant, so full-minus-baseline isolates the trigger.
create or replace function public._measure(p_id text, iters int)
returns numeric language plpgsql as $$
declare t0 timestamptz; t1 timestamptz; i int;
begin
  t0 := clock_timestamp();
  for i in 1..iters loop
    update public.adam_programs set data = jsonb_set(data, '{_tick}', to_jsonb(i)) where id = p_id;
  end loop;
  t1 := clock_timestamp();
  return round((extract(epoch from (t1 - t0)) * 1000.0) / iters, 3);
end $$;

-- Fingerprint-free variant of the trigger (changed_keys kept, md5 dropped) so the
-- fallback is MEASURED, not assumed. TEST-ONLY; dropped at the end.
create or replace function public.aura_audit_nofp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_intent_txt text := current_setting('aura.intent', true);
  v_intent     jsonb;
  v_new        jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) else null end;
  v_old        jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) else null end;
  v_new_doc    jsonb := coalesce(v_new->'data', v_new->'content');
  v_old_doc    jsonb := coalesce(v_old->'data', v_old->'content');
  v_changed    text[] := null;
  v_missing    boolean := (v_intent_txt is null or v_intent_txt = '' or v_intent_txt = 'null');
begin
  if TG_OP = 'UPDATE' and v_new_doc is not null then
    select array_agg(k) into v_changed from (
      select key as k from jsonb_object_keys(coalesce(v_new_doc,'{}'::jsonb)) as key
      union
      select key as k from jsonb_object_keys(coalesce(v_old_doc,'{}'::jsonb)) as key
    ) keys where (v_new_doc -> k) is distinct from (v_old_doc -> k);
  end if;
  if not v_missing then begin v_intent := v_intent_txt::jsonb; exception when others then v_missing := true; end; end if;
  insert into public.audit_events(table_name, op, row_pk, program_id, actor, action_type,
      affected_kind, affected_id, partial, intent_missing, before_fp, after_fp, changed_keys, intent)
  values(TG_TABLE_NAME, TG_OP, coalesce(v_new->>'id', v_old->>'id'),
      coalesce(v_new->>'program_id', v_old->>'program_id',
               case when TG_TABLE_NAME='adam_programs' then coalesce(v_new->>'id', v_old->>'id') end),
      coalesce(v_intent->>'actor', nullif(auth.uid()::text,'')),
      v_intent->>'action_type', v_intent->>'affected_kind', v_intent->>'affected_id',
      coalesce((v_intent->>'partial')::boolean,false), v_missing,
      null, null,                       -- << md5 fingerprints skipped
      v_changed, v_intent);
  return null;
end $$;

insert into public.adam_programs(id, data) values ('cost-1','{}'::jsonb) on conflict (id) do nothing;

-- ── one block per target size. Tune the three ints until actual_size ≈ target. ──
-- 1 MB
update public.adam_programs set data = public._gen_blob(200, 20, 200) where id='cost-1';
select '1MB' as target, pg_size_pretty(pg_column_size(data)) as actual_size from public.adam_programs where id='cost-1';
select '1MB' as size, 'full'     as variant, public._measure('cost-1', 20) as ms_per_write;
alter table public.adam_programs disable trigger aura_audit_programs;
select '1MB' as size, 'baseline' as variant, public._measure('cost-1', 20) as ms_per_write;
alter table public.adam_programs enable  trigger aura_audit_programs;
drop trigger aura_audit_programs on public.adam_programs;
create trigger aura_audit_programs after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit_nofp();
select '1MB' as size, 'nofp'     as variant, public._measure('cost-1', 20) as ms_per_write;
drop trigger aura_audit_programs on public.adam_programs;
create trigger aura_audit_programs after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit();

-- 5 MB
update public.adam_programs set data = public._gen_blob(500, 40, 250) where id='cost-1';
select '5MB' as target, pg_size_pretty(pg_column_size(data)) as actual_size from public.adam_programs where id='cost-1';
select '5MB' as size, 'full'     as variant, public._measure('cost-1', 10) as ms_per_write;
alter table public.adam_programs disable trigger aura_audit_programs;
select '5MB' as size, 'baseline' as variant, public._measure('cost-1', 10) as ms_per_write;
alter table public.adam_programs enable  trigger aura_audit_programs;
drop trigger aura_audit_programs on public.adam_programs;
create trigger aura_audit_programs after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit_nofp();
select '5MB' as size, 'nofp'     as variant, public._measure('cost-1', 10) as ms_per_write;
drop trigger aura_audit_programs on public.adam_programs;
create trigger aura_audit_programs after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit();

-- 10 MB
update public.adam_programs set data = public._gen_blob(800, 60, 300) where id='cost-1';
select '10MB' as target, pg_size_pretty(pg_column_size(data)) as actual_size from public.adam_programs where id='cost-1';
select '10MB' as size, 'full'     as variant, public._measure('cost-1', 6) as ms_per_write;
alter table public.adam_programs disable trigger aura_audit_programs;
select '10MB' as size, 'baseline' as variant, public._measure('cost-1', 6) as ms_per_write;
alter table public.adam_programs enable  trigger aura_audit_programs;
drop trigger aura_audit_programs on public.adam_programs;
create trigger aura_audit_programs after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit_nofp();
select '10MB' as size, 'nofp'     as variant, public._measure('cost-1', 6) as ms_per_write;
drop trigger aura_audit_programs on public.adam_programs;
create trigger aura_audit_programs after insert or update or delete on public.adam_programs
  for each row execute function public.aura_audit();

-- cleanup test-only objects
drop function if exists public.aura_audit_nofp();
drop function if exists public._measure(text, int);
drop function if exists public._gen_blob(int, int, int);

-- INTERPRETATION: if 'full' at 10MB is an unacceptable per-write penalty, adopt the
-- fallback proven here: drop the md5 fingerprints (keep changed_keys). 'nofp' shows
-- what that costs. Do NOT keep fingerprints and drop changed_keys — that removes the
-- cheap signal and keeps the expensive one.
