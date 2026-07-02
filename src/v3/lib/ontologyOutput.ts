/**
 * Ontology-native generation output — the schema + serialiser + parser that lets
 * a generator emit *typed entities with stable ids and constrained refs* instead
 * of a free-text blob.
 *
 * The ontology (ontology.ts) already declares the vocabulary (entity kinds and
 * constrained relations); the Program/Objective graphs already re-express a live
 * programme in that vocabulary. What was missing was the other direction: giving
 * the *generator* the same vocabulary so its output is ontology-native — a set of
 * entities each tagged with an ontology kind, a stable id, and typed references to
 * other entities. That is what makes the write-back validation loop
 * (ontologyWriteBack.ts) possible: you cannot validate structure you never
 * asked for.
 *
 * Three pure, storage-free pieces:
 *   • `describeOntologyOutputContract` — the prompt instruction that tells the
 *     generator the entity/relation vocabulary and how to shape its output.
 *   • `stableEntityId` — deterministic `<kind>:<slug>` id assignment so the same
 *     entity gets the same id across runs (idempotent write-back).
 *   • `parseOntologyEntities` — tolerant parser that normalises raw generator
 *     output into validated `OntologyEntity[]`, dropping anything off-vocabulary.
 */
import {
  ENTITY_KINDS,
  RELATION_KINDS,
  RELATION_TYPES,
  ENTITY_TYPES,
  type EntityKind,
  type RelationKind,
} from "@/v3/ontology/ontology";

/** A typed reference from one entity to another, using an ontology relation. */
export interface OntologyRef {
  relation: RelationKind;
  /** The target entity id (a stable `<kind>:<slug>` id or an existing graph id). */
  to: string;
}

/** A single ontology-native entity emitted by a generator, after normalisation. */
export interface OntologyEntity {
  /** Stable `<kind>:<slug>` id (assigned when the generator omitted one). */
  id: string;
  kind: EntityKind;
  label: string;
  refs: OntologyRef[];
  /** 0–1 generator confidence, when provided. */
  confidence?: number;
  properties?: Record<string, unknown>;
}

const ENTITY_KIND_SET = new Set<EntityKind>(ENTITY_KINDS);
const RELATION_KIND_SET = new Set<RelationKind>(RELATION_KINDS);

/**
 * Id prefix per entity kind. Uses the kind itself for most, with the same
 * abbreviations the Program Graph uses (`doc` for document) so a generated id can
 * line up with an existing graph node id without translation.
 */
const KIND_ID_PREFIX: Record<EntityKind, string> = {
  objective: "objective",
  kpi: "kpi",
  requirement: "requirement",
  design: "design",
  artifact: "artifact",
  risk: "risk",
  decision: "decision",
  stakeholder: "stakeholder",
  fact: "fact",
  phase: "phase",
  document: "doc",
  insight: "insight",
  "exit-criterion": "exit",
};

/** Lowercase slug for the id tail; collapses non-alphanumerics and caps length. */
function slug(label: string, max = 48): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (s || "entity").slice(0, max).replace(/-+$/g, "");
}

/**
 * Deterministic id for an entity: `<kind-prefix>:<slug(label)>`. Same kind+label
 * always yields the same id, so re-generating an unchanged entity writes back to
 * the same node rather than duplicating it.
 */
export function stableEntityId(kind: EntityKind, label: string): string {
  return `${KIND_ID_PREFIX[kind]}:${slug(label)}`;
}

/** True when a string is a recognised ontology entity kind. */
export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && ENTITY_KIND_SET.has(value as EntityKind);
}

/** True when a string is a recognised ontology relation kind. */
export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === "string" && RELATION_KIND_SET.has(value as RelationKind);
}

const CONTRACT_HEADER =
  "Emit ontology-native output: a JSON array of typed entities. Each entity is " +
  '{ "kind", "label", "refs": [{ "relation", "to" }] }, where `to` is the id or ' +
  "label of another entity. Use only these kinds and relations:";

/**
 * The generation-output contract for the prompt: the entity vocabulary and the
 * constrained relations (with their permitted endpoints), plus which relations are
 * expected (their absence is a gap). Bounded to `maxChars` — relation lines are
 * dropped from the tail before entity lines, since endpoints matter most.
 */
export function describeOntologyOutputContract(maxChars = 900): string {
  const kindLine = `Kinds: ${ENTITY_KINDS.map((k) => ENTITY_TYPES[k].curie.replace(/^atos:/, "")).join(", ")}.`;
  const relationLines = RELATION_KINDS.map((k) => {
    const r = RELATION_TYPES[k];
    const expected = r.gapWhenMissing ? " [expected]" : "";
    return `- ${r.kind}: ${r.from.join("/")} → ${r.to.join("/")}${expected}`;
  });

  const lines = [CONTRACT_HEADER, kindLine, "Relations:", ...relationLines];
  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) continue;
    out += (out ? "\n" : "") + line;
  }
  return out;
}

/** Coerce one raw ref object into a valid OntologyRef, or null when off-vocabulary. */
function parseRef(raw: unknown): OntologyRef | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const relation = rec.relation ?? rec.kind;
  const to = rec.to ?? rec.target;
  if (!isRelationKind(relation)) return null;
  if (typeof to !== "string" || !to.trim()) return null;
  return { relation, to: to.trim() };
}

/**
 * Parse tolerant raw generator output into normalised ontology entities. Accepts
 * a JSON string, an array, or an object with an `entities` array. Entries with an
 * unknown kind or a blank label are dropped; each surviving entity is assigned a
 * stable id when it has none, its refs are filtered to the ontology's relation
 * vocabulary, and duplicate ids collapse (first wins, later refs merged in).
 */
export function parseOntologyEntities(raw: unknown): OntologyEntity[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).entities)
      ? ((value as Record<string, unknown>).entities as unknown[])
      : [];

  const byId = new Map<string, OntologyEntity>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (!isEntityKind(rec.kind)) continue;
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    if (!label) continue;

    const id =
      typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : stableEntityId(rec.kind, label);
    const refs = Array.isArray(rec.refs)
      ? rec.refs.map(parseRef).filter((r): r is OntologyRef => r !== null)
      : [];
    const confidence = typeof rec.confidence === "number" ? rec.confidence : undefined;
    const properties =
      rec.properties && typeof rec.properties === "object" && !Array.isArray(rec.properties)
        ? (rec.properties as Record<string, unknown>)
        : undefined;

    const existing = byId.get(id);
    if (existing) {
      // Merge refs from a duplicate emission, deduping by relation+to.
      const seen = new Set(existing.refs.map((r) => `${r.relation}->${r.to}`));
      for (const r of refs) {
        const key = `${r.relation}->${r.to}`;
        if (!seen.has(key)) {
          existing.refs.push(r);
          seen.add(key);
        }
      }
      continue;
    }
    byId.set(id, { id, kind: rec.kind, label, refs, confidence, properties });
  }
  return [...byId.values()];
}
