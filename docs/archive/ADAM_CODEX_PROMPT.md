# ADAM — Codex Session Prompt
Generated: 2026-06-13

---

## Project

**ADAM** — Agentic Delivery Acceleration Machine. React 18 + TypeScript + Vite SPA backed by Supabase (Postgres + Auth + Realtime + Edge Functions). Manages transformation programmes with 50+ AI agents that analyse, generate narratives, track risks, and run autonomously on schedules.

- **Project root:** `/Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/brillio-atlas-codex`
- **Node:** `/Users/Ibrahim.Khalid/tools/node/bin/`
- **Build:** `PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npm run build`
- **Supabase project ref:** `vudqrrqpipnkxzxslbim`
- **Edge functions:** Deno runtime, `supabase/functions/`
- **Deploy functions:** `PATH="/Users/Ibrahim.Khalid/tools/node/bin:$PATH" npx supabase functions deploy --project-ref vudqrrqpipnkxzxslbim`

---

## What is fully working

- ✅ All 19 Supabase tables created and migrated
- ✅ pg_cron job `adam-schedule-runner` fires every 5 minutes → calls `schedule-agent` edge function
- ✅ Edge functions deployed (`run-agent`, `schedule-agent`, others)
- ✅ AI provider: **OpenAI** (`OPENAI_API_KEY` + `ADAM_AI_PROVIDER=openai` set as Supabase secrets)
- ✅ Left rail reorganised: Search → Navigate → Status → Alerts → Settings
- ✅ Radar spinner (green) for agent activity — only shows on programme-context surfaces
- ✅ `daily-briefing` agent added to VALID_AGENT_IDS with prompt + apply function
- ✅ Agent memory injected into prompts from `adam_agent_runs` history
- ✅ Daily autonomy limit enforced in `autonomyGate()`
- ✅ Schedules Panel: `next_run_at` computed client-side at insert time
- ✅ Autonomy toggle: RLS fixed, no longer crashes app
- ✅ AI Settings moved into Settings section of rail, ADAM Advisor removed

---

## Active bug — "Cannot coerce the result to a single JSON object"

### Symptom
Every agent run fails with this toast: `Agent failed: Cannot coerce the result to a single JSON object`

### What we know
- The edge function IS deployed and IS receiving requests (confirmed in Supabase dashboard)
- AI provider is OpenAI with valid API key
- The error originates client-side when `supabase.functions.invoke("run-agent")` gets back a response the JS client can't parse as JSON
- This means the edge function is either crashing before returning, or returning non-JSON

### What has been tried
1. Added `response_format: { type: "json_object" }` to OpenAI non-streaming calls
2. Moved `response_format` to non-streaming only (streaming doesn't support it in all versions)
3. Bumped `maxTokens` from 1400 → 4096 everywhere (truncated JSON was one theory)
4. `schedule-agent` and `run-agent` both redeployed after changes

### Next step needed
Check **Supabase Dashboard → Edge Functions → run-agent → Logs** and find the actual crash line. The log will show which specific line in `run-agent/index.ts` is failing and why.

Common causes to investigate:
- `adam_programs` `.single()` at line ~4326 returning 0 rows (program not found / owner_id null)
- `adam_program_artifacts` insert failing (table has RLS that references `adam_programs.owner_id`)
- `getProviderSettings()` in `_shared/claudeClient.ts` — if env vars not found, it queries `adam_ai_provider_settings` table which DOES NOT EXIST → this would cause a 404 from PostgREST, and if the JSON parse of that response fails, it throws
- A Deno import/syntax error crashing the function on cold start

### Current confirmed root cause / status
The `adam_ai_provider_settings` table exists in the real linked project and contains an active OpenAI row:
`provider=openai`, `model=gpt-4o`, `is_active=true`.

The prompt's earlier project ref `vduqrtqpiprkxzxsibim` was a typo. The actual project ref is `vudqrrqpipnkxzxslbim`.

The exact `Cannot coerce the result to a single JSON object` string matches a PostgREST `.single()` lookup failure. `run-agent` was hardened by changing the programme lookup at line ~4326 and document lookup at line ~4391 from `.single()` to `.maybeSingle()` with explicit JSON errors, then redeployed.

Verify env vars if needed:
```bash
npx supabase secrets list --project-ref vudqrrqpipnkxzxslbim
```
Current deployed functions do not list `OPENAI_API_KEY` / `ADAM_AI_PROVIDER`; runtime currently uses the `adam_ai_provider_settings` DB fallback row instead.

---

## Architecture

### Navigation (AppShellV3.tsx)
```
commitNavigation({ surface, moreView, activePhaseId, reportId })
  surface: "insight-feed" | "pipeline" | "stage" | "program" | "portfolio" |
           "executive" | "programme-health" | "decide" | ...
  moreView: V3MoreView (19 values) — rendered by ProgramDetailRouter
```

### Left Rail (CommandRail.tsx)
```
[Brand]
────────
Search (⌘K)
────────
NAVIGATE
  Home / Governance / Brief / Portfolio
────────
[Radar spinner + phase label]   ← only on programme surfaces
[Alerts badge]                  ← only when notifications
────────
SETTINGS
  AI Settings → opens Intelligence/Autonomy tab
  Light/Dark mode
  Pin rail
────────
[Account]
```

### Agent execution flow
```
Client → supabase.functions.invoke("run-agent", { body: RunAgentRequest })
  → run-agent/index.ts
    1. Authenticate request (JWT or service role)
    2. Validate agentId in VALID_AGENT_IDS (52 agents + "daily-briefing")
    3. Fetch program from adam_programs
    4. getServerMemoryContext() → adam_agent_runs history → injected into prompt
    5. buildAgentPrompt() → { system, user } per agent type
    6. extractAgentServerMemory() → programData.agentServerMemory blob
    7. streamClaudeText() → OpenAI gpt-4o (or Anthropic / Gemini)
    8. parseAgentPayload() → extract JSON from raw response
    9. autonomyGate() → check trust_threshold + daily limit
    10. applyXxxResultToProgramData() → update program data blob
    11. persistProgramData() → adam_programs.data
    12. Log to adam_agent_runs, adam_autonomy_log, adam_agent_observations
    13. Trigger downstream agents via AGENT_DOWNSTREAM map
```

### AI provider selection (claudeClient.ts)
```typescript
// Priority order:
1. ADAM_AI_PROVIDER env var + matching key env var
2. OPENAI_API_KEY env var → openai
3. ANTHROPIC_API_KEY env var → anthropic
4. GOOGLE_GEMINI_API_KEY env var → google
5. DB fallback: adam_ai_provider_settings table (MAY NOT EXIST)
```

### Key files
```
src/v3/
  AppShellV3.tsx              ← root shell, all navigation + agent triggers
  components/
    CommandRail.tsx            ← left sidebar nav
    ProgramDetailRouter.tsx    ← renders the 19 programme sub-views
    SchedulePanel.tsx          ← agent schedule UI
  surfaces/
    InsightFeedView.tsx        ← Home screen (phase strip + daily brief)
    PortfolioView.tsx          ← programme list + delete
    MoreView.tsx               ← "More" sub-nav (all 19 views grouped)
  v3.css                      ← all styles, CSS custom props

src/new/
  lib/
    useAutonomy.ts             ← autonomy settings toggle (RLS fixed, no throws)
    useAgentTriggers.ts        ← trigger functions for each agent
    programData.ts             ← normalizeProgram(), derivePhases(), buildProgramSeed()
  pages/
    IntelligenceView.tsx       ← AI settings + autonomy + pattern library

supabase/functions/
  run-agent/index.ts           ← 5240+ lines, main AI executor
  schedule-agent/index.ts      ← cron executor
  _shared/
    claudeClient.ts            ← multi-provider AI client (OpenAI/Anthropic/Gemini)
    types.ts                   ← RunAgentRequest, RunAgentResponse, etc.
```

### Database tables (all created)
```
adam_programs              ← core programme record (owner_id uuid → auth.users)
adam_portfolio             ← portfolio view state
adam_audit_log             ← action audit trail
adam_agent_runs            ← every agent execution
adam_agent_observations    ← prompt/response telemetry
adam_copilot_threads       ← AI copilot conversations
adam_agent_events          ← agent lifecycle events
adam_program_artifacts     ← versioned agent outputs
adam_pattern_library       ← extracted delivery patterns
adam_autonomy_settings     ← per-agent autonomy config (trust_threshold, enabled)
adam_autonomy_log          ← autonomous action audit
adam_agent_schedules       ← recurring agent schedules
adam_organisations         ← org records
adam_org_members           ← user ↔ org membership
adam_circuit_breakers      ← AI service health states
adam_decision_audit        ← resolved decision trail
adam_document_attachments  ← uploaded + parsed documents
adam_phase_agent_states    ← per-phase agent task state (composite PK)
adam_program_events        ← immutable event log
```

### RLS notes
- All tables use `auth.role() = 'authenticated'` for autonomy settings/log
- `adam_programs` uses `owner_id = auth.uid()`
- Existing programmes had `owner_id = NULL` → backfill: `UPDATE adam_programs SET owner_id = (SELECT id FROM auth.users LIMIT 1) WHERE owner_id IS NULL`
- `adam_ai_provider_settings` table may NOT EXIST — needs creating (see bug section above)

---

## Recent UI changes

### Radar spinner (v3.css)
```css
.v3-radar-spinner          /* 16px disc, green tint bg + ring */
.v3-radar-spinner::before  /* conic-gradient sweep, rotates 2.2s */
.v3-radar-spinner::after   /* 3px centre dot with glow */
```
Green = `rgba(34, 197, 94, ...)` throughout.

### Phase/agent status hiding
Only shown on `PROGRAMME_SURFACES = ["insight-feed","pipeline","stage","program","programme-health","decide"]`.
Hidden on portfolio, executive/brief, settings.

### MoreView groups
Platform section now includes `{ label: "Agent Schedules", view: "schedules" }`.
`schedules` description added to `VIEW_DESCRIPTIONS`.

---

## Known gaps / next work

1. **Agent run verification** — retry an agent run after the `.maybeSingle()` run-agent deploy; if it fails, the toast should now expose the clearer JSON error.
2. **Agent logs in dashboard** — no UI to browse `adam_agent_runs` / `adam_agent_observations`
3. **Daily briefing UI** — `InsightFeedView` has stub for `program.dailyBriefing` — once agent runs it will auto-populate
4. **Copilot (ADAM Advisor)** removed from rail — if needed, re-add `onOpenCopilot` prop usage
5. **`adam_agent_schedules` label column** — panel generates label as `"Agent · Phase · cron"` string at insert time ✅ fixed
