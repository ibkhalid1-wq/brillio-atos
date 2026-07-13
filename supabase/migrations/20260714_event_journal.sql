-- Design-review rec 2 — the append-only event journal. DELIVERED, NOT APPLIED
-- (audit contract Rule 6: never touch the shared database autonomously).
-- Apply intentionally:  supabase db push   (rollback at the bottom).
--
-- WHY: programme state lives in one client-writable JSONB blob, so history is
-- whatever the blob currently says plus a capped in-blob attestation list. An
-- append-only, server-timestamped journal gives the record a spine the client
-- cannot rewrite: every mutation lands as an event row; the blob becomes a
-- projection you can always re-derive and audit against. This table is the
-- first increment: clients INSERT and SELECT their own programmes' events —
-- no UPDATE, no DELETE, no exceptions (no policies exist for them).

create table if not exists adam_program_events (
  id bigint generated always as identity primary key,
  program_id uuid not null references adam_programs(id) on delete cascade,
  ts timestamptz not null default now(),          -- server clock, not client
  actor text not null default '',
  kind text not null,                             -- e.g. 'inputs.saved', 'gate.approved', 'decision.resolved'
  detail jsonb not null default '{}'::jsonb
);

create index if not exists adam_program_events_program_ts
  on adam_program_events (program_id, ts desc);

alter table adam_program_events enable row level security;

-- Owner-scoped, append-only: INSERT + SELECT policies only.
create policy adam_program_events_insert on adam_program_events
  for insert with check (
    exists (select 1 from adam_programs p where p.id = program_id and p.owner_id = auth.uid())
  );

create policy adam_program_events_select on adam_program_events
  for select using (
    exists (select 1 from adam_programs p where p.id = program_id and p.owner_id = auth.uid())
  );

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop table if exists adam_program_events;
