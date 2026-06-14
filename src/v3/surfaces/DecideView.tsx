import React, { useEffect, useMemo, useState } from "react";
import { buildDecisionQueue } from "@/lib/adamDecisionUtils";
import { PHASE_LABELS } from "@/v3/lib/uiHelpers";
import type { DecisionSummary, GateReview, ProgramSummary } from "@/new/types";
import type { Persona } from "@/new/types";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import type { V3Mode } from "@/v3/types";
import { isDecisionOpen, phaseName, phaseNameById } from "@/v3/utils";

interface DecideViewProps {
  program: ProgramSummary | null;
  activePhaseId: string | null;
  mode: V3Mode;
  persona?: Persona;
  onResolveDecision: (decisionId: string, resolution: "approved" | "deferred" | "rejected" | "modified", modifiedContent?: string) => Promise<void> | void;
  onAddDecision: (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => Promise<void>;
  onApproveGate: (phaseId: string) => Promise<void>;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
}

type Scope = "stage" | "all";
type ReviewDecision = DecisionSummary & {
  previewContent?: Record<string, unknown>;
  agentId?: string;
};

const EMPTY_DECISION = {
  question: "",
  title: "",
  type: "other" as DecisionSummary["type"],
  priority: "medium" as DecisionSummary["priority"],
  phaseId: "",
  recommendation: "",
  options: [] as string[],
};

function priorityVariant(priority: string): "critical" | "high" | "medium" | "low" {
  if (priority === "critical") return "critical";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "medium";
}

function gateVariant(status: GateReview["status"] | undefined): "approved" | "remediation" | "pending" | "locked" {
  if (status === "approved") return "approved";
  if (status === "remediation-requested") return "remediation";
  if (status === "not-ready") return "locked";
  return "pending";
}

type ActionBucket = "blocking" | "attention" | "recommended";

// Action Center buckets every open item into one of three sections so the user
// never has to reason about decision vs. gate vs. risk taxonomy — just urgency.
function classifyBucket(decision: ReviewDecision): ActionBucket {
  const ageDays = decision.createdAt
    ? (Date.now() - new Date(decision.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  if (decision.priority === "critical" || ageDays >= 14) return "blocking";
  if (decision.priority === "high" || ageDays >= 7) return "attention";
  return "recommended";
}

const BUCKET_META: Record<ActionBucket, { title: string; sub: string; tone: string }> = {
  blocking: { title: "Blocking progress", sub: "Resolve these to keep the programme moving", tone: "var(--v3-red)" },
  attention: { title: "Needs attention", sub: "Important, not yet blocking", tone: "var(--v3-amber)" },
  recommended: { title: "Recommended actions", sub: "Good next moves when you have capacity", tone: "var(--v3-text-muted)" },
};

function ArtifactPreview({ agentId, content }: { agentId: string; content: Record<string, unknown> }) {
  if (agentId === "narrative") {
    const text = typeof content.narrative === "string" ? content.narrative : JSON.stringify(content, null, 2);
    return <p style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.65, margin: 0 }}>{text}</p>;
  }
  if (agentId === "plan") {
    const actions = Array.isArray(content.nextThreeActions) ? content.nextThreeActions as Array<{ action?: string }> : [];
    return (
      <ol style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
        {actions.slice(0, 5).map((action, index) => (
          <li key={index} style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{action.action || JSON.stringify(action)}</li>
        ))}
        {!actions.length ? <li style={{ color: "var(--v3-text-muted)", fontSize: 12 }}>No action preview available.</li> : null}
      </ol>
    );
  }
  const readable = Object.entries(content)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, 3);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {readable.map(([key, value]) => (
        <div key={key}>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{key}</div>
          <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>{String(value).slice(0, 300)}</div>
        </div>
      ))}
      {!readable.length ? <span style={{ color: "var(--v3-text-muted)", fontSize: 12 }}>No preview available.</span> : null}
    </div>
  );
}

function GateTimeline({
  program,
  activePhaseId,
  selectedPhaseId,
  onPhaseSelect,
}: {
  program: ProgramSummary;
  activePhaseId: string | null;
  selectedPhaseId: string | null;
  onPhaseSelect: (phaseId: string | null) => void;
}) {
  return (
    <div className="v3-governance-timeline">
      {(program.phases || []).map((phase) => {
        const gate = program.gateReviews?.[phase.id];
        const isActive = phase.id === activePhaseId;
        const isSelected = phase.id === selectedPhaseId;
        const isLocked = phase.status === "inactive";
        const variant = gateVariant(gate?.status);

        return (
          <button
            key={phase.id}
            type="button"
            className={`v3-governance-timeline-item ${isSelected ? "is-selected" : ""} ${isLocked ? "is-locked" : ""}`}
            disabled={isLocked}
            onClick={() => onPhaseSelect(isSelected ? null : phase.id)}
          >
            <div className={`v3-governance-timeline-node is-${variant}`}>
              {variant === "approved" ? "✓" : variant === "remediation" ? "!" : isActive ? "•" : isLocked ? "·" : "○"}
            </div>
            <div className="v3-governance-timeline-copy">
              <div className="v3-governance-timeline-label">{phaseName(phase)}</div>
              <div className="v3-governance-timeline-sub">
                {gate?.approvedAt ? <RelativeTime date={gate.approvedAt} /> : isActive ? "Active phase" : gate?.status ? gate.status.replace(/-/g, " ") : "No review yet"}
              </div>
            </div>
            {gate?.readinessScore !== undefined ? (
              <div className="v3-governance-timeline-score">{gate.readinessScore}%</div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function DecisionCard({
  decision,
  modifyOpen,
  modifyValue,
  previewOpen,
  onTogglePreview,
  onToggleModify,
  onChangeModify,
  onResolveDecision,
}: {
  decision: ReviewDecision;
  modifyOpen: boolean;
  modifyValue: string;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onToggleModify: () => void;
  onChangeModify: (value: string) => void;
  onResolveDecision: (resolution: "approved" | "deferred" | "rejected" | "modified", modifiedContent?: string) => void;
}) {
  return (
    <AdamCard accent={decision.priority === "critical" || decision.priority === "high" ? "danger" : "none"} className="v3-governance-decision-card">
      <AdamCardBody>
        <div className="v3-governance-decision-top">
          <div className="v3-governance-decision-meta">
            <StatusBadge variant={priorityVariant(decision.priority)} size="sm" />
            <StatusBadge variant={decision.status === "resolved" ? "resolved" : decision.status === "escalated" ? "escalated" : "open"} size="sm" />
          </div>
          <div className="v3-governance-decision-age" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RelativeTime date={decision.createdAt} />
            {(() => {
              if (!decision.createdAt) return null;
              const ageDays = (Date.now() - new Date(decision.createdAt).getTime()) / (1000 * 60 * 60 * 24);
              if (ageDays >= 14) return <span style={{ fontSize: 10, fontWeight: 700, color: "var(--v3-red)", background: "var(--v3-red-soft)", padding: "1px 6px", borderRadius: 20, letterSpacing: "0.03em" }}>OVERDUE</span>;
              if (ageDays >= 7) return <span style={{ fontSize: 10, fontWeight: 700, color: "var(--v3-amber)", background: "var(--v3-amber-soft)", padding: "1px 6px", borderRadius: 20, letterSpacing: "0.03em" }}>AGEING</span>;
              return null;
            })()}
          </div>
        </div>

        <div className="v3-governance-decision-title">{decision.question || decision.title}</div>

        {decision.recommendation ? (
          <div className="v3-governance-decision-recommendation">{decision.recommendation}</div>
        ) : null}

        {decision.advisorAnalysis?.recommendationRationale ? (
          <div className="v3-governance-decision-analysis">{decision.advisorAnalysis.recommendationRationale}</div>
        ) : null}

        {/* Decision impact callout — shows consequences of non-resolution (Priority 8) */}
        {(() => {
          if (!decision.createdAt) return null;
          const ageDays = (Date.now() - new Date(decision.createdAt).getTime()) / (1000 * 60 * 60 * 24);
          const isOverdue = ageDays >= 14;
          const isAging = ageDays >= 7;
          const isCritical = decision.priority === "critical";
          const isHigh = decision.priority === "high";
          if (!isOverdue && !isCritical && !isHigh) return null;

          // Derive impact from decision metadata
          const confidencePenalty = isCritical ? 15 : isHigh ? 8 : 4;
          const additionalAgePenalty = Math.floor(ageDays / 7) * 2;
          const totalPenalty = Math.min(30, confidencePenalty + additionalAgePenalty);

          const blockingMsg = isCritical
            ? "This decision is critical — it may block phase gate approval until resolved."
            : isHigh
            ? "High-priority decisions contribute to gate readiness risk when left open."
            : null;

          const overdueMsg = isOverdue
            ? `${Math.floor(ageDays)} days overdue — each week of delay costs approximately 2% confidence.`
            : isAging
            ? `Approaching overdue threshold (${Math.ceil(14 - ageDays)} days remaining).`
            : null;

          return (
            <div style={{
              marginTop: 10,
              padding: "8px 12px",
              background: isOverdue || isCritical ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.06)",
              border: `1px solid ${isOverdue || isCritical ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`,
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.55,
            }}>
              <div style={{ fontWeight: 600, color: isOverdue || isCritical ? "var(--v3-red, #ef4444)" : "var(--v3-amber)", marginBottom: 3 }}>
                ⚠ Impact if not resolved
              </div>
              {blockingMsg && <div style={{ color: "var(--v3-text-secondary)" }}>• {blockingMsg}</div>}
              {overdueMsg && <div style={{ color: "var(--v3-text-secondary)" }}>• {overdueMsg}</div>}
              <div style={{ color: "var(--v3-text-secondary)" }}>
                • Estimated confidence cost: <strong style={{ color: isOverdue || isCritical ? "var(--v3-red, #ef4444)" : "var(--v3-amber)" }}>−{totalPenalty}%</strong> until resolved
              </div>
            </div>
          );
        })()}

        {decision.previewContent ? (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="v3-button ghost" style={{ fontSize: 11 }} onClick={onTogglePreview}>
              {previewOpen ? "Hide preview" : "Preview recommendation"}
            </button>
            {previewOpen ? (
              <div className="v3-artifact-preview" style={{ marginTop: 8 }}>
                <ArtifactPreview agentId={decision.agentId || ""} content={decision.previewContent} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="v3-governance-decision-actions">
          <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={() => onResolveDecision("approved")}>
            Resolve
          </button>
          <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => onResolveDecision("deferred")}>
            Defer
          </button>
          {decision.type === "agent_review" ? (
            <button type="button" className="v3-button ghost" style={{ fontSize: 12, color: "var(--v3-red)", borderColor: "var(--v3-red)" }} onClick={() => onResolveDecision("rejected")}>
              Reject
            </button>
          ) : null}
          {decision.type === "agent_clarification" ? (
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onToggleModify}>
              {modifyOpen ? "Cancel edit" : "Modify"}
            </button>
          ) : null}
        </div>

        {modifyOpen ? (
          <div className="v3-governance-modify-box">
            <textarea
              className="v3-input v3-textarea"
              aria-label="Modified recommendation"
              rows={4}
              value={modifyValue}
              onChange={(event) => onChangeModify(event.target.value)}
              placeholder="Paste or type the corrected output here…"
            />
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              disabled={!modifyValue.trim()}
              onClick={() => onResolveDecision("modified", modifyValue)}
            >
              Resume with modification
            </button>
          </div>
        ) : null}
      </AdamCardBody>
    </AdamCard>
  );
}

function GateDetailPanel({
  phaseId,
  gateReview,
  onClose,
  onApprove,
  onRemediation,
}: {
  phaseId: string;
  gateReview: GateReview | null;
  onClose: () => void;
  onApprove: () => Promise<void>;
  onRemediation: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [showRemediationInput, setShowRemediationInput] = useState(false);

  return (
    <div className="v3-governance-detail">
      <div className="v3-governance-detail-head">
        <div className="v3-governance-detail-title">
          <span>{phaseId.replace(/-/g, " ")} Gate Review</span>
          {gateReview ? <StatusBadge variant={gateVariant(gateReview.status)} /> : <StatusBadge variant="pending" label="No review" />}
        </div>
        <div className="v3-governance-detail-actions">
          {gateReview?.status !== "approved" ? (
            <>
              <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => setShowRemediationInput((current) => !current)}>
                Request remediation
              </button>
              <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={() => void onApprove()}>
                Approve gate
              </button>
            </>
          ) : null}
          <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {showRemediationInput ? (
        <div className="v3-governance-remediation-box">
          <textarea
            className="v3-input v3-textarea"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Describe what needs to be remediated…"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="v3-button primary" style={{ fontSize: 12 }} disabled={!note.trim()} onClick={() => void onRemediation(note.trim())}>
              Submit remediation
            </button>
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => setShowRemediationInput(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="v3-governance-criteria-grid">
        {(gateReview?.exitCriteriaStatus || []).map((criterion, index) => (
          <div key={`${criterion.criterion}-${index}`} className="v3-governance-criterion-card">
            <div className="v3-governance-criterion-top">
              <div className="v3-governance-criterion-label">{criterion.criterion}</div>
              <StatusBadge variant={criterion.met ? "pass" : "fail"} size="sm" label={criterion.met ? "Pass" : "Fail"} />
            </div>
            {criterion.evidence ? <div className="v3-governance-criterion-evidence">{criterion.evidence}</div> : null}
          </div>
        ))}
        {!gateReview?.exitCriteriaStatus?.length ? (
          <div className="v3-governance-empty-copy">No exit criteria captured for this phase yet.</div>
        ) : null}
      </div>

      {gateReview?.readinessScore !== undefined ? (
        <div className="v3-governance-readiness-summary">
          <span>Readiness score</span>
          <strong>{gateReview.readinessScore}%</strong>
        </div>
      ) : null}
    </div>
  );
}

export default function DecideView({
  program,
  activePhaseId,
  mode,
  persona,
  onResolveDecision,
  onAddDecision,
  onApproveGate,
  onRequestRemediation,
}: DecideViewProps) {
  const [scope, setScope] = useState<Scope>(mode === "guided" ? "stage" : "all");
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_DECISION);
  const [previewMap, setPreviewMap] = useState<Map<string, boolean>>(new Map());
  const [modifyMap, setModifyMap] = useState<Map<string, string>>(new Map());
  const [modifyOpenMap, setModifyOpenMap] = useState<Map<string, boolean>>(new Map());
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "guided") setScope("stage");
  }, [mode]);

  useEffect(() => {
    if (!selectedPhaseId && activePhaseId) setSelectedPhaseId(activePhaseId);
  }, [activePhaseId, selectedPhaseId]);

  const synthesizedQueue = useMemo(() => {
    if (!program) return [];
    const raw = (program.rawData || {}) as Record<string, unknown>;
    const nested = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
    const phaseAgentStates = typeof nested.phaseAgentStates === "object" && nested.phaseAgentStates !== null
      ? nested.phaseAgentStates as Record<string, unknown>
      : {};
    const phaseAgents = Object.fromEntries((program.phases || []).map((phase) => [phase.id, { agentState: phaseAgentStates[phase.id] ?? null }]));
    const personaId = persona === "executive" ? "executive" : persona === "architect" ? "architect" : "delivery_lead";
    return buildDecisionQueue(phaseAgents, nested, personaId);
  }, [persona, program]);

  const open = useMemo(() => {
    const queue = synthesizedQueue.filter((decision) => isDecisionOpen({ status: "open", ...decision } as DecisionSummary));
    const scoped = scope === "stage" && activePhaseId ? queue.filter((decision) => decision.phaseId === activePhaseId) : queue;
    const byId = new Map((program?.decisionQueue || []).map((decision) => [decision.id, decision]));
    return scoped.map((decision) => ({ ...decision, ...(byId.get(decision.id) || {}) })) as ReviewDecision[];
  }, [activePhaseId, program?.decisionQueue, scope, synthesizedQueue]);

  const sortedOpen = [...open].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.priority as string] ?? 2) - (order[b.priority as string] ?? 2);
  });

  const buckets = useMemo(() => {
    const grouped: Record<ActionBucket, ReviewDecision[]> = { blocking: [], attention: [], recommended: [] };
    for (const decision of sortedOpen) grouped[classifyBucket(decision)].push(decision);
    return grouped;
  }, [sortedOpen]);

  if (!program) {
    return (
      <div className="v3-section">
        <div className="v3-empty-shell">
          <EmptyState
            illustration="decisions"
            title="No governance data available"
            description="Select a programme to review open decisions, gate readiness, and the governance register."
          />
        </div>
      </div>
    );
  }

  const addDecisionForm = addOpen ? (
    <AdamCard accent="primary">
      <AdamCardHeader title="Raise a decision" subtitle="Add a decision to the governance register" />
      <AdamCardBody>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="v3-field-label">Question *</div>
            <textarea
              className="v3-input v3-textarea"
              aria-label="Decision question"
              placeholder="What decision needs to be made?"
              value={form.question}
              onChange={(event) => setForm((current) => ({ ...current, question: event.target.value, title: event.target.value }))}
              rows={2}
            />
          </div>
          <div className="v3-wizard-grid">
            <div>
              <div className="v3-field-label">Type</div>
              <select className="v3-input" aria-label="Decision type" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as DecisionSummary["type"] }))}>
                <option value="gate-approval">Gate approval</option>
                <option value="pcr-review">Change request</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div className="v3-field-label">Priority</div>
              <select className="v3-input" aria-label="Decision priority" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as DecisionSummary["priority"] }))}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <div className="v3-field-label">Phase</div>
              <select className="v3-input" aria-label="Decision phase" value={form.phaseId} onChange={(event) => setForm((current) => ({ ...current, phaseId: event.target.value }))}>
                <option value="">Unassigned</option>
                {(program.phases || []).map((phase) => <option key={phase.id} value={phase.id}>{phaseName(phase)}</option>)}
              </select>
            </div>
            <div>
              <div className="v3-field-label">Recommended path</div>
              <input type="text" className="v3-input" aria-label="Recommended path" placeholder="Optional" value={form.recommendation} onChange={(event) => setForm((current) => ({ ...current, recommendation: event.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => { setAddOpen(false); setForm(EMPTY_DECISION); }}>Cancel</button>
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              disabled={!form.question.trim() || addSaving}
              onClick={async () => {
                setAddSaving(true);
                try {
                  await onAddDecision({ ...form, title: form.question });
                  setAddOpen(false);
                  setForm(EMPTY_DECISION);
                } finally {
                  setAddSaving(false);
                }
              }}
            >
              {addSaving ? "Saving…" : "Raise decision"}
            </button>
          </div>
        </div>
      </AdamCardBody>
    </AdamCard>
  ) : null;

  const renderDecision = (decision: ReviewDecision) => (
    <div key={decision.id} style={{ marginBottom: 8 }}>
      <div
        style={{
          borderLeft: decision.priority === "critical" ? "3px solid var(--v3-red)" :
                      decision.priority === "high" ? "3px solid var(--v3-amber)" : "3px solid transparent",
          borderRadius: "var(--v3-radius-lg)",
        }}
      >
        <div style={{ fontSize: 11, color: "var(--v3-text-muted)", padding: "4px 0 0 4px" }}>
          {decision.phaseId
            ? <>Affects: <strong>{PHASE_LABELS[decision.phaseId] ?? decision.phaseId}</strong> phase</>
            : <>Affects: <strong>Programme-level</strong></>}
        </div>
        <DecisionCard
          decision={decision}
          previewOpen={!!previewMap.get(decision.id)}
          modifyOpen={!!modifyOpenMap.get(decision.id)}
          modifyValue={modifyMap.get(decision.id) || ""}
          onTogglePreview={() => setPreviewMap((prev) => {
            const next = new Map(prev);
            next.set(decision.id, !prev.get(decision.id));
            return next;
          })}
          onToggleModify={() => setModifyOpenMap((prev) => {
            const next = new Map(prev);
            next.set(decision.id, !prev.get(decision.id));
            return next;
          })}
          onChangeModify={(value) => setModifyMap((prev) => {
            const next = new Map(prev);
            next.set(decision.id, value);
            return next;
          })}
          onResolveDecision={(resolution, modifiedContent) => void onResolveDecision(decision.id, resolution, modifiedContent)}
        />
      </div>
    </div>
  );

  const renderBucket = (bucket: ActionBucket) => {
    const items = buckets[bucket];
    if (!items.length) return null;
    const meta = BUCKET_META[bucket];
    // Recommended is paginated; blocking/attention always show in full (they are the urgent few).
    const shown = bucket === "recommended" ? items.slice(0, visibleCount) : items;
    return (
      <section key={bucket} className="v3-action-bucket" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, padding: "0 4px" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.tone, display: "inline-block" }} aria-hidden="true" />
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--v3-text-primary)", margin: 0 }}>{meta.title}</h2>
          <span style={{ fontSize: 12, fontWeight: 600, color: meta.tone }}>{items.length}</span>
          <span style={{ fontSize: 12, color: "var(--v3-text-muted)", marginLeft: "auto" }}>{meta.sub}</span>
        </div>
        <div className="v3-governance-card-list">
          {shown.map(renderDecision)}
        </div>
        {bucket === "recommended" && items.length > visibleCount ? (
          <button className="v3-button ghost" style={{ fontSize: 12, width: "100%", marginTop: 12 }} onClick={() => setVisibleCount((count) => count + 20)}>
            Show {Math.min(20, items.length - visibleCount)} more
          </button>
        ) : null}
      </section>
    );
  };

  return (
    <div className="v3-governance-layout">
      <div className="v3-governance-header">
        <div>
          <h1 className="v3-governance-title">Action Center</h1>
          <p className="v3-governance-subtitle">Everything that needs you, in one place — sorted by urgency</p>
        </div>
        <div className="v3-governance-header-actions">
          <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={() => setAddOpen(true)}>
            + Raise decision
          </button>
          <button type="button" className={`v3-mode-toggle ${scope === "stage" ? "active" : ""}`} aria-pressed={scope === "stage"} onClick={() => setScope("stage")}>This phase</button>
          <button type="button" className={`v3-mode-toggle ${scope === "all" ? "active" : ""}`} aria-pressed={scope === "all"} onClick={() => setScope("all")}>All phases</button>
        </div>
      </div>

      {addDecisionForm}

      <div className="v3-governance-grid">
        <div className="v3-governance-sidebar">
          <div className="v3-governance-sidebar-label">Gate timeline</div>
          <GateTimeline
            program={program}
            activePhaseId={activePhaseId}
            selectedPhaseId={selectedPhaseId}
            onPhaseSelect={setSelectedPhaseId}
          />
        </div>

        <div className="v3-governance-main">
          {sortedOpen.length ? (
            <>
              {renderBucket("blocking")}
              {renderBucket("attention")}
              {renderBucket("recommended")}
            </>
          ) : (
            <div className="v3-empty" style={{ marginTop: 40 }}>
              <div className="v3-empty-icon" style={{ color: "var(--v3-green)", fontSize: 28 }}>✓</div>
              <div className="v3-empty-title">
                {scope === "stage" ? "Nothing needs you in this phase" : "You're all caught up"}
              </div>
              <div className="v3-empty-body">
                {scope === "stage"
                  ? "This phase has no open actions. New items appear automatically as the programme progresses."
                  : "Nothing across the programme needs your attention right now. New items appear automatically, or raise one yourself."}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center" }}>
                <button
                  type="button"
                  className="v3-button primary"
                  style={{ fontSize: 12 }}
                  onClick={() => setAddOpen(true)}
                >
                  + Raise decision
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedPhaseId ? (
        <GateDetailPanel
          phaseId={phaseNameById(program, selectedPhaseId)}
          gateReview={program.gateReviews?.[selectedPhaseId] || null}
          onClose={() => setSelectedPhaseId(null)}
          onApprove={() => onApproveGate(selectedPhaseId)}
          onRemediation={async (note) => {
            await onRequestRemediation(selectedPhaseId, note);
            setSelectedPhaseId(null);
          }}
        />
      ) : null}
    </div>
  );
}
