import React, { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { AgentRun } from "@/lib/adamSync";

interface Observation {
  id: string;
  observation_type: string;
  payload: Record<string, unknown> | null;
  tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

interface TimelineEvent {
  event: string;
  timestamp: string;
  durationMs?: number;
  summary: string;
}

interface TracePayload {
  run: AgentRun;
  observations: Observation[];
  timeline: TimelineEvent[];
}

export interface AgentTraceViewerProps {
  runId: string;
  onClose: () => void;
}

async function getAccessToken(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Authentication required.");
  }
  return token;
}

export function AgentTraceViewer({ runId, onClose }: AgentTraceViewerProps) {
  const [trace, setTrace] = useState<TracePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setTrace(null);

    void (async () => {
      try {
        const token = await getAccessToken();
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-agent-trace?runId=${encodeURIComponent(runId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        const payload = await response.json() as TracePayload & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || `Failed to load trace (${response.status}).`);
        }
        if (!cancelled) {
          setTrace(payload);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load trace.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const reasoningSteps = useMemo(() => (
    Array.isArray(trace?.run?.reasoning_trace) ? trace?.run?.reasoning_trace : []
  ), [trace]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Agent run — {trace?.run?.phase_id || runId}</h2>
            <p className="mt-1 text-xs text-slate-400">
              Triggered by: {trace?.run?.scheduled_by || "unknown"} · Started: {trace?.run?.started_at ? new Date(trace.run.started_at).toLocaleString() : "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading trace…</div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-rose-300">{error}</div>
        ) : trace ? (
          <div className="grid flex-1 grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] overflow-hidden">
            <div className="overflow-y-auto border-r border-slate-800 px-5 py-4">
              <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-200">
                  Status: {trace.run.status}
                </span>
                <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-200">
                  Confidence: {trace.run.confidence != null ? `${Math.round(trace.run.confidence * 100)}%` : "—"}
                </span>
                <span className="rounded-full border border-slate-700 px-3 py-1 text-slate-200">
                  Tokens: {trace.run.tokens_used ?? 0}
                </span>
              </div>

              <section className="mb-6">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Timeline</h3>
                <div className="space-y-2">
                  {trace.timeline.map((event) => (
                    <div key={`${event.event}-${event.timestamp}`} className="grid grid-cols-[84px_160px_minmax(0,1fr)] gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
                      <div className="font-mono text-cyan-300">
                        {event.durationMs != null ? `${(event.durationMs / 1000).toFixed(2)}s` : "—"}
                      </div>
                      <div className="font-medium text-slate-200">{event.event}</div>
                      <div className="text-slate-400">{event.summary}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Reasoning trace</h3>
                <div className="space-y-2">
                  {reasoningSteps.length === 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-sm text-slate-400">
                      No reasoning trace captured for this run.
                    </div>
                  )}
                  {reasoningSteps.map((step, index) => (
                    <details key={`${index}-${step.slice(0, 20)}`} className="rounded-xl border border-slate-800 bg-slate-900/60">
                      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-slate-200">
                        Step {index + 1}
                      </summary>
                      <div className="border-t border-slate-800 px-3 py-3 text-sm leading-6 text-slate-400">
                        {step}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <section className="mb-6">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Handoff summary</h3>
                {trace.run.handoff && typeof trace.run.handoff === "object" && !Array.isArray(trace.run.handoff) ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                    <p className="mb-2 text-base font-medium text-white">
                      {String((trace.run.handoff as Record<string, unknown>).toPhaseId || "Next phase")}
                    </p>
                    <p className="leading-6 text-slate-400">
                      {String((trace.run.handoff as Record<string, unknown>).summary || "No handoff summary recorded.")}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                    No handoff was created for this run.
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Observations</h3>
                <div className="space-y-2">
                  {trace.observations.map((observation) => (
                    <div key={observation.id} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-200">{observation.observation_type}</span>
                        <span className="text-[11px] text-slate-500">{new Date(observation.created_at).toLocaleTimeString()}</span>
                      </div>
                      {observation.tokens != null || observation.latency_ms != null ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          {observation.tokens != null ? `${observation.tokens} tokens` : "—"}
                          {observation.latency_ms != null ? ` · ${observation.latency_ms}ms` : ""}
                        </div>
                      ) : null}
                      {observation.payload ? (
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950/70 p-2 text-[11px] leading-5 text-slate-400">
                          {JSON.stringify(observation.payload, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
