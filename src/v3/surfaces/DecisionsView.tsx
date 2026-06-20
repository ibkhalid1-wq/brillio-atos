import React, { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { isDecisionOpen, phaseNameById, timeAgo } from "@/v3/utils";

interface DecisionsViewProps {
  program: ProgramSummary | null;
  onResolveDecision: (decisionId: string, resolution: "approved" | "deferred") => Promise<void> | void;
}

function priorityColor(priority: string): "red" | "amber" | "muted" {
  if (priority === "critical") return "red";
  if (priority === "high") return "amber";
  return "muted";
}

function decisionTrackLabel(type: string): string {
  if (type === "gate-approval") return "Gate";
  if (type === "pcr-review") return "Change";
  return "Decision";
}

function decisionGroupSubtitle(groupName: string): string {
  if (groupName === "Gate approvals") return "Checkpoint decisions required to move the program forward.";
  if (groupName === "Change requests") return "Requests that can reshape scope, schedule, or investment posture.";
  return "Cross-program choices that still need executive direction.";
}

export default function DecisionsView({
  program,
  onResolveDecision,
}: DecisionsViewProps) {
  const open = (program?.decisionQueue || []).filter(isDecisionOpen);

  const groups = useMemo(() => ({
    "Gate approvals": open.filter((decision) => decision.type === "gate-approval"),
    "Change requests": open.filter((decision) => decision.type === "pcr-review"),
    Other: open.filter((decision) => decision.type !== "gate-approval" && decision.type !== "pcr-review"),
  }), [open]);

  const groupedEntries = useMemo(() => (
    Object.entries(groups).filter(([, items]) => items.length)
  ), [groups]);

  const urgentCount = open.filter((decision) => (
    decision.priority === "critical" || decision.priority === "high"
  )).length;

  const recommendedCount = open.filter((decision) => Boolean(decision.recommendation)).length;

  const focusPhaseId = useMemo(() => {
    const counts = open.reduce<Record<string, number>>((accumulator, decision) => {
      if (!decision.phaseId) return accumulator;
      accumulator[decision.phaseId] = (accumulator[decision.phaseId] || 0) + 1;
      return accumulator;
    }, {});

    const topMatch = Object.entries(counts)
      .sort((left, right) => right[1] - left[1])[0];

    return topMatch?.[0] || program?.activePhaseId || "";
  }, [open, program]);

  const focusPhaseName = focusPhaseId
    ? phaseNameById(program, focusPhaseId)
    : (program?.activePhaseName || "Program");

  const focusSummary = urgentCount
    ? `${urgentCount} urgent decision${urgentCount === 1 ? "" : "s"} could change delivery posture quickly.`
    : `${recommendedCount} item${recommendedCount === 1 ? "" : "s"} already include a recommended path to accelerate approval.`;

  if (!open.length) {
    return (
      <div className="v3-section v3-decisions-layout">
        <div className="v3-empty" style={{ marginTop: 60 }}>
          <div className="v3-empty-icon">◈</div>
          <div className="v3-empty-title">No open decisions</div>
          <div className="v3-empty-body">New decisions will appear here when they need your input.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="v3-section v3-decisions-layout">
      <section className="v3-decisions-hero">
        <div className="v3-decisions-hero-head">
          <div className="v3-decisions-hero-copy">
            <div className="v3-card-title" style={{ marginBottom: 10 }}>Decision workspace</div>
            <h1 className="v3-decisions-hero-title">Resolve the small set of choices that unlock the next stage of delivery</h1>
            <p className="v3-decisions-hero-body">
              Decisions are grouped by approval track and weighted toward the items most likely to move schedule, scope, and readiness.
            </p>
          </div>

          <div className="v3-decisions-hero-status">
            <span className="v3-chip blue">{open.length} pending</span>
            {urgentCount ? <span className="v3-chip red">{urgentCount} urgent</span> : null}
            {recommendedCount ? <span className="v3-chip green">{recommendedCount} recommended</span> : null}
          </div>
        </div>

        <div className="v3-decisions-hero-grid">
          <div className="v3-decisions-glass-card">
            <div className="v3-card-title">Queue pressure</div>
            <div className="v3-decisions-glass-value">{open.length}</div>
            <div className="v3-decisions-glass-sub">{focusSummary}</div>
          </div>

          <div className="v3-decisions-glass-card">
            <div className="v3-card-title">Current concentration</div>
            <div className="v3-decisions-glass-value is-text">{focusPhaseName}</div>
            <div className="v3-decisions-glass-sub">
              {focusPhaseId
                ? `Most unresolved items are clustering in ${focusPhaseName}. Clear this track to reduce friction across delivery.`
                : "The decision queue is spread across the program rather than concentrated in one phase."}
            </div>
          </div>
        </div>
      </section>

      {groupedEntries.map(([groupName, items]) => {
        return (
          <section key={groupName} className="v3-decision-group-block">
            <div className="v3-decision-group-head">
              <div>
                <div className="v3-decision-group-label">{groupName}</div>
                <div className="v3-decision-group-subtitle">{decisionGroupSubtitle(groupName)}</div>
              </div>
              <span className="v3-chip muted">{items.length} pending</span>
            </div>
            {items.map((decision) => (
              <div key={decision.id} className="v3-decision-card">
                <div className="v3-decision-topline">
                  <div className="v3-decision-meta">
                    <span className={`v3-chip ${priorityColor(decision.priority)}`}>{decision.priority}</span>
                    {decision.phaseId ? <span className="v3-chip blue">{phaseNameById(program, decision.phaseId)}</span> : null}
                    <span className="v3-chip muted">{decisionTrackLabel(decision.type)}</span>
                  </div>
                  <span className="v3-decision-age">{timeAgo(decision.createdAt)}</span>
                </div>

                <div className="v3-decision-question">
                    {decision.question || decision.title}
                </div>

                {decision.recommendation ? (
                  <div className="v3-decision-recommendation">
                    <span className="v3-decision-recommendation-label">Recommended path</span>
                    <span>
                        {decision.recommendation}
                    </span>
                  </div>
                ) : null}

                {decision.options?.length ? (
                  <div className="v3-decision-option-row">
                    {decision.options.slice(0, 3).map((option) => (
                      <span key={option} className="v3-decision-option-chip">{option}</span>
                    ))}
                  </div>
                ) : null}

                <div className="v3-decision-actions">
                  <button
                    className="v3-button primary"
                    style={{ fontSize: 12, padding: "5px 12px" }}
                    onClick={() => onResolveDecision(decision.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    className="v3-button ghost"
                    style={{ fontSize: 12, padding: "5px 12px" }}
                    onClick={() => onResolveDecision(decision.id, "deferred")}
                  >
                    Defer
                  </button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
