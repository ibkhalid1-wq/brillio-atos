create table if not exists adam_ai_provider_settings (
  provider text primary key,
  api_key text not null,
  configured_by uuid null,
  updated_at timestamptz not null default now()
);

alter table adam_ai_provider_settings enable row level security;

drop policy if exists "no direct client access to ai provider settings" on adam_ai_provider_settings;
create policy "no direct client access to ai provider settings" on adam_ai_provider_settings
for all
using (false)
with check (false);

