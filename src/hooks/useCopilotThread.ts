import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface ThreadMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

function normalizeMessages(raw: Json | null | undefined): ThreadMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, Json> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry): ThreadMessage => ({
      role: entry.role === "assistant" || entry.role === "system" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content : "",
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : new Date().toISOString(),
    }))
    .filter((message) => message.content.trim().length > 0);
}

async function getAccessToken(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("A signed-in session is required for persistent Copilot threads.");
  }
  return token;
}

async function getCurrentUserId(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) {
    throw new Error("Authentication required.");
  }
  return data.user.id;
}

export function useCopilotThread(programId: string, workspaceId: string, memoryContext = "") {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);

  const refreshThread = useCallback(async () => {
    if (!programId || !workspaceId || !isSupabaseConfigured || !supabase) {
      setMessages([]);
      setOpenQuestions([]);
      return;
    }

    const { data, error } = await supabase
      .from("adam_copilot_threads")
      .select("messages, open_questions")
      .eq("program_id", programId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error || !data) {
      setMessages([]);
      setOpenQuestions([]);
      return;
    }

    setMessages(normalizeMessages(data.messages));
    setOpenQuestions(data.open_questions || []);
  }, [programId, workspaceId]);

  useEffect(() => {
    void refreshThread();
  }, [refreshThread]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    const token = await getAccessToken();
    setIsLoading(true);

    const optimisticUserMessage: ThreadMessage = {
      role: "user",
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };
    const optimisticAssistantMessage: ThreadMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticUserMessage, optimisticAssistantMessage]);

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 90_000);

    try {
      let response: Response;
      try {
        response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot-chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            programId,
            workspaceId,
            memoryContext,
            message: content.trim(),
            stream: true,
          }),
          signal: abortController.signal,
        });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error("The AI service is temporarily busy. Please wait a moment and try again.");
        }
        throw fetchError;
      }

      if (!response.ok || !response.body) {
        // Surface a friendly message for rate-limit errors instead of raw JSON
        if (response.status === 429) {
          throw new Error("The AI service is temporarily busy (rate limit). Please wait a moment and try again.");
        }
        throw new Error(`Copilot request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const dataLine = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const tokenValue = dataLine.slice(6);
          if (tokenValue === "[DONE]") continue;
          if (tokenValue.startsWith("[ERROR]")) {
            throw new Error(tokenValue.replace("[ERROR]", "").trim());
          }
          let chunk = tokenValue;
          try {
            chunk = JSON.parse(tokenValue) as string;
          } catch {
            chunk = tokenValue;
          }
          assistantText += chunk;
          setMessages((prev) => {
            if (!prev.length) return prev;
            const next = [...prev];
            next[next.length - 1] = {
              ...next[next.length - 1],
              content: assistantText,
            };
            return next;
          });
        }
      }

      await refreshThread();
    } catch (error) {
      setMessages((prev) => prev.slice(0, -1));
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [memoryContext, programId, refreshThread, workspaceId]);

  const clearThread = useCallback(async () => {
    if (!programId || !workspaceId || !isSupabaseConfigured || !supabase) return;
    const ownerId = await getCurrentUserId();
    const { error } = await supabase
      .from("adam_copilot_threads")
      .upsert({
        program_id: programId,
        workspace_id: workspaceId,
        owner_id: ownerId,
        messages: [],
        summary: null,
        open_questions: [],
        last_activity_at: new Date().toISOString(),
      }, { onConflict: "program_id,workspace_id,owner_id" });

    if (error) {
      throw new Error(error.message || "Failed to clear Copilot thread.");
    }
    setMessages([]);
    setOpenQuestions([]);
  }, [programId, workspaceId]);

  return useMemo(() => ({
    messages,
    isLoading,
    openQuestions,
    sendMessage,
    clearThread,
  }), [clearThread, isLoading, messages, openQuestions, sendMessage]);
}
