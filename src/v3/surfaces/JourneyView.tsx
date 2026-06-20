import React from "react";
import type { ProgramSummary } from "@/new/types";
import { isDecisionOpen, nextActionForPhase, phaseName, phaseTone } from "@/v3/utils";

interface JourneyViewProps {
  program: ProgramSummary | null;
  onOpenPhase: (phaseId: string) => void;
}

export default function JourneyView({ program, onOpenPhase }: JourneyViewProps) {
  const phases = program?.phases || [];

  if (!program) {
    return (
      <div className="v3-empty" style={{ marginTop: 60 }}>
        <div className="v3-empty-icon">⌇</div>
        <div className="v3-empty-title">No journey data yet</div>
        <div className="v3-empty-body">Add phases to your program to see the transformation journey.</div>
      </div>
    );
  }

  if (!phases.length) {
    return (
      <div className="v3-empty" style={{ marginTop: 60 }}>
        <div className="v3-empty-icon">⌇</div>
        <div className="v3-empty-title">No phases in motion yet</div>
        <div className="v3-empty-body">Define the transformation phases for this program to unlock the journey timeline.</div>
      </div>
    );
  }

  const overallProgress = phases.length
    ? Math.round(phases.reduce((sum, phase) => sum + (phase.pct || 0), 0) / phases.length)
    : 0;
  const completeCount = phases.filter((phase) => phase.pct >= 100).length;
  const activePhase = phases.find((phase) => phase.id === program.activePhaseId) || phases[0] || null;
  const activeGateReview = activePhase ? program.gateReviews?.[activePhase.id] || null : null;
  const activeNextAction = activePhase ? nextActionForPhase(program, activePhase.id) : "";
  const activeDecisionCount = activePhase
    ? program.decisionQueue.filter((decision) => decision.phaseId === activePhase.id && isDecisionOpen(decision)).length
    : 0;
  const topRisk = program.risks.find((risk) => risk.severity === "critical" || risk.severity === "high")
    || program.risks[0]
    || null;
  const activeBlocker = program.criticalPath?.currentBottleneck?.reason
    || topRisk?.label
    || "";
  const healthTone = program.healthHeatmap?.overallRag || phaseTone(program.readiness);
  const healthLabel = program.healthHeatmap?.summary
    || (healthTone === "green" ? "Program momentum is strong." : healthTone === "amber" ? "Momentum needs attention." : "Delivery posture needs intervention.");

  return (
    <>
      <div className="v3-section v3-journey-layout">
        {activePhase ? (
          <section className="v3-journey-hero">
            <div className="v3-journey-hero-header">
              <div className="v3-journey-hero-copy">
                <div className="v3-card-title" style={{ marginBottom: 10 }}>Transformation journey</div>
                <h1 className="v3-journey-hero-title">{phaseName(activePhase)} is the current focus</h1>
                <p className="v3-journey-hero-body">
                  {activeNextAction || activePhase.objective || program.objective || "Review the current phase posture and decide what needs to move next."}
                </p>
              </div>

              <div className="v3-journey-hero-status">
                <span className="v3-chip blue">Active phase</span>
                <span className={`v3-chip ${healthTone === "green" ? "green" : healthTone === "amber" ? "amber" : "red"}`}>
                  {healthTone === "green" ? "On track" : healthTone === "amber" ? "Attention" : "Action needed"}
                </span>
                {activeGateReview ? (
                  <span className={`v3-chip ${
                    activeGateReview.status === "approved" || activeGateReview.status === "ready"
                      ? "green"
                      : activeGateReview.status === "remediation-requested"
                        ? "red"
                        : "amber"
                  }`}
                  >
                    {activeGateReview.status.replace(/-/g, " ")}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="v3-journey-hero-grid">
              <div className="v3-journey-glass-card">
                <div className="v3-card-title">Next move</div>
                <div className="v3-journey-glass-value">
                  {activeNextAction || activePhase.objective || "Define the next concrete move for this phase."}
                </div>
              </div>

              <div className="v3-journey-glass-card">
                <div className="v3-card-title">Checkpoint</div>
                <div className="v3-journey-glass-value">
                  {activeGateReview
                    ? `${Math.round(activeGateReview.readinessScore * 100)}% ready`
                    : `${Math.round(activePhase.pct)}% complete`}
                </div>
                <div className="v3-journey-glass-sub">
                  {activeGateReview?.recommendation || "No gate review has been captured for this phase yet."}
                </div>
              </div>

              <div className="v3-journey-glass-card">
                <div className="v3-card-title">Decisions in play</div>
                <div className="v3-journey-glass-value">
                  {activeDecisionCount ? `${activeDecisionCount} open` : "None open"}
                </div>
                <div className="v3-journey-glass-sub">
                  {activeDecisionCount
                    ? "Human input is still needed before the phase can fully advance."
                    : "No unresolved phase decisions are slowing progress right now."}
                </div>
              </div>

              <div className="v3-journey-glass-card">
                <div className="v3-card-title">Blocker watch</div>
                <div className="v3-journey-glass-value">
                  {activeBlocker || "No critical blocker detected"}
                </div>
                <div className="v3-journey-glass-sub">{healthLabel}</div>
              </div>
            </div>

            <div className="v3-journey-hero-actions">
              <button
                type="button"
                className="v3-button primary"
                onClick={() => onOpenPhase(activePhase.id)}
              >
                Open phase detail
              </button>
              <button
                type="button"
                className="v3-button ghost"
                onClick={() => onOpenPhase(activePhase.id)}
              >
                Review readiness
              </button>
            </div>
          </section>
        ) : null}

        <section className="v3-journey-status-grid">
          <div className="v3-journey-status-card">
            <div className="v3-card-title">Overall progress</div>
            <div className="v3-journey-status-value">{overallProgress}%</div>
            <div className="v3-journey-status-sub">Average completion across the full transformation journey.</div>
          </div>

          <div className="v3-journey-status-card">
            <div className="v3-card-title">Phases complete</div>
            <div className="v3-journey-status-value">{completeCount}/{phases.length}</div>
            <div className="v3-journey-status-sub">Completed phases recede so the current waypoint stands out.</div>
          </div>

          <div className="v3-journey-status-card">
            <div className="v3-card-title">Program readiness</div>
            <div className="v3-journey-status-value">{Math.round(program.readiness)}%</div>
            <div className="v3-journey-status-sub">The current delivery posture across risk, decisions, and progress.</div>
          </div>

          <div className="v3-journey-status-card">
            <div className="v3-card-title">Open decisions</div>
            <div className="v3-journey-status-value">{program.decisionQueue.filter(isDecisionOpen).length}</div>
            <div className="v3-journey-status-sub">Decision pressure determines how quickly the journey can move.</div>
          </div>
        </section>
      </div>

      <div className="v3-section" style={{ paddingTop: 0 }}>
        <section className="v3-card v3-journey-timeline">
          <div className="v3-journey-timeline-header">
            <div>
              <div className="v3-card-title" style={{ marginBottom: 8 }}>Phase timeline</div>
              <div className="v3-journey-timeline-title">Follow the transformation from first intent to realised value</div>
            </div>
            <div className="v3-journey-timeline-subtitle">
              Select any phase to open its glass detail sheet and move deeper into the signal.
            </div>
          </div>

          <div className="v3-journey-timeline-rail" />

          {phases.map((phase, index) => {
            const isActive = phase.id === program.activePhaseId;
            const isComplete = phase.pct >= 100;
            const isUpcoming = !isActive && !isComplete && phase.pct <= 0;
            const phaseDecisionCount = program.decisionQueue.filter((decision) => decision.phaseId === phase.id && isDecisionOpen(decision)).length;
            const phaseGateReview = program.gateReviews?.[phase.id];

            return (
              <div
                key={phase.id || index}
                className={`v3-phase-row ${isActive ? "is-active" : ""} ${isComplete ? "is-complete" : ""} ${isUpcoming ? "is-upcoming" : ""}`}
                onClick={() => onOpenPhase(phase.id)}
              >
                <div className="v3-phase-number">{isComplete ? "✓" : index + 1}</div>
                <div className="v3-phase-info">
                  <div className="v3-phase-name">{phaseName(phase)}</div>
                  <div className="v3-phase-meta">
                    {isActive
                      ? activeNextAction || phase.objective || "This phase is steering the current journey."
                      : nextActionForPhase(program, phase.id) || phase.objective || "Phase not yet in motion."}
                  </div>
                  <div className="v3-journey-phase-signals">
                    {isActive ? <span className="v3-chip blue">In focus</span> : null}
                    {phaseGateReview ? (
                      <span className={`v3-chip ${
                        phaseGateReview.status === "approved" || phaseGateReview.status === "ready"
                          ? "green"
                          : phaseGateReview.status === "remediation-requested"
                            ? "red"
                            : "amber"
                      }`}
                      >
                        {phaseGateReview.status.replace(/-/g, " ")}
                      </span>
                    ) : null}
                    {phaseDecisionCount ? <span className="v3-chip muted">{phaseDecisionCount} decisions</span> : null}
                    {isUpcoming ? <span className="v3-chip muted">Upcoming</span> : null}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 4 }}>
                    {phase.pct > 0 ? `${Math.round(phase.pct)}%` : "Not started"}
                  </div>
                  <div className="v3-phase-progress-bar">
                    <div
                      className="v3-phase-progress-fill"
                      style={{ width: `${Math.max(phase.pct, 2)}%` }}
                    />
                  </div>
                </div>
                <span style={{ color: "var(--v3-text-muted)", fontSize: 14 }}>›</span>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
