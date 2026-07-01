/**
 * Objective-attainment confidence — "will the original business objectives be
 * met?", with ranked recommendations for raising that confidence.
 *
 * The unified confidence model (confidenceScore.ts) measures *process health*
 * (gate readiness, risk posture, schedule, decision backlog). It answers "is the
 * programme being run well?" — not "is the objective on track to be achieved?".
 * This module answers the second question by walking each objective's semantic
 * delivery chain (objectiveGraph.ts) and scoring five graph-derived components:
 *
 *   measurable   — objective has ≥1 KPI, ideally with baseline + target
 *   delivered    — objective grounds real artifacts that clear a quality bar
 *   evidenced    — delivering phases' mandatory exit criteria are satisfiable,
 *                  minus requirements/benefits traceability gaps
 *   unthreatened — no open, severe risk sits on the chain
 *   progressing  — the delivering phases are advancing on plan
 *
 * Every shortfall becomes a `ConfidenceBlocker` carrying an `expectedGain` (the
 * points recoverable by fixing it, mirroring readinessModel.ts), so the
 * highest-leverage action is always obvious. This is the "recommendations for
 * improving confidence" surface, and — because gaps are folded in from the
 * validation layer — a specific unsatisfied requirement demonstrably lowers the
 * number and shows up as the top recommended action.
 *
 * Pure and derived: reads ProgramSummary (+ optional findings), writes nothing.
 */
import type { ProgramSummary } from "@/new/types";
import type { ValidationFinding, ValidationSeverity } from "@/v3/lib/crossArtifactValidation";
import type { ProgramDocument } from "@/v3/lib/programGraph";
import { EXIT_CRITERIA_LIBRARY } from "@/v3/lib/exitCriteriaLibrary";
import {
  buildObjectiveGraph,
  type ObjectiveSemanticGraph,
  type SemanticNode,
  type SemanticRelation,
  type RelationGap,
} from "@/v3/ontology/objectiveGraph";

export type ConfidenceBand = "Critical" | "At Risk" | "On Track" | "Strong";

export type ComponentKey = "measurable" | "delivered" | "evidenced" | "unthreatened" | "progressing";

export interface ConfidenceComponent {
  key: ComponentKey;
  label: string;
  /** 0–1 sub-score. */
  score: number;
  /** 0–1 contribution weight. */
  weight: number;
  /** score × weight × 100, rounded — the points this component contributes. */
  contribution: number;
  status: "good" | "warn" | "poor";
  detail: string;
}

export interface ConfidenceBlocker {
  id: string;
  label: string;
  detail: string;
  recommendation: string;
  /** Points recoverable (0–100 scale) by closing this blocker. */
  expectedGain: number;
  severity: ValidationSeverity;
  component: ComponentKey;
  /** Objective this blocker belongs to; "*" for programme-wide. */
  objectiveId: string;
}

export interface ObjectiveConfidence {
  objectiveId: string;
  label: string;
  /** 0–100 objective-attainment confidence. */
  confidence: number;
  band: ConfidenceBand;
  components: ConfidenceComponent[];
  /** Human-readable strengths (components already strong). */
  drivers: string[];
  /** Ranked shortfalls with expected gain. */
  blockers: ConfidenceBlocker[];
}

export interface OntologyAssessment {
  objectives: ObjectiveConfidence[];
  /** Equal-weighted mean of per-objective confidence (0–100). */
  overall: number;
  band: ConfidenceBand;
  /** De-duplicated, gain-ranked recommendations across all objectives. */
  recommendations: ConfidenceBlocker[];
  graph: ObjectiveSemanticGraph;
}

export interface AssessObjectivesOptions {
  findings?: ValidationFinding[];
  documents?: ProgramDocument[];
}

const WEIGHTS: Record<ComponentKey, number> = {
  measurable: 0.25,
  delivered: 0.30,
  evidenced: 0.20,
  unthreatened: 0.15,
  progressing: 0.10,
};

const COMPONENT_LABEL: Record<ComponentKey, string> = {
  measurable: "Measurable",
  delivered: "Delivered",
  evidenced: "Evidenced",
  unthreatened: "Unthreatened",
  progressing: "Progressing",
};

/** Artifact confidence at/above this is treated as delivering quality. */
const QUALITY_BAR = 0.6;
const SEVERE = new Set<ValidationSeverity>(["critical", "high"]);

function band(score: number): ConfidenceBand {
  if (score >= 80) return "Strong";
  if (score >= 65) return "On Track";
  if (score >= 45) return "At Risk";
  return "Critical";
}

function statusFor(score: number): "good" | "warn" | "poor" {
  if (score >= 0.75) return "good";
  if (score >= 0.45) return "warn";
  return "poor";
}

function severityForGain(gain: number): ValidationSeverity {
  if (gain >= 18) return "critical";
  if (gain >= 10) return "high";
  if (gain >= 5) return "medium";
  return "low";
}

/** Relations of a kind leaving a given objective. */
function relationsFrom(graph: ObjectiveSemanticGraph, objectiveId: string, kind: SemanticRelation["kind"]): SemanticRelation[] {
  return graph.relations.filter((rel) => rel.from === objectiveId && rel.kind === kind);
}

function nodeOf(graph: ObjectiveSemanticGraph, id: string): SemanticNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * Score one objective across the five components and derive its blockers.
 */
function scoreObjective(
  program: ProgramSummary,
  graph: ObjectiveSemanticGraph,
  objective: SemanticNode,
): ObjectiveConfidence {
  const blockers: ConfidenceBlocker[] = [];
  const drivers: string[] = [];
  const components: ConfidenceComponent[] = [];

  const pushComponent = (key: ComponentKey, score: number, detail: string) => {
    const clamped = Math.max(0, Math.min(1, score));
    components.push({
      key, label: COMPONENT_LABEL[key], score: clamped, weight: WEIGHTS[key],
      contribution: Math.round(clamped * WEIGHTS[key] * 100), status: statusFor(clamped), detail,
    });
    if (clamped >= 0.75) drivers.push(`${COMPONENT_LABEL[key]}: ${detail}`);
    return clamped;
  };

  const addBlocker = (key: ComponentKey, subScore: number, label: string, detail: string, recommendation: string) => {
    const gain = Math.round(WEIGHTS[key] * (1 - Math.max(0, Math.min(1, subScore))) * 100);
    if (gain <= 0) return;
    blockers.push({
      id: `${objective.id}:${key}`, label, detail, recommendation,
      expectedGain: gain, severity: severityForGain(gain), component: key, objectiveId: objective.id,
    });
  };

  // ── measurable ──────────────────────────────────────────────────────────
  const measures = relationsFrom(graph, objective.id, "measured-by");
  let measurable: number;
  if (measures.length === 0) {
    measurable = 0;
    pushComponent("measurable", measurable, "No KPI is linked to this objective.");
    addBlocker("measurable", measurable, "Objective is not measurable",
      "No KPI or success metric is linked to this objective.",
      "Define at least one KPI with a baseline and target for this objective.");
  } else {
    const healthy = measures.filter((rel) => !rel.gap).length;
    measurable = healthy / measures.length;
    pushComponent("measurable", measurable,
      `${healthy}/${measures.length} linked KPIs have a baseline and target.`);
    if (measurable < 1) {
      addBlocker("measurable", measurable, "Some KPIs lack a baseline or target",
        `${measures.length - healthy} of ${measures.length} KPIs are missing a baseline or target.`,
        "Complete baseline and target values so attainment can be verified.");
    }
  }

  // ── delivered ───────────────────────────────────────────────────────────
  const deliveries = relationsFrom(graph, objective.id, "delivered-by");
  const deliveryArtifacts = deliveries.map((rel) => nodeOf(graph, rel.to)).filter((n): n is SemanticNode => !!n);
  let delivered: number;
  const deliveryGaps = deliveries.filter((rel) => rel.gap);
  if (deliveryArtifacts.length === 0) {
    delivered = 0;
    pushComponent("delivered", delivered, "No artifact is traced to this objective.");
    addBlocker("delivered", delivered, "No delivery traced to objective",
      "No generated artifact grounds this objective.",
      "Generate the phase artifacts that carry this objective forward (charter, business case, design).");
  } else {
    const quality = deliveryArtifacts.map((a) => (typeof a.confidence === "number" ? a.confidence : 0.5));
    const avg = quality.reduce((s, q) => s + q, 0) / quality.length;
    // Each open severe delivery-chain gap discounts delivery confidence.
    const severePenalty = Math.min(0.5, deliveryGaps.filter((g) => SEVERE.has(g.gap!.severity)).length * 0.2);
    delivered = Math.max(0, avg - severePenalty);
    pushComponent("delivered", delivered,
      `${deliveryArtifacts.length} artifact(s), avg quality ${(avg * 100).toFixed(0)}%${severePenalty ? `, −${(severePenalty * 100).toFixed(0)}% for gaps` : ""}.`);
    if (delivered < 0.75) {
      const worst = deliveryGaps[0];
      addBlocker("delivered", delivered,
        worst ? "Delivery gap on objective chain" : "Delivering artifacts are below quality",
        worst ? worst.gap!.issue : `Average artifact quality is ${(avg * 100).toFixed(0)}%.`,
        worst ? worst.gap!.recommendation : "Improve or regenerate the low-quality delivering artifacts.");
    }
  }

  // ── evidenced ───────────────────────────────────────────────────────────
  const deliveringPhaseIds = new Set(deliveryArtifacts.map((a) => a.phaseId).filter((p): p is string => !!p));
  if (objective.phaseId) deliveringPhaseIds.add(objective.phaseId);
  const evidenced = scoreEvidence(program, graph, objective.id, deliveringPhaseIds);
  pushComponent("evidenced", evidenced.score, evidenced.detail);
  if (evidenced.score < 0.75) {
    // Prefer the specific traceability gap (e.g. "REQ-14 has no design coverage")
    // over a generic evidence prompt, so the top recommendation is actionable.
    addBlocker("evidenced", evidenced.score,
      evidenced.worst ? "Requirement/benefit not traceable" : "Objective evidence is thin",
      evidenced.worst ? evidenced.worst.issue : evidenced.detail,
      evidenced.worst ? evidenced.worst.recommendation : evidenced.recommendation);
  }

  // ── unthreatened ────────────────────────────────────────────────────────
  const threats = relationsFrom(graph, objective.id, "threatened-by");
  const unthreatened = Math.max(0, 1 - Math.min(1, threats.length * 0.25));
  pushComponent("unthreatened", unthreatened,
    threats.length === 0 ? "No open severe risk on the objective." : `${threats.length} open severe risk(s) threaten the objective.`);
  if (threats.length > 0) {
    const first = nodeOf(graph, threats[0].to);
    addBlocker("unthreatened", unthreatened, "Objective is threatened by open risk(s)",
      `${threats.length} open severe risk(s), e.g. "${first?.label ?? "risk"}".`,
      "Mitigate or close the severe risks threatening this objective.");
  }

  // ── progressing ─────────────────────────────────────────────────────────
  const progressing = scoreProgress(program, deliveringPhaseIds);
  pushComponent("progressing", progressing.score, progressing.detail);
  if (progressing.score < 0.75) {
    addBlocker("progressing", progressing.score, "Delivering phases are behind",
      progressing.detail, "Accelerate the delivering phases or re-baseline the plan.");
  }

  const confidence = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0) * 100);
  blockers.sort((a, b) => b.expectedGain - a.expectedGain);

  return { objectiveId: objective.id, label: objective.label, confidence, band: band(confidence), components, drivers, blockers };
}

function scoreEvidence(
  program: ProgramSummary,
  graph: ObjectiveSemanticGraph,
  objectiveId: string,
  deliveringPhaseIds: Set<string>,
): { score: number; detail: string; recommendation: string; worst?: RelationGap } {
  const phases = program.phases || [];
  const relevant = phases.filter((p) => deliveringPhaseIds.has(p.id));
  // Base evidence = how far the delivering phases have progressed (a proxy for
  // exit criteria being satisfiable), enumerated against the exit-criteria library.
  const mandatory = EXIT_CRITERIA_LIBRARY.filter((c) => c.mandatory && deliveringPhaseIds.has(c.phaseId));
  const base = relevant.length === 0
    ? 0.5
    : relevant.reduce((s, p) => s + Math.max(0, Math.min(1, (p.pct ?? 0) / 100)), 0) / relevant.length;

  // Requirements / benefits traceability gaps directly erode evidence.
  const evidenceGaps = graphGapsFor(graph, objectiveId).filter((g) =>
    g.kind === "satisfied-by" || (g.kind === "measured-by" && g.gap));
  const penalty = Math.min(0.5, evidenceGaps.filter((g) => SEVERE.has(g.gap!.severity)).length * 0.2);
  const score = Math.max(0, base - penalty);
  // Surface the most severe traceability gap so the blocker can name it.
  const worst = [...evidenceGaps]
    .sort((a, b) => severityRank(b.gap!.severity) - severityRank(a.gap!.severity))[0]?.gap;

  const remaining = mandatory.length;
  const detail = relevant.length === 0
    ? "No delivering phase identified, so exit-criteria evidence is unknown."
    : `${remaining} mandatory exit criteria across delivering phases; ${(base * 100).toFixed(0)}% phase progress${penalty ? `, −${(penalty * 100).toFixed(0)}% for traceability gaps` : ""}.`;
  const recommendation = penalty > 0
    ? "Close the requirements/benefits traceability gaps and capture exit-criterion evidence."
    : "Capture evidence against the delivering phases' mandatory exit criteria.";
  return { score, detail, recommendation, worst };
}

function severityRank(severity: ValidationSeverity): number {
  return severity === "critical" ? 3 : severity === "high" ? 2 : severity === "medium" ? 1 : 0;
}

function graphGapsFor(graph: ObjectiveSemanticGraph, objectiveId: string): SemanticRelation[] {
  return graph.relations.filter((rel) => rel.gap && (rel.from === objectiveId || rel.kind === "satisfied-by"));
}

function scoreProgress(program: ProgramSummary, deliveringPhaseIds: Set<string>): { score: number; detail: string } {
  const phases = (program.phases || []).filter((p) => deliveringPhaseIds.has(p.id));
  if (phases.length === 0) return { score: 0.6, detail: "No delivering phase identified; progress assumed neutral." };
  const avg = phases.reduce((s, p) => s + Math.max(0, Math.min(1, (p.pct ?? 0) / 100)), 0) / phases.length;
  return { score: avg, detail: `Delivering phases average ${(avg * 100).toFixed(0)}% complete.` };
}

/**
 * Assess objective-attainment confidence for a programme, with ranked
 * recommendations. The single entry point of the ontology workspace.
 */
export function assessObjectives(
  program: ProgramSummary | null | undefined,
  options: AssessObjectivesOptions = {},
): OntologyAssessment {
  const graph = buildObjectiveGraph(program, { findings: options.findings, documents: options.documents });
  if (!program || graph.objectiveIds.length === 0) {
    return { objectives: [], overall: 0, band: "Critical", recommendations: [], graph };
  }

  const objectives = graph.objectiveIds
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is SemanticNode => !!n)
    .map((objective) => scoreObjective(program, graph, objective));

  const overall = objectives.length
    ? Math.round(objectives.reduce((s, o) => s + o.confidence, 0) / objectives.length)
    : 0;

  // Merge blockers across objectives, keeping the highest-gain instance of each
  // distinct recommendation so the queue never lists the same fix twice.
  const byRecommendation = new Map<string, ConfidenceBlocker>();
  for (const objective of objectives) {
    for (const blocker of objective.blockers) {
      const existing = byRecommendation.get(blocker.recommendation);
      if (!existing || blocker.expectedGain > existing.expectedGain) byRecommendation.set(blocker.recommendation, blocker);
    }
  }
  const recommendations = [...byRecommendation.values()].sort((a, b) => b.expectedGain - a.expectedGain);

  return { objectives, overall, band: band(overall), recommendations, graph };
}
