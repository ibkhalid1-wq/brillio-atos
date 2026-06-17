-- Backup & recovery: move program snapshots out of the hot data blob.
--
-- Previously every restore point lived inside adam_programs.data.programSnapshots.
-- Each snapshot embeds a full copy of the programme, so the history bloated the
-- one JSONB blob the app reads on every load and rewrites on every mutation —
-- enough to trip Postgres's statement_timeout and crash the app before mount.
--
-- Snapshots now live in their own table: the main data blob never carries them,
-- listing restore points is a lightweight metadata query (no payload), and the
-- retention budget no longer has to fight the program's own size.

-- ---------------------------------------------------------------------------
-- 1. Snapshot table
-- ---------------------------------------------------------------------------
create table if not exists adam_program_snapshots (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references adam_programs(id) on delete cascade,
  label text not null default 'Untitled save',
  kind text not null default 'manual' check (kind in ('manual', 'lock', 'auto')),
  data jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists adam_program_snapshots_program_idx
  on adam_program_snapshots(program_id, created_at desc);

alter table adam_program_snapshots enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS — reuse the membership helpers from program_access_control.
--    Members can read restore points; writers (admin/editor) can create and
--    prune them. program_id is text, matching the text-keyed helper overloads.
-- ---------------------------------------------------------------------------
drop policy if exists "members read snapshots" on adam_program_snapshots;
create policy "members read snapshots"
  on adam_program_snapshots for select
  using (adam_can_read_program(program_id));

drop policy if exists "writers insert snapshots" on adam_program_snapshots;
create policy "writers insert snapshots"
  on adam_program_snapshots for insert
  with check (adam_can_write_program(program_id));

drop policy if exists "writers delete snapshots" on adam_program_snapshots;
create policy "writers delete snapshots"
  on adam_program_snapshots for delete
  using (adam_can_write_program(program_id));

-- ---------------------------------------------------------------------------
-- 3. Migrate existing in-blob snapshots into rows, then strip the key so the
--    data blob shrinks back to just the live programme. Each legacy element is
--    { id, label, kind, createdAt, data } — the inner data is the restore point.
-- ---------------------------------------------------------------------------
insert into adam_program_snapshots (program_id, label, kind, data, created_by, created_at)
select
  p.id,
  coalesce(nullif(elem->>'label', ''), 'Untitled save'),
  case when elem->>'kind' in ('manual', 'lock', 'auto') then elem->>'kind' else 'manual' end,
  elem->'data',
  p.owner_id,
  coalesce((elem->>'createdAt')::timestamptz, now())
from adam_programs p,
     lateral jsonb_array_elements(
       case when jsonb_typeof(p.data->'programSnapshots') = 'array'
            then p.data->'programSnapshots'
            else '[]'::jsonb end
     ) as elem
where jsonb_typeof(elem->'data') = 'object';

update adam_programs
set data = data - 'programSnapshots'
where data ? 'programSnapshots';
