import React, { useMemo } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { AppView, LessonLearned, ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";

interface ClosureViewProps {
  program: ProgramSummary | null;
  onTriggerClosure: () => void;
  closureIsRunning: boolean;
  onApproveClosure: () => void;
  onArchiveProgram: () => void;
  onNavigate: (view: AppView) => void;
  isSaving?: boolean;
}

const CATEGORY_ORDER: LessonLearned["category"][] = ["process", "technology", "people", "governance"];

function categoryLabel(category: LessonLearned["category"]) {
  if (category === "process") return "Process";
  if (category === "technology") return "Technology";
  if (category === "people") return "People";
  return "Governance";
}

function statusBadge(status: NonNullable<ProgramSummary["closure"]>["status"]) {
  if (status === "approved") return "green";
  if (status === "ready") return "blue";
  if (status === "archived") return "slate";
  return "amber";
}

export function ClosureView({
  program,
  onTriggerClosure,
  closureIsRunning,
  onApproveClosure,
  onArchiveProgram,
  onNavigate,
  isSaving = false,
}: ClosureViewProps) {
  if (!program) {
    return (
      <NotReadyCard
        title="Program closure"
        reason="No active program is available to assess."
      />
    );
  }

  const closure = program.closure;
  const readyPhaseCount = program.phases.filter((phase) => phase.pct >= 90).length;

  if (!closure || closure.status === "not-ready") {
    return (
      <div className="adam-stack" style={{ maxWidth: 960 }}>
        <NotReadyCard
          title="Program closure not yet available"
          reason={closure?.notReadyReason || "All phases must reach 90% readiness before generating a closure pack."}
          onTrigger={onTriggerClosure}
          triggerLabel="Generate closure pack"
          isRunning={closureIsRunning}
        />
        <section className="adam-card p-5">
          <div className="adam-title">Closure readiness</div>
          <div className="mt-3 adam-row adam-space-between">
            <div className="adam-body adam-muted">
              {readyPhaseCount}/{program.phases.length} phases are at or above the closure threshold.
            </div>
            <span className="adam-badge slate">{Math.round((readyPhaseCount / Math.max(program.phases.length, 1)) * 100)}%</span>
          </div>
          <div className="adam-closure-readiness-bar mt-4">
            <span
              className="adam-closure-readiness-fill"
              style={{ width: `${Math.max(6, Math.round((readyPhaseCount / Math.max(program.phases.length, 1)) * 100))}%` }}
            />
          </div>
        </section>
      </div>
    );
  }

  const lessonsByCategory = useMemo(
    () => CATEGORY_ORDER.map((category) => ({
      category,
      items: closure.lessonsLearned.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0),
    [closure.lessonsLearned],
  );

  return (
    <div className={`adam-stack ${closure.status === "archived" ? "adam-closure-archived" : ""}`} style={{ maxWidth: 1080 }}>
      {closure.status === "approved" ? (
        <section className="adam-closure-approved-banner">
          <div className="adam-row adam-space-between" style={{ alignItems: "center" }}>
            <div>
              <div className="adam-title">Closure approved</div>
              <div className="mt-1 adam-body">
                Approved {closure.approvedAt ? new Date(closure.approvedAt).toLocaleString() : "recently"}
                {closure.approvedBy ? ` by ${closure.approvedBy}` : ""}.
              </div>
            </div>
            <button
              type="button"
              className="adam-button"
              onClick={onArchiveProgram}
              disabled={isSaving}
            >
              {isSaving ? "Saving…" : "Archive program"}
            </button>
          </div>
        </section>
      ) : null}

      {closure.status === "archived" ? (
        <section className="adam-card p-5">
          <div className="adam-title">Archived</div>
          <div className="mt-2 adam-body adam-muted">
            Archived on {closure.archivedAt ? new Date(closure.archivedAt).toLocaleString() : "an earlier date"}.
          </div>
        </section>
      ) : null}

      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Program Closure</div>
            <div>
              <span className={`v3-chip ${confidenceTone(closure.confidence)}`} title={confidenceLabel(closure.confidence)}>
                {Math.round(closure.confidence * 100)}% confidence
              </span>
            </div>
            <div className="adam-body adam-muted">
              Executive close-out pack for the transformation, including realised value, lessons, and reusable recommendations.
            </div>
            <div className="adam-micro adam-muted">
              Generated {new Date(closure.generatedAt).toLocaleString()}
            </div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className={`adam-badge ${statusBadge(closure.status)}`}>{closure.status.replace(/-/g, " ")}</span>
            <span className={`adam-badge ${closure.confidence >= 0.7 ? "green" : closure.confidence >= 0.45 ? "amber" : "red"}`}>
              {Math.round(closure.confidence * 100)}% confidence
            </span>
            <span className={`adam-badge ${closure.readinessScore >= 0.85 ? "green" : closure.readinessScore >= 0.65 ? "amber" : "red"}`}>
              {Math.round(closure.readinessScore * 100)}% ready
            </span>
            {closure.status === "ready" ? (
              <button
                type="button"
                className="adam-button"
                onClick={onApproveClosure}
                disabled={isSaving}
              >
                {isSaving ? "Saving…" : "Approve closure"}
              </button>
            ) : null}
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerClosure}
              disabled={closureIsRunning}
            >
              {closureIsRunning ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      </section>

      {closure.status === "ready" && closure.closureDecisionId ? (
        <section className="adam-card p-5" style={{ borderColor: "rgba(217,119,6,0.28)", background: "rgba(217,119,6,0.08)" }}>
          <div className="adam-title">Waiting for sponsor approval</div>
          <div className="mt-2 adam-body adam-muted">
            The closure pack is complete and ready for executive approval.
          </div>
          <button type="button" className="adam-button-ghost mt-4" onClick={() => onNavigate("decisions")}>
            Open decision queue
          </button>
        </section>
      ) : null}

      <section className="adam-grid two">
        <div className="adam-card p-5">
          <div className="adam-title">Benefits summary</div>
          {closure.benefitsSummary ? (
            <div className="adam-stack mt-4">
              <div className="adam-grid two">
                <div className="adam-list-item">
                  <div className="adam-micro adam-muted">Planned</div>
                  <div className="mt-2 adam-body">{closure.benefitsSummary.planned}</div>
                </div>
                <div className="adam-list-item">
                  <div className="adam-micro adam-muted">Realised</div>
                  <div className="mt-2 adam-body">{closure.benefitsSummary.realised}</div>
                </div>
              </div>
              <div className="adam-list-item">
                <div className="adam-micro adam-muted">Gap</div>
                <div className="mt-2 adam-body">{closure.benefitsSummary.gap}</div>
              </div>
              <div className="adam-list-item" style={{ background: "rgba(37,99,235,0.08)" }}>
                <div className="adam-micro adam-muted">Commentary</div>
                <div className="mt-2 adam-body">{closure.benefitsSummary.commentary}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4 adam-list-item adam-body adam-muted">No quantified benefits summary was available for this closure pack.</div>
          )}
        </div>

        <div className="adam-card p-5">
          <div className="adam-title">Recommendations</div>
          <div className="adam-stack mt-4">
            {closure.recommendations.length ? closure.recommendations.map((recommendation, index) => (
              <div key={`${recommendation}-${index}`} className="adam-list-item">
                <div className="adam-row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <span className="adam-badge blue">{index + 1}</span>
                  <div className="adam-body">{recommendation}</div>
                </div>
              </div>
            )) : (
              <div className="adam-list-item adam-body adam-muted">No recommendations were generated yet.</div>
            )}
          </div>
        </div>
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Lessons learned</div>
        <div className="adam-grid two mt-4">
          {lessonsByCategory.length ? lessonsByCategory.map((group) => (
            <div key={group.category} className={`adam-lesson-card ${group.category}`}>
              <div className="adam-row adam-space-between">
                <div className="adam-title">{categoryLabel(group.category)}</div>
                <span className="adam-badge slate">{group.items.length}</span>
              </div>
              <div className="adam-stack mt-4" style={{ gap: 10 }}>
                {group.items.map((lesson, index) => (
                  <div key={`${group.category}-${index}`} className="adam-list-item">
                    <div className="adam-body">{lesson.lesson}</div>
                    <div className="mt-2 adam-row" style={{ flexWrap: "wrap", gap: 8 }}>
                      <span className="adam-badge slate">{lesson.source}</span>
                      <span className="adam-micro adam-muted" style={{ fontStyle: "italic" }}>{lesson.applicability}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )) : (
            <div className="adam-list-item adam-body adam-muted">No lessons were captured in this closure pack yet.</div>
          )}
        </div>
      </section>

      <section className="adam-card p-5">
        <div className="adam-title">Key artifacts</div>
        <div className="adam-stack mt-4">
          {closure.keyArtifacts.length ? closure.keyArtifacts.map((artifact) => (
            <div key={`${artifact.phaseId}-${artifact.name}`} className="adam-list-item">
              <div className="adam-row adam-space-between" style={{ alignItems: "center" }}>
                <div className="adam-stack" style={{ gap: 4 }}>
                  <div className="adam-body" style={{ fontWeight: 600 }}>{artifact.name}</div>
                  <div className="adam-micro adam-muted">{program.phases.find((phase) => phase.id === artifact.phaseId)?.displayName || artifact.phaseId}</div>
                </div>
                <span className={`adam-badge ${artifact.confidenceAtClose >= 0.75 ? "green" : artifact.confidenceAtClose >= 0.45 ? "amber" : "red"}`}>
                  {Math.round(artifact.confidenceAtClose * 100)}%
                </span>
              </div>
            </div>
          )) : (
            <div className="adam-list-item adam-body adam-muted">No artifact highlights were captured.</div>
          )}
        </div>
      </section>
    </div>
  );
}
