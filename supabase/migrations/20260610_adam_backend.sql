create table if not exists adam_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled Program',
  client text,
  industry text,
  owner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false
);

create index if not exists adam_programs_owner_idx on adam_programs(owner_id, is_deleted, updated_at desc);

create table if not exists adam_portfolio (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade unique,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists adam_audit_log (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references adam_programs(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  phase_id text,
  artifact_id text,
  summary text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table adam_programs enable row level security;
alter table adam_portfolio enable row level security;
alter table adam_audit_log enable row level security;

create policy "Users manage own programs"
  on adam_programs for all
  using (owner_id = auth.uid());

create policy "Users manage own portfolio"
  on adam_portfolio for all
  using (owner_id = auth.uid());

create policy "Users read own audit log"
  on adam_audit_log for select
  using (user_id = auth.uid());

create policy "System inserts audit log"
  on adam_audit_log for insert
  with check (user_id = auth.uid());
