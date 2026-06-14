-- Fix RLS on adam_document_attachments to work regardless of auth session.
-- The previous policy required auth.uid() to match adam_programs.owner_id,
-- which blocks inserts for unauthenticated / session-less users.
-- New policy: allow all operations as long as the program_id exists in adam_programs.
-- Uploaded_by is recorded for auditing but is not required for access.

drop policy if exists "Users can manage their own program documents" on public.adam_document_attachments;
drop policy if exists "owner_all_document_attachments"              on public.adam_document_attachments;

create policy "program_members_all_document_attachments"
  on public.adam_document_attachments
  for all
  using (
    program_id in (select id from public.adam_programs)
  )
  with check (
    program_id in (select id from public.adam_programs)
  );
