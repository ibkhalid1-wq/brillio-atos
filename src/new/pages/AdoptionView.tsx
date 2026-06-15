import React from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";

interface AdoptionViewProps {
  program: ProgramSummary | null;
  isRunning: boolean;
  onTriggerAdoption: () => void;
}

function readinessClass(value: "ready" | "at-risk" | "not-ready") {
  if (value === "ready") return "green";
  if (value === "at-risk") return "amber";
  return "red";
}

function trendClass(value: "improving" | "stable" | "declining" | "unknown") {
  if (value === "improving") return "green";
  if (value === "declining") return "red";
  if (value === "stable") return "blue";
  return "slate";
}

export function AdoptionView({
  program,
  isRunning,
  onTriggerAdoption,
}: AdoptionViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Adoption Readiness"
        reason="No active program. Connect Supabase and choose a program to begin."
      />
    );
  }

  const adoption = program.adoption;
  if (!adoption) {
    return (
      <NotReadyCard
        title="Adoption Readiness"
        reason="ATOS needs phases beyond 50% completion to model adoption dynamics."
        onTrigger={onTriggerAdoption}
        triggerLabel="Assess adoption"
        isRunning={isRunning}
      />
    );
  }

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Adoption Readiness</div>
            <div>
              <span className={`v3-chip ${confidenceTone(adoption.confidence)}`} title={confidenceLabel(adoption.confidence)}>
                {Math.round(adoption.confidence * 100)}% confidence
              </span>
            </div>
            <div className="adam-body adam-muted">{adoption.summary}</div>
            {program.adoptionGeneratedAt ? (
              <div className="adam-micro adam-muted">
                Updated {new Date(program.adoptionGeneratedAt).toLocaleString()}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="adam-button-ghost"
            onClick={onTriggerAdoption}
            disabled={isRunning}
          >
            {isRunning ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="adam-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 18 }}>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">Overall adoption</div>
            <div className="adam-heading-lg">{Math.round(adoption.overallAdoptionRate * 100)}%</div>
            <span className={`adam-badge ${readinessClass(adoption.goLiveReadiness)}`}>{adoption.goLiveReadiness}</span>
          </div>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">Trend</div>
            <div className="adam-heading-lg">{adoption.adoptionTrend}</div>
            <span className={`adam-badge ${trendClass(adoption.adoptionTrend)}`}>{adoption.adoptionTrend}</span>
          </div>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">Confidence</div>
            <div className="adam-heading-lg">{Math.round(adoption.confidence * 100)}%</div>
            <div className="adam-body adam-muted">Confidence in the current adoption model.</div>
          </div>
        </div>
      </section>

      {adoption.criticalAdoptionRisks.length ? (
        <section className="adam-card p-5" style={{ borderColor: "rgba(220,38,38,0.22)", background: "rgba(220,38,38,0.08)" }}>
          <div className="adam-title">Critical adoption risks</div>
          <div className="mt-4 adam-list">
            {adoption.criticalAdoptionRisks.map((risk, index) => (
              <div key={`${risk}-${index}`} className="adam-list-item adam-body">{risk}</div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="adam-grid two">
        {adoption.adoptionGroups.length ? adoption.adoptionGroups.map((group) => (
          <section key={group.group} className={`adam-card p-5 ${isRunning ? "animate-pulse" : ""}`}>
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12 }}>
              <div className="adam-stack" style={{ gap: 4 }}>
                <div className="adam-title">{group.group}</div>
                <div className="adam-micro adam-muted">Readiness gap: {group.readinessGap}</div>
              </div>
              <span className={`adam-badge ${group.readinessGap === "high" ? "red" : group.readinessGap === "medium" ? "amber" : group.readinessGap === "low" ? "blue" : "green"}`}>
                {group.readinessGap}
              </span>
            </div>

            <div className="mt-4 adam-stack" style={{ gap: 10 }}>
              {[
                ["Adoption", group.adoptionRate],
                ["Training", group.trainingCompletion],
                ["Tool utilisation", group.toolUtilisation],
              ].map(([label, score]) => (
                <div key={label} className="adam-stack" style={{ gap: 6 }}>
                  <div className="adam-row adam-space-between">
                    <span className="adam-micro adam-muted">{label}</span>
                    <span className="adam-micro">{Math.round(Number(score) * 100)}%</span>
                  </div>
                  <div className="adam-progress">
                    <span style={{ width: `${Math.round(Number(score) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 adam-title">Barriers</div>
            <div className="mt-3 adam-list">
              {group.barriers.length ? group.barriers.map((barrier, index) => (
                <div key={`${group.group}-barrier-${index}`} className="adam-list-item adam-body">{barrier}</div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No acute barriers identified.</div>
              )}
            </div>

            <div className="mt-4 adam-title">Recommended interventions</div>
            <div className="mt-3 adam-list">
              {group.recommendedInterventions.length ? group.recommendedInterventions.map((item, index) => (
                <div key={`${group.group}-intervention-${index}`} className="adam-list-item adam-body">{item}</div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No group-specific interventions suggested yet.</div>
              )}
            </div>
          </section>
        )) : (
          <section className="adam-card p-5">
            <div className="adam-body adam-muted">No adoption groups were identified in the current context.</div>
          </section>
        )}
      </div>
    </div>
  );
}
