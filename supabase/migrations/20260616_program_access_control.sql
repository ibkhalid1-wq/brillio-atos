-- Multi-user access control for programs.
--
-- Introduces a membership model so more than one user can collaborate on a
-- program with a role of admin / editor / viewer:
--   * admin  — full control, including managing other members' roles
--   * editor — can read and write program data (and run agents)
--   * viewer — read-only
--
-- The program creator (owner_id) is always treated as an admin. RLS across all
-- program-scoped tables is rewritten to grant access based on membership rather
-- than sole ownership.

-- ---------------------------------------------------------------------------
-- 1. Membership table
-- ---------------------------------------------------------------------------
create table if not exists adam_program_members (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references adam_programs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, user_id)
);

create index if not exists adam_program_members_program_idx on adam_program_members(program_id);
create index if not exists adam_program_members_user_idx on adam_program_members(user_id);

alter table adam_program_members enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Role-resolution helpers (SECURITY DEFINER to avoid RLS recursion)
--
-- These bypass RLS on adam_program_members / adam_programs so they can be used
-- inside the policies of those very tables without infinite recursion. The
-- program owner always resolves to 'admin' even if a membership row is missing.
--
-- adam_programs.id and every program-scoped table's program_id column are text,
-- so all helpers are keyed on text. There are no uuid overloads.
-- ---------------------------------------------------------------------------
create or replace function adam_program_role(p_program text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role
      from adam_program_members
      where program_id = p_program
        and user_id = auth.uid()
      limit 1
    ),
    (
      select 'admin'
      from adam_programs
      where id = p_program
        and owner_id = auth.uid()
      limit 1
    )
  );
$$;

create or replace function adam_can_read_program(p_program text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select adam_program_role(p_program) is not null;
$$;

create or replace function adam_can_write_program(p_program text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select adam_program_role(p_program) in ('admin', 'editor');
$$;

create or replace function adam_is_program_admin(p_program text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select adam_program_role(p_program) = 'admin';
$$;

-- ---------------------------------------------------------------------------
-- 3. Auto-add the program owner as an admin member on creation
-- ---------------------------------------------------------------------------
create or replace function adam_add_owner_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into adam_program_members (program_id, user_id, role, invited_by)
    values (new.id, new.owner_id, 'admin', new.owner_id)
    on conflict (program_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists adam_programs_owner_admin on adam_programs;
create trigger adam_programs_owner_admin
  after insert on adam_programs
  for each row
  execute function adam_add_owner_as_admin();

-- ---------------------------------------------------------------------------
-- 4. Backfill existing owners as admins
-- ---------------------------------------------------------------------------
insert into adam_program_members (program_id, user_id, role, invited_by)
select id, owner_id, 'admin', owner_id
from adam_programs
where owner_id is not null
on conflict (program_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. RLS: adam_program_members
--    Members can see the roster; only admins can change it.
-- ---------------------------------------------------------------------------
drop policy if exists "members read membership" on adam_program_members;
create policy "members read membership"
  on adam_program_members for select
  using (adam_can_read_program(program_id));

drop policy if exists "admins insert membership" on adam_program_members;
create policy "admins insert membership"
  on adam_program_members for insert
  with check (adam_is_program_admin(program_id));

drop policy if exists "admins update membership" on adam_program_members;
create policy "admins update membership"
  on adam_program_members for update
  using (adam_is_program_admin(program_id))
  with check (adam_is_program_admin(program_id));

drop policy if exists "admins delete membership" on adam_program_members;
create policy "admins delete membership"
  on adam_program_members for delete
  using (adam_is_program_admin(program_id));

-- ---------------------------------------------------------------------------
-- 6. RLS: adam_programs (membership-based)
-- ---------------------------------------------------------------------------
drop policy if exists "Users manage own programs" on adam_programs;

drop policy if exists "members read programs" on adam_programs;
create policy "members read programs"
  on adam_programs for select
  using (adam_can_read_program(id));

drop policy if exists "owner insert programs" on adam_programs;
create policy "owner insert programs"
  on adam_programs for insert
  with check (owner_id = auth.uid());

drop policy if exists "writers update programs" on adam_programs;
create policy "writers update programs"
  on adam_programs for update
  using (adam_can_write_program(id))
  with check (adam_can_write_program(id));

drop policy if exists "admins delete programs" on adam_programs;
create policy "admins delete programs"
  on adam_programs for delete
  using (adam_is_program_admin(id));

-- ---------------------------------------------------------------------------
-- 7. RLS: program-scoped uuid tables
-- ---------------------------------------------------------------------------
-- adam_agent_runs
drop policy if exists "Users manage own agent runs" on adam_agent_runs;
drop policy if exists "members read agent runs" on adam_agent_runs;
create policy "members read agent runs"
  on adam_agent_runs for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers manage agent runs" on adam_agent_runs;
create policy "writers manage agent runs"
  on adam_agent_runs for all
  using (adam_can_write_program(program_id))
  with check (adam_can_write_program(program_id));

-- adam_agent_observations
drop policy if exists "Users read own agent observations" on adam_agent_observations;
drop policy if exists "Users insert own agent observations" on adam_agent_observations;
drop policy if exists "members read observations" on adam_agent_observations;
create policy "members read observations"
  on adam_agent_observations for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers insert observations" on adam_agent_observations;
create policy "writers insert observations"
  on adam_agent_observations for insert
  with check (adam_can_write_program(program_id));

-- adam_agent_schedules
drop policy if exists "Users manage own agent schedules" on adam_agent_schedules;
drop policy if exists "members read schedules" on adam_agent_schedules;
create policy "members read schedules"
  on adam_agent_schedules for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers manage schedules" on adam_agent_schedules;
create policy "writers manage schedules"
  on adam_agent_schedules for all
  using (adam_can_write_program(program_id))
  with check (adam_can_write_program(program_id));

-- adam_copilot_threads
drop policy if exists "Users manage own copilot threads" on adam_copilot_threads;
drop policy if exists "members read copilot" on adam_copilot_threads;
create policy "members read copilot"
  on adam_copilot_threads for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers manage copilot" on adam_copilot_threads;
create policy "writers manage copilot"
  on adam_copilot_threads for all
  using (adam_can_write_program(program_id))
  with check (adam_can_write_program(program_id));

-- adam_agent_events (read-only to clients; written by service role)
drop policy if exists "authenticated read" on adam_agent_events;
drop policy if exists "members read events" on adam_agent_events;
create policy "members read events"
  on adam_agent_events for select
  using (adam_can_read_program(program_id));

-- adam_program_artifacts (read membership; writes stay service-role)
drop policy if exists "authenticated read" on adam_program_artifacts;
drop policy if exists "members read artifacts" on adam_program_artifacts;
create policy "members read artifacts"
  on adam_program_artifacts for select
  using (adam_can_read_program(program_id));

-- adam_document_attachments (program_id is uuid; previously open to any program)
drop policy if exists "program_members_all_document_attachments" on adam_document_attachments;
drop policy if exists "Users can manage their own program documents" on adam_document_attachments;
drop policy if exists "owner_all_document_attachments" on adam_document_attachments;
drop policy if exists "members read documents" on adam_document_attachments;
create policy "members read documents"
  on adam_document_attachments for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers manage documents" on adam_document_attachments;
create policy "writers manage documents"
  on adam_document_attachments for all
  using (adam_can_write_program(program_id))
  with check (adam_can_write_program(program_id));

-- ---------------------------------------------------------------------------
-- 8. RLS: program-scoped text-keyed tables (use text overloads)
-- ---------------------------------------------------------------------------
-- adam_decision_audit
drop policy if exists "owner_read_decision_audit" on adam_decision_audit;
drop policy if exists "owner_insert_decision_audit" on adam_decision_audit;
drop policy if exists "members read decision audit" on adam_decision_audit;
create policy "members read decision audit"
  on adam_decision_audit for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers insert decision audit" on adam_decision_audit;
create policy "writers insert decision audit"
  on adam_decision_audit for insert
  with check (adam_can_write_program(program_id));

-- adam_phase_agent_states
drop policy if exists "owner_all_phase_agent_states" on adam_phase_agent_states;
drop policy if exists "members read phase agent states" on adam_phase_agent_states;
create policy "members read phase agent states"
  on adam_phase_agent_states for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers manage phase agent states" on adam_phase_agent_states;
create policy "writers manage phase agent states"
  on adam_phase_agent_states for all
  using (adam_can_write_program(program_id))
  with check (adam_can_write_program(program_id));

-- adam_program_events
drop policy if exists "owner_read_program_events" on adam_program_events;
drop policy if exists "owner_insert_program_events" on adam_program_events;
drop policy if exists "members read program events" on adam_program_events;
create policy "members read program events"
  on adam_program_events for select
  using (adam_can_read_program(program_id));
drop policy if exists "writers insert program events" on adam_program_events;
create policy "writers insert program events"
  on adam_program_events for insert
  with check (adam_can_write_program(program_id));
