import React from "react";
import type { AgentRun } from "@/lib/adamSync";
import { buildAgentActivityMap, buildAgentCards } from "@/new/lib/programData";
import { AcceleratorsView } from "@/new/pages/AcceleratorsView";
import { BudgetView } from "@/new/pages/BudgetView";
import { TwinView } from "@/new/pages/TwinView";
import { ChangeImpactView } from "@/new/pages/ChangeImpactView";
import { DeckView } from "@/new/pages/DeckView";
import { HealthHeatmapView } from "@/new/pages/HealthHeatmapView";
import { IntelligenceView } from "@/new/pages/IntelligenceView";
import { MilestoneView } from "@/new/pages/MilestoneView";
import { NarrativeView } from "@/new/pages/NarrativeView";
import { PlanView } from "@/new/pages/PlanView";
import RoadmapView from "@/v3/surfaces/RoadmapView";
import { ClosureView } from "@/new/pages/ClosureView";
import { RisksView } from "@/new/pages/RisksView";
import { ScopePcrView } from "@/new/pages/ScopePcrView";
import { StakeholderView } from "@/new/pages/StakeholderView";
import RosterRaciView from "@/v3/surfaces/RosterRaciView";
import DocumentImportPanel from "@/new/components/DocumentImportPanel";
import DocumentList from "@/new/components/DocumentList";
import MeetingNotesPanel from "@/v3/components/MeetingNotesPanel";
import type { AppView, Milestone, ProgramSummary } from "@/new/types";
import ProgramAccessPanel from "@/v3/components/ProgramAccessPanel";
import { ArtifactMapTree } from "@/v3/components/ArtifactMapTree";
import ProgramGraphPanel from "@/v3/components/ProgramGraphPanel";
import { OntologyView } from "@/new/pages/OntologyView";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import type { V3MoreView, V3ReportId } from "@/v3/types";

/** Statuses that represent a closed-out (decided) queue entry. */
const RESOLVED_DECISION_STATUSES = new Set(["approved", "deferred", "rejected", "modified", "resolved", "escalated"]);

function DecisionAuditView({ program }: { program: ProgramSummary | null }) {
  // The audit trail is sourced directly from the resolved entries of the
  // program's own decisionQueue (stamped with status/resolvedAt/resolvedBy by
  // updateDecisionInProgram). The legacy `adam_decision_audit` table is never
  // written to, so reading it would always show an empty screen.
  const auditLog = React.useMemo(() => {
    const queue = program?.decisionQueue || [];
    return queue
      .filter((d) => Boolean(d.resolvedAt) || RESOLVED_DECISION_STATUSES.has(String(d.status || "").toLowerCase()))
      .sort((left, right) => {
        const lt = new Date(left.resolvedAt || left.createdAt || 0).getTime();
        const rt = new Date(right.resolvedAt || right.createdAt || 0).getTime();
        return rt - lt;
      });
  }, [program?.decisionQueue]);

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
                <AdamCard key={entry.id}>
                  <AdamCardBody className="v3-program-detail-stack" padded>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>
                        {entry.title || entry.id}
                      </div>
                      <span className="v3-chip muted" style={{ fontSize: 11 }}>{String(entry.status || "resolved")}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                      {entry.resolvedAt ? <RelativeTime date={entry.resolvedAt} /> : "Unknown date"} · {entry.resolvedBy || "unknown"} · {entry.phaseId || "program"}
                    </div>
                    {entry.humanNote ? (
                      <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 2 }}>
                        “{entry.humanNote}”
                      </div>
                    ) : null}
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
    triggerClosure: () => void;
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
  onSaveBudgetInputs: (patch: { projectedCost: number | null; actualSpend: number | null; projectedBenefits: number | null; realisedBenefits: number | null; phaseActuals?: Record<string, number> }) => Promise<void>;
  onSaveNarrativeCorrection: (note: string) => Promise<void>;
  onSavePhaseInputs: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  onSaveAllPhaseInputs?: (allInputs: Record<string, Record<string, string>>, firstPhaseId?: string) => Promise<void>;
  onRefineImportField?: (phaseId: string, fieldId: string, fieldLabel: string, existingValue: string, incomingValue: string) => Promise<string>;
  onOpenIntelligence: () => void;
  intelligenceInitialTab?: string;
  onOpenTrace: (runId: string) => void;
  onOpenPhase: (phaseId: string) => void;
  onNavigate: (view: AppView) => void;
  patternsCount: number;
  onExtractPatterns: () => Promise<void>;
  onRunAgent?: (agentId: string, phaseId?: string) => void;
  onSaveRoadmapSchedule?: (schedule: Record<string, { start: string; end: string }>) => Promise<void>;
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
  onRefineImportField,
  onRunAgent,
  onSaveRoadmapSchedule,
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
            dynamicSchemaStore={getDynamicSchemaStore(program?.rawData)}
            lockedPhaseIds={(() => {
              // Gate-approved phases have frozen inputs — an import must not write
              // them (handleSaveAllPhaseInputs drops them server-side). Surface that
              // set to the review panel so the user sees the phase is locked BEFORE
              // curating fields, rather than via a post-save "N phases skipped" toast.
              const gr = program?.gateReviews ?? {};
              return new Set(
                Object.keys(gr).filter((phaseId) => gr[phaseId]?.status === "approved"),
              );
            })()}
            onSavePhaseInputs={async (phaseId, inputs) => {
              await onSavePhaseInputs(phaseId, inputs);
              onOpenPhase(phaseId);
            }}
            onSaveAllPhaseInputs={onSaveAllPhaseInputs}
            onRefineField={onRefineImportField}
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
    case "roadmap":
      return (
        <RoadmapView
          program={program}
          healthIsRunning={healthHeatmapIsRunning}
          onTriggerHealth={triggers.triggerHealthHeatmap}
          onSaveRoadmapSchedule={onSaveRoadmapSchedule}
        />
      );
    case "plan":
      return <PlanView program={program} plan={program?.plan || null} planGeneratedAt={program?.planGeneratedAt || ""} planIsRunning={activeRuns.some((r) => r.agent_id === "strategic-roadmap" && r.status === "running")} onTriggerPlan={() => onRunAgent?.("strategic-roadmap", "strategy")} />;
    case "milestones":
      return <MilestoneView program={program} milestonesIsRunning={activeRuns.some((r) => r.agent_id === "milestone" && r.status === "running")} onTriggerMilestones={triggers.triggerMilestones} onAddMilestone={onAddMilestone} onCompleteMilestone={onCompleteMilestone} isSaving={milestoneSavePending} />;
    case "risks":
      return <RisksView program={program} raidAgentRunning={activeRuns.some((r) => r.agent_id === "risk" && r.status === "running")} onTriggerRiskAgent={triggers.triggerRisk} onRefresh={onRefresh} />;
    case "budget":
      return <BudgetView program={program} budgetIsRunning={activeRuns.some((r) => r.agent_id === "budget" && r.status === "running")} onTriggerBudget={triggers.triggerBudget} onSaveBudgetInputs={onSaveBudgetInputs} savePending={budgetSavePending} />;
    case "twin":
      return <TwinView program={program} />;
    case "change-impact":
      return <ChangeImpactView program={program} isRunning={triggers.changeImpactIsRunning} onTriggerChangeImpact={triggers.triggerChangeImpact} />;
    case "stakeholders":
      return <StakeholderView program={program} isRunning={triggers.stakeholderIsRunning} onTriggerStakeholders={triggers.triggerStakeholders} />;
    case "roster":
      return <RosterRaciView program={program} />;
    case "health":
      return <HealthHeatmapView program={program} isRunning={healthHeatmapIsRunning} onTriggerHealthHeatmap={triggers.triggerHealthHeatmap} onSelectPhase={onOpenPhase} onRunAgent={onRunAgent} />;
    case "scope-pcr":
      return <ScopePcrView program={program} isRunning={triggers.scopePcrIsRunning} onTriggerScopePcr={triggers.triggerScopePcr} onNavigate={onNavigate} />;
    case "intelligence":
      return <IntelligenceView program={program} onRefreshProgram={onRefresh} initialTab={intelligenceInitialTab as "Status" | "Setup" | undefined} onRunAgent={onRunAgent} />;
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
    case "program-graph":
      return <ProgramGraphPanel program={program} programId={programId} />;
    case "accelerators":
      return <AcceleratorsView program={program} onNavigate={onNavigate} patternsCount={patternsCount} onExtractPatterns={onExtractPatterns} />;
    case "access":
      return <ProgramAccessPanel programId={programId} currentUserId={currentUserId ?? null} />;
    case "decision-audit":
      return <DecisionAuditView program={program} />;
    case "ontology":
      return (
        <OntologyView
          program={program}
          onRunValidation={onRunAgent ? (phaseId?: string) => onRunAgent("cross-artifact-validator", phaseId ?? "program") : undefined}
          validationIsRunning={activeRuns.some((r) => r.agent_id === "cross-artifact-validator" && r.status === "running")}
          validatingPhaseId={activeRuns.find((r) => r.agent_id === "cross-artifact-validator" && r.status === "running")?.phase_id ?? null}
        />
      );
    case "closure":
      return (
        <ClosureView
          program={program}
          onTriggerClosure={() => void triggers.triggerClosure()}
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
