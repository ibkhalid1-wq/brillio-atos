-- Deleting a program must leave NO residual content anywhere — but the
-- adam_programs row itself has to survive as a minimal `is_deleted=true`
-- tombstone. Cross-device / collaborator clients reconcile deletions by SEEING
-- that tombstone (see src/new/lib/usePrograms.ts: `deletedIds` →
-- purgeLocalPrograms, and the `liveCloudRows.length === 0` re-upsert guard).
-- A pure hard DELETE would make the row simply absent, and a copy still cached
-- in another device's localStorage would resurface as "local-only"
-- (composePrograms) and even get re-upserted back into the cloud.
--
-- So: clear the parent down to a tombstone, and explicitly delete every
-- program-scoped child row. Plain `is_deleted=true` was an UPDATE, so ON DELETE
-- CASCADE never fired and ALL child rows (snapshots, agent runs/observations,
-- artifacts, document raw_text, etc.) lingered indefinitely.

-- Internal worker: does the actual purge. No auth check here — callers gate it.
-- SECURITY DEFINER so it can reach child tables regardless of their RLS.
create or replace function public.adam_purge_program_cascade(p_program_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tbl text;
  -- Every table holding program-scoped content. Guarded by to_regclass so a
  -- missing table in any environment is skipped instead of aborting the purge.
  -- adam_program_members is deliberately NOT here: those rows must persist so a
  -- collaborator's client can still read the is_deleted tombstone and purge its
  -- own local cache.
  child_tables text[] := array[
    'adam_audit_log',
    'adam_agent_observations',
    'adam_agent_events',
    'adam_agent_runs',
    'adam_agent_schedules',
    'adam_copilot_threads',
    'adam_access_audit',
    'adam_program_events',
    'adam_artifact_validations',
    'adam_program_artifacts',
    'adam_program_snapshots',
    'adam_document_attachments',
    'adam_document_entity_audit',
    'adam_autonomy_settings',
    'adam_autonomy_log',
    'adam_decision_audit',
    'adam_phase_agent_states'
  ];
begin
  foreach tbl in array child_tables loop
    if to_regclass('public.' || tbl) is not null then
      -- program_id is `uuid` on some tables and `text` on others; compare as
      -- text on both sides so this works regardless of the column type.
      execute format(
        'delete from public.%I where program_id::text = $1::text', tbl
      ) using p_program_id;
    end if;
  end loop;

  -- Derived patterns survive (the FK is ON DELETE SET NULL by design) but must
  -- not point back at the purged program.
  if to_regclass('public.adam_pattern_library') is not null then
    update public.adam_pattern_library
      set source_program_id = null
      where source_program_id = p_program_id;
  end if;

  -- Strip the parent to a content-free tombstone.
  update public.adam_programs
    set is_deleted = true,
        data       = '{}'::jsonb,
        name       = '',
        client     = null,
        industry   = null,
        updated_at = now()
    where id = p_program_id;
end;
$$;

revoke all on function public.adam_purge_program_cascade(uuid) from public;
revoke all on function public.adam_purge_program_cascade(uuid) from anon;
revoke all on function public.adam_purge_program_cascade(uuid) from authenticated;

-- Public entry point used by the app. Authorizes the caller (owner or program
-- admin), then purges. Mirrors the "admins delete programs" DELETE policy.
create or replace function public.adam_purge_program(p_program_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.adam_programs
    where id = p_program_id
      and (owner_id = auth.uid() or public.adam_is_program_admin(p_program_id::text))
  ) then
    raise exception 'not authorized to delete program %', p_program_id
      using errcode = '42501';
  end if;

  perform public.adam_purge_program_cascade(p_program_id);
  return true;
end;
$$;

grant execute on function public.adam_purge_program(uuid) to authenticated;

-- One-time cleanup: every program already soft-deleted in the app still holds
-- its full data blob and all child rows. Purge that residual now.
do $$
declare r record;
begin
  for r in select id from public.adam_programs where is_deleted loop
    perform public.adam_purge_program_cascade(r.id);
  end loop;
end $$;
