import type { AgentRun } from "@/lib/adamSync";
import type { Json } from "@/integrations/supabase/types";
import type {
  AdoptionAssessment,
  AdoptionGroup,
  AgentCardModel,
  AppView,
  ArtifactSummary,
  BudgetTracking,
  BenchmarkComparisonSummary,
  BenefitsTrackingSummary,
  ChangeImpactAssessment,
  ChangeImpactGroup,
  ClosureArtifact,
  ClosureBenefitSummary,
  CriticalPathAnalysis,
  DecisionPriority,
  DecisionSummary,
  Escalation,
  ExecutiveDeck,
  ExitCriterion,
  GateArtifact,
  GateReview,
  HealthHeatmapPhase,
  HealthHeatmapSummary,
  LessonLearned,
  Milestone,
  NudgeSummary,
  PhaseRetro,
  PlanSummary,
  PhaseSummary,
  ProgramClosure,
  ProgramSummary,
  RAIDEntry,
  RAIDEntryStatus,
  RAIDEntryType,
  RetroActionItem,
  RetroImprovement,
  RetroObservation,
  RiskSummary,
  ScopePcrSummary,
  ScopeSignal,
  StakeholderProfile,
  WeeklyDigestSummary,
  Workstream,
} from "@/new/types";
import { getPhaseSequence } from "@/v3/lib/methodology";

type JsonRecord = Record<string, Json | undefined>;
export type ProgramRowLike = {
  id: string;
  name: string;
  client?: string | null;
  industry?: string | null;
  updated_at?: string;
  data: unknown;
};

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  agent_arch: "Architecture",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
  delivery: "Delivery",
  adoption: "Drive Adoption",
  titan: "Read the Signals",
};

export const PHASE_SEQUENCE = getPhaseSequence("atos-standard") as readonly string[];

function asRecord(value: Json | unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: Json | unknown): Json[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: Json | unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: Json | unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseMoneyMagnitude(value: Json | unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const upper = value.toUpperCase();
  const numeric = asNumber(value, 0);
  if (upper.includes("B")) return numeric * 1_000_000_000;
  if (upper.includes("M")) return numeric * 1_000_000;
  if (upper.includes("K")) return numeric * 1_000;
  return numeric;
}

function normalizePhaseStatus(pct: number): PhaseSummary["status"] {
  if (pct >= 100) return "complete";
  if (pct >= 80) return "ready";
  if (pct >= 10) return "active";
  if (pct > 0) return "active";
  return "inactive";
}

function deriveWorkstreams(data: JsonRecord): Workstream[] {
  if (!Array.isArray(data.workstreams)) return [];
  return data.workstreams
    .filter((entry): entry is { [key: string]: Json | undefined } => isRecord(entry))
    .map((entry, index) => ({
      id: asString(entry.id, `workstream-${index + 1}`),
      label: asString(entry.label, `Workstream ${index + 1}`),
      phaseId: asString(entry.phaseId),
      weight: asNumber(entry.weight, 0),
      pct: asNumber(entry.pct, 0),
      gateScore: entry.gateScore == null ? null : asNumber(entry.gateScore, 0),
      owner: asString(entry.owner) || null,
      status: ["active", "at-risk", "blocked", "complete", "inactive"].includes(String(entry.status))
        ? entry.status as Workstream["status"]
        : "inactive",
    }));
}

function deriveObjective(phaseId: string): string {
  const map: Record<string, string> = {
    strategy: "Sharpen the transformation bet into measurable business outcomes.",
    mobilise: "Align sponsors, teams, and governance around the operating model.",
    discover: "Surface value pools, bottlenecks, and evidence worth acting on.",
    design: "Translate insight into human + agent capability designs.",
    agent_arch: "Define the agent system, tools, escalation, and controls.",
    build: "Package the MVP for safe delivery and engineering execution.",
    operate: "Turn the solution into a run-ready operating capability.",
    govern: "Close control gaps, approvals, and trust obligations.",
    optimize: "Find the next gains, reuse levers, and leakage fixes.",
    valuerealize: "Prove benefits, close the loop, and seed the next cycle.",
    delivery: "Keep milestones, risks, and commitments on track.",
    adoption: "Build adoption, champions, and confident human usage.",
    titan: "Model outcomes, scenarios, and signal shifts before they land.",
  };
  return map[phaseId] || "Advance the transformation with clear evidence.";
}

function formatSummary(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "No summary yet.";
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function derivePhases(data: JsonRecord): PhaseSummary[] {
  const rawPhases = asArray(data.phases);

  // Detect whether this program has real substantive agent output.
  // Agents write pct values to both data.phasePct AND data.phases[i].pct.
  // Without this guard, a newly created program can show 100% everywhere because
  // a stale/initialisation agent run wrote 100 into every phase.
  const hasAgentOutput = Boolean(
    asString(data.narrative) ||
    asRecord(data.plan).nextThreeActions ||
    asRecord(asRecord(data.strategicRoadmap).deliveryPlan).nextThreeActions ||
    asRecord(data.deck).programHealthSummary,
  );

  // Detect the "all phases at 100% with no real output" smell — clearly stale init data.
  const allStoredAt100 = rawPhases.length > 0 && rawPhases.every(
    (entry) => asNumber(asRecord(entry).pct, 0) >= 100,
  );
  const trustStoredPct = hasAgentOutput || !allStoredAt100;

  // phasePct is written by the phase-completion-estimator agent — only apply when
  // there is genuine agent output to avoid misleading values on fresh programs.
  const phasePctOverrides = hasAgentOutput ? asRecord(data.phasePct) : {};
  const fromData = new Map<string, PhaseSummary>();

  rawPhases.forEach((entry) => {
    const record = asRecord(entry);
    const id = asString(record.id);
    if (!id) return;
    const rawStoredPct = Math.max(0, Math.min(100, asNumber(record.pct, 0)));
    // Zero out storedPct when data looks like a stale initialisation artefact
    const storedPct = trustStoredPct ? rawStoredPct : 0;
    const rawAgentEstimate = id in phasePctOverrides ? Math.max(0, Math.min(100, asNumber(phasePctOverrides[id], storedPct))) : storedPct;
    // Don't let an agent estimate of 0 override a real stored progress value — agents can
    // write zeros to phasePct when they fail mid-run, which would wipe out valid progress.
    const agentEstimate = (rawAgentEstimate === 0 && storedPct > 0) ? storedPct : rawAgentEstimate;
    const pct = agentEstimate;
    fromData.set(id, {
      id,
      displayName: PHASE_LABELS[id] || id,
      pct,
      status: normalizePhaseStatus(pct),
      objective: deriveObjective(id),
    });
  });

  return PHASE_SEQUENCE.map((id) => fromData.get(id) || {
    id,
    displayName: PHASE_LABELS[id] || id,
    pct: 0,
    status: "inactive",
    objective: deriveObjective(id),
  });
}

function deriveActivePhaseId(
  phases: PhaseSummary[],
  gateReviews?: Record<string, { status?: string }>,
): string {
  // The current phase is the frontier: the first phase whose gate is NOT yet
  // approved. An approved (locked-in) gate means the phase is complete even if its
  // input pct never reached 100% — so a phase the team has gated past must never
  // be reported as current. This matches getLockedPhaseIds' sequential gating.
  if (gateReviews) {
    const frontier = phases.find((phase) => gateReviews[phase.id]?.status !== "approved");
    if (frontier) return frontier.id;
    // Every gate approved → programme complete; surface the final phase.
    if (phases.length) return phases[phases.length - 1].id;
  }
  // No gate data available — fall back to the pct-based frontier.
  const firstIncomplete = phases.find((phase) => phase.pct < 100 && phase.pct > 0);
  if (firstIncomplete) return firstIncomplete.id;
  const firstStarted = phases.find((phase) => phase.pct > 0);
  return firstStarted?.id || phases[0]?.id || "strategy";
}

/**
 * Reconcile each phase's pct-derived status with gate + frontier state. Phase
 * pct can stay 0 even after a phase is gated past (an approved gate locks a
 * phase in regardless of input pct), which would otherwise render an approved or
 * in-flight phase as "inactive". So: an approved gate ⇒ complete, and the
 * current frontier phase is never inactive (at least "active").
 */
function reconcilePhaseStatusWithGates(
  phases: PhaseSummary[],
  gateReviews: Record<string, { status?: string }>,
  activePhaseId: string,
): PhaseSummary[] {
  return phases.map((phase) => {
    if (gateReviews[phase.id]?.status === "approved") {
      return phase.status === "complete" ? phase : { ...phase, status: "complete" };
    }
    if (phase.id === activePhaseId && phase.status === "inactive") {
      return { ...phase, status: "active" };
    }
    return phase;
  });
}

/** Normalise an agent confidence (0-1 or 0-100) to a 0-100 quality score. */
function normalizeConfidenceTo100(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function deriveArtifacts(data: JsonRecord): ArtifactSummary[] {
  const phaseArtifacts = asRecord(data.phaseArtifacts);
  const items: ArtifactSummary[] = [];

  Object.entries(phaseArtifacts).forEach(([phaseId, artifactBucket]) => {
    const artifactRecord = asRecord(artifactBucket);
    Object.entries(artifactRecord).forEach(([artifactId, artifactValue]) => {
      // Delivery Plan and Milestone Review are folded into the single Strategic
      // Roadmap artifact — drop any legacy standalone ledger entries so they no
      // longer surface as separate artifacts (or trigger not-baselined flags).
      if (artifactId === "plan" || artifactId === "milestone") return;
      const entry = asRecord(artifactValue);
      const title = asString(entry.title, artifactId.replace(/_/g, " "));
      const status = asString(entry.status, "draft");
      const content = asString(entry.content);
      items.push({
        id: artifactId,
        phaseId,
        title,
        status: status === "approved" || status === "stale" || status === "archived" ? status : "draft",
        agentConfidence: normalizeConfidenceTo100(asNumber(entry.confidence ?? entry.agentConfidence, 0)),
        agentGenerated: entry.agentDrafted === true || entry.lastEditedBy === "agent",
        lastEditedBy: entry.lastEditedBy === "human" ? "human" : "agent",
        lastEditedAt: asString(entry.updatedAt ?? entry.lastEditedAt, new Date().toISOString()),
        contentSummary: formatSummary(asString(entry.contentSummary, content)),
        versionNumber: Math.max(1, Math.round(asNumber(entry.version ?? entry.versionNumber, 1))),
      });
    });
  });

  return items.sort((left, right) => (
    new Date(right.lastEditedAt).getTime() - new Date(left.lastEditedAt).getTime()
  ));
}

function normalizePriority(value: string): DecisionPriority {
  if (value === "critical" || value === "high" || value === "medium") return value;
  return "low";
}

function deriveDecisions(data: JsonRecord): DecisionSummary[] {
  const decisionQueue = asArray(data.decisionQueue).length ? asArray(data.decisionQueue) : asArray(data.decisions);
  return decisionQueue
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.id).length > 0)
    .map((entry) => ({
      id: asString(entry.id),
      title: asString(entry.title, asString(entry.type, "Decision")),
      type: asString(entry.type, "decision"),
      priority: normalizePriority(asString(entry.priority)),
      phaseId: asString(entry.phaseId || entry.phase_id, "strategy"),
      question: asString(entry.question, "Review the queued recommendation."),
      options: asArray(entry.options).map((option) => asString(option)).filter(Boolean),
      createdAt: asString(entry.createdAt || entry.created_at, new Date().toISOString()),
      runId: asString(entry.runId || entry.run_id) || undefined,
      agentId: asString(entry.agentId || entry.agent_id) || undefined,
      status: asString(entry.status, "open"),
      recommendation: asString(entry.recommendation),
      previewContent: Object.keys(asRecord(entry.previewContent || entry.preview_content)).length
        ? asRecord(entry.previewContent || entry.preview_content)
        : undefined,
      source: asString(entry.source) || undefined,
      resolvedBy: asString(entry.resolvedBy || entry.resolved_by) || undefined,
      resolvedAt: asString(entry.resolvedAt || entry.resolved_at) || undefined,
      humanNote: asString(entry.humanNote || entry.human_note) || undefined,
      modifiedContent: asString(entry.modifiedContent || entry.modified_content) || undefined,
    }))
    .sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ));
}

function deriveTwinGraph(data: JsonRecord): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
  const nested = asRecord(data.data);
  const phases = asArray(data.phases || nested.phases);
  const decisions = asArray(data.decisionQueue || data.decisions || nested.decisionQueue || nested.decisions);
  const raidLog = asRecord(data.raidLog || nested.raidLog);
  const risks = asArray(raidLog.entries || data.raidEntries || nested.raidEntries);

  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];

  phases.forEach((phase, index) => {
    const record = asRecord(phase);
    const id = asString(record.id) || `phase-${index}`;
    nodes.push({
      id,
      type: "phase",
      label: asString(record.displayName) || PHASE_LABELS[id] || id || `Phase ${index + 1}`,
      phaseCreated: id,
      properties: { pct: asNumber(record.pct), status: asString(record.status) },
    });
    if (index > 0) {
      const previousId = asString(asRecord(phases[index - 1]).id) || `phase-${index - 1}`;
      edges.push({ id: `${previousId}->${id}`, source: previousId, target: id, type: "sequence" });
    }
  });

  decisions
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.status) === "open" || !entry.status)
    .slice(0, 5)
    .forEach((entry, index) => {
      const id = asString(entry.id) || `decision-${index}`;
      const phaseId = asString(entry.phaseId || entry.phase);
      nodes.push({
        id,
        type: "decision",
        label: asString(entry.title) || asString(entry.question) || "Decision",
        phaseCreated: phaseId,
        properties: { priority: asString(entry.priority) },
      });
      if (phaseId) {
        edges.push({ id: `${phaseId}->${id}`, source: phaseId, target: id, type: "decision" });
      }
    });

  risks
    .map((entry) => asRecord(entry))
    .filter((entry) => {
      const severity = asString(entry.severity);
      return (severity === "critical" || severity === "high") && asString(entry.status) !== "closed";
    })
    .slice(0, 5)
    .forEach((entry, index) => {
      const id = asString(entry.id) || `risk-${index}`;
      const phaseId = asString(entry.phase);
      nodes.push({
        id,
        type: "risk",
        label: asString(entry.title) || "Risk",
        phaseCreated: phaseId,
        properties: { severity: asString(entry.severity) },
      });
      if (phaseId) {
        edges.push({ id: `${phaseId}->${id}`, source: phaseId, target: id, type: "risk" });
      }
    });

  return { nodes, edges };
}

// The agent occasionally emits the same RAID item twice — either with an
// identical id, or as separate uuids carrying the same type/phase/title (e.g. two
// "Team capacity shortfall" build risks). Both render as redundant rows on every
// risk/blocker surface, so collapse them at this single derivation point, keeping
// the first occurrence (insertion order is significance order from the agent).
//
// A second, subtler duplication crosses agents: capacity-shortfall risks for a
// phase are owned by the capacity-assessor's deterministic `capacity-gap-${phase}`
// entry, but the risk agent — unaware of that — sometimes restates the same gap
// for the same phase under a more specific title (e.g. "Team capacity shortfall in
// Change Management Lead role"). Drop the restatement so the gap is listed once,
// keeping the canonical capacity-gap entry as the owner.
function dedupeRAIDEntries(entries: RAIDEntry[]): RAIDEntry[] {
  const seenIds = new Set<string>();
  const seenComposite = new Set<string>();
  const deduped: RAIDEntry[] = [];
  for (const entry of entries) {
    const composite = `${entry.type}|${entry.phase}|${entry.title.trim().toLowerCase()}`;
    if (seenIds.has(entry.id) || seenComposite.has(composite)) continue;
    seenIds.add(entry.id);
    seenComposite.add(composite);
    deduped.push(entry);
  }

  const capacityTitleByPhase = new Map<string, string>();
  for (const entry of deduped) {
    if (entry.id.startsWith("capacity-gap-")) {
      capacityTitleByPhase.set(entry.phase, entry.title.trim().toLowerCase());
    }
  }
  if (capacityTitleByPhase.size === 0) return deduped;
  return deduped.filter((entry) => {
    if (entry.id.startsWith("capacity-gap-")) return true;
    const capTitle = capacityTitleByPhase.get(entry.phase);
    if (!capTitle) return true;
    const title = entry.title.trim().toLowerCase();
    return !(title.includes(capTitle) || capTitle.includes(title));
  });
}

function deriveRAIDEntries(data: JsonRecord): RAIDEntry[] {
  const raidLog = asRecord(data.raidLog);
  const newEntries = asArray(raidLog.entries)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.id).length > 0 && asString(entry.title).length > 0)
    .map((entry): RAIDEntry => {
      const typeValue = asString(entry.type);
      const statusValue = asString(entry.status);
      const sourceValue = asString(entry.source);
      const closedByValue = asString(entry.closedBy);
      const agentConfidence = asNumber(entry.agentConfidence, Number.NaN);
      return {
        id: asString(entry.id),
        type: (["risk", "blocker", "assumption", "dependency"].includes(typeValue)
          ? typeValue
          : "risk") as RAIDEntryType,
        title: asString(entry.title),
        description: asString(entry.description),
        severity: (["critical", "high", "medium", "low"].includes(asString(entry.severity))
          ? asString(entry.severity)
          : "medium") as RAIDEntry["severity"],
        phase: asString(entry.phase || entry.phaseId, "strategy"),
        owner: asString(entry.owner) || null,
        mitigation: asString(entry.mitigation) || null,
        status: (["open", "closed", "monitoring"].includes(statusValue)
          ? statusValue
          : "open") as RAIDEntryStatus,
        source: sourceValue === "human" ? "human" : "agent",
        agentConfidence: Number.isFinite(agentConfidence) ? agentConfidence : undefined,
        validatedAt: asString(entry.validatedAt) || null,
        createdAt: asString(entry.createdAt, new Date().toISOString()),
        closedAt: asString(entry.closedAt) || null,
        closedBy: closedByValue === "agent" || closedByValue === "human" ? closedByValue : null,
        closureNote: asString(entry.closureNote) || null,
        relatedArtifactId: asString(entry.relatedArtifactId) || null,
        relatedInputIds: asArray(entry.relatedInputIds)
          .map((id) => asString(id))
          .filter((id) => id.length > 0),
      };
    });

  if (newEntries.length > 0) return dedupeRAIDEntries(newEntries);

  return dedupeRAIDEntries(asArray(raidLog.risks)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.title || entry.label).length > 0)
    .map((entry, index): RAIDEntry => ({
      id: asString(entry.id, `risk-legacy-${index}`),
      type: "risk",
      title: asString(entry.title || entry.label),
      description: asString(entry.description || entry.mitigation, ""),
      severity: (["critical", "high", "medium", "low"].includes(asString(entry.severity))
        ? asString(entry.severity)
        : "medium") as RAIDEntry["severity"],
      phase: asString(entry.phaseId || entry.phase, "strategy"),
      owner: asString(entry.owner) || null,
      mitigation: asString(entry.mitigation) || null,
      status: entry.resolved === true ? "closed" : "open",
      source: "agent",
      createdAt: asString(entry.extractedAt, new Date().toISOString()),
      closedAt: null,
      closedBy: null,
      closureNote: null,
    })));
}

function deriveMilestones(data: JsonRecord): Milestone[] {
  // Tracked milestones are folded into the Strategic Roadmap; fall back to the
  // legacy top-level array for programs last written before the fold.
  const roadmap = asRecord(data.strategicRoadmap);
  const source = asArray(roadmap.milestones).length ? asArray(roadmap.milestones) : asArray(data.milestones);
  return source
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.id).length > 0 && asString(entry.title).length > 0)
    .map((entry): Milestone => {
      const statusValue = asString(entry.status);
      const sourceValue = asString(entry.source);
      const confidence = asNumber(entry.confidence, Number.NaN);
      return {
        id: asString(entry.id),
        title: asString(entry.title),
        phaseId: asString(entry.phaseId || entry.phase, "strategy"),
        targetDate: asString(entry.targetDate || entry.dueDate) || null,
        status: (["on-track", "at-risk", "delayed", "complete"].includes(statusValue)
          ? statusValue
          : "on-track") as Milestone["status"],
        dependsOn: asArray(entry.dependsOn).map((value) => asString(value)).filter(Boolean),
        exitCriteria: asArray(entry.exitCriteria).map((value) => asString(value)).filter(Boolean),
        confidence: Number.isFinite(confidence)
          ? Math.max(0, Math.min(1, confidence))
          : 0.65,
        source: sourceValue === "human" ? "human" : "agent",
        lastUpdatedAt: asString(entry.lastUpdatedAt || entry.updatedAt || entry.createdAt, new Date().toISOString()),
      };
    });
}

function deriveGateReviews(data: JsonRecord): Record<string, GateReview> {
  const gateReviews = asRecord(data.gateReviews);
  return Object.entries(gateReviews).reduce<Record<string, GateReview>>((accumulator, [phaseId, value]) => {
    const entry = asRecord(value);
    const statusValue = asString(entry.status, "not-ready");
    const artifactsSummary = asArray(entry.artifactsSummary)
      .map((artifact) => asRecord(artifact))
      .filter((artifact) => asString(artifact.name).length > 0)
      .map((artifact): GateArtifact => ({
        name: asString(artifact.name),
        status: (["complete", "partial", "missing"].includes(asString(artifact.status))
          ? asString(artifact.status)
          : "missing") as GateArtifact["status"],
        confidence: Math.max(0, Math.min(1, asNumber(artifact.confidence, 0))),
      }));
    const exitCriteriaStatus = asArray(entry.exitCriteriaStatus)
      .map((criterion) => asRecord(criterion))
      .filter((criterion) => asString(criterion.criterion).length > 0)
      .map((criterion): ExitCriterion => ({
        criterion: asString(criterion.criterion),
        met: criterion.met === true,
        evidence: asString(criterion.evidence) || null,
      }));

    accumulator[phaseId] = {
      phaseId: asString(entry.phaseId, phaseId),
      phaseName: asString(entry.phaseName, PHASE_LABELS[phaseId] || phaseId),
      status: ([
        "not-ready",
        "ready",
        "approved",
        "remediation-requested",
      ].includes(statusValue)
        ? statusValue
        : "not-ready") as GateReview["status"],
      // readinessScore is stored as 0–100 (percentage) in some records and 0–1
      // (fraction) in others. Normalise to 0–100 so all consumers (ring chart,
      // Governance view, phaseReadiness gauge) treat it consistently as a percentage.
      readinessScore: (() => {
        const raw = asNumber(entry.readinessScore, 0);
        return Math.round(Math.max(0, Math.min(100, raw > 1 ? raw : raw * 100)));
      })(),
      artifactsSummary,
      openDecisions: Math.max(0, Math.round(asNumber(entry.openDecisions, 0))),
      openRisks: Math.max(0, Math.round(asNumber(entry.openRisks, 0))),
      exitCriteriaStatus,
      recommendation: asString(entry.recommendation),
      generatedAt: asString(entry.generatedAt, new Date().toISOString()),
      approvedAt: asString(entry.approvedAt) || null,
      approvedBy: asString(entry.approvedBy) || null,
      remediationNote: asString(entry.remediationNote) || null,
    };

    return accumulator;
  }, {});
}

function deriveEscalations(data: JsonRecord): Escalation[] {
  return asArray(data.escalations)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.id).length > 0 && asString(entry.title).length > 0)
    .map((entry): Escalation => {
      const typeValue = asString(entry.type, "critical-blocker");
      const severityValue = asString(entry.severity, "high");
      const statusValue = asString(entry.status, "open");
      return {
        id: asString(entry.id),
        type: ([
          "stale-decision",
          "phase-stalled",
          "critical-blocker",
          "milestone-slipping",
        ].includes(typeValue)
          ? typeValue
          : "critical-blocker") as Escalation["type"],
        severity: (["high", "critical"].includes(severityValue)
          ? severityValue
          : "high") as Escalation["severity"],
        title: asString(entry.title),
        summary: asString(entry.summary),
        costOfDelay: asString(entry.costOfDelay),
        linkedDecisionId: asString(entry.linkedDecisionId) || null,
        linkedPhaseId: asString(entry.linkedPhaseId || entry.phaseId) || null,
        linkedRiskId: asString(entry.linkedRiskId) || null,
        raisedAt: asString(entry.raisedAt, new Date().toISOString()),
        acknowledgedAt: asString(entry.acknowledgedAt) || null,
        resolvedAt: asString(entry.resolvedAt) || null,
        status: (["open", "acknowledged", "resolved"].includes(statusValue)
          ? statusValue
          : "open") as Escalation["status"],
        source: "agent",
      };
    })
    .sort((left, right) => new Date(right.raisedAt).getTime() - new Date(left.raisedAt).getTime());
}

function deriveClosure(data: JsonRecord): ProgramClosure | null {
  const closure = asRecord(data.closure);
  if (!Object.keys(closure).length) return null;

  const statusValue = asString(closure.status, "not-ready");
  const benefitsSummaryRecord = asRecord(closure.benefitsSummary);
  const benefitsSummary = Object.keys(benefitsSummaryRecord).length
    ? ({
        planned: asString(benefitsSummaryRecord.planned),
        realised: asString(benefitsSummaryRecord.realised),
        gap: asString(benefitsSummaryRecord.gap),
        commentary: asString(benefitsSummaryRecord.commentary),
      } satisfies ClosureBenefitSummary)
    : null;
  const lessonsLearned = asArray(closure.lessonsLearned)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.lesson).length > 0)
    .map((entry): LessonLearned => ({
      category: (["process", "technology", "people", "governance"].includes(asString(entry.category))
        ? asString(entry.category)
        : "process") as LessonLearned["category"],
      lesson: asString(entry.lesson),
      source: asString(entry.source, "cross-program"),
      applicability: asString(entry.applicability),
    }));
  const keyArtifacts = asArray(closure.keyArtifacts)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.name).length > 0)
    .map((entry): ClosureArtifact => ({
      name: asString(entry.name),
      phaseId: asString(entry.phaseId, "program"),
      confidenceAtClose: Math.max(0, Math.min(1, asNumber(entry.confidenceAtClose, 0))),
    }));

  return {
    status: (["not-ready", "ready", "approved", "archived"].includes(statusValue)
      ? statusValue
      : "not-ready") as ProgramClosure["status"],
    readinessScore: Math.max(0, Math.min(1, asNumber(closure.readinessScore, 0))),
    notReadyReason: asString(closure.notReadyReason) || undefined,
    benefitsSummary,
    lessonsLearned,
    keyArtifacts,
    recommendations: asArray(closure.recommendations).map((entry) => asString(entry)).filter(Boolean),
    closureDecisionId: asString(closure.closureDecisionId) || null,
    approvedAt: asString(closure.approvedAt) || null,
    approvedBy: asString(closure.approvedBy) || null,
    archivedAt: asString(closure.archivedAt) || null,
    generatedAt: asString(closure.generatedAt, new Date().toISOString()),
    confidence: Math.max(0, Math.min(1, asNumber(closure.confidence, 0))),
  };
}

function deriveChangeImpact(data: JsonRecord): ChangeImpactAssessment | null {
  const value = asRecord(data.changeImpact);
  if (!Object.keys(value).length) return null;

  const impactedGroups = asArray(value.impactedGroups)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.group).length > 0)
    .map((entry): ChangeImpactGroup => ({
      group: asString(entry.group),
      impactLevel: (["critical", "high", "medium", "low"].includes(asString(entry.impactLevel))
        ? asString(entry.impactLevel)
        : "medium") as ChangeImpactGroup["impactLevel"],
      changeType: (["process", "technology", "culture", "structural"].includes(asString(entry.changeType))
        ? asString(entry.changeType)
        : "process") as ChangeImpactGroup["changeType"],
      affectedHeadcount: entry.affectedHeadcount == null ? null : Math.max(0, Math.round(asNumber(entry.affectedHeadcount, 0))),
      readinessScore: Math.max(0, Math.min(1, asNumber(entry.readinessScore, 0))),
      interventions: asArray(entry.interventions).map((item) => asString(item)).filter(Boolean).slice(0, 6),
      owner: asString(entry.owner) || null,
    }));

  return {
    impactedGroups,
    overallChangeLoad: (["high", "medium", "low"].includes(asString(value.overallChangeLoad))
      ? asString(value.overallChangeLoad)
      : "medium") as ChangeImpactAssessment["overallChangeLoad"],
    peakChangeWindow: asString(value.peakChangeWindow),
    resistanceRisk: (["high", "medium", "low"].includes(asString(value.resistanceRisk))
      ? asString(value.resistanceRisk)
      : "medium") as ChangeImpactAssessment["resistanceRisk"],
    topInterventions: asArray(value.topInterventions).map((item) => asString(item)).filter(Boolean).slice(0, 5),
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    summary: asString(value.summary),
  };
}

function deriveStakeholders(data: JsonRecord): StakeholderProfile[] {
  return asArray(data.stakeholders)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.id).length > 0 && asString(entry.name).length > 0)
    .map((entry): StakeholderProfile => ({
      id: asString(entry.id),
      name: asString(entry.name),
      role: asString(entry.role),
      organisation: asString(entry.organisation) || null,
      influence: (["high", "medium", "low"].includes(asString(entry.influence))
        ? asString(entry.influence)
        : "medium") as StakeholderProfile["influence"],
      interest: (["high", "medium", "low"].includes(asString(entry.interest))
        ? asString(entry.interest)
        : "medium") as StakeholderProfile["interest"],
      currentEngagement: (["champion", "supportive", "neutral", "resistant", "unknown"].includes(asString(entry.currentEngagement))
        ? asString(entry.currentEngagement)
        : "unknown") as StakeholderProfile["currentEngagement"],
      targetEngagement: (["champion", "supportive", "neutral"].includes(asString(entry.targetEngagement))
        ? asString(entry.targetEngagement)
        : "supportive") as StakeholderProfile["targetEngagement"],
      sentiment: (["positive", "neutral", "negative", "unknown"].includes(asString(entry.sentiment))
        ? asString(entry.sentiment)
        : "unknown") as StakeholderProfile["sentiment"],
      riskOfDisengagement: (["high", "medium", "low"].includes(asString(entry.riskOfDisengagement))
        ? asString(entry.riskOfDisengagement)
        : "medium") as StakeholderProfile["riskOfDisengagement"],
      recommendedActions: asArray(entry.recommendedActions).map((item) => asString(item)).filter(Boolean).slice(0, 3),
      owner: asString(entry.owner) || null,
      source: asString(entry.source) === "human" ? "human" : "agent",
    }))
    .sort((left, right) => {
      const influenceWeight = { high: 3, medium: 2, low: 1 };
      const interestWeight = { high: 3, medium: 2, low: 1 };
      return (
        (influenceWeight[right.influence] + interestWeight[right.interest])
        - (influenceWeight[left.influence] + interestWeight[left.interest])
      );
    });
}

function deriveAdoption(data: JsonRecord): AdoptionAssessment | null {
  const value = asRecord(data.adoption);
  if (!Object.keys(value).length) return null;

  const adoptionGroups = asArray(value.adoptionGroups)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.group).length > 0)
    .map((entry): AdoptionGroup => ({
      group: asString(entry.group),
      adoptionRate: Math.max(0, Math.min(1, asNumber(entry.adoptionRate, 0))),
      trainingCompletion: Math.max(0, Math.min(1, asNumber(entry.trainingCompletion, 0))),
      toolUtilisation: Math.max(0, Math.min(1, asNumber(entry.toolUtilisation, 0))),
      readinessGap: (["high", "medium", "low", "none"].includes(asString(entry.readinessGap))
        ? asString(entry.readinessGap)
        : "medium") as AdoptionGroup["readinessGap"],
      barriers: asArray(entry.barriers).map((item) => asString(item)).filter(Boolean).slice(0, 6),
      recommendedInterventions: asArray(entry.recommendedInterventions).map((item) => asString(item)).filter(Boolean).slice(0, 3),
    }));

  return {
    adoptionGroups,
    overallAdoptionRate: Math.max(0, Math.min(1, asNumber(value.overallAdoptionRate, 0))),
    adoptionTrend: (["improving", "stable", "declining", "unknown"].includes(asString(value.adoptionTrend))
      ? asString(value.adoptionTrend)
      : "unknown") as AdoptionAssessment["adoptionTrend"],
    criticalAdoptionRisks: asArray(value.criticalAdoptionRisks).map((item) => asString(item)).filter(Boolean).slice(0, 6),
    goLiveReadiness: (["ready", "at-risk", "not-ready"].includes(asString(value.goLiveReadiness))
      ? asString(value.goLiveReadiness)
      : "at-risk") as AdoptionAssessment["goLiveReadiness"],
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    summary: asString(value.summary),
  };
}

function deriveHealthHeatmap(data: JsonRecord): HealthHeatmapSummary | null {
  const value = asRecord(data.healthHeatmap);
  if (!Object.keys(value).length) return null;

  const phaseHealth = asArray(value.phaseHealth)
    .map((entry) => asRecord(entry))
    .filter((entry) => asString(entry.phaseId).length > 0)
    .map((entry): HealthHeatmapPhase => ({
      phaseId: asString(entry.phaseId),
      phaseName: asString(entry.phaseName, PHASE_LABELS[asString(entry.phaseId)] || asString(entry.phaseId)),
      rag: (["green", "amber", "red", "grey"].includes(asString(entry.rag))
        ? asString(entry.rag)
        : "grey") as HealthHeatmapPhase["rag"],
      score: Math.max(0, Math.min(100, Math.round(asNumber(entry.score, 0)))),
      confidence: Math.max(0, Math.min(1, asNumber(entry.confidence, 0))),
      healthNote: formatSummary(asString(entry.healthNote)).slice(0, 120),
      topRisk: asString(entry.topRisk) || null,
    }));

  return {
    phaseHealth,
    overallHealthScore: Math.max(0, Math.min(100, Math.round(asNumber(value.overallHealthScore, 0)))),
    overallRag: (["green", "amber", "red"].includes(asString(value.overallRag))
      ? asString(value.overallRag)
      : "amber") as HealthHeatmapSummary["overallRag"],
    trend: (["improving", "stable", "declining"].includes(asString(value.trend))
      ? asString(value.trend)
      : "stable") as HealthHeatmapSummary["trend"],
    programMomentum: (["accelerating", "steady", "slowing", "stalled"].includes(asString(value.programMomentum))
      ? asString(value.programMomentum)
      : "steady") as HealthHeatmapSummary["programMomentum"],
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    summary: asString(value.summary),
  };
}

function deriveRetros(data: JsonRecord): Record<string, PhaseRetro> {
  const retros = asRecord(data.retros);
  return Object.entries(retros).reduce<Record<string, PhaseRetro>>((accumulator, [phaseId, value]) => {
    const entry = asRecord(value);
    if (!Object.keys(entry).length) return accumulator;

    const wentWell = asArray(entry.wentWell)
      .map((item) => asRecord(item))
      .filter((item) => asString(item.observation).length > 0)
      .map((item): RetroObservation => ({
        observation: asString(item.observation),
        impact: asString(item.impact),
        category: (["people", "process", "technology", "governance"].includes(asString(item.category))
          ? asString(item.category)
          : "process") as RetroObservation["category"],
      }));

    const improvements = asArray(entry.improvements)
      .map((item) => asRecord(item))
      .filter((item) => asString(item.observation).length > 0)
      .map((item): RetroImprovement => ({
        observation: asString(item.observation),
        rootCause: asString(item.rootCause),
        category: (["people", "process", "technology", "governance"].includes(asString(item.category))
          ? asString(item.category)
          : "process") as RetroImprovement["category"],
      }));

    const actionItems = asArray(entry.actionItems)
      .map((item) => asRecord(item))
      .filter((item) => asString(item.action).length > 0)
      .map((item): RetroActionItem => ({
        action: asString(item.action),
        owner: asString(item.owner) || null,
        targetPhase: asString(item.targetPhase),
        priority: (["high", "medium", "low"].includes(asString(item.priority))
          ? asString(item.priority)
          : "medium") as RetroActionItem["priority"],
        effort: (["high", "medium", "low"].includes(asString(item.effort))
          ? asString(item.effort)
          : "medium") as RetroActionItem["effort"],
      }));

    accumulator[phaseId] = {
      wentWell,
      improvements,
      actionItems,
      overallSentiment: (["positive", "mixed", "negative"].includes(asString(entry.overallSentiment))
        ? asString(entry.overallSentiment)
        : "mixed") as PhaseRetro["overallSentiment"],
      healthScore: Math.max(0, Math.min(100, Math.round(asNumber(entry.healthScore, 0)))),
      keyLearning: formatSummary(asString(entry.keyLearning)).slice(0, 150),
      confidence: Math.max(0, Math.min(1, asNumber(entry.confidence, 0))),
    };
    return accumulator;
  }, {});
}

function deriveRetrosGeneratedAt(data: JsonRecord, retros: Record<string, PhaseRetro>): Record<string, string> {
  const generatedAt = asRecord(data.retrosGeneratedAt);
  return Object.entries(retros).reduce<Record<string, string>>((accumulator, [phaseId]) => {
    accumulator[phaseId] = asString(generatedAt[phaseId], "");
    return accumulator;
  }, {});
}

function deriveDeck(data: JsonRecord): ExecutiveDeck | null {
  const value = asRecord(data.deck);
  if (!Object.keys(value).length) return null;

  const slides = asArray(value.slides)
    .map((item) => asRecord(item))
    .filter((item) => asString(item.title).length > 0)
    .map((item, index) => ({
      slideNumber: Math.max(1, Math.round(asNumber(item.slideNumber, index + 1))),
      title: asString(item.title),
      type: ([
        "title",
        "executive-summary",
        "status",
        "financials",
        "risks",
        "milestones",
        "decisions",
        "achievements",
        "next-steps",
        "appendix",
      ].includes(asString(item.type))
        ? asString(item.type)
        : "status") as ExecutiveDeck["slides"][number]["type"],
      talkingPoints: asArray(item.talkingPoints).map((entry) => asString(entry)).filter(Boolean).slice(0, 4),
      dataCallouts: asArray(item.dataCallouts).map((entry) => asString(entry)).filter(Boolean).slice(0, 5),
      recommendedVisual: asString(item.recommendedVisual) || null,
      speakerNotes: asString(item.speakerNotes),
    }))
    .sort((left, right) => left.slideNumber - right.slideNumber);

  return {
    title: asString(value.title, "Executive Program Update"),
    audience: asString(value.audience, "Executive Steering Group"),
    slides,
    generatedAt: asString(value.generatedAt, new Date().toISOString()),
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    programHealthSummary: asString(value.programHealthSummary),
  };
}

function deriveScopePcr(data: JsonRecord): ScopePcrSummary | null {
  const value = asRecord(data.scopePcr);
  if (!Object.keys(value).length) return null;

  const scopeSignals = asArray(value.scopeSignals)
    .map((item) => asRecord(item))
    .filter((item) => asString(item.id).length > 0 && asString(item.description).length > 0)
    .map((item): ScopeSignal => ({
      id: asString(item.id),
      description: asString(item.description),
      source: (["decision", "risk", "phase-evidence", "stakeholder"].includes(asString(item.source))
        ? asString(item.source)
        : "decision") as ScopeSignal["source"],
      phase: asString(item.phase, "program"),
      severity: (["critical", "high", "medium", "low"].includes(asString(item.severity))
        ? asString(item.severity)
        : "medium") as ScopeSignal["severity"],
      impactOnTimeline: asString(item.impactOnTimeline) || null,
      impactOnBudget: asString(item.impactOnBudget) || null,
      recommendPcr: item.recommendPcr === true,
      pcrRationale: asString(item.pcrRationale) || null,
    }));

  return {
    scopeSignals,
    overallScopeRisk: (["high", "medium", "low", "contained"].includes(asString(value.overallScopeRisk))
      ? asString(value.overallScopeRisk)
      : "contained") as ScopePcrSummary["overallScopeRisk"],
    recommendedActions: asArray(value.recommendedActions).map((item) => asString(item)).filter(Boolean).slice(0, 5),
    openPcrCount: Math.max(0, Math.round(asNumber(value.openPcrCount, 0))),
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    summary: asString(value.summary),
  };
}

function deriveBenefitsTracking(data: JsonRecord): BenefitsTrackingSummary | null {
  const value = asRecord(data.benefitsTracking);
  if (!Object.keys(value).length) return null;
  return {
    overallRag: (["green", "amber", "red"].includes(asString(value.overallRag))
      ? asString(value.overallRag)
      : "amber") as BenefitsTrackingSummary["overallRag"],
    summary: asString(value.summary),
    kpis: asArray(value.kpis)
      .map((entry) => asRecord(entry))
      .filter((entry) => asString(entry.name).length > 0)
      .map((entry) => ({
        name: asString(entry.name),
        baseline: asString(entry.baseline),
        target: asString(entry.target),
        current: asString(entry.current),
        rag: (["green", "amber", "red", "unknown"].includes(asString(entry.rag))
          ? asString(entry.rag)
          : "unknown") as BenefitsTrackingSummary["kpis"][number]["rag"],
        trend: (["improving", "stable", "declining", "unknown"].includes(asString(entry.trend))
          ? asString(entry.trend)
          : "unknown") as BenefitsTrackingSummary["kpis"][number]["trend"],
        commentary: asString(entry.commentary),
      })),
    atRisk: asArray(value.atRisk).map((entry) => asString(entry)).filter(Boolean),
    onTrack: asArray(value.onTrack).map((entry) => asString(entry)).filter(Boolean),
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    trackedAt: asString(value.trackedAt, new Date().toISOString()),
  };
}

function deriveBenchmarkComparison(data: JsonRecord): BenchmarkComparisonSummary | null {
  const value = asRecord(data.benchmarkComparison);
  if (!Object.keys(value).length) return null;
  return {
    comparisons: asArray(value.comparisons)
      .map((entry) => asRecord(entry))
      .filter((entry) => asString(entry.dimension).length > 0)
      .map((entry) => ({
        dimension: asString(entry.dimension),
        programValue: asString(entry.programValue),
        benchmarkRange: asString(entry.benchmarkRange),
        percentile: (["bottom 25%", "middle 50%", "top 25%"].includes(asString(entry.percentile))
          ? asString(entry.percentile)
          : "middle 50%") as BenchmarkComparisonSummary["comparisons"][number]["percentile"],
        signal: (["concerning", "normal", "strong"].includes(asString(entry.signal))
          ? asString(entry.signal)
          : "normal") as BenchmarkComparisonSummary["comparisons"][number]["signal"],
        insight: asString(entry.insight),
      })),
    overallPositioning: (["below average", "average", "above average"].includes(asString(value.overallPositioning))
      ? asString(value.overallPositioning)
      : "average") as BenchmarkComparisonSummary["overallPositioning"],
    keyRisks: asArray(value.keyRisks).map((entry) => asString(entry)).filter(Boolean),
    keyStrengths: asArray(value.keyStrengths).map((entry) => asString(entry)).filter(Boolean),
    summary: asString(value.summary),
    confidence: Math.max(0, Math.min(1, asNumber(value.confidence, 0))),
    sampleSize: Math.max(0, Math.round(asNumber(value.sampleSize, 0))),
    comparedAt: asString(value.comparedAt, new Date().toISOString()),
  };
}

function deriveWeeklyDigest(data: JsonRecord): WeeklyDigestSummary | null {
  const value = asRecord(data.weeklyDigest);
  if (!Object.keys(value).length) return null;
  return {
    weekSummary: asString(value.weekSummary),
    topPriorities: asArray(value.topPriorities)
      .map((entry) => asRecord(entry))
      .filter((entry) => asString(entry.priority).length > 0)
      .map((entry) => ({
        priority: asString(entry.priority),
        reason: asString(entry.reason),
        owner: asString(entry.owner) || undefined,
      })),
    atRisk: asArray(value.atRisk)
      .map((entry) => asRecord(entry))
      .filter((entry) => asString(entry.item).length > 0)
      .map((entry) => ({
        item: asString(entry.item),
        severity: (["critical", "high"].includes(asString(entry.severity))
          ? asString(entry.severity)
          : "high") as WeeklyDigestSummary["atRisk"][number]["severity"],
        mitigationSuggestion: asString(entry.mitigationSuggestion),
      })),
    decisionsNeeded: asArray(value.decisionsNeeded).map((entry) => asString(entry)).filter(Boolean),
    lastWeekHighlights: asArray(value.lastWeekHighlights).map((entry) => asString(entry)).filter(Boolean),
    weekHealthRag: (["green", "amber", "red"].includes(asString(value.weekHealthRag))
      ? asString(value.weekHealthRag)
      : "amber") as WeeklyDigestSummary["weekHealthRag"],
    motivationalNote: asString(value.motivationalNote),
    generatedAt: asString(value.generatedAt, new Date().toISOString()),
    weekOf: asString(value.weekOf),
  };
}

export function deriveNarrative(program: ProgramSummary, activeRuns: AgentRun[] = []): string {
  const running = activeRuns.filter((run) => run.status === "running").length;
  const paused = activeRuns.filter((run) => run.status === "paused").length;
  const readinessLabel = program.readiness >= 75 ? "ready to advance" : program.readiness >= 45 ? "gaining strength" : "still fragile";
  const valueSentence = program.valueProjected > 0
    ? `The current projected value is ${formatCurrency(program.valueProjected)} with ${formatCurrency(program.valueDelivered)} delivered so far.`
    : "Value projections are still being established.";
  return `${program.name} is currently in ${program.activePhaseName} and is ${readinessLabel}. ${valueSentence} ${running > 0 ? `${running} agents are actively working.` : "No agents are actively running."}${paused > 0 ? ` ${paused} agent decisions are waiting for human review.` : ""}`;
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function normalizeProgram(row: ProgramRowLike): ProgramSummary {
  const wrapper = asRecord(row.data);
  const innerData = asRecord(wrapper.data ?? wrapper);
  const meta = asRecord(innerData.projectMeta);
  // Strategy phase inputs are the source of truth for sponsor/objective the user
  // captures in the Strategy stage; projectMeta only carries them when seeded at
  // setup. Mirror the edge's resolution order (strategyInputs → inner → meta).
  const strategyInputs = asRecord(asRecord(innerData.phaseInputs).strategy);
  const raidLog = asRecord(innerData.raidLog);
  const rawPhases = derivePhases(innerData);
  const artifacts = deriveArtifacts(innerData);
  const decisions = deriveDecisions(innerData);
  const raidEntries = deriveRAIDEntries(innerData);
  const risks = raidEntries
    .filter((entry) => entry.status === "open" && (entry.type === "risk" || entry.type === "blocker"))
    .map((entry): RiskSummary => ({
      id: entry.id,
      label: entry.title,
      severity: entry.severity,
      owner: entry.owner ?? undefined,
      action: entry.mitigation ?? undefined,
      actionView: "work" as AppView,
    }));
  const gateReviews = deriveGateReviews(innerData);
  const activePhaseId = deriveActivePhaseId(rawPhases, gateReviews);
  const phases = reconcilePhaseStatusWithGates(rawPhases, gateReviews, activePhaseId);
  const businessCase = asRecord(innerData.businessCase);
  const valueRealizeData = asRecord(innerData.valueRealizeData);
  const narrative = asString(innerData.narrative, "");
  const narrativeGeneratedAt = asString(innerData.narrativeGeneratedAt, "");
  const narrativeConfidenceValue = asNumber(innerData.narrativeConfidence, Number.NaN);
  // The delivery plan is folded into the Strategic Roadmap (strategicRoadmap.deliveryPlan);
  // fall back to the legacy top-level plan for programs last written before the fold.
  const roadmapContainer = asRecord(innerData.strategicRoadmap);
  const planSource = roadmapContainer.deliveryPlan && typeof roadmapContainer.deliveryPlan === "object" && !Array.isArray(roadmapContainer.deliveryPlan)
    ? roadmapContainer.deliveryPlan
    : innerData.plan;
  const plan = planSource && typeof planSource === "object" && !Array.isArray(planSource)
    ? planSource as unknown as PlanSummary
    : null;
  const planGeneratedAt = asString(innerData.planGeneratedAt, "");
  const planConfidenceValue = asNumber(innerData.planConfidence, Number.NaN);
  const milestones = deriveMilestones(innerData);
  const milestonesGeneratedAt = asString(innerData.milestonesGeneratedAt) || null;
  const budgetTracking = innerData.budgetTracking && typeof innerData.budgetTracking === "object" && !Array.isArray(innerData.budgetTracking)
    ? innerData.budgetTracking as unknown as BudgetTracking
    : null;
  const criticalPath = innerData.criticalPath && typeof innerData.criticalPath === "object" && !Array.isArray(innerData.criticalPath)
    ? innerData.criticalPath as unknown as CriticalPathAnalysis
    : null;
  const escalations = deriveEscalations(innerData);
  const closure = deriveClosure(innerData);
  const changeImpact = deriveChangeImpact(innerData);
  const stakeholders = deriveStakeholders(innerData);
  const adoption = deriveAdoption(innerData);
  const healthHeatmap = deriveHealthHeatmap(innerData);
  const retros = deriveRetros(innerData);
  const deck = deriveDeck(innerData);
  const scopePcr = deriveScopePcr(innerData);
  const benefitsTracking = deriveBenefitsTracking(innerData);
  const benchmarkComparison = deriveBenchmarkComparison(innerData);
  const weeklyDigest = deriveWeeklyDigest(innerData);
  const workstreams = deriveWorkstreams(innerData);
  const retrosGeneratedAt = deriveRetrosGeneratedAt(innerData, retros);
  const rawTwinGraph = {
    nodes: asArray(innerData.twinGraph ? asRecord(innerData.twinGraph).nodes : []).map((entry) => asRecord(entry)),
    edges: asArray(innerData.twinGraph ? asRecord(innerData.twinGraph).edges : []).map((entry) => asRecord(entry)),
  };
  const twinGraph = rawTwinGraph.nodes.length ? rawTwinGraph : deriveTwinGraph(innerData);
  const valueDelivered = parseMoneyMagnitude(
    valueRealizeData.valueDelivered ?? innerData.valueDelivered ?? businessCase.valueDelivered,
  );
  const valueProjected = parseMoneyMagnitude(
    businessCase.projectedValue ?? innerData.projectedValue ?? valueRealizeData.projectedValue,
  );

  const program: ProgramSummary = {
    id: row.id,
    name: row.name || asString(meta.name, "Untitled Program"),
    client: row.client || asString(meta.client),
    industry: row.industry || asString(meta.industry, "Transformation Program"),
    sponsor: asString(
      strategyInputs.sponsor || innerData.sponsor || meta.sponsor || meta.executiveSponsor,
      "Sponsor pending",
    ),
    objective: asString(innerData.objective || meta.objective || innerData.programObjective, "Define the highest-value next move."),
    readiness: Math.round(phases.reduce((sum, phase) => sum + phase.pct, 0) / Math.max(phases.length, 1)),
    valueDelivered,
    valueProjected,
    phases,
    activePhaseId,
    activePhaseName: PHASE_LABELS[activePhaseId] || activePhaseId,
    narrative,
    narrativeGeneratedAt,
    narrativeConfidence: Number.isFinite(narrativeConfidenceValue) ? narrativeConfidenceValue : undefined,
    plan,
    planGeneratedAt,
    planConfidence: Number.isFinite(planConfidenceValue) ? planConfidenceValue : undefined,
    milestones,
    milestonesGeneratedAt,
    budgetTracking,
    budgetGeneratedAt: asString(innerData.budgetGeneratedAt) || null,
    criticalPath,
    criticalPathGeneratedAt: asString(innerData.criticalPathGeneratedAt) || null,
    gateReviews,
    escalations,
    escalationsLastCheckedAt: asString(innerData.escalationsLastCheckedAt) || null,
    closure,
    closureGeneratedAt: asString(innerData.closureGeneratedAt) || null,
    changeImpact,
    changeImpactGeneratedAt: asString(innerData.changeImpactGeneratedAt) || null,
    stakeholders,
    stakeholderGeneratedAt: asString(innerData.stakeholderGeneratedAt) || null,
    adoption,
    adoptionGeneratedAt: asString(innerData.adoptionGeneratedAt) || null,
    healthHeatmap,
    healthHeatmapGeneratedAt: asString(innerData.healthHeatmapGeneratedAt) || null,
    retros,
    retrosGeneratedAt,
    deck,
    deckGeneratedAt: asString(innerData.deckGeneratedAt) || null,
    discoveryGuideGeneratedAt: asString(asRecord(innerData.discoveryGuide).generatedAt) || null,
    scopePcr,
    scopePcrGeneratedAt: asString(innerData.scopePcrGeneratedAt) || null,
    benefitsTracking,
    benchmarkComparison,
    weeklyDigest,
    methodology: (asString(innerData.methodology) || "atos-standard") as ProgramSummary["methodology"],
    workstreams,
    patternExtractGeneratedAt: asString(innerData.patternExtractGeneratedAt) || null,
    patternExtractCount: typeof innerData.patternExtractCount === "number" ? innerData.patternExtractCount : 0,
    patternQueryCache: Array.isArray(innerData.patternQueryCache)
      ? (innerData.patternQueryCache.filter(isRecord) as Record<string, unknown>[])
      : [],
    patternQueryCachedAt: asString(innerData.patternQueryCachedAt) || null,
    patternLibrary: [],
    similarPatterns: [],
    agentEvents: [],
    artifactHistory: [],
    autonomySettings: [],
    autonomyLog: [],
    decisionQueue: decisions,
    artifacts,
    risks,
    raidEntries,
    raidGeneratedAt: asString(raidLog.generatedAt, ""),
    twinGraph,
    rawData: wrapper as Record<string, unknown>,
    updatedAt: row.updated_at ?? "",
  };
  return program;
}

export function buildAgentCards(program: ProgramSummary | null, runs: AgentRun[]): AgentCardModel[] {
  if (!program) return [];
  const artifactByPhase = new Map<string, ArtifactSummary[]>();
  program.artifacts.forEach((artifact) => {
    artifactByPhase.set(artifact.phaseId, [...(artifactByPhase.get(artifact.phaseId) || []), artifact]);
  });
  const latestByPhase = new Map<string, AgentRun>();
  runs.forEach((run) => {
    if (!latestByPhase.has(run.phase_id)) {
      latestByPhase.set(run.phase_id, run);
    }
  });

  return program.phases
    .map((phase) => {
      const run = latestByPhase.get(phase.id);
      const phaseArtifacts = artifactByPhase.get(phase.id) || [];
      const lastArtifact = phaseArtifacts[0]?.title;
      const pauseDecision = program.decisionQueue.find((decision) => decision.phaseId === phase.id && decision.runId === run?.id);
      return {
        agentId: run?.agent_id || phase.id,
        phaseId: phase.id,
        displayName: phase.displayName,
        status: normalizeRunStatus(run?.status),
        currentTask: extractRunTask(run),
        confidence: typeof run?.confidence === "number" ? run.confidence : undefined,
        lastArtifact,
        pendingDecision: pauseDecision?.question,
        pauseReason: typeof run?.error_message === "string" && run.error_message ? run.error_message : pauseDecision?.title,
        run,
      } satisfies AgentCardModel;
    })
    .filter((card) => card.status !== "idle" || card.lastArtifact || card.phaseId === program.activePhaseId)
    .sort((left, right) => statusSort(left.status) - statusSort(right.status));
}

function normalizeRunStatus(status: string | undefined): AgentCardModel["status"] {
  if (status === "running" || status === "paused" || status === "complete" || status === "failed") return status;
  return "idle";
}

function extractRunTask(run: AgentRun | undefined): string | undefined {
  if (!run) return undefined;
  if (typeof run.trigger_event === "string" && run.trigger_event) {
    return run.status === "running"
      ? `Working on ${run.trigger_event.replace(/_/g, " ")}`
      : `Last triggered by ${run.trigger_event.replace(/_/g, " ")}`;
  }
  return run.status === "running" ? "Running phase workflow" : undefined;
}

function statusSort(status: AgentCardModel["status"]): number {
  switch (status) {
    case "running":
      return 0;
    case "paused":
      return 1;
    case "failed":
      return 2;
    case "complete":
      return 3;
    default:
      return 4;
  }
}

export function buildNudges(program: ProgramSummary | null, runs: AgentRun[]): NudgeSummary[] {
  if (!program) return [];
  const items: NudgeSummary[] = [];
  if (program.readiness < 60) {
    items.push({
      id: "readiness-warning",
      type: "warning",
      message: `${program.activePhaseName} needs attention. Resolve blockers before moving the program forward.`,
      priority: "high",
      actionLabel: "Open work",
      actionView: "work",
    });
  }
  const unresolvedHigh = program.decisionQueue.filter((decision) => decision.priority === "critical" || decision.priority === "high").length;
  if (unresolvedHigh > 0) {
    items.push({
      id: "decision-warning",
      type: "warning",
      message: `${unresolvedHigh} higher-priority decisions need human review before agents can keep moving.`,
      priority: unresolvedHigh > 2 ? "high" : "medium",
      actionLabel: "Review decisions",
      actionView: "decisions",
    });
  }
  const running = runs.filter((run) => run.status === "running").length;
  if (running > 0) {
    items.push({
      id: "agent-recommendation",
      type: "recommendation",
      message: `${running} agents are active now. Open the Work view to inspect their latest handoffs.`,
      priority: "medium",
      actionLabel: "Open work view",
      actionView: "work",
    });
  }
  if (program.valueProjected > 0 && program.valueDelivered > 0) {
    const ratio = program.valueDelivered / program.valueProjected;
    if (ratio >= 0.75) {
      items.push({
        id: "value-celebration",
        type: "celebration",
        message: `${program.name} has crossed 75% of projected value delivery. Capture the playbook for reuse.`,
        priority: "low",
        actionLabel: "Open intelligence",
        actionView: "intelligence",
      });
    }
  }
  return items;
}

export function buildAgentActivityMap(runs: AgentRun[]): Record<string, { status: "idle" | "running" | "complete" | "blocked"; lastAction?: string; confidence?: number }> {
  return runs.reduce<Record<string, { status: "idle" | "running" | "complete" | "blocked"; lastAction?: string; confidence?: number }>>((accumulator, run) => {
    accumulator[run.phase_id] = {
      status: run.status === "failed" ? "blocked" : run.status === "paused" ? "blocked" : run.status === "complete" ? "complete" : run.status === "running" ? "running" : "idle",
      lastAction: run.trigger_event || undefined,
      confidence: typeof run.confidence === "number" ? run.confidence : undefined,
    };
    accumulator[run.agent_id] = accumulator[run.phase_id];
    return accumulator;
  }, {});
}

export function updateDecisionInProgram(
  program: ProgramSummary,
  decisionId: string,
  resolution: string,
  note?: string,
  actorEmail?: string,
  modifiedContent?: string,
  decisionPayload?: DecisionSummary,
): Record<string, unknown> {
  const exists = program.decisionQueue.some((decision) => decision.id === decisionId);
  const resolvedAt = new Date().toISOString();
  let decisionQueue = program.decisionQueue.map((decision) => (
    decision.id === decisionId
      ? {
          ...decision,
          status: resolution,
          resolvedAt,
          humanNote: note || "",
          resolvedBy: actorEmail || decision.resolvedBy || "",
          modifiedContent: modifiedContent || "",
        }
      : decision
  ));
  // Recommended Actions in DecideView are synthesised on the fly (escalations,
  // draft reviews, etc.) and never live in the persisted queue, so resolving one
  // would otherwise be a silent no-op. Persist a resolved record so the action
  // drops out of the open feed and shows in the decided history.
  if (!exists && decisionPayload) {
    const rawCreatedAt = (decisionPayload as { createdAt?: unknown }).createdAt;
    const createdAt = typeof rawCreatedAt === "number"
      ? new Date(rawCreatedAt).toISOString()
      : typeof rawCreatedAt === "string" && rawCreatedAt
        ? rawCreatedAt
        : resolvedAt;
    decisionQueue = [
      ...decisionQueue,
      {
        ...decisionPayload,
        id: decisionId,
        question: decisionPayload.question ?? "",
        options: decisionPayload.options ?? [],
        createdAt,
        status: resolution,
        resolvedAt,
        humanNote: note || "",
        resolvedBy: actorEmail || "",
        modifiedContent: modifiedContent || "",
      },
    ];
  }
  const rawData = program.rawData || {};
  const wrapper = asRecord(rawData as Json);
  const nested = asRecord(wrapper.data);
  if (Object.keys(nested).length > 0) {
    return {
      ...wrapper,
      data: {
        ...nested,
        decisionQueue,
      },
    };
  }
  return {
    ...rawData,
    decisionQueue,
  };
}
