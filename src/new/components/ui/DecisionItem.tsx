import React from "react";
import type { DecisionPriority } from "@/new/types";

export interface DecisionItemProps {
  id: string;
  title: string;
  priority: DecisionPriority;
  phaseLabel: string;
  timeAgo: string;
  subtitle?: string;
  selected?: boolean;
  compact?: boolean;
  onSelect?: () => void;
}

function priorityTone(priority: DecisionPriority): string {
  switch (priority) {
    case "critical":
      return "red";
    case "high":
      return "amber";
    case "medium":
      return "blue";
    default:
      return "slate";
  }
}

export function DecisionItem({
  title,
  priority,
  phaseLabel,
  timeAgo,
  subtitle,
  selected = false,
  compact = false,
  onSelect,
}: DecisionItemProps) {
  const tone = priorityTone(priority);
  return (
    <button
      type="button"
      className={`adam-list-item w-full text-left ${selected ? "border-blue-500/50 bg-blue-500/10" : ""}`}
      onClick={onSelect}
    >
      <div className="adam-row adam-space-between">
        <div className="adam-row" style={{ alignItems: "flex-start" }}>
          <span className={`mt-1 inline-flex h-2.5 w-2.5 rounded-full ${tone === "red" ? "bg-rose-400" : tone === "amber" ? "bg-amber-400" : tone === "blue" ? "bg-blue-400" : "bg-slate-500"}`} />
          <div className="adam-stack" style={{ gap: 4 }}>
            <div className="adam-title">{title}</div>
            {compact ? null : subtitle ? <div className="adam-body adam-muted">{subtitle}</div> : null}
          </div>
        </div>
        <div className="adam-stack" style={{ gap: 6, alignItems: "flex-end" }}>
          <span className={`adam-badge ${tone}`}>{priority}</span>
          <span className="adam-micro adam-muted">{timeAgo}</span>
        </div>
      </div>
      <div className="mt-3 adam-row adam-space-between">
        <span className="adam-micro adam-muted">{phaseLabel}</span>
        {compact && subtitle ? <span className="adam-micro adam-muted">{subtitle}</span> : null}
      </div>
    </button>
  );
}
