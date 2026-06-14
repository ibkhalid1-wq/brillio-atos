-- Universal Document Intelligence schema enhancements
-- Adds traceability, entity storage, and AI audit fields to the document pipeline

-- 1. Enhance adam_document_attachments with traceability columns
alter table public.adam_document_attachments
  add column if not exists document_type      text,
  add column if not exists summary            text,
  add column if not exists relevant_phases    text[],
  add column if not exists entities           jsonb,
  add column if not exists ai_provider        text,
  add column if not exists ai_model           text,
  add column if not exists extraction_latency_ms integer,
  add column if not exists input_tokens       integer,
  add column if not exists output_tokens      integer,
  add column if not exists reviewed_at        timestamptz,
  add column if not exists review_actions     jsonb,   -- per-field approve/reject/edit log
  add column if not exists gaps_identified    text;    -- AI-identified missing information

-- 2. Index for entity and phase queries
create index if not exists idx_doc_attachments_doc_type
  on public.adam_document_attachments (document_type);

create index if not exists idx_doc_attachments_phases
  on public.adam_document_attachments using gin (relevant_phases);

create index if not exists idx_doc_attachments_entities
  on public.adam_document_attachments using gin (entities);

-- 3. Document entity audit log — full traceability from field value → source document
create table if not exists public.adam_document_entity_audit (
  id              uuid primary key default gen_random_uuid(),
  program_id      uuid not null references public.adam_programs (id) on delete cascade,
  attachment_id   uuid not null references public.adam_document_attachments (id) on delete cascade,
  phase_id        text not null,
  field_id        text not null,
  field_value     text not null,
  source_text     text,          -- quote from document
  extraction_type text not null, -- extracted | enriched | inferred
  confidence      numeric(4,3),
  ai_provider     text,
  ai_model        text,
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz default now(),
  created_at      timestamptz default now()
);

-- Index for traceability queries: "which documents informed this field?"
create index if not exists idx_entity_audit_program
  on public.adam_document_entity_audit (program_id, phase_id, field_id);

create index if not exists idx_entity_audit_attachment
  on public.adam_document_entity_audit (attachment_id);

-- 4. RLS on entity audit table — same permissive policy as attachments
alter table public.adam_document_entity_audit enable row level security;

create policy "program_members_entity_audit"
  on public.adam_document_entity_audit
  for all
  using  (program_id in (select id from public.adam_programs))
  with check (program_id in (select id from public.adam_programs));
