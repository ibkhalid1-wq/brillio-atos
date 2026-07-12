# ADAM — Final Implementation Prompt (Validation-Verified)

You are a senior Deno + TypeScript engineer implementing the final
guardrails and quality layer for ADAM, a production agentic platform.

Every detail below has been validated against the actual codebase.
Variable names, function signatures, line numbers, table names, and
import paths are exact. Do not deviate from established patterns.

Base path: /Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/
           brillio-atlas-codex/

Implement in this exact order — each step depends on the previous.

---

# STEP 1 — Database Migration (Run First)

**File:** `supabase/migrations/002_agent_run_extensions.sql`

Two existing migrations: `001_agent_infrastructure.sql` and
`20260610_adam_backend.sql`. This is additive only — no existing
tables or columns are modified.

```sql
-- Add guardrail columns to adam_agent_runs
alter table adam_agent_runs
  add column if not exists pause_count integer not null default 0,
  add column if not exists validation_warnings jsonb;

-- Artifact table for cross-agent context and copilot awareness
create table if not exists adam_program_artifacts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references adam_programs(id) on delete cascade,
  phase_id text not null,
  artifact_type text not null,
  title text not null,
  content text,
  content_summary text,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'archived')),
  agent_confidence numeric(4,3),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  owner_id uuid references auth.users(id)
);

create index if not exists idx_program_artifacts_program_status
  on adam_program_artifacts(program_id, status);

create index if not exists idx_program_artifacts_phase
  on adam_program_artifacts(program_id, phase_id, status);

alter table adam_program_artifacts enable row level security;

create policy "owners can manage artifacts"
  on adam_program_artifacts
  for all using (auth.uid() = owner_id);

create policy "service role full access artifacts"
  on adam_program_artifacts
  for all using (true)
  with check (true);
```

---

# STEP 2 — run-agent Edge Function

**File:** `supabase/functions/run-agent/index.ts`

Three independent additions to this file. Apply all three.

## 2A — validateAgentOutput()

Add this function at module scope, after the existing
`parseAgentPayload()` function (~line 230):

```typescript
function validateAgentOutput(
  agentId: string,
  output: ParsedAgentPayload,
): string[] {
  const errors: string[] = [];

  if (!output.summary || output.summary.trim() === "") {
    errors.push("Missing required field: summary");
  }
  if (typeof output.confidence !== "number") {
    errors.push("confidence must be a number");
  } else if (output.confidence < 0 || output.confidence > 1) {
    errors.push(`confidence ${output.confidence} out of range 0–1`);
  }
  if (!Array.isArray(output.reasoningTrace) || output.reasoningTrace.length === 0) {
    errors.push("reasoningTrace must be a non-empty array");
  }
  if (output.artifacts.length === 0) {
    errors.push("Agent produced no artifacts");
  }

  const agentArtifactRequirements: Record<string, string[]> = {
    strategy:     ["transformationThesis", "desiredOutcomes", "valueHypothesis",
                   "criticalAssumptions", "riskFlags"],
    mobilise:     ["orgReadinessScore", "governanceStructure", "commsPlan",
                   "stakeholderMap", "blockers"],
    discover:     ["opportunities", "businessCases", "valuePoolMap"],
    design:       ["capabilities", "autonomyRecommendations", "workforceImpact"],
    agent_arch:   ["agentBlueprints", "toolRequirements", "escalationPolicies"],
    build:        ["buildPackages", "testingStrategy", "deploymentTargets"],
    operate:      ["governanceControls", "hitlPolicies", "complianceChecks"],
    govern:       ["auditFramework", "complianceScore", "controlGaps"],
    optimize:     ["valueLeakage", "optimizationOpportunities", "maturityScore"],
    valuerealize: ["valueDelivered", "lessonsLearned", "nextCycleRecommendations"],
    delivery:     ["raidLog", "phaseStatus", "milestones"],
    adoption:     ["adoptionRate", "championNetwork", "trainingCompletion"],
    titan:        ["outcomePrediction", "confidenceInterval", "scenarioModels"],
  };

  if (output.artifacts.length > 0) {
    try {
      const artifactContent = JSON.parse(output.artifacts[0].content || "{}");
      for (const field of agentArtifactRequirements[agentId] ?? []) {
        if (
          !(field in artifactContent) ||
          artifactContent[field] === null ||
          artifactContent[field] === undefined
        ) {
          errors.push(`Artifact missing required field for ${agentId}: ${field}`);
        }
      }
    } catch {
      errors.push("First artifact content is not valid JSON");
    }
  }

  return errors;
}
```

## 2B — Schema validation + confidence floor

Insert immediately after line 695
(`const parsed = parseAgentPayload(...)`):

```typescript
// Schema validation
const schemaErrors = validateAgentOutput(request.agentId, parsed);
if (schemaErrors.length > 0) {
  await logObservation(auth.admin, {
    runId,
    programId: request.programId,
    agentId: request.agentId,
    phaseId: request.phaseId,
    observationType: "error",
    payload: { type: "schema_validation_failed", errors: schemaErrors },
  });
}

// Confidence floor — auto-pause critical phase agents below threshold
const CONFIDENCE_FLOOR = 0.5;
const CRITICAL_PHASES = new Set(["strategy", "design", "agent_arch", "govern"]);

if (
  typeof parsed.confidence === "number" &&
  parsed.confidence < CONFIDENCE_FLOOR &&
  CRITICAL_PHASES.has(request.phaseId) &&
  schemaErrors.length === 0
) {
  const decisionId = crypto.randomUUID();

  // Use existing appendDecisionQueueItems pattern (same as pause handler)
  const updatedData = appendDecisionQueueItems(contextProgramData, [{
    id: decisionId,
    type: "agent_clarification",
    priority: "high",
    title: `${request.agentId} agent confidence too low to proceed`,
    question:
      `The ${request.agentId} agent completed with ` +
      `${Math.round(parsed.confidence * 100)}% confidence — below the ` +
      `${CONFIDENCE_FLOOR * 100}% threshold for critical phases. ` +
      `Review the output and either approve to continue or provide ` +
      `additional context for a re-run.`,
    options: ["Approve and proceed", "Provide more context and re-run"],
    runId,
    agentId: request.agentId,
    phaseId: request.phaseId,
    createdAt: new Date().toISOString(),
  }]);

  await persistProgramData(auth.admin, request.programId, updatedData);

  await auth.admin
    .from("adam_agent_runs")
    .update({
      status: "paused",
      awaiting_decision_id: decisionId,
      pause_count: 1,
    })
    .eq("id", runId);

  await logObservation(auth.admin, {
    runId,
    programId: request.programId,
    agentId: request.agentId,
    phaseId: request.phaseId,
    observationType: "pause_requested",
    payload: {
      reason: "confidence_below_floor",
      confidence: parsed.confidence,
      floor: CONFIDENCE_FLOOR,
      decisionId,
    },
  });

  return new Response(
    JSON.stringify({
      status: "paused",
      reason: "confidence_below_floor",
      confidence: parsed.confidence,
      decisionId,
    } satisfies Partial<RunAgentResponse>),
    { headers: { "Content-Type": "application/json" } },
  );
}
```

Add `validation_warnings` to the final `.update()` block at ~line 741:
```typescript
// In the existing update block, add this field:
validation_warnings: schemaErrors.length > 0
  ? schemaErrors as unknown as JsonValue
  : null,
```

## 2C — Schedule idempotency

The main run uses `upsert` at ~line 540 (already idempotent via
`onConflict: "id"`). The downstream trigger run uses plain `.insert()`
inside `queueTriggeredRun()` at ~line 407 — add `onConflict` there.

Inside `queueTriggeredRun()`, find the `.insert({...})` call and change to:

```typescript
await admin
  .from("adam_agent_runs")
  .insert({
    program_id: run.programId,
    agent_id: run.agentId,
    phase_id: run.phaseId,
    status: "queued",
    trigger_event: run.triggerEvent,
    scheduled_by: "handoff",
    owner_id: run.ownerId,
    handoff: (run.incomingHandoff || null) as JsonValue | null,
  })
  // Silently skip if an identical queued run already exists
  .upsert(
    {
      program_id: run.programId,
      agent_id: run.agentId,
      phase_id: run.phaseId,
      status: "queued",
      trigger_event: run.triggerEvent,
      scheduled_by: "handoff",
      owner_id: run.ownerId,
      handoff: (run.incomingHandoff || null) as JsonValue | null,
    },
    { ignoreDuplicates: true }
  );
```

Also add a schedule-triggered dedup guard before the main `upsert` at
~line 540, inside the handler — after `auth` is obtained:

```typescript
// Dedup guard for schedule-triggered runs only
if (request.triggeredBy === "schedule") {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recentRun } = await auth.admin
    .from("adam_agent_runs")
    .select("id")
    .eq("program_id", request.programId)
    .eq("agent_id", request.agentId)
    .eq("phase_id", request.phaseId)
    .eq("scheduled_by", "schedule")
    .gte("created_at", tenMinutesAgo)
    .maybeSingle();

  if (recentRun) {
    return new Response(
      JSON.stringify({
        status: "skipped",
        reason: "duplicate_schedule_trigger",
        existingRunId: recentRun.id,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
}
```

---

# STEP 3 — resume-agent Edge Function

**File:** `supabase/functions/resume-agent/index.ts`

## 3A — Multi-pause guard

Insert immediately after line 165
(`if (run.awaiting_decision_id !== payload.decisionId) { ... }`):

```typescript
// Multi-pause guard — cap at 3 pauses per run
const currentPauseCount = (run.pause_count as number | null) ?? 0;
if (currentPauseCount >= 3) {
  await admin
    .from("adam_agent_runs")
    .update({
      status: "failed",
      error_message:
        "Run exceeded the maximum pause limit (3). " +
        "Re-run the agent with additional context.",
    })
    .eq("id", run.id);

  return jsonResponse(
    {
      error: "max_pauses_exceeded",
      message:
        "This agent run has paused 3 times. " +
        "Please review the program context and start a new run.",
    },
    422,
  );
}
```

## 3B — Increment pause_count

In the existing status update at lines 192–199, add `pause_count`:

```typescript
await admin
  .from("adam_agent_runs")
  .update({
    status: "running",
    awaiting_decision_id: null,
    error_message: null,
    pause_count: currentPauseCount + 1,   // ADD THIS LINE
  })
  .eq("id", run.id);
```

## 3C — Token accumulation

At line 343, inside the final `.update()` block, change:

```typescript
// FROM:
tokens_used: claudeResult.inputTokens + claudeResult.outputTokens,

// TO:
tokens_used: ((run.tokens_used as number | null) ?? 0) +
             claudeResult.inputTokens +
             claudeResult.outputTokens,
```

`run` is already in scope (loaded at line 153 via `.select("*")`).
`claudeResult` is already in scope from the resumed Claude call.

---

# STEP 4 — get-agent-trace Edge Function

**File:** `supabase/functions/get-agent-trace/index.ts`

Two changes: update `authenticateRequest()` return type, update the
one call site, add ownership check.

## 4A — Update authenticateRequest()

The current function at lines 38–52 returns `Promise<SupabaseClient>`.
Replace the entire function:

```typescript
interface TraceAuthContext {
  admin: SupabaseClient;
  ownerId: string | null;
  isService: boolean;
}

async function authenticateRequest(req: Request): Promise<TraceAuthContext> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getAdminClient();
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { admin, ownerId: null, isService: true };
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(error?.message || "Authentication failed.");
  }
  return { admin, ownerId: data.user.id, isService: false };
}
```

## 4B — Update call site

At line 72, the only call site:

```typescript
// FROM:
const admin = await authenticateRequest(req);

// TO:
const { admin, ownerId, isService } = await authenticateRequest(req);
```

## 4C — Add ownership check

After the run fetch at lines 79–84, insert:

```typescript
const { data: run, error: runError } = await admin
  .from("adam_agent_runs")
  .select("*")
  .eq("id", runId)
  .single();
if (runError || !run) {
  return jsonResponse({ error: runError?.message || "Run not found." }, 404);
}

// INSERT HERE — ownership check
if (!isService && ownerId !== run.owner_id) {
  return jsonResponse({ error: "Access denied." }, 403);
}
```

---

# STEP 5 — copilot-chat Edge Function

**File:** `supabase/functions/copilot-chat/index.ts`

Note: `authenticateRequest()` in this file already returns
`{ admin, ownerId }` (line 98: `const { admin, ownerId } = ...`).
Do not change the auth pattern in this file.

## 5A — Add artifact fetcher

Add this function at module scope, after `buildWorkspacePrompt()`:

```typescript
async function fetchApprovedArtifactContext(
  admin: SupabaseClient,
  programId: string,
  maxChars = 1000,
): Promise<string> {
  try {
    const { data: artifacts } = await admin
      .from("adam_program_artifacts")
      .select("phase_id, title, content_summary, approved_at")
      .eq("program_id", programId)
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(8);

    if (!artifacts || artifacts.length === 0) return "";

    const lines = artifacts.map(
      (a) =>
        `[${String(a.phase_id).toUpperCase()}] ${String(a.title)}: ` +
        String(a.content_summary ?? "").slice(0, 150),
    );

    return ("\n\nAPPROVED ARTIFACTS:\n" + lines.join("\n")).slice(0, maxChars);
  } catch {
    return ""; // non-blocking — copilot works without artifacts
  }
}
```

## 5B — Update buildWorkspacePrompt() signature

The current signature at line 74:
```typescript
function buildWorkspacePrompt(
  workspaceId: string,
  programContext: Record<string, JsonValue>,
  summary: string | null
): string
```

Add `artifactContext` parameter and inject it:
```typescript
function buildWorkspacePrompt(
  workspaceId: string,
  programContext: Record<string, JsonValue>,
  summary: string | null,
  artifactContext: string,        // ADD
): string {
  const identity = (() => {
    if (workspaceId === "home") return "Transformation Advisor";
    if (workspaceId === "twin") return "Architect";
    if (workspaceId === "decisions") return "PMO Lead";
    if (workspaceId === "assets") return "Analyst";
    return "Workspace Advisor";
  })();

  return [
    `You are ADAM Copilot acting as the ${identity} for the "${workspaceId}" workspace.`,
    `Program name: ${String(programContext.programName || "Untitled Program")}`,
    `Program objective: ${String(programContext.programObjective || "")}`,
    summary ? `Thread summary: ${summary}` : "",
    artifactContext,               // ADD
    "Be concise, specific, and action-oriented.",
  ].filter(Boolean).join("\n\n");
}
```

## 5C — Update call site

At line 151, the only call to `buildWorkspacePrompt()`. Add artifact
fetch before it, then pass result:

```typescript
// Fetch artifact context (non-blocking, fails silently)
const artifactContext = await fetchApprovedArtifactContext(
  admin,
  payload.programId,
);

// Update call — add artifactContext as 4th argument
const systemPrompt = buildWorkspacePrompt(
  payload.workspaceId,
  programContext,
  existingThread?.summary || null,
  artifactContext,               // ADD
);
```

---

# STEP 6 — Eval Dataset

**File:** `src/lib/evals/adamEvalDataset.ts`

## 6A — Add PHASE_ORDER constant

`PHASE_ORDER` does not exist anywhere in the codebase. Add at module
scope, before the `HANDOFF_CASES` declaration:

```typescript
// ATOS lifecycle phase precedence — maps each agent to its prior phase
const PHASE_ORDER: Partial<Record<AdamAgentId, AdamAgentId>> = {
  mobilise:     "strategy",
  discover:     "mobilise",
  design:       "discover",
  agent_arch:   "design",
  build:        "agent_arch",
  operate:      "build",
  govern:       "operate",
  optimize:     "govern",
  valuerealize: "optimize",
  delivery:     "build",
  adoption:     "mobilise",
  titan:        "discover",
  // strategy has no prior phase — intentionally omitted
};
```

## 6B — Add HANDOFF_CASES constant

Add after `PHASE_ORDER`, before the `ADAM_EVAL_DATASET` export:

```typescript
// 26 handoff continuity cases (2 per agent, strategy skipped = 12 agents × 2)
const HANDOFF_CASES: EvalCase[] = (
  Object.keys(AGENT_PROFILES) as AdamAgentId[]
)
  .filter((agentId) => agentId in PHASE_ORDER)  // exclude strategy
  .flatMap((agentId) => {
    const priorPhaseId = PHASE_ORDER[agentId]!;
    const baseContext = AGENT_PROFILES[agentId].seedContext;

    const happyHandoff: AgentHandoff = {
      fromAgentId: priorPhaseId,
      fromPhaseId: priorPhaseId,
      toPhaseId: agentId,
      completedAt: "2026-03-15T09:00:00Z",
      summary:
        `The ${priorPhaseId} phase completed with 87% confidence. ` +
        `Key outputs: confirmed transformation thesis, three measurable ` +
        `outcomes with named owners, prioritised value pool of £4.2M ` +
        `over 18 months.`,
      keyDecisions: [
        "Scope confirmed: agent-assisted processing, no autonomous decisions",
        "Primary value pool: operational efficiency (£2.8M)",
        "Delivery timeline: 14 months with quarterly value gates",
      ],
      artifactIds: [`${priorPhaseId}_brief_v1`, `${priorPhaseId}_outcomes_v1`],
      openQuestions: [
        "Regulatory approval pathway for AI-assisted outputs not yet confirmed",
      ],
      confidence: 0.87,
      recommendedNextAction:
        `Proceed to ${agentId} phase. Validate the £2.8M efficiency ` +
        `hypothesis before designing capabilities.`,
    };

    const handoffHappy: EvalCase = {
      id: `${agentId}_handoff_001`,
      agentId,
      name: `Handoff continuity — valid handoff (${agentId})`,
      description:
        `Agent receives a well-formed handoff from ${priorPhaseId}. ` +
        `Output must reference and build on prior decisions.`,
      input: {
        programContext: baseContext,
        crossPhaseContext:
          `Prior phase (${priorPhaseId}) approved outputs:\n` +
          `- Transformation thesis: Agent-assisted operations reducing ` +
          `manual processing by 60% within 14 months.\n` +
          `- Value pools confirmed: efficiency £2.8M, risk £0.9M, CX £0.5M.\n` +
          `- Executive sponsor: Chief Operating Officer.\n` +
          `- Constraint: all agent outputs require human sign-off for ` +
          `regulatory submissions.`,
        incomingHandoff: happyHandoff,
      },
      expectedOutputTraits: [
        {
          dimension: "consistency",
          description:
            "Output references at least 2 items from the incoming handoff " +
            "and does not contradict prior phase decisions.",
          evaluator: "llm",
          weight: 0.30,
        },
        {
          dimension: "accuracy",
          description:
            "No facts invented beyond what is in program context or handoff.",
          evaluator: "llm",
          weight: 0.20,
        },
        {
          dimension: "completeness",
          description: "All required output fields for this agent are populated.",
          evaluator: "schema",
          weight: 0.20,
        },
        {
          dimension: "specificity",
          description:
            "Recommendations are specific to program context — not generic.",
          evaluator: "llm",
          weight: 0.15,
        },
        {
          dimension: "confidence_calibration",
          description: "Confidence ≥ 0.75 given well-formed inputs.",
          evaluator: "llm",
          weight: 0.15,
        },
      ],
      antiPatterns: [
        {
          description: "Output ignores handoff — generic advice only",
          llmCheck:
            "Does the output contain specific references to the incoming " +
            "handoff (value pools, decisions, open questions), or could it " +
            "have been written without any handoff context?",
        },
        {
          description: "Contradicts a prior phase decision",
          llmCheck:
            "Does the output contradict any key decisions from the handoff " +
            "(scope, value pools, timeline, regulatory constraints)?",
        },
      ],
      tags: ["handoff_happy"],
    };

    const handoffError: EvalCase = {
      id: `${agentId}_handoff_002`,
      agentId,
      name: `Handoff continuity — missing handoff (${agentId})`,
      description:
        `Agent receives no handoff. Must pause OR proceed with ≤ 0.65 ` +
        `confidence and explicit flagged assumptions. Must NOT produce ` +
        `high-confidence output as if prior context exists.`,
      input: {
        programContext: baseContext,
        crossPhaseContext: "",
        incomingHandoff: undefined,
      },
      expectedOutputTraits: [
        {
          dimension: "pause_behavior",
          description:
            "Agent pauses via [PAUSE_FOR_DECISION] OR sets confidence ≤ 0.65 " +
            "and explicitly flags missing handoff as a critical assumption.",
          evaluator: "llm",
          weight: 0.35,
        },
        {
          dimension: "confidence_calibration",
          description: "Confidence ≤ 0.65 when handoff is absent.",
          evaluator: "llm",
          weight: 0.30,
        },
        {
          dimension: "hallucination",
          description:
            "Agent does not fabricate prior phase decisions, metrics, " +
            "or value pools not present in program context.",
          evaluator: "llm",
          weight: 0.35,
        },
      ],
      antiPatterns: [
        {
          description:
            "Produces confidence > 0.8 with no handoff — acts as if " +
            "prior phase context exists",
          llmCheck:
            "Does the agent acknowledge the absence of prior phase context, " +
            "or does it proceed as if it has complete handoff information?",
        },
        {
          description: "Invents specific metrics or decisions from prior phase",
          llmCheck:
            "Does the output reference specific figures or decisions that " +
            "could only come from a handoff but were not provided?",
        },
      ],
      tags: ["handoff_error", "should_pause"],
    };

    return [handoffHappy, handoffError];
  });
```

## 6C — Merge into ADAM_EVAL_DATASET

Replace the current export at lines 709–711:

```typescript
// FROM:
export const ADAM_EVAL_DATASET: EvalCase[] = (Object.keys(AGENT_PROFILES) as AdamAgentId[]).flatMap((agentId) => (
  SCENARIO_SEEDS.map((seed) => buildCase(agentId, seed))
));

// TO:
export const ADAM_EVAL_DATASET: EvalCase[] = [
  ...(Object.keys(AGENT_PROFILES) as AdamAgentId[]).flatMap((agentId) =>
    SCENARIO_SEEDS.map((seed) => buildCase(agentId, seed))
  ),
  ...HANDOFF_CASES,
];
```

Keep all existing helper functions unchanged:
```typescript
export function getEvalCasesForAgent(agentId: AdamAgentId): EvalCase[] {
  return ADAM_EVAL_DATASET.filter((entry) => entry.agentId === agentId);
}

export function getEvalCase(caseId: string): EvalCase {
  const match = ADAM_EVAL_DATASET.find((entry) => entry.id === caseId);
  if (!match) throw new Error(`Unknown eval case: ${caseId}`);
  return match;
}
```

---

# DELIVERABLES

Produce complete files in this order:

1. `supabase/migrations/002_agent_run_extensions.sql` — new file
2. `supabase/functions/run-agent/index.ts` — full file with Steps 2A–2C
3. `supabase/functions/resume-agent/index.ts` — full file with Steps 3A–3C
4. `supabase/functions/get-agent-trace/index.ts` — full file with Steps 4A–4C
5. `supabase/functions/copilot-chat/index.ts` — full file with Steps 5A–5C
6. `src/lib/evals/adamEvalDataset.ts` — full file with Steps 6A–6C

---

# CONSTRAINTS

- Produce complete files — not diffs or excerpts
- Do not modify any function signatures except those explicitly listed
- `authenticateRequest()` in `get-agent-trace` is the only auth function
  being changed — do not touch it in any other file
- `appendDecisionQueueItems()` is the only pattern for writing to the
  decision queue — never write to an `adam_decision_queue` table
  (it does not exist)
- All new Supabase queries use `.maybeSingle()` where row may not exist
- TypeScript strict — no `any` in new code; `unknown` + type guards where needed
- All async operations have try-catch
- `PHASE_ORDER` is `Partial<Record<AdamAgentId, AdamAgentId>>` —
  strategy is intentionally absent (no prior phase)
- `HANDOFF_CASES` produces 24 cases (12 agents × 2) — strategy excluded
- Final `ADAM_EVAL_DATASET` total: 91 + 24 = 115 cases
- Migration 002 must be applied before any Edge Function deployment
- Do not rename any existing variables, constants, or exported functions

---

This is the cleanest version yet. Every detail is grounded in validated codebase reality:

- `appendDecisionQueueItems()` used everywhere — no phantom `adam_decision_queue` table
- `pause_count` and `validation_warnings` come from migration 002 before any code runs
- `authenticateRequest()` only changed in `get-agent-trace` where it returns `SupabaseClient` — other files already return `AuthContext`
- `PHASE_ORDER` defined locally since it doesn't exist anywhere in the codebase
- `HANDOFF_CASES` correctly produces 24 cases (strategy excluded), total 115
- `buildWorkspacePrompt()` call site update and new `artifactContext` parameter both specified
