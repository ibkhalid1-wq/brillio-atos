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
 *   evidenced    — delivering phases' mandatory exit criteria are actually met
 *                  (per the real gate reviews), minus requirements/benefits
 *                  traceability gaps; phases without a gate review yet fall back
 *                  to a progress proxy
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
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";
import {
  DEFAULT_ONTOLOGY_CONFIG,
  COMPONENT_LABEL,
  bandForScore,
  statusForScore,
  severityForGain,
  severityRank,
  type OntologyConfig,
  type ComponentKey,
  type ConfidenceBand,
} from "@/v3/ontology/ontologyConfig";
import {
  buildObjectiveGraph,
  type ObjectiveSemanticGraph,
  type SemanticNode,
  type SemanticRelation,
  type RelationGap,
} from "@/v3/ontology/objectiveGraph";

export type { ConfidenceBand, ComponentKey } from "@/v3/ontology/ontologyConfig";

/**
 * A traceable reference from a score back to the evidence that produced it — a
 * graph node (KPI/artifact/risk), a delivering phase, or a validation finding.
 * Explainability > Trust: every number can be audited to its source.
 */
export interface Citation {
  kind: "kpi" | "artifact" | "risk" | "phase" | "finding";
  /** The cited id: a graph node id, a phaseId, or a validation findingId. */
  ref: string;
  /** Human-readable label for display. */
  label: string;
}

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
  /** Sources this sub-score was derived from. */
  citations: Citation[];
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
  /** Sources that justify this blocker. */
  citations: Citation[];
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
  /** Override any model tunable; defaults to DEFAULT_ONTOLOGY_CONFIG. */
  config?: OntologyConfig;
}

/**
 * Confidence-weighted erosion from a set of gap-bearing relations: each gap
 * contributes `severityWeight × gapConfidence × gapPenaltyUnit`, capped by
 * `maxGapPenalty`. A low-severity or low-confidence gap barely moves the score;
 * a critical, certain one erodes it hard — but never past the cap.
 */
function weightedGapPenalty(gaps: RelationGap[], config: OntologyConfig): number {
  const raw = gaps.reduce((sum, gap) => {
    const conf = typeof gap.confidence === "number" ? gap.confidence : 1;
    return sum + config.severityWeight[gap.severity] * conf * config.gapPenaltyUnit;
  }, 0);
  return Math.min(config.maxGapPenalty, raw);
}

/** Relations of a kind leaving a given objective. */
function relationsFrom(graph: ObjectiveSemanticGraph, objectiveId: string, kind: SemanticRelation["kind"]): SemanticRelation[] {
  return graph.relations.filter((rel) => rel.from === objectiveId && rel.kind === kind);
}

function nodeOf(graph: ObjectiveSemanticGraph, id: string): SemanticNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** Cite a graph node by id, using its label where resolvable. */
function nodeCitation(graph: ObjectiveSemanticGraph, id: string, kind: Citation["kind"]): Citation {
  return { kind, ref: id, label: nodeOf(graph, id)?.label ?? id };
}

/** Cite the validation finding behind a gap, when it carries one. */
function gapCitation(gap: RelationGap): Citation | null {
  return gap.findingId ? { kind: "finding", ref: gap.findingId, label: gap.issue } : null;
}

/**
 * Confidence values reach the graph on two scales: facts carry a 0–1 confidence,
 * while generated artifacts carry `agentConfidence` on a 0–100 scale. Fold both
 * to 0–1 so the delivery-quality average is meaningful (a raw 75 must read as
 * 0.75, not 7500%). Values already in [0,1] pass through untouched.
 */
function normalisedConfidence(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  return value > 1 ? Math.min(1, value / 100) : value;
}

/**
 * Score one objective across the five components and derive its blockers.
 */
function scoreObjective(
  program: ProgramSummary,
  graph: ObjectiveSemanticGraph,
  objective: SemanticNode,
  config: OntologyConfig,
): ObjectiveConfidence {
  const blockers: ConfidenceBlocker[] = [];
  const drivers: string[] = [];
  const components: ConfidenceComponent[] = [];

  const pushComponent = (key: ComponentKey, score: number, detail: string, citations: Citation[] = []) => {
    const clamped = Math.max(0, Math.min(1, score));
    const weight = config.weights[key];
    components.push({
      key, label: COMPONENT_LABEL[key], score: clamped, weight,
      contribution: Math.round(clamped * weight * 100), status: statusForScore(clamped, config), detail, citations,
    });
    if (clamped >= config.status.good) drivers.push(`${COMPONENT_LABEL[key]}: ${detail}`);
    return clamped;
  };

  const addBlocker = (key: ComponentKey, subScore: number, label: string, detail: string, recommendation: string, citations: Citation[] = []) => {
    const gain = Math.round(config.weights[key] * (1 - Math.max(0, Math.min(1, subScore))) * 100);
    if (gain <= 0) return;
    blockers.push({
      id: `${objective.id}:${key}`, label, detail, recommendation,
      expectedGain: gain, severity: severityForGain(gain), component: key, objectiveId: objective.id, citations,
    });
  };

  // ── measurable ──────────────────────────────────────────────────────────
  const measures = relationsFrom(graph, objective.id, "measured-by");
  const kpiCitations = measures.map((rel) => nodeCitation(graph, rel.to, "kpi"));
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
      `${healthy}/${measures.length} linked KPIs have a baseline and target.`, kpiCitations);
    if (measurable < 1) {
      // Cite the specific KPIs that are missing a baseline or target.
      const incomplete = measures.filter((rel) => rel.gap).map((rel) => nodeCitation(graph, rel.to, "kpi"));
      addBlocker("measurable", measurable, "Some KPIs lack a baseline or target",
        `${measures.length - healthy} of ${measures.length} KPIs are missing a baseline or target.`,
        "Complete baseline and target values so attainment can be verified.", incomplete);
    }
  }

  // ── delivered ───────────────────────────────────────────────────────────
  const deliveries = relationsFrom(graph, objective.id, "delivered-by");
  const deliveryArtifacts = deliveries.map((rel) => nodeOf(graph, rel.to)).filter((n): n is SemanticNode => !!n);
  const artifactCitations = deliveryArtifacts.map((a) => ({ kind: "artifact" as const, ref: a.id, label: a.label }));
  let delivered: number;
  const deliveryGaps = deliveries.filter((rel) => rel.gap);
  if (deliveryArtifacts.length === 0) {
    delivered = 0;
    pushComponent("delivered", delivered, "No artifact is traced to this objective.");
    addBlocker("delivered", delivered, "No delivery traced to objective",
      "No generated artifact grounds this objective.",
      "Generate the phase artifacts that carry this objective forward (charter, business case, design).");
  } else {
    const quality = deliveryArtifacts.map((a) => normalisedConfidence(a.confidence));
    const avg = quality.reduce((s, q) => s + q, 0) / quality.length;
    // Each open delivery-chain gap discounts delivery confidence, weighted by
    // its severity and the finding's own confidence, capped by maxGapPenalty.
    const severePenalty = weightedGapPenalty(deliveryGaps.map((g) => g.gap!), config);
    delivered = Math.max(0, avg - severePenalty);
    // Cite the delivering artifacts plus any findings behind the gaps.
    const deliveredCitations = [
      ...artifactCitations,
      ...deliveryGaps.map((g) => gapCitation(g.gap!)).filter((c): c is Citation => !!c),
    ];
    pushComponent("delivered", delivered,
      `${deliveryArtifacts.length} artifact(s), avg quality ${(avg * 100).toFixed(0)}%${severePenalty ? `, −${(severePenalty * 100).toFixed(0)}% for gaps` : ""}.`,
      deliveredCitations);
    if (delivered < config.status.good) {
      const worst = deliveryGaps[0];
      const worstCitation = worst ? gapCitation(worst.gap!) : null;
      addBlocker("delivered", delivered,
        worst ? "Delivery gap on objective chain" : "Delivering artifacts are below quality",
        worst ? worst.gap!.issue : `Average artifact quality is ${(avg * 100).toFixed(0)}%.`,
        worst ? worst.gap!.recommendation : "Improve or regenerate the low-quality delivering artifacts.",
        worstCitation ? [worstCitation] : artifactCitations);
    }
  }

  // ── evidenced ───────────────────────────────────────────────────────────
  const deliveringPhaseIds = new Set(deliveryArtifacts.map((a) => a.phaseId).filter((p): p is string => !!p));
  if (objective.phaseId) deliveringPhaseIds.add(objective.phaseId);
  const evidenced = scoreEvidence(program, graph, objective.id, deliveringPhaseIds, config);
  pushComponent("evidenced", evidenced.score, evidenced.detail, evidenced.citations);
  if (evidenced.score < config.status.good) {
    // Prefer the specific traceability gap (e.g. "REQ-14 has no design coverage")
    // over a generic evidence prompt, so the top recommendation is actionable.
    const worstCitation = evidenced.worst ? gapCitation(evidenced.worst) : null;
    addBlocker("evidenced", evidenced.score,
      evidenced.worst ? "Requirement/benefit not traceable" : "Objective evidence is thin",
      evidenced.worst ? evidenced.worst.issue : evidenced.detail,
      evidenced.worst ? evidenced.worst.recommendation : evidenced.recommendation,
      worstCitation ? [worstCitation] : evidenced.citations);
  }

  // ── unthreatened ────────────────────────────────────────────────────────
  const threats = relationsFrom(graph, objective.id, "threatened-by");
  const riskCitations = threats.map((rel) => nodeCitation(graph, rel.to, "risk"));
  const unthreatened = Math.max(0, 1 - Math.min(1, threats.length * config.riskPenaltyUnit));
  pushComponent("unthreatened", unthreatened,
    threats.length === 0 ? "No open severe risk on the objective." : `${threats.length} open severe risk(s) threaten the objective.`,
    riskCitations);
  if (threats.length > 0) {
    const first = nodeOf(graph, threats[0].to);
    addBlocker("unthreatened", unthreatened, "Objective is threatened by open risk(s)",
      `${threats.length} open severe risk(s), e.g. "${first?.label ?? "risk"}".`,
      "Mitigate or close the severe risks threatening this objective.", riskCitations);
  }

  // ── progressing ─────────────────────────────────────────────────────────
  const progressing = scoreProgress(program, deliveringPhaseIds);
  const phaseCitations = (program.phases || [])
    .filter((p) => deliveringPhaseIds.has(p.id))
    .map((p) => ({ kind: "phase" as const, ref: p.id, label: p.displayName ?? p.id }));
  pushComponent("progressing", progressing.score, progressing.detail, phaseCitations);
  if (progressing.score < config.status.good) {
    addBlocker("progressing", progressing.score, "Delivering phases are behind",
      progressing.detail, "Accelerate the delivering phases or re-baseline the plan.", phaseCitations);
  }

  const confidence = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0) * 100);
  blockers.sort((a, b) => b.expectedGain - a.expectedGain);

  return { objectiveId: objective.id, label: objective.label, confidence, band: bandForScore(confidence), components, drivers, blockers };
}

/** Normalise a criterion string for tolerant matching against a library label. */
function normaliseCriterion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when a gate-review criterion refers to the given library exit criterion. */
function criterionMatches(reviewCriterion: string, libraryLabel: string): boolean {
  const a = normaliseCriterion(reviewCriterion);
  const b = normaliseCriterion(libraryLabel);
  return a === b || a.includes(b) || b.includes(a);
}

function scoreEvidence(
  program: ProgramSummary,
  graph: ObjectiveSemanticGraph,
  objectiveId: string,
  deliveringPhaseIds: Set<string>,
  config: OntologyConfig,
): { score: number; detail: string; recommendation: string; worst?: RelationGap; citations: Citation[] } {
  const phases = program.phases || [];
  const relevant = phases.filter((p) => deliveringPhaseIds.has(p.id));
  const gateReviews = program.gateReviews ?? {};
  // Cite each delivering phase (its gate review is the evidence source).
  const citations: Citation[] = relevant.map((p) => ({ kind: "phase", ref: p.id, label: p.displayName ?? p.id }));

  // Base evidence per delivering phase, in descending order of signal strength:
  //   1. explicit exit-criteria statuses on the gate review  → fraction met
  //   2. an approved / readiness-scored gate review          → gate is the proof
  //   3. no gate review                                      → progress proxy
  // Real programmes almost always land on (2): the gate reviews exist and are
  // approved but carry no per-criterion breakdown, so an approved gate is the
  // authoritative "this phase met its exit bar" signal. Each phase contributes
  // equally to the mean.
  const perPhase: number[] = [];
  const unmetLabels: string[] = [];
  let reviewedMandatory = 0;
  let reviewedMet = 0;
  let gatedPhases = 0;
  for (const phase of relevant) {
    const review = gateReviews[phase.id];
    const mandatory = getMandatoryCriteria(phase.id);
    const statuses = Array.isArray(review?.exitCriteriaStatus) ? review!.exitCriteriaStatus : [];
    if (mandatory.length > 0 && statuses.length > 0) {
      let met = 0;
      for (const crit of mandatory) {
        const status = statuses.find((s) => criterionMatches(s.criterion, crit.label));
        if (status?.met) met += 1;
        else unmetLabels.push(crit.label);
      }
      reviewedMandatory += mandatory.length;
      reviewedMet += met;
      perPhase.push(met / mandatory.length);
    } else if (review) {
      // An approved gate is full evidence the phase met its bar; a pending gate
      // contributes its readiness score; otherwise fall back to progress.
      if (review.status === "approved") {
        perPhase.push(1);
      } else if (typeof review.readinessScore === "number") {
        perPhase.push(normalisedConfidence(review.readinessScore, phaseProgress(phase)));
      } else {
        perPhase.push(phaseProgress(phase));
      }
      gatedPhases += 1;
    } else {
      perPhase.push(phaseProgress(phase));
    }
  }
  const base = perPhase.length === 0
    ? 0.5
    : perPhase.reduce((s, v) => s + v, 0) / perPhase.length;

  // Requirements / benefits traceability gaps directly erode evidence — but only
  // those originating from a validation *finding* (they carry a findingId). The
  // intrinsic "KPI is missing a baseline/target" gaps on measured-by edges are
  // already scored by the `measurable` component, so folding them here too would
  // double-penalise the same weakness and mislabel a KPI gap as a traceability
  // gap.
  const evidenceGaps = graphGapsFor(graph, objectiveId).filter((g) =>
    !!g.gap?.findingId && (g.kind === "satisfied-by" || g.kind === "measured-by"));
  const penalty = weightedGapPenalty(evidenceGaps.map((g) => g.gap!), config);
  const score = Math.max(0, base - penalty);
  // Fold the findings behind traceability gaps into the citation trail.
  for (const g of evidenceGaps) {
    const c = gapCitation(g.gap!);
    if (c) citations.push(c);
  }
  // Surface the most severe traceability gap so the blocker can name it.
  const worst = [...evidenceGaps]
    .sort((a, b) => severityRank(b.gap!.severity) - severityRank(a.gap!.severity))[0]?.gap;

  const gapNote = penalty ? `, −${(penalty * 100).toFixed(0)}% for traceability gaps` : "";
  let detail: string;
  if (relevant.length === 0) {
    detail = "No delivering phase identified, so exit-criteria evidence is unknown.";
  } else if (reviewedMandatory > 0) {
    detail = `${reviewedMet}/${reviewedMandatory} mandatory exit criteria met across delivering phases${gapNote}.`;
  } else if (gatedPhases > 0) {
    detail = `${gatedPhases}/${relevant.length} delivering phases cleared their gate review (no per-criterion breakdown recorded); ${(base * 100).toFixed(0)}% evidence${gapNote}.`;
  } else {
    detail = `No gate review yet; ${(base * 100).toFixed(0)}% phase progress as an evidence proxy${gapNote}.`;
  }

  let recommendation: string;
  if (unmetLabels.length > 0) {
    const more = unmetLabels.length > 1 ? ` and ${unmetLabels.length - 1} more` : "";
    recommendation = `Capture evidence for the unmet exit criterion "${unmetLabels[0]}"${more}.`;
  } else if (penalty > 0) {
    recommendation = "Close the requirements/benefits traceability gaps and capture exit-criterion evidence.";
  } else if (gatedPhases > 0) {
    recommendation = "Record the per-criterion exit-review breakdown so gate approvals are auditable, not just aggregate.";
  } else {
    recommendation = "Capture evidence against the delivering phases' mandatory exit criteria.";
  }
  return { score, detail, recommendation, worst, citations };
}

function graphGapsFor(graph: ObjectiveSemanticGraph, objectiveId: string): SemanticRelation[] {
  return graph.relations.filter((rel) => rel.gap && (rel.from === objectiveId || rel.kind === "satisfied-by"));
}

/**
 * A phase's progress toward its objective. A phase the programme marks
 * `complete` counts as fully progressed even when its stored `pct` is stale
 * (real programmes routinely carry `status: "complete"` with a `pct` of 10 or
 * 0) — the status is the authoritative signal, the percentage a lagging proxy.
 */
function phaseProgress(phase: { status?: string; pct?: number }): number {
  if (phase.status === "complete") return 1;
  return Math.max(0, Math.min(1, (phase.pct ?? 0) / 100));
}

function scoreProgress(program: ProgramSummary, deliveringPhaseIds: Set<string>): { score: number; detail: string } {
  const phases = (program.phases || []).filter((p) => deliveringPhaseIds.has(p.id));
  if (phases.length === 0) return { score: 0.6, detail: "No delivering phase identified; progress assumed neutral." };
  const avg = phases.reduce((s, p) => s + phaseProgress(p), 0) / phases.length;
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
  const config = options.config ?? DEFAULT_ONTOLOGY_CONFIG;
  const graph = buildObjectiveGraph(program, { findings: options.findings, documents: options.documents });
  if (!program || graph.objectiveIds.length === 0) {
    return { objectives: [], overall: 0, band: "Critical", recommendations: [], graph };
  }

  const objectives = graph.objectiveIds
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is SemanticNode => !!n)
    .map((objective) => scoreObjective(program, graph, objective, config));

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

  return { objectives, overall, band: bandForScore(overall), recommendations, graph };
}
