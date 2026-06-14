/**
 * Legacy shell
 *
 * This file is preserved as the original `src/new` shell, but it is not mounted by
 * the live app anymore. Treat it as a historical reference, not the place for new
 * shell-level UX work.
 *
 * Active shell:
 * - `src/v3/AppShellV3.tsx`
 *
 * Shared modules that should continue evolving:
 * - `src/new/pages/*`
 * - `src/new/lib/*`
 * - `src/new/components/*`
 */
import React, { useEffect, useMemo, useState } from "react";
import { useAgentRun } from "@/hooks/useAgentRun";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { AppBar } from "@/new/components/shell/AppBar";
import { CopilotPanel } from "@/new/components/shell/CopilotPanel";
import { Sidebar } from "@/new/components/shell/Sidebar";
import { SubNav } from "@/new/components/shell/SubNav";
import { EmptyState } from "@/new/components/ui/EmptyState";
import { buildAgentActivityMap, buildAgentCards, buildNudges, PHASE_SEQUENCE } from "@/new/lib/programData";
import { useAgentTriggers } from "@/new/lib/useAgentTriggers";
import { useBudgetTracking } from "@/new/lib/useBudgetTracking";
import { useClosure } from "@/new/lib/useClosure";
import { useEscalations } from "@/new/lib/useEscalations";
import { useGateReview } from "@/new/lib/useGateReview";
import { useMilestones } from "@/new/lib/useMilestones";
import { usePrograms } from "@/new/lib/usePrograms";
import { getAutonomyLevel, useAutonomy } from "@/new/lib/useAutonomy";
import { ClosureView } from "@/new/pages/ClosureView";
import { TwinView } from "@/new/pages/TwinView";
import { AcceleratorsView } from "@/new/pages/AcceleratorsView";
import { NarrativeView } from "@/new/pages/NarrativeView";
import { PlanView } from "@/new/pages/PlanView";
import { MilestoneView } from "@/new/pages/MilestoneView";
import { DecisionsView } from "@/new/pages/DecisionsView";
import { IntelligenceView } from "@/new/pages/IntelligenceView";
import { RisksView } from "@/new/pages/RisksView";
import { BudgetView } from "@/new/pages/BudgetView";
import { CriticalPathView } from "@/new/pages/CriticalPathView";
import { ChangeImpactView } from "@/new/pages/ChangeImpactView";
import { StakeholderView } from "@/new/pages/StakeholderView";
import { AdoptionView } from "@/new/pages/AdoptionView";
import { HealthHeatmapView } from "@/new/pages/HealthHeatmapView";
import { RetroView } from "@/new/pages/RetroView";
import { DeckView } from "@/new/pages/DeckView";
import { ScopePcrView } from "@/new/pages/ScopePcrView";
import { brand } from "@/new/tokens";
import type { AppView, Persona } from "@/new/types";
import "@/new/styles.css";

const PERSONA_KEY = "adam:new:persona";
const LEGACY_ROUTE_ALIASES: Record<string, { view: AppView; phaseId?: string }> = {
  accelerators: { view: "accelerators" },
  marketplace: { view: "accelerators" },
  assets: { view: "accelerators" },
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

function parseLocation(): { view: AppView; phaseId?: string } {
  const path = typeof window !== "undefined" ? window.location.pathname.replace(/^\/+/, "") : "";
  if (!path) return { view: "home" };
  if (LEGACY_ROUTE_ALIASES[path]) return LEGACY_ROUTE_ALIASES[path];
  if (path === "twin") return { view: "twin" };
  if (path === "accelerators") return { view: "accelerators" };
  if (path === "narrative") return { view: "narrative" };
  if (path === "plan") return { view: "plan" };
  if (path === "milestones") return { view: "milestones" };
  if (path === "decisions") return { view: "decisions" };
  if (path === "risks") return { view: "risks" };
  if (path === "budget") return { view: "budget" };
  if (path === "critical-path") return { view: "critical-path" };
  if (path === "change-impact") return { view: "change-impact" };
  if (path === "stakeholders") return { view: "stakeholders" };
  if (path === "adoption") return { view: "adoption" };
  if (path === "health-heatmap") return { view: "health-heatmap" };
  if (path === "retro") return { view: "retro" };
  if (path === "deck") return { view: "deck" };
  if (path === "scope-pcr") return { view: "scope-pcr" };
  if (path === "closure") return { view: "closure" };
  if (path === "intelligence") return { view: "intelligence" };
  if (path === "settings") return { view: "settings" };
  if ((PHASE_SEQUENCE as readonly string[]).includes(path)) {
    return { view: "work", phaseId: path };
  }
  return { view: "home" };
}

function nextPath(view: AppView, phaseId: string): string {
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
  if (view === "settings") return "/settings";
  return `/${phaseId || "strategy"}`;
}

export default function AppShell() {
  const initialLocation = parseLocation();
  const [activeView, setActiveView] = useState<AppView>(initialLocation.view);
  const [activePhaseId, setActivePhaseId] = useState(initialLocation.phaseId || "strategy");
  const [persona, setPersonaState] = useState<Persona>(() => {
    if (typeof localStorage === "undefined") return "executive";
    const stored = localStorage.getItem(PERSONA_KEY);
    return stored === "lead" || stored === "architect" || stored === "fde" || stored === "engineer" ? stored : "executive";
  });
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);

  const {
    programs,
    activeProgram,
    activeProgramId,
    setActiveProgramId,
    resolveDecision,
    isLoading,
    error,
    refreshPrograms,
  } = usePrograms();
  const { activeRuns, runAgent, resumeRun } = useAgentRun(activeProgramId);
  const { settings: autonomySettings } = useAutonomy(activeProgramId);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.setProperty("--adam-font-sans", brand.fontSans);
    document.documentElement.style.setProperty("--adam-font-mono", brand.fontMono);
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    if (!activeProgram) return;
    if (!(PHASE_SEQUENCE as readonly string[]).includes(activePhaseId)) {
      setActivePhaseId(activeProgram.activePhaseId);
    }
  }, [activePhaseId, activeProgram]);

  useEffect(() => {
    const target = nextPath(activeView, activePhaseId);
    if (window.location.pathname !== target) {
      window.history.replaceState({}, "", target);
    }
  }, [activePhaseId, activeView]);

  const agentCards = useMemo(() => buildAgentCards(activeProgram, activeRuns).map((card) => ({
    ...card,
    autonomyLevel: getAutonomyLevel(card.agentId, card.confidence, autonomySettings),
    onResume: card.run?.awaiting_decision_id
      ? () => void resumeRun({
          runId: card.run?.id || "",
          decisionId: card.run?.awaiting_decision_id || "",
          resolution: "approved",
          humanNote: "Resumed from the new agent activity rail.",
        })
      : undefined,
    onViewTrace: () => setActiveView("intelligence"),
  })), [activeProgram, activeRuns, autonomySettings, resumeRun]);
  const agentActivityMap = useMemo(() => buildAgentActivityMap(activeRuns), [activeRuns]);
  const nudges = useMemo(() => buildNudges(activeProgram, activeRuns), [activeProgram, activeRuns]);
  const highestNudge = nudges[0] || null;
  const agentRunningCount = useMemo(
    () => agentCards.filter((c) => c.status === "running").length,
    [agentCards],
  );
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
  const gateReviewIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "gate-review" && run.phase_id === activePhaseId && run.status === "running"),
    [activePhaseId, activeRuns],
  );
  const closureIsRunning = useMemo(
    () => activeRuns.some((run) => run.agent_id === "closure" && run.status === "running"),
    [activeRuns],
  );
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
    approveGate,
    requestRemediation,
    isSaving: gateReviewSavePending,
  } = useGateReview(
    activeProgramId,
    activeProgram?.rawData || {},
    refreshPrograms,
  );
  const {
    acknowledgeEscalation,
    resolveEscalation,
  } = useEscalations(
    activeProgramId,
    activeProgram?.rawData || {},
    refreshPrograms,
  );
  const {
    approveClosure,
    archiveProgram,
    dismissClosurePrompt,
    isSaving: closureSavePending,
  } = useClosure(
    activeProgramId,
    activeProgram?.rawData || {},
    refreshPrograms,
  );

  const hints = useMemo(() => ({
    home: activeProgram ? `${activeProgram.activePhaseName} · ${activeProgram.readiness}% ready` : "Operating center",
    twin: activeProgram ? `${activeProgram.twinGraph.nodes.length} nodes mapped` : "Transformation graph",
    work: activeProgram ? `${activeProgram.activePhaseName} · ${agentCards.filter((card) => card.status === "running").length} agents running` : "Phase workspaces",
    accelerators: activeProgram?.patternExtractCount
      ? `${activeProgram.patternExtractCount} reusable patterns extracted`
      : "Reusable assets, patterns, and delivery packs",
    decisions: activeProgram ? `${activeProgram.decisionQueue.length} open decisions` : "Human-agent inbox",
    risks: activeProgram ? `${activeProgram.risks.length} open risks and blockers` : "Risk posture",
    budget: activeProgram?.budgetTracking ? activeProgram.budgetTracking.healthReason : "Budget posture and benefit timing",
    "critical-path": activeProgram?.criticalPath?.estimatedCompletionDelta || "Path to value and current bottleneck",
    "change-impact": activeProgram?.changeImpact?.summary || "Teams, change load, and readiness impact",
    stakeholders: activeProgram?.stakeholders.length ? `${activeProgram.stakeholders.length} mapped stakeholders` : "Influence, sentiment, and engagement posture",
    adoption: activeProgram?.adoption?.summary || "Adoption, training, and go-live readiness",
    "health-heatmap": activeProgram?.healthHeatmap?.summary || "Lifecycle health across all phases",
    narrative: activeProgram?.narrative || "Executive storyline and context drivers",
    plan: activeProgram?.plan ? `${activeProgram.plan.milestones.length} milestones in the current plan` : "Cross-phase plan, blockers, and critical path",
    milestones: activeProgram?.milestones.length ? `${activeProgram.milestones.length} tracked milestones` : "Agent and human milestone management",
    retro: Object.keys(activeProgram?.retros || {}).length
      ? `${Object.keys(activeProgram?.retros || {}).length} phase retros ready`
      : "Lessons, friction, and actions to carry forward",
    deck: activeProgram?.deck?.programHealthSummary || "Executive deck outline and talking points",
    "scope-pcr": activeProgram?.scopePcr?.summary || "Scope creep signals and PCR recommendations",
    closure: activeProgram?.closure?.status === "ready"
      ? "Ready for executive approval"
      : activeProgram?.closure?.status === "approved"
        ? "Approved and ready to archive"
        : "Close-out pack and archive decision",
    intelligence: activeProgram ? `${activeProgram.risks.length} risks tracked` : "Predictions and scenarios",
    settings: "Programs, schedules, team",
  }), [activeProgram, agentCards]);

  const decisionCount = activeProgram?.decisionQueue.length || 0;
  const openEscalationCount = activeProgram?.escalations.filter((entry) => entry.status === "open").length || 0;
  const notificationCount = decisionCount + openEscalationCount;
  const effectiveSidebarExpanded = sidebarPinned || sidebarExpanded;

  const searchItems = useMemo(() => {
    const items = [];
    for (const program of programs) {
      items.push({
        id: `program-${program.id}`,
        title: program.name,
        subtitle: `Program · ${program.industry}`,
        action: () => setActiveProgramId(program.id),
      });
      for (const phase of program.phases) {
        items.push({
          id: `phase-${program.id}-${phase.id}`,
          title: phase.displayName,
          subtitle: `Workspace · ${program.name}`,
          action: () => {
            setActiveProgramId(program.id);
            setActivePhaseId(phase.id);
            setActiveView("work");
          },
        });
      }
      for (const artifact of program.artifacts.slice(0, 20)) {
        items.push({
          id: `artifact-${artifact.id}`,
          title: artifact.title,
          subtitle: `Artifact · ${program.name}`,
          action: () => {
            setActiveProgramId(program.id);
            setActivePhaseId(artifact.phaseId);
            setActiveView("work");
          },
        });
      }
      for (const decision of program.decisionQueue.slice(0, 20)) {
        items.push({
          id: `decision-${decision.id}`,
          title: decision.title,
          subtitle: `Decision · ${program.name}`,
          action: () => {
            setActiveProgramId(program.id);
            setActiveView("decisions");
          },
        });
      }
    }
    return items;
  }, [programs, setActiveProgramId]);

  const setPersona = (nextPersona: Persona) => {
    setPersonaState(nextPersona);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PERSONA_KEY, nextPersona);
    }
  };

  const syncStatus = error ? "error" : isLoading ? "syncing" : "synced";

  const runPhaseAgent = async (phaseId: string) => {
    if (!activeProgram || !isSupabaseConfigured || !supabase) return;
    await runAgent({
      agentId: phaseId,
      phaseId,
      triggeredBy: "user",
    });
    await refreshPrograms();
  };

  const runProgramAgent = async ({
    agentId,
    phaseId,
    triggeredBy,
  }: {
    agentId: string;
    phaseId: string;
    triggeredBy: "user" | "trigger";
  }) => {
    if (!activeProgramId || !isSupabaseConfigured || !supabase) return;
    await runAgent({
      agentId,
      phaseId,
      triggeredBy,
    });
    await refreshPrograms();
  };

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
    triggerClosure,
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

  const resolveDecisionAction = async (
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
  };

  const renderCurrentView = () => {
    if (!activeProgram && !isLoading) {
      return (
        <EmptyState
          context={error || "No programs available"}
          explanation="The new shell is running, but it needs a real program record from Supabase before it can render the operating model."
          recommendation="Connect Supabase, sign in if needed, and create a program. The existing app remains untouched."
          learnMoreLabel="Refresh"
          onLearnMore={() => void refreshPrograms()}
        />
      );
    }

    if (activeView === "twin") {
      return (
        <TwinView
          program={activeProgram}
          agentCards={agentCards}
          agentActivityMap={agentActivityMap}
          onOpenWorkspace={(phaseId) => {
            setActivePhaseId(phaseId);
            setActiveView("work");
          }}
          onViewTrace={() => setActiveView("intelligence")}
        />
      );
    }
    if (activeView === "accelerators") {
      return <AcceleratorsView program={activeProgram} onNavigate={setActiveView} />;
    }
    if (activeView === "narrative") {
      return (
        <NarrativeView
          program={activeProgram}
          onRefresh={triggerNarrative}
          isRunning={narrativeIsRunning}
          onOpenIntelligence={() => setActiveView("intelligence")}
        />
      );
    }
    if (activeView === "plan") {
      return (
        <PlanView
          program={activeProgram}
          plan={activeProgram?.plan ?? null}
          planGeneratedAt={activeProgram?.planGeneratedAt ?? ""}
          planIsRunning={planIsRunning}
          onTriggerPlan={triggerPlan}
        />
      );
    }
    if (activeView === "milestones") {
      return (
        <MilestoneView
          program={activeProgram}
          milestonesIsRunning={milestonesIsRunning}
          onTriggerMilestones={triggerMilestones}
          onAddMilestone={addMilestone}
          onCompleteMilestone={completeMilestone}
          isSaving={milestoneSavePending}
        />
      );
    }
    if (activeView === "work") {
      return (
        <EmptyState
          context="Legacy work view archived"
          explanation="This legacy shell no longer hosts the phase workspace. The live app now uses the V3 stage and pipeline surfaces instead."
          recommendation="Open the V3 shell to continue working the current phase."
        />
      );
    }
    if (activeView === "decisions") {
      return (
        <DecisionsView
          program={activeProgram}
          activeRuns={activeRuns}
          onResolve={resolveDecisionAction}
        />
      );
    }
    if (activeView === "intelligence") {
      return <IntelligenceView program={activeProgram} onRefreshProgram={refreshPrograms} />;
    }
    if (activeView === "risks") {
      return (
        <RisksView
          program={activeProgram}
          raidAgentRunning={raidAgentRunning}
          onTriggerRiskAgent={triggerRisk}
          onRefresh={refreshPrograms}
        />
      );
    }
    if (activeView === "budget") {
      return (
        <BudgetView
          program={activeProgram}
          budgetIsRunning={budgetIsRunning}
          onTriggerBudget={triggerBudget}
          onSaveBudgetInputs={saveBudgetInputs}
          savePending={budgetSavePending}
        />
      );
    }
    if (activeView === "change-impact") {
      return (
        <ChangeImpactView
          program={activeProgram}
          isRunning={changeImpactIsRunning}
          onTriggerChangeImpact={triggerChangeImpact}
        />
      );
    }
    if (activeView === "stakeholders") {
      return (
        <StakeholderView
          program={activeProgram}
          isRunning={stakeholderIsRunning}
          onTriggerStakeholders={triggerStakeholders}
        />
      );
    }
    if (activeView === "adoption") {
      return (
        <AdoptionView
          program={activeProgram}
          isRunning={adoptionIsRunning}
          onTriggerAdoption={triggerAdoption}
        />
      );
    }
    if (activeView === "health-heatmap") {
      return (
        <HealthHeatmapView
          program={activeProgram}
          isRunning={healthHeatmapIsRunning}
          onTriggerHealthHeatmap={triggerHealthHeatmap}
          onSelectPhase={(phaseId) => {
            setActivePhaseId(phaseId);
            setActiveView("work");
          }}
        />
      );
    }
    if (activeView === "retro") {
      return (
        <RetroView
          program={activeProgram}
          runningPhases={retroRunningPhases.current}
          onTriggerRetro={triggerRetro}
          onOpenIntelligence={() => setActiveView("intelligence")}
        />
      );
    }
    if (activeView === "deck") {
      return (
        <DeckView
          program={activeProgram}
          isRunning={deckIsRunning}
          onTriggerDeck={triggerDeck}
          onOpenIntelligence={() => setActiveView("intelligence")}
        />
      );
    }
    if (activeView === "scope-pcr") {
      return (
        <ScopePcrView
          program={activeProgram}
          isRunning={scopePcrIsRunning}
          onTriggerScopePcr={triggerScopePcr}
          onNavigate={setActiveView}
        />
      );
    }
    if (activeView === "critical-path") {
      return (
        <CriticalPathView
          program={activeProgram}
          isRunning={criticalPathIsRunning}
          onTriggerCriticalPath={triggerCriticalPath}
        />
      );
    }
    if (activeView === "closure") {
      return (
        <ClosureView
          program={activeProgram}
          onTriggerClosure={triggerClosure}
          closureIsRunning={closureIsRunning}
          onApproveClosure={() => void approveClosure()}
          onArchiveProgram={() => void archiveProgram()}
          onNavigate={setActiveView}
          isSaving={closureSavePending}
        />
      );
    }
    if (activeView === "settings") {
      return (
        <div className="adam-grid two">
          <div className="adam-card p-5">
            <div className="adam-title">Program settings</div>
            <div className="mt-3 adam-body adam-muted">
              This placeholder preserves the new IA and leaves the existing configuration logic untouched until the shell is approved.
            </div>
          </div>
          <div className="adam-card p-5">
            <div className="adam-title">Schedules and integrations</div>
            <div className="mt-3 adam-body adam-muted">
              The existing hooks are ready to power schedule and integration management inside this parallel shell.
            </div>
          </div>
        </div>
      );
    }
    return (
      <EmptyState
        context="Legacy home view archived"
        explanation="The original home experience has been replaced by the V3 stage-centric shell."
        recommendation="Use the V3 Stage surface for guided work and Program for reports."
      />
    );
  };

  return (
    <div className="adam-new-root">
      <AppBar
        programs={programs}
        activeProgramId={activeProgramId}
        onProgramChange={setActiveProgramId}
        persona={persona}
        onPersonaChange={setPersona}
        syncStatus={syncStatus}
        alertCount={notificationCount}
        hasEscalations={openEscalationCount > 0}
        searchItems={searchItems}
        onNavigate={setActiveView}
        copilotOpen={copilotOpen}
        onCopilotToggle={() => setCopilotOpen((o) => !o)}
      />

      <Sidebar
        activeView={activeView}
        expanded={effectiveSidebarExpanded}
        pinned={sidebarPinned}
        onExpandedChange={setSidebarExpanded}
        onPinnedChange={(pinned) => {
          setSidebarPinned(pinned);
          if (pinned) {
            setSidebarExpanded(true);
          }
        }}
        onNavigate={setActiveView}
        hints={hints}
        unreadCount={decisionCount}
      />

      <SubNav
        activeView={activeView}
        onNavigate={setActiveView}
        hints={hints}
        unreadCount={decisionCount}
        agentRunningCount={agentRunningCount}
        closureReady={activeProgram?.closure?.status === "ready"}
      />

      <main
        className="acb-main"
        style={{ marginLeft: effectiveSidebarExpanded ? 220 : 60 }}
      >
        {isLoading && !activeProgram ? (
          <div className="adam-card p-8">
            <div className="adam-heading-lg">Loading…</div>
            <div className="mt-3 adam-body adam-muted">Pulling programs and agent activity.</div>
          </div>
        ) : renderCurrentView()}
      </main>

      <CopilotPanel
        programId={activeProgramId}
        workspaceId={activeView}
        persona={persona}
        nudge={highestNudge}
        onNavigate={setActiveView}
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
      />
    </div>
  );
}
