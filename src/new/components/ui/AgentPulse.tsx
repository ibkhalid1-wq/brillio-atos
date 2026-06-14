import React from "react";
import type { AgentStatus } from "@/new/types";

interface AgentPulseProps {
  status: AgentStatus;
  size?: "sm" | "md";
}

function toneClass(status: AgentStatus): string {
  switch (status) {
    case "running":
      return "blue";
    case "paused":
      return "amber";
    case "complete":
      return "green";
    case "failed":
      return "red";
    default:
      return "slate";
  }
}

export function AgentPulse({ status, size = "md" }: AgentPulseProps) {
  const dimension = size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  const shouldPulse = status === "running";
  const tone = toneClass(status);
  const colorClass = {
    blue: "bg-blue-400",
    amber: "bg-amber-400",
    green: "bg-emerald-400",
    red: "bg-rose-400",
    slate: "bg-slate-500",
  }[tone];

  return (
    <span
      className={[
        "inline-flex rounded-full",
        dimension,
        colorClass,
        shouldPulse ? "adam-pulse" : "",
      ].join(" ")}
      aria-label={`Agent status ${status}`}
      title={`Agent status: ${status}`}
    />
  );
}
