alter table if exists public.adam_ai_provider_settings
  add column if not exists is_active boolean not null default false;

create unique index if not exists adam_ai_provider_settings_one_active
  on public.adam_ai_provider_settings (is_active)
  where is_active;
