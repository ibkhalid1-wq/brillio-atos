alter table public.adam_document_attachments
  add column if not exists ocr_confidence integer,
  add column if not exists page_count integer,
  add column if not exists sheet_count integer,
  add column if not exists slide_count integer;
