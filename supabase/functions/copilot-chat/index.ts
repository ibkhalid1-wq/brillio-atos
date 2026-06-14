import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  completeClaudeText,
  streamClaudeText,
  toClaudeMessages,
  type FileAttachment,
} from "../_shared/claudeClient.ts";
import type { CopilotChatRequest, CopilotThreadMessage, JsonValue } from "../_shared/types.ts";

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

function buildWorkspacePrompt(
  workspaceId: string,
  programContext: Record<string, JsonValue>,
  summary: string | null,
  memoryContext?: string,
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
    memoryContext ? `Agent memory context:\n${memoryContext}` : "",
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
    const systemPrompt = buildWorkspacePrompt(
      payload.workspaceId,
      programContext,
      existingThread?.summary || null,
      payload.memoryContext,
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
      const assistantMessage: CopilotThreadMessage = {
        role: "assistant",
        content: result.text,
        timestamp: new Date().toISOString(),
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

            const assistantMessage: CopilotThreadMessage = {
              role: "assistant",
              content: assistantContent.trim() || result.text,
              timestamp: new Date().toISOString(),
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
