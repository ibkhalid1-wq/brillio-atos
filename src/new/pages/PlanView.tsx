import React, { useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { PlanBlocker, PlanMilestone, PlanSummary, ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";
import { exportAsPDF, exportAsDocx, planToHtml } from "@/v3/lib/documentExport";

interface PlanViewProps {
  program: ProgramSummary | null;
  plan: PlanSummary | null;
  planGeneratedAt: string;
  planIsRunning?: boolean;
  onTriggerPlan: () => void;
}

const STATUS_BADGE: Record<PlanMilestone["status"], string> = {
  complete: "green",
  "on-track": "green",
  "at-risk": "amber",
  blocked: "red",
  "not-started": "slate",
};

const BLOCKER_BADGE: Record<PlanBlocker["severity"], string> = {
  critical: "red",
  high: "amber",
  medium: "slate",
};

const CRITICAL_BADGE: Record<string, string> = {
  complete: "green",
  "in-progress": "blue",
  blocked: "red",
  "not-started": "slate",
};

type PlanTab = "actions" | "milestones" | "blockers";
type MilestoneFilter = "all" | "on-track" | "at-risk" | "delayed" | "complete";

const MILESTONE_FILTERS: Array<{ id: MilestoneFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "on-track", label: "On Track" },
  { id: "at-risk", label: "At Risk" },
  { id: "delayed", label: "Delayed" },
  { id: "complete", label: "Complete" },
];

function groupActions(plan: PlanSummary) {
  return plan.nextThreeActions.reduce<Record<string, PlanSummary["nextThreeActions"]>>((accumulator, action) => {
    const phase = action.phase || "program";
    accumulator[phase] = [...(accumulator[phase] || []), action];
    return accumulator;
  }, {});
}

export function PlanView({
  program,
  plan,
  planGeneratedAt,
  planIsRunning = false,
  onTriggerPlan,
}: PlanViewProps) {
  const [activeTab, setActiveTab] = useState<PlanTab>("actions");
  const [milestoneFilter, setMilestoneFilter] = useState<MilestoneFilter>("all");
  const [showExportMenu, setShowExportMenu] = useState(false);

  if (!program) {
    return (
      <NotReadyCard
        title="Transformation plan"
        reason="No active program. Connect Supabase and select a program to generate the plan."
      />
    );
  }

  if (!plan) {
    return (
      <NotReadyCard
        title="Transformation plan"
        reason="ADAM needs a program objective and at least one phase underway before it can generate the plan."
        onTrigger={onTriggerPlan}
        triggerLabel="Generate plan"
        isRunning={planIsRunning}
      />
    );
  }

  const filteredMilestones = (() => {
    if (milestoneFilter === "all") return plan.milestones;
    if (milestoneFilter === "delayed") return plan.milestones.filter((entry) => entry.status === "blocked");
    return plan.milestones.filter((entry) => entry.status === milestoneFilter);
  })();

  const groupedActions = groupActions(plan);
  const blockers = [...plan.blockerSummary].sort((left, right) => {
    const order = { critical: 0, high: 1, medium: 2 };
    return order[left.severity] - order[right.severity];
  });
  const timestamp = planGeneratedAt ? new Date(planGeneratedAt).toLocaleString() : "just now";

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Transformation Plan</div>
            <div>
              <span className={`v3-chip ${confidenceTone(program.planConfidence ?? plan.confidence)}`} title={confidenceLabel(program.planConfidence ?? plan.confidence)}>
                {Math.round((program.planConfidence ?? plan.confidence) * 100)}% confidence
              </span>
            </div>
            <div className="adam-body adam-muted">
              The cross-phase plan, milestones, blockers, and current path to value for this program.
            </div>
            <div className="adam-micro adam-muted">Generated {timestamp}</div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className={`adam-badge ${plan.confidence >= 0.7 ? "green" : plan.confidence >= 0.45 ? "amber" : "red"}`}>
              {Math.round(plan.confidence * 100)}% confidence
            </span>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerPlan}
              disabled={planIsRunning}
            >
              {planIsRunning ? "Refreshing…" : "Refresh plan"}
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid var(--v3-border)", background: "var(--v3-surface-2)", cursor: "pointer", color: "var(--v3-text-secondary)" }}
                onClick={() => setShowExportMenu((v) => !v)}
              >
                Export ▾
              </button>
              {showExportMenu && (() => {
                const exportTitle = `Transformation Plan — ${program?.name || ""}`;
                const planForExport = { milestones: plan.milestones as unknown as Array<Record<string, unknown>>, nextThreeActions: plan.nextThreeActions as unknown as Array<Record<string, unknown>>, blockerSummary: plan.blockerSummary as unknown as Array<Record<string, unknown>>, criticalPath: plan.criticalPath };
                const progForExport = { name: program?.name, client: (program as Record<string, unknown>).client as string | undefined };
                return (
                  <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", zIndex: 50, minWidth: 130 }}>
                    {([["PDF", () => { exportAsPDF(exportTitle, planToHtml(progForExport, planForExport)); setShowExportMenu(false); }], ["Word Doc", () => { exportAsDocx(exportTitle, planToHtml(progForExport, planForExport)); setShowExportMenu(false); }]] as Array<[string, () => void]>).map(([label, fn]) => (
                      <button key={label} type="button" onClick={fn} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--v3-text-primary)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--v3-surface-2)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                      >{label}</button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </section>

      {(program.criticalPath?.sequence?.length || plan.criticalPath.length) ? (
        <section className="adam-card p-5">
          <div className="adam-title">Critical path</div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {program.criticalPath?.sequence?.length
              ? program.criticalPath.sequence.map((node, index) => (
                <React.Fragment key={node.phaseId}>
                  <span
                    className="adam-chip"
                    style={{
                      borderColor: node.isBottleneck ? "rgba(220,38,38,0.35)" : undefined,
                      color: node.isBottleneck ? "#fecaca" : undefined,
                    }}
                  >
                    <span className={`adam-badge ${CRITICAL_BADGE[node.status] || "slate"}`} style={{ padding: "3px 7px", fontSize: 10 }}>
                      {node.status.replace("-", " ")}
                    </span>
                    <span>{node.phaseName || node.phaseId}</span>
                    {node.isBottleneck ? <span className="adam-badge red">Bottleneck</span> : null}
                  </span>
                  {index < program.criticalPath.sequence.length - 1 ? <span className="adam-micro adam-muted">→</span> : null}
                </React.Fragment>
              ))
              : plan.criticalPath.map((phaseId, index) => (
                <React.Fragment key={phaseId}>
                  <span className="adam-chip">{phaseId}</span>
                  {index < plan.criticalPath.length - 1 ? <span className="adam-micro adam-muted">→</span> : null}
                </React.Fragment>
              ))}
          </div>

          {program.criticalPath?.currentBottleneck ? (
            <div className="mt-4 adam-list-item" style={{ borderColor: "rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.08)" }}>
              <div className="adam-title">
                Current bottleneck: {program.criticalPath.currentBottleneck.phaseName} · {program.criticalPath.estimatedCompletionDelta}
              </div>
              <div className="mt-2 adam-body">{program.criticalPath.currentBottleneck.reason}</div>
            </div>
          ) : null}

          {program.criticalPath?.offCriticalPath?.length ? (
            <div className="mt-4 adam-stack" style={{ gap: 8 }}>
              <div className="adam-micro adam-muted">Off critical path</div>
              <div className="flex flex-wrap gap-2">
                {program.criticalPath.offCriticalPath.map((phaseId) => (
                  <span key={phaseId} className="adam-chip">
                    {program.phases.find((phase) => phase.id === phaseId)?.displayName || phaseId}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="adam-card p-5">
        <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {([
            { id: "actions", label: "Next Actions" },
            { id: "milestones", label: "Milestones" },
            { id: "blockers", label: "Blockers" },
          ] as Array<{ id: PlanTab; label: string }>).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`adam-chip ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "actions" ? (
          <div className="mt-4 adam-stack" style={{ gap: 16 }}>
            {Object.entries(groupedActions).length ? Object.entries(groupedActions).map(([phase, actions]) => (
              <div key={phase} className="adam-stack" style={{ gap: 10 }}>
                <div className="adam-title">{phase}</div>
                <div className="adam-list">
                  {actions.map((action, index) => (
                    <div key={`${phase}-${index}`} className="adam-list-item">
                      <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "flex-start" }}>
                        <div className="adam-stack" style={{ gap: 6 }}>
                          <div className="adam-body">{action.action}</div>
                          <div className="adam-micro adam-muted">{action.rationale}</div>
                        </div>
                        {action.owner ? <span className="adam-badge slate">{action.owner}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <div className="adam-list-item adam-body adam-muted">No next actions are available yet.</div>
            )}
          </div>
        ) : null}

        {activeTab === "milestones" ? (
          <div className="mt-4 adam-stack" style={{ gap: 14 }}>
            <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {MILESTONE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`adam-chip ${milestoneFilter === filter.id ? "is-active" : ""}`}
                  onClick={() => setMilestoneFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="adam-list">
              {filteredMilestones.length ? filteredMilestones.map((milestone) => (
                <div key={milestone.id} className="adam-list-item">
                  <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "flex-start" }}>
                    <div className="adam-stack" style={{ gap: 6 }}>
                      <div className="adam-body">{milestone.title}</div>
                      <div className="adam-micro adam-muted">
                        {milestone.phase}
                        {milestone.dueDate ? ` · Due ${new Date(milestone.dueDate).toLocaleDateString()}` : " · Date TBD"}
                        {milestone.owner ? ` · ${milestone.owner}` : ""}
                      </div>
                    </div>
                    <span className={`adam-badge ${STATUS_BADGE[milestone.status] || "slate"}`}>
                      {milestone.status.replace("-", " ")}
                    </span>
                  </div>
                </div>
              )) : (
                <div className="adam-list-item adam-body adam-muted">No milestones match this filter.</div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "blockers" ? (
          <div className="mt-4 adam-list">
            {blockers.length ? blockers.map((blocker, index) => (
              <div key={`${blocker.phase}-${index}`} className="adam-list-item">
                <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "flex-start" }}>
                  <div className="adam-stack" style={{ gap: 6 }}>
                    <div className="adam-body">{blocker.blocker}</div>
                    <div className="adam-micro adam-muted">
                      {blocker.phase}{blocker.resolution ? ` · ${blocker.resolution}` : ""}
                    </div>
                  </div>
                  <span className={`adam-badge ${BLOCKER_BADGE[blocker.severity] || "slate"}`}>
                    {blocker.severity}
                  </span>
                </div>
              </div>
            )) : (
              <div className="adam-list-item adam-body adam-muted">No blockers are currently tracked.</div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
