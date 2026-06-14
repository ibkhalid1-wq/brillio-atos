import React from "react";
import { AutonomyBadge } from "@/new/components/ui/AutonomyBadge";
import { AgentPulse } from "@/new/components/ui/AgentPulse";
import type { AutonomyLevel } from "@/new/types";

export interface AgentCardProps {
  agentId: string;
  phaseId: string;
  displayName: string;
  status: "idle" | "running" | "paused" | "complete" | "failed";
  autonomyLevel?: AutonomyLevel;
  currentTask?: string;
  confidence?: number;
  lastArtifact?: string;
  pendingDecision?: string;
  pauseReason?: string;
  onResume?: () => void;
  onViewTrace?: () => void;
}

export function AgentCard({
  displayName,
  status,
  autonomyLevel = "queued",
  currentTask,
  confidence,
  lastArtifact,
  pendingDecision,
  pauseReason,
  onResume,
  onViewTrace,
}: AgentCardProps) {
  const confidencePct = typeof confidence === "number" ? Math.round(confidence * 100) : null;
  return (
    <div className="adam-card adam-stack p-4">
      <div className="adam-row adam-space-between">
        <div className="adam-title">{displayName}</div>
        <div className="adam-row" style={{ gap: 8, alignItems: "center" }}>
          <AutonomyBadge level={autonomyLevel} />
          <AgentPulse status={status} />
        </div>
      </div>
      <div className="adam-body adam-muted">
        {currentTask || lastArtifact || "No recent agent activity."}
      </div>
      {confidencePct != null ? (
        <div className="adam-stack" style={{ gap: 8 }}>
          <div className="adam-row adam-space-between">
            <span className="adam-micro adam-muted">Confidence</span>
            <span className="adam-micro">{confidencePct}%</span>
          </div>
          <div className="adam-meter rounded-full bg-white/10">
            <div className="adam-meter rounded-full bg-blue-500" style={{ width: `${confidencePct}%` }} />
          </div>
        </div>
      ) : null}
      {status === "paused" ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
          <div className="font-semibold">Paused</div>
          <div className="mt-1">{pauseReason || pendingDecision || "Awaiting human guidance."}</div>
        </div>
      ) : null}
      <div className="adam-row" style={{ flexWrap: "wrap" }}>
        {status === "paused" && onResume ? (
          <button type="button" className="adam-button" onClick={onResume}>
            Resume
          </button>
        ) : null}
        {onViewTrace ? (
          <button type="button" className="adam-button-ghost" onClick={onViewTrace}>
            View trace
          </button>
        ) : null}
      </div>
    </div>
  );
}
