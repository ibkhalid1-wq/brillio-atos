create table if not exists adam_program_artifacts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  phase_id text,
  version int not null default 1,
  content jsonb not null,
  confidence float,
  generated_at timestamptz default now(),
  superseded_at timestamptz,
  superseded_by uuid references adam_program_artifacts(id)
);

alter table adam_program_artifacts enable row level security;

drop policy if exists "authenticated read" on adam_program_artifacts;
create policy "authenticated read" on adam_program_artifacts
  for select to authenticated using (true);

drop policy if exists "service write" on adam_program_artifacts;
create policy "service write" on adam_program_artifacts
  for all to service_role using (true);
