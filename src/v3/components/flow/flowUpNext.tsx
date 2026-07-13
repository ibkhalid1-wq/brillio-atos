/**
 * "Up next" — the ranked frontier queue. The system states its opinion of
 * the next move (regenerate -> collect -> attest -> review -> record) so the
 * operator never hunts. The spine regeneration lives here as the queue's
 * top item, with the module-level run store that survives remounts.
 */
import React, { useEffect, useState } from "react";
import type { MovementTab } from "@/v3/components/flow/flowStages";

/** One ranked frontier action — a verb with its object. The queue states the
 * system's opinion of the next move so the operator never hunts. */
export interface UpNextItem {
  icon: string;
  label: string;
  /** Stage the action lands in (also where a click navigates). */
  toTab?: MovementTab;
  /** Async work the item runs (regenerate / generate / attest). */
  run?: () => Promise<void>;
  /** Two-step verbs (writes that flip judgment): the first press arms and
   * shows this label; the second runs. */
  confirm?: string;
  /** Opens the editor at a field instead of switching stage. */
  anchor?: string;
  /** Opens the Inbox — cross-surface work also flows through Up next. */
  openInbox?: boolean;
  /** This item IS the spine regeneration — rendered with live progress. */
  spine?: boolean;
}

/**
 * Regenerate down the spine — the staged runner. The app knows the document
 * dependency order (movement order); when several documents trail the
 * evidence this runs them one at a time, upstream first, so each generation
 * reads its refreshed upstream context. Hand-edited documents keep their
 * guard: those runs land as proposals in the Inbox, never overwrites.
 */
// The spine run outlives the component: switching views mid-run remounts the
// canvas, and a multi-minute regeneration must neither stop nor lose its
// progress display when that happens. Module-level store; remounts re-attach.
type SpineState =
  | { phase: "running"; index: number; total: number; title: string }
  | { phase: "done"; completed: number; failed: string[] }
  | null;
let spineState: SpineState = null;
const spineListeners = new Set<() => void>();
function setSpineState(next: SpineState) {
  spineState = next;
  for (const listener of spineListeners) listener();
}
const subscribeSpine = (listener: () => void) => {
  spineListeners.add(listener);
  return () => { spineListeners.delete(listener); };
};

/** The spine regeneration as the queue's top item — same staged runner, now
 * living where every other frontier verb lives, with inline progress. */
export function SpineQueueItem({ plan, primary, runningAgentIds, onRun, onGo }: {
  plan: Array<{ artifactId: string; movementId: string; title: string }>;
  primary: boolean;
  runningAgentIds: Set<string>;
  onRun: (agentId: string, phaseId: string) => Promise<void>;
  onGo: () => void;
}) {
  const state = React.useSyncExternalStore(subscribeSpine, () => spineState);
  const progress = state?.phase === "running" ? state : null;
  const done = state?.phase === "done" ? state : null;
  const busyElsewhere = runningAgentIds.size > 0 && !progress;
  const run = async () => {
    if (spineState?.phase === "running") return;
    const steps = [...plan];
    let completed = 0;
    const failed: string[] = [];
    for (const [index, step] of steps.entries()) {
      setSpineState({ phase: "running", index: index + 1, total: steps.length, title: step.title });
      // A step can reject transiently — a watcher run holding the single
      // agent slot right after the previous document landed. Back off and
      // retry before conceding, and never let one failure stop the rest.
      let attempts = 0;
      for (;;) {
        try {
          await onRun(step.artifactId, step.movementId);
          completed += 1;
          break;
        } catch {
          attempts += 1;
          if (attempts >= 3) { failed.push(step.title); break; }
          await new Promise((resolve) => setTimeout(resolve, 5000 * attempts));
        }
      }
    }
    setSpineState({ phase: "done", completed, failed });
  };
  if (progress) {
    return (
      <div className="v3fs-upnext-run" role="status">
        <span>↻ Regenerating {progress.index} of {progress.total} — {progress.title}…</span>
        <div className="v3fs-upnext-bar" aria-hidden="true">
          <div className="v3fs-upnext-fill" style={{ width: `${Math.round(((progress.index - 1) / progress.total) * 100)}%` }} />
        </div>
      </div>
    );
  }
  return (
    <>
      <button type="button" className={`v3fs-upnext-btn${primary ? " pri" : ""}`} disabled={busyElsewhere}
        title={`Evidence changed — ${plan.length} documents regenerate in dependency order, upstream first`}
        onClick={() => { onGo(); void run(); }}>
        <span className="v3fs-upnext-i" aria-hidden="true">↻</span>
        {busyElsewhere ? "An agent is running…" : done?.failed.length ? `Retry — ${done.failed.length} did not finish` : `Regenerate ${plan.length} documents — down the spine`}
      </button>
      {done && !done.failed.length && done.completed > 0 ? (
        <span className="v3fs-upnext-note">Regenerated {done.completed} — hand-edited documents ask first, in the Inbox.</span>
      ) : null}
    </>
  );
}

/**
 * One "Up next" verb. An item with async `run` (regenerate / generate) shows
 * progress and jumps to the stage where the result lands; a navigation-only
 * item just goes there so the operator sees the thing they need to act on.
 * The first item in the queue is the primary; the rest stay quiet.
 */
export function UpNextButton({ item, primary, onGo }: {
  item: UpNextItem;
  primary: boolean;
  onGo: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Verbs that write judgment (roster attestation) are two-step: the first
  // press arms and names exactly what will happen; the second acts. The arm
  // decays so a stray click never leaves a loaded button behind.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const press = async () => {
    if (item.confirm && !armed) { setArmed(true); return; }
    onGo();
    if (!item.run) return;
    setBusy(true);
    try { await item.run(); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <button type="button" className={`v3fs-upnext-btn${primary ? " pri" : ""}${armed ? " armed" : ""}`} disabled={busy} onClick={() => void press()}>
      <span className="v3fs-upnext-i" aria-hidden="true">{item.icon}</span>
      {busy ? "Working…" : armed && item.confirm ? item.confirm : item.label}
    </button>
  );
}
