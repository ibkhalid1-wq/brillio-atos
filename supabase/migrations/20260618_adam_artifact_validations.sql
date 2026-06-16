-- Cross-artifact validation history.
--
-- The `cross-artifact-validator` agent (run at gate review) currently persists
-- only its LATEST result into program data
-- (inner.crossArtifactValidation = { findings, validatedPhaseId, validatedAt,
-- clean }). Each new run overwrites the previous one, so there is no record of
-- how traceability findings evolved across gates.
--
-- This table retains every validation run as durable history: one row per
-- finding, grouped by run_id, plus a marker row for clean runs so we can tell
-- "validated and clean" apart from "never validated". Writes are service-role
-- only (the edge function); members get read access via the program access
-- helpers introduced in 20260616_program_access_control.sql.

create table if not exists adam_artifact_validations (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  -- Groups all findings produced by a single validation run.
  run_id uuid not null default gen_random_uuid(),
  agent_id text not null default 'cross-artifact-validator',
  phase_id text not null,
  -- True for a run that produced no findings (finding columns are null then).
  clean boolean not null default false,
  -- Stable finding identity carried over from the model/deterministic output.
  finding_id text,
  severity text check (severity in ('critical', 'high', 'medium', 'low')),
  domain text,
  source_artifact text,
  target_artifact text,
  source_item text,
  issue text,
  recommendation text,
  confidence numeric,
  -- 'model' (Layer 2) or 'deterministic' (Layer 1).
  source text not null default 'model' check (source in ('model', 'deterministic')),
  validated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists adam_artifact_validations_program_idx
  on adam_artifact_validations(program_id);
create index if not exists adam_artifact_validations_program_phase_idx
  on adam_artifact_validations(program_id, phase_id);
create index if not exists adam_artifact_validations_run_idx
  on adam_artifact_validations(run_id);

alter table adam_artifact_validations enable row level security;

-- Members can read history; writes stay service-role (the edge function), so no
-- insert/update/delete policy is granted to authenticated clients.
drop policy if exists "members read artifact validations" on adam_artifact_validations;
create policy "members read artifact validations"
  on adam_artifact_validations for select
  using (adam_can_read_program(program_id));

alter publication supabase_realtime add table adam_artifact_validations;
