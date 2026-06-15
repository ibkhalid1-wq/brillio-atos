import React from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { ProgramSummary } from "@/new/types";

interface ChangeImpactViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerChangeImpact: () => void;
}

function badgeClass(value: "critical" | "high" | "medium" | "low") {
  if (value === "critical" || value === "high") return "red";
  if (value === "medium") return "amber";
  return "green";
}

export function ChangeImpactView({
  program,
  isRunning,
  onTriggerChangeImpact,
}: ChangeImpactViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Change Impact Assessment"
        reason="No active program. Connect Supabase and choose a program to begin."
      />
    );
  }

  const assessment = program.changeImpact;
  if (!assessment) {
    return (
      <NotReadyCard
        title="Change Impact Assessment"
        reason="ATOS needs at least one phase underway to assess organisational change load."
        onTrigger={onTriggerChangeImpact}
        triggerLabel="Assess change impact"
        isRunning={isRunning}
      />
    );
  }

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Change Impact Assessment</div>
            <div className="adam-body adam-muted">{assessment.summary}</div>
            {program.changeImpactGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(program.changeImpactGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="adam-button-ghost"
            onClick={onTriggerChangeImpact}
            disabled={isRunning}
          >
            {isRunning ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="adam-row" style={{ gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <span className={`adam-badge ${badgeClass(assessment.overallChangeLoad === "low" ? "low" : assessment.overallChangeLoad === "medium" ? "medium" : "high")}`}>
            {assessment.overallChangeLoad} change load
          </span>
          <span className={`adam-badge ${badgeClass(assessment.resistanceRisk === "low" ? "low" : assessment.resistanceRisk === "medium" ? "medium" : "high")}`}>
            {assessment.resistanceRisk} resistance risk
          </span>
          <span className="adam-badge blue">{assessment.peakChangeWindow || "Peak window TBD"}</span>
          <span className="adam-badge slate">{Math.round(assessment.confidence * 100)}% confidence</span>
        </div>
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Cross-cutting interventions</div>
        <div className="mt-4 adam-grid two">
          {assessment.topInterventions.length ? assessment.topInterventions.map((item, index) => (
            <div key={`${item}-${index}`} className="adam-list-item">
              <div className="adam-row" style={{ gap: 10, alignItems: "flex-start" }}>
                <span className="adam-badge blue">{index + 1}</span>
                <div className="adam-body">{item}</div>
              </div>
            </div>
          )) : (
            <div className="adam-list-item adam-body adam-muted">No interventions recommended yet.</div>
          )}
        </div>
      </section>

      <div className="adam-grid two">
        {assessment.impactedGroups.length ? assessment.impactedGroups.map((group) => (
          <section key={group.group} className={`adam-card p-5 ${isRunning ? "animate-pulse" : ""}`}>
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12 }}>
              <div className="adam-stack" style={{ gap: 4 }}>
                <div className="adam-title">{group.group}</div>
                <div className="adam-micro adam-muted">
                  {group.affectedHeadcount !== null ? `${group.affectedHeadcount} affected` : "Headcount not confirmed"}
                  {group.owner ? ` · Owner ${group.owner}` : ""}
                </div>
              </div>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span className={`adam-badge ${badgeClass(group.impactLevel)}`}>{group.impactLevel}</span>
                <span className="adam-badge slate">{group.changeType}</span>
              </div>
            </div>

            <div className="mt-4 adam-stack" style={{ gap: 8 }}>
              <div className="adam-row adam-space-between">
                <span className="adam-micro adam-muted">Readiness</span>
                <span className="adam-micro">{Math.round(group.readinessScore * 100)}%</span>
              </div>
              <div className="adam-progress">
                <span style={{ width: `${Math.round(group.readinessScore * 100)}%` }} />
              </div>
            </div>

            <div className="mt-4 adam-title">Interventions</div>
            <div className="mt-3 adam-list">
              {group.interventions.length ? group.interventions.map((item, index) => (
                <div key={`${group.group}-${index}`} className="adam-list-item adam-body">{item}</div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No group-specific interventions recommended.</div>
              )}
            </div>
          </section>
        )) : (
          <section className="adam-card p-5">
            <div className="adam-body adam-muted">No impacted groups were identified in the current context.</div>
          </section>
        )}
      </div>
    </div>
  );
}
