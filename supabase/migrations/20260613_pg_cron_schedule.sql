-- ============================================================
-- ADAM: pg_cron trigger for schedule-agent
-- Generated: 2026-06-13
--
-- This migration sets up a pg_cron job that calls the
-- schedule-agent Edge Function every 5 minutes so that
-- user-configured agent schedules are actually executed.
--
-- Prerequisites:
--   1. pg_cron extension must be enabled on the project
--      (Supabase dashboard → Database → Extensions → pg_cron)
--   2. pg_net extension must be enabled
--      (Supabase dashboard → Database → Extensions → pg_net)
--   3. SUPABASE_SERVICE_ROLE_KEY must be set as a vault secret
--      or substituted below.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- Enable required extensions (no-ops if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing job with this name to allow re-runs
SELECT cron.unschedule('adam-schedule-runner') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'adam-schedule-runner'
);

-- Schedule: every 5 minutes, call the schedule-agent edge function
-- Replace <PROJECT_REF> with your Supabase project reference (e.g. xyzabcdefgh)
-- Replace <SERVICE_ROLE_KEY> with your service role key (or use vault.decrypt_secret)
SELECT cron.schedule(
  'adam-schedule-runner',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     => 'https://<PROJECT_REF>.supabase.co/functions/v1/schedule-agent',
    headers => jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
               ),
    body    => '{}'::jsonb
  );
  $$
);

-- Verify the job was created
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'adam-schedule-runner';

-- ── Also fix: initialise next_run_at for any schedules missing it ─────────────
-- SchedulePanel inserts rows without computing next_run_at up-front.
-- This backfill sets next_run_at = now() for those rows so the executor
-- picks them up on the very first tick.
UPDATE public.adam_agent_schedules
SET    next_run_at = NOW()
WHERE  enabled = true
AND    next_run_at IS NULL;
