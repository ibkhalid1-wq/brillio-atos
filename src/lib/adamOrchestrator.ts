import {
  AGENT_REGISTRY,
  type AgentId,
  type AgentResult,
  type OrchestrationTrace,
  type OrchestratorDecision,
} from "@/lib/adamAgents";
import { requestAIText } from "@/lib/adamCopilot";
import { buildMemoryContext, saveAgentMemory } from "@/lib/adamAgentMemory";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import type { AgentHandoff, AgentRunResponse } from "@/lib/adamSync";
import { normalizeProgram, type ProgramRowLike } from "@/new/lib/programData";
import { buildProgramGraphContext } from "@/v3/lib/programGraph";
import { buildCoverageDirectives } from "@/v3/lib/graphInference";
import { getPhaseSequence } from "@/v3/lib/methodology";

type RequestMode = {
  mode: string;
  responseInstructions: string;
  maxWords: number;
};

type OrchestrationOptions = {
  programId?: string;
  phaseId?: string;
};

type PhaseAgentRunParams = {
  programId: string;
  agentId: string;
  phaseId: string;
  triggeredBy: "user" | "trigger" | "schedule" | "handoff" | "proactive";
  triggerEvent?: string;
  incomingHandoff?: AgentHandoff | null;
  runId?: string;
  crossPhaseContext?: string;
  decisionId?: string;
  documentId?: string;
  docText?: string;
  audienceGroup?: "executive" | "operational" | "all";
  meetingDate?: string;
  meetingDurationMins?: number;
  signal?: AbortSignal;
  // Wall-clock budget for the actual HTTP call. The timer starts when the call
  // leaves the serialization queue and fires, NOT when it is enqueued — otherwise
  // time spent waiting behind another queued call would eat into the budget.
  timeoutMs?: number;
};

type StoredProject = {
  id?: string;
  data?: {
    phaseArtifacts?: Record<string, Record<string, StoredArtifact>>;
  };
};

type StoredArtifact = {
  title?: string;
  label?: string;
  status?: string;
  content?: unknown;
};

type StoredPhaseAgentState = {
  lastDraftConfidence?: number;
  rejectionCount?: number;
  lastRejectionReason?: string | null;
};

const ROUTING_FALLBACK: OrchestratorDecision = {
  agents: ["coach"] as AgentId[],
  parallel: true,
  reasoning: "fallback",
};

const PROJECTS_STORAGE_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"];
const PHASE_AGENT_EVENT = "adam:phase-agent-event";
// The phase spine comes from the programme's methodology (getPhaseSequence) —
// a hardcoded classic sequence here silently zeroed flow programmes' context.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function loadStoredProject(programId: string): StoredProject | null {
  if (!programId || typeof localStorage === "undefined") return null;
  for (const key of PROJECTS_STORAGE_KEYS) {
    const projects = safeJsonParse<unknown[]>(localStorage.getItem(key), []);
    const match = projects.find((entry) => isRecord(entry) && entry.id === programId);
    if (match && isRecord(match)) {
      return match as StoredProject;
    }
  }
  return null;
}

function summarizeArtifactContent(content: unknown): string {
  if (typeof content === "string") {
    const cleaned = content.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2);
    return sentences.join(" ").slice(0, 260);
  }
  if (Array.isArray(content)) {
    return content.map((item) => String(item)).join(", ").slice(0, 260);
  }
  if (isRecord(content)) {
    return JSON.stringify(content).slice(0, 260);
  }
  return String(content ?? "").slice(0, 260);
}

function readPhaseAgentState(programId: string, phaseId: string): StoredPhaseAgentState {
  if (!programId || !phaseId || typeof localStorage === "undefined") return {};
  return safeJsonParse<StoredPhaseAgentState>(
    localStorage.getItem(`adam_phase_agent_${programId}_${phaseId}`),
    {},
  );
}

function writePhaseAgentState(programId: string, phaseId: string, nextState: StoredPhaseAgentState): void {
  if (!programId || !phaseId || typeof localStorage === "undefined") return;
  const storageKey = `adam_phase_agent_${programId}_${phaseId}`;
  const current = safeJsonParse<Record<string, unknown>>(localStorage.getItem(storageKey), {});
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...current, ...nextState }));
  } catch {
    return;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PHASE_AGENT_EVENT, {
      detail: {
        sourcePhaseId: phaseId,
        eventType: "state_updated_externally",
        timestamp: Date.now(),
      },
    }));
  }
}

export function buildOrchestratorSystemPrompt(): string {
  const agentList = Object.values(AGENT_REGISTRY)
    .map((agent) => `- ${agent.id}: ${agent.description}`)
    .join("\n");

  return `You are the ATOS Copilot Orchestrator. Select the minimum specialist agents to answer a user message accurately.

Available agents:
${agentList}

Rules:
- Select 1 agent for single-domain questions (most cases)
- Select 2–3 agents maximum for genuinely cross-domain questions
- Set parallel:true unless agent B truly needs agent A's output first
- Use coach for how-to/explain questions
- Return valid JSON only — no markdown, no explanation

Format: {"agents":["agentId"],"parallel":true,"reasoning":"one sentence"}`;
}

export function buildCrossPhaseContext(programId: string, targetPhaseId: string, maxChars = 1200): string {
  const project = loadStoredProject(programId);
  if (!project) return "";
  // The spine is the PROGRAMME'S OWN methodology — the hardcoded classic
  // sequence made indexOf("frame") = -1, so every flow phase silently got an
  // EMPTY cross-phase context (design-review rec 3: methodology is data, one
  // derivation path).
  const projectData = (project.data ?? {}) as Record<string, unknown>;
  const methodology = typeof projectData.methodology === "string" ? projectData.methodology : "atos-standard";
  const sequence = getPhaseSequence(methodology as Parameters<typeof getPhaseSequence>[0]) as readonly string[];
  const phaseIndex = sequence.indexOf(targetPhaseId);
  if (phaseIndex <= 0) return "";

  const sections: string[] = [];

  // Highest-signal first: approved-artifact summaries from prior phases.
  const phaseArtifacts = project.data?.phaseArtifacts;
  if (phaseArtifacts) {
    const lines: string[] = ["Prior phase context:"];
    outer: for (const phaseId of sequence.slice(0, phaseIndex)) {
      const artifacts = Object.entries(phaseArtifacts[phaseId] ?? {})
        .filter(([, artifact]) => artifact?.status === "approved");
      for (const [artifactId, artifact] of artifacts) {
        const title = artifact?.title || artifact?.label || artifactId;
        const summary = summarizeArtifactContent(artifact?.content);
        if (!summary) continue;
        const candidate = `${phaseId}: ${title} — ${summary}`;
        if ([...lines, candidate].join("\n").length > maxChars) break outer;
        lines.push(candidate);
      }
    }
    if (lines.length > 1) sections.push(lines.join("\n"));
  }

  // The structured graph slice adds the facts, open risks/decisions and KPIs the
  // artifact prose alone never surfaces — within whatever budget remains so the
  // two sections together never exceed maxChars.
  const used = sections.reduce((sum, section) => sum + section.length + 2, 0);
  const remaining = maxChars - used;
  if (remaining > 120) {
    const program = normalizeProgram({ id: project.id ?? programId, name: "", data: project.data } as ProgramRowLike);
    const graphContext = buildProgramGraphContext(program, targetPhaseId, remaining);
    if (graphContext) sections.push(graphContext);

    // Coverage-gap directives tell the generator what to *close*, not just what
    // exists — capped to whatever budget the grounding context left behind.
    const usedAfterGraph = sections.reduce((sum, section) => sum + section.length + 2, 0);
    const directiveBudget = maxChars - usedAfterGraph;
    if (directiveBudget > 80) {
      const directives = buildCoverageDirectives(program, targetPhaseId, directiveBudget);
      if (directives) sections.push(directives);
    }
  }

  return sections.join("\n\n");
}

export async function routeToAgents(
  userMsg: string,
  activeView: string,
  ambientContext: string,
  requestMode: RequestMode,
): Promise<OrchestratorDecision> {
  try {
    const orchestratorSystem = buildOrchestratorSystemPrompt();
    const userContent = `Phase: ${activeView}\nMode: ${requestMode.mode}\nMessage: ${userMsg.slice(0, 400)}\nContext summary: ${ambientContext.slice(0, 600)}`;
    const raw = await requestAIText(orchestratorSystem, userContent, {
      max_tokens: 200,
      description: "orchestrator-routing",
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < start) return ROUTING_FALLBACK;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<OrchestratorDecision>;
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0 || typeof parsed.parallel !== "boolean") {
      return ROUTING_FALLBACK;
    }
    const validAgents = parsed.agents.filter(
      (agentId): agentId is AgentId => typeof agentId === "string" && agentId in AGENT_REGISTRY,
    ).slice(0, 3);
    if (!validAgents.length) return ROUTING_FALLBACK;
    return {
      agents: validAgents,
      parallel: parsed.parallel,
      reasoning: typeof parsed.reasoning === "string" && parsed.reasoning.trim() ? parsed.reasoning : "routed",
    };
  } catch {
    return ROUTING_FALLBACK;
  }
}

export async function dispatchAgent(
  agentId: AgentId,
  userMsg: string,
  ambientContext: string,
  requestMode: { responseInstructions: string },
  priorContent?: string,
  options: OrchestrationOptions = {},
): Promise<AgentResult> {
  const def = AGENT_REGISTRY[agentId];
  const startMs = Date.now();
  try {
    const memoryContext = options.programId ? buildMemoryContext(agentId, options.programId) : "";
    const crossPhaseContext = options.programId && options.phaseId
      ? buildCrossPhaseContext(options.programId, options.phaseId)
      : "";
    const system = [
      memoryContext,
      crossPhaseContext,
      def.systemPromptAddendum,
      `---PROGRAM CONTEXT---\n${ambientContext}`,
      requestMode.responseInstructions,
    ].filter(Boolean).join("\n\n");
    const user = `${priorContent ? `Prior analysis:\n${priorContent}\n\n` : ""}User: ${userMsg}`;
    const content = await requestAIText(system, user, {
      max_tokens: def.maxTokens,
      description: `agent-${agentId}`,
    });
    return { agentId, content, durationMs: Date.now() - startMs };
  } catch (error) {
    return {
      agentId,
      content: "",
      durationMs: Date.now() - startMs,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

export async function synthesizeAgentResults(
  results: AgentResult[],
  userMsg: string,
  requestMode: { responseInstructions: string },
): Promise<string> {
  const validResults = results.filter((result) => result.content && !result.error);
  if (validResults.length <= 1) return validResults[0]?.content ?? "";

  const system = `You are merging ${validResults.length} specialist analyses into a single coherent Copilot response.
Contributing agents: ${validResults.map((result) => result.agentId).join(", ")}
Rules: eliminate redundancy; preserve all unique insights and specific data points; use natural prose structure — not a list of agent outputs; do not mention agents or orchestration; ${requestMode.responseInstructions}`;
  const user = `${validResults.map((result) => `[${result.agentId}]:\n${result.content}`).join("\n\n---\n\n")}\n\nUser question: ${userMsg}`;

  try {
    return await requestAIText(system, user, { max_tokens: 1400, description: "synthesizer" });
  } catch {
    return validResults[0]?.content ?? "";
  }
}

export function recordAgentFeedback(
  agentId: string,
  phaseId: string,
  programId: string,
  artifactId: string,
  action: "accepted" | "rejected" | "modified",
  humanNote?: string,
): void {
  void (async () => {
    const currentState = readPhaseAgentState(programId, phaseId);
    let learningNote = "";

    if (action === "rejected" && humanNote?.trim()) {
      try {
        learningNote = (await requestAIText(
          "You are summarizing one improvement the agent should make next time.",
          `Given this artifact was rejected with note: ${humanNote}\nIn one sentence, what should the agent do differently next time?`,
          { max_tokens: 80, description: `agent-feedback-${agentId}` },
        )).trim();
      } catch {
        learningNote = "";
      }
    }

    saveAgentMemory({
      agentId,
      phaseId,
      programId,
      timestamp: new Date().toISOString(),
      type: "artifact_outcome",
      summary: `Artifact ${artifactId} in ${phaseId} was ${action}${humanNote ? ` — ${humanNote}` : ""}.`,
      outcome: action,
      confidence: Number(currentState.lastDraftConfidence ?? 0.5),
      learningNote: learningNote || undefined,
    });

    if (action === "rejected") {
      writePhaseAgentState(programId, phaseId, {
        rejectionCount: Number(currentState.rejectionCount ?? 0) + 1,
        lastRejectionReason: humanNote?.trim() || "Artifact rejected during review.",
      });
    }
  })();
}

export async function orchestrateCopilotAgents(
  userMsg: string,
  activeView: string,
  ambientContext: string,
  requestMode: { mode: string; responseInstructions: string; maxWords: number },
  options: OrchestrationOptions = {},
): Promise<{ content: string; trace: OrchestrationTrace }> {
  const startMs = Date.now();

  const TIMEOUT_MS = 12_000;
  const fallbackResult = async (timedOut = false): Promise<{ content: string; trace: OrchestrationTrace }> => {
    const result = await dispatchAgent("coach", userMsg, ambientContext, requestMode, undefined, options);
    return {
      content: result.content,
      trace: {
        agents: ["coach"],
        results: [result],
        orchestrationMs: Date.now() - startMs,
        synthesized: false,
        timedOut,
      },
    };
  };

  try {
    const result = await Promise.race([
      (async () => {
        const routing = await routeToAgents(userMsg, activeView, ambientContext, requestMode);

        let agentResults: AgentResult[];
        if (routing.parallel) {
          const settled = await Promise.allSettled(
            routing.agents.map((id) => dispatchAgent(id, userMsg, ambientContext, requestMode, undefined, {
              ...options,
              phaseId: options.phaseId || activeView,
            })),
          );
          agentResults = settled
            .filter((entry): entry is PromiseFulfilledResult<AgentResult> => entry.status === "fulfilled")
            .map((entry) => entry.value);
        } else {
          agentResults = [];
          let priorContent = "";
          for (const id of routing.agents) {
            const result = await dispatchAgent(id, userMsg, ambientContext, requestMode, priorContent, {
              ...options,
              phaseId: options.phaseId || activeView,
            });
            agentResults.push(result);
            priorContent = result.content;
          }
        }

        const valid = agentResults.filter((result) => result.content && !result.error);
        const synthesized = valid.length > 1;
        const content = synthesized
          ? await synthesizeAgentResults(valid, userMsg, requestMode)
          : valid[0]?.content ?? "";

        return {
          content,
          trace: {
            agents: routing.agents,
            results: agentResults,
            orchestrationMs: Date.now() - startMs,
            synthesized,
          },
        };
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return result;
  } catch (error) {
    return fallbackResult(error instanceof Error && error.message === "timeout");
  }
}

// Global client-side agent-call queue. The AI provider is rate-limited per minute,
// so firing several edge-function calls at once (e.g. a user-initiated artifact plus
// the proactive/auto triggers that fire on the same interaction) reliably trips a 429
// and ALL of them fail. We serialize every run-agent invocation to one in-flight at a
// time. A small priority ordering lets user-initiated calls jump ahead of background
// ones, so an interactive generation waits at most for the single call already running.
type QueuedAgentCall = {
  priority: number;
  run: () => Promise<AgentRunResponse>;
  resolve: (value: AgentRunResponse) => void;
  reject: (reason: unknown) => void;
};

const agentCallQueue: QueuedAgentCall[] = [];
let agentCallDraining = false;

function agentCallPriority(triggeredBy: PhaseAgentRunParams["triggeredBy"]): number {
  if (triggeredBy === "user") return 2;
  if (triggeredBy === "trigger") return 1;
  return 0; // proactive / background
}

async function drainAgentCallQueue(): Promise<void> {
  if (agentCallDraining) return;
  agentCallDraining = true;
  try {
    while (agentCallQueue.length > 0) {
      // Stable sort keeps FIFO order within a priority tier.
      agentCallQueue.sort((a, b) => b.priority - a.priority);
      const task = agentCallQueue.shift();
      if (!task) break;
      try {
        task.resolve(await task.run());
      } catch (err) {
        task.reject(err);
      }
    }
  } finally {
    agentCallDraining = false;
  }
}

function enqueueAgentCall(priority: number, run: () => Promise<AgentRunResponse>): Promise<AgentRunResponse> {
  return new Promise<AgentRunResponse>((resolve, reject) => {
    agentCallQueue.push({ priority, run, resolve, reject });
    void drainAgentCallQueue();
  });
}

export async function runPhaseAgent(params: PhaseAgentRunParams): Promise<AgentRunResponse> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  return enqueueAgentCall(agentCallPriority(params.triggeredBy), async () => {
    // Arm the wall-clock timeout here, when the call actually fires after any queue
    // wait. Combine it with the caller's signal so either can abort the request.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let signal = params.signal;
    if (params.timeoutMs && params.timeoutMs > 0) {
      const timeoutCtrl = new AbortController();
      if (params.signal) {
        if (params.signal.aborted) timeoutCtrl.abort();
        else params.signal.addEventListener("abort", () => timeoutCtrl.abort(), { once: true });
      }
      timeoutId = setTimeout(() => timeoutCtrl.abort(), params.timeoutMs);
      signal = timeoutCtrl.signal;
    }
    try {
      const { data, error } = await supabase.functions.invoke("run-agent", {
        body: {
          programId: params.programId,
          agentId: params.agentId,
          phaseId: params.phaseId,
          triggeredBy: params.triggeredBy,
          triggerEvent: params.triggerEvent,
          incomingHandoff: params.incomingHandoff || null,
          runId: params.runId,
          crossPhaseContext: params.crossPhaseContext,
          decisionId: params.decisionId,
          documentId: params.documentId,
          docText: params.docText,
          audienceGroup: params.audienceGroup,
          meetingDate: params.meetingDate,
          meetingDurationMins: params.meetingDurationMins,
        },
        signal,
      });

      if (error) {
        const context = (error as { context?: unknown }).context;
        // 404 means the edge function is not deployed to this Supabase project
        if (context instanceof Response && context.status === 404) {
          throw new Error("AI agent service is not deployed. Deploy the run-agent edge function to enable agents.");
        }
        throw new Error(await getSupabaseFunctionErrorMessage(error, "Failed to invoke run-agent."));
      }

      return (data || {}) as AgentRunResponse;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });
}
