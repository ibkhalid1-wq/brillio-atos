import React, { useEffect, useMemo, useState } from "react";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { selectPhaseMetrics } from "@/v3/lib/programMetrics";
import { selectBlockers, selectRisks, type RaidScope } from "@/v3/lib/programRaid";
import { PHASE_LABELS } from "@/v3/lib/uiHelpers";
import { getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import type { DecisionSummary, GateReview, ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import type { Persona } from "@/new/types";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import type { V3Mode } from "@/v3/types";
import { phaseName, phaseNameById } from "@/v3/utils";

interface DecideViewProps {
  program: ProgramSummary | null;
  activePhaseId: string | null;
  mode: V3Mode;
  persona?: Persona;
  onResolveDecision: (decisionId: string, resolution: "approved" | "deferred" | "rejected" | "modified", modifiedContent?: string, decisionPayload?: DecisionSummary) => Promise<void> | void;
  onAddDecision: (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => Promise<void>;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
  onAddRaid: (draft: { type: RAIDEntryType; title: string; description: string; severity: RAIDEntry["severity"]; phase: string; owner?: string; mitigation?: string }) => Promise<void>;
  onCloseRaid: (entryId: string, note?: string) => Promise<void>;
  /** Resolve an action / blocker / risk by jumping to that phase's input fields. */
  onNavigateToPhaseInputs: (phaseId: string) => void;
  /** Deep-link intent: select a tab and open its add form (nonce forces re-fire). */
  initialIntent?: { tab: ActionTab; nonce: number } | null;
}

type Scope = "stage" | "all";
type ActionTab = "blockers" | "actions" | "risks";

const EMPTY_RAID = {
  title: "",
  description: "",
  severity: "medium" as RAIDEntry["severity"],
  phase: "",
  mitigation: "",
};
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
  const lockedPhaseIds = getLockedPhaseIds(program);
  return (
    <div className="v3-governance-timeline">
      {(program.phases || []).map((phase) => {
        const gate = program.gateReviews?.[phase.id];
        const isActive = phase.id === activePhaseId;
        const isSelected = phase.id === selectedPhaseId;
        const isLocked = lockedPhaseIds.has(phase.id);
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
              <div className="v3-governance-timeline-score">{selectPhaseMetrics(program, phase.id).readiness}%</div>
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
  onGoToInput,
}: {
  decision: ReviewDecision;
  modifyOpen: boolean;
  modifyValue: string;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onToggleModify: () => void;
  onChangeModify: (value: string) => void;
  onResolveDecision: (resolution: "approved" | "deferred" | "rejected" | "modified", modifiedContent?: string) => void;
  onGoToInput: () => void;
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
          <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={onGoToInput}>
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
  readiness,
  onClose,
  onRemediation,
}: {
  phaseId: string;
  gateReview: GateReview | null;
  readiness: number | null;
  onClose: () => void;
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
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={() => setShowRemediationInput((current) => !current)}>
              Request remediation
            </button>
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

      {readiness !== null ? (
        <div className="v3-governance-readiness-summary">
          <span>Readiness score</span>
          <strong>{readiness}%</strong>
        </div>
      ) : null}
    </div>
  );
}

function RaidCard({
  entry,
  onGoToInput,
}: {
  entry: RAIDEntry;
  onGoToInput: () => void;
}) {
  const isUrgent = entry.severity === "critical" || entry.severity === "high";
  return (
    <AdamCard accent={isUrgent ? "danger" : "none"} className="v3-governance-decision-card">
      <AdamCardBody>
        <div className="v3-governance-decision-top">
          <div className="v3-governance-decision-meta">
            <StatusBadge variant={priorityVariant(entry.severity)} size="sm" />
            <StatusBadge variant={entry.status === "monitoring" ? "escalated" : "open"} size="sm" label={entry.status === "monitoring" ? "Monitoring" : "Open"} />
            {entry.source === "agent" ? <StatusBadge variant="active" size="sm" label="ATOS" /> : null}
          </div>
          <div className="v3-governance-decision-age">
            <RelativeTime date={entry.createdAt} />
          </div>
        </div>

        <div className="v3-governance-decision-title">{entry.title}</div>
        {entry.description ? <div className="v3-governance-decision-recommendation">{entry.description}</div> : null}
        {entry.mitigation ? <div className="v3-governance-decision-analysis">Mitigation: {entry.mitigation}</div> : null}

        <div className="v3-governance-decision-actions">
          <button type="button" className="v3-button primary" style={{ fontSize: 12 }} onClick={onGoToInput}>
            Resolve
          </button>
        </div>
      </AdamCardBody>
    </AdamCard>
  );
}

function RaidRaiseForm({
  kind,
  program,
  saving,
  onCancel,
  onSubmit,
}: {
  kind: "blocker" | "risk";
  program: ProgramSummary;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: typeof EMPTY_RAID) => void;
}) {
  const [form, setForm] = useState(EMPTY_RAID);
  const label = kind === "blocker" ? "blocker" : "risk";
  return (
    <AdamCard accent="primary">
      <AdamCardHeader title={`Raise a ${label}`} subtitle={`Add a ${label} to the RAID register`} />
      <AdamCardBody>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="v3-field-label">Title *</div>
            <input
              type="text"
              className="v3-input"
              aria-label={`${label} title`}
              placeholder={kind === "blocker" ? "What is blocking progress?" : "What could go wrong?"}
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </div>
          <div>
            <div className="v3-field-label">Description</div>
            <textarea
              className="v3-input v3-textarea"
              aria-label={`${label} description`}
              rows={2}
              placeholder="Add context, impact, and any detail the team needs…"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>
          <div className="v3-wizard-grid">
            <div>
              <div className="v3-field-label">Severity</div>
              <select className="v3-input" aria-label={`${label} severity`} value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as RAIDEntry["severity"] }))}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <div className="v3-field-label">Phase</div>
              <select className="v3-input" aria-label={`${label} phase`} value={form.phase} onChange={(event) => setForm((current) => ({ ...current, phase: event.target.value }))}>
                <option value="">Unassigned</option>
                {(program.phases || []).map((phase) => <option key={phase.id} value={phase.id}>{phaseName(phase)}</option>)}
              </select>
            </div>
            {kind === "risk" ? (
              <div>
                <div className="v3-field-label">Mitigation</div>
                <input type="text" className="v3-input" aria-label="risk mitigation" placeholder="Optional" value={form.mitigation} onChange={(event) => setForm((current) => ({ ...current, mitigation: event.target.value }))} />
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="v3-button ghost" style={{ fontSize: 12 }} onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              disabled={!form.title.trim() || saving}
              onClick={() => onSubmit(form)}
            >
              {saving ? "Saving…" : `Raise ${label}`}
            </button>
          </div>
        </div>
      </AdamCardBody>
    </AdamCard>
  );
}

export default function DecideView({
  program,
  activePhaseId,
  mode,
  persona,
  onResolveDecision,
  onAddDecision,
  onRequestRemediation,
  onAddRaid,
  onCloseRaid,
  onNavigateToPhaseInputs,
  initialIntent,
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
  const [activeTab, setActiveTab] = useState<ActionTab>("actions");
  const [raidFormOpen, setRaidFormOpen] = useState(false);
  const [raidSaving, setRaidSaving] = useState(false);

  useEffect(() => {
    if (mode === "guided") setScope("stage");
  }, [mode]);

  // React to a deep-link intent from the phase header "+ Add" buttons: focus the
  // requested tab and open its add form. Keyed on nonce so repeat clicks re-fire.
  useEffect(() => {
    if (!initialIntent) return;
    setActiveTab(initialIntent.tab);
    if (initialIntent.tab === "actions") { setAddOpen(true); setRaidFormOpen(false); }
    else { setRaidFormOpen(true); setAddOpen(false); }
  }, [initialIntent?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPhaseId && activePhaseId) setSelectedPhaseId(activePhaseId);
  }, [activePhaseId, selectedPhaseId]);

  const open = useMemo(() => {
    // Shared derivation (synthesise → merge persisted resolution → open filter)
    // so this feed and the rail badge count cannot drift apart.
    const personaId = persona === "executive" ? "executive" : persona === "architect" ? "architect" : "delivery_lead";
    const queue = deriveOpenRecommendedActions(program, personaId) as ReviewDecision[];
    // "This phase" scope follows the phase selected in the Gate timeline (falling
    // back to the active phase), so selecting a phase actually filters the feed.
    const phaseFilterId = selectedPhaseId ?? activePhaseId;
    return scope === "stage" && phaseFilterId ? queue.filter((decision) => decision.phaseId === phaseFilterId) : queue;
  }, [activePhaseId, selectedPhaseId, persona, program, scope]);

  const sortedOpen = [...open].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.priority as string] ?? 2) - (order[b.priority as string] ?? 2);
  });

  const { blockers, risks } = useMemo(() => {
    const phaseFilterId = selectedPhaseId ?? activePhaseId;
    const raidScope: RaidScope = scope === "stage" && phaseFilterId ? { phaseId: phaseFilterId } : "programme";
    return {
      blockers: selectBlockers(program, raidScope),
      risks: selectRisks(program, raidScope),
    };
  }, [program, scope, selectedPhaseId, activePhaseId]);

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
      <AdamCardHeader title="Raise an action" subtitle="Add a decision or action to the governance register" />
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
              {addSaving ? "Saving…" : "Raise action"}
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
          {!decision.phaseId
            ? <>Affects: <strong>Programme-level</strong></>
            : decision.phaseId === "all"
            ? <>Affects: <strong>All phases</strong></>
            : <>Affects: <strong>{PHASE_LABELS[decision.phaseId] ?? decision.phaseId}</strong> phase</>}
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
          onResolveDecision={(resolution, modifiedContent) => void onResolveDecision(decision.id, resolution, modifiedContent, decision)}
          onGoToInput={() => onNavigateToPhaseInputs(resolveTargetPhase(decision.phaseId))}
        />
      </div>
    </div>
  );

  const submitRaid = async (kind: "blocker" | "risk", draft: typeof EMPTY_RAID) => {
    setRaidSaving(true);
    try {
      await onAddRaid({
        type: kind,
        title: draft.title.trim(),
        description: draft.description.trim(),
        severity: draft.severity,
        phase: draft.phase || (selectedPhaseId ?? activePhaseId ?? ""),
        mitigation: kind === "risk" && draft.mitigation.trim() ? draft.mitigation.trim() : undefined,
      });
      setRaidFormOpen(false);
    } finally {
      setRaidSaving(false);
    }
  };

  // An action / blocker / risk is resolved at its source — the phase's input
  // fields. Resolve a known phase if the item carries one, otherwise fall back
  // to the focused / active phase so the user always lands somewhere editable.
  const resolveTargetPhase = (phaseId: string | null | undefined): string =>
    phaseId && phaseId !== "all"
      ? phaseId
      : (selectedPhaseId ?? activePhaseId ?? program?.phases?.[0]?.id ?? "strategy");

  const renderRaidList = (entries: RAIDEntry[], emptyLabel: string) => (
    entries.length ? (
      <div className="v3-governance-card-list">
        {entries.map((entry) => (
          <div key={entry.id} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", padding: "4px 0 0 4px" }}>
              {!entry.phase
                ? <>Affects: <strong>Programme-level</strong></>
                : entry.phase === "all"
                ? <>Affects: <strong>All phases</strong></>
                : <>Affects: <strong>{PHASE_LABELS[entry.phase] ?? entry.phase}</strong> phase</>}
            </div>
            <RaidCard entry={entry} onGoToInput={() => onNavigateToPhaseInputs(resolveTargetPhase(entry.phase))} />
          </div>
        ))}
      </div>
    ) : (
      <div className="v3-empty" style={{ marginTop: 40 }}>
        <div className="v3-empty-icon" style={{ color: "var(--v3-green)", fontSize: 28 }}>✓</div>
        <div className="v3-empty-title">{emptyLabel}</div>
      </div>
    )
  );

  const tabs: { id: ActionTab; label: string; count: number }[] = [
    { id: "actions", label: "Actions", count: sortedOpen.length },
    { id: "blockers", label: "Blockers", count: blockers.length },
    { id: "risks", label: "Risks", count: risks.length },
  ];

  const switchTab = (tab: ActionTab) => {
    setActiveTab(tab);
    setAddOpen(false);
    setRaidFormOpen(false);
  };

  const raiseLabel = activeTab === "blockers" ? "blocker" : activeTab === "risks" ? "risk" : "action";

  return (
    <div className="v3-governance-layout">
      <div className="v3-governance-header">
        <div>
          <h1 className="v3-governance-title">Action Center</h1>
          <p className="v3-governance-subtitle">Actions, blockers, and risks — in one place</p>
        </div>
        <div className="v3-governance-header-actions">
          <button type="button" className={`v3-mode-toggle ${scope === "stage" ? "active" : ""}`} aria-pressed={scope === "stage"} onClick={() => setScope("stage")}>This phase</button>
          <button type="button" className={`v3-mode-toggle ${scope === "all" ? "active" : ""}`} aria-pressed={scope === "all"} onClick={() => setScope("all")}>All phases</button>
        </div>
      </div>

      <div className="v3-action-tabs" role="tablist" aria-label="Action Center sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`v3-action-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => switchTab(tab.id)}
          >
            {tab.label}
            <span className="v3-action-tab-count">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="v3-governance-grid">
        <div className="v3-governance-sidebar">
          <div className="v3-governance-sidebar-label">Gate timeline</div>
          <GateTimeline
            program={program}
            activePhaseId={activePhaseId}
            selectedPhaseId={selectedPhaseId}
            onPhaseSelect={(phaseId) => {
              setSelectedPhaseId(phaseId);
              // Selecting a phase focuses the feed on it; deselecting reopens all.
              setScope(phaseId ? "stage" : "all");
            }}
          />
        </div>

        <div className="v3-governance-main">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              onClick={() => {
                if (activeTab === "actions") { setAddOpen(true); setRaidFormOpen(false); }
                else { setRaidFormOpen(true); setAddOpen(false); }
              }}
            >
              + Raise {raiseLabel}
            </button>
          </div>

          {activeTab === "actions" && addOpen ? addDecisionForm : null}
          {activeTab !== "actions" && raidFormOpen ? (
            <RaidRaiseForm
              kind={activeTab === "blockers" ? "blocker" : "risk"}
              program={program}
              saving={raidSaving}
              onCancel={() => setRaidFormOpen(false)}
              onSubmit={(draft) => void submitRaid(activeTab === "blockers" ? "blocker" : "risk", draft)}
            />
          ) : null}

          {activeTab === "blockers" ? renderRaidList(blockers, scope === "stage" ? "No blockers in this phase" : "No open blockers") : null}
          {activeTab === "risks" ? renderRaidList(risks, scope === "stage" ? "No risks in this phase" : "No open risks") : null}
          {activeTab === "actions" ? (
            sortedOpen.length ? (
              <>
                <div className="v3-governance-card-list">
                  {sortedOpen.slice(0, visibleCount).map(renderDecision)}
                </div>
                {sortedOpen.length > visibleCount ? (
                  <button className="v3-button ghost" style={{ fontSize: 12, width: "100%", marginTop: 12 }} onClick={() => setVisibleCount((count) => count + 20)}>
                    Show {Math.min(20, sortedOpen.length - visibleCount)} more
                  </button>
                ) : null}
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
              </div>
            )
          ) : null}
        </div>
      </div>

      {selectedPhaseId ? (
        <GateDetailPanel
          phaseId={phaseNameById(program, selectedPhaseId)}
          gateReview={program.gateReviews?.[selectedPhaseId] || null}
          readiness={selectPhaseMetrics(program, selectedPhaseId).readiness}
          onClose={() => setSelectedPhaseId(null)}
          onRemediation={async (note) => {
            await onRequestRemediation(selectedPhaseId, note);
            setSelectedPhaseId(null);
          }}
        />
      ) : null}
    </div>
  );
}
