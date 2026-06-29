import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type { AgentRun } from "@/lib/adamSync";
import { pushV3Toast } from "@/v3/utils";
import type { DecisionSummary, GateReview, Milestone, ProgramClosure, RAIDEntry, PhaseSummary } from "@/new/types";
import { captureSnapshot, computeAgentInterval, hasWatchedFieldChanged } from "@/v3/lib/agentChangeSensitivity";
import { computeProgramVelocity, type ProgramVelocity } from "@/v3/lib/programVelocity";

const RISK_TRIGGER_PHASES = new Set(["discover", "design", "govern", "build"]);
const MILESTONE_RISK_TYPES = new Set(["dependency", "risk"]);
const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const SIX_HOURS_MS = 1000 * 60 * 60 * 6;
const TWELVE_HOURS_MS = 1000 * 60 * 60 * 12;
const FORTY_EIGHT_HOURS_MS = 1000 * 60 * 60 * 48;
const SEVENTY_TWO_HOURS_MS = 1000 * 60 * 60 * 72;

interface UseAgentTriggersOptions {
  programId: string;
  authed: boolean;
  activePhaseId: string | null;
  rawData: Record<string, unknown>;
  activeRuns: AgentRun[];
  onRunAgent: (params: { agentId: string; phaseId: string; triggeredBy: "user" | "trigger" }) => Promise<void>;
  onInvalidate?: () => Promise<void> | void;
  narrativeGeneratedAt: string | null;
  raidGeneratedAt: string | null;
  milestonesGeneratedAt: string | null;
  budgetGeneratedAt: string | null;
  criticalPathGeneratedAt: string | null;
  changeImpactGeneratedAt: string | null;
  stakeholderGeneratedAt: string | null;
  adoptionGeneratedAt: string | null;
  healthHeatmapGeneratedAt: string | null;
  retrosGeneratedAt: Record<string, string>;
  deckGeneratedAt: string | null;
  discoveryGuideGeneratedAt: string | null;
  scopePcrGeneratedAt: string | null;
  patternExtractGeneratedAt: string | null;
  patternQueryCachedAt: string | null;
  gateReviews: Record<string, GateReview>;
  escalationsLastCheckedAt: string | null;
  openEscalationCount: number;
  closureGeneratedAt: string | null;
  phases: PhaseSummary[];
  raidEntries: RAIDEntry[];
  milestones: Milestone[];
  decisions: DecisionSummary[];
  closure: ProgramClosure | null;
}

function isOlderThan(timestamp: string | null, maxAgeMs: number): boolean {
  if (!timestamp) return true;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > maxAgeMs;
}

function hasOverdueDecision(decisions: DecisionSummary[]): boolean {
  return decisions.some((decision) => {
    const createdAt = new Date(decision.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return false;
    const maxAge = decision.type === "gate-approval" ? SEVENTY_TWO_HOURS_MS : FORTY_EIGHT_HOURS_MS;
    return Date.now() - createdAt > maxAge;
  });
}

export function useAgentTriggers({
  programId,
  authed,
  activePhaseId,
  rawData,
  activeRuns,
  onRunAgent,
  onInvalidate,
  raidGeneratedAt,
  milestonesGeneratedAt,
  budgetGeneratedAt,
  criticalPathGeneratedAt,
  changeImpactGeneratedAt,
  stakeholderGeneratedAt,
  adoptionGeneratedAt,
  healthHeatmapGeneratedAt,
  retrosGeneratedAt,
  discoveryGuideGeneratedAt,
  scopePcrGeneratedAt,
  patternExtractGeneratedAt,
  patternQueryCachedAt,
  gateReviews,
  escalationsLastCheckedAt,
  openEscalationCount,
  closureGeneratedAt,
  phases,
  raidEntries,
  milestones,
  decisions,
  closure,
}: UseAgentTriggersOptions) {
  const [programVelocity, setProgramVelocity] = useState<ProgramVelocity>({
    changesLast24h: 0,
    agentRunsLast24h: 0,
    activePhaseId: activePhaseId || "program",
    daysSinceLastGate: 999,
  });
  const previousRunStatuses = useRef(new Map<string, AgentRun["status"]>());
  const lastRunSnapshots = useRef<Record<string, Record<string, unknown>>>({});
  const loadTriggerRef = useRef<{
    narrativeProgramId: string | null;
    milestoneProgramId: string | null;
    budgetProgramId: string | null;
    criticalPathProgramId: string | null;
    changeImpactProgramId: string | null;
    stakeholderProgramId: string | null;
    adoptionProgramId: string | null;
    healthHeatmapProgramId: string | null;
    deckProgramId: string | null;
    discoveryGuideProgramId: string | null;
    scopePcrProgramId: string | null;
    patternExtractProgramId: string | null;
    patternQueryProgramId: string | null;
    escalationProgramId: string | null;
    closureProgramId: string | null;
  }>({
    narrativeProgramId: null,
    milestoneProgramId: null,
    budgetProgramId: null,
    criticalPathProgramId: null,
    changeImpactProgramId: null,
    stakeholderProgramId: null,
    adoptionProgramId: null,
    healthHeatmapProgramId: null,
    deckProgramId: null,
    discoveryGuideProgramId: null,
    scopePcrProgramId: null,
    patternExtractProgramId: null,
    patternQueryProgramId: null,
    escalationProgramId: null,
    closureProgramId: null,
  });
  const phaseSnapshots = useRef(new Map<string, number>());
  const raidEntrySnapshots = useRef(new Set<string>());
  const milestoneSnapshots = useRef(new Map<string, Milestone["status"]>());
  const decisionSnapshots = useRef(new Set<string>());
  const phaseSnapshotReady = useRef(false);
  const raidSnapshotReady = useRef(false);
  const milestoneSnapshotReady = useRef(false);
  const decisionSnapshotReady = useRef(false);
  const narrativeRunning = useRef(false);
  const riskRunning = useRef(false);
  const milestoneRunning = useRef(false);
  const budgetRunning = useRef(false);
  const criticalPathRunning = useRef(false);
  const changeImpactRunning = useRef(false);
  const stakeholderRunning = useRef(false);
  const adoptionRunning = useRef(false);
  const healthHeatmapRunning = useRef(false);
  const scopePcrRunning = useRef(false);
  const phaseEstimatorRunning = useRef(false);
  const phaseEstimatorLastPhase = useRef<string | null>(null);
  const deckRunning = useRef(false);
  const discoveryGuideRunning = useRef(false);
  const patternExtractRunning = useRef(false);
  const patternQueryRunning = useRef(false);
  const escalationRunning = useRef(false);
  const closureRunning = useRef(false);
  const [retroRunningPhases, setRetroRunningPhases] = useState<Set<string>>(new Set());
  const [escalationIsRunning, setEscalationIsRunning] = useState(false);

  const startEscalationRun = useCallback(() => {
    escalationRunning.current = true;
    setEscalationIsRunning(true);
  }, []);

  const finishEscalationRun = useCallback(() => {
    escalationRunning.current = false;
    setEscalationIsRunning(false);
  }, []);

  const changeImpactIsRunning = activeRuns.some((run) => run.agent_id === "change-impact" && run.status === "running");
  const stakeholderIsRunning = activeRuns.some((run) => run.agent_id === "stakeholder" && run.status === "running");
  const adoptionIsRunning = activeRuns.some((run) => run.agent_id === "adoption" && run.phase_id === "program" && run.status === "running");
  const healthHeatmapIsRunning = activeRuns.some((run) => run.agent_id === "health-heatmap" && run.status === "running");
  const deckIsRunning = activeRuns.some((run) => run.agent_id === "deck" && run.status === "running");
  const scopePcrIsRunning = activeRuns.some((run) => run.agent_id === "scope-pcr" && run.status === "running");
  const canRunAgents = Boolean(programId && authed && isSupabaseConfigured && supabase);
  const isAgentStale = useCallback((agentId: string, timestamp: string | null) => {
    if (!timestamp) return true;
    const parsed = new Date(timestamp).getTime();
    if (!Number.isFinite(parsed)) return true;
    const interval = computeAgentInterval(agentId, programVelocity);
    const timeStale = Date.now() - parsed > interval;
    const fieldChanged = hasWatchedFieldChanged(agentId, rawData, lastRunSnapshots.current[agentId] || null);
    return timeStale || fieldChanged;
  }, [programVelocity, rawData]);

  const runAgentSafely = useCallback((
    params: { agentId: string; phaseId: string; triggeredBy: "user" | "trigger" },
    onFinally?: () => void,
  ) => {
    if (!canRunAgents) {
      // Show an actionable message for explicitly user-triggered calls so the
      // button doesn't appear broken when the user is not signed in.
      if (params.triggeredBy === "user") {
        pushV3Toast("Sign in to use AI agents.", { tone: "warning", duration: 5000 });
      }
      onFinally?.();
      return Promise.resolve();
    }
    return onRunAgent(params)
      .catch(() => undefined)
      .finally(() => {
        onFinally?.();
      });
  }, [canRunAgents, onRunAgent]);

  useEffect(() => {
    if (!programId || !isSupabaseConfigured || !supabase || !onInvalidate) return undefined;

    const channel = supabase
      .channel(`agent-events:${programId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "adam_agent_events",
        filter: `program_id=eq.${programId}`,
      }, () => {
        void onInvalidate();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [onInvalidate, programId]);

  useEffect(() => {
    if (!programId) {
      previousRunStatuses.current = new Map();
      lastRunSnapshots.current = {};
      loadTriggerRef.current = {
        narrativeProgramId: null,
        milestoneProgramId: null,
        budgetProgramId: null,
        criticalPathProgramId: null,
        changeImpactProgramId: null,
        stakeholderProgramId: null,
        adoptionProgramId: null,
        healthHeatmapProgramId: null,
        deckProgramId: null,
        discoveryGuideProgramId: null,
        scopePcrProgramId: null,
        patternExtractProgramId: null,
        patternQueryProgramId: null,
        escalationProgramId: null,
        closureProgramId: null,
      };
      phaseSnapshots.current = new Map();
      raidEntrySnapshots.current = new Set();
      milestoneSnapshots.current = new Map();
      decisionSnapshots.current = new Set();
      phaseSnapshotReady.current = false;
      raidSnapshotReady.current = false;
      milestoneSnapshotReady.current = false;
      decisionSnapshotReady.current = false;
      phaseEstimatorRunning.current = false;
      phaseEstimatorLastPhase.current = null;
      setRetroRunningPhases(new Set());
      setEscalationIsRunning(false);
      return;
    }

    if (loadTriggerRef.current.narrativeProgramId !== programId) loadTriggerRef.current.narrativeProgramId = null;
    if (loadTriggerRef.current.milestoneProgramId !== programId) loadTriggerRef.current.milestoneProgramId = null;
    if (loadTriggerRef.current.budgetProgramId !== programId) loadTriggerRef.current.budgetProgramId = null;
    if (loadTriggerRef.current.criticalPathProgramId !== programId) loadTriggerRef.current.criticalPathProgramId = null;
    if (loadTriggerRef.current.changeImpactProgramId !== programId) loadTriggerRef.current.changeImpactProgramId = null;
    if (loadTriggerRef.current.stakeholderProgramId !== programId) loadTriggerRef.current.stakeholderProgramId = null;
    if (loadTriggerRef.current.adoptionProgramId !== programId) loadTriggerRef.current.adoptionProgramId = null;
    if (loadTriggerRef.current.healthHeatmapProgramId !== programId) loadTriggerRef.current.healthHeatmapProgramId = null;
    if (loadTriggerRef.current.deckProgramId !== programId) loadTriggerRef.current.deckProgramId = null;
    if (loadTriggerRef.current.discoveryGuideProgramId !== programId) loadTriggerRef.current.discoveryGuideProgramId = null;
    if (loadTriggerRef.current.scopePcrProgramId !== programId) loadTriggerRef.current.scopePcrProgramId = null;
    if (loadTriggerRef.current.patternExtractProgramId !== programId) loadTriggerRef.current.patternExtractProgramId = null;
    if (loadTriggerRef.current.patternQueryProgramId !== programId) loadTriggerRef.current.patternQueryProgramId = null;
    if (loadTriggerRef.current.escalationProgramId !== programId) loadTriggerRef.current.escalationProgramId = null;
    if (loadTriggerRef.current.closureProgramId !== programId) loadTriggerRef.current.closureProgramId = null;

    phaseSnapshots.current = new Map();
    raidEntrySnapshots.current = new Set();
    milestoneSnapshots.current = new Map();
    decisionSnapshots.current = new Set();
    phaseSnapshotReady.current = false;
    raidSnapshotReady.current = false;
    milestoneSnapshotReady.current = false;
    decisionSnapshotReady.current = false;
    phaseEstimatorRunning.current = false;
    phaseEstimatorLastPhase.current = null;
    setRetroRunningPhases(new Set());
    setEscalationIsRunning(false);
    previousRunStatuses.current = new Map(activeRuns.map((run) => [run.id, run.status]));
  }, [programId]);

  useEffect(() => {
    if (!programId || !supabase) return;
    let cancelled = false;
    void computeProgramVelocity(programId, activePhaseId || "program").then((velocity) => {
      if (!cancelled) setProgramVelocity(velocity);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activePhaseId, activeRuns.length, programId]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isAgentStale("milestone", milestonesGeneratedAt)) return;
    if (loadTriggerRef.current.milestoneProgramId === programId || milestoneRunning.current) return;

    const hasMeaningfulProgress = phases.some((phase) => phase.pct > 0);
    const hasRelevantRisks = raidEntries.some((entry) => MILESTONE_RISK_TYPES.has(entry.type));
    if (!hasMeaningfulProgress && !hasRelevantRisks) return;

    loadTriggerRef.current.milestoneProgramId = programId;
    milestoneRunning.current = true;
    void runAgentSafely({ agentId: "milestone", phaseId: "program", triggeredBy: "trigger" }, () => {
      lastRunSnapshots.current.milestone = captureSnapshot("milestone", rawData);
      milestoneRunning.current = false;
    });
  }, [canRunAgents, isAgentStale, milestonesGeneratedAt, phases, programId, raidEntries, rawData, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isOlderThan(budgetGeneratedAt, ONE_DAY_MS)) return;
    if (loadTriggerRef.current.budgetProgramId === programId || budgetRunning.current) return;

    const activePhaseCount = phases.filter((phase) => phase.pct > 0).length;
    if (activePhaseCount < 2 && milestones.length === 0) return;

    loadTriggerRef.current.budgetProgramId = programId;
    budgetRunning.current = true;
    void runAgentSafely({ agentId: "budget", phaseId: "program", triggeredBy: "trigger" }, () => {
      budgetRunning.current = false;
    });
  }, [budgetGeneratedAt, canRunAgents, milestones.length, phases, programId, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isAgentStale("critical-path", criticalPathGeneratedAt)) return;
    if (loadTriggerRef.current.criticalPathProgramId === programId || criticalPathRunning.current) return;

    if (!phases.some((phase) => phase.pct > 0)) return;

    loadTriggerRef.current.criticalPathProgramId = programId;
    criticalPathRunning.current = true;
    void runAgentSafely({ agentId: "critical-path", phaseId: "program", triggeredBy: "trigger" }, () => {
      lastRunSnapshots.current["critical-path"] = captureSnapshot("critical-path", rawData);
      criticalPathRunning.current = false;
    });
  }, [canRunAgents, criticalPathGeneratedAt, isAgentStale, phases, programId, rawData, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isOlderThan(changeImpactGeneratedAt, FORTY_EIGHT_HOURS_MS)) return;
    if (loadTriggerRef.current.changeImpactProgramId === programId || changeImpactRunning.current) return;
    if (!phases.some((phase) => phase.pct > 0)) return;

    loadTriggerRef.current.changeImpactProgramId = programId;
    changeImpactRunning.current = true;
    void runAgentSafely({ agentId: "change-impact", phaseId: "program", triggeredBy: "trigger" }, () => {
      changeImpactRunning.current = false;
    });
  }, [canRunAgents, changeImpactGeneratedAt, phases, programId, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isAgentStale("stakeholder", stakeholderGeneratedAt)) return;
    if (loadTriggerRef.current.stakeholderProgramId === programId || stakeholderRunning.current) return;
    if (!phases.some((phase) => phase.pct > 0)) return;

    loadTriggerRef.current.stakeholderProgramId = programId;
    stakeholderRunning.current = true;
    void runAgentSafely({ agentId: "stakeholder", phaseId: "program", triggeredBy: "trigger" }, () => {
      lastRunSnapshots.current.stakeholder = captureSnapshot("stakeholder", rawData);
      stakeholderRunning.current = false;
    });
  }, [canRunAgents, phases, programId, rawData, runAgentSafely, stakeholderGeneratedAt, isAgentStale]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isAgentStale("adoption", adoptionGeneratedAt)) return;
    if (loadTriggerRef.current.adoptionProgramId === programId || adoptionRunning.current) return;
    if (!phases.some((phase) => phase.pct > 50)) return;

    loadTriggerRef.current.adoptionProgramId = programId;
    adoptionRunning.current = true;
    void runAgentSafely({ agentId: "adoption", phaseId: "program", triggeredBy: "trigger" }, () => {
      lastRunSnapshots.current.adoption = captureSnapshot("adoption", rawData);
      adoptionRunning.current = false;
    });
  }, [adoptionGeneratedAt, canRunAgents, phases, programId, rawData, runAgentSafely, isAgentStale]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isAgentStale("health-heatmap", healthHeatmapGeneratedAt)) return;
    if (loadTriggerRef.current.healthHeatmapProgramId === programId || healthHeatmapRunning.current) return;
    if (!phases.length) return;

    loadTriggerRef.current.healthHeatmapProgramId = programId;
    healthHeatmapRunning.current = true;
    void runAgentSafely({ agentId: "health-heatmap", phaseId: "program", triggeredBy: "trigger" }, () => {
      lastRunSnapshots.current["health-heatmap"] = captureSnapshot("health-heatmap", rawData);
      healthHeatmapRunning.current = false;
    });
  }, [canRunAgents, healthHeatmapGeneratedAt, phases, programId, rawData, runAgentSafely, isAgentStale]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isAgentStale("scope-pcr", scopePcrGeneratedAt)) return;
    if (loadTriggerRef.current.scopePcrProgramId === programId || scopePcrRunning.current) return;
    if (phases.filter((phase) => phase.pct > 0).length < 2) return;

    loadTriggerRef.current.scopePcrProgramId = programId;
    scopePcrRunning.current = true;
    void runAgentSafely({ agentId: "scope-pcr", phaseId: "program", triggeredBy: "trigger" }, () => {
      scopePcrRunning.current = false;
    });
  }, [canRunAgents, phases, programId, runAgentSafely, scopePcrGeneratedAt]);

  // Auto-generate the Discover discovery pack once the Discover phase is reached
  // (no longer "inactive"), so the interview guides / workshop agenda are waiting
  // for the user instead of requiring a manual "Generate" click. Fires once per
  // programme and never regenerates — an existing pack short-circuits it.
  useEffect(() => {
    if (!canRunAgents) return;
    if (discoveryGuideGeneratedAt) return;
    if (loadTriggerRef.current.discoveryGuideProgramId === programId || discoveryGuideRunning.current) return;
    const discoverReached = phases.some((phase) => phase.id === "discover" && phase.status !== "inactive");
    if (!discoverReached) return;

    loadTriggerRef.current.discoveryGuideProgramId = programId;
    discoveryGuideRunning.current = true;
    void runAgentSafely({ agentId: "discovery-guide-generator", phaseId: "discover", triggeredBy: "trigger" }, () => {
      discoveryGuideRunning.current = false;
    });
  }, [canRunAgents, discoveryGuideGeneratedAt, phases, programId, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents || !activePhaseId) return;
    const activeMilestones = milestones.filter((milestone) => milestone.phaseId === activePhaseId || (milestone as { phase?: string }).phase === activePhaseId);
    // The estimator derives completion from milestones, exit criteria AND produced
    // artifacts (artifactSignal). A phase with generated artifacts but no milestones
    // or captured exit criteria still has real progress to estimate — without this
    // it stays stuck at 0%, which forces the gate-review score to "not-ready".
    const phaseArtifactBucket = (rawData.phaseArtifacts as Record<string, Record<string, unknown>> | undefined)?.[activePhaseId];
    const hasPhaseArtifacts = Boolean(phaseArtifactBucket && Object.keys(phaseArtifactBucket).length > 0);
    if (!activeMilestones.length && !(gateReviews[activePhaseId]?.exitCriteriaStatus || []).length && !hasPhaseArtifacts) return;
    if (phaseEstimatorRunning.current) return;

    // rawData is a fresh object reference on every program refetch, and the
    // estimator's own write triggers a refetch. Without a guard this effect
    // re-fires every few seconds, spending runs and churning artifact state.
    // Only re-run on a phase switch or when a watched field genuinely changed.
    const phaseChanged = phaseEstimatorLastPhase.current !== activePhaseId;
    const fieldsChanged = hasWatchedFieldChanged(
      "phase-completion-estimator",
      rawData,
      lastRunSnapshots.current["phase-completion-estimator"] || null,
    );
    if (!phaseChanged && !fieldsChanged) return;

    // Capture the snapshot at fire time (not in onFinally) so the post-run
    // refetch compares against the inputs that triggered this run, making the
    // trigger self-terminating instead of looping.
    lastRunSnapshots.current["phase-completion-estimator"] = captureSnapshot("phase-completion-estimator", rawData);
    phaseEstimatorLastPhase.current = activePhaseId;
    phaseEstimatorRunning.current = true;
    void runAgentSafely({ agentId: "phase-completion-estimator", phaseId: activePhaseId, triggeredBy: "trigger" }, () => {
      phaseEstimatorRunning.current = false;
    });
  }, [activePhaseId, canRunAgents, gateReviews, milestones, rawData, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!closureGeneratedAt) return;
    if (!isOlderThan(patternExtractGeneratedAt, ONE_DAY_MS * 7)) return;
    if (loadTriggerRef.current.patternExtractProgramId === programId || patternExtractRunning.current) return;

    loadTriggerRef.current.patternExtractProgramId = programId;
    patternExtractRunning.current = true;
    void runAgentSafely({ agentId: "pattern-extract", phaseId: "program", triggeredBy: "trigger" }, () => {
      patternExtractRunning.current = false;
    });
  }, [canRunAgents, closureGeneratedAt, patternExtractGeneratedAt, programId, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isOlderThan(patternQueryCachedAt, SIX_HOURS_MS)) return;
    if (loadTriggerRef.current.patternQueryProgramId === programId || patternQueryRunning.current) return;

    loadTriggerRef.current.patternQueryProgramId = programId;
    patternQueryRunning.current = true;
    void runAgentSafely({ agentId: "pattern-query", phaseId: "program", triggeredBy: "trigger" }, () => {
      patternQueryRunning.current = false;
    });
  }, [canRunAgents, patternQueryCachedAt, programId, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (!isOlderThan(escalationsLastCheckedAt, SIX_HOURS_MS)) return;
    if (loadTriggerRef.current.escalationProgramId === programId || escalationRunning.current) return;
    // Open escalations are themselves a trigger: the agent re-checks them and
    // auto-resolves any whose condition has cleared, so stale entries don't
    // linger when no new risk/decision is firing.
    const hasFreshTrigger = raidEntries.some((entry) => entry.status !== "closed" && (entry.severity === "high" || entry.severity === "critical"))
      || hasOverdueDecision(decisions)
      || openEscalationCount > 0;
    if (!hasFreshTrigger) return;

    loadTriggerRef.current.escalationProgramId = programId;
    startEscalationRun();
    void runAgentSafely({ agentId: "escalation", phaseId: "program", triggeredBy: "trigger" }, () => {
      finishEscalationRun();
    });
  }, [canRunAgents, decisions, escalationsLastCheckedAt, finishEscalationRun, openEscalationCount, programId, raidEntries, runAgentSafely, startEscalationRun]);

  useEffect(() => {
    if (!canRunAgents) return;
    if (closure && closure.status !== "not-ready") return;
    if (loadTriggerRef.current.closureProgramId === programId || closureRunning.current) return;
    const averageReadiness = phases.reduce((sum, phase) => sum + phase.pct, 0) / Math.max(phases.length, 1);
    const allPhasesReady = phases.every((phase) => phase.pct >= 90);
    if (averageReadiness < 90 && !allPhasesReady) return;

    loadTriggerRef.current.closureProgramId = programId;
    closureRunning.current = true;
    void runAgentSafely({ agentId: "closure", phaseId: "program", triggeredBy: "trigger" }, () => {
      closureRunning.current = false;
    });
  }, [canRunAgents, closure, closureGeneratedAt, phases, programId, runAgentSafely]);

  useEffect(() => {
    if (!canRunAgents) return;

    const phaseAgentIds = new Set(phases.map((phase) => phase.id));
    const previous = previousRunStatuses.current;
    const raidIsStale = !raidGeneratedAt || isOlderThan(raidGeneratedAt, SIX_HOURS_MS);
    const budgetIsStale = isOlderThan(budgetGeneratedAt, ONE_DAY_MS);
    const criticalPathIsStale = isOlderThan(criticalPathGeneratedAt, TWELVE_HOURS_MS);
    const changeImpactIsStale = isOlderThan(changeImpactGeneratedAt, FORTY_EIGHT_HOURS_MS);
    const stakeholderIsStale = isOlderThan(stakeholderGeneratedAt, FORTY_EIGHT_HOURS_MS);
    const adoptionIsStale = isOlderThan(adoptionGeneratedAt, ONE_DAY_MS);
    const healthIsStale = isOlderThan(healthHeatmapGeneratedAt, TWELVE_HOURS_MS);
    const scopePcrIsStale = isOlderThan(scopePcrGeneratedAt, FORTY_EIGHT_HOURS_MS);
    let shouldTriggerRisk = false;
    let shouldTriggerBudget = false;
    let shouldTriggerCriticalPath = false;
    let shouldTriggerChangeImpact = false;
    let shouldTriggerStakeholder = false;
    let shouldTriggerAdoption = false;
    let shouldTriggerHealth = false;
    let shouldTriggerScopePcr = false;

    for (const run of activeRuns) {
      const previousStatus = previous.get(run.id);
      if (run.status !== "complete" || !previousStatus || previousStatus === "complete") continue;

      if (raidIsStale && RISK_TRIGGER_PHASES.has(run.agent_id)) shouldTriggerRisk = true;
      if (phaseAgentIds.has(run.agent_id) && budgetIsStale) shouldTriggerBudget = true;
      if (phaseAgentIds.has(run.agent_id) && criticalPathIsStale) shouldTriggerCriticalPath = true;
      if (run.agent_id === "strategic-roadmap" && healthIsStale) shouldTriggerHealth = true;
      if (run.agent_id === "risk" && changeImpactIsStale) shouldTriggerChangeImpact = true;
      if (run.agent_id === "risk" && stakeholderIsStale) shouldTriggerStakeholder = true;
      if (run.agent_id === "milestone" && adoptionIsStale) shouldTriggerAdoption = true;
      if (run.agent_id === "risk" && scopePcrIsStale) shouldTriggerScopePcr = true;
    }

    previousRunStatuses.current = new Map(activeRuns.map((run) => [run.id, run.status]));

    if (shouldTriggerRisk && !riskRunning.current) {
      riskRunning.current = true;
      void runAgentSafely({ agentId: "risk", phaseId: "program", triggeredBy: "trigger" }, () => {
        riskRunning.current = false;
      });
    }

    if (shouldTriggerBudget && !budgetRunning.current) {
      budgetRunning.current = true;
      void runAgentSafely({ agentId: "budget", phaseId: "program", triggeredBy: "trigger" }, () => {
        budgetRunning.current = false;
      });
    }

    if (shouldTriggerCriticalPath && !criticalPathRunning.current) {
      criticalPathRunning.current = true;
      void runAgentSafely({ agentId: "critical-path", phaseId: "program", triggeredBy: "trigger" }, () => {
        criticalPathRunning.current = false;
      });
    }

    if (shouldTriggerChangeImpact && !changeImpactRunning.current) {
      changeImpactRunning.current = true;
      void runAgentSafely({ agentId: "change-impact", phaseId: "program", triggeredBy: "trigger" }, () => {
        changeImpactRunning.current = false;
      });
    }

    if (shouldTriggerStakeholder && !stakeholderRunning.current) {
      stakeholderRunning.current = true;
      void runAgentSafely({ agentId: "stakeholder", phaseId: "program", triggeredBy: "trigger" }, () => {
        stakeholderRunning.current = false;
      });
    }

    if (shouldTriggerAdoption && !adoptionRunning.current) {
      adoptionRunning.current = true;
      void runAgentSafely({ agentId: "adoption", phaseId: "program", triggeredBy: "trigger" }, () => {
        adoptionRunning.current = false;
      });
    }

    if (shouldTriggerHealth && !healthHeatmapRunning.current) {
      healthHeatmapRunning.current = true;
      void runAgentSafely({ agentId: "health-heatmap", phaseId: "program", triggeredBy: "trigger" }, () => {
        healthHeatmapRunning.current = false;
      });
    }

    if (shouldTriggerScopePcr && !scopePcrRunning.current) {
      scopePcrRunning.current = true;
      void runAgentSafely({ agentId: "scope-pcr", phaseId: "program", triggeredBy: "trigger" }, () => {
        scopePcrRunning.current = false;
      });
    }
  }, [activeRuns, adoptionGeneratedAt, budgetGeneratedAt, canRunAgents, changeImpactGeneratedAt, criticalPathGeneratedAt, healthHeatmapGeneratedAt, phases, programId, raidGeneratedAt, runAgentSafely, scopePcrGeneratedAt, stakeholderGeneratedAt]);

  useEffect(() => {
    if (!canRunAgents) return;

    const nextPhaseSnapshots = new Map(phases.map((phase) => [phase.id, phase.pct]));
    const nextRaidSnapshots = new Set(raidEntries.map((entry) => `${entry.id}:${entry.type}:${entry.severity}:${entry.status}`));
    const nextMilestoneSnapshots = new Map(milestones.map((milestone) => [milestone.id, milestone.status]));
    const nextDecisionSnapshots = new Set(
      decisions
        .filter((decision) => decision.status !== "resolved")
        .map((decision) => `${decision.id}:${decision.status || "pending"}`),
    );

    if (!phaseSnapshotReady.current) {
      phaseSnapshots.current = nextPhaseSnapshots;
      phaseSnapshotReady.current = true;
    }
    if (!raidSnapshotReady.current) {
      raidEntrySnapshots.current = nextRaidSnapshots;
      raidSnapshotReady.current = true;
    }
    if (!milestoneSnapshotReady.current) {
      milestoneSnapshots.current = nextMilestoneSnapshots;
      milestoneSnapshotReady.current = true;
    }
    if (!decisionSnapshotReady.current) {
      decisionSnapshots.current = nextDecisionSnapshots;
      decisionSnapshotReady.current = true;
    }

    const phaseAdvancedMeaningfully = phases.some((phase) => {
      const previousPct = phaseSnapshots.current.get(phase.id);
      return typeof previousPct === "number" && phase.pct - previousPct > 10;
    });
    const phaseGateCrossovers = phases.filter((phase) => {
      const previousPct = phaseSnapshots.current.get(phase.id);
      return typeof previousPct === "number"
        && previousPct < 90
        && phase.pct >= 90;
    });
    const previousAverageReadiness = Array.from(phaseSnapshots.current.values()).reduce((sum, pct) => sum + pct, 0) / Math.max(phaseSnapshots.current.size, 1);
    const currentAverageReadiness = phases.reduce((sum, phase) => sum + phase.pct, 0) / Math.max(phases.length, 1);
    const newMilestoneRisk = raidEntries.some((entry) => {
      const key = `${entry.id}:${entry.type}:${entry.severity}:${entry.status}`;
      return MILESTONE_RISK_TYPES.has(entry.type) && !raidEntrySnapshots.current.has(key);
    });
    const newHighSeverityRisk = raidEntries.some((entry) => {
      const key = `${entry.id}:${entry.type}:${entry.severity}:${entry.status}`;
      return entry.status !== "closed"
        && (entry.severity === "high" || entry.severity === "critical")
        && !raidEntrySnapshots.current.has(key);
    });
    const milestoneStatusShifted = milestones.some((milestone) => {
      const previousStatus = milestoneSnapshots.current.get(milestone.id);
      return previousStatus !== milestone.status
        && (milestone.status === "complete" || milestone.status === "delayed");
    });
    const unresolvedDecisionChanged = (
      Array.from(nextDecisionSnapshots).some((key) => !decisionSnapshots.current.has(key))
      || Array.from(decisionSnapshots.current).some((key) => !nextDecisionSnapshots.has(key))
    );
    const overdueDecisionPresent = hasOverdueDecision(decisions);
    const retroPhaseCrossovers = phases.filter((phase) => {
      const previousPct = phaseSnapshots.current.get(phase.id);
      const generatedAt = retrosGeneratedAt[phase.id] || null;
      return (
        phase.pct >= 90
        && (
          (typeof previousPct === "number" && previousPct < 90)
          || isOlderThan(generatedAt, SEVENTY_TWO_HOURS_MS)
        )
      );
    });

    phaseSnapshots.current = nextPhaseSnapshots;
    raidEntrySnapshots.current = nextRaidSnapshots;
    milestoneSnapshots.current = nextMilestoneSnapshots;
    decisionSnapshots.current = nextDecisionSnapshots;

    if (isOlderThan(milestonesGeneratedAt, TWELVE_HOURS_MS) && !milestoneRunning.current && (phaseAdvancedMeaningfully || newMilestoneRisk)) {
      milestoneRunning.current = true;
      void runAgentSafely({ agentId: "milestone", phaseId: "program", triggeredBy: "trigger" }, () => {
        milestoneRunning.current = false;
      });
    }

    if (isOlderThan(budgetGeneratedAt, ONE_DAY_MS) && !budgetRunning.current && milestoneStatusShifted) {
      budgetRunning.current = true;
      void runAgentSafely({ agentId: "budget", phaseId: "program", triggeredBy: "trigger" }, () => {
        budgetRunning.current = false;
      });
    }

    if (
      isOlderThan(criticalPathGeneratedAt, TWELVE_HOURS_MS)
      && !criticalPathRunning.current
      && (phaseAdvancedMeaningfully || newHighSeverityRisk || unresolvedDecisionChanged)
    ) {
      criticalPathRunning.current = true;
      void runAgentSafely({ agentId: "critical-path", phaseId: "program", triggeredBy: "trigger" }, () => {
        criticalPathRunning.current = false;
      });
    }

    retroPhaseCrossovers.forEach((phase) => {
      if (retroRunningPhases.has(phase.id)) return;
      setRetroRunningPhases((prev) => new Set([...prev, phase.id]));
      void runAgentSafely({ agentId: "retro", phaseId: phase.id, triggeredBy: "trigger" }, () => {
        setRetroRunningPhases((prev) => {
          const next = new Set(prev);
          next.delete(phase.id);
          return next;
        });
      });
    });

    if (
      isOlderThan(escalationsLastCheckedAt, SIX_HOURS_MS)
      && !escalationRunning.current
      && (newHighSeverityRisk || overdueDecisionPresent)
    ) {
      startEscalationRun();
      void runAgentSafely({ agentId: "escalation", phaseId: "program", triggeredBy: "trigger" }, () => {
        finishEscalationRun();
      });
    }

    if (
      isOlderThan(scopePcrGeneratedAt, FORTY_EIGHT_HOURS_MS)
      && !scopePcrRunning.current
      && phases.filter((phase) => phase.pct > 0).length >= 2
      && (newHighSeverityRisk || unresolvedDecisionChanged || phaseAdvancedMeaningfully)
    ) {
      scopePcrRunning.current = true;
      void runAgentSafely({ agentId: "scope-pcr", phaseId: "program", triggeredBy: "trigger" }, () => {
        scopePcrRunning.current = false;
      });
    }

    if (
      ((
        !closure
        && currentAverageReadiness >= 90
        && previousAverageReadiness < 90
      ) || (
        closure?.status === "not-ready"
        && phases.every((phase) => phase.pct >= 90)
        && phaseGateCrossovers.length > 0
      ))
      && !closureRunning.current
    ) {
      closureRunning.current = true;
      void runAgentSafely({ agentId: "closure", phaseId: "program", triggeredBy: "trigger" }, () => {
        closureRunning.current = false;
      });
    }
  }, [
    budgetGeneratedAt,
    canRunAgents,
    closure,
    criticalPathGeneratedAt,
    decisions,
    escalationsLastCheckedAt,
    gateReviews,
    milestones,
    milestonesGeneratedAt,
    phases,
    programId,
    raidEntries,
    retrosGeneratedAt,
    runAgentSafely,
    finishEscalationRun,
    scopePcrGeneratedAt,
    startEscalationRun,
  ]);

  const triggerNarrative = useCallback(() => {
    if (narrativeRunning.current) return;
    narrativeRunning.current = true;
    void runAgentSafely({ agentId: "narrative", phaseId: "program", triggeredBy: "user" }, () => {
      narrativeRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerRisk = useCallback(() => {
    if (riskRunning.current) return;
    riskRunning.current = true;
    void runAgentSafely({ agentId: "risk", phaseId: "program", triggeredBy: "user" }, () => {
      riskRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerMilestones = useCallback(() => {
    if (milestoneRunning.current) return;
    milestoneRunning.current = true;
    void runAgentSafely({ agentId: "milestone", phaseId: "program", triggeredBy: "user" }, () => {
      milestoneRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerBudget = useCallback(() => {
    if (budgetRunning.current) return;
    budgetRunning.current = true;
    void runAgentSafely({ agentId: "budget", phaseId: "program", triggeredBy: "user" }, () => {
      budgetRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerCriticalPath = useCallback(() => {
    if (criticalPathRunning.current) return;
    criticalPathRunning.current = true;
    void runAgentSafely({ agentId: "critical-path", phaseId: "program", triggeredBy: "user" }, () => {
      criticalPathRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerChangeImpact = useCallback(() => {
    if (changeImpactRunning.current) return;
    changeImpactRunning.current = true;
    void runAgentSafely({ agentId: "change-impact", phaseId: "program", triggeredBy: "user" }, () => {
      changeImpactRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerStakeholders = useCallback(() => {
    if (stakeholderRunning.current) return;
    stakeholderRunning.current = true;
    void runAgentSafely({ agentId: "stakeholder", phaseId: "program", triggeredBy: "user" }, () => {
      stakeholderRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerAdoption = useCallback(() => {
    if (adoptionRunning.current) return;
    adoptionRunning.current = true;
    void runAgentSafely({ agentId: "adoption", phaseId: "program", triggeredBy: "user" }, () => {
      adoptionRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerHealthHeatmap = useCallback(() => {
    if (healthHeatmapRunning.current) return;
    healthHeatmapRunning.current = true;
    void runAgentSafely({ agentId: "health-heatmap", phaseId: "program", triggeredBy: "user" }, () => {
      healthHeatmapRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerRetro = useCallback((phaseId: string) => {
    if (retroRunningPhases.has(phaseId)) return;
    setRetroRunningPhases((prev) => new Set([...prev, phaseId]));
    void runAgentSafely({ agentId: "retro", phaseId, triggeredBy: "user" }, () => {
      setRetroRunningPhases((prev) => {
        const next = new Set(prev);
        next.delete(phaseId);
        return next;
      });
    });
  }, [runAgentSafely]);

  const triggerDeck = useCallback(() => {
    if (deckRunning.current) return;
    deckRunning.current = true;
    void runAgentSafely({ agentId: "deck", phaseId: "program", triggeredBy: "user" }, () => {
      deckRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerScopePcr = useCallback(() => {
    if (scopePcrRunning.current) return;
    scopePcrRunning.current = true;
    void runAgentSafely({ agentId: "scope-pcr", phaseId: "program", triggeredBy: "user" }, () => {
      scopePcrRunning.current = false;
    });
  }, [runAgentSafely]);

  const triggerEscalation = useCallback(() => {
    if (escalationRunning.current) return;
    startEscalationRun();
    void runAgentSafely({ agentId: "escalation", phaseId: "program", triggeredBy: "user" }, () => {
      finishEscalationRun();
    });
  }, [finishEscalationRun, runAgentSafely, startEscalationRun]);

  const triggerClosure = useCallback(() => {
    if (closureRunning.current) return;
    closureRunning.current = true;
    void runAgentSafely({ agentId: "closure", phaseId: "program", triggeredBy: "user" }, () => {
      closureRunning.current = false;
    });
  }, [runAgentSafely]);

  return {
    triggerNarrative,
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
    triggerEscalation,
    triggerClosure,
    escalationIsRunning,
    changeImpactIsRunning,
    stakeholderIsRunning,
    adoptionIsRunning,
    healthHeatmapIsRunning,
    retroRunningPhases,
    deckIsRunning,
    scopePcrIsRunning,
    programVelocity,
  };
}
