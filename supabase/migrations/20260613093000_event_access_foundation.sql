create table if not exists adam_access_audit (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references adam_programs(id) on delete cascade,
  user_id uuid,
  action text not null,
  denied_reason text,
  attempted_at timestamptz default now()
);

create table if not exists adam_program_events (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references adam_programs(id) on delete cascade,
  event_type text not null,
  phase_id text,
  actor_id uuid,
  actor_name text,
  agent_id text,
  payload jsonb not null default '{}'::jsonb,
  prev_snapshot jsonb,
  created_at timestamptz default now()
);

create or replace function is_program_member(prog_id uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1
    from adam_program_members
    where program_id = prog_id
      and user_id = auth.uid()
  );
$$;

alter table adam_access_audit enable row level security;
alter table adam_program_events enable row level security;

drop policy if exists "members_read_access_audit" on adam_access_audit;
create policy "members_read_access_audit" on adam_access_audit
  for select using (is_program_member(program_id));

drop policy if exists "insert_access_audit" on adam_access_audit;
create policy "insert_access_audit" on adam_access_audit
  for insert with check (is_program_member(program_id));

drop policy if exists "no_update_access_audit" on adam_access_audit;
create policy "no_update_access_audit" on adam_access_audit
  for update using (false);

drop policy if exists "no_delete_access_audit" on adam_access_audit;
create policy "no_delete_access_audit" on adam_access_audit
  for delete using (false);

drop policy if exists "members_read_program_events" on adam_program_events;
create policy "members_read_program_events" on adam_program_events
  for select using (is_program_member(program_id));

drop policy if exists "insert_program_events" on adam_program_events;
create policy "insert_program_events" on adam_program_events
  for insert with check (is_program_member(program_id));

drop policy if exists "no_update_program_events" on adam_program_events;
create policy "no_update_program_events" on adam_program_events
  for update using (false);

drop policy if exists "no_delete_program_events" on adam_program_events;
create policy "no_delete_program_events" on adam_program_events
  for delete using (false);
