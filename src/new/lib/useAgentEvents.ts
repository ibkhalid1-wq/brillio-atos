import { useCallback, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { AgentEventSummary } from "@/new/types";

// useAgentEvents provides a raw event stream for trace/history views only.
// User-facing notifications are handled by run-level subscriptions to avoid duplicate toasts.

type EventRow = Database["public"]["Tables"]["adam_agent_events"]["Row"];

function toAgentEvent(row: EventRow): AgentEventSummary {
  return {
    id: row.id,
    programId: row.program_id,
    agentId: row.agent_id,
    phaseId: row.phase_id,
    eventType: row.event_type as AgentEventSummary["eventType"],
    payload: typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown>
      : null,
    createdAt: row.created_at,
  };
}

export function useAgentEvents(programId: string) {
  const [events, setEvents] = useState<AgentEventSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !programId) {
      setEvents([]);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("adam_agent_events")
        .select("*")
        .eq("program_id", programId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setEvents(((data || []) as EventRow[]).map(toAgentEvent));
    } catch (error) {
      console.warn("Agent events load failed:", error);
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !programId) return undefined;

    const channel = supabase
      .channel(`intelligence-agent-events:${programId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "adam_agent_events",
        filter: `program_id=eq.${programId}`,
      }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [programId, refresh]);

  const runningAgentIds = useMemo(() => {
    const latestByAgent = new Map<string, AgentEventSummary>();
    for (const event of events) {
      if (!latestByAgent.has(`${event.agentId}:${event.phaseId || "program"}`)) {
        latestByAgent.set(`${event.agentId}:${event.phaseId || "program"}`, event);
      }
    }
    return Array.from(latestByAgent.values())
      .filter((event) => event.eventType === "triggered")
      .map((event) => `${event.agentId}:${event.phaseId || "program"}`);
  }, [events]);

  return {
    events,
    runningAgentIds,
    isLoading,
    refresh,
  };
}
