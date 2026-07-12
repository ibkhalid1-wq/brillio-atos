# ADAM — Master Agentic Transformation Prompt
## Complete Implementation: Architecture → Infrastructure → Intelligence

You are a principal full-stack AI engineer and product architect. You are
implementing the complete agentic transformation of ADAM (AI-Native
Transformation Operating System) — from a partially agentic browser app
into a fully autonomous, reliable, production-grade agentic platform.

This prompt is structured in three sequential phases. Complete each phase
fully before starting the next. Each phase builds on the previous.

**Stack:** React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui ·
Supabase (Postgres + Edge Functions + Realtime + pg_cron) ·
Anthropic Claude (claude-sonnet-4-6) · Vitest · Deno (Edge Functions)

**Preserve:** All existing component APIs, data layer contracts, Supabase
schema (additions only), UI structure, and business logic. Only add and
fix — do not rewrite what works.

---

# PHASE 1 — Browser-Side Agentic Layer + Bug Fixes
*Goal: Fix all confirmed bugs. Complete the in-browser agentic architecture.*

---

## 1.1 — Bug Fixes (Apply First, In Order)

### Fix 1 · adamCopilot.ts ~line 48 · JSON parse crash
Copilot context build crashes if document contains no JSON array.
```typescript
const jsonStr = String(raw || "").match(/\[[\s\S]*\]/)?.[0];
if (!jsonStr) return [];
try {
  const parsed = JSON.parse(jsonStr);
  return Array.isArray(parsed) ? parsed : [];
} catch { return []; }
```

### Fix 2 · adamSync.ts ~line 145 · Silent audit log failure
`writeAuditLog` swallows all Supabase errors silently.
```typescript
try {
  const { error } = await supabase.from("adam_audit_log").insert(auditRecord);
  if (error) {
    console.warn("ADAM audit log write failed:", error.message);
    const pending = JSON.parse(
      localStorage.getItem("adam_pending_audits") || "[]"
    );
    localStorage.setItem(
      "adam_pending_audits",
      JSON.stringify([...pending, auditRecord])
    );
  }
} catch (err) { console.warn("ADAM audit log exception:", err); }
```

### Fix 3 · NaturalLanguageInputBar.tsx ~line 40 · Global coupling
Replace `(globalThis as any).__ADAM_NL_INPUT_RUNTIME__` with a prop:
```typescript
// Add to props interface:
onError?: (message: string) => void;
// Replace toast object:
const notify = (msg: string) => props.onError?.(msg) ?? console.warn(msg);
```

### Fix 4 · PhaseAgentStatusBar.tsx ~lines 294,298 · `as any` type hiding
```typescript
interface BenchmarkDelta { delta: number; message: string; }
const benchmark = state.lastBenchmarkDelta as BenchmarkDelta | null;
if (benchmark && benchmark.delta >= 0) { ... }
```

### Fix 5 · RetroView.tsx ~line 33 · Stale useMemo dependency
```typescript
const questions = useMemo(
  () => session?.questions || pendingItem?.questions || [],
  [pendingItem, session]  // objects, not properties
);
```

### Fix 6 · SanityTest.tsx ~lines 50–56 · Missing null guard
```typescript
const allChecks = results.flatMap((r) => r.checks ?? []);
const failingChecks = results.flatMap((r) =>
  (r.checks ?? []).filter((c) => c.status === "fail")
);
```

### Fix 7 · Four components · crypto.randomUUID() without fallback
**Affected:** CalendarView.tsx · MilestoneView.tsx ·
DataDictionaryView.tsx · CustomTaskTypesView.tsx

Create shared utility, replace all call sites:
```typescript
// src/lib/adamUtils.ts
export const generateId = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
```

### Fix 8 · Missing .env.example
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-here
VITE_SUPABASE_PROJECT_ID=your-project-ref
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 1.2 — Agent Memory (Cross-Session Persistence)

**File:** `src/lib/adamAgentMemory.ts`

```typescript
export interface AgentMemoryEntry {
  agentId: string;
  phaseId: string;
  programId: string;
  timestamp: string;
  type: "decision" | "feedback" | "artifact_outcome" | "escalation";
  summary: string;
  outcome: "accepted" | "rejected" | "modified" | "escalated";
  confidence: number;
  learningNote?: string;
}

export function saveAgentMemory(entry: AgentMemoryEntry): void
export function getAgentMemory(agentId: string, programId: string): AgentMemoryEntry[]
export function buildMemoryContext(agentId: string, programId: string): string
// Max 800 chars. FIFO eviction at 20 entries per agent per program.
// Storage: localStorage keyed adam_agent_memory_{programId}_{agentId}
```

Wire `buildMemoryContext()` into agent system prompt in adamOrchestrator.ts.

---

## 1.3 — Agent Feedback Loop

**File update:** `src/lib/adamOrchestrator.ts`

```typescript
export async function recordAgentFeedback(
  agentId: string,
  phaseId: string,
  programId: string,
  artifactId: string,
  action: "accepted" | "rejected" | "modified",
  humanNote?: string
): Promise<void>
```

On rejection: generate a `learningNote` via short Claude call:
*"Given this artifact was rejected with note: {humanNote}, in one sentence
what should the agent do differently next time?"*

Save to memory. Update `PhaseAgentState.rejectionCount` and
`lastRejectionReason`. Wire into all artifact approval/rejection handlers.

---

## 1.4 — Event-Driven Agent Triggers

**File:** `src/lib/adamAgentTriggers.ts`

```typescript
export type TriggerEvent =
  | "artifact_approved" | "gate_passed" | "decision_resolved"
  | "readiness_threshold_met" | "program_created";

export interface AgentTriggerRule {
  event: TriggerEvent;
  sourcePhaseId?: string;
  targetAgentId: string;
  targetPhaseId: string;
  condition?: (programState: unknown) => boolean;
  delayMs?: number;
}

export const DEFAULT_TRIGGER_RULES: AgentTriggerRule[]
// artifact_approved in discover → trigger design agent
// gate_passed in design → trigger build agent
// decision_resolved → re-run waiting agent
// program_created → run strategy agent after 2s

export function evaluateTriggers(
  event: TriggerEvent,
  context: { phaseId?: string; programId: string; artifactId?: string },
  rules: AgentTriggerRule[],
  onTrigger: (rule: AgentTriggerRule) => void
): void
```

Wire into: artifact approval, gate assessment pass, decision resolution,
program creation.

---

## 1.5 — Cross-Phase Context Passing

**File update:** `src/lib/adamOrchestrator.ts`

```typescript
export function buildCrossPhaseContext(
  programId: string,
  targetPhaseId: string,
  maxChars = 1200
): string
// Collect approved artifacts from all prior ATOS phases
// Extract title + 2-sentence summary per artifact
// Format: "Prior phase context:\n{phase}: {summary}\n..."
// Truncate to maxChars
```

Inject alongside memory context in `runPhaseAgent()`.

---

## 1.6 — Proactive Copilot

**File:** `src/lib/adamCopilotProactive.ts`

```typescript
export interface ProactiveNudge {
  id: string;
  type: "insight" | "warning" | "recommendation" | "celebration";
  message: string;
  actionLabel?: string;
  actionViewId?: string;
  priority: "low" | "medium" | "high";
  expiresAfterMs?: number;
}

export function evaluateProactiveNudges(programState: unknown): ProactiveNudge[]
```

Rules:
- Readiness < 60% → warning + blocker summary
- Decision queue > 3 high-priority unresolved → warning
- Agent idle > 30 min on active program → recommendation
- All artifacts in phase approved → celebration + suggest gate review
- Value delivered crosses 25% / 50% / 75% milestone → insight

Evaluate every 60s in App.jsx. Surface highest-priority unread nudge in
Copilot panel header.

---

## 1.7 — Live Transformation Twin

**File update:** `src/components/TransformationTwinGraph.tsx`

Add prop:
```typescript
agentActivityMap?: Record<string, {
  status: "idle" | "running" | "complete" | "blocked";
  lastAction?: string;
  confidence?: number;
}>
```

- `running` → pulse animation (box-shadow 0→glow→0, 2s loop)
- `complete` → subtle green ring
- `blocked` → amber ring
- Hover tooltip: lastAction + confidence

Wire from `PhaseAgentState` objects in App.jsx.

---

## 1.8 — Build Config

**vite.config.js** — add code splitting:
```javascript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ["react", "react-dom"],
        supabase: ["@supabase/supabase-js"],
        xyflow: ["@xyflow/react"],
        docparsing: ["pdfjs-dist", "mammoth", "jszip"],
      },
    },
  },
  chunkSizeWarningLimit: 1000,
},
```

**tsconfig.json** — create with strict mode:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules"]
}
```

---

### Phase 1 Deliverables

1. `src/lib/adamCopilot.ts` — with JSON parse fix
2. `src/lib/adamSync.ts` — with writeAuditLog fix
3. `src/components/NaturalLanguageInputBar.tsx` — onError prop
4. `src/components/PhaseAgentStatusBar.tsx` — BenchmarkDelta typed
5. `src/components/RetroView.tsx` — useMemo fix
6. `src/pages/SanityTest.tsx` — null guards
7. `src/lib/adamUtils.ts` — generateId()
8. `src/lib/adamAgentMemory.ts` — full implementation
9. `src/lib/adamAgentTriggers.ts` — full implementation
10. `src/lib/adamCopilotProactive.ts` — full implementation
11. `src/lib/adamOrchestrator.ts` — memory + cross-phase + feedback
12. `src/components/TransformationTwinGraph.tsx` — agentActivityMap
13. `vite.config.js` — code splitting
14. `tsconfig.json` — new file
15. `.env.example` — new file

---

# PHASE 2 — Server-Side Infrastructure
*Goal: Move agents server-side. Add scheduling, persistent Copilot threads,
mid-task HITL, Realtime broadcasting, and full observability.*

---

## 2.1 — Database Schema Extensions

```sql
-- Server-side agent run registry
create table adam_agent_runs (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  phase_id text not null,
  status text not null default 'queued'
    check (status in ('queued','running','paused','complete','failed','cancelled')),
  trigger_event text,
  input_context jsonb,
  output jsonb,
  handoff jsonb,
  reasoning_trace text[],
  confidence numeric(4,3),
  tokens_used integer,
  error_message text,
  awaiting_decision_id uuid,
  scheduled_by text check (scheduled_by in ('user','trigger','schedule','handoff')),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  owner_id uuid references auth.users(id)
);

-- Persistent Copilot conversation threads
create table adam_copilot_threads (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  workspace_id text not null,
  messages jsonb not null default '[]',
  summary text,
  open_questions text[],
  last_activity_at timestamptz default now(),
  created_at timestamptz default now(),
  owner_id uuid references auth.users(id),
  unique(program_id, workspace_id, owner_id)
);

-- Full agent observability
create table adam_agent_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references adam_agent_runs(id) on delete cascade,
  program_id uuid not null,
  agent_id text not null,
  phase_id text not null,
  observation_type text not null check (observation_type in (
    'context_built','memory_retrieved','prompt_sent','response_received',
    'artifact_drafted','decision_queued','handoff_created',
    'trigger_fired','error','pause_requested','resume'
  )),
  payload jsonb,
  tokens integer,
  latency_ms integer,
  created_at timestamptz default now()
);

-- Scheduled agent jobs
create table adam_agent_schedules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  agent_id text not null,
  phase_id text not null,
  cron_expression text not null,
  label text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  run_count integer default 0,
  owner_id uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Indexes
create index on adam_agent_runs(program_id, status);
create index on adam_agent_runs(program_id, phase_id, created_at desc);
create index on adam_agent_observations(run_id, created_at);
create index on adam_agent_schedules(program_id, enabled);

-- RLS: auth.uid() = owner_id on all four tables
```

---

## 2.2 — Formal Agent Handoff Type

```typescript
// supabase/functions/_shared/types.ts
export interface AgentHandoff {
  fromAgentId: string;
  fromPhaseId: string;
  toPhaseId: string;
  completedAt: string;
  summary: string;              // 2-3 sentences
  keyDecisions: string[];
  artifactIds: string[];
  openQuestions: string[];
  confidence: number;
  recommendedNextAction: string;
}
```

---

## 2.3 — Edge Functions

### run-agent · `supabase/functions/run-agent/index.ts`

**Request:**
```typescript
{
  programId: string;
  agentId: string;
  phaseId: string;
  triggeredBy: "user" | "trigger" | "schedule" | "handoff";
  triggerEvent?: string;
  incomingHandoff?: AgentHandoff;
  runId?: string;  // if resuming
}
```

**Logic (in order):**
1. Create row in `adam_agent_runs` (status: running)
2. Log `context_built` observation
3. Fetch program state from `adam_programs`
4. Build context: cross-phase artifacts + agent memory + incoming handoff
5. Log `memory_retrieved`
6. Stream Claude API call (claude-sonnet-4-6)
7. Log `prompt_sent` (tokens) + `response_received` (tokens + latency)
8. Scan response for `[PAUSE_FOR_DECISION: {...}]` marker:
   - If found: create Decision Queue item, set run to `paused`,
     set `awaiting_decision_id`, return `{ status: "paused", decisionId }`
9. Parse structured output → save artifacts
10. Create handoff, log `handoff_created`
11. Evaluate triggers, fire downstream agents
12. Set status `complete`, save output + handoff
13. Return `{ status: "complete", runId, output, handoff }`

**Agent mid-task pause instruction** (inject into every agent system prompt):
```
If you need human input to continue, output this marker on its own line
and stop immediately:
[PAUSE_FOR_DECISION: {"reason": "...", "question": "...", "options": [...]}]
Do not generate anything after this marker.
```

### resume-agent · `supabase/functions/resume-agent/index.ts`

**Request:**
```typescript
{
  runId: string;
  decisionId: string;
  resolution: "approved" | "rejected" | "modified";
  humanNote?: string;
  modifiedContent?: string;
}
```

**Logic:**
1. Load paused run. Validate `awaiting_decision_id === decisionId`.
2. Log `resume` observation
3. Rebuild context + inject resolution:
   *"The human resolved the pending decision: {resolution}. Note: {humanNote}. Continue."*
4. Resume Claude call with full prior message history
5. Complete run (same as run-agent steps 8–13)
6. Record feedback memory

### schedule-agent · `supabase/functions/schedule-agent/index.ts`

Called by pg_cron every 15 minutes. Query due schedules → invoke run-agent
for each → update `last_run_at`, `run_count`, `next_run_at`.

**pg_cron setup:**
```sql
select cron.schedule(
  'adam-agent-scheduler', '*/15 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/schedule-agent',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

### copilot-chat · `supabase/functions/copilot-chat/index.ts`

**Request:**
```typescript
{ programId: string; workspaceId: string; message: string; stream?: boolean; }
```

**Logic:**
1. Load/create thread from `adam_copilot_threads`
2. Append user message
3. Build system prompt: workspace identity + program context + thread summary
4. Send last 20 messages to Claude, stream response via SSE:
   `data: {token}\n\n` → `data: [DONE]\n\n`
5. Append assistant message. If > 15 messages: generate 100-word rolling
   summary, keep last 8 messages, update `open_questions`
6. Update `last_activity_at`

### get-agent-trace · `supabase/functions/get-agent-trace/index.ts`

`GET /get-agent-trace?runId={id}`

Returns: full run record + observations array + formatted timeline
(event, timestamp, durationMs, summary).

---

## 2.4 — Realtime Broadcasting

In run-agent, broadcast at every status change:
```typescript
await supabase.channel(`program-${programId}-agents`).send({
  type: "broadcast",
  event: "agent_status",
  payload: { runId, agentId, phaseId, status, confidence,
             latestObservationType, updatedAt: new Date().toISOString() },
});
```

---

## 2.5 — Client Hooks

### `src/hooks/useAgentRun.ts`
```typescript
export function useAgentRun(programId: string) {
  activeRuns: AgentRun[];
  isRunning: boolean;
  runAgent(params: { agentId: string; phaseId: string;
                     triggeredBy: "user" | "trigger" }): Promise<{runId: string; status: string}>;
  resumeRun(params: { runId: string; decisionId: string;
                      resolution: "approved"|"rejected"|"modified";
                      humanNote?: string }): Promise<void>;
}
// Subscribe to adam_agent_runs via Realtime. Clean up on unmount.
```

### `src/hooks/useCopilotThread.ts`
```typescript
export function useCopilotThread(programId: string, workspaceId: string) {
  messages: ThreadMessage[];
  isLoading: boolean;
  openQuestions: string[];
  sendMessage(content: string): Promise<void>;  // SSE streaming → state
  clearThread(): Promise<void>;
}
```

### `src/hooks/useAgentSchedules.ts`
```typescript
export function useAgentSchedules(programId: string) {
  schedules: AgentSchedule[];
  createSchedule(params: { agentId: string; phaseId: string;
                            cronExpression: string; label: string }): Promise<void>;
  toggleSchedule(scheduleId: string, enabled: boolean): Promise<void>;
  deleteSchedule(scheduleId: string): Promise<void>;
}
```

---

## 2.6 — Observability UI

### `src/components/agents/AgentTraceViewer.tsx`
Full-page drawer. Shows: run metadata header, timeline of observations
(event type · timestamp · summary), expandable reasoning trace steps,
structured handoff card. Props: `{ runId: string; onClose: () => void }`.

### `src/components/agents/AgentScheduleManager.tsx`
Panel: list schedules with next-run countdown, create schedule (Daily 8am /
Weekly Monday / Custom cron with human-readable description),
enable/disable toggle, last run status + trace link.

### `src/pages/AgentObservabilityView.tsx`
Full observability dashboard:
1. **Run History** — sortable table, click → AgentTraceViewer
2. **Paused Runs** — highlighted, one-click resume
3. **Active Now** — live-updating via Realtime
4. **Schedules** — embed AgentScheduleManager
5. **Stats** — total runs, avg confidence, artifact acceptance rate,
   decision resolution time

---

### Phase 2 Deliverables

1. `supabase/migrations/001_agent_infrastructure.sql`
2. `supabase/functions/_shared/types.ts`
3. `supabase/functions/_shared/claudeClient.ts`
4. `supabase/functions/run-agent/index.ts`
5. `supabase/functions/resume-agent/index.ts`
6. `supabase/functions/schedule-agent/index.ts`
7. `supabase/functions/copilot-chat/index.ts`
8. `supabase/functions/get-agent-trace/index.ts`
9. `src/hooks/useAgentRun.ts`
10. `src/hooks/useCopilotThread.ts`
11. `src/hooks/useAgentSchedules.ts`
12. `src/lib/adamSync.ts` — add saveAgentRun, getAgentRuns, getPausedRuns
13. `src/lib/adamOrchestrator.ts` — runPhaseAgent calls run-agent Edge Function
14. `src/components/agents/AgentTraceViewer.tsx`
15. `src/components/agents/AgentScheduleManager.tsx`
16. `src/pages/AgentObservabilityView.tsx`

---

# PHASE 3 — Agent Prompt Library + Evaluation Framework
*Goal: Make agents reliably intelligent. Build the prompt library, eval
dataset, runner, judge, and improvement loop.*

---

## 3.1 — Agent Prompt Library

**File:** `src/lib/adamAgentPrompts.ts`

Write complete system prompts for all 13 agents. Each prompt must follow
this structure and be minimum 400 words:

```
IDENTITY
You are {world-class practitioner role} operating within ADAM.

YOUR MISSION THIS RUN
{specific, measurable objective}

INPUTS YOU HAVE RECEIVED
- Program context: {injected at runtime}
- Prior phase context: {injected at runtime}
- Your memory: {injected at runtime}
- Incoming handoff: {injected at runtime}

YOUR RESPONSIBILITIES
1. {primary — specific and falsifiable}
2. {secondary}
3. {quality gate — what must be true before completing}

OUTPUT FORMAT
Respond with JSON matching exactly:
{TypeScript interface — defined per agent}

CONFIDENCE CALIBRATION
1.0: All inputs present, no ambiguity
0.8: Most inputs, minor assumptions
0.6: Key inputs missing, directional only
0.4: Insufficient — pause before completing
<0.4: Output [PAUSE_FOR_DECISION: {...}]

PAUSE IF
- {agent-specific condition 1}
- {agent-specific condition 2}
- Confidence on any critical field would be < 0.5

QUALITY BAR
Before completing, verify:
- {agent-specific criterion 1 — concrete, not vague}
- {agent-specific criterion 2}
- No field is null, empty, or a placeholder
```

**All 13 output schemas** (TypeScript interfaces, fully typed, no `any`):

| Agent | Key Output Fields |
|---|---|
| strategy | transformationThesis, desiredOutcomes[], valueHypothesis, criticalAssumptions[], riskFlags[], recommendedScope |
| mobilise | orgReadinessScore, governanceStructure, commsplan, stakeholderMap[], blockers[] |
| discover | opportunities[], businessCases[], valuePoolMap, priorityMatrix |
| design | capabilities[], autonomyRecommendations[], workforceImpact, designDecisions[] |
| agent_arch | agentBlueprints[], toolRequirements[], escalationPolicies[], skillMatrix |
| build | buildPackages[], testingStrategy, deploymentTargets[], securityControls[] |
| operate | governanceControls[], hitlPolicies[], complianceChecks[], operationalRisks[] |
| govern | auditFramework, complianceScore, controlGaps[], remediationPlan[] |
| optimize | valueLeakage[], optimizationOpportunities[], reuseAssets[], maturityScore |
| valuerealize | valueDelivered, valueVariance, lessonsLearned[], nextCycleRecommendations[] |
| delivery | raidLog, phaseStatus[], learningCycleHealth, milestones[] |
| adoption | adoptionRate, championNetwork[], trainingCompletion, resistanceFlags[] |
| titan | outcomePrediction, confidenceInterval, scenarioModels[], benchmarks[] |

Each agent must have pause conditions specific to its domain. Examples:
- **strategy**: pause if business challenge is unmeasurable or sponsor unnamed
- **discover**: pause if no quantitative baseline for any opportunity
- **design**: pause if human oversight requirements unclear for L3+ capabilities
- **agent_arch**: pause if a required tool or data source is undefined

---

## 3.2 — Prompt Registry

**File:** `src/lib/adamPromptRegistry.ts`

```typescript
export interface PromptVersion {
  agentId: string;
  version: string;          // semver
  prompt: string;
  outputSchema: Record<string, unknown>;
  changelog: string;
  publishedAt: string;
  publishedBy: string;
  evalScores?: {
    overallScore: number;
    byDimension: Record<string, number>;
    sampleSize: number;
    evalRunId: string;
  };
  status: "draft" | "active" | "deprecated";
}

export const PROMPT_REGISTRY: Record<string, PromptVersion[]>
export function getActivePrompt(agentId: string): PromptVersion
export function getPromptVersion(agentId: string, version: string): PromptVersion
export function promotePromptVersion(agentId: string, version: string): void
export function deprecatePromptVersion(agentId: string, version: string): void
```

---

## 3.3 — Eval Dataset

**File:** `src/lib/evals/adamEvalDataset.ts`

```typescript
export interface EvalCase {
  id: string;
  agentId: string;
  name: string;
  description: string;
  input: {
    programContext: ProgramContext;
    crossPhaseContext?: string;
    memory?: AgentMemoryEntry[];
    incomingHandoff?: AgentHandoff;
  };
  expectedOutputTraits: ExpectedTrait[];
  antiPatterns: AntiPattern[];
  tags: ("happy_path" | "edge_case" | "ambiguous_input" | "adversarial" | "pause_trigger")[];
}

export type EvalDimension =
  | "accuracy" | "completeness" | "specificity" | "consistency"
  | "schema_validity" | "confidence_calibration" | "pause_behavior"
  | "tone" | "hallucination";
```

**Minimum 91 eval cases — 7 per agent:**
- 3 happy path (complete inputs, different industries each)
- 2 edge cases (ambiguous inputs, missing context)
- 1 adversarial (contradictory or trick inputs)
- 1 pause trigger (input that must cause agent to pause)

Use realistic program contexts. Named industries: Life Sciences, Financial
Services, Healthcare, Retail, Manufacturing, Public Sector. Real-sounding
company names, budgets, timelines, sponsors. No generic "Acme Corp" data.

Anti-patterns to detect (add to relevant cases):
- Vague thesis ("improve efficiency" instead of measurable outcome)
- Hallucinated figures not present in input
- Generic recommendations that ignore industry context
- Placeholder text ("[INSERT VALUE HERE]")
- Confidence mismatch (0.95 on clearly ambiguous input)

---

## 3.4 — Eval Runner

**File:** `src/lib/evals/adamEvalRunner.ts`

```typescript
export interface EvalResult {
  evalCaseId: string;
  agentId: string;
  promptVersion: string;
  runAt: string;
  agentOutput: string;
  parsedOutput: Record<string, unknown> | null;
  tokensUsed: number;
  latencyMs: number;
  dimensionScores: {
    dimension: EvalDimension;
    score: number;      // 0.0–1.0
    passed: boolean;
    reasoning: string;
    weight: number;
  }[];
  weightedScore: number;
  passed: boolean;      // threshold: 0.75
  antiPatternViolations: { pattern: string; found: boolean; evidence?: string; }[];
  issues: string[];
  recommendations: string[];
}

export interface EvalRunSummary {
  runId: string;
  promptVersion: string;
  agentId: string;
  runAt: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  averageScore: number;
  scoresByDimension: Record<EvalDimension, number>;
  scoresByTag: Record<string, number>;
  regressions: string[];
  improvements: string[];
  results: EvalResult[];
}

export async function runEval(params: {
  agentId: string;
  promptVersion?: string;
  cases?: string[];
  compareToVersion?: string;
}): Promise<EvalRunSummary>

export async function runAllEvals(params: {
  compareToVersion?: string;
}): Promise<Record<string, EvalRunSummary>>
```

---

## 3.5 — LLM-as-Judge

**File:** `src/lib/evals/adamEvalJudge.ts`

Separate Claude call — isolated from agent runtime, no shared context:

```typescript
export async function evaluateWithLLM(params: {
  dimension: EvalDimension;
  evalCase: EvalCase;
  agentOutput: string;
  trait: ExpectedTrait;
}): Promise<{ score: number; reasoning: string; passed: boolean }>
```

Judge system prompt:
```
You are an expert evaluator assessing AI outputs for an enterprise
transformation platform. You do not know which AI produced this output.

DIMENSION: {dimension}
CRITERIA: {trait.description}
PASSING THRESHOLD: 0.75

Scoring guidance:
- Specificity: "improve efficiency" = 0.2. "Reduce manual reconciliation
  by 60% via agent automation within 6 months" = 0.95
- Hallucination: any invented figure, name, or fact not in input = 0.0
- Confidence calibration: 0.95 confidence on ambiguous input = 0.3
- Generic recommendations ignoring industry context = 0.4 max

Respond only with JSON:
{"score": 0.0-1.0, "reasoning": "...", "passed": true|false}
```

---

## 3.6 — Schema Validator

Add to `src/lib/evals/adamEvalRunner.ts`:
```typescript
export function validateOutputSchema(
  agentId: string,
  output: unknown
): { valid: boolean; errors: string[] }
// Validate against the output schema from adamAgentPrompts.ts
// All required fields present and correctly typed
```

---

## 3.7 — Regression Detector

```typescript
export function detectRegressions(
  current: EvalRunSummary,
  baseline: EvalRunSummary
): {
  regressions: { caseId: string; before: number; after: number; delta: number }[];
  improvements: { caseId: string; before: number; after: number; delta: number }[];
  overallDelta: number;
  recommendation: "promote" | "reject" | "investigate";
}
// promote: no regressions, score >= baseline
// reject: any regression > 0.15 on happy_path case
// investigate: regressions exist but < 0.15
```

---

## 3.8 — Eval CLI

**File:** `src/lib/evals/adamEvalCLI.ts`

```bash
npx tsx src/lib/evals/adamEvalCLI.ts --agent strategy
npx tsx src/lib/evals/adamEvalCLI.ts --all
npx tsx src/lib/evals/adamEvalCLI.ts --agent strategy --version 1.1.0 --compare 1.0.0
npx tsx src/lib/evals/adamEvalCLI.ts --agent discover --tags edge_case
```

Terminal output format:
```
ADAM Eval Runner — Strategy Advisor v1.1.0
──────────────────────────────────────────
✅ PASS  happy_001  Life Sciences complete inputs        0.91
✅ PASS  happy_002  FinServ strong business case         0.88
❌ FAIL  edge_001   Missing sponsor + no baseline        0.61
✅ PASS  pause_001  Pause triggered correctly            1.00

Pass Rate:   3/4  (75%)   Avg Score: 0.85
vs v1.0.0:   +0.06 ↑  (2 improvements, 0 regressions)
Recommend:   PROMOTE ✅

Dimensions: accuracy 0.88 · completeness 0.91 · specificity 0.79 ←
```

---

## 3.9 — Prompt Improvement Loop

**File:** `src/lib/evals/adamPromptImprover.ts`

```typescript
export async function generatePromptImprovements(params: {
  agentId: string;
  currentPrompt: string;
  failingCases: EvalResult[];
  weakDimensions: EvalDimension[];
}): Promise<{
  diagnosis: string;
  suggestedChanges: {
    section: string;
    current: string;
    suggested: string;
    rationale: string;
    expectedImpact: string;
  }[];
  newPromptDraft: string;
}>
```

Creates the feedback loop: run evals → identify failures → improve prompt
→ test new version → compare → promote if better → repeat.

---

## 3.10 — Eval Dashboard UI

**File:** `src/components/evals/EvalDashboard.tsx`

Admin-only view accessible from AgentObservabilityView:

1. **Agent Health Matrix** — 13 agents × 9 eval dimensions grid,
   color-coded (green ≥ 0.85, amber ≥ 0.75, red < 0.75)
2. **Version History** — per-agent prompt version timeline with scores
3. **Failing Cases** — list with dimension, output excerpt, judge reasoning,
   full output expansion
4. **Promote / Rollback** — one-click version management

---

### Phase 3 Deliverables

1. `src/lib/adamAgentPrompts.ts` — all 13 prompts + schemas (min 400 words each)
2. `src/lib/adamPromptRegistry.ts` — versioning system
3. `src/lib/evals/adamEvalDataset.ts` — 91 eval cases
4. `src/lib/evals/adamEvalRunner.ts` — full runner + schema validator +
   regression detector
5. `src/lib/evals/adamEvalJudge.ts` — LLM-as-judge
6. `src/lib/evals/adamEvalCLI.ts` — CLI with colored output
7. `src/lib/evals/adamPromptImprover.ts` — improvement loop
8. `src/components/evals/EvalDashboard.tsx` — health matrix + version history

---

# Global Technical Constraints

Apply across all three phases:

- **TypeScript:** Strict mode throughout. No `any` except bridging legacy
  code (mark `// TODO: type properly`). All async functions explicitly typed.
- **Error handling:** Every async operation has try-catch. No silent failures.
- **Realtime:** All Supabase Realtime subscriptions clean up on unmount.
- **Edge Functions:** Deno + TypeScript. No Node.js APIs. Use direct fetch
  for Anthropic (not Node SDK). Validate Authorization header on every function.
- **Streaming:** SSE format: `data: {token}\n\n` → `data: [DONE]\n\n`
- **No placeholders:** Every deliverable is complete, production-ready code.
- **File paths:** Exactly as specified. No deviations.
- **Preserve:** All existing hooks, Supabase integration, component APIs,
  and business logic. Add and fix only.

---

# Completion Definition

ADAM is fully agentic when all three phases are implemented:

| Capability | Phase |
|---|---|
| All 8 bugs fixed | 1 |
| Agent memory + learning | 1 |
| Event-driven triggers | 1 |
| Cross-agent context | 1 |
| Proactive Copilot | 1 |
| Live Transformation Twin | 1 |
| Server-side agent execution | 2 |
| Autonomous scheduling | 2 |
| Persistent Copilot threads | 2 |
| Formal handoff protocol | 2 |
| Mid-task HITL pause/resume | 2 |
| Realtime broadcasting | 2 |
| Full observability UI | 2 |
| 13 high-quality agent prompts | 3 |
| Prompt versioning system | 3 |
| 91-case eval dataset | 3 |
| LLM-as-judge eval runner | 3 |
| Regression detection | 3 |
| Automated improvement loop | 3 |
| Eval dashboard UI | 3 |
```

---

All three prompts unified into one sequenced master.

**Run order:** Phase 1 → validate → Phase 2 → validate → Phase 3.

Each phase is self-contained — you can run them separately or feed the full
prompt to a single session.
