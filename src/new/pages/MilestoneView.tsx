import React, { useState } from "react";
import { AgentPulse } from "@/new/components/ui/AgentPulse";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { Milestone, PhaseSummary, ProgramSummary } from "@/new/types";
import { confidenceLabel, confidenceTone } from "@/v3/utils";

function exportMilestonesCsv(milestones: Milestone[], programName: string) {
  const headers = ["ID", "Title", "Phase", "Status", "Target Date", "Source", "Exit Criteria"];
  const rows = milestones.map((milestone) => [
    milestone.id,
    `"${(milestone.title || "").replace(/"/g, "\"\"")}"`,
    milestone.phaseId,
    milestone.status,
    milestone.targetDate || "",
    milestone.source,
    `"${milestone.exitCriteria.join("; ").replace(/"/g, "\"\"")}"`,
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${programName}-milestones.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

interface MilestoneViewProps {
  program: ProgramSummary | null;
  milestonesIsRunning?: boolean;
  onTriggerMilestones: () => void;
  onAddMilestone: (milestone: Omit<Milestone, "id" | "source" | "lastUpdatedAt">) => Promise<void> | void;
  onCompleteMilestone?: (milestoneId: string) => Promise<void> | void;
  isSaving?: boolean;
}

type StatusFilter = "all" | Milestone["status"];
type SourceFilter = "all" | Milestone["source"];
type GroupMode = "phase" | "status" | "flat";

const STATUS_BADGE: Record<Milestone["status"], string> = {
  complete: "green",
  "on-track": "green",
  "at-risk": "amber",
  delayed: "red",
};

const GROUP_EMPTY_FORM = {
  title: "",
  phaseId: "",
  targetDate: "",
  exitCriteria: "",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "just now";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "just now";
  return parsed.toLocaleString();
}

function byDate(left: Milestone, right: Milestone): number {
  if (!left.targetDate && !right.targetDate) return left.title.localeCompare(right.title);
  if (!left.targetDate) return 1;
  if (!right.targetDate) return -1;
  return new Date(left.targetDate).getTime() - new Date(right.targetDate).getTime();
}

function buildGroups(mode: GroupMode, milestones: Milestone[], phases: PhaseSummary[]) {
  if (mode === "flat") {
    return [{ id: "all", label: "All milestones", items: [...milestones].sort(byDate) }];
  }

  if (mode === "status") {
    return ([
      { id: "on-track", label: "On track" },
      { id: "at-risk", label: "At risk" },
      { id: "delayed", label: "Delayed" },
      { id: "complete", label: "Complete" },
    ] as Array<{ id: Milestone["status"]; label: string }>).map((group) => ({
      id: group.id,
      label: group.label,
      items: milestones.filter((milestone) => milestone.status === group.id).sort(byDate),
    })).filter((group) => group.items.length);
  }

  return phases.map((phase) => ({
    id: phase.id,
    label: phase.displayName,
    items: milestones.filter((milestone) => milestone.phaseId === phase.id).sort(byDate),
  })).filter((group) => group.items.length);
}

export function MilestoneView({
  program,
  milestonesIsRunning = false,
  onTriggerMilestones,
  onAddMilestone,
  onCompleteMilestone,
  isSaving = false,
}: MilestoneViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("phase");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(GROUP_EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  if (!program) {
    return (
      <NotReadyCard
        title="Milestones"
        reason="No active program. Connect Supabase and select a program to manage milestones."
      />
    );
  }

  const milestones = program.milestones || [];
  const counts = {
    total: milestones.length,
    complete: milestones.filter((entry) => entry.status === "complete").length,
    onTrack: milestones.filter((entry) => entry.status === "on-track").length,
    atRisk: milestones.filter((entry) => entry.status === "at-risk").length,
    delayed: milestones.filter((entry) => entry.status === "delayed").length,
  };

  const filteredMilestones = milestones
    .filter((entry) => statusFilter === "all" || entry.status === statusFilter)
    .filter((entry) => sourceFilter === "all" || entry.source === sourceFilter);

  const groupedMilestones = buildGroups(groupMode, filteredMilestones, program.phases);
  const milestonesConfidence = milestones.length
    ? milestones.reduce((total, milestone) => total + milestone.confidence, 0) / milestones.length
    : null;

  const timelineMilestones = [...milestones]
    .filter((entry) => !!entry.targetDate)
    .sort(byDate);

  const submitMilestone = async () => {
    if (!form.title.trim() || !form.phaseId) return;
    setSubmitting(true);
    try {
      await onAddMilestone({
        title: form.title.trim(),
        phaseId: form.phaseId,
        targetDate: form.targetDate || null,
        status: "on-track",
        dependsOn: [],
        exitCriteria: form.exitCriteria
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean),
        confidence: 0.65,
      });
      setForm(GROUP_EMPTY_FORM);
      setFormOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const completeMilestone = async (milestoneId: string) => {
    if (!onCompleteMilestone) return;
    setCompletingId(milestoneId);
    try {
      await onCompleteMilestone(milestoneId);
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="adam-stack" style={{ maxWidth: 1120 }}>
      <section className="adam-card p-5">
        <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div className="adam-stack" style={{ gap: 6 }}>
            <div className="adam-heading-xl">Milestones</div>
            {milestonesConfidence !== null ? (
              <div>
                <span className={`v3-chip ${confidenceTone(milestonesConfidence)}`} title={confidenceLabel(milestonesConfidence)}>
                  {Math.round(milestonesConfidence * 100)}% confidence
                </span>
              </div>
            ) : null}
            <div className="adam-body adam-muted">
              Agent-derived and human-authored milestones in one place, grouped around delivery posture.
            </div>
            <div className="adam-micro adam-muted">
              Updated {formatTimestamp(program.milestonesGeneratedAt)}
            </div>
          </div>
          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="v3-export-btn" onClick={() => exportMilestonesCsv(program.milestones || [], program.name || "program")}>
              Export CSV
            </button>
            <button
              type="button"
              className="adam-button-ghost"
              onClick={onTriggerMilestones}
              disabled={milestonesIsRunning}
            >
              {milestonesIsRunning ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              className="adam-button"
              onClick={() => setFormOpen((current) => !current)}
            >
              {formOpen ? "Close form" : "Add milestone"}
            </button>
          </div>
        </div>

        <div className="mt-5 adam-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">Total</div>
            <div className="adam-heading-lg">{counts.total}</div>
          </div>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">On track</div>
            <div className="adam-heading-lg">{counts.onTrack}</div>
            <span className="adam-badge green">Green</span>
          </div>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">At risk</div>
            <div className="adam-heading-lg">{counts.atRisk}</div>
            <span className="adam-badge amber">Amber</span>
          </div>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">Delayed</div>
            <div className="adam-heading-lg">{counts.delayed}</div>
            <span className="adam-badge red">Red</span>
          </div>
          <div className="adam-kpi">
            <div className="adam-micro adam-muted">Complete</div>
            <div className="adam-heading-lg">{counts.complete}</div>
            <span className="adam-badge slate">Done</span>
          </div>
        </div>
      </section>

      {formOpen ? (
        <section className="adam-card p-5">
          <div className="adam-title">Add milestone</div>
          <div className="adam-grid two" style={{ gap: 12, marginTop: 16 }}>
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Title</label>
              <input
                className="adam-input"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Milestone title"
              />
            </div>
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Phase</label>
              <select
                className="adam-select"
                value={form.phaseId}
                onChange={(event) => setForm((current) => ({ ...current, phaseId: event.target.value }))}
              >
                <option value="">Select phase</option>
                {program.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>{phase.displayName}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="adam-grid two" style={{ gap: 12, marginTop: 12 }}>
            <div className="adam-stack" style={{ gap: 6 }}>
              <label className="adam-micro adam-muted">Target date</label>
              <input
                className="adam-input"
                type="date"
                value={form.targetDate}
                onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))}
              />
            </div>
          </div>
          <div className="adam-stack" style={{ gap: 6, marginTop: 12 }}>
            <label className="adam-micro adam-muted">Exit criteria (one per line)</label>
            <textarea
              className="adam-textarea"
              rows={4}
              value={form.exitCriteria}
              onChange={(event) => setForm((current) => ({ ...current, exitCriteria: event.target.value }))}
              placeholder={"Criterion 1\nCriterion 2\nCriterion 3"}
            />
          </div>
          <div className="adam-row" style={{ gap: 8, marginTop: 16 }}>
            <button
              type="button"
              className="adam-button"
              onClick={() => void submitMilestone()}
              disabled={submitting || isSaving || !form.title.trim() || !form.phaseId}
            >
              {submitting || isSaving ? "Saving…" : "Save milestone"}
            </button>
          </div>
        </section>
      ) : null}

      {!milestones.length ? (
        <NotReadyCard
          title="Milestones"
          reason="ATOS generates milestones once phases are underway. You can also add milestones manually."
          onTrigger={onTriggerMilestones}
          triggerLabel="Generate milestones"
          isRunning={milestonesIsRunning}
        />
      ) : (
        <>
          <section className="adam-card p-5">
            <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div className="adam-title">Filter and sort</div>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {([
                  { id: "phase", label: "By Phase" },
                  { id: "status", label: "By Status" },
                  { id: "flat", label: "Flat List" },
                ] as Array<{ id: GroupMode; label: string }>).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`adam-chip ${groupMode === option.id ? "is-active" : ""}`}
                    onClick={() => setGroupMode(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 adam-stack" style={{ gap: 12 }}>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {([
                  { id: "all", label: "All" },
                  { id: "on-track", label: "On Track" },
                  { id: "at-risk", label: "At Risk" },
                  { id: "delayed", label: "Delayed" },
                  { id: "complete", label: "Complete" },
                ] as Array<{ id: StatusFilter; label: string }>).map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`adam-chip ${statusFilter === filter.id ? "is-active" : ""}`}
                    onClick={() => setStatusFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {([
                  { id: "all", label: "All sources" },
                  { id: "agent", label: "Agent" },
                  { id: "human", label: "Human" },
                ] as Array<{ id: SourceFilter; label: string }>).map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`adam-chip ${sourceFilter === filter.id ? "is-active" : ""}`}
                    onClick={() => setSourceFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {timelineMilestones.length >= 3 ? (
            <section className="adam-card p-5">
              <div className="adam-title">Timeline strip</div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {timelineMilestones.map((milestone, index) => (
                  <React.Fragment key={milestone.id}>
                    <span className="adam-chip" style={{ alignItems: "center" }}>
                      <span className={`adam-badge ${STATUS_BADGE[milestone.status]}`} style={{ padding: "3px 7px", fontSize: 10 }}>
                        {milestone.status.replace("-", " ")}
                      </span>
                      <span>{milestone.title}</span>
                      {milestone.targetDate ? (
                        <span className="adam-micro adam-muted">{new Date(milestone.targetDate).toLocaleDateString()}</span>
                      ) : null}
                    </span>
                    {index < timelineMilestones.length - 1 ? <span className="adam-micro adam-muted">→</span> : null}
                  </React.Fragment>
                ))}
              </div>
            </section>
          ) : null}

          <section className="adam-stack" style={{ gap: 18 }}>
            {groupedMilestones.length ? groupedMilestones.map((group) => (
              <section key={group.id} className="adam-card p-5">
                <div className="adam-title">{group.label}</div>
                <div className="mt-4 adam-list">
                  {group.items.map((milestone) => (
                    <div key={milestone.id} className="adam-list-item">
                      <div className="adam-row adam-space-between" style={{ gap: 12, alignItems: "flex-start" }}>
                        <div className="adam-stack" style={{ gap: 8 }}>
                          <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <div className="adam-body">{milestone.title}</div>
                            <span className="adam-chip">{program.phases.find((phase) => phase.id === milestone.phaseId)?.displayName || milestone.phaseId}</span>
                            {milestone.source === "agent" ? (
                              <span className="adam-row" style={{ gap: 6, alignItems: "center" }}>
                                <AgentPulse status="complete" size="sm" />
                                <span className="adam-micro adam-muted">Agent</span>
                              </span>
                            ) : (
                              <span className="adam-micro adam-muted">Human</span>
                            )}
                          </div>
                          <div className="adam-micro adam-muted">
                            {milestone.targetDate ? `Target ${new Date(milestone.targetDate).toLocaleDateString()}` : "Target date pending"}
                            {` · ${milestone.exitCriteria.length} exit criter${milestone.exitCriteria.length === 1 ? "ion" : "ia"}`}
                            {` · ${Math.round((milestone.confidence || 0) * 100)}% confidence`}
                          </div>
                          {milestone.exitCriteria.length ? (
                            <div className="adam-row" style={{ gap: 6, flexWrap: "wrap" }}>
                              {milestone.exitCriteria.slice(0, 4).map((criterion, index) => (
                                <span key={`${milestone.id}-${index}`} className="adam-badge slate">{criterion}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="adam-stack" style={{ gap: 8, alignItems: "flex-end" }}>
                          <span className={`adam-badge ${STATUS_BADGE[milestone.status]}`}>{milestone.status.replace("-", " ")}</span>
                          {milestone.status !== "complete" && onCompleteMilestone ? (
                            <button
                              type="button"
                              className="adam-button-ghost"
                              onClick={() => void completeMilestone(milestone.id)}
                              disabled={completingId === milestone.id}
                            >
                              {completingId === milestone.id ? "Completing…" : "Mark complete"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )) : (
              <section className="adam-card p-5">
                <div className="adam-body adam-muted">No milestones match the current filters.</div>
              </section>
            )}
          </section>
        </>
      )}
    </div>
  );
}
