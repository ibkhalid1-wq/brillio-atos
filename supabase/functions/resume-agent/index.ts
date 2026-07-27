import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { streamClaudeText } from "../_shared/claudeClient.ts";
import { logger } from "../_shared/logger.ts";
import type {
  AgentObservationRecord,
  JsonValue,
  ResumeAgentRequest,
} from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseClient = ReturnType<typeof createClient>;
type ProgramState = Record<string, JsonValue>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

interface AuthContext {
  admin: SupabaseClient;
  ownerId: string | null;
  isService: boolean;
}

async function authenticateRequest(req: Request): Promise<AuthContext> {
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

// Resolve the caller's write access to a program via the membership model. The
// service role and the program owner always have full access; otherwise an
// admin/editor membership row is required. Resume mutates program data, so
// viewers and non-members must be rejected.
async function canWriteProgram(
  auth: AuthContext,
  programOwnerId: string | null,
  programId: string,
): Promise<boolean> {
  if (auth.isService) return true;
  if (!auth.ownerId) return false;
  if (programOwnerId && programOwnerId === auth.ownerId) return true;
  const { data, error } = await auth.admin
    .from("adam_program_members")
    .select("role")
    .eq("program_id", programId)
    .eq("user_id", auth.ownerId)
    .maybeSingle();
  if (error || !data) return false;
  return data.role === "admin" || data.role === "editor";
}

async function logObservation(admin: SupabaseClient, observation: AgentObservationRecord): Promise<void> {
  const { error } = await admin.from("adam_agent_observations").insert({
    run_id: observation.runId,
    program_id: observation.programId,
    agent_id: observation.agentId,
    phase_id: observation.phaseId,
    observation_type: observation.observationType,
    payload: observation.payload ?? null,
    tokens: observation.tokens ?? null,
    latency_ms: observation.latencyMs ?? null,
  });
  if (error) {
    logger.warn("resume_observation_failed", { errorMessage: error.message, runId: observation.runId, programId: observation.programId, agentId: observation.agentId, phaseId: observation.phaseId });
  }
}

async function broadcastStatus(
  admin: SupabaseClient,
  programId: string,
  runId: string,
  agentId: string,
  phaseId: string,
  status: string,
  confidence?: number,
  latestObservationType?: string,
): Promise<void> {
  try {
    await admin.channel(`program-${programId}-agents`).send({
      type: "broadcast",
      event: "agent_status",
      payload: {
        runId,
        agentId,
        phaseId,
        status,
        confidence: confidence ?? null,
        latestObservationType: latestObservationType ?? null,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.warn("resume_broadcast_failed", { errorMessage: error instanceof Error ? error.message : String(error), runId, programId, agentId, phaseId });
  }
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeProgramData(raw: JsonValue | null): ProgramState {
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? { ...(raw as ProgramState) } : {};
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? safeJsonParse<Record<string, unknown>>(match[0], {}) : {};
}

function applyArtifacts(programData: ProgramState, phaseId: string, artifacts: Array<Record<string, unknown>>): ProgramState {
  const next = { ...programData };
  const phaseArtifacts = {
    ...((next.phaseArtifacts as Record<string, Record<string, JsonValue>>) || {}),
  };
  const current = {
    ...(phaseArtifacts[phaseId] || {}),
  };

  for (const artifact of artifacts) {
    const title = typeof artifact.title === "string" ? artifact.title : "Resumed artifact";
    const id = typeof artifact.id === "string"
      ? artifact.id
      : title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || crypto.randomUUID();
    const content = typeof artifact.content === "string" ? artifact.content : "";
    if (!content.trim()) continue;
    current[id] = {
      ...(typeof current[id] === "object" && current[id] !== null ? current[id] as Record<string, JsonValue> : {}),
      title,
      content,
      status: "draft",
      agentDrafted: true,
      agentDraftedAt: new Date().toISOString(),
    };
  }

  phaseArtifacts[phaseId] = current;
  next.phaseArtifacts = phaseArtifacts;
  return next;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const auth = await authenticateRequest(req);
    const { admin } = auth;
    const payload = await req.json() as ResumeAgentRequest;
    if (!payload.runId || !payload.decisionId || !payload.resolution) {
      return jsonResponse({ error: "runId, decisionId, and resolution are required." }, 400);
    }

    const { data: run, error: runError } = await admin
      .from("adam_agent_runs")
      .select("*")
      .eq("id", payload.runId)
      .single();
    if (runError || !run) {
      return jsonResponse({ error: runError?.message || "Run not found." }, 404);
    }
    if (run.status !== "paused") {
      return jsonResponse({ error: "Run is not paused." }, 409);
    }
    if (run.awaiting_decision_id !== payload.decisionId) {
      return jsonResponse({ error: "Decision ID does not match the paused run." }, 409);
    }

    const { data: programRow, error: programError } = await admin
      .from("adam_programs")
      .select("id, owner_id, data")
      .eq("id", run.program_id)
      .single();
    if (programError || !programRow) {
      return jsonResponse({ error: programError?.message || "Program not found." }, 404);
    }

    // Resolving a decision mutates program data, so the caller must have write
    // access (owner/admin/editor). Viewers and non-members are rejected.
    const allowedToWrite = await canWriteProgram(
      auth,
      (programRow.owner_id as string | null) ?? null,
      run.program_id as string,
    );
    if (!allowedToWrite) {
      return jsonResponse({ error: "You do not have permission to resolve decisions for this program." }, 403);
    }

    let programData = normalizeProgramData(programRow.data as JsonValue | null);
    const queue = Array.isArray(programData.decisionQueue) ? [...programData.decisionQueue as JsonValue[]] : [];
    programData.decisionQueue = queue.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      if ((entry as Record<string, JsonValue>).id !== payload.decisionId) return entry;
      return {
        ...(entry as Record<string, JsonValue>),
        status: "resolved",
        resolution: payload.resolution,
        resolvedAt: Date.now(),
        humanNote: payload.humanNote || "",
        modifiedContent: payload.modifiedContent || "",
      };
    });

    await admin
      .from("adam_agent_runs")
      .update({
        status: "running",
        awaiting_decision_id: null,
        error_message: null,
      })
      .eq("id", payload.runId);

    await logObservation(admin, {
      runId: run.id,
      programId: run.program_id,
      agentId: run.agent_id,
      phaseId: run.phase_id,
      observationType: "resume",
      payload: {
        decisionId: payload.decisionId,
        resolution: payload.resolution,
        humanNote: payload.humanNote || "",
      },
    });
    await broadcastStatus(admin, run.program_id, run.id, run.agent_id, run.phase_id, "running", undefined, "resume");

    const inputContext = (run.input_context && typeof run.input_context === "object" && !Array.isArray(run.input_context))
      ? run.input_context as Record<string, JsonValue>
      : {};
    const partialOutput = (run.output && typeof run.output === "object" && !Array.isArray(run.output))
      ? run.output as Record<string, JsonValue>
      : {};
    const partialContent = typeof partialOutput.partialContent === "string" ? partialOutput.partialContent : "";

    const systemPrompt = [
      `You are resuming the AURA ${run.phase_id} phase agent for this program.`,
      "A human resolved your pending decision. Continue from the partial output and complete the task.",
      "Return valid JSON only with this shape:",
      JSON.stringify({
        summary: "2-3 sentence summary",
        reasoningTrace: ["step 1", "step 2"],
        confidence: 0.84,
        artifacts: [{ id: "artifact_id", title: "Artifact", content: "draft text" }],
        decisions: [],
        handoff: {
          fromAgentId: run.agent_id,
          fromPhaseId: run.phase_id,
          toPhaseId: "next_phase",
          completedAt: new Date().toISOString(),
          summary: "handoff summary",
          keyDecisions: ["..."],
          artifactIds: ["artifact_id"],
          openQuestions: [],
          confidence: 0.84,
          recommendedNextAction: "Move to next phase",
        },
      }),
    ].join("\n\n");

    const userPrompt = [
      `Stored context: ${JSON.stringify(inputContext)}`,
      partialContent ? `Partial output before pause:\n${partialContent}` : "",
      `The human has resolved the pending decision: ${payload.resolution}. Note: ${payload.humanNote || "No additional note provided."}`,
      payload.modifiedContent ? `Modified content from the human:\n${payload.modifiedContent}` : "",
      "Continue and complete the run.",
    ].filter(Boolean).join("\n\n");

    await logObservation(admin, {
      runId: run.id,
      programId: run.program_id,
      agentId: run.agent_id,
      phaseId: run.phase_id,
      observationType: "prompt_sent",
      payload: {
        resumed: true,
        userPromptLength: userPrompt.length,
      },
    });

    const claudeResult = await streamClaudeText({
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1400,
      temperature: 0.2,
    });

    await logObservation(admin, {
      runId: run.id,
      programId: run.program_id,
      agentId: run.agent_id,
      phaseId: run.phase_id,
      observationType: "response_received",
      payload: { preview: claudeResult.text.slice(0, 300) },
      tokens: claudeResult.inputTokens + claudeResult.outputTokens,
      latencyMs: claudeResult.latencyMs,
    });

    const parsed = parseJsonObject(claudeResult.text);
    const artifacts = Array.isArray(parsed.artifacts)
      ? parsed.artifacts.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      : [];

    programData = applyArtifacts(programData, run.phase_id, artifacts);
    programData.agentServerMemory = [
      ...((Array.isArray(programData.agentServerMemory) ? programData.agentServerMemory : []) as JsonValue[]),
      {
        agentId: run.agent_id,
        phaseId: run.phase_id,
        timestamp: new Date().toISOString(),
        type: "decision",
        summary: `Human resolved paused decision as ${payload.resolution}.`,
        outcome: payload.resolution,
        learningNote: payload.humanNote || "",
      },
    ].slice(-20);

    const handoff = (parsed.handoff && typeof parsed.handoff === "object" && !Array.isArray(parsed.handoff))
      ? parsed.handoff as Record<string, JsonValue>
      : null;
    if (handoff) {
      const toPhaseId = typeof handoff.toPhaseId === "string" ? handoff.toPhaseId : "";
      programData.phaseHandoffs = {
        ...((programData.phaseHandoffs as Record<string, JsonValue>) || {}),
        [run.phase_id]: handoff,
      };
      if (toPhaseId) {
        programData.phaseIncomingHandoffs = {
          ...((programData.phaseIncomingHandoffs as Record<string, JsonValue>) || {}),
          [toPhaseId]: handoff,
        };
      }
    }

    const { error: programUpdateError } = await admin
      .from("adam_programs")
      .update({
        data: programData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.program_id);
    if (programUpdateError) {
      throw new Error(programUpdateError.message);
    }

    const { error: runUpdateError } = await admin
      .from("adam_agent_runs")
      .update({
        status: "complete",
        output: parsed as JsonValue,
        handoff: (handoff || null) as JsonValue | null,
        reasoning_trace: Array.isArray(parsed.reasoningTrace)
          ? parsed.reasoningTrace.filter((entry): entry is string => typeof entry === "string")
          : null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
        tokens_used: claudeResult.inputTokens + claudeResult.outputTokens,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    if (runUpdateError) {
      throw new Error(runUpdateError.message);
    }

    await broadcastStatus(
      admin,
      run.program_id,
      run.id,
      run.agent_id,
      run.phase_id,
      "complete",
      typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      handoff ? "handoff_created" : "response_received",
    );

    return jsonResponse({
      status: "complete",
      runId: run.id,
      output: parsed,
      handoff: handoff || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
