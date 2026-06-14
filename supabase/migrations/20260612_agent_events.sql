create table if not exists adam_agent_events (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  phase_id text,
  event_type text not null check (event_type in ('triggered','completed','failed','stale')),
  payload jsonb,
  created_at timestamptz default now()
);

alter table adam_agent_events enable row level security;

drop policy if exists "authenticated read" on adam_agent_events;
create policy "authenticated read" on adam_agent_events
  for select to authenticated using (true);

alter publication supabase_realtime add table adam_agent_events;
