import React from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { CriticalPathNode, ProgramSummary } from "@/new/types";

interface CriticalPathViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerCriticalPath: () => void;
}

function statusBadge(status: CriticalPathNode["status"]) {
  if (status === "complete") return "green";
  if (status === "in-progress") return "blue";
  if (status === "blocked") return "red";
  return "slate";
}

export function CriticalPathView({
  program,
  isRunning,
  onTriggerCriticalPath,
}: CriticalPathViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Critical path"
        reason="No active program. Connect Supabase and select a program to begin."
      />
    );
  }

  const criticalPath = program.criticalPath;
  if (!criticalPath) {
    return (
      <NotReadyCard
        title="Critical path"
        reason="ADAM needs meaningful phase progress before it can derive the path to value."
        onTrigger={onTriggerCriticalPath}
        triggerLabel="Derive critical path"
        isRunning={isRunning}
      />
    );
  }

  return (
    <div className="adam-stack" style={{ maxWidth: 1080 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Critical Path</div>
            <div className="adam-body adam-muted">
              The minimum ordered sequence that must stay healthy for value to land on time.
            </div>
            {program.criticalPathGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(program.criticalPathGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <div className="adam-row" style={{ gap: 8 }}>
            <span className={`adam-badge ${criticalPath.confidence >= 0.7 ? "green" : criticalPath.confidence >= 0.45 ? "amber" : "red"}`}>
              {Math.round(criticalPath.confidence * 100)}% confidence
            </span>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerCriticalPath}
              disabled={isRunning}
            >
              {isRunning ? "Re-deriving…" : "Re-derive with ADAM"}
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 8 }}>
          <div className="adam-critical-flow" style={{ minWidth: "max-content" }}>
            {criticalPath.sequence.map((node, index) => (
              <React.Fragment key={node.phaseId}>
                <div className={`adam-critical-node ${node.isBottleneck ? "is-bottleneck" : ""}`}>
                  <div className="adam-row adam-space-between" style={{ gap: 8, alignItems: "flex-start" }}>
                    <span className={`adam-badge ${statusBadge(node.status)}`}>{node.status.replace("-", " ")}</span>
                    {node.isBottleneck ? <span className="adam-badge red">Bottleneck</span> : null}
                  </div>
                  <div className="mt-3 adam-title">{node.phaseName || program.phases.find((phase) => phase.id === node.phaseId)?.displayName || node.phaseId}</div>
                  <div className="mt-2 adam-micro adam-muted">
                    Depends on {node.dependsOn.length ? node.dependsOn.join(", ") : "entry signal"}
                  </div>
                  {node.blockerSummary ? (
                    <div className="mt-2 adam-micro" style={{ color: "#fca5a5" }}>{node.blockerSummary}</div>
                  ) : null}
                </div>
                {index < criticalPath.sequence.length - 1 ? (
                  <div className="adam-critical-arrow" aria-hidden="true">→</div>
                ) : null}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="mt-4 adam-body">
          Estimated completion delta: <strong>{criticalPath.estimatedCompletionDelta}</strong>
        </div>
      </section>

      {criticalPath.currentBottleneck ? (
        <section className="adam-card p-5" style={{ borderColor: "rgba(217,119,6,0.25)", background: "rgba(217,119,6,0.08)" }}>
          <div className="adam-title">Current bottleneck</div>
          <div className="mt-3 adam-heading-lg">{criticalPath.currentBottleneck.phaseName}</div>
          <div className="mt-2 adam-body">{criticalPath.currentBottleneck.reason}</div>
          <div className="mt-3 adam-micro adam-muted">
            {criticalPath.currentBottleneck.linkedRiskId ? `Risk ${criticalPath.currentBottleneck.linkedRiskId}` : "No linked risk"}
            {criticalPath.currentBottleneck.linkedDecisionId ? ` · Decision ${criticalPath.currentBottleneck.linkedDecisionId}` : ""}
          </div>
          <div className="mt-3 adam-list-item">
            <div className="adam-micro adam-muted">Recommended action</div>
            <div className="mt-2 adam-body">{criticalPath.currentBottleneck.recommendedAction}</div>
          </div>
        </section>
      ) : null}

      <section className="adam-card p-5">
        <div className="adam-title">Off critical path</div>
        <div className="mt-3 adam-body adam-muted">
          These phases can slip without changing the current value-delivery date.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {criticalPath.offCriticalPath.length ? criticalPath.offCriticalPath.map((phaseId) => (
            <span key={phaseId} className="adam-chip">
              {program.phases.find((phase) => phase.id === phaseId)?.displayName || phaseId}
            </span>
          )) : (
            <div className="adam-list-item adam-body adam-muted">All tracked phases are currently on the path to value.</div>
          )}
        </div>
      </section>
    </div>
  );
}
