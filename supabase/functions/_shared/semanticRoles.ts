/**
 * Semantic role derivation — the bridge vocabulary between the ontology/fabric
 * and the design system (docs/aura/semantic-roles.md). The fabric emits a role
 * per node; the design system consumes it; neither references the other.
 *
 * CRITICAL honesty property: every role is tagged with the METHOD that produced
 * it — `derived` (deterministic, from cardinality; confidence 1.0) or `heuristic`
 * (a name-pattern guess, because the ontology has no attribute types to read).
 * A consumer must be able to tell a known role from a guessed one, so this is
 * carried through the fabric, not discarded.
 *
 * Pure, deterministic, no model call. Read-only over the ontology.
 */
import { deriveAttributeReferences, deriveOntologyGraph, nameWords } from "./ontologyGraph.ts";

export type ValueRole =
  | "identifier" | "title" | "description"
  | "monetary" | "date" | "quantity" | "percent" | "code" | "category" | "free-text" | "boolean"
  | "status" | "health" | "priority"
  | "parent-ref" | "person-ref" | "cross-ref";
/** `undetermined` is a SHAPE PLUS A CONFESSION: it renders like a collection so
 *  the screen is still usable, and it is a distinct value so every surface can
 *  tell "many of these hang off it" from "nobody has said yet". */
export type RelationshipRole = "collection" | "parent-ref" | "multi-select" | "undetermined";

export type RoleMethod = "derived" | "heuristic";

export interface AttributeRole {
  entity: string;
  attribute: string;
  role: ValueRole;
  method: RoleMethod;
  confidence: number; // 1.0 for derived (identifier from the name attr), <1 for heuristics
  /** For a reference role: the ontology entity this attribute names, when the
   *  ontology itself supplied the answer (see `deriveAttributeReferences`). A
   *  consumer that has to produce a VALUE for the column needs to know what it
   *  points at — "Northwind sync" in an Opportunity column is what not knowing
   *  looks like. */
  refEntity?: string;
}
export interface RelationRole {
  from: string;
  to: string;
  cardinality: string;
  /** Role on the PARENT side (the `from` entity's detail). */
  parentRole: RelationshipRole;
  /** Role on the CHILD side (the `to` entity's form). */
  childRole: "parent-ref" | "cross-ref";
  method: "derived"; // relationship roles are always derived from cardinality
}
export interface OntologyRoles {
  attributeRoles: AttributeRole[];
  relationRoles: RelationRole[];
}

const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();
const attrName = (a: unknown): string => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""));
const attrType = (a: unknown): string => (typeof a === "object" && a
  ? String((a as { type?: unknown; dataType?: unknown }).type ?? (a as { dataType?: unknown }).dataType ?? "")
  : "");

/**
 * Name-pattern heuristics for value roles, ordered — first match wins. Each
 * carries a confidence: strong single-purpose names score high, ambiguous low.
 *
 * They are tested against the attribute name SPLIT INTO WORDS ("annualRevenue"
 * → "annual revenue"), because a schema-shaped name is words with the spaces
 * taken out. Anchored on `_` and start/end, `revenue` did not match
 * `annualRevenue`, so an Annual Revenue column rendered "Northwind assessment"
 * — the same class of defect as the rest of this file, one word boundary away.
 */
const VALUE_HEURISTICS: Array<{ re: RegExp; role: ValueRole; confidence: number }> = [
  { re: /(^| )(amount|revenue|price|cost|fee|arr|mrr|acv|tcv|value|budget|spend)($| )/i, role: "monetary", confidence: 0.85 },
  { re: /(^| )(date|at|closedate|due on|deadline|timestamp|created|updated)($| )/i, role: "date", confidence: 0.85 },
  // A percent is BOUNDED. It shared the quantity branch, which knows nothing
  // about bounds, so a "split percent" column rendered 145, 181, 107 — a
  // share of a whole, over the whole. Its own role is what carries the bound.
  { re: /(^| )(percent|percentage|pct)($| )/i, role: "percent", confidence: 0.8 },
  // "invoice number" / "quote number" / "po no" is a HANDLE; "number of
  // employees" is a count. The difference is whether the word ENDS the name.
  { re: /(^| )\S.*( )(number|no|code|id)$/i, role: "code", confidence: 0.65 },
  { re: /(^| )(count|qty|quantity|number|score|rate|ratio|total|units?)($| )/i, role: "quantity", confidence: 0.7 },
  { re: /(^| )(status|state|stage|phase)($| )/i, role: "status", confidence: 0.7 },
  { re: /(^| )(health|rag)($| )/i, role: "health", confidence: 0.75 },
  { re: /(^| )(priority|severity|urgency)($| )/i, role: "priority", confidence: 0.75 },
  { re: /(^| )(is|has|can|should|active|enabled|flag|flagged)($| )/i, role: "boolean", confidence: 0.6 },
  // A person-shaped reference and an entity-shaped one are NOT the same column.
  // They used to share one role, and because the seed generator had no branch
  // for it at all, an "owner" field rendered as "Northwind onboarding" — an
  // engagement sitting in the Owner column of a demo. Split them so the value
  // generator can shape each correctly.
  { re: /(^| )(owner|manager|rep|assignee|approver|requester|contact)($| )/i, role: "person-ref", confidence: 0.55 },
  // A category/type/segment/tier is a LABEL a person reads. It shared the `code`
  // branch, which mints XXX-NNNN handles, so a "forecast category" column
  // rendered PRA-5570. A code is a HANDLE; the two are not the same column.
  { re: /(^| )(type|category|segment|tier|region|industry|source|channel|classification|band|grade|kind)($| )/i, role: "category", confidence: 0.6 },
  { re: /(^| )(code|sku|ref|reference|num)($| )/i, role: "code", confidence: 0.6 },
  // LAST RESORT, and only for an ontology whose entity list does not name the
  // target — `deriveAttributeReferences` gets first refusal, because the
  // ontology's own entity names beat any word list somebody remembered to write.
  // It sits below `category` so "lead source" is read as the category it is.
  { re: /(^| )(account|parent|lead)($| )/i, role: "parent-ref", confidence: 0.55 },
];

/** Read an ontology's attribute `type` if present; otherwise fall to the name
 * heuristic. The identifier/title attribute (the entity's name field) is derived. */
function roleForAttribute(
  entity: string,
  attr: unknown,
  index: number,
  titleIndex: number,
  refFor: (attribute: string) => { target: string; match: "exact" | "qualified"; isParent: boolean } | undefined,
): AttributeRole {
  const name = attrName(attr);
  const t = norm(attrType(attr));
  // If the ontology ever grows a real type field, use it — that is DERIVED.
  const typed: Record<string, ValueRole> = {
    monetary: "monetary", currency: "monetary", money: "monetary",
    date: "date", datetime: "date", timestamp: "date",
    number: "quantity", integer: "quantity", float: "quantity", decimal: "quantity",
    boolean: "boolean", bool: "boolean",
    enum: "code", code: "code", status: "status",
    text: "free-text", string: "free-text",
  };
  if (t && typed[t]) return { entity, attribute: name, role: typed[t], method: "derived", confidence: 1 };
  // The entity's TITLE is the attribute actually named like one — and only that.
  // Treating "first attribute" as the title unconditionally made Contact's
  // `buyingRole` the title AND `title` the identifier (two columns, one string),
  // and on an entity with no name at all it made `stage` the title of an
  // Opportunity. `titleIndex` is -1 when the ontology names no such attribute.
  if (index === titleIndex && titleIndex >= 0) {
    return { entity, attribute: name, role: "title", method: "heuristic", confidence: titleIndex === 0 ? 0.65 : 0.8 };
  }
  // THE ONTOLOGY ANSWERS FIRST. If the attribute's name is an entity of this
  // ontology, the attribute references that entity — evidence from the model in
  // front of us, not from a word list somebody hardcoded. It stays tagged
  // `heuristic` because the ontology still declares no attribute TYPES: naming
  // an entity is strong evidence of a reference, not a statement of one. The
  // confidence says how strong, and `refEntity` carries the answer downstream.
  // It is asked BEFORE the identifier pattern so `accountId` is read as the
  // reference it is rather than as this entity's own handle.
  const ref = refFor(name);
  if (ref) {
    return { entity, attribute: name, role: ref.isParent ? "parent-ref" : "cross-ref", method: "heuristic",
      confidence: ref.match === "exact" ? 0.9 : 0.8, refEntity: ref.target };
  }
  const words = nameWords(name).join(" ");
  if (/(^| )(name|title|label|id)($| )/i.test(words)) {
    return { entity, attribute: name, role: "identifier", method: "heuristic", confidence: 0.65 };
  }
  for (const h of VALUE_HEURISTICS) if (h.re.test(words)) {
    return { entity, attribute: name, role: h.role, method: "heuristic", confidence: h.confidence };
  }
  return { entity, attribute: name, role: "free-text", method: "heuristic", confidence: 0.4 };
}

/**
 * Relationship roles from a cardinality, read `from` → `to`. The ONE definition:
 * `rolesForRelation` reads it as the ontology declared the relation, and the
 * fabric reads it in the graph's normalised parent→child direction (an N:1 read
 * from the parent's side is a 1:N, and therefore a collection on that parent).
 */
export function relationshipRolesFor(cardinality: string): { parentRole: RelationshipRole; childRole: "parent-ref" | "cross-ref" } {
  const c = cardinality.replace(/\s/g, "").toUpperCase();
  let parentRole: RelationshipRole = "undetermined";
  if (c === "N:M" || c === "M:N" || c === "*:*") parentRole = "multi-select";
  else if (c === "N:1" || c === "1:1") parentRole = "parent-ref";
  else if (c === "1:N") parentRole = "collection";
  // UNKNOWN IS NOT ONE-TO-MANY. It used to fall through to `collection`, which
  // made the prototype assert a cardinality nobody had confirmed — and the
  // ontology generator writes "unknown" on EVERY relation of a provisional
  // draft on purpose ("cardinality is precisely what interviews confirm; never
  // guess 1:N"). So on a programme before its interviews, every relation was
  // silently drawn as a child table. `undetermined` keeps the shape a list can
  // take while letting the surface SAY it is unconfirmed, which is the whole
  // point of asking. See rolesForRelation for how a standard prior or an
  // attribute-level FK can raise it to a real role with its grounds recorded.
  else parentRole = "undetermined";
  return { parentRole, childRole: parentRole === "multi-select" ? "cross-ref" : "parent-ref" };
}

/**
 * Does this attribute NAME read like the thing a person calls the record? The
 * ONE definition — `deriveRoles` uses it to pick the title, and the seed uses it
 * to notice when an entity declares no such attribute at all and its display
 * name had to be taken positionally (which is a question for Listen, not a fact).
 */
export function readsLikeATitle(attribute: unknown): boolean {
  return /(^| )(name|title|label)($| )/i.test(nameWords(attribute).join(" "));
}

/** Relationship role from cardinality — always deterministic. */
function rolesForRelation(from: string, to: string, cardinality: string): RelationRole {
  const c = cardinality.replace(/\s/g, "").toUpperCase();
  const { parentRole, childRole } = relationshipRolesFor(c);
  return { from, to, cardinality: c, parentRole, childRole, method: "derived" };
}

/** Derive every semantic role from an ontology, tagged derived vs heuristic. */
export function deriveRoles(ontology: Record<string, unknown>): OntologyRoles {
  const entities = Array.isArray(ontology.entities) ? ontology.entities : [];
  const relations = Array.isArray(ontology.relations) ? ontology.relations : [];
  const attributeRoles: AttributeRole[] = [];
  // The ontology's own answer to "what does this attribute point at", derived
  // once in `ontologyGraph` and read here — never re-derived.
  const graph = deriveOntologyGraph(ontology);
  const refIx = new Map(deriveAttributeReferences(ontology).map((r) => [`${r.entity} ${r.attribute}`, r] as const));
  for (const e of entities) {
    const name = String((e as { name?: unknown })?.name ?? "");
    const parentsOf = new Set(graph.byName[name]?.parents ?? []);
    const refFor = (attribute: string) => {
      const r = refIx.get(`${name} ${attribute}`);
      return r ? { target: r.target, match: r.match, isParent: parentsOf.has(r.target) } : undefined;
    };
    const attrs = Array.isArray((e as { attributes?: unknown }).attributes) ? (e as { attributes: unknown[] }).attributes : [];
    // Which attribute is this entity's title: the first one named like one,
    // else the first attribute. Decided ONCE per entity so exactly one
    // attribute can hold the role.
    // If NOTHING is named like a title, this entity has no title attribute —
    // full stop. Handing the role to whatever happened to be listed first put
    // account names under a "Category" heading and engagement names under
    // "Status" on two thirds of a real 33-entity ontology, and it silently
    // overwrote the role those attributes actually have. The absence is real;
    // the seed reports it
    // as a Listen question and supplies a display name of its own.
    const titleIndex = attrs.findIndex((a) => readsLikeATitle(attrName(a)));
    attrs.forEach((a, i) => attributeRoles.push(roleForAttribute(name, a, i, titleIndex, refFor)));
  }
  const relationRoles = relations.map((r) => {
    const rr = r as { from?: unknown; to?: unknown; cardinality?: unknown };
    return rolesForRelation(String(rr.from ?? ""), String(rr.to ?? ""), String(rr.cardinality ?? ""));
  });
  return { attributeRoles, relationRoles };
}

/** The derived-vs-heuristic split, as a report figure. */
export function roleDerivationSplit(roles: OntologyRoles): {
  attributes: { total: number; derived: number; heuristic: number; derivedPct: number };
  relations: { total: number; derived: number };
} {
  const a = roles.attributeRoles;
  const derived = a.filter((r) => r.method === "derived").length;
  return {
    attributes: { total: a.length, derived, heuristic: a.length - derived, derivedPct: a.length ? +(100 * derived / a.length).toFixed(1) : 0 },
    relations: { total: roles.relationRoles.length, derived: roles.relationRoles.length },
  };
}
