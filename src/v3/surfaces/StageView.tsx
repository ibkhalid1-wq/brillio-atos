import React, { useEffect, useMemo, useRef } from "react";
import { getRiskTrend } from "@/lib/adamGateRisk";
import type { AgentRun } from "@/lib/adamSync";
import type { DecisionSummary, ExitCriterion, GateReview, PlanAction, ProgramSummary, Workstream } from "@/new/types";
import ArtifactEditor from "@/v3/components/ArtifactEditor";
import GateCoachPanel from "@/v3/components/GateCoachPanel";
import { GateBlockingChecklist } from "@/v3/components/GateBlockingChecklist";
import OnboardingCard from "@/v3/components/OnboardingCard";
import PhaseInputsPanel, { type FieldAssistRequest } from "@/v3/components/PhaseInputsPanel";
import PhaseFlowOverlay from "@/v3/components/PhaseFlowOverlay";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { PhaseChangeSummary } from "@/v3/components/PhaseChangeSummary";
import { PhaseExecutiveSummary } from "@/v3/components/PhaseExecutiveSummary";
import { PhaseRail } from "@/v3/components/PhaseRail";
import { ReadinessBadge } from "@/v3/components/ui/ReadinessBadge";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { ExpandableSection } from "@/v3/components/ui/ExpandableSection";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import { computePhaseReadiness } from "@/v3/lib/phaseReadiness";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { runPreFlight } from "@/v3/lib/phaseInputPreFlight";
import { getFormalArtifactContent } from "@/v3/lib/formalArtifacts";
import type { V3Mode, V3MoreView, V3ReportId } from "@/v3/types";

interface StageViewProps {
  program: ProgramSummary | null;
  activeRuns: AgentRun[];
  activePhaseId: string | null;
  lockedPhaseIds?: Set<string>;
  mode: V3Mode;
  generatedAt?: string | null;
  /** Whether AI agents are available (user authenticated + Supabase configured) */
  agentsAvailable?: boolean;
  triggers: {
    triggerGateReview: (phaseId: string) => void;
    gateReviewRunningPhaseSet: Set<string>;
    triggerRetro: (phaseId: string) => void;
    retroRunningPhases: Set<string>;
  };
  onOpenMoreView: (view: V3MoreView) => void;
  onSelectPhase?: (phaseId: string) => void;
  onResolveDecision: (id: string, resolution: "approved" | "deferred" | "rejected" | "modified", modifiedContent?: string) => void | Promise<void>;
  onOpenDecide: () => void;
  onOpenReport: (reportId: V3ReportId) => void;
  onSaveGateNote: (phaseId: string, note: string) => Promise<void>;
  onSaveStageNote: (phaseId: string, note: string) => Promise<void>;
  onApproveGate: (phaseId: string) => Promise<void>;
  onReopenGate: (phaseId: string) => void;
  onGenerateCriteria: () => void;
  onRequestRemediation: (phaseId: string, note: string) => Promise<void>;
  onRunAgent: (agentId: string) => void;
  onSaveArtifact: (artifactId: "narrative" | "deck", content: string) => Promise<void>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>) => Promise<void>;
  onUploadDocument: () => void;
  onAssistField?: (phaseId: string, request: FieldAssistRequest) => Promise<string>;
  artifactPreviews?: {
    narrative?: string | null;
    plan?: Array<{ action?: string; rationale?: string }> | null;
    deck?: string | null;
  };
}

function firstSentence(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const first = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed;
  return first.length > maxLength ? `${first.slice(0, maxLength - 1).trimEnd()}…` : first;
}

function phaseStatusTone(phase: ProgramSummary["phases"][number]): { label: string; tone: "green" | "amber" | "red" } {
  if (phase.pct >= 100 || phase.status === "complete") return { label: "Complete", tone: "green" };
  if (phase.status === "at-risk" || phase.status === "blocked") return { label: "At risk", tone: "red" };
  return { label: "On track", tone: "amber" };
}

function gateTone(review: GateReview | null): "green" | "amber" | "red" {
  if (!review) return "amber";
  if (review.status === "approved") return "green";
  if (review.status === "remediation-requested") return "red";
  return "amber";
}

function sortByDate<T extends { targetDate?: string | null }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (!left.targetDate) return 1;
    if (!right.targetDate) return -1;
    return new Date(left.targetDate).getTime() - new Date(right.targetDate).getTime();
  });
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

function getRawGateStatus(program: ProgramSummary | null, phaseId: string | null): GateReview["status"] | null {
  if (!program || !phaseId) return null;
  const source = typeof program.rawData === "object" && program.rawData !== null
    ? ("data" in program.rawData && typeof program.rawData.data === "object" && program.rawData.data !== null
      ? program.rawData.data
      : program.rawData)
    : null;
  if (!source || typeof source !== "object") return null;
  const gateReviews = "gateReviews" in source && typeof source.gateReviews === "object" && source.gateReviews !== null
    ? source.gateReviews as Record<string, unknown>
    : null;
  const review = gateReviews?.[phaseId];
  const status = review && typeof review === "object" && "status" in review ? review.status : null;
  return typeof status === "string" ? status as GateReview["status"] : null;
}

function ActionList({ actions, onOpenReport }: { actions: PlanAction[]; onOpenReport: () => void }) {
  if (!actions.length) {
    return (
      <EmptyState
        icon="→"
        title="No priority actions yet"
        description="Generate or refresh the delivery plan to surface the next actions for this phase."
        compact
        action={{ label: "Open plan", onClick: onOpenReport }}
      />
    );
  }

  return (
    <ol className="v3-action-list">
      {actions.map((action, index) => (
        <li key={`${action.action}-${index}`} className="v3-action-list-item">
          <div>{action.action}</div>
          {action.rationale ? (
            <div className="v3-action-list-rationale">{action.rationale}</div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ExitCriteriaCard({
  criteria,
  generatedCriteria,
  onGenerateCriteria,
  gateApproved = false,
}: {
  criteria: ExitCriterion[];
  generatedCriteria: Array<{ criterion: string; category: string; owner: string; mandatory: boolean }>;
  onGenerateCriteria: () => void;
  gateApproved?: boolean;
}) {
  const display = criteria.length
    ? criteria
    : generatedCriteria.map((entry) => ({ criterion: entry.criterion, met: gateApproved, evidence: null }));
  const mandatory = display.filter((criterion) => (criterion as Record<string, unknown>).mandatory !== false);
  const mandatoryUnmet = mandatory.filter((criterion) => !criterion.met);
  return (
    <div className="v3-card-sm">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="v3-card-title v3-card-title--flush">Exit criteria</div>
        {!display.length ? (
          <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={onGenerateCriteria}>
            Generate →
          </button>
        ) : mandatoryUnmet.length > 0 ? (
          <span className="v3-chip red v3-chip-tight">
            {mandatoryUnmet.length} mandatory unmet
          </span>
        ) : display.length > 0 ? (
          <span className="v3-chip green v3-chip-tight">All met</span>
        ) : null}
      </div>
      {display.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {display.map((criterion) => {
            const mandatoryCriterion = (criterion as Record<string, unknown>).mandatory !== false;
            const evidence = typeof criterion.evidence === "string" ? criterion.evidence : "";
            return (
              <ExpandableSection
                key={criterion.criterion}
                title={criterion.criterion}
                subtitle={criterion.met ? "Marked as satisfied" : mandatoryCriterion ? "Evidence still required" : "Supplementary criterion"}
                defaultOpen={!criterion.met}
                badge={
                  <StatusBadge
                    variant={criterion.met ? "pass" : mandatoryCriterion ? "fail" : "partial"}
                    size="sm"
                  />
                }
              >
                <div className="v3-expandable-detail-copy">
                  {evidence ? (
                    <div>
                      <div className="v3-expandable-detail-label">Evidence</div>
                      <div>{evidence}</div>
                    </div>
                  ) : (
                    <div>No supporting evidence captured yet.</div>
                  )}
                  {mandatoryCriterion && !criterion.met ? (
                    <div className="v3-expandable-inline-note">This one should be addressed before gate approval.</div>
                  ) : null}
                </div>
              </ExpandableSection>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="✓"
          title="No exit criteria yet"
          description="Generate the draft criteria for this phase, then review and confirm what must be true before approval."
          compact
          action={{ label: "Generate criteria", onClick: onGenerateCriteria }}
        />
      )}
    </div>
  );
}

function GateNotePanel({ phaseId, existing, onSave }: { phaseId: string; existing: string; onSave: (phaseId: string, note: string) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState(existing);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setNote(existing);
  }, [existing]);

  return (
    <div className="v3-note-panel">
      {existing && !open ? (
        <div className="v3-note-panel-existing">
          {existing}
          <button type="button" className="v3-button ghost v3-button-inline-xs v3-button-inline-gap" onClick={() => setOpen(true)}>Edit</button>
        </div>
      ) : (
        <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setOpen(true)}>
          {existing ? "Edit gate note" : "+ Add gate note"}
        </button>
      )}
      {open ? (
        <div className="v3-note-panel-editor">
          <textarea className="v3-input v3-textarea" aria-label="Gate note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context about this gate outcome…" />
          <div className="v3-inline-actions">
            <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="v3-button primary v3-button-inline-xs" disabled={saving} onClick={async () => { setSaving(true); try { await onSave(phaseId, note); setOpen(false); } finally { setSaving(false); } }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StageBriefPanel({ phaseId, onSave }: { phaseId: string; onSave: (phaseId: string, note: string) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onSave(phaseId, text.trim());
      setSaved(true);
      setText("");
      setTimeout(() => {
        setSaved(false);
        setOpen(false);
      }, 1200);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="v3-button ghost v3-button-inline-sm v3-button-block-gap"
        onClick={() => setOpen(true)}
      >
        ✎ Brief ATOS on this phase
      </button>
    );
  }

  return (
    <div className="v3-brief-panel">
      <div className="v3-brief-panel-label">
        Notes for ATOS — this phase
        <span className="v3-brief-panel-hint">Corrections, context, constraints. Used to improve future analysis for this phase.</span>
      </div>
      <textarea
        className="v3-input v3-textarea"
        aria-label="Phase note for ATOS"
        rows={3}
        placeholder="e.g. Vendor confirmed delay to 14 Aug. Ignore previous timeline assumption. Sponsor wants risk summary by Friday."
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoFocus
      />
      <div className="v3-inline-actions v3-inline-actions--end">
        <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => { setOpen(false); setText(""); }}>
          Cancel
        </button>
        <button
          type="button"
          className="v3-button primary v3-button-inline-sm"
          disabled={!text.trim() || saving}
          onClick={() => void handleSave()}
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}

function AnimatedArtifactContent({ content }: { content: string }) {
  const sections = content.split("\n\n").map((section) => section.trim()).filter(Boolean);

  if (sections.length <= 1) {
    return <div className="v3-output-preview-body">{content}</div>;
  }

  return (
    <div className="v3-output-preview-body v3-output-preview-body--animated">
      {sections.map((section, index) => (
        <div
          key={`${section.slice(0, 32)}-${index}`}
          className="v3-output-preview-section"
          style={{ animationDelay: `${index * 70}ms` }}
        >
          {section}
        </div>
      ))}
    </div>
  );
}

const ARTIFACT_DESCRIPTIONS: Record<string, string> = {
  narrative: "Executive-ready summary of the programme status and direction",
  plan: "Prioritised action plan with the next 3 critical moves",
  "gate-review": "AI assessment of gate readiness and blockers",
  risk: "Live RAID log with mitigations and ownership",
  milestone: "Milestone health and schedule posture",
  "health-heatmap": "Programme health by dimension and stage",
  retro: "Lessons learned and improvement actions",
  deck: "Stakeholder-ready executive presentation slides",
  closure: "Programme closure summary and value realisation",
};

const PHASE_FOCUS_COPY: Record<string, string> = {
  strategy: "Define the transformation case and executive alignment",
  mobilise: "Establish the programme structure and team readiness",
  discover: "Capture current state and validate the opportunity",
  design: "Architect the future state and validate with stakeholders",
  build: "Execute workstreams and track delivery progress",
  operate: "Deploy, stabilise and transition to BAU",
  govern: "Ensure compliance, learning and continuous improvement",
  optimize: "Drive measurable performance improvement",
  valuerealize: "Close the programme and lock in outcomes",
};

export default function StageView({
  program,
  activeRuns,
  activePhaseId,
  lockedPhaseIds = new Set<string>(),
  mode,
  generatedAt,
  agentsAvailable = true,
  triggers,
  onOpenMoreView,
  onSelectPhase,
  onResolveDecision,
  onOpenDecide,
  onOpenReport,
  onSaveGateNote,
  onSaveStageNote,
  onApproveGate,
  onReopenGate,
  onGenerateCriteria,
  onRequestRemediation,
  onRunAgent,
  onSaveArtifact,
  onSaveInputs,
  onUploadDocument,
  onAssistField,
  artifactPreviews,
}: StageViewProps) {
  const [remediationOpen, setRemediationOpen] = React.useState(false);
  const [remediationNote, setRemediationNote] = React.useState("");
  const [expandedOutput, setExpandedOutput] = React.useState<string | null>(null);
  const [editingArtifact, setEditingArtifact] = React.useState<"narrative" | "deck" | null>(null);
  const [updatedArtifactId, setUpdatedArtifactId] = React.useState<"narrative" | "deck" | null>(null);
  const onboardingStorageKey = `adam_onboarding_stage_${program?.id || "local"}_${activePhaseId || "none"}`;
  const [guideDismissed, setGuideDismissed] = React.useState(false);
  const [summaryExpanded, setSummaryExpanded] = React.useState(false);
  const phaseMainRef = useRef<HTMLDivElement | null>(null);
  const previousNarrativeRef = useRef<string | null>(artifactPreviews?.narrative || null);
  const previousDeckRef = useRef<string | null>(artifactPreviews?.deck || null);
  const toggleOutput = (id: string) => {
    setExpandedOutput((previous) => previous === id ? null : id);
  };
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    setGuideDismissed(window.localStorage.getItem(onboardingStorageKey) === "done");
  }, [onboardingStorageKey]);
  useEffect(() => {
    const nextNarrative = artifactPreviews?.narrative || null;
    if (previousNarrativeRef.current && nextNarrative && previousNarrativeRef.current !== nextNarrative) {
      setUpdatedArtifactId("narrative");
      setExpandedOutput("narrative");
    }
    previousNarrativeRef.current = nextNarrative;
  }, [artifactPreviews?.narrative]);

  useEffect(() => {
    const nextDeck = artifactPreviews?.deck || null;
    if (previousDeckRef.current && nextDeck && previousDeckRef.current !== nextDeck) {
      setUpdatedArtifactId("deck");
      setExpandedOutput("deck");
    }
    previousDeckRef.current = nextDeck;
  }, [artifactPreviews?.deck]);
  const activePhase = useMemo(() => {
    if (!program) return null;
    return program.phases.find((phase) => phase.id === activePhaseId) || program.phases[0] || null;
  }, [activePhaseId, program]);

  // Methodology-declared artifacts for the active phase, keyed by producing-agent
  // id (e.g. Mobilise → governance-model, raci-matrix), with live state/quality
  // plus the phase's present/required completeness counts.
  const phaseArtifacts = useMemo(() => {
    const byKey = new Map<string, { present: boolean; quality: number | null; state: string; artifactId: string | null }>();
    if (!activePhase) return { byKey, present: 0, required: 0 };
    const summary = buildPhaseArtifacts(program, activePhase.id);
    // Narrative leads as its own inline preview, so it is excluded from the
    // artifact-chip list and its completeness counts on this screen (and the
    // Intelligence rail) to keep both surfaces consistent.
    let required = 0;
    let present = 0;
    for (const node of summary?.artifacts ?? []) {
      if (!node.required || node.key === "narrative") continue;
      byKey.set(node.key, { present: node.present, quality: node.quality, state: node.state, artifactId: node.artifactId });
      required += 1;
      if (node.present) present += 1;
    }
    return { byKey, present, required };
  }, [program, activePhase]);

  // Labels of required artifacts not yet produced — drives the artifacts-card summary.
  const missingRequiredArtifacts = useMemo(() => {
    if (!activePhase) return [] as string[];
    return getPhaseArtifactDefs(activePhase.id)
      .filter((def) => {
        const node = phaseArtifacts.byKey.get(def.id);
        return node && !node.present;
      })
      .map((def) => def.label);
  }, [activePhase, phaseArtifacts]);

  const gateReview = activePhase ? program?.gateReviews?.[activePhase.id] || null : null;
  const source = typeof program?.rawData === "object" && program.rawData !== null
    ? ("data" in program.rawData && typeof program.rawData.data === "object" && program.rawData.data !== null
      ? program.rawData.data as Record<string, unknown>
      : program.rawData as Record<string, unknown>)
    : null;
  // Full content for each produced artifact in the active phase, keyed by its
  // underlying artifact id (rawData.phaseArtifacts[phaseId][artifactId].content).
  // Powers the inline preview on every artifact row — the truncated 180-char
  // contentSummary on ArtifactSummary is too short to read, so we read the raw body.
  const phaseArtifactContentById = useMemo(() => {
    const map = new Map<string, string>();
    if (!source || !activePhase) return map;
    const bucket = source.phaseArtifacts && typeof source.phaseArtifacts === "object" && !Array.isArray(source.phaseArtifacts)
      ? (source.phaseArtifacts as Record<string, unknown>)[activePhase.id]
      : null;
    if (!bucket || typeof bucket !== "object") return map;
    for (const [artifactId, value] of Object.entries(bucket as Record<string, unknown>)) {
      const entry = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      if (!entry) continue;
      const content = typeof entry.content === "string" && entry.content.trim()
        ? entry.content
        : typeof entry.contentSummary === "string" ? entry.contentSummary : "";
      if (content.trim()) map.set(artifactId, content);
    }
    return map;
  }, [source, activePhase]);
  const gateReviewStatus = getRawGateStatus(program, activePhase?.id) || gateReview?.status || null;
  const stageDecisions = (program?.decisionQueue || [])
    .filter((decision) => !decision.status || decision.status === "open")
    .filter((decision) => !decision.phaseId || decision.phaseId === activePhase?.id);
  const stageActions = (program?.plan?.nextThreeActions || [])
    .filter((action) =>
      action.phase === activePhase?.id ||
      action.phase?.toLowerCase().includes(activePhase?.id?.toLowerCase() ?? "__")
    )
    .slice(0, 3);
  const stageMilestones = sortByDate((program?.milestones || []).filter((milestone) => milestone.phaseId === activePhase?.id && milestone.status !== "complete")).slice(0, 2);
  const phaseRationale = program?.plan?.nextThreeActions?.find((action) => action.phase === activePhase?.id)?.rationale || "";
  const verdict = firstSentence(
    activePhase?.objective ||
    phaseRationale ||
    program?.plan?.summary ||
    program?.narrative ||
    ""
  );
  const incomingHandoff = useMemo(() => {
    if (!program || !activePhase) return null;
    const source = typeof program.rawData === "object" && program.rawData !== null
      ? ("data" in program.rawData && typeof program.rawData.data === "object" && program.rawData.data !== null
        ? program.rawData.data
        : program.rawData)
      : null;
    if (!source || typeof source !== "object") return null;
    const handoffs = "phaseIncomingHandoffs" in source && typeof source.phaseIncomingHandoffs === "object" && source.phaseIncomingHandoffs !== null
      ? source.phaseIncomingHandoffs as Record<string, unknown>
      : null;
    const handoff = handoffs?.[activePhase.id];
    return handoff && typeof handoff === "object" ? handoff as Record<string, unknown> : null;
  }, [program, activePhase]);
  const isGateRunning = activePhase ? triggers.gateReviewRunningPhaseSet.has(activePhase.id) : false;
  const isRetroRunning = activePhase ? triggers.retroRunningPhases.has(activePhase.id) : false;
  const gateTrend = useMemo(() => {
    if (!activePhase || !program?.id) return null;
    return getRiskTrend(activePhase.id, program.id);
  }, [activePhase, program?.id]);
  const readiness = useMemo(
    () => (program && activePhase ? computePhaseReadiness(program, activePhase.id) : null),
    [activePhase, program],
  );
  const phaseConfidence = useMemo(
    () => (program && activePhase ? deriveProgramConfidence(program, activePhase.id) : null),
    [activePhase, program],
  );
  const gateHumanNote = gateReview && typeof (gateReview as unknown as Record<string, unknown>).humanNote === "string"
    ? ((gateReview as unknown as Record<string, unknown>).humanNote as string)
    : "";
  const existingStageNotes = useMemo(() => {
    if (!source) return [];
    const notes = Array.isArray(source.humanNotes) ? source.humanNotes : [];
    return notes
      .filter((note): note is Record<string, unknown> =>
        typeof note === "object" && note !== null &&
        (note.type === "stage-note" || note.type === "gate-note") &&
        note.phaseId === activePhase?.id
      )
      .slice(-3)
      .reverse();
  }, [activePhase?.id, source]);
  const inputQuality = useMemo(() => {
    const bucket = source?.inputQuality;
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return null;
    const entry = (bucket as Record<string, unknown>)[activePhase?.id || ""];
    return entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as {
          overallScore: number;
          verdict: string;
          missingCritical?: string[];
          readyToRun?: string[];
        }
      : null;
  }, [activePhase?.id, source]);
  const generatedCriteria = useMemo(() => {
    const bucket = source?.generatedExitCriteria;
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return [];
    const entry = (bucket as Record<string, unknown>)[activePhase?.id || ""];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const criteria = (entry as Record<string, unknown>).criteria;
    return Array.isArray(criteria)
      ? criteria.filter((item): item is { criterion: string; category: string; owner: string; mandatory: boolean } => (
          typeof item === "object"
          && item !== null
          && typeof (item as Record<string, unknown>).criterion === "string"
        ))
      : [];
  }, [activePhase?.id, source]);
  const contradictions = Array.isArray(source?.contradictions)
    ? source.contradictions as Array<{ severity: string; description: string }>
    : [];
  const criticalContradictions = contradictions.filter((item) => item.severity === "critical");
  const scopeDrift = source?.scopeDrift && typeof source.scopeDrift === "object" && !Array.isArray(source.scopeDrift)
    ? source.scopeDrift as { driftIndex: number; driftLevel: string; summary: string }
    : null;
  const weeklyDigest = source?.weeklyDigest && typeof source.weeklyDigest === "object" && !Array.isArray(source.weeklyDigest)
    ? source.weeklyDigest as {
        weekSummary: string;
        topPriorities: Array<{ priority: string; reason: string }>;
        weekHealthRag: string;
        weekOf: string;
        generatedAt: string;
      }
    : null;
  const handoffQuality = source?.handoffQuality && typeof source.handoffQuality === "object" && !Array.isArray(source.handoffQuality)
    ? (source.handoffQuality as Record<string, unknown>)[activePhase?.id || ""] as { score?: number; passed?: boolean } | undefined
    : undefined;
  const narrativeQuality = source?.narrativeQuality && typeof source.narrativeQuality === "object" && !Array.isArray(source.narrativeQuality)
    ? source.narrativeQuality as { score: number; improvements?: string[] }
    : null;
  const deckQuality = source?.deckQuality && typeof source.deckQuality === "object" && !Array.isArray(source.deckQuality)
    ? source.deckQuality as { score: number; improvements?: string[] }
    : null;
  const mondayOfCurrentWeek = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    const day = monday.getDay();
    const delta = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + delta);
    return monday.toISOString().slice(0, 10);
  }, []);
  const staleArtifacts = Array.isArray(source?.staleArtifacts) ? source.staleArtifacts as string[] : [];
  const artifactsStaleReason = typeof source?.artifactsStaleReason === "string" ? source.artifactsStaleReason : null;
  const phaseWorkstreams = (program?.workstreams || []).filter((workstream: Workstream) => workstream.phaseId === activePhase?.id);
  const activeRun = activeRuns?.some(r => r.status === "running");
  // True while a given agent has an in-flight run (queued or running). Drives the
  // per-button "Generating…" + disabled state so a user can't re-fire the same
  // generation while it's already working.
  const isAgentRunning = (agentId: string) =>
    !!activeRuns?.some(r => (r.status === "running" || r.status === "queued") && r.agent_id === agentId);
  // Unified label for any agent-trigger button: "Generating…" while in-flight,
  // the idle label with a small "AI not available" note when agents are offline,
  // otherwise the plain idle label.
  const agentButtonContent = (agentId: string, idleLabel: React.ReactNode) => {
    if (isAgentRunning(agentId)) return "Generating…";
    if (!agentsAvailable) {
      return (
        <span className="v3-agent-btn-stack">
          <span>{idleLabel}</span>
          <span className="v3-agent-btn-note">AI not available</span>
        </span>
      );
    }
    return idleLabel;
  };
  const agentButtonDisabled = (agentId: string) => !agentsAvailable || isAgentRunning(agentId);
  const narrativeRunning = activeRuns?.some(r => r.status === "running" && r.agent_id === "narrative");
  const gateCoach = source?.gateReadinessCoach && typeof source.gateReadinessCoach === "object" && !Array.isArray(source.gateReadinessCoach)
    ? (source.gateReadinessCoach as Record<string, { actions?: Array<{ action: string; effort: "quick" | "hours" | "days"; owner: "user" | "agent"; agentId: string | null }> }>)[activePhase?.id ?? ""]
    : null;
  const discoveryGuide = source?.discoveryGuide && typeof source.discoveryGuide === "object" && !Array.isArray(source.discoveryGuide)
    ? source.discoveryGuide as Record<string, unknown>
    : null;
  const sprintPlan = source?.sprintPlan && typeof source.sprintPlan === "object" && !Array.isArray(source.sprintPlan)
    ? source.sprintPlan as Record<string, unknown>
    : null;
  const kpiValidation = source?.kpiValidation && typeof source.kpiValidation === "object" && !Array.isArray(source.kpiValidation)
    ? source.kpiValidation as { avgScore?: number; validatedKPIs?: Array<{ original?: string; smartScore?: number; improvedVersion?: string; gaps?: string[] }> }
    : null;
  const complianceCheck = source?.complianceCheck && typeof source.complianceCheck === "object" && !Array.isArray(source.complianceCheck)
    ? source.complianceCheck as { gaps?: Array<{ framework?: string; articleId?: string; gap?: string; severity?: string; requiredAction?: string }> }
    : null;
  const capacityAssessment = source?.capacityAssessment && typeof source.capacityAssessment === "object" && !Array.isArray(source.capacityAssessment)
    ? source.capacityAssessment as { overallAdequacy?: string; adequacyScore?: number; recommendations?: string[]; roleGaps?: Array<{ role?: string; currentCount?: number; requiredCount?: number; gap?: number }> }
    : null;
  const vendorRiskAssessment = source?.vendorRiskAssessment && typeof source.vendorRiskAssessment === "object" && !Array.isArray(source.vendorRiskAssessment)
    ? source.vendorRiskAssessment as { vendorAssessments?: Array<{ vendorName?: string; riskScore?: number; dependencyCriticality?: string; recommendedAction?: string }> }
    : null;
  const phaseInputs = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
    ? (source.phaseInputs as Record<string, unknown>)[activePhase?.id ?? ""]
    : null;
  const hasPhaseInputs = !!(phaseInputs && typeof phaseInputs === "object" && Object.keys(phaseInputs as Record<string, unknown>).some((key) => key !== "savedAt"));
  // Pre-flight input gating: the captured inputs for this phase, normalised for
  // runPreFlight so each artifact row can warn (before a ~90s run that would burn
  // provider quota) when the producing agent's required inputs are missing.
  const preFlightInputs = useMemo<Record<string, unknown>>(() => (
    phaseInputs && typeof phaseInputs === "object" && !Array.isArray(phaseInputs)
      ? phaseInputs as Record<string, unknown>
      : {}
  ), [phaseInputs]);
  const hasGateReview = !!gateReview;
  const gateApproved = gateReviewStatus === "approved";
  const confirmedCriteria =
    (gateReview?.exitCriteriaStatus || []).filter((criterion) => criterion.met).length > 0 ||
    gateApproved; // Gate approval implies criteria were met, even when exitCriteriaStatus wasn't written
  // Phase-aware checklist — each phase has context-specific "why" guidance (Priority 10)
  const PHASE_ONBOARDING_STEPS: Record<string, Array<{ label: string; why: string }>> = {
    strategy:    [
      { label: "Define programme objective and business case", why: "Without a clear objective, ATOS cannot generate meaningful summaries or action plans." },
      { label: "Upload existing strategy documents", why: "Document upload instantly bootstraps your programme data." },
      { label: "Generate your strategy brief", why: "Creates the foundation narrative that all downstream phase analysis references." },
      { label: "Approve gate to proceed to Mobilise", why: "Gate approval confirms strategic intent is clear before committing resources." },
    ],
    mobilise:    [
      { label: "Enter team roster and governance structure", why: "ATOS needs to know who's accountable for each workstream to assign actions correctly." },
      { label: "Confirm budget baseline", why: "Budget data drives risk scoring and milestone health calculations." },
      { label: "Review mobilisation risks", why: "Early risk identification prevents cost overruns in later phases." },
      { label: "Approve gate to proceed to Discover", why: "Confirms the team is assembled and governance is in place." },
    ],
    discover:    [
      { label: "Log stakeholder interviews and as-is findings", why: "Discovery outputs are required for Design phase architecture decisions." },
      { label: "Analyse stakeholder engagement", why: "Identifies engagement gaps that can delay delivery if not addressed early." },
      { label: "Document pain points and capability gaps", why: "Gaps drive the change impact assessment in Design phase." },
      { label: "Approve gate to proceed to Design", why: "Gate confirms discovery is complete before committing to solution design." },
    ],
    design:      [
      { label: "Upload target operating model or solution architecture", why: "Architecture decisions are hard to reverse — ATOS will flag contradictions early." },
      { label: "Assess change impact", why: "Identifies affected groups and resistance risks before build begins." },
      { label: "Get TOM approved by SteerCo", why: "Sponsor sign-off on design reduces rework risk in Build phase by ~40%." },
      { label: "Approve gate to proceed to Build", why: "Confirms design is locked before development investment." },
    ],
    build:       [
      { label: "Enter build milestones and delivery workstreams", why: "Milestone tracking is the primary health signal for this phase." },
      { label: "Generate prioritised action plan", why: "Identifies the critical path and sequences work to reduce delivery risk." },
      { label: "Complete UAT criteria and testing", why: "Gate approval requires evidence that the solution meets acceptance criteria." },
      { label: "Approve gate to proceed to Operate", why: "Confirms the solution is ready to go live." },
    ],
    operate:     [
      { label: "Confirm go-live plan and cutover approach", why: "Cutover failures are the #1 cause of programme escalations — plan early." },
      { label: "Set up KPI tracking against baseline", why: "ATOS needs measurement data to calculate benefits realisation in Value Realise phase." },
      { label: "Confirm support model and hypercare plan", why: "Unplanned support demand after go-live is a top adoption risk." },
      { label: "Approve gate to proceed to Govern", why: "Confirms steady-state operations are established." },
    ],
    govern:      [
      { label: "Complete compliance framework review", why: "Regulatory non-compliance discovered late creates programme-halting risk." },
      { label: "Approve control matrix with internal audit", why: "Controls sign-off is required for closure in regulated environments." },
      { label: "Test escalation routes and decision rights", why: "Untested escalation paths cause decision delays and governance failures." },
      { label: "Approve gate to proceed to Optimize", why: "Confirms the operating model is governed and auditable." },
    ],
    optimize:    [
      { label: "Establish benefits baseline measurement", why: "Without a baseline, value realisation cannot be demonstrated to stakeholders." },
      { label: "Prioritise improvement backlog by business value", why: "Post-go-live improvements compete for limited capacity — prioritisation is essential." },
      { label: "Run adoption metrics report", why: "Low adoption is the most common reason benefits are not realised." },
      { label: "Approve gate to proceed to Value Realise", why: "Confirms the solution is optimised and adoption is sufficient for value measurement." },
    ],
    valuerealize:[
      { label: "Quantify and sign off benefits realised", why: "Sponsor-confirmed benefits are the primary deliverable of the programme." },
      { label: "Complete programme retrospective", why: "Lessons learned feed ATOS's pattern library, making future programmes smarter." },
      { label: "Produce and approve closure pack", why: "Closure pack is the formal record of programme outcomes for the client and stakeholders." },
      { label: "Confirm handover to BAU", why: "Without formal BAU handover, value erodes as programme team disengages." },
    ],
  };
  const phaseSteps = PHASE_ONBOARDING_STEPS[activePhase?.id ?? ""] ?? [
    { label: "Complete phase setup", why: "ATOS needs phase data to generate insights and readiness assessments." },
    { label: "Check gate readiness", why: "Gate readiness check assesses what's complete and identifies gaps." },
    { label: "Review and confirm exit criteria", why: "Exit criteria define what 'done' looks like for this phase." },
    { label: "Approve gate to unlock the next phase", why: "Gate approval signals the team is ready to proceed." },
  ];
  const onboardingItems = phaseSteps.map((step, idx) => ({
    label: step.label,
    why: step.why,
    done: idx === 0 ? hasPhaseInputs : idx === 1 ? hasGateReview : idx === 2 ? confirmedCriteria : gateApproved,
  }));
  const showEmbeddedOnboarding = !guideDismissed && !gateApproved;

  if (!program || !activePhase) {
    return (
      <div className="v3-section">
        <div className="v3-empty-shell">
          <EmptyState
            icon="◎"
            title="No active phase selected"
            description="Choose a phase from the phase rail to open its work surface."
            compact={false}
          />
        </div>
      </div>
    );
  }

  const phaseTone = phaseStatusTone(activePhase);
  const showRetro = activePhase.pct >= 90;

  return (
    <div className="v3-work-area v3-surface-enter">
      <PhaseRail
        phases={program.phases}
        activePhaseId={activePhase.id}
        gateReviews={(program.gateReviews || {}) as Record<string, { status?: string } | undefined>}
        lockedPhaseIds={lockedPhaseIds}
        onPhaseClick={(phaseId) => {
          if (onSelectPhase) onSelectPhase(phaseId);
        }}
      />
      {/* ===== COMPACT HEADER BLOCK — identity · key metrics · current focus · moved actions ===== */}
      <header className="v3-phase-head">
        <div className="v3-phase-head-row">
          <div className="v3-phase-head-identity">
            {/* Canonical 3-ring phase status — inner Input · middle Artifact · outer Gate */}
            <PhaseStatusRings program={program} phaseId={activePhase.id} size={84} showCenter />
            <div className="v3-phase-head-titles">
              <div className="v3-phase-head-eyebrow">
                <span className="v3-phase-head-prog">{program.name}</span>
                {program.client ? <span>· {program.client}</span> : null}
                {program.sponsor ? <span>· Sponsor: {program.sponsor}</span> : null}
                <span>· Updated <RelativeTime date={program.updatedAt} /></span>
              </div>
              <div className="v3-phase-head-titlerow">
                <span className="v3-phase-head-title">{activePhase.label ?? activePhase.id}</span>
                <span className={`v3-chip ${phaseTone.tone === "green" ? "green" : phaseTone.tone === "amber" ? "amber" : phaseTone.tone === "red" ? "red" : "muted"}`}>
                  {activePhase.status ? activePhase.status.replace(/-/g, " ") : `${Math.round(activePhase.pct ?? 0)}% complete`}
                </span>
                {(() => {
                  const readinessScores = (program?.rawData as Record<string,unknown>)?.data
                    ? ((program?.rawData as Record<string,unknown>)?.data as Record<string,unknown>)?.phaseReadinessScores
                    : (program?.rawData as Record<string,unknown>)?.phaseReadinessScores;
                  const phaseReadiness = readinessScores && typeof readinessScores === "object"
                    ? (readinessScores as Record<string,unknown>)[activePhase.id] as { score?: number; blockers?: string[] } | undefined
                    : undefined;
                  return <ReadinessBadge score={phaseReadiness?.score} blockers={phaseReadiness?.blockers} size="sm" />;
                })()}
                {phaseConfidence ? (
                  <span
                    className={`v3-chip ${phaseConfidence.score >= 75 ? "green" : phaseConfidence.score >= 50 ? "amber" : "red"}`}
                    title={phaseConfidence.explanation}
                  >
                    {phaseConfidence.score}% confidence
                  </span>
                ) : null}
                {gateTrend && gateTrend !== "stable" ? (
                  <span className={`v3-chip ${gateTrend === "improving" ? "green" : "amber"}`}>
                    {gateTrend === "improving" ? "↑ readiness improving" : "↓ readiness declining"}
                  </span>
                ) : null}
              </div>
              {PHASE_FOCUS_COPY[activePhase.id] ? (
                <div className="v3-phase-head-focus">{PHASE_FOCUS_COPY[activePhase.id]}</div>
              ) : null}
              {verdict ? <div className="v3-phase-head-verdict">{verdict}</div> : null}
            </div>
          </div>
        </div>

        {/* Key metrics */}
        {readiness ? (
          <div className="v3-phase-metrics">
            {[
              { label: "Readiness", value: `${readiness.score}%`, tone: readiness.score >= 75 ? "green" : readiness.score >= 50 ? "amber" : "red", anchor: "exit-criteria-anchor" },
              { label: "Input", value: `${readiness.inputScore}%`, tone: "", anchor: "phase-inputs-anchor" },
              { label: "Artifact", value: `${readiness.artifactScore}%`, tone: "", anchor: "phase-artifacts-anchor" },
              { label: "Gate", value: readiness.gateScore != null ? `${readiness.gateScore}%` : "—", tone: "", anchor: "exit-criteria-anchor" },
              { label: "Complete", value: `${Math.round(activePhase.pct)}%`, tone: "", anchor: null },
              ...(inputQuality ? [{ label: "Input quality", value: `${inputQuality.overallScore}%`, tone: inputQuality.verdict === "sufficient" ? "green" : inputQuality.verdict === "partial" ? "amber" : "red", anchor: "phase-inputs-anchor" }] : []),
              ...(handoffQuality?.score ? [{ label: "Handoff", value: `${handoffQuality.score}%`, tone: handoffQuality.passed ? "green" : "amber", anchor: "phase-artifacts-anchor" }] : []),
            ].map((metric) => {
              const cls = `v3-phase-metric-value ${metric.tone}`;
              if (!metric.anchor) {
                return (
                  <div key={metric.label} className="v3-phase-metric">
                    <div className={cls}>{metric.value}</div>
                    <div className="v3-phase-metric-label">{metric.label}</div>
                  </div>
                );
              }
              return (
                <button
                  key={metric.label}
                  type="button"
                  className="v3-phase-metric is-clickable"
                  aria-label={`${metric.label} ${metric.value} — jump to section`}
                  onClick={() => document.getElementById(metric.anchor!)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                >
                  <div className={cls}>{metric.value}</div>
                  <div className="v3-phase-metric-label">{metric.label}</div>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Moved actions — gate decisions + artifact / nav jumps */}
        <div className="v3-phase-head-actions">
          <div className="v3-phase-head-actions-grp">
            <StatusBadge
              variant={gateReviewStatus === "approved" ? "approved" : gateReviewStatus === "remediation-requested" ? "remediation" : "pending"}
              label={gateReviewStatus ? gateReviewStatus.replace(/-/g, " ") : "gate pending"}
            />
            {gateReviewStatus === "pending-review" || gateReviewStatus === "ready" ? (
              <button
                type="button"
                className="v3-button primary v3-button-inline-sm"
                disabled={!readiness?.canApproveGate}
                title={!readiness?.canApproveGate ? `Gate readiness ${readiness?.score ?? 0}% — ${readiness?.threshold ?? 70}% required` : undefined}
                aria-label={`Approve gate for ${activePhase?.label ?? activePhase.id}`}
                onClick={async () => { try { await onApproveGate(activePhase.id); } catch { /* handled by AppShellV3 */ } }}
              >
                Approve & Unlock ✓
              </button>
            ) : null}
            {gateReviewStatus === "pending-review" || gateReviewStatus === "ready" ? (
              <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => setRemediationOpen(true)}>Flag Issues</button>
            ) : null}
            <button
              type="button"
              className="v3-button ghost v3-button-inline-sm"
              disabled={isGateRunning}
              onClick={() => triggers.triggerGateReview(activePhase.id)}
            >
              {isGateRunning ? "Checking…" : gateReview ? "Re-check Gate Readiness" : "Check Gate Readiness"}
            </button>
            {gateReviewStatus === "approved" ? (
              <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => onReopenGate(activePhase.id)}>Reopen Gate</button>
            ) : null}
          </div>
          <div className="v3-phase-head-actions-grp">
            <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => { setExpandedOutput("narrative"); document.getElementById("phase-artifacts-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Narrative</button>
            <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => { setExpandedOutput("deck"); document.getElementById("phase-artifacts-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Status deck</button>
            <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => document.getElementById("exit-criteria-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Exit criteria</button>
            <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => onOpenMoreView("milestones")}>Milestones</button>
          </div>
        </div>

        {remediationOpen ? (
          <div className="v3-remediation-panel">
            <textarea
              className="v3-input v3-textarea"
              aria-label="Gate remediation note"
              rows={2}
              value={remediationNote}
              onChange={(event) => setRemediationNote(event.target.value)}
              placeholder="Explain what must be fixed before this gate can be approved…"
            />
            <div className="v3-inline-actions">
              <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setRemediationOpen(false)}>Cancel</button>
              <button
                type="button"
                className="v3-button primary v3-button-inline-xs"
                disabled={!remediationNote.trim()}
                onClick={async () => {
                  try {
                    await onRequestRemediation(activePhase.id, remediationNote.trim());
                    setRemediationOpen(false);
                    setRemediationNote("");
                  } catch { /* handled by AppShellV3 */ }
                }}
              >
                Save remediation request
              </button>
            </div>
          </div>
        ) : null}

        {program && activePhase?.id ? (
          <PhaseChangeSummary program={program} phaseId={activePhase.id} />
        ) : null}
      </header>
      {/* Executive snapshot — condensed 15-second read of the phase, pinned above the zones */}
      <div style={{ padding: "10px 20px 0" }}>
        <PhaseExecutiveSummary
          program={program}
          phaseId={activePhase.id}
          onRunAgent={onRunAgent}
          isAgentRunning={isAgentRunning}
          onOpenMoreView={(view) => onOpenMoreView(view as V3MoreView)}
          onReviewContradiction={() => {
            const firstId = (criticalContradictions[0] as Record<string, unknown> | undefined)?.id as string | undefined;
            if (firstId && typeof onOpenDecide === "function") {
              (onOpenDecide as (id?: string) => void)(firstId);
            } else {
              onOpenDecide();
            }
          }}
        />
      </div>
      {/* Priority 10 — "Where am I / What's next" guidance strip */}
      {readiness && !readiness.canApproveGate && readiness.recommendedActions.length > 0 && !activeRun && (
        <div style={{
          margin: "0 0 8px",
          padding: "8px 16px",
          background: "var(--v3-surface)",
          borderBottom: "1px solid var(--v3-border-soft)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
        }}>
          <span style={{ color: "var(--v3-text-muted)", flexShrink: 0 }}>Next:</span>
          <span style={{ color: "var(--v3-text-primary)", fontWeight: 500, flex: 1 }}>
            {readiness.recommendedActions[0].label}
          </span>
          {readiness.recommendedActions[0].estimatedImpact > 0 && (
            <span style={{ color: "var(--v3-green)", fontWeight: 600, flexShrink: 0 }}>
              +{readiness.recommendedActions[0].estimatedImpact} pts
            </span>
          )}
          {readiness.recommendedActions[0].agentId && (
            <button
              type="button"
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "var(--v3-accent)", color: "#fff", border: "none", cursor: "pointer", flexShrink: 0 }}
              onClick={() => onRunAgent(readiness.recommendedActions[0].agentId!)}
            >
              Analyse now →
            </button>
          )}
          {!readiness.recommendedActions[0].agentId && readiness.recommendedActions[0].workspaceId && (
            <button
              type="button"
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, background: "var(--v3-surface-2)", color: "var(--v3-text-primary)", border: "1px solid var(--v3-border)", cursor: "pointer", flexShrink: 0 }}
              onClick={() => onOpenMoreView?.(readiness.recommendedActions[0].workspaceId!)}
            >
              Open →
            </button>
          )}
          <span style={{
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: 10,
            background: readiness.recommendedActions[0].priority === "critical" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
            color: readiness.recommendedActions[0].priority === "critical" ? "var(--v3-red, #ef4444)" : "var(--v3-amber)",
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {readiness.recommendedActions[0].priority}
          </span>
        </div>
      )}

      {/* Executive summary — generated on demand, never auto-run, so it stays stable */}
      <div style={{
        margin: "0 0 16px",
        padding: "12px 16px",
        background: "var(--v3-surface-2)",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius)",
        fontSize: 12,
        color: "var(--v3-text-secondary)",
        lineHeight: 1.6,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            ✦ Executive summary
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {artifactPreviews?.narrative && !narrativeRunning ? (
              <button
                type="button"
                className="v3-button ghost v3-button-inline-xs"
                onClick={() => setSummaryExpanded((open) => !open)}
                aria-expanded={summaryExpanded}
              >
                {summaryExpanded ? "Collapse" : "Expand"}
              </button>
            ) : null}
            <button
              type="button"
              className="v3-button ghost v3-button-inline-xs"
              onClick={() => onRunAgent("narrative")}
              disabled={narrativeRunning}
            >
              {narrativeRunning ? "Generating…" : artifactPreviews?.narrative ? "Refresh" : "Generate summary"}
            </button>
          </div>
        </div>
        {narrativeRunning ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--v3-accent)" }}>
            <span style={{ animation: "v3-spin 1.2s linear infinite", display: "inline-block" }}>◎</span>
            <span>ATOS is generating the summary…</span>
          </div>
        ) : artifactPreviews?.narrative ? (
          <div style={summaryExpanded
            ? { whiteSpace: "pre-wrap" }
            : { overflow: "hidden", maxHeight: 60, maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)" }}>
            {typeof artifactPreviews.narrative === "string"
              ? (summaryExpanded ? artifactPreviews.narrative : artifactPreviews.narrative.slice(0, 300))
              : ""}
          </div>
        ) : (
          <div style={{ color: "var(--v3-text-muted)" }}>
            No summary yet — click Generate summary to have ATOS analyse this programme.
          </div>
        )}
      </div>
      <div className="v3-phase-body">
      <section className="v3-zone v3-zone--focus v3-phase-aside">
        {weeklyDigest && weeklyDigest.weekOf === mondayOfCurrentWeek ? (
          <div className="v3-weekly-digest">
            <div className="v3-digest-head">
              <div className="v3-card-title v3-card-title--flush">Week of {weeklyDigest.weekOf}</div>
              <span className={`v3-chip ${weeklyDigest.weekHealthRag}`}>{weeklyDigest.weekHealthRag}</span>
            </div>
            <div className="v3-digest-summary">
              {weeklyDigest.weekSummary}
            </div>
            {weeklyDigest.topPriorities?.length ? (
              <div className="v3-digest-priorities">
                <div className="v3-inline-list-label">
                  This week's priorities
                </div>
                {weeklyDigest.topPriorities.slice(0, 3).map((priority, index) => (
                  <div key={`${priority.priority}-${index}`} className="v3-digest-priority-row">
                    <span className="v3-digest-priority-index">{index + 1}</span>
                    <div>
                      <div className="v3-digest-priority-title">{priority.priority}</div>
                      <div className="v3-digest-priority-reason">{priority.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {showEmbeddedOnboarding ? (
          <OnboardingCard
            variant="checklist"
            title="Start here"
            subtitle={`${onboardingItems.filter((item) => item.done).length} of ${onboardingItems.length} complete`}
            items={onboardingItems}
            ctaLabel={
              !hasPhaseInputs ? "Open phase inputs →"
              : (!hasGateReview && agentsAvailable) ? "Check gate readiness"
              : (!hasGateReview && !agentsAvailable) ? "Approve gate"
              : !confirmedCriteria ? "Review criteria"
              : "Approve gate"
            }
            onCtaClick={() => {
              if (!hasPhaseInputs) {
                // Phase inputs are now the inline working area — scroll to them.
                document.getElementById("phase-inputs-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" });
                return;
              }
              // If agents aren't available (no auth), skip gate review and go straight to approve
              if (!hasGateReview && agentsAvailable) {
                triggers.triggerGateReview(activePhase.id);
                return;
              }
              if (!hasGateReview && !agentsAvailable) {
                // Manual gate approval without AI review
                void onApproveGate(activePhase.id);
                return;
              }
              if (!confirmedCriteria) {
                onGenerateCriteria();
                return;
              }
              void onApproveGate(activePhase.id);
            }}
            onDismiss={() => {
              if (typeof window !== "undefined") {
                window.localStorage.setItem(onboardingStorageKey, "done");
              }
              setGuideDismissed(true);
            }}
          />
        ) : null}

        {program && activePhase?.id ? (
          <GateBlockingChecklist
            program={program}
            phaseId={activePhase.id}
            gateStatus={gateReviewStatus}
            onRunAgent={onRunAgent}
            onOpenMoreView={onOpenMoreView}
            onOpenDecide={onOpenDecide}
            isAgentRunning={isAgentRunning}
          />
        ) : null}

        {readiness && readiness.score < 80 && gateCoach?.actions?.length ? (
          <GateCoachPanel actions={gateCoach.actions} onRunAgent={onRunAgent} isAgentRunning={isAgentRunning} />
        ) : null}
        {phaseWorkstreams.length > 1 ? (
          <div className="v3-workstream-list v3-stack-sm">
            {phaseWorkstreams.map((workstream) => (
              <div key={workstream.id} className="v3-workstream-row">
                <div className="v3-workstream-row-head">
                  <span className="v3-workstream-row-label">{workstream.label}</span>
                  <span className="v3-workstream-row-value">{Math.round(workstream.pct)}%</span>
                </div>
                <div className="v3-phase-progress-bar">
                  <div className="v3-phase-progress-fill" style={{ width: `${workstream.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {scopeDrift && scopeDrift.driftIndex > 15 ? (
          <div className="v3-scope-drift-chip">
            <span className={`v3-chip ${scopeDrift.driftIndex > 40 ? "red" : "amber"}`}>
              Scope drift {scopeDrift.driftIndex}%
            </span>
            <span className="v3-banner-detail">{scopeDrift.summary}</span>
          </div>
        ) : null}
        {staleArtifacts.length > 0 && artifactsStaleReason ? (
          <div className="v3-stale-banner">
            <span>↻</span>
            <span className="v3-banner-copy">
              Artifacts refreshing after scope change: {artifactsStaleReason}
            </span>
          </div>
        ) : null}

        {incomingHandoff ? (
          <div className="v3-handoff-banner">
            <div className="v3-eyebrow-label">
              Carried forward from {String(incomingHandoff.fromPhaseId || "previous phase")}
            </div>
            {typeof incomingHandoff.summary === "string" ? (
              <div className="v3-banner-copy v3-banner-copy--spaced">
                {incomingHandoff.summary}
              </div>
            ) : null}
            {Array.isArray(incomingHandoff.openQuestions) && incomingHandoff.openQuestions.length ? (
              <div>
                <div className="v3-inline-list-label">Open questions inherited:</div>
                <ul className="v3-inline-list">
                  {(incomingHandoff.openQuestions as string[]).slice(0, 3).map((question, index) => (
                    <li key={`${question}-${index}`}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {typeof incomingHandoff.recommendedNextAction === "string" ? (
              <div className="v3-banner-accent-copy">
                → {incomingHandoff.recommendedNextAction}
              </div>
            ) : null}
          </div>
        ) : null}
        {generatedAt ? (
          <div className="v3-generated-at">
            Last updated <RelativeTime date={generatedAt} />
          </div>
        ) : null}
        {gateReview ? <GateNotePanel phaseId={activePhase.id} existing={gateHumanNote} onSave={onSaveGateNote} /> : null}
        {existingStageNotes.length > 0 ? (
          <div className="v3-brief-history">
            <div className="v3-brief-history-label">Briefed</div>
            {existingStageNotes.map((note, index) => (
              <div key={`${String(note.savedAt)}-${index}`} className="v3-brief-history-item">
                <span className="v3-brief-history-text">{String(note.text)}</span>
                <span className="v3-brief-history-age"><RelativeTime date={String(note.savedAt)} /></span>
              </div>
            ))}
          </div>
        ) : null}
        <StageBriefPanel phaseId={activePhase.id} onSave={onSaveStageNote} />

                  <ActionList actions={stageActions} onOpenReport={() => onOpenReport("status")} />
      </section>

      <div className="v3-phase-main" ref={phaseMainRef}>
      <PhaseFlowOverlay containerRef={phaseMainRef} program={program} phaseId={activePhase.id} enabled />
      {/* LEFT — input fields card (keeps upload-document + workstream buttons inside PhaseInputsPanel) */}
      <section className="v3-phase-col v3-phase-col--inputs">
        <div className="v3-zone-label">Input fields</div>
        {inputQuality ? (
          <div className={`v3-input-quality-banner ${inputQuality.verdict}`}>
            <span className={`v3-chip ${inputQuality.verdict === "sufficient" ? "green" : inputQuality.verdict === "partial" ? "amber" : "red"}`}>
              Input quality {inputQuality.overallScore}%
            </span>
            {inputQuality.missingCritical?.length ? (
              <span className="v3-banner-detail">Missing: {inputQuality.missingCritical.slice(0, 2).join(" · ")}</span>
            ) : (
              <span className="v3-banner-detail">Ready: {inputQuality.readyToRun?.join(", ") || "all analysis"}</span>
            )}
          </div>
        ) : null}
        {program && activePhase?.id ? (
          <div id="phase-inputs-anchor">
            <PhaseInputsPanel
              program={program}
              phaseId={activePhase.id}
              onSave={onSaveInputs}
              onUploadDocument={onUploadDocument}
              onAssistField={onAssistField}
            />
          </div>
        ) : null}
      </section>

      {/* MIDDLE — live connector lines pinned to the real input-field and
          artifact elements in the side columns (always shown). */}
      <section className="v3-phase-col v3-phase-col--map" aria-hidden="true" />

      {/* BELOW — other phase-relevant cards, stretched full-width and stacked */}
      <div className="v3-phase-cards">
        <div className="v3-zone-label">Phase workspace</div>
        <div className="v3-phase-cards-grid">
          <div id="exit-criteria-anchor">
            <ExitCriteriaCard
              criteria={gateReview?.exitCriteriaStatus || []}
              generatedCriteria={generatedCriteria}
              onGenerateCriteria={onGenerateCriteria}
              gateApproved={gateApproved}
            />
          </div>

          <AdamCard accent={stageDecisions.length ? "warning" : "none"}>
            <AdamCardHeader
              title="Open decisions"
              subtitle={stageDecisions.length ? `${stageDecisions.length} awaiting resolution` : "No open decisions"}
              action={<button type="button" className="v3-button ghost v3-button-inline-xs" onClick={onOpenDecide}>View all →</button>}
            />
            <AdamCardBody>
              {stageDecisions.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {stageDecisions.slice(0, 3).map((decision: DecisionSummary) => (
                    <ExpandableSection
                      key={decision.id}
                      title={decision.question || decision.title || "Open decision"}
                      subtitle={`${decision.phaseId || activePhase.id} · decision pending`}
                      badge={<StatusBadge variant="open" size="sm" />}
                    >
                      <div className="v3-expandable-detail-copy">
                        {decision.recommendation ? (
                          <div>
                            <div className="v3-expandable-detail-label">Recommendation</div>
                            <div>{decision.recommendation}</div>
                          </div>
                        ) : null}
                        {decision.advisorAnalysis?.recommendationRationale ? (
                          <div>
                            <div className="v3-expandable-detail-label">Rationale</div>
                            <div>{decision.advisorAnalysis.recommendationRationale}</div>
                          </div>
                        ) : null}
                        <div className="v3-decision-actions v3-decision-actions--inline">
                          <button type="button" className="v3-button ghost v3-button-inline-xs" title="Mark this decision as approved and resolved" onClick={() => void onResolveDecision(decision.id, "approved")}>
                            Approve
                          </button>
                          <button type="button" className="v3-button ghost v3-button-inline-xs" title="Defer this decision — it will return to your queue in the next gate review" onClick={() => void onResolveDecision(decision.id, "deferred")}>
                            Defer
                          </button>
                        </div>
                      </div>
                    </ExpandableSection>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">No open decisions.</div>
              )}
            </AdamCardBody>
          </AdamCard>

          {mode === "power" ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Key milestones</div>
              {stageMilestones.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {stageMilestones.map((milestone) => (
                    <ExpandableSection
                      key={milestone.id}
                      title={milestone.title}
                      subtitle={`${formatShortDate(milestone.targetDate)}${milestone.owner ? ` · ${milestone.owner}` : ""}`}
                      badge={<StatusBadge variant={milestone.status === "at-risk" ? "at-risk" : milestone.status === "delayed" ? "delayed" : milestone.status === "complete" ? "complete" : "active"} size="sm" />}
                    >
                      <div className="v3-expandable-detail-copy">
                        <div>{milestone.source === "human" ? "Added manually for this phase." : "Derived by ATOS from current phase evidence."}</div>
                        {milestone.exitCriteria?.length ? (
                          <div>
                            <div className="v3-expandable-detail-label">Exit criteria</div>
                            <div>{milestone.exitCriteria.join(" · ")}</div>
                          </div>
                        ) : null}
                      </div>
                    </ExpandableSection>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">No upcoming milestones in this phase.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" onClick={() => onOpenMoreView("milestones")}>
                View all →
              </button>
            </div>
          ) : null}

          {activePhase.id === "discover" ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Discovery pack</div>
              {discoveryGuide ? (
                <div className="v3-mini-card-list">
                  <div>{Array.isArray((discoveryGuide.executiveInterviewGuide as { questions?: string[] } | undefined)?.questions) ? (discoveryGuide.executiveInterviewGuide as { questions: string[] }).questions.length : 0} executive interview prompts</div>
                  <div>{Array.isArray((discoveryGuide.operationalInterviewGuide as { questions?: string[] } | undefined)?.questions) ? (discoveryGuide.operationalInterviewGuide as { questions: string[] }).questions.length : 0} operational interview prompts</div>
                  <div>{Array.isArray((discoveryGuide.documentRequestList as string[] | undefined)) ? (discoveryGuide.documentRequestList as string[]).length : 0} requested documents</div>
                </div>
              ) : (
                <div className="v3-mini-card-empty">Generate interview guides, workshop agenda, and document request list for discovery.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" disabled={agentButtonDisabled("discovery-guide-generator")} onClick={() => onRunAgent("discovery-guide-generator")}>
                {agentButtonContent("discovery-guide-generator", discoveryGuide ? "Re-generate discovery pack" : "Generate discovery pack")}
              </button>
            </div>
          ) : null}

          {activePhase.id === "build" ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Sprint plan</div>
              {Array.isArray(sprintPlan?.sprints) && sprintPlan.sprints.length ? (
                <div className="v3-mini-card-list">
                  {(sprintPlan.sprints as Array<{ sprintNumber?: number; goal?: string; startDate?: string; endDate?: string }>).slice(0, 3).map((sprint, index) => (
                    <div key={index}>
                      <strong>Sprint {sprint.sprintNumber || index + 1}:</strong> {sprint.goal || "Goal forming"} {sprint.startDate ? `(${formatShortDate(sprint.startDate)} → ${formatShortDate(sprint.endDate)})` : ""}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">Plan build sprints from milestones, capacity, and workstreams.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" disabled={agentButtonDisabled("sprint-planner")} onClick={() => onRunAgent("sprint-planner")}>
                {agentButtonContent("sprint-planner", sprintPlan ? "Re-plan sprints" : "Generate sprint plan")}
              </button>
            </div>
          ) : null}

          {activePhase.id === "strategy" ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">KPI validation</div>
              {kpiValidation?.validatedKPIs?.length ? (
                <div className="v3-mini-card-list">
                  <span className={`v3-chip ${Number(kpiValidation.avgScore || 0) >= 80 ? "green" : Number(kpiValidation.avgScore || 0) >= 60 ? "amber" : "red"}`}>Average SMART score {Math.round(Number(kpiValidation.avgScore || 0))}%</span>
                  {kpiValidation.validatedKPIs.slice(0, 2).map((kpi, index) => (
                    <div key={index}>
                      {kpi.original}
                      {kpi.gaps?.length ? <div className="v3-mini-card-subcopy">Gaps: {kpi.gaps.join(", ")}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">Check whether your success metrics are truly SMART and measurable.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" disabled={agentButtonDisabled("kpi-validator")} onClick={() => onRunAgent("kpi-validator")}>
                {agentButtonContent("kpi-validator", kpiValidation ? "Re-validate KPIs" : "Validate KPIs")}
              </button>
            </div>
          ) : null}

          {["mobilise", "build"].includes(activePhase.id) ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Capacity</div>
              {capacityAssessment ? (
                <div className="v3-mini-card-list">
                  <span className={`v3-chip ${capacityAssessment.overallAdequacy === "sufficient" ? "green" : capacityAssessment.overallAdequacy === "at-risk" ? "amber" : "red"}`}>
                    {capacityAssessment.overallAdequacy} {Math.round(Number(capacityAssessment.adequacyScore || 0))}%
                  </span>
                  {(capacityAssessment.roleGaps || []).slice(0, 3).map((gap, index) => (
                    <div key={index}>
                      {gap.role}: have {gap.currentCount || 0}, need {gap.requiredCount || 0}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">Assess whether current capacity matches the work ahead.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" disabled={agentButtonDisabled("capacity-assessor")} onClick={() => onRunAgent("capacity-assessor")}>
                {agentButtonContent("capacity-assessor", capacityAssessment ? "Re-assess capacity" : "Assess capacity")}
              </button>
            </div>
          ) : null}

          {["design", "govern"].includes(activePhase.id) ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Compliance gaps</div>
              {complianceCheck?.gaps?.length ? (
                <div className="v3-mini-card-list">
                  {complianceCheck.gaps.slice(0, 3).map((gap, index) => (
                    <div key={index}>
                      <span className={`v3-chip ${gap.severity === "critical" ? "red" : gap.severity === "high" ? "amber" : "muted"}`} style={{ marginRight: 6 }}>{gap.framework} {gap.articleId}</span>
                      {gap.gap}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">Check for framework-specific compliance gaps before governance sign-off.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" disabled={agentButtonDisabled("compliance-checker")} onClick={() => onRunAgent("compliance-checker")}>
                {agentButtonContent("compliance-checker", complianceCheck ? "Re-check compliance" : "Run compliance check")}
              </button>
            </div>
          ) : null}

          {["design", "build", "operate"].includes(activePhase.id) ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Vendor risk</div>
              {vendorRiskAssessment?.vendorAssessments?.length ? (
                <div className="v3-mini-card-list">
                  {vendorRiskAssessment.vendorAssessments.slice(0, 3).map((vendor, index) => (
                    <div key={index}>
                      <strong>{vendor.vendorName}</strong> · {Math.round(Number(vendor.riskScore || 0))}% risk · {vendor.dependencyCriticality}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="v3-mini-card-empty">Assess vendor and partner dependency risk for this phase.</div>
              )}
              <button type="button" className="v3-button ghost v3-mini-card-action" disabled={agentButtonDisabled("vendor-risk-assessor")} onClick={() => onRunAgent("vendor-risk-assessor")}>
                {agentButtonContent("vendor-risk-assessor", vendorRiskAssessment ? "Re-assess vendor risk" : "Assess vendor risk")}
              </button>
            </div>
          ) : null}

          {showRetro ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Retrospective</div>
              <div className="v3-mini-card-empty">
                This phase is nearly complete. Capture learnings.
              </div>
              <button
                type="button"
                className="v3-button ghost v3-mini-card-action"
                disabled={isRetroRunning}
                onClick={() => triggers.triggerRetro(activePhase.id)}
              >
                {isRetroRunning ? "Preparing…" : "Generate retrospective"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* RIGHT — artifacts card */}
      <section className="v3-phase-col v3-phase-col--artifacts" id="phase-artifacts-anchor" style={{ borderBottom: "none" }}>
        <div className="v3-zone-label">
          Artifacts
          {phaseArtifacts.required > 0 ? (
            <span className={`v3-zone-label-meta ${phaseArtifacts.present === phaseArtifacts.required ? "is-complete" : ""}`}>
              {phaseArtifacts.present}/{phaseArtifacts.required} produced
            </span>
          ) : null}
        </div>
        {phaseArtifacts.required > 0 ? (
          missingRequiredArtifacts.length ? (
            <div className="v3-artifact-summary is-missing">
              <span className="v3-chip amber v3-chip-tight">{missingRequiredArtifacts.length} required missing</span>
            </div>
          ) : (
            <div className="v3-artifact-summary is-complete">
              <span className="v3-chip green v3-chip-tight">All required produced</span>
            </div>
          )
        ) : null}
        <div className="v3-output-strip">
          {/* Narrative — phase synthesis, with inline preview */}
          <button
            type="button"
            data-io-anchor="artifact:narrative"
            className={`v3-chip ${artifactPreviews?.narrative ? (narrativeQuality ? (narrativeQuality.score >= 80 ? "green" : narrativeQuality.score >= 60 ? "blue" : "amber") : "blue") : "muted"} ${expandedOutput === "narrative" ? "is-active" : ""}`}
            onClick={() => { if (artifactPreviews?.narrative) toggleOutput("narrative"); else onRunAgent("narrative"); }}
            aria-expanded={artifactPreviews?.narrative ? expandedOutput === "narrative" : undefined}
          >
            <span>Narrative{narrativeQuality ? ` ${narrativeQuality.score}%` : ""}</span>
            {artifactPreviews?.narrative
              ? <span className="v3-output-toggle-glyph">{expandedOutput === "narrative" ? "▴" : "▾"}</span>
              : <span className="v3-artifact-row-status muted">Generate</span>}
          </button>

          {showRetro ? (
            <button type="button" className="v3-chip muted" disabled={isRetroRunning} onClick={() => triggers.triggerRetro(activePhase.id)}>
              {isRetroRunning ? "Preparing…" : "Retrospective"}
            </button>
          ) : null}

          {getPhaseArtifactDefs(activePhase.id)
            .filter((def) => def.id !== "narrative")
            .map((def) => {
              const node = phaseArtifacts.byKey.get(def.id);
              const required = !!node;
              const present = !!node?.present;
              const state = node?.state ?? "missing";
              const score = typeof node?.quality === "number" ? node.quality : null;
              const statusLabel = !present
                ? "Missing"
                : state === "approved" ? "Approved"
                : state === "ready" ? "Ready"
                : state === "archived" ? "Archived"
                : "Draft";
              const statusTone = !present
                ? "muted"
                : state === "approved" ? "green"
                : state === "ready" ? "blue"
                : state === "archived" ? "muted"
                : "amber";
              const summary = present
                ? def.description
                : required
                  ? `Required for this phase, not yet generated. ${def.description}`
                  : `Optional. ${def.description}`;
              const artifactId = node?.artifactId ?? null;
              const stringContent = artifactId ? phaseArtifactContentById.get(artifactId) ?? null : null;
              // Formal document artifacts (charter, business case, etc.) store their
              // body as a structured object at the top level of program data, not as
              // a string in phaseArtifacts — resolve and format it as a fallback.
              const previewContent = (stringContent && stringContent.trim())
                ? stringContent
                : getFormalArtifactContent(source, def.id);
              const isExpanded = expandedOutput === def.id;
              const preflight = runPreFlight(activePhase.id, preFlightInputs);
              const inputsIncomplete = !preflight.pass;
              return (
                <div key={def.id} className="v3-artifact-row" data-io-anchor={`artifact:${def.id}`}>
                  <div className="v3-artifact-row-head">
                    <span className="v3-artifact-row-label">{def.label}</span>
                    <span className={`v3-chip ${statusTone}`} style={{ flex: "0 0 auto" }}>
                      {statusLabel}{present && score != null ? ` · ${score}%` : ""}
                    </span>
                  </div>
                  <p className="v3-artifact-row-desc">{summary}</p>
                  {inputsIncomplete ? (
                    <div className="v3-artifact-preflight">
                      <span className="v3-chip amber v3-chip-tight">Needs: {preflight.missingFields.join(" · ")}</span>
                      <button
                        type="button"
                        className="v3-button ghost v3-button-inline-xs"
                        onClick={() => document.getElementById("phase-inputs-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      >
                        Add inputs →
                      </button>
                    </div>
                  ) : null}
                  <div className="v3-artifact-row-actions">
                  {present && previewContent ? (
                    <button
                      type="button"
                      className="v3-button ghost v3-button-inline-xs"
                      onClick={() => toggleOutput(def.id)}
                      aria-expanded={isExpanded}
                      title={isExpanded ? `Hide ${def.label}` : `Preview ${def.label}`}
                    >
                      {isExpanded ? "▴ Hide" : "▾ Preview"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="v3-button ghost v3-button-inline-xs v3-artifact-regen"
                    onClick={() => onRunAgent(def.id)}
                    disabled={agentButtonDisabled(def.id)}
                    title={inputsIncomplete
                      ? `${present ? "Regenerate" : "Generate"} ${def.label} — missing inputs may limit quality: ${preflight.missingFields.join(", ")}`
                      : present ? `Regenerate ${def.label}` : `Generate ${def.label}`}
                  >
                    {agentButtonContent(def.id, present ? "↻ Regenerate" : "Generate")}
                  </button>
                  </div>
                  {isExpanded && previewContent ? (
                    <div className="v3-output-preview" style={{ marginTop: 8 }}>
                      <div className="v3-output-preview-head">
                        <div>
                          <div className="v3-output-preview-label">{def.label}</div>
                          {def.description ? (
                            <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
                              {def.description}
                            </div>
                          ) : null}
                        </div>
                        {score != null ? (
                          <span className={`v3-chip ${statusTone}`}>Quality {score}%</span>
                        ) : null}
                      </div>
                      <AnimatedArtifactContent content={previewContent} />
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
        {!artifactPreviews?.narrative && !artifactPreviews?.deck && !expandedOutput ? (
          <div className="v3-output-empty-hint" style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 10, padding: "0 2px" }}>
            {activePhase?.id === "strategy"
              ? "Generate your transformation strategy document"
              : activePhase?.id === "build"
              ? "Generate milestone tracking for delivery progress"
              : "Generate your first artifact for this phase to get started"}
          </div>
        ) : null}
        {expandedOutput === "narrative" && artifactPreviews?.narrative ? (
          <div className="v3-output-preview">
            {updatedArtifactId === "narrative" ? (
              <div className="v3-artifact-update-banner">
                <div>
                  <div className="v3-artifact-update-banner-title">This artifact was updated</div>
                  <div className="v3-artifact-update-banner-copy">Review the refreshed narrative before sharing or editing it.</div>
                </div>
                <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setUpdatedArtifactId(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}
            {editingArtifact === "narrative" ? (
              <ArtifactEditor
                label="Narrative"
                content={artifactPreviews.narrative}
                generatedAt={generatedAt}
                onSave={(content) => onSaveArtifact("narrative", content)}
                onClose={() => setEditingArtifact(null)}
              />
            ) : (
              <>
                <div className="v3-output-preview-head">
                  <div>
                    <div className="v3-output-preview-label">Narrative</div>
                    {ARTIFACT_DESCRIPTIONS["narrative"] && (
                      <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
                        {ARTIFACT_DESCRIPTIONS["narrative"]}
                      </div>
                    )}
                  </div>
                  {narrativeQuality ? (
                    <span className={`v3-chip ${narrativeQuality.score >= 80 ? "green" : narrativeQuality.score >= 60 ? "blue" : "amber"}`}>
                      Quality {narrativeQuality.score}%
                    </span>
                  ) : null}
                </div>
                <AnimatedArtifactContent content={artifactPreviews.narrative} />
                {narrativeQuality?.improvements?.length ? (
                  <div className="v3-output-improvements">
                    <div className="v3-output-improvements-label">Suggested improvements</div>
                    {narrativeQuality.improvements.map((item, index) => (
                      <div key={`${item}-${index}`} className="v3-output-improvements-item">· {item}</div>
                    ))}
                  </div>
                ) : null}
                <div className="v3-output-actions">
                  <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setEditingArtifact("narrative")}>
                    ✎ Edit
                  </button>
                  <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => onOpenReport("narrative")}>
                    Open full →
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
        {expandedOutput === "deck" && artifactPreviews?.deck ? (
          <div className="v3-output-preview">
            {updatedArtifactId === "deck" ? (
              <div className="v3-artifact-update-banner">
                <div>
                  <div className="v3-artifact-update-banner-title">This artifact was updated</div>
                  <div className="v3-artifact-update-banner-copy">The status deck summary has changed based on the latest programme state.</div>
                </div>
                <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setUpdatedArtifactId(null)}>
                  Dismiss
                </button>
              </div>
            ) : null}
            {editingArtifact === "deck" ? (
              <ArtifactEditor
                label="Status deck"
                content={artifactPreviews.deck}
                generatedAt={generatedAt}
                onSave={(content) => onSaveArtifact("deck", content)}
                onClose={() => setEditingArtifact(null)}
              />
            ) : (
              <>
                <div className="v3-output-preview-head">
                  <div>
                    <div className="v3-output-preview-label">Status deck</div>
                    {ARTIFACT_DESCRIPTIONS["deck"] && (
                      <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
                        {ARTIFACT_DESCRIPTIONS["deck"]}
                      </div>
                    )}
                  </div>
                  {deckQuality ? (
                    <span className={`v3-chip ${deckQuality.score >= 80 ? "green" : deckQuality.score >= 60 ? "blue" : "amber"}`}>
                      Quality {deckQuality.score}%
                    </span>
                  ) : null}
                </div>
                <AnimatedArtifactContent content={artifactPreviews.deck} />
                {deckQuality?.improvements?.length ? (
                  <div className="v3-output-improvements">
                    <div className="v3-output-improvements-label">Suggested improvements</div>
                    {deckQuality.improvements.map((item, index) => (
                      <div key={`${item}-${index}`} className="v3-output-improvements-item">· {item}</div>
                    ))}
                  </div>
                ) : null}
                <div className="v3-output-actions">
                  <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => setEditingArtifact("deck")}>
                    ✎ Edit
                  </button>
                  <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => onOpenReport("deck")}>
                    Open full →
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>
      </div>
      </div>
    </div>
  );
}
