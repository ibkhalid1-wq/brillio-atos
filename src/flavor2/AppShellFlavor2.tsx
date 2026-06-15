/**
 * Legacy shell
 *
 * This shell is no longer mounted by `src/main.jsx`.
 * Keep it only as a reference/archive while V3 remains the live shell.
 *
 * Active shell:
 * - `src/v3/AppShellV3.tsx`
 *
 * Shared modules that should continue evolving:
 * - `src/new/pages/*`
 * - `src/new/lib/*`
 * - `src/new/components/*`
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentRun } from "@/hooks/useAgentRun";
import { buildAgentActivityMap, buildAgentCards, buildNudges, formatCurrency, PHASE_SEQUENCE } from "@/new/lib/programData";
import { useAgentTriggers } from "@/new/lib/useAgentTriggers";
import { useBudgetTracking } from "@/new/lib/useBudgetTracking";
import { useClosure } from "@/new/lib/useClosure";
import { useMilestones } from "@/new/lib/useMilestones";
import { usePrograms } from "@/new/lib/usePrograms";
import { AcceleratorsView } from "@/new/pages/AcceleratorsView";
import { AdoptionView } from "@/new/pages/AdoptionView";
import { BudgetView } from "@/new/pages/BudgetView";
import { ChangeImpactView } from "@/new/pages/ChangeImpactView";
import { ClosureView } from "@/new/pages/ClosureView";
import { CriticalPathView } from "@/new/pages/CriticalPathView";
import { DeckView } from "@/new/pages/DeckView";
import { DecisionsView } from "@/new/pages/DecisionsView";
import { HealthHeatmapView } from "@/new/pages/HealthHeatmapView";
import { IntelligenceView } from "@/new/pages/IntelligenceView";
import { MilestoneView } from "@/new/pages/MilestoneView";
import { NarrativeView } from "@/new/pages/NarrativeView";
import { PlanView } from "@/new/pages/PlanView";
import { RetroView } from "@/new/pages/RetroView";
import { RisksView } from "@/new/pages/RisksView";
import { ScopePcrView } from "@/new/pages/ScopePcrView";
import { StakeholderView } from "@/new/pages/StakeholderView";
import { TwinView } from "@/new/pages/TwinView";
import type { AppView, ProgramSummary } from "@/new/types";
import "@/new/styles.css";
import "./flavor2.css";

type PhaseTone = "green" | "amber" | "red" | "gray";
type WorkspaceView = "overview" | "copilot" | "artifacts" | "context";
type ShellSection = "command" | "workspaces" | "intelligence";

type PhaseRecord = {
  id: string;
  name: string;
  readiness: number;
  exitComplete: number;
  exitTotal: number;
  blockers: number;
  nextAction: string;
  purpose: string;
  confidence: number;
  tone: PhaseTone;
  valueImpact: string;
  currentObjective: string;
  currentRisk: string;
  currentBlocker: string;
  eta: string;
  inputs: string[];
  outputs: string[];
  artifacts: string[];
  dependencies: string[];
  exitCriteria: string[];
  copilotMoments: Array<{
    label: string;
    title: string;
    body: string;
    actions: string[];
  }>;
  nextSteps: string[];
};

const EMPTY_PHASE: PhaseRecord = {
  id: "",
  name: "",
  readiness: 0,
  exitComplete: 0,
  exitTotal: 0,
  blockers: 0,
  nextAction: "",
  purpose: "",
  confidence: 0,
  tone: "gray",
  valueImpact: "",
  currentObjective: "",
  currentRisk: "",
  currentBlocker: "",
  eta: "",
  inputs: [],
  outputs: [],
  artifacts: [],
  dependencies: [],
  exitCriteria: [],
  copilotMoments: [],
  nextSteps: [],
};

const TONE_CLASS: Record<PhaseTone, string> = {
  green: "f2-tone-green",
  amber: "f2-tone-amber",
  red: "f2-tone-red",
  gray: "f2-tone-gray",
};

const PRIMARY_WORKSPACE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  agent_arch: "Agent Architecture",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
  delivery: "Delivery",
  adoption: "Adoption",
  titan: "Scenario Planning",
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)));
}

function workspaceLabel(phaseId: string, fallback: string): string {
  return PRIMARY_WORKSPACE_LABELS[phaseId] || fallback;
}

function matchPhaseToken(phaseId: string, phaseName: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const normalized = token.trim().toLowerCase();
  return normalized === phaseId.toLowerCase() || normalized === phaseName.trim().toLowerCase();
}

function toPhaseTone(status: string, pct: number): PhaseTone {
  if (status === "complete" || pct >= 85) return "green";
  if (status === "blocked") return "red";
  if (status === "at-risk" || pct >= 45) return "amber";
  return "gray";
}

function formatEta(targetDate: string | null): string {
  if (!targetDate) return "No target date";
  const due = new Date(targetDate);
  const delta = due.getTime() - Date.now();
  if (!Number.isFinite(delta)) return "No target date";
  const days = Math.round(delta / (1000 * 60 * 60 * 24));
  if (Math.abs(days) < 1) return "Due today";
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? "" : "s"} overdue`;
}

function deriveMission(program: ProgramSummary | null, phases: PhaseRecord[]) {
  if (!program) {
    return {
      programName: "No program selected",
      objective: "",
      narrative: "",
      currentFocus: "",
      expectedValue: "—",
      readiness: 0,
      recommendedNextAction: "",
      transformationHealth: "—",
      businessValue: "—",
      keyRisks: "",
      decisionsNeeded: "0 decisions open",
    };
  }

  const activePhase = phases.find((phase) => phase.id === program.activePhaseId) || phases[0] || EMPTY_PHASE;
  const openDecisionCount = program.decisionQueue.length;
  const topRisks = program.risks
    .filter((risk) => risk.severity === "critical" || risk.severity === "high")
    .slice(0, 3)
    .map((risk) => risk.label);
  const projectedValue = program.budgetTracking?.roi != null && Number.isFinite(program.budgetTracking.roi)
    ? `${program.budgetTracking.roi.toFixed(1)}x ROI`
    : program.valueProjected > 0
      ? formatCurrency(program.valueProjected)
      : "—";
  const deliveredValue = program.valueDelivered > 0 ? formatCurrency(program.valueDelivered) : projectedValue;
  const transformationHealth = program.healthHeatmap?.overallRag
    ? `${program.healthHeatmap.overallRag.charAt(0).toUpperCase()}${program.healthHeatmap.overallRag.slice(1)}`
    : program.readiness >= 75
      ? "On track"
      : program.readiness >= 45
        ? "At risk"
        : "Needs attention";

  return {
    programName: program.name || "Unnamed program",
    objective: program.objective || "",
    narrative: program.narrative || "ATOS will generate a program narrative once phases have measurable progress.",
    currentFocus: activePhase.currentObjective || activePhase.nextAction || program.activePhaseName || "",
    expectedValue: projectedValue,
    readiness: program.readiness,
    recommendedNextAction: activePhase.nextAction || "",
    transformationHealth,
    businessValue: deliveredValue,
    keyRisks: topRisks.length ? topRisks.join(", ") : (program.criticalPath?.currentBottleneck?.phaseName || ""),
    decisionsNeeded: `${openDecisionCount} decision${openDecisionCount === 1 ? "" : "s"} open`,
  };
}

function deriveMissionBrief(program: ProgramSummary | null, selectedPhase: PhaseRecord, recommendations: Array<{ title: string; body: string }>) {
  if (!program) {
    return {
      title: "ATOS Recommendation",
      objective: "",
      risk: "",
      recommendation: "",
      questions: [],
    };
  }

  return {
    title: "ATOS Recommendation",
    objective: selectedPhase.currentObjective,
    risk: selectedPhase.currentRisk,
    recommendation: recommendations[0]
      ? `${recommendations[0].title}. ${recommendations[0].body}`
      : selectedPhase.nextAction,
    questions: uniqueStrings([
      ...program.decisionQueue.slice(0, 3).map((decision) => decision.question),
      "Refresh narrative",
      "Review blockers",
    ]).slice(0, 3),
  };
}

function derivePhaseRecords(program: ProgramSummary | null): PhaseRecord[] {
  if (!program) return [];

  return program.phases.map((phase) => {
    const phaseArtifacts = program.artifacts.filter((artifact) => artifact.phaseId === phase.id);
    const gateReview = program.gateReviews[phase.id] || null;
    const phaseMilestones = program.milestones.filter((milestone) => milestone.phaseId === phase.id);
    const phaseDecisions = program.decisionQueue.filter((decision) => decision.phaseId === phase.id);
    const phaseRisks = program.raidEntries.filter((entry) => entry.phase === phase.id && entry.status !== "closed");
    const planActions = (program.plan?.nextThreeActions || []).filter((action) => (
      matchPhaseToken(phase.id, phase.displayName, action.phase)
    ));
    const exitCriteria = gateReview?.exitCriteriaStatus?.map((criterion) => criterion.criterion) ?? [];
    const exitComplete = gateReview?.exitCriteriaStatus?.filter((criterion) => criterion.met).length ?? 0;
    const exitTotal = exitCriteria.length || 1;
    const blockers = phaseRisks.filter((entry) => entry.type === "blocker" || entry.severity === "critical" || entry.severity === "high").length;
    const topRisk = program.risks.find((risk) => risk.severity === "critical" || risk.severity === "high");
    const heatmapPhase = program.healthHeatmap?.phaseHealth.find((entry) => entry.phaseId === phase.id) || null;
    const rag = heatmapPhase?.rag ?? (phase.pct >= 75 ? "green" : phase.pct >= 45 ? "amber" : "red");
    const tone: PhaseTone = rag === "green" ? "green" : rag === "amber" ? "amber" : rag === "red" ? "red" : "gray";
    const currentRisk = topRisk?.label || "";
    const currentBlocker = phaseRisks.find((entry) => entry.type === "blocker")?.title
      || phaseRisks[0]?.title
      || phaseRisks[0]?.description
      || "";
    const nextAction = planActions[0]?.action
      || phaseDecisions[0]?.title
      || gateReview?.recommendation
      || "";
    const artifactTitles = uniqueStrings([
      ...phaseArtifacts.map((artifact) => artifact.title),
      ...((gateReview?.artifactsSummary || []).map((artifact) => artifact.name)),
    ]);
    const dependencyTitles = uniqueStrings([
      ...phaseMilestones.flatMap((milestone) => milestone.dependsOn),
      ...phaseRisks.filter((entry) => entry.type === "dependency").map((entry) => entry.title),
    ]);
    const nextSteps = uniqueStrings([
      ...planActions.map((action) => action.action),
      ...phaseDecisions.map((decision) => decision.question),
    ]);
    const copilotMoments = [
      {
        label: "Phase signal",
        title: nextAction,
        body: planActions[0]?.rationale
          || gateReview?.recommendation
          || "ATOS has identified the next best move based on current phase evidence.",
        actions: ["Run phase agent", "Refresh narrative"],
      },
      {
        label: gateReview ? "Gate review" : "Review",
        title: gateReview
          ? `${phase.displayName} gate is ${gateReview.status.replace(/-/g, " ")}`
          : (phaseRisks[0]?.title || "Review current blockers"),
        body: gateReview?.recommendation
          || currentBlocker
          || "Review current blockers and open decisions before progressing.",
        actions: ["Run gate review", "Review blockers"],
      },
    ];
    const nearestMilestone = phaseMilestones
      .filter((milestone) => milestone.targetDate)
      .sort((left, right) => new Date(left.targetDate || "").getTime() - new Date(right.targetDate || "").getTime())[0];

    return {
      id: phase.id,
      name: workspaceLabel(phase.id, phase.displayName),
      readiness: Math.round(phase.pct),
      exitComplete,
      exitTotal,
      blockers,
      nextAction,
      purpose: phase.displayName || phase.objective || phase.id,
      confidence: gateReview?.readinessScore != null
        ? Math.round(gateReview.readinessScore) // already 0–100 after normalisation in deriveGateReviews
        : Math.round(phase.pct * 0.9),
      tone,
      valueImpact: planActions[0]?.rationale || "",
      currentObjective: phaseDecisions[0]?.question || planActions[0]?.action || "",
      currentRisk,
      currentBlocker,
      eta: nearestMilestone?.targetDate ? formatEta(nearestMilestone.targetDate) : "",
      inputs: [],
      outputs: uniqueStrings([
        ...phaseMilestones.map((milestone) => milestone.title),
        ...artifactTitles,
      ]).slice(0, 4),
      artifacts: artifactTitles.slice(0, 6),
      dependencies: dependencyTitles.slice(0, 6),
      exitCriteria,
      copilotMoments,
      nextSteps,
    };
  });
}

function derivePhaseRecommendations(
  program: ProgramSummary | null,
  phases: PhaseRecord[],
  selectedPhaseId: string,
  nudgeItems: ReturnType<typeof buildNudges>,
) {
  if (!program) return [];

  const selectedPhase = phases.find((phase) => phase.id === selectedPhaseId) || phases[0] || EMPTY_PHASE;
  const recommendations = (program.plan?.nextThreeActions || [])
    .filter((action) => matchPhaseToken(selectedPhase.id, selectedPhase.name, action.phase))
    .map((action) => ({
      title: action.action,
      body: action.rationale || "ATOS recommends this next move based on current phase evidence.",
      phaseId: selectedPhase.id,
    }));

  if (recommendations.length) return recommendations;

  const decisionRecommendations = program.decisionQueue
    .filter((decision) => decision.phaseId === selectedPhase.id)
    .slice(0, 3)
    .map((decision) => ({
      title: decision.title,
      body: decision.question,
      phaseId: selectedPhase.id,
    }));

  if (decisionRecommendations.length) return decisionRecommendations;

  const nudgeRecommendations = nudgeItems.slice(0, 3).map((nudge) => ({
    title: nudge.actionLabel || nudge.message,
    body: nudge.message,
    phaseId: selectedPhase.id,
  }));

  return nudgeRecommendations.length ? nudgeRecommendations : [];
}

function deriveJourneyNodes(phases: PhaseRecord[]) {
  return phases.map((phase) => ({
    title: phase.name,
    subtitle: phase.nextAction,
    detail: phase.currentObjective,
    phaseId: phase.id,
  }));
}

const ROUTE_ALIASES: Record<string, { view: AppView; phaseId?: string }> = {
  accelerators: { view: "accelerators" },
  marketplace: { view: "accelerators" },
  assets: { view: "accelerators" },
  titan: { view: "intelligence" },
  "scenario-planning": { view: "intelligence" },
  stakeholder: { view: "stakeholders" },
  stakeholders: { view: "stakeholders" },
  adoption: { view: "adoption" },
  "adoption-insights": { view: "adoption" },
  criticalpath: { view: "critical-path" },
  "critical-path": { view: "critical-path" },
  changeimpact: { view: "change-impact" },
  "change-impact": { view: "change-impact" },
  milestones: { view: "milestones" },
  milestone: { view: "milestones" },
};

const ROUTE_TABS: Array<{ view: AppView; label: string }> = [
  { view: "home", label: "Command" },
  { view: "narrative", label: "Narrative" },
  { view: "plan", label: "Plan" },
  { view: "milestones", label: "Milestones" },
  { view: "decisions", label: "Decisions" },
  { view: "intelligence", label: "Intelligence" },
  { view: "risks", label: "Risks" },
  { view: "budget", label: "Budget" },
  { view: "critical-path", label: "Critical Path" },
  { view: "change-impact", label: "Change Impact" },
  { view: "stakeholders", label: "Stakeholders" },
  { view: "adoption", label: "Adoption" },
  { view: "health-heatmap", label: "Health" },
  { view: "retro", label: "Retro" },
  { view: "deck", label: "Deck" },
  { view: "scope-pcr", label: "Scope & PCR" },
  { view: "closure", label: "Closure" },
  { view: "twin", label: "Twin" },
  { view: "accelerators", label: "Accelerators" },
];

const COMMAND_CENTER_TABS: Array<{ view: AppView; label: string }> = [
  { view: "home", label: "Overview" },
  { view: "narrative", label: "Narrative" },
  { view: "plan", label: "Plan" },
  { view: "milestones", label: "Milestones" },
  { view: "decisions", label: "Decisions" },
  { view: "risks", label: "Risks" },
  { view: "budget", label: "Budget" },
  { view: "critical-path", label: "Critical Path" },
  { view: "closure", label: "Closure" },
];

const INTELLIGENCE_TABS: Array<{ view: AppView; label: string }> = [
  { view: "intelligence", label: "Scenario Planning" },
  { view: "twin", label: "Twin" },
  { view: "change-impact", label: "Change Impact" },
  { view: "stakeholders", label: "Stakeholders" },
  { view: "adoption", label: "Adoption" },
  { view: "health-heatmap", label: "Health" },
  { view: "retro", label: "Retro" },
  { view: "deck", label: "Deck" },
  { view: "scope-pcr", label: "Scope & PCR" },
  { view: "accelerators", label: "Accelerators" },
];

function getShellSection(view: AppView): ShellSection {
  if (view === "work") return "workspaces";
  if (
    view === "intelligence"
    || view === "twin"
    || view === "change-impact"
    || view === "stakeholders"
    || view === "adoption"
    || view === "health-heatmap"
    || view === "retro"
    || view === "deck"
    || view === "scope-pcr"
    || view === "accelerators"
  ) {
    return "intelligence";
  }
  return "command";
}

function parseLocation(): { view: AppView; phaseId?: string } {
  const path = typeof window !== "undefined" ? window.location.pathname.replace(/^\/+/, "") : "";
  if (!path) return { view: "home" };
  if (ROUTE_ALIASES[path]) return ROUTE_ALIASES[path];
  if (path === "twin") return { view: "twin" };
  if (path === "accelerators") return { view: "accelerators" };
  if (path === "narrative") return { view: "narrative" };
  if (path === "plan") return { view: "plan" };
  if (path === "milestones") return { view: "milestones" };
  if (path === "decisions") return { view: "decisions" };
  if (path === "risks") return { view: "risks" };
  if (path === "budget") return { view: "budget" };
  if (path === "change-impact") return { view: "change-impact" };
  if (path === "stakeholders") return { view: "stakeholders" };
  if (path === "adoption") return { view: "adoption" };
  if (path === "health-heatmap") return { view: "health-heatmap" };
  if (path === "retro") return { view: "retro" };
  if (path === "deck") return { view: "deck" };
  if (path === "scope-pcr") return { view: "scope-pcr" };
  if (path === "closure") return { view: "closure" };
  if (path === "intelligence") return { view: "intelligence" };
  if ((PHASE_SEQUENCE as readonly string[]).includes(path)) return { view: "work", phaseId: path };
  return { view: "home" };
}

function nextPath(view: AppView, phaseId: string) {
  if (view === "home") return "/";
  if (view === "twin") return "/twin";
  if (view === "accelerators") return "/accelerators";
  if (view === "narrative") return "/narrative";
  if (view === "plan") return "/plan";
  if (view === "milestones") return "/milestones";
  if (view === "decisions") return "/decisions";
  if (view === "risks") return "/risks";
  if (view === "budget") return "/budget";
  if (view === "critical-path") return "/critical-path";
  if (view === "change-impact") return "/change-impact";
  if (view === "stakeholders") return "/stakeholders";
  if (view === "adoption") return "/adoption";
  if (view === "health-heatmap") return "/health-heatmap";
  if (view === "retro") return "/retro";
  if (view === "deck") return "/deck";
  if (view === "scope-pcr") return "/scope-pcr";
  if (view === "closure") return "/closure";
  if (view === "intelligence") return "/intelligence";
  return `/${phaseId || "strategy"}`;
}

function PhaseStackCard({
  phase,
  selected,
  onSelect,
}: {
  phase: PhaseRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`f2-phase-stack-card ${selected ? "is-selected" : ""} ${TONE_CLASS[phase.tone]}`}
      onClick={onSelect}
    >
      <div className="f2-phase-stack-ring" aria-hidden="true">
        <svg viewBox="0 0 120 120" className="f2-phase-stack-svg">
          <circle className="f2-phase-stack-track" cx="60" cy="60" r="44" />
          <circle
            className="f2-phase-stack-progress"
            cx="60"
            cy="60"
            r="44"
            style={{
              strokeDasharray: 2 * Math.PI * 44,
              strokeDashoffset: 2 * Math.PI * 44 - ((2 * Math.PI * 44) * phase.readiness) / 100,
            }}
          />
        </svg>
        <div className="f2-phase-stack-ring-center">
          <span>{phase.name}</span>
          <strong>{phase.readiness}%</strong>
        </div>
      </div>
      <div className="f2-phase-stack-copy">
        <div className="f2-phase-stack-top">
          <div>
            <span className="f2-phase-stack-label">{phase.name} phase</span>
            <strong className="f2-phase-stack-title">{phase.purpose}</strong>
          </div>
          <div className="f2-phase-stack-status">
            <span>{phase.exitComplete}/{phase.exitTotal} exit</span>
            <span>{phase.blockers} blockers</span>
          </div>
        </div>
        <div className="f2-phase-stack-next">
          <span>Next action</span>
          <strong>{phase.nextAction}</strong>
        </div>
        <div className="f2-phase-stack-foot">
          <span>{phase.confidence}% confidence</span>
          <span>{phase.eta} remaining</span>
        </div>
      </div>
    </button>
  );
}

export default function AppShellFlavor2() {
  const initialLocation = parseLocation();
  const [activeView, setActiveView] = useState<AppView>(initialLocation.view);
  const [selectedPhaseId, setSelectedPhaseId] = useState(initialLocation.phaseId || "design");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("overview");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const {
    programs,
    activeProgram,
    activeProgramId,
    resolveDecision,
    refreshPrograms,
    isLoading,
    error,
  } = usePrograms();
  const { activeRuns, runAgent, resumeRun } = useAgentRun(activeProgramId);
  const agentCards = useMemo(() => buildAgentCards(activeProgram, activeRuns), [activeProgram, activeRuns]);
  const agentActivityMap = useMemo(() => buildAgentActivityMap(activeRuns), [activeRuns]);
  const narrativeIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "narrative" && run.status === "running"),
    [activeRuns],
  );
  const planIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "plan" && run.status === "running"),
    [activeRuns],
  );
  const milestonesIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "milestone" && run.status === "running"),
    [activeRuns],
  );
  const raidAgentRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "risk" && run.status === "running"),
    [activeRuns],
  );
  const budgetIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "budget" && run.status === "running"),
    [activeRuns],
  );
  const criticalPathIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "critical-path" && run.status === "running"),
    [activeRuns],
  );
  const closureIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "closure" && run.status === "running"),
    [activeRuns],
  );

  const runProgramAgent = useCallback(async ({
    agentId,
    phaseId,
    triggeredBy,
  }: {
    agentId: string;
    phaseId: string;
    triggeredBy: "user" | "trigger";
  }) => {
    if (!activeProgramId) return;
    await runAgent({ agentId, phaseId, triggeredBy });
    await refreshPrograms();
  }, [activeProgramId, refreshPrograms, runAgent]);

  const {
    addMilestone,
    completeMilestone,
    isSaving: milestoneSavePending,
  } = useMilestones(
    activeProgramId,
    activeProgram?.rawData || {},
    refreshPrograms,
  );
  const {
    saveBudgetInputs,
    isSaving: budgetSavePending,
  } = useBudgetTracking(
    activeProgramId,
    activeProgram?.rawData || {},
    refreshPrograms,
  );
  const {
    approveClosure,
    archiveProgram,
    isSaving: closureSavePending,
  } = useClosure(
    activeProgramId,
    activeProgram?.rawData || {},
    refreshPrograms,
  );

  const {
    triggerNarrative,
    triggerPlan,
    triggerRisk,
    triggerMilestones,
    triggerBudget,
    triggerCriticalPath,
    triggerChangeImpact,
    triggerStakeholders,
    triggerAdoption,
    triggerHealthHeatmap,
    triggerRetro,
    triggerDeck,
    triggerScopePcr,
    triggerGateReview,
    triggerEscalation,
    triggerClosure,
    gateReviewRunningPhaseSet,
    escalationIsRunning,
    changeImpactIsRunning,
    stakeholderIsRunning,
    adoptionIsRunning,
    healthHeatmapIsRunning,
    retroRunningPhases,
    deckIsRunning,
    scopePcrIsRunning,
  } = useAgentTriggers({
    programId: activeProgramId,
    activeRuns,
    onRunAgent: runProgramAgent,
    onInvalidate: refreshPrograms,
    narrativeGeneratedAt: activeProgram?.narrativeGeneratedAt || null,
    planGeneratedAt: activeProgram?.planGeneratedAt || null,
    raidGeneratedAt: activeProgram?.raidGeneratedAt || null,
    milestonesGeneratedAt: activeProgram?.milestonesGeneratedAt || null,
    budgetGeneratedAt: activeProgram?.budgetGeneratedAt || null,
    criticalPathGeneratedAt: activeProgram?.criticalPathGeneratedAt || null,
    changeImpactGeneratedAt: activeProgram?.changeImpactGeneratedAt || null,
    stakeholderGeneratedAt: activeProgram?.stakeholderGeneratedAt || null,
    adoptionGeneratedAt: activeProgram?.adoptionGeneratedAt || null,
    healthHeatmapGeneratedAt: activeProgram?.healthHeatmapGeneratedAt || null,
    retrosGeneratedAt: activeProgram?.retrosGeneratedAt || {},
    deckGeneratedAt: activeProgram?.deckGeneratedAt || null,
    scopePcrGeneratedAt: activeProgram?.scopePcrGeneratedAt || null,
    patternExtractGeneratedAt: activeProgram?.patternExtractGeneratedAt || null,
    patternQueryCachedAt: activeProgram?.patternQueryCachedAt || null,
    gateReviews: activeProgram?.gateReviews || {},
    escalationsLastCheckedAt: activeProgram?.escalationsLastCheckedAt || null,
    closureGeneratedAt: activeProgram?.closureGeneratedAt || null,
    phases: activeProgram?.phases || [],
    raidEntries: activeProgram?.raidEntries || [],
    milestones: activeProgram?.milestones || [],
    decisions: activeProgram?.decisionQueue || [],
    closure: activeProgram?.closure || null,
  });

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverflowX: html.style.overflowX,
      bodyOverflow: body.style.overflow,
      bodyOverflowX: body.style.overflowX,
      rootOverflow: root?.style.overflow || "",
      rootHeight: root?.style.height || "",
    };

    html.style.overflow = "auto";
    html.style.overflowX = "hidden";
    body.style.overflow = "auto";
    body.style.overflowX = "hidden";

    if (root) {
      root.style.overflow = "visible";
      root.style.height = "auto";
    }

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.overflowX = previous.htmlOverflowX;
      body.style.overflow = previous.bodyOverflow;
      body.style.overflowX = previous.bodyOverflowX;
      if (root) {
        root.style.overflow = previous.rootOverflow;
        root.style.height = previous.rootHeight;
      }
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = parseLocation();
      setActiveView(next.view);
      if (next.phaseId) {
        setSelectedPhaseId(next.phaseId);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const phaseRecords = useMemo(() => derivePhaseRecords(activeProgram), [activeProgram]);
  const workspacePhaseRecords = useMemo(
    () => phaseRecords.filter((phase) => phase.id !== "titan"),
    [phaseRecords],
  );
  const selectedPhase = useMemo(
    () => workspacePhaseRecords.find((phase) => phase.id === selectedPhaseId) || workspacePhaseRecords[0] || EMPTY_PHASE,
    [selectedPhaseId, workspacePhaseRecords],
  );
  const mission = useMemo(() => deriveMission(activeProgram, phaseRecords), [activeProgram, phaseRecords]);
  const nudges = useMemo(() => buildNudges(activeProgram, activeRuns), [activeProgram, activeRuns]);
  const phaseRecommendations = useMemo(
    () => derivePhaseRecommendations(activeProgram, workspacePhaseRecords, selectedPhase.id, nudges),
    [activeProgram, workspacePhaseRecords, selectedPhase.id, nudges],
  );
  const missionBrief = useMemo(
    () => deriveMissionBrief(activeProgram, selectedPhase, phaseRecommendations),
    [activeProgram, phaseRecommendations, selectedPhase],
  );
  const journeyNodes = useMemo(() => deriveJourneyNodes(workspacePhaseRecords), [workspacePhaseRecords]);
  const primaryCopilotMoment = selectedPhase.copilotMoments[0] ?? null;
  const secondaryCopilotMoment = selectedPhase.copilotMoments[1] ?? null;
  const activePhaseRun = useMemo(
    () => activeRuns.find((run) => run.phase_id === selectedPhase.id && ["queued", "running", "paused"].includes(run.status))
      || activeRuns.find((run) => run.phase_id === "program" && ["queued", "running", "paused"].includes(run.status))
      || null,
    [activeRuns, selectedPhase.id],
  );
  const activeSection = useMemo(() => getShellSection(activeView), [activeView]);
  const sectionHint = useMemo(() => {
    if (activeSection === "workspaces") {
      return `${selectedPhase.name} · ${selectedPhase.readiness}% ready`;
    }
    if (activeSection === "intelligence") {
      return activeProgram?.healthHeatmap?.summary || "Signals, patterns, and forward-looking intelligence";
    }
    return mission.narrative;
  }, [activeProgram, activeSection, mission.narrative, selectedPhase]);
  const workspaceSignals = useMemo(
    () => [
      {
        label: "Readiness",
        value: `${selectedPhase.readiness}%`,
        detail: `${selectedPhase.exitComplete} of ${selectedPhase.exitTotal} exits complete`,
      },
      {
        label: "Blockers",
        value: `${selectedPhase.blockers}`,
        detail: selectedPhase.currentBlocker,
      },
      {
        label: "Value",
        value: selectedPhase.valueImpact,
        detail: "Why this phase matters now",
      },
      {
        label: "Time remaining",
        value: selectedPhase.eta,
        detail: "Estimated to clear this phase",
      },
    ],
    [selectedPhase],
  );

  useEffect(() => {
    if (!workspacePhaseRecords.length) return;
    if (workspacePhaseRecords.some((phase) => phase.id === selectedPhaseId)) return;
    const nextPhaseId = activeProgram?.activePhaseId;
    const nextWorkspacePhase = workspacePhaseRecords.find((phase) => phase.id === nextPhaseId);
    setSelectedPhaseId(nextWorkspacePhase?.id || workspacePhaseRecords[0].id);
  }, [activeProgram, selectedPhaseId, workspacePhaseRecords]);

  useEffect(() => {
    const target = nextPath(activeView, selectedPhaseId);
    if (window.location.pathname !== target) {
      window.history.replaceState({}, "", target);
    }
  }, [activeView, selectedPhaseId]);

  const handleSelectPhase = useCallback((phaseId: string) => {
    setSelectedPhaseId(phaseId);
    setActiveView("work");
    setWorkspaceView("overview");
    window.setTimeout(() => {
      workspaceRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
  }, []);

  const resolveDecisionAction = useCallback(async (
    decision: { id: string; runId?: string; question: string },
    resolution: "approved" | "rejected" | "modified",
    note?: string,
  ) => {
    if (!activeProgram) return;
    const relatedRun = decision.runId ? activeRuns.find((run) => run.id === decision.runId) : undefined;
    if (relatedRun?.awaiting_decision_id) {
      await resumeRun({
        runId: relatedRun.id,
        decisionId: relatedRun.awaiting_decision_id,
        resolution,
        humanNote: note,
      });
    }
    await resolveDecision(activeProgram.id, decision.id, resolution, note);
  }, [activeProgram, activeRuns, resolveDecision, resumeRun]);

  const handleCopilotAction = useCallback((action: string) => {
    const normalized = action.toLowerCase();
    if (normalized.includes("narrative")) {
      triggerNarrative();
      return;
    }
    if (normalized.includes("plan") || normalized.includes("draft") || normalized.includes("package")) {
      triggerPlan();
      return;
    }
    if (normalized.includes("milestone")) {
      triggerMilestones();
      return;
    }
    if (normalized.includes("budget") || normalized.includes("value tracker")) {
      triggerBudget();
      return;
    }
    if (normalized.includes("critical path")) {
      triggerCriticalPath();
      return;
    }
    if (normalized.includes("change") || normalized.includes("workforce") || normalized.includes("blueprint")) {
      triggerChangeImpact();
      return;
    }
    if (normalized.includes("stakeholder")) {
      triggerStakeholders();
      return;
    }
    if (normalized.includes("adoption") || normalized.includes("scorecard")) {
      triggerAdoption();
      return;
    }
    if (normalized.includes("heatmap") || normalized.includes("health")) {
      triggerHealthHeatmap();
      return;
    }
    if (normalized.includes("retro")) {
      triggerRetro(selectedPhase.id);
      return;
    }
    if (normalized.includes("deck")) {
      triggerDeck();
      return;
    }
    if (normalized.includes("pcr") || normalized.includes("scope")) {
      triggerScopePcr();
      return;
    }
    if (normalized.includes("gate") || normalized.includes("approval matrix") || normalized.includes("governance")) {
      triggerGateReview(selectedPhase.id);
      return;
    }
    if (normalized.includes("blocker") || normalized.includes("risk") || normalized.includes("dependency")) {
      setWorkspaceView("context");
      triggerRisk();
      return;
    }
    if (normalized.includes("escalation")) {
      triggerEscalation();
      return;
    }
    if (normalized.includes("closure")) {
      triggerClosure();
      return;
    }
    setWorkspaceView("copilot");
  }, [
    selectedPhase.id,
    triggerAdoption,
    triggerBudget,
    triggerChangeImpact,
    triggerClosure,
    triggerCriticalPath,
    triggerDeck,
    triggerEscalation,
    triggerGateReview,
    triggerHealthHeatmap,
    triggerMilestones,
    triggerNarrative,
    triggerPlan,
    triggerRetro,
    triggerRisk,
    triggerScopePcr,
    triggerStakeholders,
  ]);

  const handleSectionSelect = useCallback((section: ShellSection) => {
    if (section === "command") {
      setActiveView("home");
      return;
    }
    if (section === "workspaces") {
      setActiveView("work");
      return;
    }
    setActiveView("intelligence");
  }, []);

  const renderMissionControl = () => (
    <>
      <section className="f2-hero">
        <div className="f2-hero-copy">
          <div className="f2-eyebrow">Transformation Mission Control</div>
          <h1>{mission.programName}</h1>
          <p>{mission.narrative}</p>
          <div className="f2-hero-objective">
            <div>
              <span>Objective</span>
              <strong>{mission.objective}</strong>
            </div>
            <div>
              <span>Current focus</span>
              <strong>{mission.currentFocus}</strong>
            </div>
            <div>
              <span>Expected annual value</span>
              <strong>{mission.expectedValue}</strong>
            </div>
            <div>
              <span>Overall readiness</span>
              <strong>{mission.readiness}%</strong>
            </div>
          </div>
        </div>
        <div className="f2-hero-recommendation">
          <div className="f2-eyebrow">Recommended next action</div>
          <h2>{mission.recommendedNextAction}</h2>
          <p>{nudges[0]?.message || secondaryCopilotMoment?.body || selectedPhase.currentBlocker}</p>
          <button type="button" className="f2-primary-button" onClick={() => handleSelectPhase(selectedPhase.id)}>
            Open {selectedPhase.name} Workspace
          </button>
        </div>
      </section>

      <section className="f2-focus-shell">
        <aside className="f2-phase-rail">
          <div className="f2-phase-rail-header">
            <div className="f2-eyebrow">Transformation journey</div>
            <h2>Phases</h2>
          </div>
          <div className="f2-phase-stack">
            {workspacePhaseRecords.map((phase) => (
              <PhaseStackCard
                key={phase.id}
                phase={phase}
                selected={phase.id === selectedPhase.id}
                onSelect={() => handleSelectPhase(phase.id)}
              />
            ))}
          </div>
        </aside>

        <section
          id="f2-active-workspace"
          className={`f2-workspace ${TONE_CLASS[selectedPhase.tone]}`}
          ref={workspaceRef}
          key={selectedPhase.id}
        >
        <div className="f2-workspace-header">
          <div>
            <div className="f2-eyebrow">{selectedPhase.name} workspace</div>
            <h2>{selectedPhase.name}</h2>
            <p>{error ? `${selectedPhase.purpose} · ${error}` : selectedPhase.purpose}</p>
          </div>
          <div className="f2-workspace-actions">
            <div className={`f2-workspace-pill ${TONE_CLASS[selectedPhase.tone]}`}>
              {selectedPhase.readiness}% readiness
            </div>
            {activePhaseRun ? (
              <div className="f2-workspace-pill">
                Agent {activePhaseRun.status}
              </div>
            ) : null}
          </div>
        </div>

        <section className="f2-executive-brief">
          <article className="f2-executive-brief-main">
            <span className="f2-eyebrow">Executive brief</span>
            <h3>{selectedPhase.currentObjective}</h3>
            <p>{selectedPhase.valueImpact}</p>
            <div className="f2-brief-callouts">
              <article>
                <span>What is blocking progress</span>
                <strong>{selectedPhase.currentBlocker}</strong>
              </article>
              <article>
                <span>What leadership should watch</span>
                <strong>{selectedPhase.currentRisk}</strong>
              </article>
              <article className="is-action">
                <span>What should happen next</span>
                <strong>{selectedPhase.nextAction}</strong>
              </article>
            </div>
          </article>
        </section>

        <div className="f2-workspace-secondary">
          <div className="f2-workspace-stat">
            <span>Value impact</span>
            <strong>{selectedPhase.valueImpact}</strong>
          </div>
          <div className="f2-workspace-stat">
            <span>Exit progress</span>
            <strong>
              {selectedPhase.exitComplete} of {selectedPhase.exitTotal} complete
            </strong>
          </div>
          <div className="f2-workspace-stat">
            <span>Confidence</span>
            <strong>{selectedPhase.confidence}%</strong>
          </div>
          <div className="f2-workspace-stat">
            <span>Estimated time remaining</span>
            <strong>{selectedPhase.eta}</strong>
          </div>
        </div>

        <div className="f2-workspace-tabs" role="tablist" aria-label={`${selectedPhase.name} workspace views`}>
          {[
            { id: "overview", label: "Overview" },
            { id: "copilot", label: "Copilot" },
            { id: "artifacts", label: "Artifacts" },
            { id: "context", label: "Context" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={workspaceView === tab.id}
              className={`f2-workspace-tab ${workspaceView === tab.id ? "is-active" : ""}`}
              onClick={() => setWorkspaceView(tab.id as WorkspaceView)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {workspaceView === "overview" ? (
          <div className="f2-workspace-grid">
            <div className="f2-workspace-column">
              <article className="f2-panel f2-action-plan-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">What should happen next</span>
                  <h3>Recommended action plan</h3>
                </div>
                {primaryCopilotMoment ? (
                  <div className="f2-action-plan-callout">
                    <div>
                      <span className="f2-eyebrow">ATOS can help now</span>
                      <strong>{primaryCopilotMoment.title}</strong>
                      <p>{primaryCopilotMoment.body}</p>
                    </div>
                    <div className="f2-chip-row f2-chip-row-light">
                      {primaryCopilotMoment.actions.map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="f2-chip-button is-light"
                          onClick={() => handleCopilotAction(action)}
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="f2-action-list f2-action-list-embedded">
                  {phaseRecommendations.map((item, index) => (
                    <button
                      key={item.title}
                      type="button"
                      className="f2-action-item"
                      onClick={() => {
                        handleSelectPhase(item.phaseId);
                        handleCopilotAction(item.title);
                      }}
                    >
                      <span className="f2-action-rank">{index + 1}</span>
                      <div className="f2-action-copy">
                        <strong>{item.title}</strong>
                        <p>{item.body}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="f2-action-plan-steps">
                  <span className="f2-eyebrow">Next steps</span>
                  <div className="f2-step-list">
                    {selectedPhase.nextSteps.map((step, index) => (
                      <div key={step} className="f2-step-list-item">
                        <span>{index + 1}</span>
                        <strong>{step}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            </div>

            <div className="f2-workspace-column">
              <article className="f2-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Executive readout</span>
                  <h3>What leadership should watch</h3>
                </div>
                <div className="f2-signal-grid-compact">
                  {workspaceSignals.map((signal) => (
                    <article key={signal.label} className="f2-signal-card">
                      <span>{signal.label}</span>
                      <strong>{signal.value}</strong>
                      <p>{signal.detail}</p>
                    </article>
                  ))}
                </div>
              </article>

              {selectedPhase.readiness > 0 ? (
                <article className="f2-panel">
                  <div className="f2-panel-heading">
                    <span className="f2-eyebrow">Phase readiness</span>
                    <h3>Gate review</h3>
                  </div>
                  {activeProgram?.gateReviews?.[selectedPhase.id] ? (
                    <div className="f2-brief-grid">
                      <div>
                        <span>Status</span>
                        <strong style={{ textTransform: "capitalize" }}>
                          {String(activeProgram.gateReviews[selectedPhase.id].status).replace("-", " ")}
                        </strong>
                      </div>
                      <div>
                        <span>Readiness score</span>
                        <strong>
                          {Math.round(activeProgram.gateReviews[selectedPhase.id].readinessScore ?? 0)}%
                        </strong>
                      </div>
                      <div className="is-full">
                        <span>Recommendation</span>
                        <strong>{activeProgram.gateReviews[selectedPhase.id].recommendation || "—"}</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="f2-panel-muted">
                      No gate review has been run for this phase yet.
                    </p>
                  )}
                  <div className="f2-chip-row f2-chip-row-light" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="f2-chip-button is-light"
                      disabled={gateReviewRunningPhaseSet.has(selectedPhase.id)}
                      onClick={() => triggerGateReview(selectedPhase.id)}
                    >
                      {gateReviewRunningPhaseSet.has(selectedPhase.id)
                        ? "Running gate review…"
                        : activeProgram?.gateReviews?.[selectedPhase.id]
                          ? "Re-run gate review"
                          : "Run gate review"}
                    </button>
                  </div>
                </article>
              ) : null}
            </div>
          </div>
        ) : null}

        {workspaceView === "copilot" ? (
          <div className="f2-workspace-grid">
            <div className="f2-workspace-column">
              <article className="f2-mission-brief f2-panel-surface">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Copilot mission brief</span>
                  <h3>{missionBrief.title}</h3>
                </div>
                <div className="f2-brief-grid">
                  <div>
                    <span>Current objective</span>
                    <strong>{missionBrief.objective}</strong>
                  </div>
                  <div>
                    <span>Current risk</span>
                    <strong>{missionBrief.risk}</strong>
                  </div>
                  <div className="is-full">
                    <span>Recommended action</span>
                    <strong>{missionBrief.recommendation}</strong>
                  </div>
                </div>
                <div className="f2-chip-row f2-chip-row-light">
                  {missionBrief.questions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="f2-chip-button is-light"
                      onClick={() => handleCopilotAction(question)}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </article>
            </div>
            <div className="f2-workspace-column">
              <article className="f2-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Embedded copilot</span>
                  <h3>ATOS inside the workflow</h3>
                </div>
                <div className="f2-copilot-stack">
                  {selectedPhase.copilotMoments.map((moment) => (
                    <div key={moment.title} className="f2-copilot-card">
                      <span>{moment.label}</span>
                      <strong>{moment.title}</strong>
                      <p>{moment.body}</p>
                      <div className="f2-chip-row">
                        {moment.actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className="f2-chip-button"
                            onClick={() => handleCopilotAction(action)}
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        ) : null}

        {workspaceView === "artifacts" ? (
          <div className="f2-workspace-grid">
            <div className="f2-workspace-column">
              <article className="f2-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Current work</span>
                  <h3>Artifacts and outputs</h3>
                </div>
                <ul className="f2-bullet-list">
                  {selectedPhase.artifacts.map((artifact) => (
                    <li key={artifact}>{artifact}</li>
                  ))}
                </ul>
              </article>
            </div>
            <div className="f2-workspace-column">
              <article className="f2-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Dependencies</span>
                  <h3>What this phase still needs</h3>
                </div>
                <ul className="f2-bullet-list">
                  {selectedPhase.dependencies.map((dependency) => (
                    <li key={dependency}>{dependency}</li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        ) : null}

        {workspaceView === "context" ? (
          <div className="f2-workspace-grid">
            <div className="f2-workspace-column">
              <article className="f2-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Exit criteria</span>
                  <h3>What closes the phase</h3>
                </div>
                <ul className="f2-check-list">
                  {selectedPhase.exitCriteria.map((criterion, index) => (
                    <li key={criterion} className={index < selectedPhase.exitComplete ? "is-complete" : ""}>
                      <span>{index < selectedPhase.exitComplete ? "●" : "○"}</span>
                      {criterion}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
            <div className="f2-workspace-column">
              <article className="f2-panel">
                <div className="f2-panel-heading">
                  <span className="f2-eyebrow">Transformation map</span>
                  <h3>Where this phase sits in the journey</h3>
                </div>
                <div className="f2-canvas-flow f2-canvas-flow-compact">
                  {journeyNodes.map((node, index) => (
                    <React.Fragment key={node.title}>
                      <button
                        type="button"
                        className={`f2-canvas-card ${node.phaseId === selectedPhase.id ? "is-active" : ""}`}
                        onClick={() => handleSelectPhase(node.phaseId)}
                      >
                        <span>{node.title}</span>
                        <strong>{node.subtitle}</strong>
                        <p>{node.detail}</p>
                      </button>
                      {index < journeyNodes.length - 1 ? <div className="f2-canvas-arrow" aria-hidden="true">→</div> : null}
                    </React.Fragment>
                  ))}
                </div>
              </article>
            </div>
          </div>
        ) : null}
        </section>
      </section>
    </>
  );

  const renderCurrentView = () => {
    if (activeView === "home" || activeView === "work") return renderMissionControl();
    if (activeView === "twin") {
      return (
        <div className="f2-page-host">
          <TwinView
            program={activeProgram}
            agentCards={agentCards}
            agentActivityMap={agentActivityMap}
            onOpenWorkspace={handleSelectPhase}
            onViewTrace={() => setActiveView("intelligence")}
          />
        </div>
      );
    }
    if (activeView === "accelerators") {
      return <div className="f2-page-host"><AcceleratorsView program={activeProgram} onNavigate={setActiveView} /></div>;
    }
    if (activeView === "narrative") {
      return <div className="f2-page-host"><NarrativeView program={activeProgram} onRefresh={triggerNarrative} isRunning={narrativeIsRunning} onOpenIntelligence={() => setActiveView("intelligence")} /></div>;
    }
    if (activeView === "plan") {
      return (
        <div className="f2-page-host">
          <PlanView
            program={activeProgram}
            plan={activeProgram?.plan ?? null}
            planGeneratedAt={activeProgram?.planGeneratedAt ?? ""}
            planIsRunning={planIsRunning}
            onTriggerPlan={triggerPlan}
          />
        </div>
      );
    }
    if (activeView === "milestones") {
      return (
        <div className="f2-page-host">
          <MilestoneView
            program={activeProgram}
            milestonesIsRunning={milestonesIsRunning}
            onTriggerMilestones={triggerMilestones}
            onAddMilestone={addMilestone}
            onCompleteMilestone={completeMilestone}
            isSaving={milestoneSavePending}
          />
        </div>
      );
    }
    if (activeView === "decisions") {
      return <div className="f2-page-host"><DecisionsView program={activeProgram} activeRuns={activeRuns} onResolve={resolveDecisionAction} /></div>;
    }
    if (activeView === "intelligence") {
      return <div className="f2-page-host"><IntelligenceView program={activeProgram} onRefreshProgram={refreshPrograms} /></div>;
    }
    if (activeView === "risks") {
      return <div className="f2-page-host"><RisksView program={activeProgram} raidAgentRunning={raidAgentRunning} onTriggerRiskAgent={triggerRisk} onRefresh={refreshPrograms} /></div>;
    }
    if (activeView === "budget") {
      return (
        <div className="f2-page-host">
          <BudgetView
            program={activeProgram}
            budgetIsRunning={budgetIsRunning}
            onTriggerBudget={triggerBudget}
            onSaveBudgetInputs={saveBudgetInputs}
            savePending={budgetSavePending}
          />
        </div>
      );
    }
    if (activeView === "critical-path") {
      return <div className="f2-page-host"><CriticalPathView program={activeProgram} isRunning={criticalPathIsRunning} onTriggerCriticalPath={triggerCriticalPath} /></div>;
    }
    if (activeView === "change-impact") {
      return <div className="f2-page-host"><ChangeImpactView program={activeProgram} isRunning={changeImpactIsRunning} onTriggerChangeImpact={triggerChangeImpact} /></div>;
    }
    if (activeView === "stakeholders") {
      return <div className="f2-page-host"><StakeholderView program={activeProgram} isRunning={stakeholderIsRunning} onTriggerStakeholders={triggerStakeholders} /></div>;
    }
    if (activeView === "adoption") {
      return <div className="f2-page-host"><AdoptionView program={activeProgram} isRunning={adoptionIsRunning} onTriggerAdoption={triggerAdoption} /></div>;
    }
    if (activeView === "health-heatmap") {
      return <div className="f2-page-host"><HealthHeatmapView program={activeProgram} isRunning={healthHeatmapIsRunning} onTriggerHealthHeatmap={triggerHealthHeatmap} onSelectPhase={handleSelectPhase} /></div>;
    }
    if (activeView === "retro") {
      return <div className="f2-page-host"><RetroView program={activeProgram} runningPhases={retroRunningPhases.current} onTriggerRetro={triggerRetro} onOpenIntelligence={() => setActiveView("intelligence")} /></div>;
    }
    if (activeView === "deck") {
      return <div className="f2-page-host"><DeckView program={activeProgram} isRunning={deckIsRunning} onTriggerDeck={triggerDeck} onOpenIntelligence={() => setActiveView("intelligence")} /></div>;
    }
    if (activeView === "scope-pcr") {
      return <div className="f2-page-host"><ScopePcrView program={activeProgram} isRunning={scopePcrIsRunning} onTriggerScopePcr={triggerScopePcr} onNavigate={setActiveView} /></div>;
    }
    if (activeView === "closure") {
      return (
        <div className="f2-page-host">
          <ClosureView
            program={activeProgram}
            onTriggerClosure={triggerClosure}
            closureIsRunning={closureIsRunning}
            onApproveClosure={() => void approveClosure()}
            onArchiveProgram={() => void archiveProgram()}
            onNavigate={setActiveView}
            isSaving={closureSavePending}
          />
        </div>
      );
    }
    return renderMissionControl();
  };

  return (
    <div className="f2-shell">
      <header className="f2-topbar">
        <div className="f2-brand">
          <span className="f2-brand-mark">ATOS</span>
          <span className="f2-brand-subtitle">
            Primary Shell{activeProgram ? ` · ${activeProgram.name}` : ""}
          </span>
        </div>
        <div className="f2-top-actions">
          <button type="button" className="f2-top-button" onClick={() => void refreshPrograms()}>
            {isLoading ? "Syncing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="f2-top-button"
            disabled={escalationIsRunning}
            onClick={() => triggerEscalation()}
          >
            {escalationIsRunning ? "Checking escalations…" : "Check escalations"}
          </button>
          {(activeProgram?.escalations ?? []).some((entry) => entry.status === "open") ? (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "#ef4444",
                display: "inline-block",
                marginLeft: -8,
                marginTop: -12,
                alignSelf: "flex-start",
                flexShrink: 0,
              }}
              aria-label="Open escalations"
            />
          ) : null}
          <button type="button" className="f2-top-button is-accent" onClick={() => {
            setActiveView("home");
            setWorkspaceView("overview");
          }}>
            Current focus: {selectedPhase.name}
          </button>
        </div>
      </header>

      <nav className="f2-routebar" aria-label="Primary shell navigation">
        <div className="f2-section-shell">
          <div className="f2-section-header">
            <div className="f2-section-tabs">
              {([
                { id: "command", label: "Command Center" },
                { id: "workspaces", label: "Workspaces" },
                { id: "intelligence", label: "Intelligence" },
              ] as Array<{ id: ShellSection; label: string }>).map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`f2-section-tab ${activeSection === section.id ? "is-active" : ""}`}
                  onClick={() => handleSectionSelect(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </div>
            <div className="f2-section-hint">{sectionHint}</div>
          </div>

          {activeSection === "command" ? (
            <div className="f2-route-tabs">
              {COMMAND_CENTER_TABS.map((tab) => {
                const isActive = activeView === tab.view;
                return (
                  <button
                    key={tab.view}
                    type="button"
                    className={`f2-route-tab ${isActive ? "is-active" : ""}`}
                    onClick={() => setActiveView(tab.view)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {activeSection === "workspaces" ? (
            <div className="f2-route-tabs">
              {workspacePhaseRecords.map((phase) => (
                <button
                  key={phase.id}
                  type="button"
                  className={`f2-route-tab ${selectedPhase.id === phase.id ? "is-active" : ""}`}
                  onClick={() => handleSelectPhase(phase.id)}
                >
                  {phase.name}
                </button>
              ))}
            </div>
          ) : null}

          {activeSection === "intelligence" ? (
            <div className="f2-route-tabs">
              {INTELLIGENCE_TABS.map((tab) => {
                const isActive = activeView === tab.view;
                return (
                  <button
                    key={tab.view}
                    type="button"
                    className={`f2-route-tab ${isActive ? "is-active" : ""}`}
                    onClick={() => setActiveView(tab.view)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </nav>

      <main className="f2-main">
        {renderCurrentView()}
      </main>
    </div>
  );
}
