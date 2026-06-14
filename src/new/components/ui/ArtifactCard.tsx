import React from "react";

export interface ArtifactCardProps {
  id: string;
  title: string;
  phaseId: string;
  status: "draft" | "approved" | "archived";
  agentConfidence?: number;
  agentGenerated: boolean;
  lastEditedBy: "agent" | "human";
  lastEditedAt: string;
  contentSummary: string;
  versionNumber: number;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  onViewHistory?: () => void;
}

function statusTone(status: ArtifactCardProps["status"]): string {
  switch (status) {
    case "approved":
      return "green";
    case "archived":
      return "slate";
    default:
      return "amber";
  }
}

export function ArtifactCard(props: ArtifactCardProps) {
  const tone = statusTone(props.status);
  const confidencePct = typeof props.agentConfidence === "number" ? Math.round(props.agentConfidence * 100) : null;
  return (
    <article className={`adam-card adam-stack p-4 border-l-4 ${tone === "green" ? "border-l-emerald-400" : tone === "amber" ? "border-l-amber-400" : "border-l-slate-500"}`}>
      <div className="adam-row adam-space-between">
        <div className="adam-stack" style={{ gap: 6 }}>
          <div className="adam-title">{props.title}</div>
          <div className="adam-micro adam-muted">
            {props.agentGenerated ? "Agent generated" : "Human edited"} · v{props.versionNumber}
          </div>
        </div>
        <span className={`adam-badge ${tone}`}>
          {props.status}
        </span>
      </div>

      <div className="adam-body" style={{ color: "var(--adam-slate-100)" }}>
        {props.contentSummary}
      </div>

      <div className="adam-row adam-space-between">
        <div className="adam-micro adam-muted">
          Last edited by {props.lastEditedBy} · {new Date(props.lastEditedAt).toLocaleString()}
        </div>
        {confidencePct != null ? (
          <div className="adam-row adam-micro" title={`Agent confidence ${confidencePct}%`}>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-200">
              {confidencePct}
            </span>
          </div>
        ) : null}
      </div>

      <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
        {props.status === "draft" && props.onApprove ? (
          <button type="button" className="adam-button" onClick={props.onApprove}>
            Approve
          </button>
        ) : null}
        {props.status === "draft" && props.onReject ? (
          <button type="button" className="adam-button-ghost" onClick={props.onReject}>
            Request changes
          </button>
        ) : null}
        {props.onEdit ? (
          <button type="button" className="adam-button-ghost" onClick={props.onEdit}>
            Edit
          </button>
        ) : null}
        {props.onViewHistory ? (
          <button type="button" className="adam-button-ghost" onClick={props.onViewHistory}>
            History
          </button>
        ) : null}
      </div>
    </article>
  );
}
