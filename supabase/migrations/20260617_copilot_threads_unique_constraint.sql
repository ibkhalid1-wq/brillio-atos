-- Repair the missing unique constraint on adam_copilot_threads.
--
-- The copilot-chat edge function upserts this table with
--   ON CONFLICT (program_id, workspace_id, owner_id)
-- but the unique() declared in 001_agent_infrastructure.sql never materialised on
-- databases where the table pre-existed (it was created under
-- `create table if not exists`, so the constraint clause was silently skipped).
-- Without the matching constraint every upsert fails with Postgres 42P10
-- ("there is no unique or exclusion constraint matching the ON CONFLICT
-- specification"), so the function returns 500 "Failed to save message to
-- thread." This breaks copilot chat, per-field AI assist
-- (Improve/Expand/Rewrite/Generate) and document-import extraction — every path
-- that writes a thread.

-- 1. Collapse any pre-existing duplicate threads for the same key, keeping the
--    most recently active row, so the constraint can be created without error and
--    without losing live conversation history.
with ranked as (
  select id,
         row_number() over (
           partition by program_id, workspace_id, owner_id
           order by last_activity_at desc nulls last, created_at desc nulls last
         ) as rn
  from adam_copilot_threads
)
delete from adam_copilot_threads t
using ranked r
where t.id = r.id and r.rn > 1;

-- 2. Add the unique constraint if it is genuinely absent (idempotent).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'adam_copilot_threads'::regclass
      and contype = 'u'
      and conkey = (
        select array_agg(attnum order by attnum)
        from pg_attribute
        where attrelid = 'adam_copilot_threads'::regclass
          and attname in ('program_id', 'workspace_id', 'owner_id')
      )
  ) then
    alter table adam_copilot_threads
      add constraint adam_copilot_threads_program_id_workspace_id_owner_id_key
      unique (program_id, workspace_id, owner_id);
  end if;
end $$;
