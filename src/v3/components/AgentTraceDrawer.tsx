import React, { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { timeAgo } from "@/v3/utils";

interface TraceEvent {
  event: string;
  timestamp: string;
  durationMs?: number;
  summary: string;
}

interface TraceRun {
  id: string;
  agent_id: string;
  phase_id: string;
  status: string;
  confidence: number | null;
  tokens_used: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface AgentTraceDrawerProps {
  runId: string;
  onClose: () => void;
}

const EVENT_ICONS: Record<string, string> = {
  context_built: "◈",
  memory_retrieved: "◎",
  prompt_sent: "→",
  response_received: "←",
  artifact_drafted: "◻",
  decision_queued: "⬡",
  handoff_created: "⤳",
  trigger_fired: "◉",
  pause_requested: "⏸",
  resume: "▶",
  error: "✕",
};

export default function AgentTraceDrawer({ runId, onClose }: AgentTraceDrawerProps) {
  const [run, setRun] = useState<TraceRun | null>(null);
  const [timeline, setTimeline] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void supabase.auth.getSession()
      .then(async ({ data }: { data: { session: { access_token?: string } | null } }) => {
        const jwt = data.session?.access_token || "";
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-agent-trace?runId=${encodeURIComponent(runId)}`,
          { headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" } },
        );
        const payload = await response.json() as {
          run?: TraceRun;
          timeline?: TraceEvent[];
          observations?: Array<{ type?: string; summary?: string; createdAt?: string; latencyMs?: number | null }>;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || payload.error) {
          setError(payload.error || "Failed to load trace");
          return;
        }
        setRun(payload.run || null);
        if (Array.isArray(payload.timeline) && payload.timeline.length) {
          setTimeline(payload.timeline);
          return;
        }
        setTimeline((payload.observations || []).map((event) => ({
          event: event.type || "observation",
          timestamp: event.createdAt || new Date().toISOString(),
          durationMs: typeof event.latencyMs === "number" ? event.latencyMs : undefined,
          summary: event.summary || "Observation recorded.",
        })));
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "Failed to load trace");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const durationSec = run?.started_at && run?.completed_at
    ? ((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)
    : null;

  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div className="v3-sheet">
        <div className="v3-sheet-header">
          <div>
            <div className="v3-sheet-title">Agent trace</div>
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 2 }}>
              {run ? `${run.agent_id} · ${run.phase_id}` : runId.slice(0, 8)}
            </div>
          </div>
          <button className="v3-sheet-close" onClick={onClose}>×</button>
        </div>

        <div className="v3-sheet-body">
          {loading ? (
            <div style={{ display: "grid", gap: 8 }}>
              {[1, 2, 3, 4].map((i) => <div key={i} className="v3-skeleton" style={{ height: 48, borderRadius: 8 }} />)}
            </div>
          ) : error ? (
            <div style={{ color: "var(--v3-red)", fontSize: 13 }}>{error}</div>
          ) : (
            <>
              {run ? (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                  <span className={`v3-chip ${run.status === "complete" ? "green" : run.status === "failed" ? "red" : "amber"}`}>{run.status}</span>
                  {run.confidence !== null ? (
                    <span className={`v3-chip ${run.confidence >= 0.8 ? "green" : run.confidence >= 0.6 ? "amber" : "red"}`}>
                      {Math.round(run.confidence * 100)}% confidence
                    </span>
                  ) : null}
                  {durationSec ? <span className="v3-chip muted">{durationSec}s</span> : null}
                  {run.tokens_used ? <span className="v3-chip muted">{run.tokens_used.toLocaleString()} tokens</span> : null}
                </div>
              ) : null}

              <div className="v3-trace-timeline">
                {timeline.map((event, index) => (
                  <div key={`${event.event}-${event.timestamp}-${index}`} className="v3-trace-event">
                    <div className="v3-trace-icon">{EVENT_ICONS[event.event] || "·"}</div>
                    <div className="v3-trace-body">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {event.event.replace(/_/g, " ")}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--v3-text-muted)", flexShrink: 0 }}>
                          {event.durationMs !== undefined ? `+${event.durationMs}ms` : timeAgo(event.timestamp)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.5, marginTop: 2 }}>{event.summary}</div>
                    </div>
                  </div>
                ))}
                {!timeline.length ? <div style={{ color: "var(--v3-text-muted)", fontSize: 13 }}>No observations recorded for this run.</div> : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
