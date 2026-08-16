/**
 * Fabric derivation — the deterministic intermediate between ontology/atlas and
 * prototype (docs/aura/fabric.md). Ontology + atlas in, fabric out, NO model call.
 *
 * Every node carries: its ontology `source` reference, its semantic `role` with
 * the METHOD that produced it (derived vs heuristic — a consumer must tell a known
 * role from a guessed one), and a content `hash` of its derivation inputs so the
 * same ontology version yields a byte-identical fabric (idempotency, tested).
 *
 * Region identity is `sourceSlug + role`, NEVER positional — the stable-identity
 * discipline this codebase has broken three times (EvidenceEntry / MovementStakeholder
 * / DrillAnchor index ids). Entity/attribute/relation ids are name-based; atlas
 * flows are keyed by workflow-name slug; nothing is keyed by array index.
 */
import { deriveRoles, relationshipRolesFor, type ValueRole, type RelationshipRole, type RoleMethod } from "./semanticRoles.ts";
import { deriveOntologyGraph, joinKeyFor, junctionKeyFor, type OntologyGraph } from "./ontologyGraph.ts";

export type FabricKind = "screen" | "region" | "field" | "nav" | "flow";
export interface FabricNode {
  kind: FabricKind;
  id: string;
  source: { entity?: string; relation?: [string, string]; attribute?: string; atlasWorkflow?: string };
  role?: ValueRole | RelationshipRole;
  roleMethod?: RoleMethod;
  roleConfidence?: number;
  /**
   * HOW THIS RELATION IS RESOLVED IN THE DATA — carried here because the fabric
   * IS the structural intermediate: a consumer asking "which rows belong to this
   * record" reads the answer off the node that declares the relation, instead of
   * reconstructing a naming convention and hoping the seeder used the same one.
   *
   * `joinKey`: the FK column on the CHILD rows, present on every `collection`
   * region and every `parent-ref` nav (`joinKeyFor`, the one definition).
   * `junctionKey`: the membership table for a `multi-select` region
   * (`junctionKeyFor`) — a many-to-many owns no FK on either side.
   *
   * Deliberately OUTSIDE the node hash. Both are pure functions of `source`,
   * which is hashed, so they carry no information the hash does not already
   * cover; including them would move `version` — and with it every seeded value
   * downstream, since the seed is keyed by the fabric version — for a derivation
   * that did not change.
   */
  joinKey?: string;
  junctionKey?: string;
  children: string[];
  hash: string;
  refined: boolean;
}
export interface Fabric {
  nodes: FabricNode[];
  warnings: string[];
  version: string; // hash of the whole fabric — same ontology → same version
  /** The ontology's parent→child graph, derived once (see ontologyGraph.ts) and
   *  carried on the fabric because the fabric IS the structural intermediate:
   *  a consumer asking "what nests under what, and what leads" reads it here
   *  rather than re-walking `relations` for the third time. */
  graph: OntologyGraph;
}

const slug = (s: unknown): string => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** Deterministic 32-bit string hash → 8-char hex (djb2). No Date/Math.random. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Unique-slug allocator with a logged collision suffix (never a silent merge). */
function uniquifier(warnings: string[], context: string) {
  const seen = new Map<string, number>();
  return (base: string): string => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (n === 0) return base;
    warnings.push(`collision: ${context} "${base}" appears ${n + 1}×; suffixed :${n + 1}`);
    return `${base}:${n + 1}`;
  };
}

export function deriveFabric(ontology: Record<string, unknown>, atlas: Record<string, unknown>): Fabric {
  const warnings: string[] = [];
  const roles = deriveRoles(ontology);
  const attrRoleIx = new Map(roles.attributeRoles.map((r) => [`${r.entity}\u0000${r.attribute}`, r]));
  const entities = Array.isArray(ontology.entities) ? ontology.entities as Array<Record<string, unknown>> : [];
  const workflows = Array.isArray(atlas.workflows) ? atlas.workflows as Array<Record<string, unknown>> : [];

  const nodes: FabricNode[] = [];
  const push = (n: Omit<FabricNode, "hash" | "refined">): string => {
    const h = hash(JSON.stringify({ kind: n.kind, id: n.id, source: n.source, role: n.role, roleMethod: n.roleMethod, children: n.children }));
    nodes.push({ ...n, hash: h, refined: false });
    return n.id;
  };

  // ── Entities → detail screen + list screen + summary region + field nodes ──
  const entSlug = new Map<string, string>();
  const uniqEnt = uniquifier(warnings, "entity");
  for (const e of entities) {
    const name = String(e.name ?? "");
    if (!name) continue;
    entSlug.set(name, uniqEnt(slug(name)));
  }
  // Child-collection + parent-ref maps, read off the ontology graph in its
  // NORMALISED direction. Reading each relation as written put the collection
  // and the parent nav on the wrong sides of an N:1: "Contact is part of
  // Account" gave Account's detail a nav *to Contact* labelled parent-ref, and
  // gave Account no Contacts collection at all — the parent listing none of its
  // children while claiming to be one of theirs.
  const graph = deriveOntologyGraph(ontology);
  const childCollections = new Map<string, Array<{ child: string; role: RelationshipRole }>>();
  const parentRefs = new Map<string, Array<{ parent: string }>>();
  const pairSeen = new Set<string>();
  const link = (parent: string, child: string, role: RelationshipRole) => {
    if (!entSlug.has(parent) || !entSlug.has(child) || parent === child) return;
    if (pairSeen.has(`${parent}>${child}`)) return;           // one region per pair, never a silent duplicate id
    pairSeen.add(`${parent}>${child}`);
    // `undetermined` earns a region like a collection does. It is the role a
    // relation carries before anyone has confirmed its cardinality, and on a
    // provisional draft that is EVERY relation — omit it here and a
    // pre-interview programme renders a detail page with no related records at
    // all, which is a worse lie than the 1:N this replaced.
    if (role === "collection" || role === "multi-select" || role === "undetermined") {
      (childCollections.get(parent) ?? childCollections.set(parent, []).get(parent)!).push({ child, role });
    }
    // A MANY-TO-MANY HAS NO SINGLE PARENT — that is what makes it one. This
    // push used to be unconditional, so a junction pair minted BOTH the correct
    // `multi-select` region on one side AND a `parent-ref` nav on the other, and
    // the same build then said two contradictory things about one relation:
    // chips naming five linked Campaigns on the Campaign side, and a "Belongs
    // to" card naming ONE Campaign on the Account side. Worse, the card could
    // not even name that one: a `parent-ref` resolves through `joinKey`, a
    // many-to-many owns no FK on either side, so the column never resolved and
    // every such card rendered "— none named" for records whose membership the
    // same document shipped as data.
    //
    // Keyed on the ROLE, not on the call site: whatever route a pair takes to
    // get here, it is the cardinality that decides whether "belongs to one" is
    // a true sentence about it.
    if (role !== "multi-select") {
      (parentRefs.get(child) ?? parentRefs.set(child, []).get(child)!).push({ parent });
    }
  };
  for (const e of graph.edges) link(e.parent, e.child, relationshipRolesFor(e.parentToChild).parentRole);
  for (const j of graph.junctions) link(j.from, j.to, "multi-select");

  for (const e of entities) {
    const name = String(e.name ?? "");
    const es = entSlug.get(name);
    if (!es) continue;
    const attrs = Array.isArray(e.attributes) ? e.attributes : [];
    const uniqAttr = uniquifier(warnings, `entity ${name} attribute`);
    // field nodes
    const fieldIds: string[] = [];
    for (const a of attrs) {
      const an = typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? "");
      if (!an) continue;
      const key = uniqAttr(slug(an));
      const r = attrRoleIx.get(`${name}\u0000${an}`);
      fieldIds.push(push({ kind: "field", id: `field:${es}:${key}`, source: { entity: name, attribute: an },
        role: r?.role, roleMethod: r?.method, roleConfidence: r?.confidence, children: [] }));
    }
    const summaryId = push({ kind: "region", id: `region:${es}:summary`, source: { entity: name }, children: fieldIds });
    // parent-ref navs on this entity's detail (it belongs to a parent)
    const navIds = (parentRefs.get(name) ?? []).map(({ parent }) =>
      push({ kind: "nav", id: `nav:${es}:${entSlug.get(parent)}`, source: { relation: [parent, name] }, role: "parent-ref", roleMethod: "derived",
        joinKey: joinKeyFor(parent), children: [] }));
    // child-collection regions on this entity's detail
    const collIds = (childCollections.get(name) ?? []).map(({ child, role }) =>
      push({ kind: "region", id: `region:${es}:${entSlug.get(child)}`, source: { relation: [name, child] }, role, roleMethod: "derived",
        // A collection's children are found by the parent's FK; a multi-select's
        // by its membership table. One address per role, never a guess.
        joinKey: role === "multi-select" ? undefined : joinKeyFor(name),
        junctionKey: role === "multi-select" ? junctionKeyFor(name, child) : undefined,
        children: [`screen:${entSlug.get(child)}:list`] }));
    push({ kind: "screen", id: `screen:${es}`, source: { entity: name }, children: [summaryId, ...navIds, ...collIds] });
    push({ kind: "screen", id: `screen:${es}:list`, source: { entity: name }, children: fieldIds.slice(0, 6) });
  }

  // ── Atlas workflows → flow nodes (keyed by workflow-name slug, not index) ──
  const uniqWf = uniquifier(warnings, "workflow");
  for (const w of workflows) {
    const wn = String(w.name ?? "");
    if (!wn) continue;
    push({ kind: "flow", id: `flow:${uniqWf(slug(wn))}`, source: { atlasWorkflow: wn }, children: [] });
  }

  const version = hash(nodes.map((n) => n.id + n.hash).join("|"));
  return { nodes, warnings, version, graph };
}

/** Idempotency check helper: two fabrics are identical iff their version matches. */
export function fabricVersion(f: Fabric): string { return f.version; }
