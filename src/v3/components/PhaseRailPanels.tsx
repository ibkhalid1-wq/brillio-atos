import React, { useMemo, useState } from "react";
import type { DecisionSummary, ProgramSummary, RAIDEntry, RAIDEntryType } from "@/new/types";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";
import { selectBlockers, selectRisks } from "@/v3/lib/programRaid";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { ArtifactMapTree } from "@/v3/components/ArtifactMapTree";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import type { V3MoreView } from "@/v3/types";

/**
 * PhaseRailPanels — the canonical Programme right-rail surface. Two tabbed
 * sections, each self-contained:
 *
 *   • Actions      → Actions (open decisions) · Blockers · Risks, with inline
 *                    create flows that write to the decision queue / RAID log.
 *   • Intelligence → Artifacts · Graph · Uploads, surfacing phase artifacts and
 *                    deep-links to the knowledge graph / document import.
 */

type RaidDraft = {
  type: RAIDEntryType;
  title: string;
  description: string;
  severity: RAIDEntry["severity"];
  phase: string;
  mitigation?: string;
};

type PhaseRailPanelsProps = {
  program: ProgramSummary;
  phaseId: string;
  decisions: DecisionSummary[];
  agentsAvailable?: boolean;
  onAddDecision: (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => Promise<void>;
  onAddRaid: (draft: RaidDraft) => Promise<void>;
  onCloseRaid: (entryId: string, note?: string) => Promise<void>;
  onOpenDecide: () => void;
  onRunAgent: (agentId: string) => void;
  onOpenMoreView: (view: V3MoreView) => void;
  onUploadDocument: () => void;
};

type PrimaryTab = "actions" | "intelligence";
type ActionTab = "actions" | "blockers" | "risks";
type IntelTab = "artifacts" | "graph" | "uploads";

function priorityVariant(value: string): "critical" | "high" | "medium" | "low" {
  if (value === "critical") return "critical";
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function severityTone(value: string): "red" | "amber" | "blue" {
  if (value === "critical") return "red";
  if (value === "high") return "amber";
  return "blue";
}

function RaidForm({
  kind,
  saving,
  onCancel,
  onSubmit,
}: {
  kind: "blocker" | "risk";
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: { title: string; description: string; severity: RAIDEntry["severity"]; mitigation: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<RAIDEntry["severity"]>("medium");
  const [mitigation, setMitigation] = useState("");
  return (
    <div className="v3-rail-form">
      <div>
        <div className="v3-field-label">Title *</div>
        <input
          type="text"
          className="v3-input"
          aria-label={`${kind} title`}
          placeholder={kind === "blocker" ? "What is blocking progress?" : "What could go wrong?"}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div>
        <div className="v3-field-label">Description</div>
        <textarea
          className="v3-input v3-textarea"
          aria-label={`${kind} description`}
          rows={2}
          placeholder="Context, impact, detail the team needs…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div>
        <div className="v3-field-label">Severity</div>
        <select className="v3-input" aria-label={`${kind} severity`} value={severity} onChange={(event) => setSeverity(event.target.value as RAIDEntry["severity"])}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      {kind === "risk" ? (
        <div>
          <div className="v3-field-label">Mitigation</div>
          <input type="text" className="v3-input" aria-label="risk mitigation" placeholder="Optional" value={mitigation} onChange={(event) => setMitigation(event.target.value)} />
        </div>
      ) : null}
      <div className="v3-rail-form-actions">
        <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="v3-button primary v3-button-inline-xs"
          disabled={!title.trim() || saving}
          onClick={() => onSubmit({ title: title.trim(), description: description.trim(), severity, mitigation: mitigation.trim() })}
        >
          {saving ? "Saving…" : `Raise ${kind}`}
        </button>
      </div>
    </div>
  );
}

function DecisionForm({
  saving,
  onCancel,
  onSubmit,
}: {
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: { question: string; priority: DecisionSummary["priority"]; recommendation: string }) => void;
}) {
  const [question, setQuestion] = useState("");
  const [priority, setPriority] = useState<DecisionSummary["priority"]>("medium");
  const [recommendation, setRecommendation] = useState("");
  return (
    <div className="v3-rail-form">
      <div>
        <div className="v3-field-label">Question *</div>
        <textarea
          className="v3-input v3-textarea"
          aria-label="Decision question"
          rows={2}
          placeholder="What decision needs to be made?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
      </div>
      <div>
        <div className="v3-field-label">Priority</div>
        <select className="v3-input" aria-label="Decision priority" value={priority} onChange={(event) => setPriority(event.target.value as DecisionSummary["priority"])}>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div>
        <div className="v3-field-label">Recommended path</div>
        <input type="text" className="v3-input" aria-label="Recommended path" placeholder="Optional" value={recommendation} onChange={(event) => setRecommendation(event.target.value)} />
      </div>
      <div className="v3-rail-form-actions">
        <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="v3-button primary v3-button-inline-xs"
          disabled={!question.trim() || saving}
          onClick={() => onSubmit({ question: question.trim(), priority, recommendation: recommendation.trim() })}
        >
          {saving ? "Saving…" : "Raise action"}
        </button>
      </div>
    </div>
  );
}

export function PhaseRailPanels({
  program,
  phaseId,
  decisions,
  agentsAvailable = true,
  onAddDecision,
  onAddRaid,
  onCloseRaid,
  onOpenDecide,
  onRunAgent,
  onOpenMoreView,
  onUploadDocument,
}: PhaseRailPanelsProps) {
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("actions");
  const [actionTab, setActionTab] = useState<ActionTab>("actions");
  const [intelTab, setIntelTab] = useState<IntelTab>("artifacts");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const blockers = useMemo(() => selectBlockers(program, { phaseId }), [program, phaseId]);
  const risks = useMemo(() => selectRisks(program, { phaseId }), [program, phaseId]);
  const artifacts = useMemo(() => {
    const summary = buildPhaseArtifacts(program, phaseId);
    const byKey = new Map((summary?.artifacts ?? []).map((node) => [node.key, node]));
    // Mirror the Programme artifacts column: Narrative leads as its own inline
    // preview there, so it is excluded from the artifact-chip list on both
    // surfaces. Counts are derived from the displayed defs to stay consistent.
    const defs = getPhaseArtifactDefs(phaseId).filter((def) => def.id !== "narrative");
    const required = defs.length;
    const present = defs.filter((def) => byKey.get(def.id)?.present).length;
    return { defs, byKey, present, required };
  }, [program, phaseId]);

  const actionTabs: { id: ActionTab; label: string; count: number }[] = [
    { id: "actions", label: "Actions", count: decisions.length },
    { id: "risks", label: "Risks", count: risks.length },
    { id: "blockers", label: "Blockers", count: blockers.length },
  ];
  const openActionCount = decisions.length + blockers.length + risks.length;
  const intelTabs: { id: IntelTab; label: string }[] = [
    { id: "artifacts", label: "Artifacts" },
    { id: "graph", label: "Graph" },
    { id: "uploads", label: "Uploads" },
  ];

  const switchAction = (tab: ActionTab) => {
    setActionTab(tab);
    setFormOpen(false);
  };

  const submitRaid = async (kind: "blocker" | "risk", draft: { title: string; description: string; severity: RAIDEntry["severity"]; mitigation: string }) => {
    setSaving(true);
    try {
      await onAddRaid({
        type: kind,
        title: draft.title,
        description: draft.description,
        severity: draft.severity,
        phase: phaseId,
        mitigation: kind === "risk" && draft.mitigation ? draft.mitigation : undefined,
      });
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const submitDecision = async (draft: { question: string; priority: DecisionSummary["priority"]; recommendation: string }) => {
    setSaving(true);
    try {
      await onAddDecision({
        title: draft.question,
        question: draft.question,
        type: "other",
        priority: draft.priority,
        phaseId,
        recommendation: draft.recommendation || undefined,
        options: [],
      });
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const closeRaid = async (entryId: string) => {
    setClosingId(entryId);
    try {
      await onCloseRaid(entryId);
    } finally {
      setClosingId(null);
    }
  };

  const raiseLabel = actionTab === "blockers" ? "blocker" : actionTab === "risks" ? "risk" : "action";

  const primaryTabs: { id: PrimaryTab; label: string; count: number }[] = [
    { id: "actions", label: "Action Center", count: openActionCount },
    { id: "intelligence", label: "Intelligence", count: artifacts.required },
  ];

  return (
    <div className="v3-rail-panels">
      <div className="v3-rail-primary-tabs" role="tablist" aria-label="Phase rail sections">
        {primaryTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={primaryTab === tab.id}
            className={`v3-rail-primary-tab ${primaryTab === tab.id ? "is-active" : ""}`}
            onClick={() => setPrimaryTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 ? <span className="v3-action-tab-count">{tab.count}</span> : null}
          </button>
        ))}
      </div>

      {/* ACTION CENTER */}
      {primaryTab === "actions" ? (
      <AdamCard>
        <AdamCardHeader
          title="Action Center"
          subtitle="Decisions, risks and blockers for this phase"
          action={<button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setFormOpen((open) => !open)}>{formOpen ? "Close" : `+ ${raiseLabel}`}</button>}
        />
        <AdamCardBody>
          <div className="v3-action-tabs v3-action-tabs--rail" role="tablist" aria-label="Phase actions">
            {actionTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={actionTab === tab.id}
                className={`v3-action-tab ${actionTab === tab.id ? "is-active" : ""}`}
                onClick={() => switchAction(tab.id)}
              >
                {tab.label}
                <span className="v3-action-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>

          {formOpen && actionTab === "actions" ? (
            <DecisionForm saving={saving} onCancel={() => setFormOpen(false)} onSubmit={submitDecision} />
          ) : null}
          {formOpen && actionTab !== "actions" ? (
            <RaidForm kind={actionTab === "blockers" ? "blocker" : "risk"} saving={saving} onCancel={() => setFormOpen(false)} onSubmit={(draft) => void submitRaid(actionTab === "blockers" ? "blocker" : "risk", draft)} />
          ) : null}

          {actionTab === "actions" ? (
            decisions.length ? (
              <div className="v3-rail-list">
                {decisions.slice(0, 5).map((decision) => (
                  <div key={decision.id} className="v3-rail-item">
                    <div className="v3-rail-item-head">
                      <StatusBadge variant={priorityVariant(decision.priority)} size="sm" />
                      <span className="v3-rail-item-title">{decision.question || decision.title || "Open decision"}</span>
                    </div>
                    {decision.recommendation ? <div className="v3-rail-item-sub">{decision.recommendation}</div> : null}
                  </div>
                ))}
                <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={onOpenDecide}>Open Action Center →</button>
              </div>
            ) : (
              <div className="v3-rail-empty">No open decisions for this phase.</div>
            )
          ) : null}

          {actionTab === "blockers" ? (
            blockers.length ? (
              <div className="v3-rail-list">
                {blockers.map((entry) => (
                  <div key={entry.id} className="v3-rail-item">
                    <div className="v3-rail-item-head">
                      <span className={`v3-chip v3-chip-tight ${severityTone(entry.severity)}`}>{entry.severity}</span>
                      <span className="v3-rail-item-title">{entry.title}</span>
                    </div>
                    {entry.description ? <div className="v3-rail-item-sub">{entry.description}</div> : null}
                    <div className="v3-rail-item-foot">
                      <span className="v3-rail-item-age"><RelativeTime date={entry.createdAt} /></span>
                      <button type="button" className="v3-button ghost v3-button-inline-xs" disabled={closingId === entry.id} onClick={() => void closeRaid(entry.id)}>{closingId === entry.id ? "Resolving…" : "Resolve"}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="v3-rail-empty">No open blockers — nothing standing in the way.</div>
            )
          ) : null}

          {actionTab === "risks" ? (
            risks.length ? (
              <div className="v3-rail-list">
                {risks.map((entry) => (
                  <div key={entry.id} className="v3-rail-item">
                    <div className="v3-rail-item-head">
                      <span className={`v3-chip v3-chip-tight ${severityTone(entry.severity)}`}>{entry.severity}</span>
                      <span className="v3-rail-item-title">{entry.title}</span>
                    </div>
                    {entry.description ? <div className="v3-rail-item-sub">{entry.description}</div> : null}
                    {entry.mitigation ? <div className="v3-rail-item-sub">Mitigation: {entry.mitigation}</div> : null}
                    <div className="v3-rail-item-foot">
                      <span className="v3-rail-item-age"><RelativeTime date={entry.createdAt} /></span>
                      <button type="button" className="v3-button ghost v3-button-inline-xs" disabled={closingId === entry.id} onClick={() => void closeRaid(entry.id)}>{closingId === entry.id ? "Resolving…" : "Resolve"}</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="v3-rail-empty">No open risks logged for this phase.</div>
            )
          ) : null}
        </AdamCardBody>
      </AdamCard>
      ) : null}

      {/* INTELLIGENCE */}
      {primaryTab === "intelligence" ? (
      <AdamCard>
        <AdamCardHeader title="Intelligence" subtitle="Artifacts, knowledge graph and source documents" />
        <AdamCardBody>
          <div className="v3-action-tabs v3-action-tabs--rail" role="tablist" aria-label="Phase intelligence">
            {intelTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={intelTab === tab.id}
                className={`v3-action-tab ${intelTab === tab.id ? "is-active" : ""}`}
                onClick={() => setIntelTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {intelTab === "artifacts" ? (
            <div className="v3-rail-list">
              {artifacts.required > 0 ? (
                <div className="v3-rail-meta">{artifacts.present}/{artifacts.required} produced</div>
              ) : null}
              {artifacts.defs.map((def) => {
                const node = artifacts.byKey.get(def.id);
                const present = !!node?.present;
                const score = typeof node?.quality === "number" ? node.quality : null;
                const state = node?.state ?? "missing";
                const statusLabel = !present ? "Missing" : state === "approved" ? "Approved" : state === "ready" ? "Ready" : "Draft";
                const tone = !present ? "muted" : state === "approved" ? "green" : state === "ready" ? "blue" : "amber";
                return (
                  <div key={def.id} className="v3-rail-item v3-rail-item--row">
                    <div className="v3-rail-item-head">
                      <span className="v3-rail-item-title">{def.label}</span>
                      <span className={`v3-chip v3-chip-tight ${tone}`}>{statusLabel}{score != null ? ` · ${score}%` : ""}</span>
                    </div>
                    <button type="button" className="v3-button ghost v3-button-inline-xs" disabled={!agentsAvailable} onClick={() => onRunAgent(def.id)} title={present ? `Regenerate ${def.label}` : `Generate ${def.label}`}>
                      {present ? "↻ Regenerate" : "Generate"}
                    </button>
                  </div>
                );
              })}
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("artifact-map")}>Open full artifact map →</button>
            </div>
          ) : null}

          {intelTab === "graph" ? (
            <div className="v3-rail-list">
              <ArtifactMapTree program={program} phaseId={phaseId} />
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("artifact-map")}>Open full artifact map →</button>
            </div>
          ) : null}

          {intelTab === "uploads" ? (
            <div className="v3-rail-list">
              <div className="v3-rail-empty">Import source documents to ground ATOS's analysis. Files are parsed into phase inputs automatically.</div>
              <button type="button" className="v3-button primary v3-button-inline-xs v3-rail-footer-link" onClick={onUploadDocument}>Upload document →</button>
              <button type="button" className="v3-button ghost v3-button-inline-xs v3-rail-footer-link" onClick={() => onOpenMoreView("documents")}>Manage documents →</button>
            </div>
          ) : null}
        </AdamCardBody>
      </AdamCard>
      ) : null}
    </div>
  );
}

export default PhaseRailPanels;
