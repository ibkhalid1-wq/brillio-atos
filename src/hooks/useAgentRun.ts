import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { getAgentRuns, type AgentRun } from "@/lib/adamSync";
import { runPhaseAgent } from "@/lib/adamOrchestrator";

interface ResumeParams {
  runId: string;
  decisionId: string;
  resolution: "approved" | "rejected" | "modified";
  humanNote?: string;
}

interface RunParams {
  agentId: string;
  phaseId: string;
  triggeredBy: "user" | "trigger" | "proactive";
  crossPhaseContext?: string;
  decisionId?: string;
  documentId?: string;
  docText?: string;
  audienceGroup?: "executive" | "operational" | "all";
  memberName?: string;
  memberRole?: string;
  meetingDate?: string;
  meetingDurationMins?: number;
}

type BroadcastPayload = {
  runId: string;
  agentId: string;
  phaseId: string;
  status: AgentRun["status"];
  confidence?: number | null;
  latestObservationType?: string | null;
  updatedAt: string;
};

type ChannelStatus = "connected" | "disconnected" | "reconnecting";
type RealtimeStatus = "SUBSCRIBED" | "CLOSED" | "CHANNEL_ERROR" | "TIMED_OUT" | string;

const TERMINAL_RUN_RETENTION_MS = 2 * 60 * 1000;
// Runs stuck in "running" or "queued" longer than this are treated as locally timed-out.
// This prevents buttons being stuck forever if the edge function drops a record without
// writing a terminal status (e.g., 404 when function is not deployed, or hard crash).
const STALE_RUN_TIMEOUT_MS = 5 * 60 * 1000;

function isTerminalStatus(status: AgentRun["status"] | undefined): boolean {
  return status === "complete" || status === "failed" || status === "cancelled";
}

function getRunFreshnessTimestamp(run: Partial<AgentRun>): number {
  return new Date(run.completed_at || run.created_at || run.started_at || 0).getTime();
}

function isStaleActiveRun(run: Partial<AgentRun>): boolean {
  if (isTerminalStatus(run.status as AgentRun["status"])) return false;
  const startedAt = new Date(run.created_at || run.started_at || 0).getTime();
  return startedAt > 0 && Date.now() - startedAt > STALE_RUN_TIMEOUT_MS;
}

function normalizeActiveRuns(list: AgentRun[]): AgentRun[] {
  const cutoff = Date.now() - TERMINAL_RUN_RETENTION_MS;
  return list.filter((run) => {
    if (isStaleActiveRun(run)) return false; // drop locally-timed-out runs
    if (!isTerminalStatus(run.status)) return true;
    return getRunFreshnessTimestamp(run) >= cutoff;
  });
}

function upsertRun(list: AgentRun[], payload: Partial<AgentRun> & { id?: string; runId?: string }): AgentRun[] {
  const runId = payload.id || payload.runId;
  if (!runId) return list;
  const nextRun = {
    ...(list.find((run) => run.id === runId) || {}),
    ...payload,
    id: runId,
  } as AgentRun;
  const remaining = list.filter((run) => run.id !== runId);
  return normalizeActiveRuns([nextRun, ...remaining].sort((left, right) => (
    new Date(right.created_at || right.started_at || 0).getTime()
    - new Date(left.created_at || left.started_at || 0).getTime()
  )));
}

export function useAgentRun(programId: string, enabled = true, onRunComplete?: () => void) {
  const [activeRuns, setActiveRuns] = useState<AgentRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Counts in-flight user-initiated runAgent() calls (not background/proactive triggers).
  // A counter (vs boolean) handles the rare case where two user calls overlap.
  const userLoadingCount = useRef(0);
  const [isUserLoading, setIsUserLoading] = useState(false);
  const [latestPausedRunId, setLatestPausedRunId] = useState<string | null>(null);
  const [channelStatuses, setChannelStatuses] = useState<Record<"postgres" | "broadcast", ChannelStatus>>({
    postgres: "connected",
    broadcast: "connected",
  });
  const channelStatus = useMemo<ChannelStatus>(() => {
    const statuses = Object.values(channelStatuses);
    if (statuses.includes("reconnecting")) return "reconnecting";
    if (statuses.includes("disconnected")) return "disconnected";
    return "connected";
  }, [channelStatuses]);

  const refreshRuns = useCallback(async () => {
    if (!enabled || !programId || !isSupabaseConfigured || !supabase) {
      setActiveRuns([]);
      return;
    }
    const runs = await getAgentRuns(programId, 100);
    setActiveRuns(normalizeActiveRuns(runs));
  }, [enabled, programId]);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    if (!enabled || !programId || !isSupabaseConfigured || !supabase) {
      setChannelStatuses({ postgres: "disconnected", broadcast: "disconnected" });
      return undefined;
    }

    const reconnectTimers: Array<number> = [];
    const updateChannelStatus = (channel: "postgres" | "broadcast", status: RealtimeStatus) => {
      if (status === "SUBSCRIBED") {
        setChannelStatuses((current) => ({ ...current, [channel]: "connected" }));
        return;
      }

      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setChannelStatuses((current) => ({ ...current, [channel]: "disconnected" }));
        const timer = window.setTimeout(() => {
          setChannelStatuses((current) => (
            current[channel] === "disconnected"
              ? { ...current, [channel]: "reconnecting" }
              : current
          ));
        }, 3000);
        reconnectTimers.push(timer);
      }
    };

    const postgresChannel = supabase
      .channel(`program-${programId}-runs-table`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "adam_agent_runs",
          filter: `program_id=eq.${programId}`,
        },
        (payload) => {
          const row = ((payload.new && typeof payload.new === "object")
            ? payload.new
            : payload.old) as Partial<AgentRun> | undefined;
          if (!row) return;
          setActiveRuns((prev) => upsertRun(prev, row));
          if (row.status === "complete") {
            // Agent wrote its output to program data — tell the caller to refresh
            // so artifact panels (daily briefing, steerco pack, etc.) update immediately.
            onRunComplete?.();
          }
          if (row.status === "paused" && row.awaiting_decision_id) {
            setLatestPausedRunId(row.id || null);
            window.dispatchEvent(new CustomEvent("adam:agent-run-paused", {
              detail: {
                runId: row.id,
                decisionId: row.awaiting_decision_id,
                phaseId: row.phase_id,
              },
            }));
          }
        },
      )
      .subscribe((status) => {
        updateChannelStatus("postgres", status);
      });

    const broadcastChannel = supabase
      .channel(`program-${programId}-agents`)
      .on("broadcast", { event: "agent_status" }, ({ payload }) => {
        const statusPayload = payload as BroadcastPayload;
        setActiveRuns((prev) => upsertRun(prev, {
          id: statusPayload.runId,
          program_id: programId,
          agent_id: statusPayload.agentId,
          phase_id: statusPayload.phaseId,
          status: statusPayload.status,
          confidence: typeof statusPayload.confidence === "number" ? statusPayload.confidence : null,
          created_at: statusPayload.updatedAt,
          started_at: statusPayload.updatedAt,
        } as Partial<AgentRun>));
      })
      .subscribe((status) => {
        updateChannelStatus("broadcast", status);
      });

    return () => {
      reconnectTimers.forEach((timer) => window.clearTimeout(timer));
      void supabase.removeChannel(postgresChannel);
      void supabase.removeChannel(broadcastChannel);
    };
  }, [enabled, programId]);

  useEffect(() => {
    if (!activeRuns.length || !supabase) return undefined;

    const checkInterval = 90_000;
    const interval = window.setInterval(async () => {
      const stalledRuns = activeRuns.filter((run) => {
        if (run.status !== "running") return false;
        const startedAt = new Date(run.created_at || run.started_at || 0).getTime();
        return Date.now() - startedAt > checkInterval;
      });
      if (!stalledRuns.length) return;

      const { data } = await supabase
        .from("adam_agent_runs")
        .select("id, status, output, tokens_used")
        .in("id", stalledRuns.map((run) => run.id));

      if (data) {
        setActiveRuns((current) => current.map((run) => {
          const polled = data.find((entry) => entry.id === run.id);
          return polled ? { ...run, ...polled } : run;
        }));
      }
    }, checkInterval);

    return () => window.clearInterval(interval);
  }, [activeRuns]);

  const runAgent = useCallback(async (params: RunParams) => {
    if (!programId) throw new Error("Program ID is required.");
    if (!isSupabaseConfigured || !supabase) {
      return {
        runId: "",
        status: "failed" as const,
      };
    }
    const isUserCall = params.triggeredBy === "user";
    setIsLoading(true);
    if (isUserCall) {
      userLoadingCount.current += 1;
      setIsUserLoading(true);
    }

    // Client-side safety net: abort only as a last resort, comfortably past the
    // edge function's own wall-clock budget (DEFAULT_STREAM_TIMEOUT_MS ~130s).
    // Aborting earlier than the server budget killed the request mid-generation,
    // so large artifact runs (~95-110s) never returned a result. The server's
    // timeout guard always writes a terminal status, so this only fires if the
    // platform itself hangs.
    const USER_TIMEOUT_MS = 150_000;
    const abortCtrl = new AbortController();
    const timeoutId = window.setTimeout(() => abortCtrl.abort(), USER_TIMEOUT_MS);

    try {
      const response = await runPhaseAgent({
        programId,
        agentId: params.agentId,
        phaseId: params.phaseId,
        triggeredBy: params.triggeredBy,
        crossPhaseContext: params.crossPhaseContext,
        decisionId: params.decisionId,
        documentId: params.documentId,
        docText: params.docText,
        audienceGroup: params.audienceGroup,
        memberName: params.memberName,
        memberRole: params.memberRole,
        meetingDate: params.meetingDate,
        meetingDurationMins: params.meetingDurationMins,
        signal: abortCtrl.signal,
      });
      await refreshRuns();
      if (response.status === "paused" && response.decisionId) {
        setLatestPausedRunId(response.runId);
        window.dispatchEvent(new CustomEvent("adam:agent-run-paused", {
          detail: {
            runId: response.runId,
            decisionId: response.decisionId,
            phaseId: params.phaseId,
          },
        }));
      }
      return {
        runId: response.runId,
        status: response.status,
      };
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
      if (isUserCall) {
        userLoadingCount.current = Math.max(0, userLoadingCount.current - 1);
        if (userLoadingCount.current === 0) setIsUserLoading(false);
      }
    }
  }, [programId, refreshRuns]);

  const resumeRun = useCallback(async (params: ResumeParams) => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.functions.invoke("resume-agent", {
        body: {
          runId: params.runId,
          decisionId: params.decisionId,
          resolution: params.resolution,
          humanNote: params.humanNote,
        },
      });
      if (error) {
        throw new Error(error.message || "Failed to resume agent run.");
      }
      setLatestPausedRunId((current) => (current === params.runId ? null : current));
      await refreshRuns();
    } finally {
      setIsLoading(false);
    }
  }, [refreshRuns]);

  const isRunning = useMemo(() => (
    isLoading || activeRuns.some((run) => ["queued", "running", "paused"].includes(run.status))
  ), [activeRuns, isLoading]);

  // isUserRunning is true ONLY while a runAgent() call with triggeredBy="user" is in-flight.
  // Unlike isRunning, it does NOT stay true for background/proactive runs sitting in the DB,
  // nor does it block while an auto-triggered agent call is pending the edge function response.
  const isUserRunning = isUserLoading;

  return {
    runAgent,
    activeRuns,
    isRunning,
    isUserRunning,
    resumeRun,
    latestPausedRunId,
    channelStatus,
  };
}
