create table if not exists adam_pattern_library (
  id uuid primary key default gen_random_uuid(),
  pattern_type text not null check (pattern_type in ('risk','intervention','milestone-sequence','adoption-tactic','gate-criteria')),
  phase_id text,
  industry text,
  program_size text check (program_size in ('small','medium','large','enterprise')),
  pattern_title text not null,
  pattern_body jsonb not null,
  outcome text check (outcome in ('successful','failed','neutral')),
  confidence float default 0.5,
  source_program_id uuid references adam_programs(id) on delete set null,
  created_at timestamptz default now(),
  used_count int default 0
);

alter table adam_pattern_library enable row level security;

drop policy if exists "authenticated read" on adam_pattern_library;
create policy "authenticated read" on adam_pattern_library
  for select to authenticated using (true);

drop policy if exists "service insert" on adam_pattern_library;
create policy "service insert" on adam_pattern_library
  for insert to service_role with check (true);
