import React from "react";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";

/**
 * Renders the Build-phase Sprint Plan (produced by the `sprint-planner` support
 * agent and stored at `inner.sprintPlan`). Like the Discovery Pack it is a
 * support artifact, not a gated deliverable, so it never appears in the
 * methodology-driven output strip — instead it surfaces through the "View sprint
 * plan" button, which opens this panel in a modal. Every field is optional AI
 * output, so each section renders only when it carries content.
 */

interface Sprint {
  sprintNumber?: number;
  startDate?: string;
  endDate?: string;
  goal?: string;
  milestones?: string[];
  workstreams?: string[];
  capacity?: number;
  risks?: string[];
}

export interface SprintPlan {
  sprints?: Sprint[];
  criticalPath?: string[];
  bufferWeeks?: number;
  generatedAt?: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function fmtDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SprintCard({ sprint, index }: { sprint: Sprint; index: number }) {
  const milestones = strings(sprint.milestones);
  const workstreams = strings(sprint.workstreams);
  const risks = strings(sprint.risks);
  const start = fmtDate(sprint.startDate);
  const end = fmtDate(sprint.endDate);
  const window = start && end ? `${start} → ${end}` : start || end || null;
  return (
    <div style={{ border: "1px solid var(--v3-border)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>
        Sprint {sprint.sprintNumber ?? index + 1}
        {window ? <span style={{ fontWeight: 400, color: "var(--v3-text-muted)" }}> · {window}</span> : null}
        {typeof sprint.capacity === "number" && sprint.capacity > 0 ? (
          <span style={{ fontWeight: 400, color: "var(--v3-text-muted)" }}> · {sprint.capacity} cap</span>
        ) : null}
      </div>
      {sprint.goal ? (
        <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.5, marginTop: 3 }}>{sprint.goal}</div>
      ) : null}
      {workstreams.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {workstreams.map((ws, i) => (
            <span key={`ws-${i}`} className="v3-chip muted" style={{ fontSize: 10 }}>{ws}</span>
          ))}
        </div>
      ) : null}
      {milestones.length ? (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 3 }}>
          {milestones.map((m, i) => (
            <li key={`ms-${i}`} style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{m}</li>
          ))}
        </ul>
      ) : null}
      {risks.length ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--v3-text-muted)" }}>
          Risks: {risks.join("; ")}
        </div>
      ) : null}
    </div>
  );
}

export default function SprintPlanPanel({ plan }: { plan: SprintPlan }) {
  const sprints = Array.isArray(plan.sprints)
    ? plan.sprints.filter((s): s is Sprint => !!s && typeof s === "object" && !Array.isArray(s))
    : [];
  const criticalPath = strings(plan.criticalPath);

  return (
    <div>
      <div className="v3-output-preview-head">
        <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
          Sprint breakdown, critical path, and buffer for delivering this phase
        </div>
        {plan.generatedAt ? (
          <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
            <RelativeTime date={plan.generatedAt} />
          </span>
        ) : null}
      </div>

      {typeof plan.bufferWeeks === "number" && plan.bufferWeeks > 0 ? (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--v3-text-secondary)" }}>
          Buffer: <strong>{plan.bufferWeeks}</strong> week{plan.bufferWeeks === 1 ? "" : "s"}
        </div>
      ) : null}

      {sprints.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="v3-output-preview-label">Sprints</div>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {sprints.map((sprint, index) => (
              <SprintCard key={`sprint-${index}`} sprint={sprint} index={index} />
            ))}
          </div>
        </div>
      ) : null}

      {criticalPath.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="v3-output-preview-label">Critical path</div>
          <ol style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            {criticalPath.map((item, index) => (
              <li key={`cp-${index}`} style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.55 }}>{item}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {!sprints.length && !criticalPath.length ? (
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--v3-text-muted)" }}>
          The sprint plan is empty. Re-plan sprints once milestones and team capacity are captured.
        </div>
      ) : null}
    </div>
  );
}
