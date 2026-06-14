import React from "react";
import type { AutonomyLevel } from "@/new/types";

const LABELS: Record<AutonomyLevel, string> = {
  manual: "Manual",
  queued: "Queued",
  supervised: "Supervised",
  autonomous: "Autonomous",
};

const COLORS: Record<AutonomyLevel, string> = {
  manual: "slate",
  queued: "blue",
  supervised: "amber",
  autonomous: "green",
};

export function AutonomyBadge({ level }: { level: AutonomyLevel }) {
  return (
    <span className={`adam-badge ${COLORS[level]}`}>
      {LABELS[level]}
    </span>
  );
}
