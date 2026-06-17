import React, { useEffect, useMemo, useRef } from "react";
import { getRiskTrend } from "@/lib/adamGateRisk";
import type { AgentRun } from "@/lib/adamSync";
import type { ExitCriterion, GateReview, ProgramSummary } from "@/new/types";
import ArtifactEditor from "@/v3/components/ArtifactEditor";
import PhaseInputsPanel, { type FieldAssistRequest } from "@/v3/components/PhaseInputsPanel";
import PhaseFlowOverlay from "@/v3/components/PhaseFlowOverlay";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { PhaseRail } from "@/v3/components/PhaseRail";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { derivePhaseBlockers } from "@/v3/lib/phaseBlockers";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { ExpandableSection } from "@/v3/components/ui/ExpandableSection";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import { computePhaseReadiness } from "@/v3/lib/phaseReadiness";
import { buildPhaseArtifacts } from "@/v3/lib/artifactModel";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { runPreFlight } from "@/v3/lib/phaseInputPreFlight";
import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";
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
  onAddItem?: (tab: "blockers" | "risks" | "actions") => void;
  onOpenReport: (reportId: V3ReportId) => void;
  onReopenGate: (phaseId: string) => void;
  onRunAgent: (agentId: string) => void;
  onSaveArtifact: (artifactId: "narrative" | "deck", content: string) => Promise<void>;
  onApproveArtifact: (phaseId: string, artifactId: string) => Promise<void>;
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

interface ArtifactQualityIssue {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

// Deterministic, signal-grounded quality assessment for a produced artifact.
// Combines the AI quality score, the phase inputs the document still lacks, any
// model-suggested improvements, and approval state into a concrete punch list —
// no extra model call, so the "Improve quality" modal can only ever name real,
// actionable gaps for this artifact.
function deriveArtifactQualityIssues(opts: {
  score: number | null;
  state: string;
  missingInputs: string[];
  improvements?: string[];
}): ArtifactQualityIssue[] {
  const { score, state, missingInputs, improvements } = opts;
  const issues: ArtifactQualityIssue[] = [];
  if (typeof score === "number") {
    if (score < 60) {
      issues.push({ severity: "high", title: `Low quality score — ${score}%`, detail: "ATOS rated this document below the quality bar. Regenerate it with richer phase inputs to lift the score." });
    } else if (score < 80) {
      issues.push({ severity: "medium", title: `Quality score ${score}% — room to improve`, detail: "The document is usable but ATOS sees headroom. Add detail to the phase inputs and regenerate." });
    }
  }
  if (missingInputs.length) {
    issues.push({ severity: "medium", title: `${missingInputs.length} input${missingInputs.length > 1 ? "s" : ""} missing`, detail: `Add these phase inputs to strengthen the next generation: ${missingInputs.join(", ")}.` });
  }
  for (const improvement of improvements ?? []) {
    if (improvement && improvement.trim()) issues.push({ severity: "low", title: "Suggested improvement", detail: improvement.trim() });
  }
  if (state !== "approved" && state !== "archived") {
    issues.push({ severity: "low", title: "Not yet approved", detail: "Review the document and approve it to lock this artifact and run the gate check." });
  }
  return issues;
}

function StageModal({ title, onClose, children, maxWidth = 560 }: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--v3-surface)", borderRadius: "var(--v3-radius)", border: "1px solid var(--v3-border)", maxWidth, width: "100%", maxHeight: "82vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.4)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--v3-border-soft)", position: "sticky", top: 0, background: "var(--v3-surface)", zIndex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--v3-text-primary)" }}>{title}</div>
          <button type="button" className="v3-button ghost v3-button-inline-xs" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
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

function ExitCriteriaCard({
  criteria,
  generatedCriteria,
  gateApproved = false,
}: {
  criteria: ExitCriterion[];
  generatedCriteria: Array<{ criterion: string; category: string; owner: string; mandatory: boolean }>;
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
        {!display.length ? null : mandatoryUnmet.length > 0 ? (
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
          description="ATOS drafts exit criteria automatically as this phase's artifacts are generated. Review and confirm them here once they appear."
          compact
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

/** Render inline **bold** spans within a markdown-lite line. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) return <strong key={`${keyPrefix}-b${i}`} className="v3-doc-label">{m[1]}</strong>;
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{part}</React.Fragment>;
  });
}

type DocBlock =
  | { kind: "h2" | "h3" | "p"; text: string }
  | { kind: "ul"; items: { text: string; depth: number }[] };

/** Parse markdown-lite (## / ### / - bullets / paragraphs) into typed blocks. */
function parseDoc(content: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const lines = content.replace(/\r/g, "").split("\n");
  let list: { text: string; depth: number }[] | null = null;
  const flush = () => { if (list && list.length) blocks.push({ kind: "ul", items: list }); list = null; };

  for (const raw of lines) {
    if (!raw.trim()) { flush(); continue; }
    const bullet = raw.match(/^(\s*)- (.*)$/);
    if (bullet) {
      const depth = Math.floor(bullet[1].replace(/\t/g, "  ").length / 2);
      (list ??= []).push({ text: bullet[2], depth });
      continue;
    }
    flush();
    const trimmed = raw.trim();
    if (trimmed.startsWith("## ")) blocks.push({ kind: "h2", text: trimmed.slice(3) });
    else if (trimmed.startsWith("### ")) blocks.push({ kind: "h3", text: trimmed.slice(4) });
    else blocks.push({ kind: "p", text: trimmed });
  }
  flush();
  return blocks;
}

function DocBlockView({ block, keyPrefix }: { block: DocBlock; keyPrefix: string }) {
  if (block.kind === "h2") return <h2 className="v3-doc-h2">{renderInline(block.text, keyPrefix)}</h2>;
  if (block.kind === "h3") return <h3 className="v3-doc-h3">{renderInline(block.text, keyPrefix)}</h3>;
  if (block.kind === "p") return <p className="v3-doc-p">{renderInline(block.text, keyPrefix)}</p>;
  return (
    <ul className="v3-doc-ul">
      {block.items.map((it, i) => (
        <li key={`${keyPrefix}-li${i}`} className="v3-doc-li" data-depth={Math.min(it.depth, 4)}>
          {renderInline(it.text, `${keyPrefix}-li${i}`)}
        </li>
      ))}
    </ul>
  );
}

function AnimatedArtifactContent({ content }: { content: string }) {
  const sections = content.split("\n\n").map((section) => section.trim()).filter(Boolean);

  if (sections.length === 0) {
    return <div className="v3-output-preview-body v3-output-preview-body--doc" />;
  }

  return (
    <div className="v3-output-preview-body v3-output-preview-body--doc v3-output-preview-body--animated">
      {sections.map((section, index) => (
        <div
          key={`${section.slice(0, 32)}-${index}`}
          className="v3-output-preview-section"
          style={{ animationDelay: `${index * 70}ms` }}
        >
          {parseDoc(section).map((block, bi) => (
            <DocBlockView key={`s${index}-b${bi}`} block={block} keyPrefix={`s${index}-b${bi}`} />
          ))}
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
  onAddItem,
  onOpenReport,
  onReopenGate,
  onRunAgent,
  onSaveArtifact,
  onApproveArtifact,
  onSaveInputs,
  onUploadDocument,
  onAssistField,
  artifactPreviews,
}: StageViewProps) {
  const [expandedOutput, setExpandedOutput] = React.useState<string | null>(null);
  const [editingArtifact, setEditingArtifact] = React.useState<"narrative" | "deck" | null>(null);
  const [updatedArtifactId, setUpdatedArtifactId] = React.useState<"narrative" | "deck" | null>(null);
  const [exitCriteriaOpen, setExitCriteriaOpen] = React.useState(false);
  const [previewArtifact, setPreviewArtifact] = React.useState<{ label: string; description?: string; content: string; score: number | null; statusTone: string } | null>(null);
  const [qualityArtifact, setQualityArtifact] = React.useState<{ label: string; defId: string; score: number | null; issues: ArtifactQualityIssue[] } | null>(null);
  const phaseMainRef = useRef<HTMLDivElement | null>(null);
  const previousDeckRef = useRef<string | null>(artifactPreviews?.deck || null);
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
  // Same canonical action queue the rail and Action Center count, so the
  // Programme screen never shows two different "open" numbers for one phase.
  const stageDecisions = deriveOpenRecommendedActions(program, "delivery_lead")
    .filter((decision) => !decision.phaseId || decision.phaseId === activePhase?.id);
  // Canonical phase blocker + risk counts for the header metric strip — same
  // engine the right-rail Blockers tab reads from, so the numbers never disagree.
  const phaseBlockers = useMemo(() => derivePhaseBlockers(program, activePhase?.id ?? ""), [program, activePhase?.id]);
  const phaseRiskCount = useMemo(
    () => (program?.raidEntries || []).filter((e) => e.phase === activePhase?.id && e.status !== "closed" && e.type === "risk").length,
    [program?.raidEntries, activePhase?.id],
  );
  const phaseRationale = program?.plan?.nextThreeActions?.find((action) => action.phase === activePhase?.id)?.rationale || "";
  const verdict = firstSentence(
    activePhase?.objective ||
    phaseRationale ||
    program?.plan?.summary ||
    program?.narrative ||
    ""
  );
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
  // Schema-grounded, deterministic input-quality assessment. Derived from the
  // phase's declared input fields (the single source of truth), so the banner's
  // "Missing:" list can only ever name inputs that genuinely belong to this
  // phase — never spurious items like workstreams on Strategy.
  const inputQuality = useMemo(() => {
    const bucket = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
      ? (source.phaseInputs as Record<string, unknown>)[activePhase?.id ?? ""]
      : null;
    const inputs = bucket && typeof bucket === "object" && !Array.isArray(bucket)
      ? (bucket as Record<string, unknown>)
      : {};
    return derivePhaseInputQuality(activePhase?.id, inputs);
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
  const handoffQuality = source?.handoffQuality && typeof source.handoffQuality === "object" && !Array.isArray(source.handoffQuality)
    ? (source.handoffQuality as Record<string, unknown>)[activePhase?.id || ""] as { score?: number; passed?: boolean } | undefined
    : undefined;
  const deckQuality = source?.deckQuality && typeof source.deckQuality === "object" && !Array.isArray(source.deckQuality)
    ? source.deckQuality as { score: number; improvements?: string[] }
    : null;
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
  const discoveryGuide = source?.discoveryGuide && typeof source.discoveryGuide === "object" && !Array.isArray(source.discoveryGuide)
    ? source.discoveryGuide as Record<string, unknown>
    : null;
  const sprintPlan = source?.sprintPlan && typeof source.sprintPlan === "object" && !Array.isArray(source.sprintPlan)
    ? source.sprintPlan as Record<string, unknown>
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
  // Pre-flight input gating: the captured inputs for this phase, normalised for
  // runPreFlight so each artifact row can warn (before a ~90s run that would burn
  // provider quota) when the producing agent's required inputs are missing.
  const preFlightInputs = useMemo<Record<string, unknown>>(() => (
    phaseInputs && typeof phaseInputs === "object" && !Array.isArray(phaseInputs)
      ? phaseInputs as Record<string, unknown>
      : {}
  ), [phaseInputs]);
  const gateApproved = gateReviewStatus === "approved";

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

  // Phase-specific agent actions — consolidated into the header so the workspace
  // below shows only generated results, never a wall of "Generate X" buttons.
  const phaseAgentActions: Array<{ key: string; label: React.ReactNode; disabled: boolean; onClick: () => void }> = [];
  if (activePhase.id === "discover") {
    phaseAgentActions.push({ key: "discovery-guide-generator", label: agentButtonContent("discovery-guide-generator", discoveryGuide ? "Re-generate discovery pack" : "Generate discovery pack"), disabled: agentButtonDisabled("discovery-guide-generator"), onClick: () => onRunAgent("discovery-guide-generator") });
  }
  if (activePhase.id === "build") {
    phaseAgentActions.push({ key: "sprint-planner", label: agentButtonContent("sprint-planner", sprintPlan ? "Re-plan sprints" : "Generate sprint plan"), disabled: agentButtonDisabled("sprint-planner"), onClick: () => onRunAgent("sprint-planner") });
  }
  if (["mobilise", "build"].includes(activePhase.id)) {
    phaseAgentActions.push({ key: "capacity-assessor", label: agentButtonContent("capacity-assessor", capacityAssessment ? "Re-assess capacity" : "Assess capacity"), disabled: agentButtonDisabled("capacity-assessor"), onClick: () => onRunAgent("capacity-assessor") });
  }
  if (["design", "govern"].includes(activePhase.id)) {
    phaseAgentActions.push({ key: "compliance-checker", label: agentButtonContent("compliance-checker", complianceCheck ? "Re-check compliance" : "Run compliance check"), disabled: agentButtonDisabled("compliance-checker"), onClick: () => onRunAgent("compliance-checker") });
  }
  if (["design", "build", "operate"].includes(activePhase.id)) {
    phaseAgentActions.push({ key: "vendor-risk-assessor", label: agentButtonContent("vendor-risk-assessor", vendorRiskAssessment ? "Re-assess vendor risk" : "Assess vendor risk"), disabled: agentButtonDisabled("vendor-risk-assessor"), onClick: () => onRunAgent("vendor-risk-assessor") });
  }
  if (showRetro) {
    phaseAgentActions.push({ key: "retro", label: isRetroRunning ? "Preparing…" : "Generate retrospective", disabled: isRetroRunning, onClick: () => triggers.triggerRetro(activePhase.id) });
  }

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
            <PhaseStatusRings program={program} phaseId={activePhase.id} size={116} showCenter />
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

        {/* Key metrics — the gate pipeline (inputs → quality → artifacts → quality → gate)
            in workflow order with chevrons between stages, then a separated work-count
            group (blockers/risks/actions). Each tile clicks through to its detail. */}
        {readiness ? (() => {
          const inputsComplete = inputQuality && inputQuality.total > 0
            ? Math.round((inputQuality.present / inputQuality.total) * 100)
            : readiness.inputScore;
          const artifactsComplete = phaseArtifacts.required > 0
            ? Math.round((phaseArtifacts.present / phaseArtifacts.required) * 100)
            : readiness.artifactScore;
          const pctTone = (v: number) => (v >= 75 ? "green" : v >= 50 ? "amber" : "red");
          // The gate pipeline, in the order work flows toward the gate.
          const pipeline: Array<{ label: string; value: string | number; tone: string; anchor?: string | null; onClick?: () => void }> = [
            { label: "Inputs complete", value: `${inputsComplete}%`, tone: pctTone(inputsComplete), anchor: "phase-inputs-anchor" },
            { label: "Input quality", value: inputQuality ? `${inputQuality.overallScore}%` : "—", tone: inputQuality ? pctTone(inputQuality.overallScore) : "", anchor: "phase-inputs-anchor" },
            { label: "Artifacts complete", value: `${artifactsComplete}%`, tone: pctTone(artifactsComplete), anchor: "phase-artifacts-anchor" },
            { label: "Artifact quality", value: `${readiness.artifactScore}%`, tone: pctTone(readiness.artifactScore), anchor: "phase-artifacts-anchor" },
            { label: "Gate score", value: readiness.gateScore != null ? `${readiness.gateScore}%` : "—", tone: readiness.gateScore != null ? pctTone(readiness.gateScore) : "", onClick: () => setExitCriteriaOpen(true) },
          ];
          // Live work counts — distinct from the pipeline, shown as a separated group.
          // Each carries an `addTab` so the "+ Add" button under it opens the right
          // Action Center add form.
          const work: Array<{ label: string; value: string | number; tone: string; anchor?: string | null; onClick?: () => void; addTab: "blockers" | "risks" | "actions" }> = [
            { label: "Blockers", value: phaseBlockers.length, tone: phaseBlockers.length ? "red" : "green", onClick: () => onOpenMoreView("risks"), addTab: "blockers" },
            { label: "Risks", value: phaseRiskCount, tone: phaseRiskCount ? "amber" : "", onClick: () => onOpenMoreView("risks"), addTab: "risks" },
            { label: "Actions", value: stageDecisions.length, tone: stageDecisions.length ? "amber" : "", onClick: onOpenDecide, addTab: "actions" },
          ];
          const renderMetric = (metric: { label: string; value: string | number; tone: string; anchor?: string | null; onClick?: () => void }) => {
            const cls = `v3-phase-metric-value ${metric.tone}`;
            const handler = metric.onClick
              ? metric.onClick
              : metric.anchor
              ? () => document.getElementById(metric.anchor!)?.scrollIntoView({ behavior: "smooth", block: "center" })
              : null;
            if (!handler) {
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
                aria-label={`${metric.label} ${metric.value} — open detail`}
                onClick={handler}
              >
                <div className={cls}>{metric.value}</div>
                <div className="v3-phase-metric-label">{metric.label}</div>
              </button>
            );
          };
          return (
            <div className="v3-phase-metrics">
              <div className="v3-phase-pipeline" role="group" aria-label="Gate readiness pipeline">
                {pipeline.map((metric, i) => {
                  const isGate = i === pipeline.length - 1;
                  const isArtifactQuality = metric.label === "Artifact quality";
                  const isInputsComplete = metric.label === "Inputs complete";
                  return (
                    <React.Fragment key={metric.label}>
                      {i > 0 ? <span className="v3-phase-pipeline-chevron" aria-hidden="true">›</span> : null}
                      {isInputsComplete ? (
                        <div className="v3-phase-gate-col">
                          {renderMetric(metric)}
                          <button
                            type="button"
                            className="v3-button ghost v3-button-inline-xs v3-phase-gate-recheck"
                            aria-label="Attach a document to bootstrap inputs"
                            onClick={onUploadDocument}
                          >
                            Attach doc
                          </button>
                        </div>
                      ) : isGate ? (
                        <div className="v3-phase-gate-col">
                          {renderMetric(metric)}
                          {gateReview ? (
                            <button
                              type="button"
                              className="v3-button ghost v3-button-inline-xs v3-phase-gate-recheck"
                              disabled={isGateRunning}
                              title="ATOS re-checks gate readiness automatically after each document is generated — use this only to force a manual refresh."
                              onClick={() => triggers.triggerGateReview(activePhase.id)}
                            >
                              {isGateRunning ? "Checking…" : "Re-check"}
                            </button>
                          ) : null}
                        </div>
                      ) : isArtifactQuality ? (
                        <div className="v3-phase-gate-col">
                          {renderMetric(metric)}
                          <button
                            type="button"
                            className="v3-button ghost v3-button-inline-xs v3-phase-gate-recheck"
                            aria-label="Open exit criteria"
                            onClick={() => setExitCriteriaOpen(true)}
                          >
                            Exit criteria
                          </button>
                        </div>
                      ) : (
                        renderMetric(metric)
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              <span className="v3-phase-metrics-divider" aria-hidden="true" />
              <div className="v3-phase-metric-group" role="group" aria-label="Open work items">
                {work.map((metric) => (
                  onAddItem ? (
                    <div key={metric.label} className="v3-phase-work-col">
                      {renderMetric(metric)}
                      <button
                        type="button"
                        className="v3-button ghost v3-button-inline-xs v3-phase-work-add"
                        aria-label={`Add ${metric.label.replace(/s$/, "").toLowerCase()}`}
                        onClick={() => onAddItem(metric.addTab)}
                      >
                        + Add
                      </button>
                    </div>
                  ) : (
                    renderMetric(metric)
                  )
                ))}
              </div>
            </div>
          );
        })() : null}

        {/* Moved actions — gate decisions + artifact / nav jumps */}
        <div className="v3-phase-head-actions">
          {gateReviewStatus === "approved" ? (
            <div className="v3-phase-head-actions-grp">
              <button type="button" className="v3-button ghost v3-button-inline-xs" onClick={() => onReopenGate(activePhase.id)}>Reopen Gate</button>
            </div>
          ) : null}
          {phaseAgentActions.length ? (
            <div className="v3-phase-head-actions-grp">
              {phaseAgentActions.map((action) => (
                <button key={action.key} type="button" className="v3-button ghost v3-button-inline-sm" disabled={action.disabled} onClick={action.onClick}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

      </header>

      <div className="v3-phase-body">

      <div className="v3-workspace-divider" role="separator" aria-label="Phase workspace">
        <span className="v3-workspace-divider-label">Phase workspace</span>
      </div>

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
              locked={gateApproved}
            />
          </div>
        ) : null}
      </section>

      {/* MIDDLE — live connector lines pinned to the real input-field and
          artifact elements in the side columns (always shown). */}
      <section className="v3-phase-col v3-phase-col--map" aria-hidden="true" />

      {/* BELOW — other phase-relevant cards, stretched full-width and stacked */}
      <div className="v3-phase-cards">
        <div className="v3-zone-label">Phase insights</div>
        <div className="v3-phase-cards-grid">
          {activePhase.id === "discover" && discoveryGuide ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Discovery pack</div>
              <div className="v3-mini-card-list">
                <div>{Array.isArray((discoveryGuide.executiveInterviewGuide as { questions?: string[] } | undefined)?.questions) ? (discoveryGuide.executiveInterviewGuide as { questions: string[] }).questions.length : 0} executive interview prompts</div>
                <div>{Array.isArray((discoveryGuide.operationalInterviewGuide as { questions?: string[] } | undefined)?.questions) ? (discoveryGuide.operationalInterviewGuide as { questions: string[] }).questions.length : 0} operational interview prompts</div>
                <div>{Array.isArray((discoveryGuide.documentRequestList as string[] | undefined)) ? (discoveryGuide.documentRequestList as string[]).length : 0} requested documents</div>
              </div>
            </div>
          ) : null}

          {activePhase.id === "build" && Array.isArray(sprintPlan?.sprints) && sprintPlan.sprints.length ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Sprint plan</div>
              <div className="v3-mini-card-list">
                {(sprintPlan.sprints as Array<{ sprintNumber?: number; goal?: string; startDate?: string; endDate?: string }>).slice(0, 3).map((sprint, index) => (
                  <div key={index}>
                    <strong>Sprint {sprint.sprintNumber || index + 1}:</strong> {sprint.goal || "Goal forming"} {sprint.startDate ? `(${formatShortDate(sprint.startDate)} → ${formatShortDate(sprint.endDate)})` : ""}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {["mobilise", "build"].includes(activePhase.id) && capacityAssessment ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Capacity</div>
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
            </div>
          ) : null}

          {["design", "govern"].includes(activePhase.id) && complianceCheck?.gaps?.length ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Compliance gaps</div>
              <div className="v3-mini-card-list">
                {complianceCheck.gaps.slice(0, 3).map((gap, index) => (
                  <div key={index}>
                    <span className={`v3-chip ${gap.severity === "critical" ? "red" : gap.severity === "high" ? "amber" : "muted"}`} style={{ marginRight: 6 }}>{gap.framework} {gap.articleId}</span>
                    {gap.gap}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {["design", "build", "operate"].includes(activePhase.id) && vendorRiskAssessment?.vendorAssessments?.length ? (
            <div className="v3-card-sm v3-mini-card">
              <div className="v3-card-title v3-mini-card-title">Vendor risk</div>
              <div className="v3-mini-card-list">
                {vendorRiskAssessment.vendorAssessments.slice(0, 3).map((vendor, index) => (
                  <div key={index}>
                    <strong>{vendor.vendorName}</strong> · {Math.round(Number(vendor.riskScore || 0))}% risk · {vendor.dependencyCriticality}
                  </div>
                ))}
              </div>
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
                : state === "stale" ? "Stale — regenerate"
                : state === "ready" ? "Ready"
                : state === "archived" ? "Archived"
                : "Draft";
              const statusTone = !present
                ? "muted"
                : state === "approved" ? "green"
                : state === "stale" ? "red"
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
                  {/* For a produced artifact, the missing-input gaps live inside the
                      Improve quality modal (as actionable issues), not as a chip on the
                      card. Pre-generation we still nudge the user to add inputs first. */}
                  {inputsIncomplete && !present ? (
                    <div className="v3-artifact-preflight">
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
                      onClick={() => setPreviewArtifact({ label: def.label, description: def.description, content: previewContent, score, statusTone })}
                      title={`Preview ${def.label}`}
                    >
                      ▾ Preview
                    </button>
                  ) : null}
                  {present ? (
                    <button
                      type="button"
                      className="v3-button ghost v3-button-inline-xs"
                      onClick={() => setQualityArtifact({ label: def.label, defId: def.id, score, issues: deriveArtifactQualityIssues({ score, state, missingInputs: preflight.missingFields }) })}
                      title={`Review and improve the quality of ${def.label}`}
                    >
                      ✦ Improve quality
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
                  {present && artifactId && state !== "approved" && state !== "archived" ? (
                    <button
                      type="button"
                      className="v3-button primary v3-button-inline-xs v3-artifact-approve"
                      onClick={() => { void onApproveArtifact(activePhase.id, artifactId); }}
                      title={`Approve ${def.label} — approving the final document runs the gate check`}
                    >
                      ✓ Approve
                    </button>
                  ) : null}
                  </div>
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

      {exitCriteriaOpen ? (
        <div
          role="presentation"
          onClick={() => setExitCriteriaOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 500,
            background: "rgba(0,0,0,0.55)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Exit criteria — ${activePhase.label ?? activePhase.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--v3-surface)", borderRadius: "var(--v3-radius)",
              border: "1px solid var(--v3-border)", padding: 20, maxWidth: 560, width: "100%",
              maxHeight: "82vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <button
                type="button"
                className="v3-button ghost v3-button-inline-xs"
                aria-label="Close exit criteria"
                onClick={() => setExitCriteriaOpen(false)}
              >
                ✕
              </button>
            </div>
            <ExitCriteriaCard
              criteria={gateReview?.exitCriteriaStatus || []}
              generatedCriteria={generatedCriteria}
              gateApproved={gateApproved}
            />
          </div>
        </div>
      ) : null}

      {previewArtifact ? (
        <StageModal title={previewArtifact.label} onClose={() => setPreviewArtifact(null)} maxWidth={720}>
          {previewArtifact.description ? (
            <div style={{ fontSize: 12, color: "var(--v3-text-muted)", marginBottom: 12 }}>{previewArtifact.description}</div>
          ) : null}
          {previewArtifact.score != null ? (
            <div style={{ marginBottom: 12 }}>
              <span className={`v3-chip ${previewArtifact.statusTone}`}>Quality {previewArtifact.score}%</span>
            </div>
          ) : null}
          <AnimatedArtifactContent content={previewArtifact.content} />
        </StageModal>
      ) : null}

      {qualityArtifact ? (
        <StageModal title={`Improve quality — ${qualityArtifact.label}`} onClose={() => setQualityArtifact(null)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span className={`v3-chip ${qualityArtifact.score == null ? "muted" : qualityArtifact.score >= 80 ? "green" : qualityArtifact.score >= 60 ? "blue" : "amber"}`}>
              {qualityArtifact.score == null ? "Quality —" : `Quality ${qualityArtifact.score}%`}
            </span>
            <span style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>
              {qualityArtifact.issues.length
                ? `${qualityArtifact.issues.length} issue${qualityArtifact.issues.length > 1 ? "s" : ""} to address`
                : "No outstanding issues"}
            </span>
          </div>
          {qualityArtifact.issues.length ? (
            <ul className="v3-quality-issue-list">
              {qualityArtifact.issues.map((issue, index) => (
                <li key={index} className="v3-quality-issue">
                  <span className={`v3-chip v3-chip-tight ${issue.severity === "high" ? "red" : issue.severity === "medium" ? "amber" : "muted"}`}>{issue.severity}</span>
                  <div>
                    <div className="v3-quality-issue-title">{issue.title}</div>
                    <div className="v3-quality-issue-detail">{issue.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>
              ATOS found no outstanding quality issues for this artifact. You can still regenerate it to fold in the latest programme context.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button
              type="button"
              className="v3-button primary v3-button-inline-sm"
              disabled={agentButtonDisabled(qualityArtifact.defId)}
              onClick={() => { onRunAgent(qualityArtifact.defId); setQualityArtifact(null); }}
            >
              {agentButtonContent(qualityArtifact.defId, "↻ Regenerate to improve")}
            </button>
            <button
              type="button"
              className="v3-button ghost v3-button-inline-sm"
              onClick={() => { document.getElementById("phase-inputs-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); setQualityArtifact(null); }}
            >
              Add inputs →
            </button>
          </div>
        </StageModal>
      ) : null}
    </div>
  );
}
