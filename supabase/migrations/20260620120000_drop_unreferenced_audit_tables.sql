-- Drop unreferenced audit tables (Cleanup Group 5)
--
-- Both tables were created by earlier migrations but are written/read by NO
-- application code (verified: zero references in src/** and supabase/functions/**
-- as of 2026-06-20). Neither table is the target of any incoming foreign key,
-- trigger, or database function.
--
-- Safety notes:
--   * `cascade` removes the tables' own RLS policies and indexes only — nothing
--     else in the schema depends on these tables.
--   * The shared `is_program_member(uuid)` function is intentionally PRESERVED:
--     it is still used by `adam_program_events` (a retained table).
--   * `adam_program_events` and `adam_document_attachments` are NOT dropped.
--
-- IRREVERSIBLE: this permanently deletes any audit rows held in these tables.

drop table if exists public.adam_document_entity_audit cascade;
drop table if exists public.adam_access_audit cascade;
