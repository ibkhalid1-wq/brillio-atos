import React, { useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { CriticalPathAnalysis, PlanSummary } from "@/new/types";

interface PlanCardProps {
  plan: PlanSummary | null;
  planGeneratedAt: string;
  criticalPathAnalysis?: CriticalPathAnalysis | null;
  onTrigger: () => void;
  isRunning?: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  complete: "green",
  "on-track": "green",
  "at-risk": "amber",
  blocked: "red",
  "not-started": "slate",
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "red",
  high: "amber",
  medium: "slate",
};

function criticalPathBadge(status: string): string {
  if (status === "complete") return "green";
  if (status === "in-progress") return "blue";
  if (status === "blocked") return "red";
  return "slate";
}

export function PlanCard({
  plan,
  planGeneratedAt,
  criticalPathAnalysis = null,
  onTrigger,
  isRunning = false,
}: PlanCardProps) {
  const [activeTab, setActiveTab] = useState<"actions" | "milestones" | "blockers">("actions");

  if (!plan) {
    return (
      <NotReadyCard
        title="Transformation plan"
        reason="ATOS needs a program objective and at least one phase underway before it can generate the plan."
        onTrigger={onTrigger}
        triggerLabel="Generate plan"
        isRunning={isRunning}
      />
    );
  }

  const timestamp = planGeneratedAt ? new Date(planGeneratedAt).toLocaleString() : "just now";

  return (
    <section className="adam-card p-5">
      <div className="adam-row adam-space-between">
        <div className="adam-stack" style={{ gap: 4 }}>
          <div className="adam-title">Transformation plan</div>
          <div className="adam-micro adam-muted">Updated {timestamp}</div>
        </div>
        <div className="adam-row" style={{ gap: 8 }}>
          <span className={`adam-badge ${plan.confidence >= 0.7 ? "green" : plan.confidence >= 0.45 ? "amber" : "red"}`}>
            {Math.round(plan.confidence * 100)}% confidence
          </span>
          <button
            type="button"
            className="adam-button-ghost"
            onClick={onTrigger}
            disabled={isRunning}
            style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
          >
            {isRunning ? "Updating…" : "Refresh"}
          </button>
        </div>
      </div>

      {criticalPathAnalysis?.sequence?.length ? (
        <div className="mt-4 adam-stack" style={{ gap: 10 }}>
          <div className="flex flex-wrap gap-2">
            {criticalPathAnalysis.sequence.map((node, index) => (
              <React.Fragment key={node.phaseId}>
                <span
                  className={`adam-chip ${node.isBottleneck ? "is-active" : ""}`}
                  style={{
                    fontSize: 11,
                    borderColor: node.isBottleneck ? "rgba(220,38,38,0.35)" : undefined,
                    color: node.isBottleneck ? "#fecaca" : undefined,
                  }}
                >
                  <span className={`adam-badge ${criticalPathBadge(node.status)}`} style={{ padding: "3px 7px", fontSize: 10 }}>
                    {node.status.replace("-", " ")}
                  </span>
                  <span>{node.phaseName || node.phaseId}</span>
                </span>
                {index < criticalPathAnalysis.sequence.length - 1 ? (
                  <span className="adam-micro adam-muted" style={{ lineHeight: "32px" }}>→</span>
                ) : null}
              </React.Fragment>
            ))}
          </div>
          <div className="adam-micro adam-muted">
            {criticalPathAnalysis.currentBottleneck
              ? `Bottleneck: ${criticalPathAnalysis.currentBottleneck.phaseName} · ${criticalPathAnalysis.estimatedCompletionDelta}`
              : criticalPathAnalysis.estimatedCompletionDelta}
          </div>
        </div>
      ) : plan.criticalPath.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {plan.criticalPath.map((phaseId, index) => (
            <React.Fragment key={phaseId}>
              <span className="adam-chip" style={{ fontSize: 11 }}>{phaseId}</span>
              {index < plan.criticalPath.length - 1 ? (
                <span className="adam-micro adam-muted" style={{ lineHeight: "32px" }}>→</span>
              ) : null}
            </React.Fragment>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex gap-1">
        {(["actions", "milestones", "blockers"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`adam-chip ${activeTab === tab ? "is-active" : ""}`}
            style={{ borderRadius: 8, fontSize: 12 }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "actions" ? "Next actions" : tab === "milestones" ? "Milestones" : "Blockers"}
            {tab === "blockers" && plan.blockerSummary.length > 0 ? (
              <span className="adam-badge red" style={{ padding: "1px 5px", fontSize: 10 }}>
                {plan.blockerSummary.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {activeTab === "actions" ? (
        <div className="mt-3 adam-list">
          {plan.nextThreeActions.length === 0 ? (
            <div className="adam-list-item adam-body adam-muted">No actions yet.</div>
          ) : (
            plan.nextThreeActions.map((item, index) => (
              <div key={`${item.phase}-${index}`} className="adam-list-item">
                <div className="adam-row adam-space-between">
                  <div className="adam-body">{item.action}</div>
                  {item.owner ? (
                    <span className="adam-badge slate" style={{ flexShrink: 0 }}>{item.owner}</span>
                  ) : null}
                </div>
                <div className="mt-1 adam-micro adam-muted">{item.phase} · {item.rationale}</div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "milestones" ? (
        <div className="mt-3 adam-list">
          {plan.milestones.length === 0 ? (
            <div className="adam-list-item adam-body adam-muted">No milestones yet.</div>
          ) : (
            plan.milestones.map((milestone) => (
              <div key={milestone.id} className="adam-list-item">
                <div className="adam-row adam-space-between">
                  <div className="adam-body">{milestone.title}</div>
                  <span className={`adam-badge ${STATUS_BADGE[milestone.status] || "slate"}`} style={{ flexShrink: 0 }}>
                    {milestone.status.replace("-", " ")}
                  </span>
                </div>
                <div className="mt-1 adam-micro adam-muted">
                  {milestone.phase}
                  {milestone.dueDate ? ` · Due ${new Date(milestone.dueDate).toLocaleDateString()}` : " · Date TBD"}
                  {milestone.owner ? ` · ${milestone.owner}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {activeTab === "blockers" ? (
        <div className="mt-3 adam-list">
          {plan.blockerSummary.length === 0 ? (
            <div className="adam-list-item adam-body adam-muted">No blockers tracked.</div>
          ) : (
            plan.blockerSummary.map((item, index) => (
              <div key={`${item.phase}-${index}`} className="adam-list-item">
                <div className="adam-row adam-space-between">
                  <div className="adam-body">{item.blocker}</div>
                  <span className={`adam-badge ${SEVERITY_BADGE[item.severity] || "slate"}`} style={{ flexShrink: 0 }}>
                    {item.severity}
                  </span>
                </div>
                <div className="mt-1 adam-micro adam-muted">
                  {item.phase}{item.resolution ? ` · ${item.resolution}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
