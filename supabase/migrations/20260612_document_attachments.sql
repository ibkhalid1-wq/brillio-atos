create table if not exists public.adam_document_attachments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.adam_programs(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  file_name text not null,
  file_type text not null,
  file_size_bytes integer,
  storage_path text,
  raw_text text,
  phase_context text,
  extraction_status text default 'pending',
  extracted_data jsonb,
  confidence numeric(4, 3),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.adam_document_attachments enable row level security;

drop policy if exists "Users can manage their own program documents" on public.adam_document_attachments;

create policy "Users can manage their own program documents"
  on public.adam_document_attachments
  for all
  using (
    program_id in (
      select id from public.adam_programs where owner_id = auth.uid()
    )
  )
  with check (
    program_id in (
      select id from public.adam_programs where owner_id = auth.uid()
    )
  );

create index if not exists idx_doc_attachments_program
  on public.adam_document_attachments(program_id);

create index if not exists idx_doc_attachments_status
  on public.adam_document_attachments(extraction_status);
