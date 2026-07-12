# ADAM — Corrected Targeted Fix Prompt (Validation-Verified)

You are a senior Deno + TypeScript engineer. Every fix below has been
validated against the actual codebase. Variable names, line numbers,
function signatures, and table names are exact. Do not deviate from
the patterns already established in each file.

Base path: /Users/Ibrahim.Khalid/Documents/Claude/Projects/Twenty crm test/
           brillio-atlas-codex/

---

## MIGRATION FIRST — New Schema Columns

Before touching any Edge Function, apply this migration:

**File:** `supabase/migrations/002_agent_run_extensions.sql`

```sql
-- Add pause tracking to agent runs
alter table adam_agent_runs
  add column if not exists pause_count integer not null default 0,
  add column if not exists validation_warnings jsonb;

-- Add artifact table for copilot context injection
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

-- RLS
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

## FIX 1 — Schema Validation on Agent Output
**File:** `supabase/functions/run-agent/index.ts`
**Insert after:** line 695 (`const parsed = parseAgentPayload(...)`)

The decision queue in ADAM lives in `programData.decisionQueue` (JSONB
in `adam_programs.data`), managed via the existing `appendDecisionQueueItems()`
function at line 368. All fixes use this pattern — not a separate table.

Add this function anywhere above the main handler (e.g. after line 230):

```typescript
function validateAgentOutput(
  agentId: string,
  output: ParsedAgentPayload,
): string[] {
  const errors: string[] = [];

  // Universal required fields
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

  // Agent-specific required artifact fields
  const agentArtifactRequirements: Record<string, string[]> = {
    strategy: ["transformationThesis", "desiredOutcomes", "valueHypothesis",
                "criticalAssumptions", "riskFlags"],
    mobilise: ["orgReadinessScore", "governanceStructure", "commsPlan",
                "stakeholderMap", "blockers"],
    discover: ["opportunities", "businessCases", "valuePoolMap"],
    design: ["capabilities", "autonomyRecommendations", "workforceImpact"],
    agent_arch: ["agentBlueprints", "toolRequirements", "escalationPolicies"],
    build: ["buildPackages", "testingStrategy", "deploymentTargets"],
    operate: ["governanceControls", "hitlPolicies", "complianceChecks"],
    govern: ["auditFramework", "complianceScore", "controlGaps"],
    optimize: ["valueLeakage", "optimizationOpportunities", "maturityScore"],
    valuerealize: ["valueDelivered", "lessonsLearned", "nextCycleRecommendations"],
    delivery: ["raidLog", "phaseStatus", "milestones"],
    adoption: ["adoptionRate", "championNetwork", "trainingCompletion"],
    titan: ["outcomePrediction", "confidenceInterval", "scenarioModels"],
  };

  // Check first artifact's content for required fields (agent outputs
  // embed structured data inside the first artifact's content as JSON)
  if (output.artifacts.length > 0) {
    try {
      const artifactContent = JSON.parse(output.artifacts[0].content || "{}");
      const required = agentArtifactRequirements[agentId] ?? [];
      for (const field of required) {
        if (!(field in artifactContent) ||
            artifactContent[field] === null ||
            artifactContent[field] === undefined) {
          errors.push(`Artifact missing required field for ${agentId}: ${field}`);
        }
      }
    } catch {
      errors.push("First artifact content is not valid JSON");
    }
  } else {
    errors.push("Agent produced no artifacts");
  }

  return errors;
}
```

Then insert after line 695:
```typescript
const parsed = parseAgentPayload(claudeResult.text, request.phaseId, request.agentId);

// — INSERT HERE —
const schemaErrors = validateAgentOutput(request.agentId, parsed);
if (schemaErrors.length > 0) {
  await logObservation(auth.admin, {
    runId,
    programId: request.programId,
    agentId: request.agentId,
    phaseId: request.phaseId,
    observationType: "error",
    payload: {
      type: "schema_validation_failed",
      errors: schemaErrors,
    },
  });
}
// Store warnings on run record (non-blocking — run still completes)
// validation_warnings column added in migration 002
```

Then in the final `.update()` call at line ~751, add `validation_warnings`:
```typescript
await auth.admin
  .from("adam_agent_runs")
  .update({
    status: "complete",
    output: { ... } as JsonValue,          // existing fields unchanged
    handoff: (handoff || null) as JsonValue | null,
    reasoning_trace: parsed.reasoningTrace,
    confidence: parsed.confidence,
    tokens_used: claudeResult.inputTokens + claudeResult.outputTokens,
    completed_at: new Date().toISOString(),
    awaiting_decision_id: null,
    validation_warnings: schemaErrors.length > 0         // ADD THIS LINE
      ? schemaErrors as unknown as JsonValue
      : null,
  })
  .eq("id", runId);
```

---

## FIX 2 — Confidence Floor Enforcement
**File:** `supabase/functions/run-agent/index.ts`
**Insert after:** schema validation block (Fix 1), before the artifacts
persistence loop

The decision queue item uses `appendDecisionQueueItems()` which appends
to `programData.decisionQueue` (the existing pattern in this file).
The `pause_count` column is added in migration 002.

```typescript
// Confidence floor — auto-pause if critical phase output is below threshold
const CONFIDENCE_FLOOR = 0.5;
const CRITICAL_PHASES = new Set(["strategy", "design", "agent_arch", "govern"]);

if (
  typeof parsed.confidence === "number" &&
  parsed.confidence < CONFIDENCE_FLOOR &&
  CRITICAL_PHASES.has(request.phaseId) &&
  schemaErrors.length === 0   // only enforce floor if schema is valid
) {
  const decisionId = crypto.randomUUID();

  // Append to programData.decisionQueue (existing pattern)
  const updatedProgramData = appendDecisionQueueItems(programData, [{
    id: decisionId,
    type: "agent_clarification",
    priority: "high",
    title: `${request.agentId} agent confidence too low to proceed`,
    question:
      `The ${request.agentId} agent completed with ` +
      `${Math.round(parsed.confidence * 100)}% confidence — ` +
      `below the ${CONFIDENCE_FLOOR * 100}% threshold for critical phases. ` +
      `Review the output and either approve to continue or provide ` +
      `additional context for a re-run.`,
    options: ["Approve and proceed", "Provide more context and re-run"],
    runId,
    agentId: request.agentId,
    phaseId: request.phaseId,
    createdAt: new Date().toISOString(),
  }]);

  // Persist updated program data
  await auth.admin
    .from("adam_programs")
    .update({ data: updatedProgramData as JsonValue })
    .eq("id", request.programId);

  // Update run to paused with pause_count increment
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
    { headers: { "Content-Type": "application/json" } }
  );
}
```

---

## FIX 3 — Multi-Pause Guard
**File:** `supabase/functions/resume-agent/index.ts`
**Insert after:** line 165 (after the `awaiting_decision_id` validation)

The `run` variable (loaded at line 153) holds the full run record.
The `pause_count` column is added in migration 002.

```typescript
// After line 165: if (run.awaiting_decision_id !== payload.decisionId) { ... }

// Guard against cascading pauses — cap at 3 per run
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

Then in the run status update at line ~192–199, increment `pause_count`:
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

---

## FIX 4 — Token Accumulation Across Pauses
**File:** `supabase/functions/resume-agent/index.ts`
**Change:** line 343 inside the final `.update()` call

The `run` variable already holds the original run record (loaded at line 153).
`run.tokens_used` contains tokens from before the pause.

Change line 343 from:
```typescript
tokens_used: claudeResult.inputTokens + claudeResult.outputTokens,
```

To:
```typescript
tokens_used: ((run.tokens_used as number | null) ?? 0) +
             claudeResult.inputTokens +
             claudeResult.outputTokens,
```

No other changes needed — `run` is already in scope, `claudeResult` is
already in scope.

---

## FIX 5 — Ownership Check in get-agent-trace
**File:** `supabase/functions/get-agent-trace/index.ts`

`authenticateRequest()` in this file (lines 38–52) returns only
`SupabaseClient` — userId is validated but discarded. Unlike `run-agent`,
this file does NOT use the `AuthContext` pattern.

**Step 1:** Update `authenticateRequest()` in this file only:

```typescript
// Change return type from Promise<SupabaseClient> to:
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

**Step 2:** Update call site (where `authenticateRequest` result is used):

Find the existing: `const admin = await authenticateRequest(req);`
Replace with: `const { admin, ownerId, isService } = await authenticateRequest(req);`

**Step 3:** Add ownership check after the run fetch (after line ~84):

```typescript
const { data: run, error: runError } = await admin
  .from("adam_agent_runs")
  .select("*")
  .eq("id", runId)
  .single();
if (runError || !run) {
  return jsonResponse({ error: runError?.message || "Run not found." }, 404);
}

// — INSERT HERE —
// Ownership check — service role bypasses, users must own the program
if (!isService && ownerId !== run.owner_id) {
  return jsonResponse({ error: "Access denied." }, 403);
}
```

---

## FIX 6 — Schedule Idempotency
**File:** `supabase/functions/run-agent/index.ts`
**Note:** Idempotency belongs in run-agent (where runs are created),
NOT schedule-agent (which only calls run-agent via HTTP).

Find where the run record is first created in `adam_agent_runs`
(look for `.insert(` on the `adam_agent_runs` table — likely in the
early handler setup). Add a duplicate guard before that insert:

```typescript
// Before inserting new run record — check for recent duplicate
// Prevents duplicate runs if scheduler fires twice in the same window
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
      { headers: { "Content-Type": "application/json" } }
    );
  }
}
```

---

## FIX 7 — Copilot Phase Artifact Injection
**File:** `supabase/functions/copilot-chat/index.ts`
**Depends on:** migration 002 (`adam_program_artifacts` table)

The system prompt is built in `buildWorkspacePrompt()` at lines 74–90.
`programId` is available as `payload.programId` at the call site (~line 151).

Because artifact fetching requires async and `buildWorkspacePrompt()` is
synchronous, fetch artifacts before calling the function and pass them in:

**Step 1:** Add artifact fetcher function:
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

    const joined = "\n\nAPPROVED ARTIFACTS:\n" + lines.join("\n");
    return joined.slice(0, maxChars);
  } catch {
    return ""; // non-blocking — copilot still works without artifacts
  }
}
```

**Step 2:** Update `buildWorkspacePrompt()` signature to accept artifact context:
```typescript
function buildWorkspacePrompt(
  workspaceId: string,
  programContext: Record<string, JsonValue>,
  summary: string | null,
  artifactContext: string,   // ADD THIS PARAMETER
): string {
  // ... existing identity logic unchanged ...

  return [
    `You are ADAM Copilot acting as the ${identity} for the "${workspaceId}" workspace.`,
    `Program name: ${String(programContext.programName || "Untitled Program")}`,
    `Program objective: ${String(programContext.programObjective || "")}`,
    summary ? `Thread summary: ${summary}` : "",
    artifactContext,           // ADD THIS LINE
    "Be concise, specific, and action-oriented.",
  ].filter(Boolean).join("\n\n");
}
```

**Step 3:** At the call site (~line 151), fetch artifacts first:
```typescript
// Before building system prompt:
const artifactContext = await fetchApprovedArtifactContext(
  admin,
  payload.programId,
);

// Then pass to buildWorkspacePrompt:
const systemPrompt = buildWorkspacePrompt(
  payload.workspaceId,
  programContext,
  thread.summary,
  artifactContext,     // ADD THIS ARGUMENT
);
```

---

## FIX 8 — Handoff Continuity Eval Cases
**File:** `src/lib/evals/adamEvalDataset.ts`

Current structure: `ADAM_EVAL_DATASET` is a flat `EvalCase[]` built by
`flatMap` over `SCENARIO_SEEDS × AGENT_PROFILES`. The 26 new handoff
cases are added as a separate constant appended to the export.

**Step 1:** At the end of the file, after `ADAM_EVAL_DATASET` declaration:

```typescript
// Handoff continuity cases — tests cross-phase context passing
// 2 cases per agent: handoff_001 (valid handoff) + handoff_002 (missing handoff)
// Total: 26 cases. Grand total: 91 + 26 = 117

const PHASE_ORDER: Record<string, string> = {
  mobilise:    "strategy",
  discover:    "mobilise",
  design:      "discover",
  agent_arch:  "design",
  build:       "agent_arch",
  operate:     "build",
  govern:      "operate",
  optimize:    "govern",
  valuerealize: "optimize",
  delivery:    "build",
  adoption:    "mobilise",
  titan:       "discover",
};

const HANDOFF_CASES: EvalCase[] = (
  Object.keys(AGENT_PROFILES) as AdamAgentId[]
).flatMap((agentId) => {
  const priorPhaseId = PHASE_ORDER[agentId];

  // strategy has no prior phase — skip handoff cases for it
  if (!priorPhaseId) return [];

  const baseContext = AGENT_PROFILES[agentId].seedContext;

  const happyHandoff: AgentHandoff = {
    fromAgentId: priorPhaseId,
    fromPhaseId: priorPhaseId,
    toPhaseId: agentId,
    completedAt: "2026-03-15T09:00:00Z",
    summary:
      `The ${priorPhaseId} phase completed with 87% confidence. ` +
      `Key outputs include a confirmed transformation thesis, ` +
      `three measurable business outcomes with named owners, ` +
      `and a prioritised value pool totalling £4.2M over 18 months.`,
    keyDecisions: [
      `Scope confirmed: agent-assisted processing only, no autonomous decisions`,
      `Primary value pool: operational efficiency (£2.8M)`,
      `Delivery timeline: 14 months with quarterly value gates`,
    ],
    artifactIds: [`${priorPhaseId}_brief_v1`, `${priorPhaseId}_outcomes_v1`],
    openQuestions: [
      `Regulatory approval pathway for AI-assisted outputs not yet confirmed`,
    ],
    confidence: 0.87,
    recommendedNextAction:
      `Proceed to ${agentId} phase. Prioritise validating the £2.8M ` +
      `efficiency hypothesis before designing capabilities.`,
  };

  const handoffHappy: EvalCase = {
    id: `${agentId}_handoff_001`,
    agentId,
    name: `Handoff continuity — valid upstream artifacts (${agentId})`,
    description:
      `Agent receives a well-formed handoff from the ${priorPhaseId} phase. ` +
      `Output must reference, build on, and be consistent with prior decisions.`,
    input: {
      programContext: baseContext,
      crossPhaseContext:
        `Prior phase (${priorPhaseId}) approved outputs:\n` +
        `- Transformation thesis: Agent-assisted ${baseContext.industry ?? "enterprise"} ` +
        `operations reducing manual processing by 60% within 14 months.\n` +
        `- Confirmed value pools: operational efficiency £2.8M, ` +
        `risk reduction £0.9M, customer experience £0.5M.\n` +
        `- Executive sponsor confirmed: Chief Operating Officer.\n` +
        `- Key constraint: all agent outputs require human sign-off ` +
        `for regulatory submissions.`,
      incomingHandoff: happyHandoff,
    },
    expectedOutputTraits: [
      {
        dimension: "consistency",
        description:
          `Output explicitly references at least 2 items from the ` +
          `incoming handoff (decisions, value pools, or open questions). ` +
          `Does not contradict prior phase decisions.`,
        evaluator: "llm",
        weight: 0.30,
      },
      {
        dimension: "accuracy",
        description:
          `Output does not invent facts not present in the program ` +
          `context or incoming handoff.`,
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
          `Recommendations are specific to the program context and ` +
          `handoff content — not generic advice.`,
        evaluator: "llm",
        weight: 0.15,
      },
      {
        dimension: "confidence_calibration",
        description:
          `Confidence is appropriate (≥ 0.75) given well-formed inputs.`,
        evaluator: "llm",
        weight: 0.15,
      },
    ],
    antiPatterns: [
      {
        description:
          `Output ignores handoff — could have been produced without ` +
          `any prior phase context`,
        llmCheck:
          `Does the output contain specific references to the incoming ` +
          `handoff content (value pools, decisions, open questions), or ` +
          `does it appear to have been written from scratch?`,
      },
      {
        description: "Contradicts a decision made in the prior phase",
        llmCheck:
          `Does the output contradict any of the key decisions stated ` +
          `in the handoff (scope, value pools, timeline, constraints)?`,
      },
    ],
    tags: ["handoff_happy"],
  };

  const handoffError: EvalCase = {
    id: `${agentId}_handoff_002`,
    agentId,
    name: `Handoff continuity — missing handoff (${agentId})`,
    description:
      `Agent receives no handoff from prior phase. Should pause to ` +
      `request context OR proceed with ≤ 0.65 confidence and explicit ` +
      `assumptions flagged. Must NOT produce high-confidence output ` +
      `as if prior context exists.`,
    input: {
      programContext: baseContext,
      crossPhaseContext: "",
      incomingHandoff: undefined,
    },
    expectedOutputTraits: [
      {
        dimension: "pause_behavior",
        description:
          `Agent either outputs [PAUSE_FOR_DECISION] requesting prior ` +
          `phase context, OR explicitly flags the missing handoff as a ` +
          `critical assumption and sets confidence ≤ 0.65.`,
        evaluator: "llm",
        weight: 0.35,
      },
      {
        dimension: "confidence_calibration",
        description: "Confidence is ≤ 0.65 when handoff is absent.",
        evaluator: "llm",
        weight: 0.30,
      },
      {
        dimension: "hallucination",
        description:
          `Agent does not fabricate prior phase decisions, metrics, ` +
          `or value pools that were not in the program context.`,
        evaluator: "llm",
        weight: 0.35,
      },
    ],
    antiPatterns: [
      {
        description:
          `Produces confidence > 0.8 with no handoff — acts as if ` +
          `prior phase context is available`,
        llmCheck:
          `Does the agent acknowledge the absence of prior phase context, ` +
          `or does it proceed as if it has complete handoff information?`,
      },
      {
        description: "Invents specific metrics or decisions from prior phase",
        llmCheck:
          `Does the output reference specific figures, decisions, or ` +
          `outcomes that could only come from a prior phase handoff ` +
          `but were not provided in the program context?`,
      },
    ],
    tags: ["handoff_error", "should_pause"],
  };

  return [handoffHappy, handoffError];
});

// Merge handoff cases into the main dataset export
export const ADAM_EVAL_DATASET: EvalCase[] = [
  ...(/* existing dataset generation */),
  ...HANDOFF_CASES,
];
```

**Note:** Replace the existing `export const ADAM_EVAL_DATASET` declaration
with the merged version above. Keep all existing generation logic
(`SCENARIO_SEEDS.map(...)`) intact — just spread `HANDOFF_CASES` at the end.

Update the helper functions to cover new cases:
```typescript
export function getEvalCasesForAgent(agentId: AdamAgentId): EvalCase[] {
  return ADAM_EVAL_DATASET.filter((c) => c.agentId === agentId);
}

export function getEvalCase(caseId: string): EvalCase | undefined {
  return ADAM_EVAL_DATASET.find((c) => c.id === caseId);
}
```

---

## DELIVERABLES — In This Order

1. `supabase/migrations/002_agent_run_extensions.sql`
   — New columns + adam_program_artifacts table (run this first)

2. `supabase/functions/run-agent/index.ts`
   — Add: `validateAgentOutput()` (Fix 1) + confidence floor (Fix 2) +
     schedule idempotency (Fix 6) + `validation_warnings` in final update

3. `supabase/functions/resume-agent/index.ts`
   — Add: multi-pause guard (Fix 3) + `pause_count` increment +
     token accumulation (Fix 4)

4. `supabase/functions/get-agent-trace/index.ts`
   — Update: `authenticateRequest()` return type + ownership check (Fix 5)

5. `supabase/functions/copilot-chat/index.ts`
   — Add: `fetchApprovedArtifactContext()` + update `buildWorkspacePrompt()`
     signature + pass artifact context at call site (Fix 7)

6. `src/lib/evals/adamEvalDataset.ts`
   — Add: `HANDOFF_CASES` + merge into `ADAM_EVAL_DATASET` (Fix 8)
   — Keep all 91 existing cases intact

---

## CONSTRAINTS

- Produce complete files — not diffs or excerpts
- Do not change any function signatures that existing code depends on
  (exception: `authenticateRequest` in get-agent-trace only — it is
  only called within that file)
- All new Supabase queries must guard against null (`.maybeSingle()`
  not `.single()` where row may not exist)
- TypeScript strict — no `any` in new code; use `unknown` + type guards
- All new async operations wrapped in try-catch
- The `appendDecisionQueueItems()` pattern (JSONB in adam_programs.data)
  must be used for all decision queue writes — never a separate table
- Eval cases must use exact field names from `EvalCase`, `ExpectedTrait`,
  `AntiPattern`, and `AgentHandoff` interfaces as validated above
- `tags` field is `string[]` — no union type to worry about
- `incomingHandoff` is typed `AgentHandoff | undefined` (optional field)
- Do not modify `SCENARIO_SEEDS` or `AGENT_PROFILES` — handoff cases
  are appended separately

---

This prompt is fully grounded in the actual codebase:

- All variable names exact (`parsed`, `run`, `claudeResult`, `auth.admin`)
- All line numbers confirmed
- Decision queue correctly targets `appendDecisionQueueItems()` / JSONB pattern
- `pause_count` column created via migration before use
- `adam_program_artifacts` table created before copilot injection
- `authenticateRequest()` only changed in `get-agent-trace` where it's locally scoped
- Idempotency moved to `run-agent` where runs are actually created
- Eval interface types verified verbatim
