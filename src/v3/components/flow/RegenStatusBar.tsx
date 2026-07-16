/**
 * The persistent regeneration status bar — pinned to the bottom of the screen
 * whenever any artifact is regenerating (or waiting its turn in the queue). It
 * reads the live run set + the client queue, so it shows what's building now and
 * what's next, in generate order. Premium, quiet, out of the way.
 */
import type { FC } from "react";

export interface RegenStatusItem {
  agentId: string;
  label: string;
  status: "running" | "queued";
}

const RegenStatusBar: FC<{ items: RegenStatusItem[] }> = ({ items }) => {
  if (!items.length) return null;
  const running = items.filter((i) => i.status === "running");
  const queued = items.filter((i) => i.status === "queued");
  return (
    <div className="v3fs-regenstatus" role="status" aria-live="polite" aria-label="Regeneration in progress">
      <span className="v3fs-regenstatus-spin" aria-hidden="true" />
      <span className="v3fs-regenstatus-head">
        <b>{running.length ? `Regenerating ${running.length} artifact${running.length === 1 ? "" : "s"}` : "Regeneration queued"}</b>
        <em>{queued.length ? `${queued.length} more queued · runs in generate order` : "This replaces the current version when it lands."}</em>
      </span>
      <div className="v3fs-regenstatus-chips">
        {items.map((it) => (
          <span key={it.agentId} className={`v3fs-regenstatus-chip ${it.status}`} title={it.status === "running" ? "Regenerating now" : "Waiting its turn"}>
            {it.status === "running"
              ? <i className="v3fs-regenstatus-run" aria-hidden="true" />
              : <span className="v3fs-regenstatus-wait" aria-hidden="true">◷</span>}
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default RegenStatusBar;
