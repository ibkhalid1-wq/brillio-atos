import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  completeClaudeText,
  streamClaudeText,
  toClaudeMessages,
  type FileAttachment,
} from "../_shared/claudeClient.ts";
import type { CopilotChatRequest, CopilotCitation, CopilotGrounding, CopilotThreadMessage, JsonValue } from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseClient = ReturnType<typeof createClient>;

type ThreadRow = {
  id: string;
  program_id: string;
  workspace_id: string;
  messages: JsonValue;
  summary: string | null;
  open_questions: string[] | null;
  owner_id: string | null;
};

function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function authenticateRequest(req: Request): Promise<{ admin: SupabaseClient; ownerId: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(error?.message || "Authentication failed.");
  }
  return { admin, ownerId: data.user.id };
}

function normalizeMessages(raw: JsonValue): CopilotThreadMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, JsonValue> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      role: entry.role === "assistant" || entry.role === "system" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content : "",
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
    }))
    .filter((message) => message.content.trim().length > 0);
}

function extractOpenQuestions(text: string): string[] {
  const questions = text
    .split(/(?<=[?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.endsWith("?"));
  return [...new Set(questions)].slice(0, 6);
}

// ── Program-state digest helpers ───────────────────────────────────────────
// The copilot already fetches the FULL program state (programRow.data) but the
// system prompt historically surfaced only name + objective, leaving the advisor
// blind to decisions, risks, gate readiness, phase, milestones, and artifacts.
// These helpers distil that state into a compact, capped digest so the copilot
// can answer "what's blocking my gate?" / "what decisions are open?" grounded in
// real program data — additive, no new query, bounded token cost.
function asRecord(value: JsonValue | undefined | null): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function asRecordArray(value: JsonValue | undefined | null): Record<string, JsonValue>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, JsonValue> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry))
    : [];
}

function asText(value: JsonValue | undefined | null): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function truncateText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

// Programmes may be stored flat OR nested under a `data` wrapper. Mirror the
// app's getProgramState auto-detection so the digest works for both shapes.
function getInnerState(programContext: Record<string, JsonValue>): Record<string, JsonValue> {
  const nested = programContext.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, JsonValue>;
  }
  return programContext;
}

const RAID_SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function buildProgramStateDigest(inner: Record<string, JsonValue>): string {
  const sections: string[] = [];

  // Active phase + gate readiness
  const activePhase = asText(inner.activePhase);
  if (activePhase) {
    const gate = asRecord(asRecord(inner.gateReviews)[activePhase]);
    const gateStatus = asText(gate.status) || "not started";
    const readiness = typeof gate.readinessScore === "number" ? `${gate.readinessScore}%` : "n/a";
    sections.push(`Active phase: ${activePhase} (gate: ${gateStatus}, readiness: ${readiness})`);
  }

  // Open decisions
  const openDecisions = asRecordArray(inner.decisionQueue).filter((entry) => {
    const status = asText(entry.status).toLowerCase();
    return status !== "resolved" && status !== "approved" && status !== "rejected" && status !== "closed";
  });
  if (openDecisions.length) {
    const rows = openDecisions.slice(0, 5).map((entry) => {
      const priority = asText(entry.priority) || "normal";
      const label = truncateText(asText(entry.title) || asText(entry.question), 110);
      return `  - [${priority}] ${label}`;
    });
    sections.push(`Open decisions (${openDecisions.length}):\n${rows.join("\n")}`);
  }

  // Open RAID risks/issues (severity-ordered)
  const openRaid = asRecordArray(asRecord(inner.raidLog).entries)
    .filter((entry) => asText(entry.status).toLowerCase() !== "closed")
    .sort((a, b) =>
      (RAID_SEVERITY_ORDER[asText(a.severity).toLowerCase()] ?? 4) -
      (RAID_SEVERITY_ORDER[asText(b.severity).toLowerCase()] ?? 4));
  if (openRaid.length) {
    const rows = openRaid.slice(0, 5).map((entry) => {
      const severity = asText(entry.severity) || "?";
      const type = asText(entry.type) || "risk";
      const label = truncateText(asText(entry.title) || asText(entry.description), 110);
      return `  - [${severity}/${type}] ${label}`;
    });
    sections.push(`Open RAID (${openRaid.length}):\n${rows.join("\n")}`);
  }

  // Upcoming milestones
  const openMilestones = asRecordArray(inner.milestones).filter((entry) => {
    const status = asText(entry.status).toLowerCase();
    return status !== "complete" && status !== "completed" && status !== "done";
  });
  if (openMilestones.length) {
    const rows = openMilestones.slice(0, 5).map((entry) => {
      const label = truncateText(asText(entry.title) || asText(entry.name), 90);
      const due = asText(entry.dueDate) || asText(entry.date) || asText(entry.targetDate);
      return `  - ${label}${due ? ` (due ${due})` : ""}`;
    });
    sections.push(`Upcoming milestones (${openMilestones.length}):\n${rows.join("\n")}`);
  }

  // Artifact coverage by phase
  const phaseArtifacts = asRecord(inner.phaseArtifacts);
  const coverage = Object.entries(phaseArtifacts)
    .map(([phase, slots]) => {
      const count = Object.keys(asRecord(slots)).length;
      return count ? `${phase}: ${count}` : "";
    })
    .filter(Boolean);
  if (coverage.length) {
    sections.push(`Artifacts produced by phase: ${coverage.join(", ")}`);
  }

  return sections.join("\n\n");
}

// ── Evidence grounding ──────────────────────────────────────────────────────
// The client assembles a grounding pack (the Experience Design summary + the
// discovery evidence, each tagged E1..En with who/when) and sends it with the
// message. We fold it into the system prompt and instruct the model to cite the
// evidence it leans on as [E#]. After the answer, resolveCitations() returns the
// subset actually cited, so the sidebar can render who-said-what-when chips.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGrounding(raw: unknown): CopilotGrounding | null {
  if (!isRecord(raw)) return null;
  const design = typeof raw.design === "string" ? raw.design : "";
  const evidence: CopilotCitation[] = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .filter(isRecord)
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : "",
      who: typeof e.who === "string" ? e.who : "",
      when: typeof e.when === "string" ? e.when : "",
      quote: typeof e.quote === "string" ? e.quote : "",
      kind: typeof e.kind === "string" ? e.kind : "transcript",
    }))
    .filter((e) => e.id && e.quote);
  if (!design && !evidence.length) return null;
  return { design, evidence };
}

function buildGroundingBlock(grounding: CopilotGrounding): string {
  const parts: string[] = [];
  if (grounding.design.trim()) {
    parts.push(`The design under discussion (Experience Design):\n${grounding.design.trim()}`);
  }
  if (grounding.evidence.length) {
    const rows = grounding.evidence.map((e) =>
      `  [${e.id}] "${e.quote}" — ${e.who || "unattributed"}${e.when ? ` (${e.when})` : ""}`);
    parts.push(
      `Evidence behind the design — each item is tagged. When your answer rests on one, CITE IT INLINE as [E#] using ONLY these ids, and attribute the point to the person and date shown. Never invent a citation or a speaker.\n${rows.join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

/** The evidence items whose [E#] tag appears in the answer, in first-mention order. */
function resolveCitations(text: string, grounding: CopilotGrounding | null): CopilotCitation[] {
  if (!grounding?.evidence.length) return [];
  const cited: CopilotCitation[] = [];
  const seen = new Set<string>();
  const re = /\[(E\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    const hit = grounding.evidence.find((e) => e.id === id);
    if (hit) { seen.add(id); cited.push(hit); }
  }
  return cited;
}

function buildWorkspacePrompt(
  workspaceId: string,
  programContext: Record<string, JsonValue>,
  summary: string | null,
  memoryContext?: string,
  grounding?: CopilotGrounding | null,
): string {
  const identity = (() => {
    if (workspaceId === "home") return "Transformation Advisor";
    if (workspaceId === "twin") return "Architect";
    if (workspaceId === "decisions") return "PMO Lead";
    if (workspaceId === "assets") return "Analyst";
    return "Workspace Advisor";
  })();

  const inner = getInnerState(programContext);
  const programName = String(
    programContext.programName
    || asRecord(inner.meta).name
    || asRecord(inner.projectMeta).name
    || inner.programName
    || "Untitled Program",
  );
  const objective = String(
    programContext.programObjective
    || inner.objective
    || inner.programObjective
    || asRecord(inner.projectMeta).objective
    || "",
  );
  const digest = buildProgramStateDigest(inner);

  const groundingBlock = grounding ? buildGroundingBlock(grounding) : "";

  return [
    `You are AURA Copilot acting as the ${identity} for the "${workspaceId}" workspace.`,
    `Program name: ${programName}`,
    `Program objective: ${objective}`,
    digest ? `Current program state:\n${digest}` : "",
    groundingBlock,
    summary ? `Thread summary: ${summary}` : "",
    memoryContext ? `Agent memory context:\n${memoryContext}` : "",
    "Ground every answer in the program state above — reference specific decisions, risks, gate readiness, and milestones by name when relevant. If the state lacks what's needed, say so rather than inventing it.",
    groundingBlock ? "For questions about the DESIGN, ground the answer in the Experience Design and the tagged evidence, and cite the evidence you rely on as [E#] so the reader can see who said it and when." : "",
    "Be concise, specific, and action-oriented.",
  ].filter(Boolean).join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const { admin, ownerId } = await authenticateRequest(req);
    const payload = await req.json() as CopilotChatRequest;
    if (!payload.programId || !payload.workspaceId || !payload.message?.trim()) {
      return jsonResponse({ error: "programId, workspaceId, and message are required." }, 400);
    }

    const { data: threadRow, error: threadError } = await admin
      .from("adam_copilot_threads")
      .select("*")
      .eq("program_id", payload.programId)
      .eq("workspace_id", payload.workspaceId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (threadError) {
      return jsonResponse({ error: threadError.message }, 500);
    }

    const { data: programRow, error: programError } = await admin
      .from("adam_programs")
      .select("id, data")
      .eq("id", payload.programId)
      .single();
    if (programError || !programRow) {
      return jsonResponse({ error: programError?.message || "Program not found." }, 404);
    }

    const existingThread = threadRow as ThreadRow | null;
    const existingMessages = normalizeMessages(existingThread?.messages ?? []);
    const nextMessages: CopilotThreadMessage[] = [
      ...existingMessages,
      {
        role: "user",
        content: payload.message.trim(),
        timestamp: new Date().toISOString(),
      },
    ];

    const { error: threadUpsertErr } = await admin
      .from("adam_copilot_threads")
      .upsert({
        id: existingThread?.id,
        program_id: payload.programId,
        workspace_id: payload.workspaceId,
        owner_id: ownerId,
        messages: nextMessages as unknown as JsonValue,
        summary: existingThread?.summary || null,
        open_questions: existingThread?.open_questions || [],
        last_activity_at: new Date().toISOString(),
      }, { onConflict: "program_id,workspace_id,owner_id" });
    if (threadUpsertErr) {
      console.error("[copilot-chat] Failed to persist user message:", threadUpsertErr.message);
      return jsonResponse({ error: "Failed to save message to thread." }, 500);
    }

    const programContext = (programRow.data && typeof programRow.data === "object" && !Array.isArray(programRow.data))
      ? programRow.data as Record<string, JsonValue>
      : {};
    const grounding = normalizeGrounding((payload as { grounding?: unknown }).grounding);
    const systemPrompt = buildWorkspacePrompt(
      payload.workspaceId,
      programContext,
      existingThread?.summary || null,
      payload.memoryContext,
      grounding,
    );
    const promptMessages = toClaudeMessages(nextMessages.slice(-20));

    // File attachment forwarded from document import (base64 + mimeType)
    const fileAttachment = (payload as unknown as { fileAttachment?: FileAttachment }).fileAttachment;

    if (payload.stream === false) {
      const result = await completeClaudeText({
        system: systemPrompt,
        messages: promptMessages,
        maxTokens: 1200,
        temperature: 0.3,
        fileAttachment,
      });
      const citations = resolveCitations(result.text, grounding);
      const assistantMessage: CopilotThreadMessage = {
        role: "assistant",
        content: result.text,
        timestamp: new Date().toISOString(),
        ...(citations.length ? { citations } : {}),
      };
      const updatedMessages = [...nextMessages, assistantMessage];
      const openQuestions = extractOpenQuestions(result.text);
      const { error: assistantUpsertErr } = await admin
        .from("adam_copilot_threads")
        .upsert({
          id: existingThread?.id,
          program_id: payload.programId,
          workspace_id: payload.workspaceId,
          owner_id: ownerId,
          messages: updatedMessages as unknown as JsonValue,
          summary: existingThread?.summary || null,
          open_questions: openQuestions,
          last_activity_at: new Date().toISOString(),
        }, { onConflict: "program_id,workspace_id,owner_id" });
      if (assistantUpsertErr) {
        console.error("[copilot-chat] Failed to persist assistant message:", assistantUpsertErr.message);
        // Still return the response — the AI replied, just couldn't save it
      }

      return jsonResponse({
        message: assistantMessage,
        openQuestions,
        citations,
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          let assistantContent = "";
          try {
            const result = await streamClaudeText({
              system: systemPrompt,
              messages: promptMessages,
              maxTokens: 1200,
              temperature: 0.3,
              fileAttachment,
            }, (token) => {
              assistantContent += token;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
            });

            const finalText = assistantContent.trim() || result.text;
            const citations = resolveCitations(finalText, grounding);
            const assistantMessage: CopilotThreadMessage = {
              role: "assistant",
              content: finalText,
              timestamp: new Date().toISOString(),
              ...(citations.length ? { citations } : {}),
            };
            let messagesToStore = [...nextMessages, assistantMessage];
            let summary = existingThread?.summary || null;
            const openQuestions = extractOpenQuestions(assistantMessage.content);

            if (messagesToStore.length > 15) {
              const summaryResult = await completeClaudeText({
                system: "Summarize the Copilot thread in under 100 words. Focus on decisions, risks, and unresolved items.",
                messages: [{
                  role: "user",
                  content: messagesToStore.map((message) => `${message.role}: ${message.content}`).join("\n"),
                }],
                maxTokens: 180,
                temperature: 0.2,
              });
              summary = summaryResult.text;
              messagesToStore = messagesToStore.slice(-8);
            }

            await admin
              .from("adam_copilot_threads")
              .upsert({
                id: existingThread?.id,
                program_id: payload.programId,
                workspace_id: payload.workspaceId,
                owner_id: ownerId,
                messages: messagesToStore as unknown as JsonValue,
                summary,
                open_questions: openQuestions,
                last_activity_at: new Date().toISOString(),
              }, { onConflict: "program_id,workspace_id,owner_id" });

            if (citations.length) {
              controller.enqueue(encoder.encode(`data: [CITATIONS] ${JSON.stringify(citations)}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch (error) {
            controller.enqueue(encoder.encode(`data: [ERROR] ${(error instanceof Error ? error.message : "Unknown error")}\n\n`));
          } finally {
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
