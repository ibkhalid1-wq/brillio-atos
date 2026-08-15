/**
 * The regeneration queue — one ordered, de-duplicated pipeline for artifact
 * regenerations. Clicking several "Regenerate" buttons while one is running no
 * longer fires a scramble of concurrent, out-of-order runs: each request is
 * enqueued, sorted into the METHODOLOGY'S generate order (Frame → Listen →
 * Prototype → …), and dispatched ONE AT A TIME as the previous run finishes.
 * Duplicate requests for an artifact already running or already queued are
 * dropped. The queue plus the in-flight runs power the persistent status bar and
 * let every Regenerate control (and the "regeneration required" banner) hide
 * itself the moment its request is accepted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface RegenQueueItem {
  agentId: string;
  phaseId: string;
  /** Human label for the status bar (the artifact title). */
  label: string;
}

export function useRegenQueue(opts: {
  /** Agent ids the backend reports as queued/running/paused. */
  runningAgentIds: Set<string>;
  /** Fire an agent run (fire-and-forget). */
  /** Resolves FALSE when a guard refused to dispatch. The queue must drop such an
   *  item rather than wait for a "running" that will never come. */
  runAgent: (agentId: string, phaseId: string) => void | Promise<boolean | void>;
  /** Position of an agent in the methodology's generate order — lower runs first. */
  orderIndex: (agentId: string) => number;
}) {
  const { runningAgentIds, runAgent, orderIndex } = opts;
  const [queue, setQueue] = useState<RegenQueueItem[]>([]);
  // Guard so the processor dispatches an item once, not on every re-render in
  // the window before the backend reports it as running.
  const dispatching = useRef(false);

  // A run that has actually started (shows up in runningAgentIds) leaves the
  // pending queue — it's now the backend's to track.
  useEffect(() => {
    setQueue((cur) => {
      const next = cur.filter((q) => !runningAgentIds.has(q.agentId));
      return next.length === cur.length ? cur : next;
    });
  }, [runningAgentIds]);

  // Once anything is genuinely in flight, the last dispatch registered.
  useEffect(() => { if (runningAgentIds.size > 0) dispatching.current = false; }, [runningAgentIds]);

  const queuedIds = useMemo(() => new Set(queue.map((q) => q.agentId)), [queue]);

  const enqueue = useCallback((agentId: string, phaseId: string, label: string) => {
    if (!agentId) return;
    setQueue((cur) => {
      if (cur.some((q) => q.agentId === agentId)) return cur;     // already queued
      if (runningAgentIds.has(agentId)) return cur;               // already running
      return [...cur, { agentId, phaseId, label }]
        .sort((a, b) => orderIndex(a.agentId) - orderIndex(b.agentId));
    });
  }, [runningAgentIds, orderIndex]);

  const clear = useCallback(() => setQueue([]), []);

  // Processor: one run at a time, in generate order. Dispatch the head of the
  // queue only when nothing is in flight and we're not mid-dispatch.
  useEffect(() => {
    if (!queue.length || runningAgentIds.size > 0 || dispatching.current) return;
    const next = queue[0];
    dispatching.current = true;
    // A REFUSED DISPATCH LEAVES THE QUEUE. An item only used to come off when the
    // backend reported it RUNNING — so when a guard turned the run away (not signed
    // in, read-only, AI not connected) it never started, never left, and the 8-second
    // fallback below re-dispatched it every 8 seconds for ever. The status bar read
    // "Regenerating N artifacts" permanently and the tiles read "rebuilding…".
    // Reported against Experience Design and Agentify.
    const drop = () => setQueue((c) => c.filter((q) => q.agentId !== next.agentId));
    void Promise.resolve(runAgent(next.agentId, next.phaseId))
      .then((dispatched) => { if (dispatched === false) drop(); })
      .catch(drop)                       // threw before starting — same rule
      .finally(() => { dispatching.current = false; });
    // Fallback: if the run never registers as running AND never resolved, release the
    // guard so the queue can't wedge. It re-triggers this effect, which is correct for
    // a slow start and harmless for a refusal, which has already been dropped.
    const t = window.setTimeout(() => { dispatching.current = false; setQueue((c) => [...c]); }, 8000);
    return () => window.clearTimeout(t);
  }, [queue, runningAgentIds, runAgent]);

  return { queue, queuedIds, enqueue, clear };
}
