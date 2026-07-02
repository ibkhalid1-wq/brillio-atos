/**
 * ATOS Ontology — the explicit semantic vocabulary that connects the methodology
 * across every phase.
 *
 * The methodology (methodology.ts) owns *structure* (phases, input fields,
 * artifacts); the Fact Graph (factGraph.ts) and Program Graph (programGraph.ts)
 * own *instances* (the facts, artifacts, risks a specific programme accumulates).
 * Until now the *vocabulary* tying those instances together was implicit — node
 * kinds were a bare TS union and edge kinds were free-form strings, so nothing
 * declared that an objective is *measured-by* a KPI or *delivered-by* an
 * artifact. This module makes that vocabulary first-class: a named, constrained
 * set of entity kinds and relation kinds that every consumer (graph builder,
 * confidence roll-up, gap detector, agent prompt) reads from one place.
 *
 * It is a pure, dependency-free registry — no program state, no I/O — so it can
 * be imported by both the client selectors and (conceptually) the edge agents
 * without pulling in React or Supabase. Relations are *constrained*: each
 * declares the entity kinds it may connect, so `isValidRelation` can reject a
 * nonsensical edge (e.g. a risk "measured-by" a stakeholder) before it ever
 * reaches the graph.
 */

/** Every entity kind the ontology recognises across all phases. */
export type EntityKind =
  | "objective"
  | "kpi"
  | "requirement"
  | "design"
  | "artifact"
  | "risk"
  | "decision"
  | "stakeholder"
  | "fact"
  | "phase"
  | "document"
  | "insight"
  | "exit-criterion";

export interface EntityType {
  kind: EntityKind;
  /** Stable compact identifier, e.g. "atos:Objective" — usable as an RDF-style curie. */
  curie: string;
  label: string;
  description: string;
}

export const ENTITY_TYPES: Record<EntityKind, EntityType> = {
  objective: { kind: "objective", curie: "atos:Objective", label: "Business objective", description: "An outcome the programme exists to achieve; inherited fundamental, never re-requested." },
  kpi: { kind: "kpi", curie: "atos:KPI", label: "KPI / success metric", description: "A measurable indicator that quantifies progress toward an objective." },
  requirement: { kind: "requirement", curie: "atos:Requirement", label: "Requirement", description: "A functional or non-functional need the solution must satisfy." },
  design: { kind: "design", curie: "atos:Design", label: "Design element", description: "A future-state design or architecture element intended to satisfy requirements." },
  artifact: { kind: "artifact", curie: "atos:Artifact", label: "Artifact", description: "A generated programme deliverable (charter, roadmap, business case, design, plan)." },
  risk: { kind: "risk", curie: "atos:Risk", label: "Risk / blocker", description: "A RAID entry that may impact timeline, quality, or objective attainment." },
  decision: { kind: "decision", curie: "atos:Decision", label: "Decision", description: "An open decision the programme must resolve." },
  stakeholder: { kind: "stakeholder", curie: "atos:Stakeholder", label: "Stakeholder", description: "A person or group with influence over or interest in the programme." },
  fact: { kind: "fact", curie: "atos:Fact", label: "Fact", description: "An atomic, citable statement derived from a confirmed phase input." },
  phase: { kind: "phase", curie: "atos:Phase", label: "Phase", description: "A methodology phase in the programme spine." },
  document: { kind: "document", curie: "atos:Document", label: "Document", description: "An imported source document facts were extracted from." },
  insight: { kind: "insight", curie: "atos:Insight", label: "Insight", description: "An extracted constraint/assumption/recommendation not mapped to a phase field." },
  "exit-criterion": { kind: "exit-criterion", curie: "atos:ExitCriterion", label: "Exit criterion", description: "A gate condition that evidences a phase is complete." },
};

/** Every relation kind the ontology recognises. */
export type RelationKind =
  | "measured-by"
  | "delivered-by"
  | "evidenced-by"
  | "reported-by"
  | "threatened-by"
  | "satisfied-by"
  | "grounds"
  | "sequence"
  | "in-phase"
  | "depends-on";

export interface RelationType {
  kind: RelationKind;
  curie: string;
  label: string;
  /** How the reverse direction reads, for bidirectional rendering. */
  inverseLabel: string;
  /** Entity kinds permitted as the edge source. */
  from: EntityKind[];
  /** Entity kinds permitted as the edge target. */
  to: EntityKind[];
  /**
   * True when the *absence* of this relation on an eligible source is itself a
   * gap (e.g. an objective with no `measured-by` KPI is unmeasurable). Drives the
   * confidence roll-up and the "what would improve confidence" recommendations.
   */
  gapWhenMissing: boolean;
}

export const RELATION_TYPES: Record<RelationKind, RelationType> = {
  "measured-by": {
    kind: "measured-by", curie: "atos:measuredBy", label: "is measured by", inverseLabel: "measures",
    from: ["objective"], to: ["kpi"], gapWhenMissing: true,
  },
  "delivered-by": {
    kind: "delivered-by", curie: "atos:deliveredBy", label: "is delivered by", inverseLabel: "delivers",
    from: ["objective", "requirement"], to: ["artifact", "design"], gapWhenMissing: true,
  },
  "evidenced-by": {
    kind: "evidenced-by", curie: "atos:evidencedBy", label: "is evidenced by", inverseLabel: "evidences",
    from: ["objective", "phase"], to: ["exit-criterion", "artifact"], gapWhenMissing: true,
  },
  "reported-by": {
    kind: "reported-by", curie: "atos:reportedBy", label: "is reported by", inverseLabel: "reports",
    // A KPI's actuals must be tracked by a reporting artifact (outcome framework,
    // benefits tracker, KPI dashboard). A KPI with no reporting artifact is
    // defined but unmeasured in practice, so its absence is itself a gap.
    from: ["kpi"], to: ["artifact"], gapWhenMissing: true,
  },
  "threatened-by": {
    kind: "threatened-by", curie: "atos:threatenedBy", label: "is threatened by", inverseLabel: "threatens",
    from: ["objective", "requirement", "artifact"], to: ["risk"], gapWhenMissing: false,
  },
  "satisfied-by": {
    kind: "satisfied-by", curie: "atos:satisfiedBy", label: "is satisfied by", inverseLabel: "satisfies",
    from: ["requirement"], to: ["design", "artifact"], gapWhenMissing: true,
  },
  grounds: {
    kind: "grounds", curie: "atos:grounds", label: "grounds", inverseLabel: "is grounded by",
    from: ["fact", "objective"], to: ["artifact", "design"], gapWhenMissing: false,
  },
  sequence: {
    kind: "sequence", curie: "atos:sequence", label: "precedes", inverseLabel: "follows",
    from: ["phase"], to: ["phase"], gapWhenMissing: false,
  },
  "in-phase": {
    kind: "in-phase", curie: "atos:inPhase", label: "belongs to phase", inverseLabel: "contains",
    from: ["fact", "artifact", "kpi", "risk", "decision", "requirement", "design", "insight", "exit-criterion", "objective"],
    to: ["phase"], gapWhenMissing: false,
  },
  "depends-on": {
    kind: "depends-on", curie: "atos:dependsOn", label: "depends on", inverseLabel: "is depended on by",
    from: ["artifact", "requirement", "design"], to: ["artifact", "requirement", "design"], gapWhenMissing: false,
  },
};

export const ENTITY_KINDS = Object.keys(ENTITY_TYPES) as EntityKind[];
export const RELATION_KINDS = Object.keys(RELATION_TYPES) as RelationKind[];

/** True when `kind` connecting a `from`→`to` pair is permitted by the ontology. */
export function isValidRelation(kind: RelationKind, from: EntityKind, to: EntityKind): boolean {
  const rel = RELATION_TYPES[kind];
  if (!rel) return false;
  return rel.from.includes(from) && rel.to.includes(to);
}

/** All relation kinds that could legally connect a `from`→`to` pair. */
export function relationsBetween(from: EntityKind, to: EntityKind): RelationKind[] {
  return RELATION_KINDS.filter((kind) => isValidRelation(kind, from, to));
}

/** Field-id / fact-type tokens (lowercased, substring-matched) that denote an
 *  objective. Kept here so both the graph builder and any agent share one rule. */
const OBJECTIVE_TOKENS = ["businessobjective", "programobjective", "primaryobjective", "objective", "objectives"];

/** True when a fact's semantic type (its originating field id) is an objective. */
export function isObjectiveFactType(factType: string | undefined): boolean {
  if (!factType) return false;
  const hay = factType.toLowerCase();
  return OBJECTIVE_TOKENS.some((token) => hay.includes(token));
}
