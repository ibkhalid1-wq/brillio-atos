import React, { useMemo, useState } from "react";
import { NotReadyCard } from "@/new/components/ui/NotReadyCard";
import type { Milestone, PhaseSummary } from "@/new/types";

interface MilestoneCardProps {
  milestones: Milestone[];
  phases: PhaseSummary[];
  milestonesGeneratedAt: string | null;
  onTrigger: () => void;
  onAddMilestone: (milestone: Omit<Milestone, "id" | "source" | "lastUpdatedAt">) => Promise<void> | void;
  onCompleteMilestone?: (milestoneId: string) => Promise<void> | void;
  isRunning?: boolean;
  isSaving?: boolean;
}

const STATUS_ORDER: Array<Milestone["status"]> = ["complete", "on-track", "at-risk", "delayed"];
const STATUS_LABELS: Record<Milestone["status"], string> = {
  complete: "Complete",
  "on-track": "On track",
  "at-risk": "At risk",
  delayed: "Delayed",
};

const EMPTY_FORM = {
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

export function MilestoneCard({
  milestones,
  phases,
  milestonesGeneratedAt,
  onTrigger,
  onAddMilestone,
  onCompleteMilestone,
  isRunning = false,
  isSaving = false,
}: MilestoneCardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [expandedMilestoneId, setExpandedMilestoneId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const milestonesById = useMemo(() => (
    new Map(milestones.map((milestone) => [milestone.id, milestone]))
  ), [milestones]);

  const groupedMilestones = useMemo(() => STATUS_ORDER.map((status) => ({
    status,
    items: milestones.filter((milestone) => milestone.status === status),
  })).filter((group) => group.items.length > 0), [milestones]);

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
      setForm(EMPTY_FORM);
      setAddOpen(false);
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

  const header = (
    <div className="adam-row adam-space-between" style={{ alignItems: "flex-start" }}>
      <div className="adam-stack" style={{ gap: 4 }}>
        <div className="adam-title">Milestones</div>
        <div className="adam-micro adam-muted">
          {milestones.length} tracked · Updated {formatTimestamp(milestonesGeneratedAt)}
        </div>
      </div>
      <div className="adam-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span className="adam-badge slate">{milestones.length}</span>
        <button
          type="button"
          className="adam-button-ghost"
          onClick={onTrigger}
          disabled={isRunning}
          style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
        >
          {isRunning ? "Re-deriving…" : "Re-derive with ATOS"}
        </button>
        <button
          type="button"
          className="adam-button"
          onClick={() => setAddOpen((current) => !current)}
          style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }}
        >
          {addOpen ? "Close form" : "Add milestone"}
        </button>
      </div>
    </div>
  );

  if (!milestones.length && !isRunning) {
    return (
      <div className="adam-stack">
        <div className="adam-card p-5">
          {header}
        </div>
        {addOpen ? (
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
                  {phases.map((phase) => (
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
                placeholder="Criterion 1&#10;Criterion 2&#10;Criterion 3"
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
        <NotReadyCard
          title="Milestones"
          reason="ATOS needs at least one phase with measurable progress before it can derive milestone timing and dependencies."
          onTrigger={onTrigger}
          triggerLabel="Generate milestones"
          isRunning={isRunning}
        />
      </div>
    );
  }

  return (
    <section className="adam-card p-5">
      {header}

      {addOpen ? (
        <div className="adam-stack adam-milestone-form" style={{ gap: 12, marginTop: 16 }}>
          <div className="adam-grid two" style={{ gap: 12 }}>
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
                {phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>{phase.displayName}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="adam-grid two" style={{ gap: 12 }}>
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
          <div className="adam-stack" style={{ gap: 6 }}>
            <label className="adam-micro adam-muted">Exit criteria (one per line)</label>
            <textarea
              className="adam-textarea"
              rows={4}
              value={form.exitCriteria}
              onChange={(event) => setForm((current) => ({ ...current, exitCriteria: event.target.value }))}
              placeholder="Criterion 1&#10;Criterion 2&#10;Criterion 3"
            />
          </div>
          <div className="adam-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="adam-button"
              onClick={() => void submitMilestone()}
              disabled={submitting || isSaving || !form.title.trim() || !form.phaseId}
            >
              {submitting || isSaving ? "Saving…" : "Save milestone"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="adam-stack" style={{ gap: 14, marginTop: 16 }}>
        {groupedMilestones.map((group) => (
          <div key={group.status} className="adam-stack" style={{ gap: 8 }}>
            <div className="adam-row" style={{ justifyContent: "space-between" }}>
              <div className="adam-micro adam-muted">{STATUS_LABELS[group.status]}</div>
              <span className="adam-badge slate">{group.items.length}</span>
            </div>
            <div className="adam-list">
              {group.items.map((milestone) => {
                const phaseLabel = phases.find((phase) => phase.id === milestone.phaseId)?.displayName || milestone.phaseId;
                const dependencyTitles = milestone.dependsOn
                  .map((dependencyId) => milestonesById.get(dependencyId)?.title)
                  .filter(Boolean) as string[];
                const isExpanded = expandedMilestoneId === milestone.id;
                const confidenceWidth = `${Math.max(6, Math.round(milestone.confidence * 100))}%`;
                return (
                  <div key={milestone.id} className="adam-list-item adam-milestone-item">
                    <div className="adam-row adam-space-between" style={{ alignItems: "flex-start", gap: 12 }}>
                      <div className="adam-stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                        <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <span className={`adam-milestone-dot ${group.status}`} />
                          <div className="adam-body" style={{ fontWeight: 600 }}>{milestone.title}</div>
                          <span className="adam-badge slate">{phaseLabel}</span>
                          {milestone.targetDate ? (
                            <span className="adam-micro adam-muted">
                              Due {new Date(milestone.targetDate).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="adam-micro adam-muted">Date TBD</span>
                          )}
                        </div>
                        <div className="adam-milestone-confidence">
                          <span
                            className={`adam-milestone-confidence-fill ${group.status}`}
                            style={{ width: confidenceWidth }}
                          />
                        </div>
                        <div className="adam-row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <span className="adam-micro adam-muted">
                            {Math.round(milestone.confidence * 100)}% confidence
                          </span>
                          {dependencyTitles.length ? (
                            <span className="adam-micro adam-muted">
                              Blocked by {dependencyTitles.join(", ")}
                            </span>
                          ) : null}
                          <span className="adam-micro adam-muted">
                            {milestone.source === "human" ? "Human milestone" : "Derived by ATOS"}
                          </span>
                        </div>
                      </div>
                      <div className="adam-row" style={{ gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
                        {milestone.exitCriteria.length ? (
                          <button
                            type="button"
                            className="adam-button-ghost"
                            onClick={() => setExpandedMilestoneId(isExpanded ? null : milestone.id)}
                            style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
                          >
                            {isExpanded ? "Hide criteria" : `Exit criteria (${milestone.exitCriteria.length})`}
                          </button>
                        ) : null}
                        {milestone.status !== "complete" && onCompleteMilestone ? (
                          <button
                            type="button"
                            className="adam-button-ghost"
                            onClick={() => void completeMilestone(milestone.id)}
                            disabled={completingId === milestone.id}
                            style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
                          >
                            {completingId === milestone.id ? "Saving…" : "Mark complete"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {isExpanded ? (
                      <div className="adam-stack adam-milestone-criteria" style={{ gap: 8, marginTop: 12 }}>
                        {milestone.exitCriteria.map((criterion, index) => (
                          <div key={`${milestone.id}-${index}`} className="adam-row" style={{ alignItems: "flex-start", gap: 8 }}>
                            <span className="adam-milestone-bullet" />
                            <span className="adam-body adam-muted">{criterion}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
