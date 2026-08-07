-- STEP 1 PREREQUISITE — shape of adam_program_events.  READ-ONLY. PROD-SAFE.
-- Run this UNCHANGED against EACH environment: local, staging, production.
-- It never writes, never alters, never drops. Safe to run on production.
--
-- Usage:  psql "$ENV_DB_URL" -v ON_ERROR_STOP=1 -f adam_program_events_shape.sql
-- Record the output per environment in the results template.

\echo '=== environment:' :DBNAME '==='

-- 1. present or absent?
do $$
begin
  if to_regclass('public.adam_program_events') is null then
    raise notice 'adam_program_events: ABSENT (never applied here)';
  else
    raise notice 'adam_program_events: PRESENT';
  end if;
end $$;

-- 2. columns + types (empty result set == table absent, which is fine)
select ordinal_position, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'adam_program_events'
order by ordinal_position;

-- 3. row count (guarded so an absent table does not error)
do $$
declare n bigint;
begin
  if to_regclass('public.adam_program_events') is not null then
    execute 'select count(*) from public.adam_program_events' into n;
    raise notice 'adam_program_events row_count: %', n;
  else
    raise notice 'adam_program_events row_count: N/A (absent)';
  end if;
end $$;

-- INTERPRETATION (record which case is true per environment):
--   * columns include event_type / actor_id / prev_snapshot  -> the 20260613093000 shape is live.
--   * columns include kind / detail and id is bigint          -> the 20260714 shape is live.
--   * ABSENT / zero columns                                   -> never applied; the Step 1 rename is a safe no-op here.
--   * row_count > 0  -> a PARTIAL record from an unknown period. The Step 1 rename PRESERVES it
--                       (renames to adam_program_events_retired_20260807). DO NOT migrate these
--                       rows into audit_events — that would contaminate a complete log with an
--                       incomplete one. Leave them in the retired table.
