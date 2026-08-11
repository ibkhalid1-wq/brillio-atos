-- STEP 1 TRIGGER COST — SCRATCH project only. Synthetic blobs, no real data.
-- Answers: what does the trigger add per write at production blob size, and how much
-- of that is md5(doc::text) vs changed_keys. Editor-safe; no meta-commands, no notices.
--
-- Prereq in this project: bootstrap, then the migration.
-- RUN THE BLOCKS IN ORDER: 4.0 (setup), then 4.1 / 4.2 / 4.3 (per size), then 4.4
-- (summary). Each size is its OWN block so a slow 10 MB run cannot lose the 1/5 MB
-- results, and so no single statement risks a timeout. Each ends in a SELECT you read.
--
-- Authored, not executed (no local Postgres here). Unverified against a running DB.

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK 4.0 · SETUP — helpers + results table + the row we mutate. Run once.
-- ════════════════════════════════════════════════════════════════════════════════
drop table if exists _kit_cost;
create table _kit_cost (seq serial primary key, size text, variant text, ms_per_write numeric, actual_size text);

-- a blob structurally like adam_programs.data: many top-level keys, each an array of
-- small objects with a realistic text field. Tune params per size to hit the target.
create or replace function public._gen_blob(n_keys int, arr_len int, txt_len int)
returns jsonb language sql as $$
  select jsonb_object_agg('key_'||k,
    (select jsonb_agg(jsonb_build_object('id','e'||k||'_'||i,'name',left(md5(k::text||'_'||i::text),8),'text',repeat('x',txt_len)))
     from generate_series(1, arr_len) as i))
  from generate_series(1, n_keys) as k;
$$;

-- timed loop of UPDATEs -> average ms/write. jsonb_set cost is in every variant, so
-- full-minus-baseline isolates the trigger.
create or replace function public._measure(p_id text, iters int)
returns numeric language plpgsql as $$
declare t0 timestamptz; t1 timestamptz; i int;
begin
  t0 := clock_timestamp();
  for i in 1..iters loop
    update public.adam_programs set data = jsonb_set(data,'{_tick}', to_jsonb(i)) where id = p_id;
  end loop;
  t1 := clock_timestamp();
  return round((extract(epoch from (t1 - t0)) * 1000.0) / iters, 3);
end $$;

-- fingerprint-free trigger variant (changed_keys kept, md5 dropped) so the fallback
-- is MEASURED, not assumed. TEST-ONLY; dropped in block 4.4.
create or replace function public.aura_audit_nofp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_intent_txt text := current_setting('aura.intent', true);
  v_intent jsonb;
  v_new jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) else null end;
  v_old jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) else null end;
  v_new_doc jsonb := coalesce(v_new->'data', v_new->'content');
  v_old_doc jsonb := coalesce(v_old->'data', v_old->'content');
  v_changed text[] := null;
  v_jwt text; v_claimed text; v_actor text; v_mismatch text;
  v_missing boolean := (v_intent_txt is null or v_intent_txt = '' or v_intent_txt = 'null');
begin
  if TG_OP = 'UPDATE' and v_new_doc is not null then
    select array_agg(k) into v_changed from (
      select key as k from jsonb_object_keys(coalesce(v_new_doc,'{}'::jsonb)) as key
      union select key as k from jsonb_object_keys(coalesce(v_old_doc,'{}'::jsonb)) as key
    ) keys where (v_new_doc -> k) is distinct from (v_old_doc -> k);
  end if;
  if not v_missing then begin v_intent := v_intent_txt::jsonb; exception when others then v_missing := true; end; end if;
  v_jwt := nullif(auth.uid()::text,''); v_claimed := v_intent->>'actor';
  if v_jwt is not null then v_actor := v_jwt; if v_claimed is not null and v_claimed <> v_jwt then v_mismatch := v_claimed; end if;
  else v_actor := v_claimed; end if;
  insert into public.audit_events(table_name, op, row_pk, program_id, actor, actor_intent_mismatch, action_type,
      affected_kind, affected_id, partial, intent_missing, before_fp, after_fp, changed_keys, intent)
  values(TG_TABLE_NAME, TG_OP, coalesce(v_new->>'id', v_old->>'id'),
      coalesce(v_new->>'program_id', v_old->>'program_id', case when TG_TABLE_NAME='adam_programs' then coalesce(v_new->>'id', v_old->>'id') end),
      v_actor, v_mismatch, v_intent->>'action_type', v_intent->>'affected_kind', v_intent->>'affected_id',
      (v_intent->>'partial')::boolean, v_missing, null, null, v_changed, v_intent);   -- md5 skipped
  return null;
end $$;

insert into public.adam_programs(id, data) values ('cost-1','{}'::jsonb) on conflict (id) do nothing;
select 'cost setup' as step, 'ready' as status;

-- Each size is one DO block: it sets the blob, then measures full / baseline / nofp
-- into locals (the measure function mutates adam_programs internally, so it is called
-- as a plain assignment — never inside a query that also scans that table), swaps the
-- trigger with EXECUTE, and writes the three rows + actual_size in one insert. Then a
-- SELECT returns that size's rows. Tune the three _gen_blob ints if actual_size is off.

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK 4.1 · ~1 MB
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare sz text; full_ms numeric; base_ms numeric; nofp_ms numeric;
begin
  update public.adam_programs set data = public._gen_blob(200, 20, 200) where id='cost-1';
  select pg_size_pretty(pg_column_size(data)::bigint) into sz from public.adam_programs where id='cost-1';
  full_ms := public._measure('cost-1', 20);
  execute 'alter table public.adam_programs disable trigger aura_audit_programs';
  base_ms := public._measure('cost-1', 20);
  execute 'alter table public.adam_programs enable trigger aura_audit_programs';
  execute 'drop trigger aura_audit_programs on public.adam_programs';
  execute 'create trigger aura_audit_programs after insert or update or delete on public.adam_programs for each row execute function public.aura_audit_nofp()';
  nofp_ms := public._measure('cost-1', 20);
  execute 'drop trigger aura_audit_programs on public.adam_programs';
  execute 'create trigger aura_audit_programs after insert or update or delete on public.adam_programs for each row execute function public.aura_audit()';
  insert into _kit_cost(size,variant,ms_per_write,actual_size) values
    ('1MB','full',full_ms,sz), ('1MB','baseline',base_ms,sz), ('1MB','nofp',nofp_ms,sz);
end $$;
select size, variant, ms_per_write, actual_size from _kit_cost where size='1MB' order by variant;

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK 4.2 · ~5 MB
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare sz text; full_ms numeric; base_ms numeric; nofp_ms numeric;
begin
  update public.adam_programs set data = public._gen_blob(500, 40, 250) where id='cost-1';
  select pg_size_pretty(pg_column_size(data)::bigint) into sz from public.adam_programs where id='cost-1';
  full_ms := public._measure('cost-1', 10);
  execute 'alter table public.adam_programs disable trigger aura_audit_programs';
  base_ms := public._measure('cost-1', 10);
  execute 'alter table public.adam_programs enable trigger aura_audit_programs';
  execute 'drop trigger aura_audit_programs on public.adam_programs';
  execute 'create trigger aura_audit_programs after insert or update or delete on public.adam_programs for each row execute function public.aura_audit_nofp()';
  nofp_ms := public._measure('cost-1', 10);
  execute 'drop trigger aura_audit_programs on public.adam_programs';
  execute 'create trigger aura_audit_programs after insert or update or delete on public.adam_programs for each row execute function public.aura_audit()';
  insert into _kit_cost(size,variant,ms_per_write,actual_size) values
    ('5MB','full',full_ms,sz), ('5MB','baseline',base_ms,sz), ('5MB','nofp',nofp_ms,sz);
end $$;
select size, variant, ms_per_write, actual_size from _kit_cost where size='5MB' order by variant;

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK 4.3 · ~10 MB.  The size the cost guard exists for.
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare sz text; full_ms numeric; base_ms numeric; nofp_ms numeric;
begin
  update public.adam_programs set data = public._gen_blob(800, 60, 300) where id='cost-1';
  select pg_size_pretty(pg_column_size(data)::bigint) into sz from public.adam_programs where id='cost-1';
  full_ms := public._measure('cost-1', 6);
  execute 'alter table public.adam_programs disable trigger aura_audit_programs';
  base_ms := public._measure('cost-1', 6);
  execute 'alter table public.adam_programs enable trigger aura_audit_programs';
  execute 'drop trigger aura_audit_programs on public.adam_programs';
  execute 'create trigger aura_audit_programs after insert or update or delete on public.adam_programs for each row execute function public.aura_audit_nofp()';
  nofp_ms := public._measure('cost-1', 6);
  execute 'drop trigger aura_audit_programs on public.adam_programs';
  execute 'create trigger aura_audit_programs after insert or update or delete on public.adam_programs for each row execute function public.aura_audit()';
  insert into _kit_cost(size,variant,ms_per_write,actual_size) values
    ('10MB','full',full_ms,sz), ('10MB','baseline',base_ms,sz), ('10MB','nofp',nofp_ms,sz);
end $$;
select size, variant, ms_per_write, actual_size from _kit_cost where size='10MB' order by variant;

-- ════════════════════════════════════════════════════════════════════════════════
-- BLOCK 4.4 · SUMMARY + cleanup. trigger cost = full-baseline; md5 cost = full-nofp.
-- INTERPRETATION: if 'full' at 10 MB is an unacceptable per-write penalty, adopt the
-- fallback proven by 'nofp' — drop the md5 fingerprints, KEEP changed_keys. Never the
-- reverse (that removes the cheap signal and keeps the expensive one).
-- The cleanup drops run first so the SUMMARY select is the last statement the editor
-- shows. It reads _kit_cost (a table), not the dropped helper functions.
-- ════════════════════════════════════════════════════════════════════════════════
drop function if exists public.aura_audit_nofp();
drop function if exists public._measure(text, int);
drop function if exists public._gen_blob(int, int, int);

select
  size,
  max(actual_size) as actual_size,
  max(ms_per_write) filter (where variant='full')     as full_ms,
  max(ms_per_write) filter (where variant='baseline') as baseline_ms,
  max(ms_per_write) filter (where variant='nofp')     as nofp_ms,
  round(max(ms_per_write) filter (where variant='full') - max(ms_per_write) filter (where variant='baseline'), 3) as trigger_cost_ms,
  round(max(ms_per_write) filter (where variant='full') - max(ms_per_write) filter (where variant='nofp'), 3)     as md5_cost_ms
from _kit_cost
group by size
order by (array_position(array['1MB','5MB','10MB'], size));
