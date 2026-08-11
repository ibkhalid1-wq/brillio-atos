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

export type ValueRole =
  | "identifier" | "title" | "description"
  | "monetary" | "date" | "quantity" | "code" | "free-text" | "boolean"
  | "status" | "health" | "priority"
  | "parent-ref" | "person-ref" | "cross-ref";
export type RelationshipRole = "collection" | "parent-ref" | "multi-select";
export type RoleMethod = "derived" | "heuristic";

export interface AttributeRole {
  entity: string;
  attribute: string;
  role: ValueRole;
  method: RoleMethod;
  confidence: number; // 1.0 for derived (identifier from the name attr), <1 for heuristics
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

/** Name-pattern heuristics for value roles, ordered — first match wins. Each
 * carries a confidence: strong single-purpose names score high, ambiguous low. */
const VALUE_HEURISTICS: Array<{ re: RegExp; role: ValueRole; confidence: number }> = [
  { re: /(^|_)(amount|revenue|price|cost|fee|arr|mrr|acv|tcv|value|budget|spend)($|_)/i, role: "monetary", confidence: 0.85 },
  { re: /(^|_)(date|_at$|closedate|dueon|deadline|timestamp|createdat|updatedat)($|_)/i, role: "date", confidence: 0.85 },
  { re: /(^|_)(count|qty|quantity|number|score|percent|rate|ratio|total|units?)($|_)/i, role: "quantity", confidence: 0.7 },
  { re: /(^|_)(status|state|stage|phase)($|_)/i, role: "status", confidence: 0.7 },
  { re: /(^|_)(health|rag)($|_)/i, role: "health", confidence: 0.75 },
  { re: /(^|_)(priority|severity|urgency)($|_)/i, role: "priority", confidence: 0.75 },
  { re: /(^|_)(is|has|can|should|active|enabled|flag)($|_|[a-z])/i, role: "boolean", confidence: 0.6 },
  // A person-shaped reference and an entity-shaped one are NOT the same column.
  // They used to share one role, and because the seed generator had no branch
  // for it at all, an "owner" field rendered as "Northwind onboarding" — an
  // engagement sitting in the Owner column of a demo. Split them so the value
  // generator can shape each correctly.
  { re: /(^|_)(owner|manager|rep|assignee|approver|requester|contact)($|_)/i, role: "person-ref", confidence: 0.55 },
  { re: /(^|_)(account|parent|lead)($|_)/i, role: "parent-ref", confidence: 0.55 },
  { re: /(^|_)(type|category|segment|tier|region|industry|code|source|channel)($|_)/i, role: "code", confidence: 0.6 },
];

/** Read an ontology's attribute `type` if present; otherwise fall to the name
 * heuristic. The identifier/title attribute (the entity's name field) is derived. */
function roleForAttribute(entity: string, attr: unknown, index: number, titleIndex: number): AttributeRole {
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
  // The entity's TITLE is the attribute actually named like one; position is
  // only the fallback when no attribute says so. Treating "first attribute" as
  // the title unconditionally made Contact's `buyingRole` the title AND
  // `title` the identifier — and since both roles generated the same synthetic
  // string, the demo's first two columns were literally identical values.
  if (index === titleIndex) {
    return { entity, attribute: name, role: "title", method: "heuristic", confidence: titleIndex === 0 ? 0.65 : 0.8 };
  }
  if (/(^|_)(name|title|label|id)($|_)/i.test(name)) {
    return { entity, attribute: name, role: "identifier", method: "heuristic", confidence: 0.65 };
  }
  for (const h of VALUE_HEURISTICS) if (h.re.test(name)) {
    return { entity, attribute: name, role: h.role, method: "heuristic", confidence: h.confidence };
  }
  return { entity, attribute: name, role: "free-text", method: "heuristic", confidence: 0.4 };
}

/** Relationship role from cardinality — always deterministic. */
function rolesForRelation(from: string, to: string, cardinality: string): RelationRole {
  const c = cardinality.replace(/\s/g, "").toUpperCase();
  let parentRole: RelationshipRole = "collection";
  if (c === "N:M" || c === "M:N" || c === "*:*") parentRole = "multi-select";
  else if (c === "N:1") parentRole = "parent-ref";
  else if (c === "1:1") parentRole = "parent-ref";
  else parentRole = "collection"; // 1:N and unknown default to a child collection on the parent
  const childRole = parentRole === "multi-select" ? "cross-ref" : "parent-ref";
  return { from, to, cardinality: c, parentRole, childRole, method: "derived" };
}

/** Derive every semantic role from an ontology, tagged derived vs heuristic. */
export function deriveRoles(ontology: Record<string, unknown>): OntologyRoles {
  const entities = Array.isArray(ontology.entities) ? ontology.entities : [];
  const relations = Array.isArray(ontology.relations) ? ontology.relations : [];
  const attributeRoles: AttributeRole[] = [];
  for (const e of entities) {
    const name = String((e as { name?: unknown })?.name ?? "");
    const attrs = Array.isArray((e as { attributes?: unknown }).attributes) ? (e as { attributes: unknown[] }).attributes : [];
    // Which attribute is this entity's title: the first one named like one,
    // else the first attribute. Decided ONCE per entity so exactly one
    // attribute can hold the role.
    const named = attrs.findIndex((a) => /(^|_)(name|title|label)($|_)/i.test(attrName(a)));
    const titleIndex = named >= 0 ? named : 0;
    attrs.forEach((a, i) => attributeRoles.push(roleForAttribute(name, a, i, titleIndex)));
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
