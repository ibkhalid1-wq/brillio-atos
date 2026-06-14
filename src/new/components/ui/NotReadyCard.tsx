import React from "react";

interface NotReadyCardProps {
  title: string;
  reason: string;
  onTrigger?: () => void;
  triggerLabel?: string;
  isRunning?: boolean;
}

export function NotReadyCard({
  title,
  reason,
  onTrigger,
  triggerLabel = "Generate",
  isRunning = false,
}: NotReadyCardProps) {
  return (
    <section className="adam-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="adam-title" style={{ color: "var(--adam-slate-400)" }}>{title}</div>
          <div className="mt-2 adam-body adam-muted">{reason}</div>
        </div>
        <span className="adam-badge slate" style={{ flexShrink: 0 }}>Not ready</span>
      </div>
      {onTrigger ? (
        <button
          type="button"
          className="adam-button-ghost mt-4"
          onClick={onTrigger}
          disabled={isRunning}
        >
          {isRunning ? "Generating…" : triggerLabel}
        </button>
      ) : null}
    </section>
  );
}
