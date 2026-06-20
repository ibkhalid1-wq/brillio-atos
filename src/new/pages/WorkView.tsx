import React, { useMemo } from "react";
import { AgentCard } from "@/new/components/ui/AgentCard";
import { ArtifactCard } from "@/new/components/ui/ArtifactCard";
import { EmptyState } from "@/new/components/ui/EmptyState";
import { GateReviewPanel } from "@/new/components/ui/GateReviewPanel";
import { HealthHeatmap } from "@/new/components/ui/HealthHeatmap";
import { MilestoneCard } from "@/new/components/ui/MilestoneCard";
import { PlanCard } from "@/new/components/ui/PlanCard";
import { ReadinessSignal } from "@/new/components/ui/ReadinessSignal";
import type { AgentCardModel, AppView, Milestone, Persona, ProgramSummary } from "@/new/types";

interface WorkViewProps {
  program: ProgramSummary | null;
  phaseId: string;
  persona: Persona;
  agentCards: AgentCardModel[];
  onNavigate: (view: AppView) => void;
  onSelectPhase: (phaseId: string) => void;
  onRunPhaseAgent: (phaseId: string) => void;
  onTriggerPlan: () => void;
  planIsRunning?: boolean;
  onTriggerMilestones: () => void;
  milestonesIsRunning?: boolean;
  onAddMilestone: (milestone: Omit<Milestone, "id" | "source" | "lastUpdatedAt">) => Promise<void> | void;
  onCompleteMilestone: (milestoneId: string) => Promise<void> | void;
  milestoneSavePending?: boolean;
  gateReviewIsRunning?: boolean;
  onApproveGate: (phaseId: string) => Promise<void> | void;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void> | void;
  onTriggerGateReview: (phaseId: string) => void;
  onTriggerHealthHeatmap: () => void;
  healthHeatmapIsRunning?: boolean;
}

export function WorkView({
  program,
  phaseId,
  persona,
  agentCards,
  onNavigate,
  onSelectPhase,
  onRunPhaseAgent,
  onTriggerPlan,
  planIsRunning = false,
  onTriggerMilestones,
  milestonesIsRunning = false,
  onAddMilestone,
  onCompleteMilestone,
  milestoneSavePending = false,
  gateReviewIsRunning = false,
  onApproveGate,
  onRequestRemediation,
  onTriggerGateReview,
  onTriggerHealthHeatmap,
  healthHeatmapIsRunning = false,
}: WorkViewProps) {
  const phase = useMemo(() => program?.phases.find((entry) => entry.id === phaseId) || null, [phaseId, program]);
  const phaseArtifacts = useMemo(() => (program?.artifacts || []).filter((artifact) => artifact.phaseId === phaseId), [phaseId, program]);
  const phaseAgent = useMemo(() => agentCards.find((card) => card.phaseId === phaseId) || null, [agentCards, phaseId]);
  const openQuestions = useMemo(() => (program?.decisionQueue || []).filter((decision) => decision.phaseId === phaseId).slice(0, 3), [phaseId, program]);
  const gateReview = useMemo(() => (program?.gateReviews || {})[phaseId] || null, [phaseId, program]);

  if (!program || !phase) {
    return (
      <EmptyState
        context="Workspace not ready"
        explanation="ADAM needs an active program and phase selection before it can render a workspace."
        recommendation="Choose a program in the Command Bar and return to Work."
      />
    );
  }

  const visibleArtifacts = persona === "executive"
    ? phaseArtifacts.slice(0, 3)
    : phaseArtifacts;

  return (
    <div className="adam-stack">
      <div className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
          <div className="adam-stack" style={{ gap: 8 }}>
            <div className="adam-micro adam-muted">Work · {phase.id}</div>
            <div className="adam-heading-xl">{phase.displayName}</div>
            <div className="adam-body adam-muted">{phase.objective}</div>
          </div>
          <span className={`adam-badge ${phase.pct >= 75 ? "green" : phase.pct >= 45 ? "amber" : "red"}`}>
            {phase.pct}% ready
          </span>
        </div>
      </div>

      <div className="adam-grid two" style={{ gridTemplateColumns: "minmax(0,1.35fr) minmax(320px,0.85fr)" }}>
        <div className="adam-stack">
          <div className="adam-card p-5">
            <div className="adam-row adam-space-between">
              <div className="adam-title">Artifacts</div>
              <button type="button" className="adam-button" onClick={() => onRunPhaseAgent(phase.id)}>
                Generate artifact
              </button>
            </div>
            <div className="mt-4 adam-stack">
              {visibleArtifacts.length ? visibleArtifacts.map((artifact) => (
                <ArtifactCard key={artifact.id} {...artifact} />
              )) : (
                <EmptyState
                  context="No artifacts in this phase"
                  explanation="Artifacts become the living outputs of this workspace as ADAM and the team make progress."
                  recommendation="Run the phase agent to draft the first artifact or create it through Copilot."
                  generateLabel="Generate with ADAM"
                  onGenerate={() => onRunPhaseAgent(phase.id)}
                />
              )}
            </div>
          </div>

          {(phase.pct >= 85 || gateReview) ? (
            <GateReviewPanel
              review={gateReview}
              phaseName={phase.displayName}
              pct={phase.pct}
              isRunning={gateReviewIsRunning}
              onApprove={() => void onApproveGate(phase.id)}
              onRequestRemediation={(note) => void onRequestRemediation(phase.id, note)}
              onTrigger={() => onTriggerGateReview(phase.id)}
            />
          ) : null}
        </div>

        <div className="adam-stack">
          {phaseAgent ? (
            <AgentCard
              {...phaseAgent}
              onViewTrace={() => onNavigate("intelligence")}
            />
          ) : (
            <EmptyState
              context="No active agent yet"
              explanation="This phase has not produced a recent run or handoff."
              recommendation="Kick off the phase agent to get artifacts, open questions, and a recommended next move."
              generateLabel="Run phase agent"
              onGenerate={() => onRunPhaseAgent(phase.id)}
            />
          )}

          <ReadinessSignal
            canProceed={phase.pct >= 75}
            readinessScore={phase.pct}
            blockers={program.risks.slice(0, 3).map((risk) => ({
              label: risk.label,
              severity: risk.severity === "critical" ? "critical" : risk.severity === "high" ? "high" : "medium",
              action: risk.action,
              actionView: "decisions" as AppView,
            }))}
            topRisks={program.risks.slice(0, 3).map((risk) => ({
              label: risk.label,
              severity: risk.severity === "critical" ? "high" : risk.severity === "high" ? "high" : risk.severity === "medium" ? "medium" : "low",
            }))}
            phase={phase.displayName}
            onAction={onNavigate}
          />

          <PlanCard
            plan={program.plan}
            planGeneratedAt={program.planGeneratedAt}
            criticalPathAnalysis={program.criticalPath}
            onTrigger={onTriggerPlan}
            isRunning={planIsRunning}
          />

          <MilestoneCard
            milestones={program.milestones}
            phases={program.phases}
            milestonesGeneratedAt={program.milestonesGeneratedAt}
            onTrigger={onTriggerMilestones}
            isRunning={milestonesIsRunning}
            onAddMilestone={onAddMilestone}
            onCompleteMilestone={onCompleteMilestone}
            isSaving={milestoneSavePending}
          />

          <div className="adam-card p-5">
            <div className="adam-title">Open questions</div>
            <div className="mt-4 adam-list">
              {openQuestions.length ? openQuestions.map((question) => (
                <div key={question.id} className="adam-list-item">
                  <div className="adam-body">{question.question}</div>
                  <div className="mt-2 adam-micro adam-muted">{question.title}</div>
                </div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No unresolved questions in this phase right now.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="adam-card p-5">
        <div className="adam-title">Progress thread</div>
        <div className="mt-4 flex flex-wrap gap-3">
          {program.phases.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`adam-chip ${entry.id === phaseId ? "is-active" : ""}`}
              onClick={() => onSelectPhase(entry.id)}
            >
              <span>{entry.displayName}</span>
              <span className="adam-micro adam-muted">{entry.pct}%</span>
            </button>
          ))}
        </div>
      </div>

      {program.healthHeatmap ? (
        <div className="adam-card p-5">
          <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div className="adam-stack" style={{ gap: 6 }}>
              <div className="adam-title">Program health</div>
              <div className="adam-body adam-muted">
                Use the heatmap to see where confidence, momentum, or risk is changing across the lifecycle.
              </div>
            </div>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerHealthHeatmap}
              disabled={healthHeatmapIsRunning}
            >
              {healthHeatmapIsRunning ? "Refreshing…" : "Refresh health"}
            </button>
          </div>
          <div className="mt-5">
            <HealthHeatmap
              heatmap={program.healthHeatmap}
              compact
              onSelectPhase={(nextPhaseId) => onSelectPhase(nextPhaseId)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
