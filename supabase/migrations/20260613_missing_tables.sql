-- ============================================================
-- ADAM: Missing tables migration
-- Generated: 2026-06-13
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- ── 1. adam_organisations ────────────────────────────────────
-- Core org record. Branding is a flexible JSON blob.
CREATE TABLE IF NOT EXISTS public.adam_organisations (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text        NOT NULL,
  branding    jsonb       NULL,           -- { primaryColor?, accentColor?, logoUrl? }
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.adam_organisations ENABLE ROW LEVEL SECURITY;

-- Org members can read their org
CREATE POLICY "members_read_own_org" ON public.adam_organisations
  FOR SELECT
  USING (
    id IN (
      SELECT org_id FROM public.adam_org_members
      WHERE user_id = auth.uid()
    )
  );


-- ── 2. adam_org_members ──────────────────────────────────────
-- User ↔ org membership with role.
CREATE TABLE IF NOT EXISTS public.adam_org_members (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id     text        NOT NULL REFERENCES public.adam_organisations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_adam_org_members_user_id ON public.adam_org_members (user_id);
CREATE INDEX IF NOT EXISTS idx_adam_org_members_org_id  ON public.adam_org_members (org_id);

ALTER TABLE public.adam_org_members ENABLE ROW LEVEL SECURITY;

-- Users can only see their own membership row
CREATE POLICY "users_read_own_membership" ON public.adam_org_members
  FOR SELECT
  USING (user_id = auth.uid());


-- ── 3. adam_circuit_breakers ─────────────────────────────────
-- AI service health / circuit-breaker states.
CREATE TABLE IF NOT EXISTS public.adam_circuit_breakers (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  service       text        NOT NULL,
  state         text        NOT NULL DEFAULT 'closed'
                            CHECK (state IN ('open', 'half-open', 'closed')),
  next_retry_at timestamptz NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adam_circuit_breakers_state ON public.adam_circuit_breakers (state);

ALTER TABLE public.adam_circuit_breakers ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (banner check)
CREATE POLICY "auth_read_circuit_breakers" ON public.adam_circuit_breakers
  FOR SELECT
  USING (auth.role() = 'authenticated');


-- ── 4. adam_decision_audit ───────────────────────────────────
-- Immutable log of resolved decisions per programme.
CREATE TABLE IF NOT EXISTS public.adam_decision_audit (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id      text        NOT NULL,
  decision_id     text        NULL,
  decision_title  text        NULL,
  resolution      text        NULL,
  resolved_at     timestamptz NULL,
  resolved_by     text        NULL,
  phase_id        text        NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adam_decision_audit_program_id  ON public.adam_decision_audit (program_id);
CREATE INDEX IF NOT EXISTS idx_adam_decision_audit_resolved_at ON public.adam_decision_audit (resolved_at DESC);

ALTER TABLE public.adam_decision_audit ENABLE ROW LEVEL SECURITY;

-- Programme owner can read audit entries
CREATE POLICY "owner_read_decision_audit" ON public.adam_decision_audit
  FOR SELECT
  USING (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "owner_insert_decision_audit" ON public.adam_decision_audit
  FOR INSERT
  WITH CHECK (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  );


-- ── 5. adam_document_attachments ────────────────────────────
-- Uploaded & parsed documents attached to a programme.
CREATE TABLE IF NOT EXISTS public.adam_document_attachments (
  id                 text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id         text        NOT NULL,
  file_name          text        NOT NULL,
  file_type          text        NOT NULL,
  file_size_bytes    bigint      NULL,
  raw_text           text        NULL,
  phase_context      text        NULL,
  extraction_status  text        NOT NULL DEFAULT 'extracted',
  extracted_data     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  confidence         real        NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  ocr_confidence     real        NULL,
  page_count         integer     NULL,
  sheet_count        integer     NULL,
  slide_count        integer     NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adam_doc_attachments_program_id  ON public.adam_document_attachments (program_id);
CREATE INDEX IF NOT EXISTS idx_adam_doc_attachments_created_at  ON public.adam_document_attachments (created_at DESC);

ALTER TABLE public.adam_document_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_document_attachments" ON public.adam_document_attachments
  FOR ALL
  USING (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  );


-- ── 6. adam_phase_agent_states ───────────────────────────────
-- Per-phase agent task state (upserted, composite PK).
CREATE TABLE IF NOT EXISTS public.adam_phase_agent_states (
  program_id  text        NOT NULL,
  phase_id    text        NOT NULL,
  state       jsonb       NULL,           -- { tasks?: PhaseAgentTask[] }
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, phase_id)
);

CREATE INDEX IF NOT EXISTS idx_adam_phase_agent_states_prog ON public.adam_phase_agent_states (program_id);

ALTER TABLE public.adam_phase_agent_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_phase_agent_states" ON public.adam_phase_agent_states
  FOR ALL
  USING (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  );


-- ── 7. adam_program_events ───────────────────────────────────
-- Immutable event log (audit trail) for a programme.
CREATE TABLE IF NOT EXISTS public.adam_program_events (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id    text        NOT NULL,
  event_type    text        NOT NULL,
  phase_id      text        NULL,
  actor_id      uuid        NULL,
  actor_name    text        NOT NULL DEFAULT 'System',
  agent_id      text        NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  prev_snapshot jsonb       NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adam_program_events_program_id ON public.adam_program_events (program_id);
CREATE INDEX IF NOT EXISTS idx_adam_program_events_created_at ON public.adam_program_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_adam_program_events_type       ON public.adam_program_events (event_type);

ALTER TABLE public.adam_program_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_program_events" ON public.adam_program_events
  FOR SELECT
  USING (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "owner_insert_program_events" ON public.adam_program_events
  FOR INSERT
  WITH CHECK (
    program_id IN (
      SELECT id FROM public.adam_programs WHERE owner_id = auth.uid()
    )
  );
