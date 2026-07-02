import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { getRiskTrend } from "@/lib/adamGateRisk";
import type { AgentRun } from "@/lib/adamSync";
import type { ExitCriterion, GateReview, ProgramSummary } from "@/new/types";
import ArtifactEditor from "@/v3/components/ArtifactEditor";
import ArtifactCard, { type ArtifactCardModel, type ArtifactCardHandlers } from "@/v3/components/ArtifactCard";
import DiscoveryPackPanel, { type DiscoveryPack } from "@/v3/components/DiscoveryPackPanel";
import PhaseInputsPanel, { type FieldAssistRequest } from "@/v3/components/PhaseInputsPanel";
import PhaseFlowOverlay from "@/v3/components/PhaseFlowOverlay";
import PhaseStatusRings from "@/v3/components/PhaseStatusRings";
import { PhaseRail } from "@/v3/components/PhaseRail";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { selectBlockers, selectRisks } from "@/v3/lib/programRaid";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { ExpandableSection } from "@/v3/components/ui/ExpandableSection";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";
import { StatusBadge } from "@/v3/components/ui/StatusBadge";
import { computePhaseReadiness } from "@/v3/lib/phaseReadiness";
import { buildPhaseArtifacts, type ArtifactOrigin } from "@/v3/lib/artifactModel";
import { resolveArtifactReview, resolveArtifactQualityScore } from "@/v3/lib/artifactReview";
import { getPhaseArtifactDefs, type PhaseArtifactDef } from "@/v3/lib/phaseArtifacts";
import { getFillableArtifactInputFields, artifactReferenceSatisfied } from "@/v3/lib/phaseFlowEdges";
import { getPhaseInputSchema, isFieldRequiredForProgram, resolveRosterField, resolveStakeholderField, ROSTER_PHASE_ID, type GridColumn } from "@/v3/lib/phaseInputSchema";
import { parseRows, serializeRows, filledRowCount, type GridRow } from "@/v3/components/StructuredGrid";
import { readRaciMatrix, raciDeliveryRoles, rosterColumnKeys, missingRosterRoles, stakeholderColumnKeys } from "@/v3/lib/rosterRaci";
import { isFreeTextAssistField } from "@/v3/lib/fieldAssist";
import { getDynamicSchemaStore, canonicalArtifactId, artifactGeneratorAgentId } from "@/v3/lib/dynamicSchema";
import { getAgentMeta, SUPPORT_ARTIFACT_IDS } from "@/v3/lib/agentMeta";
import { runPreFlight } from "@/v3/lib/phaseInputPreFlight";
import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";
import { getFormalArtifactContent } from "@/v3/lib/formalArtifacts";
import { selectModelValidationFindings, getSemanticValidationMeta } from "@/v3/lib/crossArtifactValidation";
import {
  selectFindingsForArtifact,
  findingsToRecommendations,
  selfReportedGapRecommendations,
  groupRecommendationsByCategory,
  type RecommendationCategory,
} from "@/v3/lib/artifactRecommendations";
import ChangeRequestModal from "@/v3/components/ChangeRequestModal";
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
    triggerRetro: (phaseId: string) => void;
    retroRunningPhases: Set<string>;
  };
  onOpenMoreView: (view: V3MoreView) => void;
  onSelectPhase?: (phaseId: string) => void;
  onResolveDecision: (id: string, resolution: "approved" | "deferred" | "rejected" | "modified", modifiedContent?: string) => void | Promise<void>;
  onOpenDecide: () => void;
  onOpenDecideTab?: (tab: "blockers" | "risks" | "actions") => void;
  /** Open the right-rail Guidance tab (the quality tiles deep-link here). */
  onOpenGuidance?: () => void;
  onAddItem?: (tab: "blockers" | "risks" | "actions") => void;
  onOpenReport: (reportId: V3ReportId) => void;
  onReopenGate: (phaseId: string) => void;
  /** Raise a change request against a locked phase (controlled edit path). */
  onRaiseChangeRequest?: (phaseId: string, title: string, reason: string) => Promise<void> | void;
  onApproveGate: (phaseId: string) => Promise<boolean | void>;
  onRunAgent: (agentId: string, phaseId?: string, guidance?: string) => void;
  onSaveArtifact: (artifactId: "narrative" | "deck", content: string) => Promise<void>;
  onApproveArtifact: (phaseId: string, artifactId: string, agentId: string) => Promise<void>;
  onApproveAllArtifacts: (phaseId: string) => Promise<void>;
  onUnapproveArtifact: (phaseId: string, artifactId: string) => Promise<void>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; clearReviewDefId?: string; staleDefId?: string }) => Promise<void>;
  onSaveProgram?: (label?: string, kind?: "manual" | "lock") => Promise<void>;
  onRevertProgram?: (snapshotId: string) => Promise<void>;
  programSnapshots?: Array<{ id: string; label: string; kind: string; createdAt: string }>;
  onUploadDocument: () => void;
  /** Attach (or reattach) a document to a specific artifact slot in a phase. */
  onAttachArtifact?: (phaseId: string, defId: string, label: string, agentId: string) => void;
  /** Delete an attached document artifact from a phase. */
  onDeleteArtifact?: (phaseId: string, artifactId: string, defId: string) => Promise<void> | void;
  onAssistField?: (phaseId: string, request: FieldAssistRequest) => Promise<string>;
  artifactPreviews?: {
    narrative?: string | null;
    plan?: Array<{ action?: string; rationale?: string }> | null;
    deck?: string | null;
  };
}

/** A captured input value counts as filled when it carries real content — a
 *  non-blank string, or a grid with at least one filled row. Used to gate an
 *  artifact's Generate button on the inputs declared to flow into it. When the
 *  field is a grid, judge emptiness by row content (filledRowCount), so a "[]"
 *  or blank-row JSON string does not false-pass the gate — matching how
 *  derivePhaseInputQuality and derivePhaseMethodologyCompleteness score it. */
function isInputFilled(value: unknown, field?: { type?: string; columns?: GridColumn[]; minRows?: number }): boolean {
  if (field?.type === "grid") {
    const columns = field.columns ?? [];
    return filledRowCount(parseRows(value, columns), columns) >= (field.minRows ?? 1);
  }
  if (value == null) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.length > 0 : true;
      } catch {
        return true;
      }
    }
    return true;
  }
  if (Array.isArray(value)) return value.length > 0;
  return true;
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
  /**
   * Discipline this recommendation belongs to (shared with the finding taxonomy).
   * Local score/input/depth signals are the artifact's own Completeness; approval
   * is Governance; folded-in semantic findings carry Ontology/Change/Governance.
   */
  category: RecommendationCategory;
}

/** One grounding input the artifact is generated from, with what it must hold. */
interface ArtifactInputRequirement {
  label: string;
  requirement: string;
  filled: boolean;
}

// Deterministic, signal-grounded quality assessment for a produced artifact.
// Combines the AI quality score, the SPECIFIC input fields this document is
// grounded on (named, with what each must contain), any model-suggested
// improvements, and approval state into a concrete punch list — no extra model
// call, so the "Improve quality" modal can only ever name real, actionable gaps.
function deriveArtifactQualityIssues(opts: {
  score: number | null;
  state: string;
  inputRequirements: ArtifactInputRequirement[];
  improvements?: string[];
}): ArtifactQualityIssue[] {
  const { score, state, inputRequirements, improvements } = opts;
  const issues: ArtifactQualityIssue[] = [];
  // Split grounding inputs first so the score message can be honest about whether
  // there are empty inputs to complete or whether every input is already filled.
  const missing = inputRequirements.filter((req) => !req.filled);
  const present = inputRequirements.filter((req) => req.filled);
  const allInputsFilled = inputRequirements.length > 0 && missing.length === 0;
  const hasModelImprovements = (improvements ?? []).some((s) => !!s && s.trim());
  if (typeof score === "number") {
    if (score < 60) {
      issues.push({
        severity: "high",
        category: "Completeness",
        title: `Low quality score — ${score}%`,
        detail: allInputsFilled
          ? `ATOS rated this document below the quality bar even though every grounding input is filled. The lever now is depth, not coverage — see the step below to enrich the inputs, then regenerate.`
          : "ATOS rated this document below the quality bar. Complete the grounding inputs below, then regenerate to lift the score.",
      });
    } else if (score < 80) {
      issues.push({
        severity: "medium",
        category: "Completeness",
        title: `Quality score ${score}% — room to improve`,
        detail: allInputsFilled
          ? `The document is usable, but ATOS sees headroom even though every grounding input is filled. See the step below to push the score higher, or regenerate for another pass.`
          : "The document is usable but ATOS sees headroom. Strengthen the grounding inputs below, then regenerate.",
      });
    }
  } else if (state !== "approved" && state !== "archived") {
    // A custom planner artifact produced by the generic phase agent gets no
    // independent quality review, so it has no score — yet the card still reads
    // "Needs improvement". Without this, the recommendations panel would be empty.
    // Give a concrete next step: enrich the grounding inputs (if any are thin) and
    // regenerate, which runs a fresh draft the reviewer can then score.
    issues.push({
      severity: "medium",
      category: "Completeness",
      title: "Not yet quality-reviewed",
      detail: missing.length
        ? "This artifact has no quality score yet. Complete the grounding inputs below, then regenerate to produce a reviewed draft."
        : "This artifact has no quality score yet. Regenerate it to run a fresh quality review, replacing any broad or placeholder detail with concrete specifics first to lift its depth.",
    });
  }
  // Prescriptive, per-field: name the exact input each artifact is grounded on and
  // what it must contain. Empty grounding inputs are the highest-leverage fixes.
  for (const req of missing) {
    issues.push({ severity: "high", category: "Completeness", title: `Add "${req.label}"`, detail: req.requirement });
  }
  // Generic depth nudge — only when the model returned no specific suggestions to
  // show below it. When `improvements` exist, they carry the actionable advice and
  // this blanket "make inputs more specific" line is just redundant noise.
  if (allInputsFilled && typeof score === "number" && score < 80 && !hasModelImprovements) {
    issues.push({
      severity: "medium",
      category: "Completeness",
      title: "Deepen the grounding inputs",
      detail: `Every grounding input already has a value, so nothing is missing — the score reflects how specific those values are. Revisit ${present.map((req) => req.label).join(", ")} and replace any broad or placeholder answers with concrete detail: real names and titles, dated milestones, quantified figures, and named constraints. Once the inputs read like a briefing rather than a summary, regenerate to lift the score.`,
    });
  }
  for (const improvement of improvements ?? []) {
    if (improvement && improvement.trim()) issues.push({ severity: "low", category: "Completeness", title: "Suggested improvement", detail: improvement.trim() });
  }
  if (state !== "approved" && state !== "archived") {
    issues.push({ severity: "low", category: "Governance", title: "Not yet approved", detail: "Review the document and approve it to lock this artifact and run the gate check." });
  }
  return issues;
}


/**
 * Quality bar an artifact must EXCEED (>89%, i.e. ≥90) before the next artifact
 * in the phase order is unlocked for generation. Drives sequential generation.
 */
const ARTIFACT_QUALITY_GATE = 90;

function StageModal({ title, onClose, children, maxWidth = 560 }: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  // Render through a portal to <body>. The phase workspace has transformed
  // ancestors (hover-lift transitions, the flow overlay), and a `position:
  // fixed` element nested under a transformed ancestor is positioned relative to
  // that ancestor — not the viewport — which made the overlay dim only part of
  // the page and anchored the dialog near the top. Portaling to body escapes
  // every local stacking/transform context so the modal truly centres.
  const modal = (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
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
  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
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
  if (block.kind === "ul") {
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
  return null;
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
  risk: "Live risk & blocker log with mitigations and ownership",
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
  onOpenDecideTab,
  onOpenGuidance,
  onAddItem,
  onOpenReport,
  onReopenGate,
  onRaiseChangeRequest,
  onApproveGate,
  onRunAgent,
  onSaveArtifact,
  onApproveArtifact,
  onApproveAllArtifacts,
  onUnapproveArtifact,
  onSaveInputs,
  onSaveProgram,
  onRevertProgram,
  programSnapshots = [],
  onUploadDocument,
  onAttachArtifact,
  onDeleteArtifact,
  onAssistField,
  artifactPreviews,
}: StageViewProps) {
  const [expandedOutput, setExpandedOutput] = React.useState<string | null>(null);
  const [editingArtifact, setEditingArtifact] = React.useState<"narrative" | "deck" | null>(null);
  const [updatedArtifactId, setUpdatedArtifactId] = React.useState<"narrative" | "deck" | null>(null);
  const [isLocking, setIsLocking] = React.useState(false);
  const [approvingAll, setApprovingAll] = React.useState(false);
  const [downloadingArtifacts, setDownloadingArtifacts] = React.useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = React.useState(false);
  const [lockedModalOpen, setLockedModalOpen] = React.useState(false);
  // The label of the just-closed phase, captured at close time so the completion
  // modal keeps naming it after the workspace auto-advances to the next phase.
  const [lockedPhaseLabel, setLockedPhaseLabel] = React.useState<string | null>(null);
  const [changeRequestOpen, setChangeRequestOpen] = React.useState(false);
  const [previewArtifact, setPreviewArtifact] = React.useState<{ defId?: string; label: string; description?: string; content: string; score: number | null; statusTone: string } | null>(null);
  const [showDiscoveryPack, setShowDiscoveryPack] = React.useState(false);
  const [qualityArtifact, setQualityArtifact] = React.useState<{
    label: string;
    defId: string;
    score: number | null;
    issues: ArtifactQualityIssue[];
    phaseId: string;
    fields: Array<{ id: string; label: string; hint?: string; currentValue: string; filled: boolean }>;
    improvements: string[];
    /** Attached documents surface recommendations read-only — no in-app apply or add-inputs. */
    readOnly?: boolean;
    /** Whether the Layer-2 semantic validator has run — gates the "run it" hint. */
    semanticValidated?: boolean;
  } | null>(null);
  const [applyingImprovements, setApplyingImprovements] = React.useState(false);
  const [applyError, setApplyError] = React.useState<string | null>(null);

  // True once the reviewer's suggestions have been folded into the inputs for the
  // currently-open quality modal, so the Apply button can switch to a disabled
  // "no more suggestions" state instead of the modal silently vanishing.
  const [improvementsApplied, setImprovementsApplied] = React.useState(false);
  // Apply the reviewer's suggestions straight into the grounding inputs: run an AI
  // enrichment pass over each textual input that feeds this artifact, directed by
  // the suggestion list, then persist the rewritten values in one save. Saving a
  // changed grounding input auto-stales the approved artifact downstream, so the
  // user can regenerate against the stronger inputs.
  const handleApplyImprovements = React.useCallback(async () => {
    if (!onAssistField || !qualityArtifact) return;
    const { phaseId, fields, improvements } = qualityArtifact;
    if (!fields.length) return;
    const guidance = improvements.map((s, i) => `${i + 1}. ${s}`).join("\n");
    setApplyingImprovements(true);
    setApplyError(null);
    try {
      const updates: Record<string, string> = {};
      let lastError: unknown = null;
      let failures = 0;
      for (const field of fields) {
        // Tolerate a per-field failure (e.g. a transient edge blip): keep the
        // inputs that did improve rather than discarding the whole batch. Only a
        // total wipeout (every field failed) is surfaced as an error to retry.
        try {
          const text = await onAssistField(phaseId, {
            fieldId: field.id,
            fieldLabel: field.label,
            fieldHint: field.hint,
            mode: field.filled ? "improve" : "generate",
            currentValue: field.currentValue,
            guidance,
          });
          const clean = (text || "").trim();
          if (clean && clean !== field.currentValue.trim()) updates[field.id] = clean;
        } catch (err) {
          failures += 1;
          lastError = err;
        }
      }
      if (Object.keys(updates).length) {
        await onSaveInputs(phaseId, updates, { clearReviewDefId: qualityArtifact.defId, staleDefId: qualityArtifact.defId });
      } else if (failures === fields.length) {
        throw lastError instanceof Error ? lastError : new Error("Could not apply improvements. Try again.");
      }
      // Keep the modal open and flip to the "applied" state so the user gets an
      // explicit confirmation (button disabled, "no more suggestions") rather than
      // the modal silently closing.
      setImprovementsApplied(true);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Could not apply improvements. Try again.");
    } finally {
      setApplyingImprovements(false);
    }
  }, [onAssistField, onSaveInputs, qualityArtifact]);
  // Live (unsaved) input snapshot emitted by the inputs panel on every edit, so
  // header metrics / status rings / flow-line tones reflect in-progress typing
  // before an explicit Save. Read-only — never fed back into the panel's edit
  // buffer (that would steal focus mid-keystroke).
  const [liveInputs, setLiveInputs] = React.useState<{ phaseId: string; inputs: Record<string, string> } | null>(null);
  const handleLiveInputs = React.useCallback((phaseId: string, inputs: Record<string, string>) => {
    setLiveInputs({ phaseId, inputs });
  }, []);
  const [revertModalOpen, setRevertModalOpen] = React.useState(false);
  const [savingProgram, setSavingProgram] = React.useState(false);
  const [programSaved, setProgramSaved] = React.useState(false);
  const [revertingId, setRevertingId] = React.useState<string | null>(null);
  // Program settings menu (gear, top-right): consolidates Save / Revert / Unlock.
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);
  const handleSaveProgramClick = React.useCallback(async () => {
    if (!onSaveProgram || savingProgram) return;
    setSavingProgram(true);
    try {
      await onSaveProgram();
      setProgramSaved(true);
      window.setTimeout(() => setProgramSaved(false), 1800);
    } finally {
      setSavingProgram(false);
    }
  }, [onSaveProgram, savingProgram]);
  const handleRevertClick = React.useCallback(async (snapshotId: string) => {
    if (!onRevertProgram || revertingId) return;
    setRevertingId(snapshotId);
    try {
      await onRevertProgram(snapshotId);
      setRevertModalOpen(false);
    } finally {
      setRevertingId(null);
    }
  }, [onRevertProgram, revertingId]);
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
    const byKey = new Map<string, { present: boolean; quality: number | null; state: string; artifactId: string | null; origin: ArtifactOrigin }>();
    // Produced artifacts the methodology/dynamic catalogue does not declare. They
    // are kept separate from `byKey` so the required-spine gates (bulk approve, the
    // sequential quality lock, the missing-required count) are unaffected, while
    // the chip strip can still surface them so no generated artifact is stranded.
    // Exception: phase progress (`phase-completion-estimator` → "completion-estimate")
    // is an internal metric shown on the rings/Gantt/pipeline, not a deliverable, so
    // it is skipped below rather than surfaced as a (confusing) pseudo-artifact.
    const orphanByKey = new Map<string, { present: boolean; quality: number | null; state: string; artifactId: string | null; origin: ArtifactOrigin }>();
    const orphans: PhaseArtifactDef[] = [];
    if (!activePhase) return { byKey, orphanByKey, orphans, present: 0, required: 0 };
    const summary = buildPhaseArtifacts(program, activePhase.id);
    // Narrative leads as its own inline preview, so it is excluded from the
    // artifact-chip list and its completeness counts on this screen (and the
    // Intelligence rail) to keep both surfaces consistent.
    let required = 0;
    let present = 0;
    for (const node of summary?.artifacts ?? []) {
      if (node.key === "narrative") continue;
      const record = { present: node.present, quality: node.quality, state: node.state, artifactId: node.artifactId, origin: node.origin };
      if (node.required) {
        byKey.set(node.key, record);
        required += 1;
        if (node.present) present += 1;
      } else if (node.present) {
        // completion-estimate is an internal phase-progress metric, and risk/RAID
        // is deterministic app design — neither belongs in the artifact-chip list,
        // so legacy stored values are skipped here.
        if (node.key === "completion-estimate") continue;
        if (node.key === "risk") continue;
        // Support agents (capacity, compliance, vendor risk, etc.) write artifact
        // stubs too, but they back cards/metrics — not gateable deliverables — so
        // they are excluded from the artifacts column. Registry is the source of truth.
        if (SUPPORT_ARTIFACT_IDS.has(node.key)) continue;
        orphanByKey.set(node.key, record);
        orphans.push({
          id: node.key,
          label: node.label,
          description: getAgentMeta(canonicalArtifactId(activePhase.id, node.key)).description,
        });
      }
    }
    return { byKey, orphanByKey, orphans, present, required };
  }, [program, activePhase]);

  // Programme-specific dynamic schema (ai-derived fields/artifacts/flow proposed
  // by the planner after a prior gate cleared). Merged on top of the static
  // methodology by every resolver below so dynamic entries render everywhere.
  const dynamicStore = useMemo(() => {
    const raw = typeof program?.rawData === "object" && program.rawData !== null
      ? ("data" in program.rawData && typeof program.rawData.data === "object" && program.rawData.data !== null
        ? program.rawData.data
        : program.rawData)
      : null;
    return getDynamicSchemaStore(raw);
  }, [program]);

  // The chip-strip artifact list: the methodology/dynamic catalogue plus any
  // produced-but-uncatalogued artifacts, so a generated artifact is always
  // reachable here even when it is not a declared phase deliverable. The
  // required-spine gates below intentionally read the catalogue alone.
  const phaseArtifactDefs = useMemo(() => {
    if (!activePhase) return [] as PhaseArtifactDef[];
    const base = getPhaseArtifactDefs(activePhase.id, dynamicStore);
    const extra = phaseArtifacts.orphans.filter((o) => !base.some((d) => d.id === o.id));
    return extra.length ? [...base, ...extra] : base;
  }, [activePhase, dynamicStore, phaseArtifacts.orphans]);

  // Labels of required artifacts not yet produced — drives the artifacts-card summary.
  const missingRequiredArtifacts = useMemo(() => {
    if (!activePhase) return [] as string[];
    return getPhaseArtifactDefs(activePhase.id, dynamicStore)
      .filter((def) => {
        const node = phaseArtifacts.byKey.get(def.id);
        return node && !node.present;
      })
      .map((def) => def.label);
  }, [activePhase, phaseArtifacts, dynamicStore]);

  // The artifacts that gate this phase's close. Normally the required spine
  // (`byKey`). But a phase can declare NO required artifacts (e.g. Mobilise:
  // `requiredArtifacts: []`) yet still produce real deliverables (RACI,
  // Governance) — those land in `orphanByKey`. With an empty required spine such
  // a phase would have nothing to approve, so bulk-approve (and therefore the
  // gate close, which needs artifactsComplete=100) could never fire and the phase
  // was un-closable. When there is no required spine, fall back to the produced
  // orphan artifacts so an orphan-only phase is still approvable and closable.
  const gateArtifactEntries = useMemo(() => {
    const entries = Array.from(phaseArtifacts.byKey.entries());
    if (phaseArtifacts.required === 0) entries.push(...phaseArtifacts.orphanByKey.entries());
    return entries;
  }, [phaseArtifacts]);
  // Produced artifacts still awaiting approval (present, not approved/archived).
  // Drives the single "Approve all artifacts" action that replaces per-row approve.
  const approvableArtifactCount = useMemo(() => {
    if (!activePhase) return 0;
    let count = 0;
    for (const [, node] of gateArtifactEntries) {
      if (node.present && node.artifactId && node.state !== "approved" && node.state !== "archived") count += 1;
    }
    return count;
  }, [activePhase, gateArtifactEntries]);
  // Any produced artifact is stale → bulk approve must NOT be offered: a stale
  // artifact has drifted from its inputs and must be regenerated before it can
  // be approved, so approving the set wholesale would lock in stale output.
  const hasStaleArtifact = useMemo(() => {
    if (!activePhase) return false;
    for (const [, node] of gateArtifactEntries) {
      if (node.present && node.state === "stale") return true;
    }
    return false;
  }, [activePhase, gateArtifactEntries]);
  // Every gate artifact is produced → the gate for surfacing bulk approve. For a
  // required spine that means all required present; for an orphan-only phase it
  // means at least one produced orphan (they are present by definition).
  const allRequiredProduced = phaseArtifacts.required > 0
    ? phaseArtifacts.present === phaseArtifacts.required
    : phaseArtifacts.orphanByKey.size > 0;

  const gateReview = activePhase ? program?.gateReviews?.[activePhase.id] || null : null;
  const gateReviewStatus = getRawGateStatus(program, activePhase?.id ?? null) || gateReview?.status || null;
  // The phase gate is closed/locked: artifacts are finalised, so per-artifact and
  // bulk approval no longer apply (reopen via the Unlock action to edit again).
  const gateApproved = gateReviewStatus === "approved";
  const source = typeof program?.rawData === "object" && program.rawData !== null
    ? ("data" in program.rawData && typeof program.rawData.data === "object" && program.rawData.data !== null
      ? program.rawData.data as Record<string, unknown>
      : program.rawData as Record<string, unknown>)
    : null;
  // Semantic layer (Layer 2): the cross-artifact validator's persisted findings.
  // Folded into each artifact's recommendations so the panel names the objective-
  // chain gaps (an un-traced requirement, an unsupported benefit) the local
  // score/input signals are blind to — categorized alongside them.
  const modelFindings = React.useMemo(() => selectModelValidationFindings(program), [program]);
  const semanticValidated = React.useMemo(() => getSemanticValidationMeta(program).hasRun, [program]);
  // The roster is a structured grid, so the AI text-rewrite "Apply suggestions"
  // path does not apply to the RACI matrix (its only grounding input). Instead,
  // a RACI quality recommendation to staff a role is actioned deterministically:
  // seed a placeholder roster row (role filled, name blank) for every RACI
  // delivery role the roster does not yet carry, so the user just types the name.
  const rosterPlaceholderPlan = React.useMemo(() => {
    if (!qualityArtifact || qualityArtifact.defId !== "raci-matrix" || gateApproved) return null;
    const rosterField = resolveRosterField(dynamicStore);
    const columns = rosterField?.columns ?? [];
    if (!rosterField || !columns.length) return null;
    const { roleKey, nameKey } = rosterColumnKeys(columns);
    if (!roleKey) return null;
    const rosterInputs = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
      ? (source.phaseInputs as Record<string, unknown>)[ROSTER_PHASE_ID]
      : null;
    const rosterValue = rosterInputs && typeof rosterInputs === "object" && !Array.isArray(rosterInputs)
      ? (rosterInputs as Record<string, unknown>)[rosterField.id]
      : null;
    const rows = parseRows(rosterValue, columns);
    const missing = missingRosterRoles(rows, roleKey, raciDeliveryRoles(readRaciMatrix(source)));
    if (!missing.length) return null;
    const newRows: GridRow[] = missing.map((role, i) => {
      const row: GridRow = {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `raci-role-${Date.now()}-${i}`,
      };
      for (const col of columns) row[col.key] = "";
      row[roleKey] = role;
      if (nameKey) row[nameKey] = "";
      return row;
    });
    return { fieldId: rosterField.id, roles: missing, count: missing.length, mergedJson: serializeRows([...rows, ...newRows], columns) };
  }, [qualityArtifact, gateApproved, dynamicStore, source]);
  const [applyingPlaceholders, setApplyingPlaceholders] = React.useState(false);
  const handleAddRosterPlaceholders = React.useCallback(async () => {
    if (!rosterPlaceholderPlan) return;
    setApplyingPlaceholders(true);
    setApplyError(null);
    try {
      await onSaveInputs(ROSTER_PHASE_ID, { [rosterPlaceholderPlan.fieldId]: rosterPlaceholderPlan.mergedJson }, { clearReviewDefId: qualityArtifact?.defId, staleDefId: qualityArtifact?.defId });
      setImprovementsApplied(true);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Could not add placeholder rows. Try again.");
    } finally {
      setApplyingPlaceholders(false);
    }
  }, [rosterPlaceholderPlan, onSaveInputs, qualityArtifact]);
  // Stakeholder analogue of the RACI placeholder plan. The artifact reviewer
  // emits `suggestedStakeholders` (concrete roles missing from the programme's
  // stakeholder list); we diff them against the Discover stakeholder grid and
  // build a placeholder row per genuinely-missing role, so the user just fills
  // in the named person. Mirrors rosterPlaceholderPlan exactly.
  const stakeholderPlaceholderPlan = React.useMemo(() => {
    if (!qualityArtifact || gateApproved) return null;
    const review = resolveArtifactReview(source, qualityArtifact.defId, qualityArtifact.phaseId);
    const suggested = review?.suggestedStakeholders ?? [];
    if (!suggested.length) return null;
    const field = resolveStakeholderField(dynamicStore, qualityArtifact.phaseId);
    const columns = field?.columns ?? [];
    if (!field || !columns.length) return null;
    const { roleKey, nameKey } = stakeholderColumnKeys(columns);
    if (!roleKey) return null;
    const inputs = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
      ? (source.phaseInputs as Record<string, unknown>)[qualityArtifact.phaseId]
      : null;
    const value = inputs && typeof inputs === "object" && !Array.isArray(inputs)
      ? (inputs as Record<string, unknown>)[field.id]
      : null;
    const rows = parseRows(value, columns);
    const missing = missingRosterRoles(rows, roleKey, suggested);
    if (!missing.length) return null;
    const newRows: GridRow[] = missing.map((role, i) => {
      const row: GridRow = {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `stakeholder-${Date.now()}-${i}`,
      };
      for (const col of columns) row[col.key] = "";
      // A dedicated name column stays blank for the user to fill; if the grid has
      // no role column the identity IS the name column, so write the role there.
      if (nameKey && nameKey !== roleKey) row[nameKey] = "";
      row[roleKey] = role;
      return row;
    });
    return { fieldId: field.id, phaseId: qualityArtifact.phaseId, roles: missing, count: missing.length, mergedJson: serializeRows([...rows, ...newRows], columns) };
  }, [qualityArtifact, gateApproved, dynamicStore, source]);
  const handleAddStakeholderPlaceholders = React.useCallback(async () => {
    if (!stakeholderPlaceholderPlan) return;
    setApplyingPlaceholders(true);
    setApplyError(null);
    try {
      await onSaveInputs(stakeholderPlaceholderPlan.phaseId, { [stakeholderPlaceholderPlan.fieldId]: stakeholderPlaceholderPlan.mergedJson }, { clearReviewDefId: qualityArtifact?.defId, staleDefId: qualityArtifact?.defId });
      setImprovementsApplied(true);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Could not add placeholder rows. Try again.");
    } finally {
      setApplyingPlaceholders(false);
    }
  }, [stakeholderPlaceholderPlan, onSaveInputs, qualityArtifact]);
  // Sequential artifact-generation gate. Artifacts must be produced in order:
  // an artifact is "cleared" once it is approved/archived or its quality exceeds
  // 89%. Only the first not-yet-cleared artifact (plus all cleared ones) may be
  // generated; every artifact after it is locked until the current one clears
  // the 89% quality bar — so users build a high-quality artifact before moving
  // on rather than mass-generating thin drafts. (The ordering itself is the
  // methodology/dynamic-schema order from getPhaseArtifactDefs.)
  const lockedArtifactDefIds = useMemo(() => {
    const locked = new Set<string>();
    if (!activePhase) return locked;
    let reachedCurrent = false;
    for (const def of getPhaseArtifactDefs(activePhase.id, dynamicStore)) {
      if (reachedCurrent) {
        locked.add(def.id);
        continue;
      }
      // Resolve required AND orphan (present-but-not-required) nodes, exactly as
      // the chip row does. A phase whose deliverables are all optional (e.g.
      // Mobilise: requiredArtifacts=[]) keeps every produced artifact in
      // orphanByKey — reading only byKey would see the predecessor as missing,
      // never clear it, and wrongly lock everything after it (the reason a
      // regenerated-but-optional RACI never unlocked the Governance Model).
      const node = phaseArtifacts.byKey.get(def.id) ?? phaseArtifacts.orphanByKey.get(def.id);
      const state = node?.state ?? "missing";
      if (state === "approved" || state === "archived") continue; // already cleared
      const score = resolveArtifactQualityScore(
        source,
        def.id,
        activePhase.id,
        typeof node?.quality === "number" ? node.quality : null,
      );
      const cleared = !!node?.present && typeof score === "number" && score >= ARTIFACT_QUALITY_GATE;
      if (cleared) continue;
      // First not-yet-cleared artifact: this one stays generatable, everything
      // after it is locked.
      reachedCurrent = true;
    }
    return locked;
  }, [activePhase, dynamicStore, phaseArtifacts, source]);
  // Every produced artifact in the phase clears the quality gate (>89%), or is
  // already approved. Combined with `allRequiredProduced`, this is the gate for
  // surfacing bulk approve — you can only approve once everything is generated
  // AND high quality.
  const allArtifactsMeetQualityGate = useMemo(() => {
    if (!activePhase) return false;
    let anyProduced = false;
    for (const [key, node] of gateArtifactEntries) {
      if (!node.present) continue;
      anyProduced = true;
      const state = node.state;
      if (state === "approved" || state === "archived") continue;
      const score = resolveArtifactQualityScore(
        source,
        key,
        activePhase.id,
        typeof node.quality === "number" ? node.quality : null,
      );
      if (!(typeof score === "number" && score >= ARTIFACT_QUALITY_GATE)) return false;
    }
    return anyProduced;
  }, [activePhase, gateArtifactEntries, source]);
  // Bulk approve is offered only when every required artifact is produced, none
  // are stale, and all clear the quality gate. Until then we show an inline hint
  // explaining the condition instead of the button.
  const showApproveAll = allRequiredProduced && approvableArtifactCount > 0 && !hasStaleArtifact && allArtifactsMeetQualityGate && !gateApproved;
  // Live overlay: the persisted programme with the active phase's *unsaved* input
  // edits merged in, so header metrics / status rings / flow-line tones reflect
  // typing instantly — ahead of the debounced auto-save round-trip. Only the
  // active phase's bucket is overlaid; everything else is the persisted programme
  // (gateReviews, artifacts, other phases) untouched. Read-only consumers only —
  // the inputs panel still edits against the persisted `program`.
  const liveProgram = useMemo<ProgramSummary | null>(() => {
    if (!program || !activePhase) return program ?? null;
    if (!liveInputs || liveInputs.phaseId !== activePhase.id) return program;
    const raw = program.rawData;
    if (typeof raw !== "object" || raw === null) return program;
    const nested = "data" in raw && typeof (raw as Record<string, unknown>).data === "object" && (raw as Record<string, unknown>).data !== null;
    const inner = nested ? (raw as Record<string, unknown>).data as Record<string, unknown> : raw as Record<string, unknown>;
    const persistedBucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null && !Array.isArray(inner.phaseInputs)
      ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[activePhase.id] ?? {}
      : {};
    const mergedBucket = { ...persistedBucket, ...liveInputs.inputs };
    const nextInner = {
      ...inner,
      phaseInputs: {
        ...(typeof inner.phaseInputs === "object" && inner.phaseInputs !== null && !Array.isArray(inner.phaseInputs) ? inner.phaseInputs : {}),
        [activePhase.id]: mergedBucket,
      },
    };
    const nextRaw = nested ? { ...(raw as Record<string, unknown>), data: nextInner } : nextInner;
    return { ...program, rawData: nextRaw } as ProgramSummary;
  }, [program, activePhase, liveInputs]);

  // Timestamped programme snapshots (newest first) the user can revert to. Manual
  // saves + auto-saves taken when a phase gate locks. Read straight off persisted
  // rawData so the revert modal always lists the authoritative history.
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
  // Bundle every produced artifact in the active phase into one .zip — each as a
  // markdown file, plus a README manifest — so a PM can hand the phase package to
  // a stakeholder without copying documents out one card at a time.
  const handleDownloadArtifacts = React.useCallback(async () => {
    if (!activePhase || !program || downloadingArtifacts) return;
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
    const phaseLabel = activePhase.displayName ?? activePhase.id;
    const produced: Array<{ label: string; state: string; content: string }> = [];
    for (const def of phaseArtifactDefs) {
      const node = phaseArtifacts.byKey.get(def.id) ?? phaseArtifacts.orphanByKey.get(def.id);
      const stringContent = node?.artifactId ? phaseArtifactContentById.get(node.artifactId) ?? null : null;
      const content = (stringContent && stringContent.trim()) ? stringContent : getFormalArtifactContent(source, def.id);
      if (content && content.trim()) produced.push({ label: def.label, state: node?.state ?? "draft", content });
    }
    if (!produced.length) return;
    setDownloadingArtifacts(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const manifest = [`# ${program.name} — ${phaseLabel} artifacts`, "", `Exported ${new Date().toISOString().slice(0, 10)}`, "", "## Contents", ""];
      for (const item of produced) {
        const fileName = `${slug(item.label)}.md`;
        zip.file(fileName, `# ${item.label}\n\n${item.content.trim()}\n`);
        manifest.push(`- ${item.label} (${item.state}) → ${fileName}`);
      }
      zip.file("README.md", `${manifest.join("\n")}\n`);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug(program.name)}-${slug(phaseLabel)}-artifacts.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingArtifacts(false);
    }
  }, [activePhase, downloadingArtifacts, phaseArtifactDefs, phaseArtifacts, phaseArtifactContentById, source, program]);
  // Same canonical action queue the rail and Action Center count, so the
  // Programme screen never shows two different "open" numbers for one phase.
  const stageDecisions = deriveOpenRecommendedActions(program, "delivery_lead")
    .filter((decision) => !decision.phaseId || decision.phaseId === activePhase?.id);
  // Canonical phase blocker + risk counts for the header metric strip — the same
  // RAID selectors (scoped to this phase) the right-rail Blockers/Risks tabs read
  // from, so the header number always matches the list it opens. (The gate-
  // readiness checklist is a different concept, surfaced via the Gate score
  // metric / exit-criteria modal, not the "Blockers" KPI.)
  const phaseBlockerCount = useMemo(
    () => (activePhase?.id ? selectBlockers(program, { phaseId: activePhase.id }).length : 0),
    [program, activePhase?.id],
  );
  const phaseRiskCount = useMemo(
    () => (activePhase?.id ? selectRisks(program, { phaseId: activePhase.id }).length : 0),
    [program, activePhase?.id],
  );
  const phaseRationale = program?.plan?.nextThreeActions?.find((action) => action.phase === activePhase?.id)?.rationale || "";
  const verdict = firstSentence(
    activePhase?.objective ||
    phaseRationale ||
    program?.narrative ||
    ""
  );
  const gateTrend = useMemo(() => {
    if (!activePhase || !program?.id) return null;
    return getRiskTrend(activePhase.id, program.id);
  }, [activePhase, program?.id]);
  const readiness = useMemo(
    () => (liveProgram && activePhase ? computePhaseReadiness(liveProgram, activePhase.id) : null),
    [activePhase, liveProgram],
  );
  // User-initiated lock: the gate flips to "approved" (label "Locked") and the
  // completion modal covers the transition. Shown once per lock action — tied to
  // this click, so no persisted ack flag is needed.
  const handleLockStage = React.useCallback(async () => {
    if (!activePhase || isLocking) return;
    setIsLocking(true);
    try {
      const closed = await onApproveGate(activePhase.id);
      setLockConfirmOpen(false);
      // Only show the "complete & locked" confirmation when the phase actually
      // closed. handleApproveGate returns false (and toasts the reason) if the
      // close was rejected, so we never show a misleading success state.
      if (closed !== false) {
        // Capture the closed phase's label before the workspace advances, so the
        // completion modal names the phase just locked, not the next one. The
        // auto-advance to the next phase is handled by onApproveGate in the shell,
        // where the gate has actually cleared and the next phase is unlocked.
        setLockedPhaseLabel(activePhase.displayName ?? activePhase.id);
        setLockedModalOpen(true);
      }
    } finally {
      setIsLocking(false);
    }
  }, [activePhase, isLocking, onApproveGate]);
  // Schema-grounded, deterministic input-quality assessment. Derived from the
  // phase's declared input fields (the single source of truth), so the banner's
  // "Missing:" list can only ever name inputs that genuinely belong to this
  // phase — never spurious items like workstreams on Strategy.
  const inputQuality = useMemo(() => {
    const bucket = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
      ? (source.phaseInputs as Record<string, unknown>)[activePhase?.id ?? ""]
      : null;
    const persisted = bucket && typeof bucket === "object" && !Array.isArray(bucket)
      ? (bucket as Record<string, unknown>)
      : {};
    // Overlay unsaved edits so "Inputs complete" / "Input quality" track typing.
    const inputs = liveInputs && liveInputs.phaseId === activePhase?.id
      ? { ...persisted, ...liveInputs.inputs }
      : persisted;
    return derivePhaseInputQuality(activePhase?.id, inputs, dynamicStore, source);
  }, [activePhase?.id, source, liveInputs, dynamicStore]);
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
  // Titles of every artifact in the programme — the resolution set for
  // `artifact-reference` inputs, which point at an upstream deliverable that an
  // earlier phase already produced (so the reference is satisfied without a manual
  // re-selection once that artifact exists).
  const programArtifactTitles = useMemo<string[]>(
    () => (program?.artifacts ?? []).map((artifact) => artifact.title).filter((title): title is string => !!title),
    [program?.artifacts],
  );

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

  // Phase-specific agent actions — consolidated into the header so the workspace
  // below shows only generated results, never a wall of "Generate X" buttons.
  const phaseAgentActions: Array<{ key: string; label: React.ReactNode; disabled: boolean; onClick: () => void }> = [];
  // The discovery pack auto-generates when the Discover phase is reached
  // (useAgentTriggers), so there is no manual "Generate" button. The "View
  // discovery pack" action lives in the inputs column (next to the inputs panel),
  // not here in the phase header.
  const discoveryPackRunning = activePhase.id === "discover" && !discoveryGuide && isAgentRunning("discovery-guide-generator");
  // The sprint-planner action lives in the Build inputs-panel header (next to
  // "View sprint plan"), not here — see PhaseInputsPanel headerAction below.
  // capacity-assessor and vendor-risk-assessor run automatically via useAgentTriggers
  // (like the Discover discovery pack), so they no longer carry manual buttons here.
  if (["design", "govern"].includes(activePhase.id)) {
    phaseAgentActions.push({ key: "compliance-checker", label: agentButtonContent("compliance-checker", complianceCheck ? "Re-check compliance" : "Run compliance check"), disabled: gateApproved || agentButtonDisabled("compliance-checker"), onClick: () => onRunAgent("compliance-checker") });
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
            <PhaseStatusRings program={liveProgram ?? program} phaseId={activePhase.id} size={116} showCenter />
            <div className="v3-phase-head-titles">
              <div className="v3-phase-head-eyebrow">
                <span className="v3-phase-head-prog">{program.name}</span>
                {program.client ? <span>· {program.client}</span> : null}
                {program.sponsor ? <span>· Sponsor: {program.sponsor}</span> : null}
                <span>· Updated <RelativeTime date={program.updatedAt} /></span>
              </div>
              <div className="v3-phase-head-titlerow">
                <span className="v3-phase-head-title">{activePhase.displayName ?? activePhase.id}</span>
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
          {(onSaveProgram || phaseArtifacts.present > 0 || phaseArtifacts.orphanByKey.size > 0) ? (
            <div className="v3-settings" ref={settingsRef}>
              <button
                type="button"
                className={`v3-settings-btn${settingsOpen ? " is-open" : ""}`}
                aria-haspopup="menu"
                aria-expanded={settingsOpen}
                aria-label="Program settings"
                title="Program settings"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <svg className="v3-settings-gear" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12 2.6v2.3M12 19.1v2.3M21.4 12h-2.3M4.9 12H2.6M18.66 5.34l-1.63 1.63M6.97 17.03l-1.63 1.63M18.66 18.66l-1.63-1.63M6.97 6.97 5.34 5.34" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {programSnapshots.length > 0 ? <span className="v3-settings-dot" aria-hidden="true" /> : null}
              </button>
              {settingsOpen ? (
                <div className="v3-settings-menu" role="menu">
                  {onSaveProgram ? (
                    <>
                      <div className="v3-settings-menu-head">Program</div>
                      <button
                        type="button"
                        role="menuitem"
                        className={`v3-settings-item${programSaved ? " is-success" : ""}`}
                        disabled={savingProgram}
                        onClick={() => { void handleSaveProgramClick(); }}
                      >
                        <span className="v3-settings-item-icon" aria-hidden="true">
                          {savingProgram ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="v3-save-spin"><path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
                          ) : programSaved ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 5h11l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8 5v5h7V5M8 19v-5h8v5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                          )}
                        </span>
                        <span className="v3-settings-item-text">
                          <span className="v3-settings-item-label">{savingProgram ? "Saving…" : programSaved ? "Saved" : "Save program"}</span>
                          <span className="v3-settings-item-sub">Capture a timestamped snapshot</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="v3-settings-item"
                        disabled={programSnapshots.length === 0}
                        onClick={() => { setSettingsOpen(false); setRevertModalOpen(true); }}
                      >
                        <span className="v3-settings-item-icon" aria-hidden="true">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 9a8 8 0 1 1-1 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 4v5h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                        <span className="v3-settings-item-text">
                          <span className="v3-settings-item-label">Revert…</span>
                          <span className="v3-settings-item-sub">{programSnapshots.length === 0 ? "No saved versions yet" : `Restore a saved version`}</span>
                        </span>
                        {programSnapshots.length > 0 ? <span className="v3-settings-item-count">{programSnapshots.length}</span> : null}
                      </button>
                    </>
                  ) : null}
                  {phaseArtifacts.present > 0 || phaseArtifacts.orphanByKey.size > 0 ? (
                    <>
                      <div className="v3-settings-menu-head">Artifacts</div>
                      <button
                        type="button"
                        role="menuitem"
                        className="v3-settings-item"
                        disabled={downloadingArtifacts}
                        onClick={() => { setSettingsOpen(false); void handleDownloadArtifacts(); }}
                      >
                        <span className="v3-settings-item-icon" aria-hidden="true">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </span>
                        <span className="v3-settings-item-text">
                          <span className="v3-settings-item-label">{downloadingArtifacts ? "Preparing package…" : "Download artifacts package"}</span>
                          <span className="v3-settings-item-sub">Every produced artifact as a .zip</span>
                        </span>
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Key metrics — the gate pipeline (inputs → quality → artifacts → quality → gate)
            in workflow order with chevrons between stages, then a separated work-count
            group (blockers/risks/actions). Each tile clicks through to its detail. */}
        {readiness ? (() => {
          const inputsComplete = inputQuality && inputQuality.total > 0
            ? Math.round((inputQuality.present / inputQuality.total) * 100)
            : readiness.inputScore;
          // Canonical completeness from the readiness model — the share of the
          // phase's required artifact set (static methodology + dynamic schema) that
          // has been APPROVED, not merely produced. Reaches 100% only when every
          // required document is approved — the same event that makes the gate lockable.
          const artifactsComplete = readiness.artifactsComplete;
          // True once at least one artifact has actually been produced — covers
          // dynamic phases (no static required spine) via the artifact score.
          const hasProducedArtifacts = phaseArtifacts.present > 0 || readiness.artifactScore > 0;
          const pctTone = (v: number) => (v >= 75 ? "green" : v >= 50 ? "amber" : "red");
          // The gate pipeline, in the order work flows toward the gate.
          const pipeline: Array<{ label: string; value: string | number; tone: string; anchor?: string | null; onClick?: () => void }> = [
            { label: "Inputs complete", value: `${inputsComplete}%`, tone: pctTone(inputsComplete), anchor: "phase-inputs-anchor" },
            { label: "Input quality", value: inputQuality ? `${inputQuality.overallScore}%` : "—", tone: inputQuality ? pctTone(inputQuality.overallScore) : "", onClick: onOpenGuidance, anchor: "phase-inputs-anchor" },
            { label: "Artifacts approved", value: `${artifactsComplete}%`, tone: pctTone(artifactsComplete), anchor: "phase-artifacts-anchor" },
            // Quality is only meaningful once something is produced; mirror the
            // "—" treatment of input quality / gate score so a stale review score
            // never shows next to a 0%/all-missing artifact column.
            { label: "Artifact quality", value: hasProducedArtifacts ? `${readiness.artifactScore}%` : "—", tone: hasProducedArtifacts ? pctTone(readiness.artifactScore) : "", onClick: onOpenGuidance, anchor: "phase-artifacts-anchor" },
            // Gate score = average of artifacts complete and artifact quality (the
            // two signals that move the phase toward its gate). This is the single
            // definition of "gate score" across the app — the header metric, the
            // outer status ring and every other surface all read readiness.score so
            // the number is identical everywhere. Distinct from the stricter lock
            // condition ("artifacts 100% complete and quality > 90%").
            { label: "Gate score", value: `${readiness.score}%`, tone: pctTone(readiness.score), anchor: "phase-artifacts-anchor" },
          ];
          // Live work counts — distinct from the pipeline, shown as a separated group.
          // Each carries an `addTab` so the "+ Add" button under it opens the right
          // Action Center add form.
          const work: Array<{ label: string; value: string | number; tone: string; anchor?: string | null; onClick?: () => void; addTab: "blockers" | "risks" | "actions" }> = [
            { label: "Actions", value: stageDecisions.length, tone: stageDecisions.length ? "amber" : "", onClick: () => (onOpenDecideTab ? onOpenDecideTab("actions") : onOpenDecide()), addTab: "actions" },
            { label: "Blockers", value: phaseBlockerCount, tone: phaseBlockerCount ? "red" : "green", onClick: () => (onOpenDecideTab ? onOpenDecideTab("blockers") : onOpenDecide()), addTab: "blockers" },
            { label: "Risks", value: phaseRiskCount, tone: phaseRiskCount ? "amber" : "", onClick: () => (onOpenDecideTab ? onOpenDecideTab("risks") : onOpenDecide()), addTab: "risks" },
          ];
          const renderMetric = (metric: { label: string; value: string | number; tone: string; anchor?: string | null; onClick?: () => void }) => {
            const cls = `v3-phase-metric-value ${metric.tone}`;
            const toneCls = metric.tone ? ` tone-${metric.tone}` : "";
            const handler = metric.onClick
              ? metric.onClick
              : metric.anchor
              ? () => document.getElementById(metric.anchor!)?.scrollIntoView({ behavior: "smooth", block: "center" })
              : null;
            if (!handler) {
              return (
                <div key={metric.label} className={`v3-phase-metric${toneCls}`}>
                  <div className={cls}>{metric.value}</div>
                  <div className="v3-phase-metric-label">{metric.label}</div>
                </div>
              );
            }
            return (
              <button
                key={metric.label}
                type="button"
                className={`v3-phase-metric is-clickable${toneCls}`}
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
                          {gateApproved ? (
                            onRaiseChangeRequest ? (
                              <button
                                type="button"
                                className="v3-button ghost v3-button-inline-xs v3-phase-gate-recheck"
                                title="This phase is locked. Raise a change request to edit it — approval reopens the gate."
                                onClick={() => setChangeRequestOpen(true)}
                              >
                                ✎ Request change
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="v3-button ghost v3-button-inline-xs v3-phase-gate-recheck"
                                title="Unlock this phase to edit, regenerate, or re-review its artifacts."
                                onClick={() => onReopenGate(activePhase.id)}
                              >
                                ⤺ Unlock
                              </button>
                            )
                          ) : (
                            <button
                              type="button"
                              className="v3-button ghost v3-button-inline-xs v3-phase-gate-recheck"
                              disabled={isLocking || !readiness.canApproveGate}
                              title="Close this phase. Enabled once every required artifact is approved and quality clears 85%."
                              onClick={() => setLockConfirmOpen(true)}
                            >
                              {isLocking ? "Closing…" : "Close phase"}
                            </button>
                          )}
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
      <PhaseFlowOverlay containerRef={phaseMainRef} program={liveProgram ?? program} phaseId={activePhase.id} enabled />
      {/* LEFT — input fields card. Document import is reached via the "Attach doc"
          action beside the Inputs-complete metric; the panel itself holds the
          field editors. */}
      <section className="v3-phase-col v3-phase-col--inputs">
        <div className="v3-zone-label">Inputs</div>
        {/* The phase-readiness / conflicts / open-gaps planner banner was removed:
            it duplicated signals already surfaced elsewhere — readiness restates
            the Gate score and readiness rings at the top of this screen, while the
            conflicts and gaps (missing required inputs, contradictions) are the
            same items shown as recommended actions, blockers, risks and
            escalations in the Action Center and the phase right rail. */}
        {program && activePhase?.id ? (
          <div id="phase-inputs-anchor">
            <PhaseInputsPanel
              program={program}
              phaseId={activePhase.id}
              onSave={onSaveInputs}
              onAssistField={onAssistField}
              onValuesChange={handleLiveInputs}
              locked={gateApproved}
              headerAction={
                activePhase.id === "discover" && discoveryGuide ? (
                  <button type="button" className="v3-button secondary v3-button-inline-xs" onClick={() => setShowDiscoveryPack(true)}>
                    View discovery pack
                  </button>
                ) : activePhase.id === "discover" && discoveryPackRunning ? (
                  <button type="button" className="v3-button secondary v3-button-inline-xs" disabled>
                    Generating discovery pack…
                  </button>
                ) : activePhase.id === "build" ? (
                  <button
                    type="button"
                    className="v3-button secondary v3-button-inline-xs"
                    disabled={gateApproved || agentButtonDisabled("sprint-planner")}
                    onClick={() => onRunAgent("sprint-planner")}
                  >
                    {agentButtonContent("sprint-planner", sprintPlan ? "Re-plan sprints" : "Generate sprint plan")}
                  </button>
                ) : null
              }
            />
          </div>
        ) : null}
      </section>

      {/* MIDDLE — live connector lines pinned to the real input-field and
          artifact elements in the side columns (always shown). */}
      <section className="v3-phase-col v3-phase-col--map" aria-hidden="true" />


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
        {showApproveAll ? (
          <div className="v3-phase-col-actions v3-artifact-download-row">
            <button
              type="button"
              className="v3-button primary v3-button-inline-xs"
              onClick={async () => {
                if (approvingAll) return;
                setApprovingAll(true);
                try {
                  await onApproveAllArtifacts(activePhase.id);
                } finally {
                  setApprovingAll(false);
                }
              }}
              disabled={approvingAll}
              title={`Approve all ${approvableArtifactCount} produced ${activePhase.displayName ?? activePhase.id} artifact${approvableArtifactCount > 1 ? "s" : ""} — running the gate check once`}
            >
              {approvingAll ? "⋯ Finalizing artifacts…" : `✓ Approve all artifacts (${approvableArtifactCount})`}
            </button>
          </div>
        ) : null}
        {phaseArtifacts.required > 0 && missingRequiredArtifacts.length ? (
          <div className="v3-artifact-summary is-missing">
            <span className="v3-chip amber v3-chip-tight">{missingRequiredArtifacts.length} required missing</span>
          </div>
        ) : null}
        {approvableArtifactCount > 0 && !showApproveAll ? (
          <div className="v3-artifact-approve-hint">
            Approval unlocks once every artifact is generated and reaches a quality score of 90% or higher.
          </div>
        ) : null}
        <div className="v3-output-strip">
          {phaseArtifactDefs
            .map((def, index) => {
              const requiredNode = phaseArtifacts.byKey.get(def.id);
              const node = requiredNode ?? phaseArtifacts.orphanByKey.get(def.id);
              const required = !!requiredNode;
              const present = !!node?.present;
              const state = node?.state ?? "missing";
              const score = typeof node?.quality === "number" ? node.quality : null;
              // The AI quality review (score + improvement plan) is produced at
              // generation time and stored at a top-level program key, not on the
              // artifact ledger record — so a draft (agentConfidence unset → null
              // quality) still has a reviewer score here. Prefer it so the chip
              // shows quality for drafts and the modal can render the AI plan.
              const review = resolveArtifactReview(source, def.id, activePhase.id);
              const displayScore = resolveArtifactQualityScore(source, def.id, activePhase.id, score);
              // Quality-driven status taxonomy:
              //   Missing            → not yet generated
              //   Stale              → a related input changed; must regenerate
              //   Needs improvement  → produced, quality below the 90% bar
              //   Ready              → produced, quality ≥ 90% — ready for approval
              //   Approved           → locked in (Archived kept for retired specs)
              // "Ready" uses the same 90% bar as the generation/approval gates so a
              // chip that reads "Ready" is exactly an artifact that unlocks the next
              // one and counts toward bulk approve.
              const meetsQualityBar = typeof displayScore === "number" && displayScore >= ARTIFACT_QUALITY_GATE;
              const statusLabel = !present
                ? "Missing"
                : state === "approved" ? "Approved"
                : state === "stale" ? "Stale — regenerate"
                : state === "archived" ? "Archived"
                : meetsQualityBar ? "Ready"
                : "Needs improvement";
              const statusTone = !present
                ? "muted"
                : state === "approved" ? "green"
                : state === "stale" ? "red"
                : state === "archived" ? "muted"
                : meetsQualityBar ? "blue"
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
              // Inputs declared to flow into THIS artifact must be complete before
              // it can be generated — generating against missing upstream inputs
              // produces a thin artifact and burns a ~90s model run. An artifact
              // with no declared input dependencies has nothing to wait on.
              const flowedFieldIds = getFillableArtifactInputFields(activePhase.id, def.id, dynamicStore);
              const phaseFieldDefs = getPhaseInputSchema(activePhase.id, dynamicStore).fields;
              // Only *required* flow inputs gate generation. An optional flow field
              // (e.g. the appetite-level validation approach) still wires the visual
              // flow + staleness, but a blank one must not lock the Generate button —
              // optional means "enriches if present", not "blocks until filled".
              // Required-ness is resolved per programme so a field the methodology
              // later marked required (with a `requiredSince` cutoff) never blocks a
              // programme that predates it.
              const optionalFieldIds = new Set(
                phaseFieldDefs.filter((field) => !isFieldRequiredForProgram(field, program?.createdAt)).map((field) => field.id),
              );
              // A flowed input counts as satisfied if it has a value, OR — for an
              // `artifact-reference` input — if the upstream deliverable it names
              // already exists in the programme. The generating agent receives that
              // artifact via cross-phase context regardless, so requiring a manual
              // re-selection just to unlock generation asks the user to re-declare
              // what the system already owns.
              const isFlowedFieldSatisfied = (fieldId: string) => {
                const fieldDef = phaseFieldDefs.find((field) => field.id === fieldId);
                if (isInputFilled(preFlightInputs[fieldId], fieldDef)) return true;
                return fieldDef?.type === "artifact-reference"
                  && artifactReferenceSatisfied(fieldDef.label ?? "", programArtifactTitles);
              };
              const missingFlowedFields = flowedFieldIds.filter(
                (fieldId) => !optionalFieldIds.has(fieldId) && !isFlowedFieldSatisfied(fieldId),
              );
              const flowedInputsIncomplete = missingFlowedFields.length > 0;
              // Map each grounding input to its label + what it must contain, so
              // "Improve quality" can prescribe the exact field to enrich, not a
              // generic "add inputs" nudge.
              const inputRequirements = flowedFieldIds.map((fieldId) => {
                const fieldDef = phaseFieldDefs.find((field) => field.id === fieldId);
                const requirement = [fieldDef?.placeholder, fieldDef?.hint]
                  .filter((part): part is string => !!part && part.trim().length > 0)
                  .join(" — ") || `Provide ${fieldDef?.label ?? fieldId}.`;
                return { label: fieldDef?.label ?? fieldId, requirement, filled: isFlowedFieldSatisfied(fieldId) };
              });
              // Same grounding inputs, but carrying the id + current value so the
              // "Improve quality → Apply" action can run an AI enrichment pass over
              // each field and persist the result. Only free-text fields are
              // eligible: a constrained field (select/date) has a fixed value space,
              // so an AI free-text rewrite would write a value the control can't
              // render (e.g. an off-list option leaves a dropdown blank); grids are
              // structured and handled by the deterministic placeholder path.
              const qualityFields = flowedFieldIds
                .map((fieldId) => {
                  const fieldDef = phaseFieldDefs.find((field) => field.id === fieldId);
                  const raw = preFlightInputs[fieldId];
                  const currentValue = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
                  return {
                    id: fieldId,
                    label: fieldDef?.label ?? fieldId,
                    hint: fieldDef?.hint,
                    type: fieldDef?.type,
                    currentValue,
                    filled: isInputFilled(raw, fieldDef),
                  };
                })
                .filter((field) => isFreeTextAssistField(field.type))
                .map(({ type: _type, ...rest }) => rest);
              // Prescriptive generate guidance: name each unfilled input prompt and
              // spell out the information it must carry, so a user knows exactly what
              // to write where before spending a ~90s model run on a thin artifact.
              const generateGuidance = inputRequirements
                .filter((req) => !req.filled)
                .map((req) => `• ${req.label}: ${req.requirement}`)
                .join("\n");
              const reviewerSuggestions = (review?.improvements ?? []).filter((s) => !!s && s.trim());
              const suggestionCount = reviewerSuggestions.length;
              // Fold the stored quality-review suggestions straight into the
              // regeneration prompt (via crossPhaseContext → prompt.system) so a
              // single Regenerate applies them directly — no separate per-field
              // input-rewrite LLM round trip.
              const reviewGuidance = suggestionCount
                ? `The previous version of "${def.label}" was quality-reviewed. Apply these specific improvements directly in the artifact you now produce:\n${reviewerSuggestions.map((s, i) => `${i + 1}. ${s.trim()}`).join("\n")}`
                : undefined;
              // Custom planner-invented artifacts (scope-map, routing-policy, …)
              // have no dedicated producing agent, so they run the phase agent's
              // generic branch. That agent needs to be told which single artifact
              // to emit — and with the exact id/label — so its output persists into
              // this def's ledger slot instead of a mismatched one. Named
              // deliverables resolve to their own agent and need no such steering.
              const generatorAgentId = artifactGeneratorAgentId(activePhase.id, def.id);
              const targetGuidance = generatorAgentId === activePhase.id
                ? `Generate ONLY the "${def.label}" artifact for this phase. Return it in "artifacts" as a single entry with id "${def.id}" and title "${def.label}".${def.description ? ` Purpose: ${def.description}` : ""}`
                : undefined;
              const regenGuidance = [targetGuidance, reviewGuidance].filter(Boolean).join("\n\n") || undefined;
              // Generation is locked either because (a) the phase gate is approved
              // — the artifacts are finalised, so regenerating/re-reviewing them is
              // off until the phase is unlocked — or (b) sequential generation: this
              // artifact comes after one that has not yet cleared the 89% quality bar.
              const generationLocked = gateApproved || lockedArtifactDefIds.has(def.id);
              // Recommendations are not only the model's improvement plan: a
              // custom planner artifact produced by the generic phase agent gets a
              // confidence score but no structured review, so it can read "Needs
              // improvement" with zero model suggestions. deriveArtifactQualityIssues
              // still yields actionable advice from the score and grounding inputs,
              // so drive the Recommendations button off that fuller set — otherwise
              // the button sits disabled on exactly the artifacts that need it most.
              // Semantic layer: the objective-chain findings that cite THIS artifact
              // (excluding self-reported gaps, which come from the mirror directly
              // below so they render even before a semantic run persists findings).
              const artifactFindings = selectFindingsForArtifact(modelFindings, def.id, activePhase.id)
                .filter((f) => f.domain !== "artifact-completeness");
              const semanticRecs = findingsToRecommendations(artifactFindings);
              const gapRecs = selfReportedGapRecommendations(source, def.id);
              const qualityIssues = present
                ? [
                    ...deriveArtifactQualityIssues({ score: displayScore, state, inputRequirements, improvements: review?.improvements }),
                    ...semanticRecs,
                    ...gapRecs,
                  ]
                : [];
              // "Not yet approved" is an always-present informational line, not an
              // actionable fix — exclude it so an at-bar artifact shows no false count.
              const recommendationCount = qualityIssues.filter((issue) => issue.title !== "Not yet approved").length;
              const generateTitle = gateApproved
                ? `${activePhase.displayName ?? "This phase"} is locked — unlock it from Settings to regenerate ${def.label}.`
                : generationLocked
                ? `Produce the earlier artifact${activePhase.displayName ? ` in ${activePhase.displayName}` : ""} to above 89% quality before generating ${def.label} — artifacts are built in order.`
                : flowedInputsIncomplete
                ? `Provide these inputs before generating ${def.label}:\n${generateGuidance}`
                : regenGuidance
                ? `Regenerate ${def.label} — applies ${suggestionCount} quality suggestion${suggestionCount === 1 ? "" : "s"} directly in the new draft`
                : inputsIncomplete
                ? `${present ? "Regenerate" : "Generate"} ${def.label} — strengthen these inputs to lift quality:\n${generateGuidance || preflight.missingFields.join(", ")}`
                : present ? `Regenerate ${def.label}` : `Generate ${def.label}`;
              // Origin drives the action set: an uploaded document offers
              // improve(read-only)/reattach/delete, a generated artifact offers
              // preview/improve/regenerate/attach, a missing one generate/attach.
              const origin = node?.origin ?? "required";
              const isAttached = origin === "uploaded";
              const cardModel: ArtifactCardModel = {
                index,
                defId: def.id,
                label: def.label,
                isStrategicRoadmap: def.id === "strategic-roadmap",
                statusLabel,
                statusTone,
                displayScore,
                present,
                summary,
                state,
                origin,
                approved: state === "approved",
                phaseLocked: gateApproved,
                canPreview: !!(present && previewContent),
                recommendationCount,
                showGenerate: state !== "approved",
                generateDisabled: agentButtonDisabled(generatorAgentId) || flowedInputsIncomplete || generationLocked,
                generateTitle,
                generateContent: agentButtonContent(generatorAgentId, generationLocked ? "🔒 Locked" : present ? "↻ Regenerate" : "Generate"),
                showUnlock: !!(present && artifactId && state === "approved" && !lockedPhaseIds.has(activePhase.id)),
                unlockTitle: `Unlock ${def.label} to edit, regenerate, or re-review it`,
              };
              const cardHandlers: ArtifactCardHandlers = {
                onPreview: () => setPreviewArtifact({ defId: def.id, label: def.label, description: def.description, content: previewContent ?? "", score: displayScore, statusTone }),
                onOpenRoadmap: () => onOpenMoreView("roadmap"),
                // An attached document's recommendations are read-only: the user acts
                // on them in the source file, not via in-app input rewrites.
                onRecommend: () => { setApplyError(null); setImprovementsApplied(false); setQualityArtifact({ label: def.label, defId: def.id, score: displayScore, issues: qualityIssues, phaseId: activePhase.id, fields: qualityFields, improvements: (review?.improvements ?? []).filter((s) => !!s && s.trim()), readOnly: isAttached, semanticValidated }); },
                onGenerate: () => onRunAgent(generatorAgentId, activePhase.id, regenGuidance),
                onUnlock: () => { if (artifactId) void onUnapproveArtifact(activePhase.id, artifactId); },
                onAttach: () => onAttachArtifact?.(activePhase.id, def.id, def.label, generatorAgentId),
                onReattach: () => onAttachArtifact?.(activePhase.id, def.id, def.label, generatorAgentId),
                onDelete: () => { if (artifactId) void onDeleteArtifact?.(activePhase.id, artifactId, def.id); },
              };
              return <ArtifactCard key={def.id} model={cardModel} handlers={cardHandlers} />;
            })}
        </div>
        {!artifactPreviews?.narrative && !artifactPreviews?.deck && !expandedOutput && (activePhase?.id === "strategy" || activePhase?.id === "build") ? (
          <div className="v3-output-empty-hint" style={{ fontSize: 12, color: "var(--v3-text-muted)", marginTop: 10, padding: "0 2px" }}>
            {activePhase?.id === "strategy"
              ? "Generate your transformation strategy document"
              : "Generate milestone tracking for delivery progress"}
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

      {showDiscoveryPack && discoveryGuide ? (
        <StageModal title="Discovery pack" onClose={() => setShowDiscoveryPack(false)} maxWidth={720}>
          <DiscoveryPackPanel pack={discoveryGuide as DiscoveryPack} />
        </StageModal>
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
        <StageModal title={`${qualityArtifact.readOnly ? "Recommendations" : "Improve quality"} — ${qualityArtifact.label}`} onClose={() => setQualityArtifact(null)}>
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
            <div className="v3-quality-issue-groups">
              {groupRecommendationsByCategory(qualityArtifact.issues).map((group) => (
                <div key={group.category} className="v3-quality-issue-group">
                  <div className="v3-quality-issue-group-header">
                    <span className="v3-quality-issue-group-title">{group.category}</span>
                    <span className="v3-quality-issue-group-desc">{group.description}</span>
                  </div>
                  <ul className="v3-quality-issue-list">
                    {group.items.map((issue, index) => (
                      <li key={index} className="v3-quality-issue">
                        <span className={`v3-chip v3-chip-tight ${issue.severity === "high" ? "red" : issue.severity === "medium" ? "amber" : "muted"}`}>{issue.severity}</span>
                        <div>
                          <div className="v3-quality-issue-title">{issue.title}</div>
                          {issue.detail ? <div className="v3-quality-issue-detail">{issue.detail}</div> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!qualityArtifact.semanticValidated ? (
                <div className="v3-quality-issue-note">
                  Semantic validation has not run for this program yet — Ontology and Change recommendations appear once the cross-artifact validator runs at the next gate review.
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>
              ATOS found no outstanding quality issues for this artifact.
            </div>
          )}
          {applyError ? (
            <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--v3-red, #dc2626)" }}>{applyError}</div>
          ) : null}
          {improvementsApplied ? (
            <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--v3-green, #16a34a)", display: "flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true">✓</span>
              Suggestions applied to inputs — no more suggestions. Regenerate the artifact to refresh its quality.
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {qualityArtifact.readOnly ? (
              <button
                type="button"
                className="v3-button primary v3-button-inline-sm"
                onClick={() => setQualityArtifact(null)}
                title="Close — recommendations for an attached document are applied in the source file, not in-app"
              >
                Close
              </button>
            ) : (
              <>
                {onAssistField && qualityArtifact.fields.length && qualityArtifact.improvements.length ? (
                  <button
                    type="button"
                    className="v3-button primary v3-button-inline-sm"
                    onClick={handleApplyImprovements}
                    disabled={applyingImprovements || improvementsApplied}
                    title={improvementsApplied
                      ? "These suggestions have been applied — regenerate the artifact to get a fresh review"
                      : "Use AI to fold these suggestions into the grounding inputs, then save"}
                  >
                    {improvementsApplied ? "✓ Suggestions applied" : applyingImprovements ? "✨ Applying…" : "✨ Apply suggestions to inputs"}
                  </button>
                ) : null}
                {rosterPlaceholderPlan ? (
                  <button
                    type="button"
                    className="v3-button primary v3-button-inline-sm"
                    onClick={handleAddRosterPlaceholders}
                    disabled={applyingPlaceholders || improvementsApplied}
                    title={`Adds a roster row for each RACI role not yet on the team (${rosterPlaceholderPlan.roles.join(", ")}) so you can fill in the named individual`}
                  >
                    {improvementsApplied
                      ? "✓ Placeholders added"
                      : applyingPlaceholders
                        ? "✨ Adding…"
                        : `✨ Create ${rosterPlaceholderPlan.count} placeholder role row${rosterPlaceholderPlan.count === 1 ? "" : "s"}`}
                  </button>
                ) : null}
                {stakeholderPlaceholderPlan ? (
                  <button
                    type="button"
                    className="v3-button primary v3-button-inline-sm"
                    onClick={handleAddStakeholderPlaceholders}
                    disabled={applyingPlaceholders || improvementsApplied}
                    title={`Adds a stakeholder row for each suggested role not yet on the list (${stakeholderPlaceholderPlan.roles.join(", ")}) so you can fill in the named individual`}
                  >
                    {improvementsApplied
                      ? "✓ Stakeholders added"
                      : applyingPlaceholders
                        ? "✨ Adding…"
                        : `✨ Add ${stakeholderPlaceholderPlan.count} suggested stakeholder${stakeholderPlaceholderPlan.count === 1 ? "" : "s"}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`v3-button ${improvementsApplied || !(onAssistField && qualityArtifact.fields.length && qualityArtifact.improvements.length) ? "primary" : "ghost"} v3-button-inline-sm`}
                  onClick={() => {
                    if (!improvementsApplied) document.getElementById("phase-inputs-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setQualityArtifact(null);
                  }}
                  disabled={applyingImprovements}
                >
                  {improvementsApplied ? "Done" : "Add inputs →"}
                </button>
              </>
            )}
          </div>
        </StageModal>
      ) : null}

      {lockConfirmOpen ? (
        <div
          role="presentation"
          onClick={() => { if (!isLocking) setLockConfirmOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(8,10,16,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Close stage"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.35)", padding: 28, textAlign: "center" }}
          >
            <div aria-hidden="true" style={{ width: 52, height: 52, margin: "0 auto 16px", borderRadius: "50%", background: "var(--v3-amber-soft, rgba(245,158,11,0.16))", color: "var(--v3-amber)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🔒</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, color: "var(--v3-text)" }}>
              Close the {activePhase.displayName ?? activePhase.id} stage?
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.5, color: "var(--v3-text-secondary)" }}>
              Every required artifact is complete and quality clears the gate bar. Closing locks this stage and approves its artifacts; further changes are managed through <strong>change control</strong>. The approved artifacts are then handed to the AI planner to generate the next stage&rsquo;s input fields and artifact inventory.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                type="button"
                className="v3-button ghost v3-button-inline-sm"
                onClick={() => setLockConfirmOpen(false)}
                disabled={isLocking}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v3-button primary v3-button-inline-sm"
                onClick={() => void handleLockStage()}
                disabled={isLocking}
                autoFocus
              >
                {isLocking ? "Closing…" : "Close phase"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lockedModalOpen ? (
        <div
          role="presentation"
          onClick={() => setLockedModalOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(8,10,16,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Stage locked"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.35)", padding: 28, textAlign: "center" }}
          >
            <div aria-hidden="true" style={{ width: 52, height: 52, margin: "0 auto 16px", borderRadius: "50%", background: "var(--v3-green-soft, rgba(34,197,94,0.16))", color: "var(--v3-green)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>✓</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, color: "var(--v3-text)" }}>
              {lockedPhaseLabel ?? activePhase.displayName ?? activePhase.id} stage complete &amp; locked
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.5, color: "var(--v3-text-secondary)" }}>
              Every required artifact is complete and quality clears the gate bar. This stage is now locked. Any further changes are managed through <strong>change control</strong>, accessed from the Executive Overview screen.
            </p>
            <button
              type="button"
              className="v3-button primary v3-button-inline-sm"
              onClick={() => setLockedModalOpen(false)}
              autoFocus
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {onRaiseChangeRequest && activePhase ? (
        <ChangeRequestModal
          open={changeRequestOpen}
          fixedPhase={{ id: activePhase.id, name: activePhase.displayName ?? activePhase.id }}
          onClose={() => setChangeRequestOpen(false)}
          onSubmit={async (phaseId, title, reason) => {
            await onRaiseChangeRequest(phaseId, title, reason);
            setChangeRequestOpen(false);
          }}
        />
      ) : null}

      {revertModalOpen ? (
        <div
          role="presentation"
          onClick={() => setRevertModalOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(8,10,16,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Revert to a saved version"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", background: "var(--v3-surface)", border: "1px solid var(--v3-border)", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.35)", padding: 24 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--v3-text)" }}>Saved versions</h2>
              <button type="button" className="v3-button ghost v3-button-inline-sm" onClick={() => setRevertModalOpen(false)}>Close</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.5, color: "var(--v3-text-secondary)" }}>
              Restore the programme to any earlier save. Reverting replaces the current programme data; your save history is kept.
            </p>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {programSnapshots.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--v3-text-secondary)", padding: "12px 0" }}>No saved versions yet.</div>
              ) : (
                programSnapshots.map((snap) => (
                  <div
                    key={snap.id}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", border: "1px solid var(--v3-border)", borderRadius: 10, background: "var(--v3-surface-2, rgba(255,255,255,0.02))" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--v3-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{snap.label}</span>
                        <span className={`v3-chip ${snap.kind === "lock" ? "green" : "muted"}`} style={{ flexShrink: 0 }}>{snap.kind === "lock" ? "auto · lock" : "manual"}</span>
                      </div>
                      {snap.createdAt ? (
                        <div style={{ fontSize: 11.5, color: "var(--v3-text-secondary)", marginTop: 2 }}>{new Date(snap.createdAt).toLocaleString()}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="v3-button v3-button-inline-sm"
                      onClick={() => void handleRevertClick(snap.id)}
                      disabled={revertingId !== null}
                      style={{ flexShrink: 0 }}
                    >
                      {revertingId === snap.id ? "Reverting…" : "Revert"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
