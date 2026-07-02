/**
 * Write-back validation loop — the closing half of ontology-native generation.
 *
 * ontologyOutput.ts lets a generator emit typed entities with stable ids and
 * constrained refs; this module validates that output *before* it is written back
 * into the programme, so a structurally-broken generation never enters the graph.
 * It resolves every ref against the union of the generated entities and the live
 * Program Graph node ids, and checks each ref's relation against the ontology's
 * from→to constraints (`isValidRelation`). Refs pointing nowhere (dangling),
 * self-references, and ontology-illegal relations are reported as *violations*;
 * expected-but-absent relations (`gapWhenMissing`) are reported as *gaps*.
 *
 * This is the generated-artifact → graph → validate loop: parse the generation
 * (ontologyOutput), reconcile it against the live graph (programGraph), and emit a
 * report the caller can gate on. Pure and derived — reads, writes nothing.
 */
import type { ProgramSummary } from "@/new/types";
import {
  buildProgramGraph,
  type ProgramGraphNode,
  type ProgramDocument,
} from "@/v3/lib/programGraph";
import {
  RELATION_KINDS,
  RELATION_TYPES,
  isValidRelation,
  isObjectiveFactType,
  type EntityKind,
  type RelationKind,
} from "@/v3/ontology/ontology";
import {
  parseOntologyEntities,
  isEntityKind,
  type OntologyEntity,
} from "@/v3/lib/ontologyOutput";

export type OntologyViolationKind = "dangling-ref" | "illegal-relation" | "self-reference";

export interface OntologyViolation {
  entityId: string;
  entityKind: EntityKind;
  relation: RelationKind;
  targetId: string;
  kind: OntologyViolationKind;
  detail: string;
}

export interface OntologyGapFinding {
  entityId: string;
  entityKind: EntityKind;
  relation: RelationKind;
  detail: string;
}

export interface OntologyValidationReport {
  /** True when there are no violations (gaps are advisory, not blocking). */
  valid: boolean;
  entityCount: number;
  violations: OntologyViolation[];
  gaps: OntologyGapFinding[];
}

export interface ValidateOntologyOptions {
  /**
   * Kinds of ids that already exist outside the generated set (e.g. live Program
   * Graph nodes) so a ref can legally resolve to an existing entity. The keys
   * are the extra resolvable ids; the value is each id's entity kind (used for
   * the relation check when a ref targets a live node).
   */
  knownKinds?: Map<string, EntityKind>;
}

/** Ontology entity kind for a Program Graph node, or null for non-ontology kinds. */
function graphNodeKind(node: ProgramGraphNode): EntityKind | null {
  if (node.type === "fact") {
    const factType = typeof node.properties?.factType === "string" ? node.properties.factType : undefined;
    return isObjectiveFactType(factType) ? "objective" : "fact";
  }
  // scope / increment are Program Graph kinds with no ontology entity type.
  return isEntityKind(node.type) ? node.type : null;
}

/**
 * Validate a set of generated ontology entities against the ontology vocabulary
 * and a set of already-resolvable ids. Every ref must resolve to a known id, must
 * not point at its own entity, and — when the target's kind is known — must be an
 * ontology-legal relation for that from→to kind pair. Expected relations
 * (gapWhenMissing) absent from an eligible source are reported as gaps.
 */
export function validateOntologyEntities(
  entities: OntologyEntity[],
  opts: ValidateOntologyOptions = {},
): OntologyValidationReport {
  const kindById = new Map<string, EntityKind>(opts.knownKinds ?? []);
  for (const entity of entities) kindById.set(entity.id, entity.kind);

  const violations: OntologyViolation[] = [];
  const gaps: OntologyGapFinding[] = [];

  for (const entity of entities) {
    for (const ref of entity.refs) {
      if (ref.to === entity.id) {
        violations.push({
          entityId: entity.id, entityKind: entity.kind, relation: ref.relation, targetId: ref.to,
          kind: "self-reference", detail: `${entity.kind} "${entity.label}" references itself via ${ref.relation}.`,
        });
        continue;
      }
      const targetKind = kindById.get(ref.to);
      if (!targetKind) {
        violations.push({
          entityId: entity.id, entityKind: entity.kind, relation: ref.relation, targetId: ref.to,
          kind: "dangling-ref", detail: `${ref.relation} target "${ref.to}" resolves to no known entity.`,
        });
        continue;
      }
      if (!isValidRelation(ref.relation, entity.kind, targetKind)) {
        violations.push({
          entityId: entity.id, entityKind: entity.kind, relation: ref.relation, targetId: ref.to,
          kind: "illegal-relation",
          detail: `${ref.relation} is not permitted from ${entity.kind} to ${targetKind}.`,
        });
      }
    }

    // Expected-relation gaps: an eligible source missing a gapWhenMissing relation.
    for (const relKind of RELATION_KINDS) {
      const rel = RELATION_TYPES[relKind];
      if (!rel.gapWhenMissing || !rel.from.includes(entity.kind)) continue;
      if (!entity.refs.some((r) => r.relation === relKind)) {
        gaps.push({
          entityId: entity.id, entityKind: entity.kind, relation: relKind,
          detail: `${entity.kind} "${entity.label}" has no ${relKind} relation (${rel.label}).`,
        });
      }
    }
  }

  return { valid: violations.length === 0, entityCount: entities.length, violations, gaps };
}

export interface GeneratedArtifactValidation {
  entities: OntologyEntity[];
  report: OntologyValidationReport;
}

/**
 * End-to-end write-back check: parse raw generator output into ontology entities,
 * reconcile refs against the live Program Graph, and validate. The graph supplies
 * the resolvable-id set so a generated artifact may legally reference existing
 * facts, KPIs, risks and prior artifacts by their graph id.
 */
export function validateGeneratedArtifact(
  raw: unknown,
  program: ProgramSummary | null | undefined,
  documents: ProgramDocument[] = [],
): GeneratedArtifactValidation {
  const entities = parseOntologyEntities(raw);
  const knownKinds = new Map<string, EntityKind>();
  if (program) {
    const graph = buildProgramGraph(program, documents);
    for (const node of graph.nodes) {
      const kind = graphNodeKind(node);
      if (kind) knownKinds.set(node.id, kind);
    }
  }
  return { entities, report: validateOntologyEntities(entities, { knownKinds }) };
}
