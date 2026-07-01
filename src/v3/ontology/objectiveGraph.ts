/**
 * Objective semantic graph — the ontology applied to a live programme.
 *
 * `buildProgramGraph` (programGraph.ts) already assembles typed instance nodes
 * (facts, artifacts, KPIs, risks, decisions, stakeholders) with structural edges
 * (grounds, sequence, in_phase). This module re-expresses that instance graph in
 * the ontology's vocabulary and, crucially, adds the *semantic delivery
 * relations* that connect each business objective to the work meant to achieve
 * it: `measured-by` (→ KPI), `delivered-by` (→ artifact), `threatened-by`
 * (→ risk), plus the requirement→design `satisfied-by` chain.
 *
 * It then folds cross-artifact validation findings (crossArtifactValidation.ts /
 * the semantic validator agent) into the same graph as *gap annotations* on the
 * relevant relations — so an unsatisfied "REQ-14 → design" finding is not a
 * detached Action-Center item but a broken edge on the objective's delivery
 * chain. That is what lets the confidence roll-up (objectiveConfidence.ts)
 * reflect requirement/design gaps rather than mere process health.
 *
 * Pure and derived: reads ProgramSummary + findings, writes nothing.
 */
import type { ProgramSummary } from "@/new/types";
import { buildProgramGraph, type ProgramGraph, type ProgramGraphNode, type ProgramDocument } from "@/v3/lib/programGraph";
import type { ValidationFinding, ValidationDomain, ValidationSeverity } from "@/v3/lib/crossArtifactValidation";
import {
  type EntityKind,
  type RelationKind,
  isValidRelation,
  isObjectiveFactType,
} from "@/v3/ontology/ontology";

export interface SemanticNode {
  /** Reuses the Program Graph node id (e.g. "fact:F3", "artifact:charter"). */
  id: string;
  kind: EntityKind;
  label: string;
  phaseId?: string;
  confidence?: number;
  properties?: Record<string, unknown>;
}

export interface RelationGap {
  severity: ValidationSeverity;
  issue: string;
  recommendation: string;
  /** Originating finding id, for traceability back to the validation layer. */
  findingId?: string;
  /** 0–1 confidence of the originating finding; weights how hard the gap erodes. */
  confidence?: number;
}

export interface SemanticRelation {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  /**
   * Present when this relation is expected but unsatisfied/weak — the graph-level
   * representation of a validation gap. A relation with no `gap` is a healthy
   * connection; a relation *with* a gap is a broken link the roll-up penalises.
   */
  gap?: RelationGap;
}

export interface ObjectiveSemanticGraph {
  nodes: SemanticNode[];
  relations: SemanticRelation[];
  /** Node ids of the objective nodes, the entry points for the roll-up. */
  objectiveIds: string[];
}

/** Map a Program Graph node kind to the richer ontology entity kind. */
function toEntityKind(node: ProgramGraphNode): EntityKind {
  if (node.type === "fact") {
    const factType = typeof node.properties?.factType === "string" ? node.properties.factType : undefined;
    return isObjectiveFactType(factType) ? "objective" : "fact";
  }
  return node.type as EntityKind;
}

/**
 * Validation domains whose findings sit on an objective's *delivery* chain, so a
 * finding in one of these domains weakens the objective's confidence. Maps each
 * to the relation kind whose satisfaction it speaks to.
 */
const DOMAIN_RELATION: Partial<Record<ValidationDomain, RelationKind>> = {
  "requirements-coverage": "satisfied-by",
  "architecture-consistency": "satisfied-by",
  "delivery-readiness": "delivered-by",
  "scope-coverage": "delivered-by",
  // Benefits traceability is a *traceability* concern (a benefit satisfied-by a
  // tracking artifact), modelled like requirements. It must NOT map to
  // measured-by: the ontology constrains measured-by to KPI targets, so a
  // benefits finding folded there would be rejected by addRelation and silently
  // dropped — never reaching the evidenced component that should carry it.
  "benefits-traceability": "satisfied-by",
};

const SEVERE = new Set<ValidationSeverity>(["critical", "high"]);

export interface ObjectiveGraphOptions {
  findings?: ValidationFinding[];
  documents?: ProgramDocument[];
}

/**
 * Build the objective-centric semantic graph for a programme. Objectives become
 * the hubs; every other relevant node hangs off them via an ontology relation.
 */
export function buildObjectiveGraph(
  program: ProgramSummary | null | undefined,
  options: ObjectiveGraphOptions = {},
): ObjectiveSemanticGraph {
  const empty: ObjectiveSemanticGraph = { nodes: [], relations: [], objectiveIds: [] };
  if (!program) return empty;

  const pg: ProgramGraph = buildProgramGraph(program, options.documents ?? []);
  const nodes = new Map<string, SemanticNode>();
  const byKind = (kind: EntityKind) => [...nodes.values()].filter((n) => n.kind === kind);

  for (const node of pg.nodes) {
    nodes.set(node.id, {
      id: node.id,
      kind: toEntityKind(node),
      label: node.label,
      phaseId: node.phaseCreated,
      confidence: node.confidence,
      properties: node.properties,
    });
  }

  const relations = new Map<string, SemanticRelation>();
  const addRelation = (rel: SemanticRelation) => {
    const fromKind = nodes.get(rel.from)?.kind;
    const toKind = nodes.get(rel.to)?.kind;
    // Guard every edge against the ontology so a nonsensical relation can never
    // enter the graph — the vocabulary is enforced, not merely documented.
    if (!fromKind || !toKind || !isValidRelation(rel.kind, fromKind, toKind)) return;
    if (!relations.has(rel.id)) relations.set(rel.id, rel);
  };

  const objectives = byKind("objective");
  const objectiveIds = objectives.map((o) => o.id);
  const kpis = byKind("kpi");
  const risks = byKind("risk");
  // Index artifacts by their producing phase, and separately collect
  // programme-global artifacts (those not scoped to any methodology phase, e.g.
  // an imported charter tagged phaseId "program") — these deliver every objective.
  const phaseOrder = (program.phases || []).map((p) => p.id);
  const phaseIdSet = new Set(phaseOrder);
  const artifactsByPhase = new Map<string, SemanticNode[]>();
  const globalArtifacts: SemanticNode[] = [];
  for (const node of byKind("artifact")) {
    if (!node.phaseId) continue;
    if (!phaseIdSet.has(node.phaseId)) {
      globalArtifacts.push(node);
      continue;
    }
    const bucket = artifactsByPhase.get(node.phaseId) ?? [];
    bucket.push(node);
    artifactsByPhase.set(node.phaseId, bucket);
  }

  // Carry the structural `grounds` edges (fact/objective → artifact) across, then
  // add the objective delivery semantics.
  for (const edge of pg.edges) {
    if (edge.type === "grounds") {
      addRelation({ id: `grounds:${edge.from}->${edge.to}`, from: edge.from, to: edge.to, kind: "grounds" });
    }
    if (edge.type === "sequence") {
      addRelation({ id: `seq:${edge.from}->${edge.to}`, from: edge.from, to: edge.to, kind: "sequence" });
    }
  }

  for (const objective of objectives) {
    // measured-by: every KPI is a candidate measure for the (typically singular)
    // programme objective. When the programme has multiple objectives this is a
    // conservative many-to-many; per-objective KPI attribution is a later refinement.
    for (const kpi of kpis) {
      const baseline = (kpi.properties?.baseline as string) || "";
      const target = (kpi.properties?.target as string) || "";
      const weak = !baseline.trim() || !target.trim();
      addRelation({
        id: `measured-by:${objective.id}->${kpi.id}`,
        from: objective.id, to: kpi.id, kind: "measured-by",
        gap: weak
          ? { severity: "medium", issue: `KPI "${kpi.label}" is missing a baseline or target.`, recommendation: "Set both a baseline and a target so attainment is verifiable." }
          : undefined,
      });
    }

    // delivered-by: artifacts this objective grounds (from the carried grounds edges).
    let groundedCount = 0;
    for (const edge of pg.edges) {
      if (edge.type === "grounds" && edge.from === objective.id) {
        addRelation({ id: `delivered-by:${objective.id}->${edge.to}`, from: objective.id, to: edge.to, kind: "delivered-by" });
        groundedCount += 1;
      }
    }
    // Fallback: when explicit grounding metadata is absent (the objective fact
    // carries no impactedArtifacts — common when the methodology's input-flow was
    // not persisted at runtime), attribute the artifacts across the objective's
    // whole downstream delivery chain: its own phase and every phase that follows
    // it in the methodology sequence, plus programme-global artifacts. A business
    // objective is delivered progressively — the design, build and operate phases
    // are where it is actually realised — so validating it against only its origin
    // phase understates the chain. Downstream phases that produced nothing simply
    // contribute nothing (no artifacts to attribute), so not-yet-started phases
    // are never unfairly counted.
    if (groundedCount === 0) {
      const startIndex = objective.phaseId ? phaseOrder.indexOf(objective.phaseId) : -1;
      const chainPhases = startIndex >= 0 ? phaseOrder.slice(startIndex) : phaseOrder;
      const fallbackArtifacts = [
        ...chainPhases.flatMap((pid) => artifactsByPhase.get(pid) ?? []),
        ...globalArtifacts,
      ];
      for (const artifact of fallbackArtifacts) {
        addRelation({ id: `delivered-by:${objective.id}->${artifact.id}`, from: objective.id, to: artifact.id, kind: "delivered-by" });
      }
    }

    // threatened-by: open, severe risks threaten objective attainment. Programme-
    // level threat model (risk→objective is not individually attributed upstream).
    for (const risk of risks) {
      if (SEVERE.has((risk.properties?.severity as ValidationSeverity) ?? "low")) {
        addRelation({ id: `threatened-by:${objective.id}->${risk.id}`, from: objective.id, to: risk.id, kind: "threatened-by" });
      }
    }
  }

  // Fold validation findings in as gap annotations on the delivery chain.
  foldFindings(program, options.findings ?? [], objectiveIds, nodes, addRelation);

  return { nodes: [...nodes.values()], relations: [...relations.values()], objectiveIds };
}

/**
 * Attach each delivery-chain finding to the objective graph. Where a finding
 * names artifacts that already exist as nodes, the gap lands on a real edge;
 * otherwise a lightweight requirement/design node is synthesised so the gap is
 * still representable and citable.
 */
function foldFindings(
  program: ProgramSummary,
  findings: ValidationFinding[],
  objectiveIds: string[],
  nodes: Map<string, SemanticNode>,
  addRelation: (rel: SemanticRelation) => void,
): void {
  const artifactNodeId = (id: string): string => `artifact:${id}`;
  const ensureNode = (id: string, kind: EntityKind, label: string, phaseId?: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, phaseId });
    return id;
  };

  for (const finding of findings) {
    const relationKind = DOMAIN_RELATION[finding.domain];
    if (!relationKind) continue; // not a delivery-chain domain

    const gap: RelationGap = {
      severity: finding.severity,
      issue: finding.issue,
      recommendation: finding.recommendation,
      findingId: finding.findingId,
      confidence: finding.confidence,
    };

    // requirement/architecture findings: model as a requirement `satisfied-by`
    // a design/artifact target, with the gap on that edge.
    if (relationKind === "satisfied-by") {
      const reqId = ensureNode(
        `requirement:${finding.sourceItem || finding.findingId}`,
        "requirement",
        finding.sourceItem || "Requirement",
        finding.phaseId,
      );
      const targetRaw = finding.targetArtifact || finding.sourceArtifact || "design";
      const existingTarget = nodes.get(artifactNodeId(targetRaw));
      const targetId = existingTarget
        ? existingTarget.id
        : ensureNode(`design:${targetRaw}`, "design", targetRaw, finding.phaseId);
      addRelation({ id: `satisfied-by:${reqId}->${targetId}`, from: reqId, to: targetId, kind: "satisfied-by", gap });
      continue;
    }

    // delivery/scope/benefits findings: annotate the objective's outgoing edge of
    // that kind (delivered-by / measured-by). If the objective has no such edge
    // yet, the missing-relation gap is caught by the roll-up; here we only enrich
    // existing edges so the specific finding text surfaces on them.
    for (const objectiveId of objectiveIds) {
      const targetRaw = finding.targetArtifact || finding.sourceArtifact;
      if (!targetRaw) continue;
      const existingTarget = nodes.get(artifactNodeId(targetRaw));
      const targetId = existingTarget
        ? existingTarget.id
        : ensureNode(`artifact:${targetRaw}`, "artifact", targetRaw, finding.phaseId);
      addRelation({
        id: `${relationKind}:${objectiveId}->${targetId}:gap:${finding.findingId}`,
        from: objectiveId, to: targetId, kind: relationKind, gap,
      });
    }
  }
}

/** All gap-annotated relations in the graph — the graph-native gap list. */
export function graphGaps(graph: ObjectiveSemanticGraph): SemanticRelation[] {
  return graph.relations.filter((rel) => rel.gap !== undefined);
}
