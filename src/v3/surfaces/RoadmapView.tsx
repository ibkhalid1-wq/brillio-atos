import React from "react";
import type { Milestone, ProgramSummary } from "@/new/types";
import { PlanView } from "@/new/pages/PlanView";
import { MilestoneView } from "@/new/pages/MilestoneView";
import RoadmapGantt from "@/v3/components/RoadmapGantt";
import { buildRoadmapRows } from "@/v3/lib/phaseSchedule";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";

interface RoadmapViewProps {
  program: ProgramSummary | null;
  planIsRunning: boolean;
  onTriggerPlan: () => void;
  milestonesIsRunning: boolean;
  onTriggerMilestones: () => void;
  onAddMilestone: (milestone: Omit<Milestone, "id" | "source" | "lastUpdatedAt">) => Promise<void>;
  onCompleteMilestone: (milestoneId: string) => Promise<void>;
  milestoneSavePending: boolean;
}

/**
 * The Strategic Roadmap is the single delivery artifact: a phase timeline plus
 * the folded delivery plan and milestones (both persisted under
 * `strategicRoadmap` rather than as standalone artifacts). This surface renders
 * all three from one program so the More-menu tile mirrors the strategy-stage
 * artifact preview.
 */
export default function RoadmapView({
  program,
  planIsRunning,
  onTriggerPlan,
  milestonesIsRunning,
  onTriggerMilestones,
  onAddMilestone,
  onCompleteMilestone,
  milestoneSavePending,
}: RoadmapViewProps) {
  const roadmapRows = React.useMemo(
    () => buildRoadmapRows(program?.rawData, (program?.phases || []) as Array<{ id: string }>),
    [program?.rawData, program?.phases],
  );

  return (
    <div className="v3-section" style={{ display: "grid", gap: 16 }}>
      <AdamCard>
        <AdamCardHeader
          title="Strategic roadmap"
          subtitle="Phase timeline across the programme window, weighted by each phase's typical duration."
        />
        <AdamCardBody>
          <RoadmapGantt rows={roadmapRows} />
        </AdamCardBody>
      </AdamCard>

      <PlanView
        program={program}
        plan={program?.plan || null}
        planGeneratedAt={program?.planGeneratedAt || ""}
        planIsRunning={planIsRunning}
        onTriggerPlan={onTriggerPlan}
      />

      <MilestoneView
        program={program}
        milestonesIsRunning={milestonesIsRunning}
        onTriggerMilestones={onTriggerMilestones}
        onAddMilestone={onAddMilestone}
        onCompleteMilestone={onCompleteMilestone}
        isSaving={milestoneSavePending}
      />
    </div>
  );
}
