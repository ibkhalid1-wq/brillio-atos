# ADAM — Codex Session Prompt (Edge Function Deploy)
Generated: 2026-06-13

---

## What this project is

**ADAM** (Agentic Delivery Acceleration Machine) — a React 18 + TypeScript + Vite SPA backed by Supabase (Postgres + Auth + Edge Functions). It manages transformation programmes with AI agents that run analysis, generate narratives, track risks, and operate autonomously on a schedule.

- **Project root:** `/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex`
- **Node path:** `/Users/Ibrahim.Khalid/tools/node/bin/`
- **Build command:** `PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm run build`
- **Supabase Edge Functions:** Deno runtime, located in `supabase/functions/`

---

## What was completed in the previous session

### Database (Supabase SQL Editor — DONE)
All 19 tables created successfully in one migration. Key tables:
- `adam_programs` — core programme record (`id text PK`, `name`, `client`, `industry`, `owner_id uuid`, `data jsonb`, `is_deleted bool`)
- `adam_agent_runs` — every agent execution log
- `adam_autonomy_settings` — per-agent autonomy thresholds (`trust_threshold`, `max_autonomous_actions_per_day`, `enabled`)
- `adam_autonomy_log` — audit trail of every autonomous decision
- `adam_agent_schedules` — user-configured recurring agent schedules (`cron_expression`, `next_run_at`, `enabled`)
- `adam_pattern_library` — extracted delivery patterns
- `adam_agent_observations` — prompt/response telemetry
- Plus 12 others — all with RLS enabled and owner-scoped policies

### pg_cron (Supabase SQL Editor — DONE)
- `adam-schedule-runner` cron job created: fires every 5 minutes
- Calls `schedule-agent` edge function via `net.http_post`
- Backfill: all `adam_agent_schedules` rows with null `next_run_at` set to `NOW()`

### Edge function code changes (local — NOT YET DEPLOYED)
File: `supabase/functions/run-agent/index.ts` (5240+ lines, Deno)

Four changes were made:

**1. `daily-briefing` added to `VALID_AGENT_IDS`** (~line 78)
```typescript
"vendor-risk-assessor",
"daily-briefing",   // ← added
```

**2. Agent run history injected into prompts** (~line 4510)
```typescript
prompt.system += extractAgentServerMemory(contextProgramData, request.agentId);
if (memoryContext) {
  prompt.system += `\n\n## Recent run history for this agent on this programme\n${memoryContext}`;
}
```

**3. Daily autonomy limit enforced in `autonomyGate()`** (~line 2383)
- Queries `adam_autonomy_log` for today's `acted_autonomously = true` count
- Reads `max_autonomous_actions_per_day` from `adam_autonomy_settings` (default 10)
- Blocks autonomous write-back if limit reached, returns reason string

**4. `daily-briefing` system prompt + apply function**
- `buildAgentPrompt()` — returns JSON schema: `{ headline, focusItems[], blockers[], decisionsNeeded[], progressHighlight, ragStatus, generatedAt, confidence }`
- `applyDailyBriefingResultToProgramData()` — persists to `programData.inner.dailyBriefing`
- Wired into agent dispatch chain alongside `weekly-digest`

### SchedulePanel.tsx changes (local — built, not deployed to hosting)
File: `src/v3/components/SchedulePanel.tsx`
- `daily-briefing` added to `SCHEDULABLE_AGENTS` list
- `computeNextRunAt(cronExpression)` function added — computes next UTC datetime matching cron
- `saveSchedule()` now sets `next_run_at` at insert time so new schedules are picked up immediately

---

## What needs to happen next (Step 4)

### Deploy the edge function

```bash
cd "/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex"
supabase login          # if not already logged in
supabase link --project-ref <PROJECT_REF>
supabase functions deploy run-agent
```

Replace `<PROJECT_REF>` with the Supabase project reference ID (Settings → General → Reference ID).

### After deploy — verify in Supabase Dashboard

```sql
-- Check cron job is firing
SELECT * FROM cron.job_run_details
WHERE jobname = 'adam-schedule-runner'
ORDER BY start_time DESC
LIMIT 5;

-- Check schedule-agent is picking up schedules
SELECT agent_id, last_run_at, next_run_at, run_count
FROM adam_agent_schedules
ORDER BY last_run_at DESC NULLS LAST;
```

---

## Edge function architecture (summary)

```
supabase/functions/
  run-agent/index.ts         ← main AI agent executor (5240 lines)
  schedule-agent/index.ts    ← cron executor (queries adam_agent_schedules, calls run-agent)
  _shared/
    claudeClient.ts          ← streamClaudeText() wrapper
    logger.ts
    types.ts                 ← RunAgentRequest, RunAgentResponse, AgentHandoff etc.
```

### Key flow in `run-agent`:
1. Validate `agent_id` against `VALID_AGENT_IDS` (now includes `daily-briefing`)
2. Fetch programme data from `adam_programs`
3. `getServerMemoryContext()` — last 5 runs from `adam_agent_runs` → injected into `prompt.system`
4. `buildAgentPrompt()` — returns `{ system, user }` per agent type
5. `extractAgentServerMemory()` — agent memory blob from `programData.agentServerMemory` → appended to `prompt.system`
6. Call Claude via `streamClaudeText()`
7. `autonomyGate()` — checks trust threshold + daily limit → `actAutonomously` bool
8. If autonomous: `applyXxxResultToProgramData()` → `persistProgramData()` → write to `adam_programs.data`
9. Log to `adam_agent_runs`, `adam_autonomy_log`, `adam_agent_observations`
10. Trigger downstream agents via `AGENT_DOWNSTREAM` map

### `autonomyGate()` logic (updated):
```
if agentId in ALWAYS_HUMAN → block
if no settings row → default queued (not autonomous)
if todayCount >= max_autonomous_actions_per_day → block (daily limit)
if enabled && confidence >= trust_threshold → autonomous
else → queue for human review
```

---

## App navigation structure (for context)

```
CommandRail (left sidebar)
  Home        → InsightFeedView  (phase strip + daily brief + AI feed)
  Governance  → ProgramHealthView
  Brief       → ExecutiveView    (renamed from "Executive")
  Portfolio   → PortfolioView    (has delete programme with inline confirm)

Programme sub-views (opened from Home or nav):
  narrative / plan / milestones / risks / budget / critical-path /
  change-impact / stakeholders / adoption / health / retro / scope-pcr /
  intelligence / twin / accelerators / schedules / benchmark / decision-audit / documents
```

---

## Supabase client pattern

```typescript
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

if (!supabase || !isSupabaseConfigured) return;
const { data, error } = await supabase.from("adam_programs").select("*");
```

Types live in `src/integrations/supabase/types.ts` — do not hand-edit.

---

## Known gaps / future work

- `schedule-agent` edge function also needs deploying if not already: `supabase functions deploy schedule-agent`
- No email/push notification when daily-briefing is ready — could add to `adam_program_events`
- `InsightFeedView` has a stub that reads `program.dailyBriefing` — once `daily-briefing` agent runs it will auto-populate
- `adam_agent_schedules` `label` column is NOT NULL but `SchedulePanel` inserts without it — may need a default or fix the insert to include a generated label
