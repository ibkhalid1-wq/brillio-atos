create table if not exists adam_autonomy_settings (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  trust_threshold float not null default 0.85,
  max_autonomous_actions_per_day int default 10,
  requires_human_above_risk text default 'high',
  enabled boolean default false,
  updated_at timestamptz default now(),
  unique(program_id, agent_id)
);

create table if not exists adam_autonomy_log (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  action_type text not null,
  action_payload jsonb,
  confidence float,
  acted_autonomously boolean not null,
  reason text,
  created_at timestamptz default now()
);

alter table adam_autonomy_settings enable row level security;
alter table adam_autonomy_log enable row level security;

drop policy if exists "authenticated read/write settings" on adam_autonomy_settings;
create policy "authenticated read/write settings" on adam_autonomy_settings
  for all to authenticated using (true);

drop policy if exists "authenticated read log" on adam_autonomy_log;
create policy "authenticated read log" on adam_autonomy_log
  for select to authenticated using (true);

drop policy if exists "service insert log" on adam_autonomy_log;
create policy "service insert log" on adam_autonomy_log
  for insert to service_role with check (true);
