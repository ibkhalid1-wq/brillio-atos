alter table if exists public.adam_ai_provider_settings
  add column if not exists model text null;
