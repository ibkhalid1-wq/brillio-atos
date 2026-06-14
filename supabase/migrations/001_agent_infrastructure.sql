create extension if not exists pgcrypto;

create table if not exists adam_agent_runs (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  phase_id text not null,
  status text not null default 'queued'
    check (status in ('queued','running','paused','complete','failed','cancelled')),
  trigger_event text,
  input_context jsonb,
  output jsonb,
  handoff jsonb,
  reasoning_trace text[],
  confidence numeric(4,3),
  tokens_used integer,
  error_message text,
  awaiting_decision_id uuid,
  scheduled_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  owner_id uuid references auth.users(id)
);

create table if not exists adam_copilot_threads (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  workspace_id text not null,
  messages jsonb not null default '[]'::jsonb,
  summary text,
  open_questions text[],
  last_activity_at timestamptz default now(),
  created_at timestamptz default now(),
  owner_id uuid references auth.users(id),
  unique(program_id, workspace_id, owner_id)
);

create table if not exists adam_agent_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references adam_agent_runs(id) on delete cascade,
  program_id uuid not null,
  agent_id text not null,
  phase_id text not null,
  observation_type text not null
    check (observation_type in (
      'context_built','memory_retrieved','prompt_sent','response_received',
      'artifact_drafted','decision_queued','handoff_created',
      'trigger_fired','error','pause_requested','resume'
    )),
  payload jsonb,
  tokens integer,
  latency_ms integer,
  created_at timestamptz default now()
);

create table if not exists adam_agent_schedules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  phase_id text not null,
  cron_expression text not null,
  label text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  run_count integer default 0,
  owner_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists adam_agent_runs_program_status_idx on adam_agent_runs(program_id, status);
create index if not exists adam_agent_runs_program_phase_created_idx on adam_agent_runs(program_id, phase_id, created_at desc);
create index if not exists adam_agent_observations_run_created_idx on adam_agent_observations(run_id, created_at);
create index if not exists adam_agent_schedules_program_enabled_idx on adam_agent_schedules(program_id, enabled);

alter table adam_agent_runs enable row level security;
alter table adam_copilot_threads enable row level security;
alter table adam_agent_observations enable row level security;
alter table adam_agent_schedules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'adam_agent_runs' and policyname = 'Users manage own agent runs'
  ) then
    create policy "Users manage own agent runs"
      on adam_agent_runs for all
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'adam_copilot_threads' and policyname = 'Users manage own copilot threads'
  ) then
    create policy "Users manage own copilot threads"
      on adam_copilot_threads for all
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'adam_agent_observations' and policyname = 'Users read own agent observations'
  ) then
    create policy "Users read own agent observations"
      on adam_agent_observations for select
      using (
        exists (
          select 1
          from adam_agent_runs runs
          where runs.id = adam_agent_observations.run_id
            and runs.owner_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'adam_agent_observations' and policyname = 'Users insert own agent observations'
  ) then
    create policy "Users insert own agent observations"
      on adam_agent_observations for insert
      with check (
        exists (
          select 1
          from adam_agent_runs runs
          where runs.id = adam_agent_observations.run_id
            and runs.owner_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'adam_agent_schedules' and policyname = 'Users manage own agent schedules'
  ) then
    create policy "Users manage own agent schedules"
      on adam_agent_schedules for all
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'adam_agent_runs'
  ) then
    alter publication supabase_realtime add table adam_agent_runs;
  end if;
exception
  when undefined_object then
    null;
end $$;

-- Optional pg_cron setup after setting:
--   alter database postgres set app.supabase_url = 'https://your-project-ref.supabase.co';
--   alter database postgres set app.service_key = 'your-service-role-key';
--
-- select cron.schedule(
--   'adam-agent-scheduler',
--   '*/15 * * * *',
--   $$
--     select net.http_post(
--       url := current_setting('app.supabase_url') || '/functions/v1/schedule-agent',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_key'),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     );
--   $$
-- );
