-- Externalized large text fields for programmes.
--
-- WHY. A programme's whole state lives in one `adam_programs.data` JSONB blob.
-- Pasted transcripts (sponsorConversation ~100k+ chars, interviewTranscripts,
-- steering/ops/ship conversations, demoFeedback) make that blob multi-MB, so
-- every write re-ships the whole thing and large writes hit Postgres's
-- statement timeout (57014). That timeout is what fed the write-queue clobber
-- cascade. Moving the big free-text fields into their own rows makes each write
-- touch a small delta.
--
-- MODEL. Storage only — the app keeps its single-blob READ model. On load the
-- texts are merged back into the in-memory `phaseInputs` so the ~43 synchronous
-- readers are untouched; on write the big fields are split back out. See
-- docs/transcript-externalization.md for the phased rollout.
--
-- This migration is NON-DESTRUCTIVE: it creates an empty table. Nothing reads
-- or writes it until the app's dual-write/dual-read is enabled behind its flag.

create table if not exists public.adam_program_texts (
  program_id  uuid        not null references public.adam_programs (id) on delete cascade,
  field_key   text        not null,           -- e.g. 'sponsorConversation'
  movement_id text        not null default '', -- owning phase/movement, for scoping
  content     text        not null default '',
  chars       integer     not null default 0,  -- length, for cheap presence checks
  updated_at  timestamptz not null default now(),
  primary key (program_id, field_key)
);

comment on table public.adam_program_texts is
  'Externalized large free-text programme fields (transcripts) kept out of adam_programs.data so writes stay small. Merged into the in-memory blob on load.';

-- Row-level security mirrors adam_programs: you can touch a text row only for a
-- programme you own or have been granted membership on.
alter table public.adam_program_texts enable row level security;

create policy adam_program_texts_select on public.adam_program_texts
  for select using (
    exists (
      select 1 from public.adam_programs p
      where p.id = adam_program_texts.program_id
      -- delegate visibility to adam_programs' own RLS: if the caller can see the
      -- parent row, they can see its texts.
    )
  );

create policy adam_program_texts_write on public.adam_program_texts
  for all using (
    exists (
      select 1 from public.adam_programs p
      where p.id = adam_program_texts.program_id
    )
  ) with check (
    exists (
      select 1 from public.adam_programs p
      where p.id = adam_program_texts.program_id
    )
  );

create index if not exists adam_program_texts_program_idx
  on public.adam_program_texts (program_id);
