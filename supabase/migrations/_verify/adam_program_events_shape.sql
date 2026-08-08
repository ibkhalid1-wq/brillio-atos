-- STEP 1 PREREQUISITE — shape of adam_program_events.  READ-ONLY. PROD-SAFE.
-- ═══════════════════════════════════════════════════════════════════════════════
-- THIS IS THE ONLY BLOCK IN THE WHOLE KIT THAT TOUCHES PRODUCTION.
-- It performs NO writes, NO DDL, NO temp tables — pure SELECT over the catalog.
-- Safe to paste into the production project's SQL editor. Everything ELSE in the
-- kit runs on a throwaway scratch project only (see step1-scratch-setup.md).
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run BLOCK P1 against each environment (local, staging, production). If P1 says
-- PRESENT, then also run BLOCK P2 for the exact row count. If P1 says ABSENT, skip
-- P2 (the table does not exist and P2 would simply error, harmlessly).
-- No psql meta-commands; paste-and-run in a browser SQL editor.

-- ── BLOCK P1 · presence + shape + columns (read-only, safe whether present or absent)
select
  case when to_regclass('public.adam_program_events') is null then 'ABSENT' else 'PRESENT' end
    as presence,
  case
    when to_regclass('public.adam_program_events') is null
      then 'n/a — never applied here; the Step 1 rename is a safe no-op in this environment'
    when exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='adam_program_events'
                   and column_name in ('event_type','actor_id','prev_snapshot'))
      then '20260613093000 shape (event_type / actor_id / prev_snapshot)'
    when exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='adam_program_events'
                   and column_name in ('kind','detail'))
      then '20260714 shape (kind / detail)'
    else 'PRESENT but unrecognised shape — record the column list below'
  end as shape,
  coalesce(
    (select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
     from information_schema.columns
     where table_schema='public' and table_name='adam_program_events'),
    '(no columns — table absent)') as columns;

-- ── BLOCK P2 · exact row count (READ-ONLY).  Run ONLY if P1 reported PRESENT.
--    A non-zero count is a PARTIAL historical record. The Step 1 migration
--    PRESERVES it by renaming (adam_program_events_retired_20260807). Do NOT
--    migrate these rows into audit_events — that contaminates a complete log with
--    an incomplete one. Record the count in the results template.
select count(*) as row_count from public.adam_program_events;
