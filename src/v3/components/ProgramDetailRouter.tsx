import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AgentRun } from "@/lib/adamSync";
import { buildAgentActivityMap, buildAgentCards } from "@/new/lib/programData";
import { AcceleratorsView } from "@/new/pages/AcceleratorsView";
import { AdoptionView } from "@/new/pages/AdoptionView";
import { BudgetView } from "@/new/pages/BudgetView";
import { ChangeImpactView } from "@/new/pages/ChangeImpactView";
import { CriticalPathView } from "@/new/pages/CriticalPathView";
import { DeckView } from "@/new/pages/DeckView";
import { HealthHeatmapView } from "@/new/pages/HealthHeatmapView";
import { IntelligenceView, PatternLibraryView, AgentActivityView, ArtifactHistoryView } from "@/new/pages/IntelligenceView";
import { MilestoneView } from "@/new/pages/MilestoneView";
import { NarrativeView } from "@/new/pages/NarrativeView";
import { PlanView } from "@/new/pages/PlanView";
import { RetroView } from "@/new/pages/RetroView";
import { ClosureView } from "@/new/pages/ClosureView";
import { RisksView } from "@/new/pages/RisksView";
import { ScopePcrView } from "@/new/pages/ScopePcrView";
import { StakeholderView } from "@/new/pages/StakeholderView";
import { TwinView } from "@/new/pages/TwinView";
import DocumentImportPanel from "@/new/components/DocumentImportPanel";
import DocumentList from "@/new/components/DocumentList";
import MeetingNotesPanel from "@/v3/components/MeetingNotesPanel";
import type { AppView, Milestone, ProgramSummary } from "@/new/types";
import SchedulePanel from "@/v3/components/SchedulePanel";
import ProgramAccessPanel from "@/v3/components/ProgramAccessPanel";
import TwinGraphView from "@/v3/components/TwinGraphView";
import { ArtifactMapTree } from "@/v3/components/ArtifactMapTree";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import type { V3MoreView, V3ReportId } from "@/v3/types";

function BenchmarkView({
  program,
  onExtractPatterns,
}: {
  program: ProgramSummary | null;
  onExtractPatterns: () => Promise<void>;
}) {
  const benchmark = program?.benchmarkComparison || null;
  if (!benchmark) {
    return (
      <div className="v3-section">
        <AdamCard>
          <AdamCardBody>
            <EmptyState
              compact
              icon="⊞"
              title="No benchmark comparison yet"
              description="Run pattern extraction to compare this programme against similar delivery patterns."
              action={{ label: "Extract patterns", onClick: () => void onExtractPatterns() }}
            />
          </AdamCardBody>
        </AdamCard>
      </div>
    );
  }
  return (
    <div className="v3-section">
      <AdamCard>
        <AdamCardHeader
          title="Benchmark comparison"
          subtitle="How this programme compares against similar delivery patterns"
          action={(
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => void onExtractPatterns()}>
              Refresh
            </button>
          )}
        />
        <AdamCardBody className="v3-program-detail-stack">
          <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.7 }}>
            {benchmark.summary}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {benchmark.comparisons.map((row) => (
              <AdamCard key={row.dimension} accent={row.signal === "concerning" ? "danger" : row.signal === "strong" ? "success" : "none"}>
                <AdamCardBody className="v3-program-detail-stack" padded>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>{row.dimension}</div>
                    <span className={`v3-chip ${row.signal === "concerning" ? "red" : row.signal === "strong" ? "green" : "muted"}`} style={{ fontSize: 11 }}>
                      {row.percentile}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.6 }}>
                    Programme: {row.programValue} · Benchmark: {row.benchmarkRange}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{row.insight}</div>
                </AdamCardBody>
              </AdamCard>
            ))}
          </div>
        </AdamCardBody>
      </AdamCard>
    </div>
  );
}

function DecisionAuditView({ programId }: { programId: string | null }) {
  const [auditLog, setAuditLog] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (!programId || !supabase) {
      setAuditLog([]);
      return;
    }
    void supabase
      .from("adam_decision_audit")
      .select("*")
      .eq("program_id", programId)
      .order("resolved_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setAuditLog((data || []) as Array<Record<string, unknown>>));
  }, [programId]);

  return (
    <div className="v3-section">
      <AdamCard>
        <AdamCardHeader
          title="Decision audit trail"
          subtitle="Resolved decisions across the programme"
          badge={auditLog.length ? <span className="v3-chip muted" style={{ fontSize: 11 }}>{auditLog.length} entries</span> : undefined}
        />
        <AdamCardBody>
          {auditLog.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {auditLog.map((entry) => (
                <AdamCard key={String(entry.id)}>
                  <AdamCardBody className="v3-program-detail-stack" padded>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
                        {String(entry.decision_title || entry.decision_id || "")}
                      </div>
                      <span className="v3-chip muted" style={{ fontSize: 11 }}>{String(entry.resolution || "")}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                      {entry.resolved_at ? <RelativeTime date={String(entry.resolved_at)} /> : "Unknown date"} · {String(entry.resolved_by || "unknown")} · {String(entry.phase_id || "program")}
                    </div>
                  </AdamCardBody>
                </AdamCard>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon="◌"
              title="No audited decisions yet"
              description="Resolved decisions will appear here once governance actions start to accumulate."
            />
          )}
        </AdamCardBody>
      </AdamCard>
    </div>
  );
}

interface ProgramDetailRouterProps {
  view: V3MoreView | null;
  reportId?: V3ReportId | null;
  program: ProgramSummary | null;
  programId: string | null;
  activeRuns: AgentRun[];
  triggers: {
    triggerNarrative: () => void;
    triggerDeck: () => void;
    triggerPlan: () => void;
    triggerRisk: () => void;
    triggerMilestones: () => void;
    triggerBudget: () => void;
    triggerCriticalPath: () => void;
    triggerChangeImpact: () => void;
    triggerStakeholders: () => void;
    triggerAdoption: () => void;
    triggerHealthHeatmap: () => void;
    triggerRetro: (phaseId: string) => void;
    triggerScopePcr: () => void;
    retroRunningPhases: Set<string>;
    changeImpactIsRunning: boolean;
    stakeholderIsRunning: boolean;
    adoptionIsRunning: boolean;
    healthHeatmapIsRunning: boolean;
    scopePcrIsRunning: boolean;
    deckIsRunning: boolean;
    runTwinSync?: () => void;
  };
  agentCards: ReturnType<typeof buildAgentCards>;
  agentActivityMap: ReturnType<typeof buildAgentActivityMap>;
  narrativeIsRunning: boolean;
  healthHeatmapIsRunning: boolean;
  milestoneSavePending: boolean;
  budgetSavePending: boolean;
  onRefresh: () => Promise<void>;
  onAddMilestone: (m: Omit<Milestone, "id" | "source" | "lastUpdatedAt">) => Promise<void>;
  onCompleteMilestone: (id: string) => Promise<void>;
  onSaveBudgetInputs: (patch: { projectedCost: number | null; actualSpend: number | null; projectedBenefits: number | null; realisedBenefits: number | null }) => Promise<void>;
  onSaveNarrativeCorrection: (note: string) => Promise<void>;
  onSavePhaseInputs: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  onSaveAllPhaseInputs?: (allInputs: Record<string, Record<string, string>>, firstPhaseId?: string) => Promise<void>;
  onOpenIntelligence: () => void;
  intelligenceInitialTab?: string;
  onOpenTrace: (runId: string) => void;
  onOpenPhase: (phaseId: string) => void;
  onNavigate: (view: AppView) => void;
  patternsCount: number;
  onExtractPatterns: () => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
  currentUserId?: string | null;
}

export default function ProgramDetailRouter({
  view,
  reportId,
  program,
  programId,
  activeRuns,
  triggers,
  agentCards,
  agentActivityMap,
  narrativeIsRunning,
  healthHeatmapIsRunning,
  milestoneSavePending,
  budgetSavePending,
  onRefresh,
  onAddMilestone,
  onCompleteMilestone,
  onSaveBudgetInputs,
  onSaveNarrativeCorrection,
  onOpenIntelligence,
  intelligenceInitialTab,
  onOpenTrace,
  onOpenPhase,
  onNavigate,
  patternsCount,
  onExtractPatterns,
  onSavePhaseInputs,
  onSaveAllPhaseInputs,
  onRunAgent,
  currentUserId,
}: ProgramDetailRouterProps) {
  if (!view && reportId === "narrative") {
    return <NarrativeView program={program} onRefresh={triggers.triggerNarrative} isRunning={narrativeIsRunning} onSaveCorrection={onSaveNarrativeCorrection} onOpenIntelligence={onOpenIntelligence} />;
  }

  if (!view && reportId === "deck") {
    return <DeckView program={program} isRunning={triggers.deckIsRunning} onTriggerDeck={triggers.triggerDeck} onOpenIntelligence={onOpenIntelligence} />;
  }

  switch (view) {
    case "documents":
      return (
        <div className="v3-section">
          <DocumentImportPanel
            programId={programId}
            existingPhaseInputs={(() => {
              // Extract existing phaseInputs from program rawData for conflict detection
              const raw = program?.rawData as Record<string, unknown> | undefined;
              const source = raw && typeof raw.data === "object" && raw.data !== null
                ? raw.data as Record<string, unknown>
                : raw ?? {};
              const pi = source.phaseInputs;
              return (typeof pi === "object" && pi !== null) ? pi as Record<string, Record<string, string>> : {};
            })()}
            onSavePhaseInputs={async (phaseId, inputs) => {
              await onSavePhaseInputs(phaseId, inputs);
              onOpenPhase(phaseId);
            }}
            onSaveAllPhaseInputs={onSaveAllPhaseInputs}
            onComplete={async () => { await onRefresh(); }}
          />
          <DocumentList programId={programId} />
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)", marginBottom: 8 }}>
              Process Meeting Notes
            </div>
            <MeetingNotesPanel
              programId={programId}
              onComplete={onRefresh}
            />
          </div>
        </div>
      );
    case "narrative":
      return <NarrativeView program={program} onRefresh={triggers.triggerNarrative} isRunning={narrativeIsRunning} onSaveCorrection={onSaveNarrativeCorrection} onOpenIntelligence={onOpenIntelligence} />;
    case "plan":
      return <PlanView program={program} plan={program?.plan || null} planGeneratedAt={program?.planGeneratedAt || ""} planIsRunning={activeRuns.some((r) => r.agent_id === "plan" && r.status === "running")} onTriggerPlan={triggers.triggerPlan} />;
    case "milestones":
      return <MilestoneView program={program} milestonesIsRunning={activeRuns.some((r) => r.agent_id === "milestone" && r.status === "running")} onTriggerMilestones={triggers.triggerMilestones} onAddMilestone={onAddMilestone} onCompleteMilestone={onCompleteMilestone} isSaving={milestoneSavePending} />;
    case "risks":
      return <RisksView program={program} raidAgentRunning={activeRuns.some((r) => r.agent_id === "risk" && r.status === "running")} onTriggerRiskAgent={triggers.triggerRisk} onRefresh={onRefresh} />;
    case "budget":
      return <BudgetView program={program} budgetIsRunning={activeRuns.some((r) => r.agent_id === "budget" && r.status === "running")} onTriggerBudget={triggers.triggerBudget} onSaveBudgetInputs={onSaveBudgetInputs} savePending={budgetSavePending} />;
    case "critical-path":
      return <CriticalPathView program={program} isRunning={activeRuns.some((r) => r.agent_id === "critical-path" && r.status === "running")} onTriggerCriticalPath={triggers.triggerCriticalPath} />;
    case "change-impact":
      return <ChangeImpactView program={program} isRunning={triggers.changeImpactIsRunning} onTriggerChangeImpact={triggers.triggerChangeImpact} />;
    case "stakeholders":
      return <StakeholderView program={program} isRunning={triggers.stakeholderIsRunning} onTriggerStakeholders={triggers.triggerStakeholders} />;
    case "adoption":
      return <AdoptionView program={program} isRunning={triggers.adoptionIsRunning} onTriggerAdoption={triggers.triggerAdoption} />;
    case "health":
      return <HealthHeatmapView program={program} isRunning={healthHeatmapIsRunning} onTriggerHealthHeatmap={triggers.triggerHealthHeatmap} onSelectPhase={onOpenPhase} onRunAgent={onRunAgent} />;
    case "retro":
      return <RetroView program={program} runningPhases={triggers.retroRunningPhases} onTriggerRetro={triggers.triggerRetro} onOpenIntelligence={onOpenIntelligence} />;
    case "scope-pcr":
      return <ScopePcrView program={program} isRunning={triggers.scopePcrIsRunning} onTriggerScopePcr={triggers.triggerScopePcr} onNavigate={onNavigate} />;
    case "intelligence":
      return <IntelligenceView program={program} onRefreshProgram={onRefresh} initialTab={intelligenceInitialTab as "Status" | "Autonomy" | "Setup" | undefined} />;
    case "pattern-library":
      return <PatternLibraryView program={program} />;
    case "agent-activity":
      return <AgentActivityView program={program} />;
    case "artifact-history":
      return <ArtifactHistoryView program={program} onRefreshProgram={onRefresh} />;
    case "twin":
      return triggers.runTwinSync
        ? (
          <TwinGraphView
            graph={{
              nodes: (program?.twinGraph?.nodes || []) as Array<{ id: string; type: string; label: string; description?: string; status?: string; phase?: string }>,
              edges: (program?.twinGraph?.edges || []) as Array<{ source: string; target: string; type: string; label?: string }>,
              syncedAt: undefined,
            }}
            onSyncTwin={triggers.runTwinSync}
            isSyncing={activeRuns.some((run) => run.agent_id === "twin-sync" && run.status === "running")}
          />
        )
        : <TwinView program={program} agentCards={agentCards} agentActivityMap={agentActivityMap} onOpenWorkspace={onOpenPhase} onViewTrace={onOpenTrace} />;
    case "artifact-map":
      return (
        <div className="v3-section">
          <AdamCard>
            <AdamCardHeader
              title="Artifact map"
              subtitle="The complete programme tree — every phase with its inputs, artifacts and a summary of where each came from."
            />
            <AdamCardBody>
              <ArtifactMapTree program={program} />
            </AdamCardBody>
          </AdamCard>
        </div>
      );
    case "accelerators":
      return <AcceleratorsView program={program} onNavigate={onNavigate} patternsCount={patternsCount} onExtractPatterns={onExtractPatterns} />;
    case "schedules":
      return <SchedulePanel programId={programId} program={program} />;
    case "access":
      return <ProgramAccessPanel programId={programId} currentUserId={currentUserId ?? null} />;
    case "benchmark":
      return <BenchmarkView program={program} onExtractPatterns={onExtractPatterns} />;
    case "decision-audit":
      return <DecisionAuditView programId={programId} />;
    case "closure":
      return (
        <ClosureView
          program={program}
          onTriggerClosure={() => void triggers.triggerGateReview("valuerealize")}
          closureIsRunning={activeRuns.some((r) => r.agent_id === "closure-pack" && r.status === "running")}
          onApproveClosure={() => undefined}
          onArchiveProgram={() => undefined}
          onNavigate={onNavigate}
        />
      );
    default:
      return null;
  }
}
