/**
 * Ontology graph — the parent→child structure the ontology's `relations` already
 * describe, derived ONCE and exposed as a first-class result.
 *
 * WHY IT LIVES IN ITS OWN MODULE. The graph is a fact about the ONTOLOGY (entity
 * names, relation direction, cardinality, and attributes that name an entity) —
 * not about seeding, not about screens, not about appearance. Three modules need
 * it and needed it before this file existed:
 *   - `seedData` walked the relations to get a topological insert order so a
 *     child's FK could point at a parent that already had rows — then threw the
 *     graph away and returned only records/assumptions/counts;
 *   - `fabric` walked the SAME relations again to decide which entity's detail
 *     owns a child collection and which carries a parent nav;
 *   - `prototypeAssembly` had no structure at all, so it ordered the navigation
 *     by seed volume — which is how a junction table with 120 generated rows
 *     came to lead the information architecture.
 * Putting the derivation inside any one of those makes the other two depend on
 * that module for a reason unrelated to its job. So it sits here, imports
 * nothing, and every consumer reads the same result. There is no second copy.
 *
 * Pure and deterministic: no Date, no Math.random, arrays ordered by explicit
 * comparators (never by Map/Set iteration accident) so the same ontology always
 * yields the same graph and therefore the same bytes downstream.
 */

/**
 * One FK-bearing relation, normalised so `parent` owns and `child` points.
 * `cardinality` is what the ontology declared (an N:1 keeps saying N:1, which
 * the seed assumptions quote back); `parentToChild` is the same fact read in
 * the normalised direction, which is what a renderer needs.
 */
export interface GraphEdge { parent: string; child: string; cardinality: string; parentToChild: string; relation: string }
/** A many-to-many, which owns no FK in either direction. */
export interface GraphJunction { from: string; to: string; cardinality: string }
/**
 * An attribute whose NAME is an entity in this ontology — i.e. a reference the
 * ontology itself tells us about, without any hardcoded word list.
 * `exact`: the whole attribute name is the entity ("opportunity", "account_id").
 * `qualified`: a qualifier precedes it ("convertedOpportunity") AND the ontology
 * corroborates the pair with a relation — without that corroboration
 * "delivery_lead" would be read as a reference to the Lead entity.
 */
export interface AttributeReference { entity: string; attribute: string; target: string; match: "exact" | "qualified" }

export interface GraphNode {
  name: string;
  /** Entities that own this one (deduped, ontology order). */
  parents: string[];
  /** Entities this one owns (deduped, ontology order). */
  children: string[];
  /** The ONE home in the nesting tree; null for a root. */
  primaryParent: string | null;
  /** Children in the nesting tree — those whose `primaryParent` is this node. */
  treeChildren: string[];
  /** Shortest distance from a root over parent edges. Roots are 0. */
  depth: number;
  /** How many distinct OTHER entities reference this one (FK, attribute, or N:M). */
  fanIn: number;
  /** Who they are — so a consumer can show its work. */
  fanInFrom: string[];
  isRoot: boolean;
  rootReason: "no-parent" | "cycle-break" | null;
  /** Entities reachable through the nesting tree, including this one. */
  subtreeSize: number;
}

export interface OntologyGraph {
  entities: string[];
  nodes: GraphNode[];
  byName: Record<string, GraphNode>;
  edges: GraphEdge[];
  junctions: GraphJunction[];
  /** Top-level entities: no parent, plus any promoted to break a relation cycle. */
  roots: string[];
  /** Topological order over ALL parent edges — the safe insert order for seeding. */
  order: string[];
  /** Depth-first pre-order over the nesting tree — the presentation order. */
  navOrder: string[];
  /** The 5–7 most-referenced entities: the objects a user actually navigates by. */
  spine: string[];
  references: AttributeReference[];
  /** Entities promoted to root because a cycle left them unreachable. */
  cycleBroken: string[];
}

const nameOf = (e: unknown): string => String((e as { name?: unknown })?.name ?? "");
const attrNameOf = (a: unknown): string => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""));

/** camelCase / snake_case / spaced → lowercase word list. */
export function nameWords(s: unknown): string[] {
  return String(s ?? "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim().toLowerCase().split(/\s+/).filter(Boolean);
}

const entitiesOf = (ontology: Record<string, unknown>) =>
  (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
const relationsOf = (ontology: Record<string, unknown>) =>
  (Array.isArray(ontology.relations) ? ontology.relations : []) as Array<Record<string, unknown>>;

/**
 * Attributes that name an entity of this ontology — the ontology answering a
 * question a hardcoded word list (`account|parent|lead`) could only guess at.
 */
export function deriveAttributeReferences(ontology: Record<string, unknown>): AttributeReference[] {
  const entities = entitiesOf(ontology);
  const names = entities.map(nameOf).filter(Boolean);
  const entityWords = names.map((n) => [n, nameWords(n)] as const).filter(([, w]) => w.length > 0);
  const related = new Set<string>();
  for (const r of relationsOf(ontology)) {
    const from = String(r.from ?? ""), to = String(r.to ?? "");
    if (!names.includes(from) || !names.includes(to)) continue;
    related.add(`${from}||${to}`);
    related.add(`${to}||${from}`);
  }
  const out: AttributeReference[] = [];
  for (const e of entities) {
    const from = nameOf(e);
    if (!from) continue;
    const attrs = Array.isArray(e.attributes) ? e.attributes : [];
    for (const a of attrs) {
      const attribute = attrNameOf(a);
      if (!attribute) continue;
      let w = nameWords(attribute);
      if (w.length > 1 && (w[w.length - 1] === "id" || w[w.length - 1] === "ids")) w = w.slice(0, -1);
      if (!w.length) continue;
      let best: AttributeReference | null = null;
      let bestLen = 0;
      for (const [target, ew] of entityWords) {
        if (target === from) continue;                      // never a self-reference
        if (ew.length > w.length) continue;
        const tail = w.slice(w.length - ew.length);
        if (!ew.every((x, i) => x === tail[i])) continue;
        const exact = ew.length === w.length;
        if (!exact && !related.has(`${from}||${target}`)) continue;
        if (ew.length > bestLen) { bestLen = ew.length; best = { entity: from, attribute, target, match: exact ? "exact" : "qualified" }; }
      }
      if (best) out.push(best);
    }
  }
  return out;
}

export function deriveOntologyGraph(ontology: Record<string, unknown>): OntologyGraph {
  const entities = entitiesOf(ontology);
  const names = entities.map(nameOf).filter(Boolean);
  const index = new Map(names.map((n, i) => [n, i] as const));

  // ── edges: cardinality decides which side owns the FK ──
  const edges: GraphEdge[] = [];
  const junctions: GraphJunction[] = [];
  for (const r of relationsOf(ontology)) {
    const from = String(r.from ?? ""), to = String(r.to ?? "");
    const cardinality = String(r.cardinality ?? "").toUpperCase().replace(/\s/g, "");
    const relation = String(r.relation ?? "");
    if (!index.has(from) || !index.has(to)) continue;
    if (cardinality === "N:M" || cardinality === "M:N" || cardinality === "*:*") { junctions.push({ from, to, cardinality }); continue; }
    const flipped = cardinality === "N:1";
    const parent = flipped ? to : from;
    const child = flipped ? from : to;
    edges.push({ parent, child, cardinality, parentToChild: flipped ? "1:N" : cardinality, relation });
  }

  // ── parents / children, deduped, self-edges excluded (nothing is its own home) ──
  const parents = new Map<string, string[]>(names.map((n) => [n, []]));
  const children = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const e of edges) {
    if (e.parent === e.child) continue;
    const p = parents.get(e.child)!; if (!p.includes(e.parent)) p.push(e.parent);
    const c = children.get(e.parent)!; if (!c.includes(e.child)) c.push(e.child);
  }

  // ── fan-in: distinct entities that reference this one ──
  const references = deriveAttributeReferences(ontology);
  const fanInFrom = new Map<string, string[]>(names.map((n) => [n, []]));
  const addRef = (target: string, from: string) => {
    if (target === from) return;
    const list = fanInFrom.get(target); if (list && !list.includes(from)) list.push(from);
  };
  for (const e of edges) addRef(e.parent, e.child);          // the child holds the FK
  for (const r of references) addRef(r.target, r.entity);    // the attribute names it
  for (const j of junctions) { addRef(j.from, j.to); addRef(j.to, j.from); }
  const fanIn = (n: string) => (fanInFrom.get(n) ?? []).length;

  // ── depth by BFS from the roots; a cycle is broken by promoting its hub ──
  const depth = new Map<string, number>();
  const rootReason = new Map<string, "no-parent" | "cycle-break">();
  const cycleBroken: string[] = [];
  const bfs = (seeds: string[]) => {
    const q = [...seeds];
    for (const s of seeds) depth.set(s, 0);
    while (q.length) {
      const n = q.shift()!;
      for (const c of children.get(n) ?? []) {
        if (depth.has(c)) continue;
        depth.set(c, depth.get(n)! + 1);
        q.push(c);
      }
    }
  };
  const noParent = names.filter((n) => (parents.get(n) ?? []).length === 0);
  for (const n of noParent) rootReason.set(n, "no-parent");
  bfs(noParent);
  // Whatever BFS could not reach sits in a relation cycle. Promote the cycle's
  // hub (most referenced, then ontology order) to a root and continue — every
  // entity ends with exactly one finite depth and therefore exactly one home.
  for (;;) {
    const stranded = names.filter((n) => !depth.has(n));
    if (!stranded.length) break;
    const hub = [...stranded].sort((a, b) => fanIn(b) - fanIn(a) || index.get(a)! - index.get(b)!)[0];
    rootReason.set(hub, "cycle-break");
    cycleBroken.push(hub);
    bfs([hub]);
  }

  // ── exactly one home per entity: the shallowest parent, then the strongest ──
  const primaryParent = new Map<string, string | null>();
  for (const n of names) {
    if (rootReason.has(n)) { primaryParent.set(n, null); continue; }
    const ps = [...(parents.get(n) ?? [])].sort((a, b) =>
      (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || fanIn(b) - fanIn(a) || index.get(a)! - index.get(b)!);
    primaryParent.set(n, ps[0] ?? null);
  }
  const treeChildren = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const n of names) { const p = primaryParent.get(n); if (p) treeChildren.get(p)!.push(n); }

  // subtree size (post-order over the tree — it is acyclic by construction)
  const subtree = new Map<string, number>();
  const sizeOf = (n: string): number => {
    const cached = subtree.get(n); if (cached != null) return cached;
    subtree.set(n, 1); // guard, overwritten below
    const total = 1 + (treeChildren.get(n) ?? []).reduce((s, c) => s + sizeOf(c), 0);
    subtree.set(n, total);
    return total;
  };
  for (const n of names) sizeOf(n);

  // presentation order: biggest structures first, then the strongest reference hubs
  const rank = (a: string, b: string) =>
    (subtree.get(b) ?? 0) - (subtree.get(a) ?? 0) || fanIn(b) - fanIn(a) || index.get(a)! - index.get(b)!;
  for (const n of names) treeChildren.get(n)!.sort(rank);
  const roots = names.filter((n) => rootReason.has(n)).sort(rank);
  const navOrder: string[] = [];
  const walk = (n: string) => { navOrder.push(n); for (const c of treeChildren.get(n) ?? []) walk(c); };
  for (const r of roots) walk(r);
  for (const n of names) if (!navOrder.includes(n)) navOrder.push(n); // belt and braces

  // ── topological order over ALL parent edges (the safe seeding order) ──
  const indeg = new Map<string, number>(names.map((n) => [n, (parents.get(n) ?? []).length]));
  const order: string[] = [];
  const q = names.filter((n) => (indeg.get(n) ?? 0) === 0);
  while (q.length) {
    const n = q.shift()!;
    order.push(n);
    for (const c of children.get(n) ?? []) {
      const d = (indeg.get(c) ?? 1) - 1;
      indeg.set(c, d);
      if (d === 0) q.push(c);
    }
  }
  for (const n of names) if (!order.includes(n)) order.push(n); // cycle remnants

  // ── the spine: the objects everything else hangs off ──
  const byFanIn = [...names].sort((a, b) => fanIn(b) - fanIn(a) || (subtree.get(b) ?? 0) - (subtree.get(a) ?? 0) || index.get(a)! - index.get(b)!);
  const SPINE_MIN = 5, SPINE_MAX = 7, FLAT_AT = 8;
  // Below FLAT_AT entities a flat list IS the right IA — there is no long tail to
  // hide behind a spine, so the spine is the whole (structurally ordered) set.
  const hubs = names.filter((n) => fanIn(n) >= 2).length;
  // MEMBERSHIP is decided by fan-in — the ontology says which objects everything
  // else points at. ORDER is decided by the structure, the same rule as the rest
  // of the navigation, so the spine reads as the top of the tree and not as a
  // second, differently-sorted list.
  const spine = (names.length <= FLAT_AT
    ? [...navOrder]
    : byFanIn.slice(0, Math.min(names.length, Math.max(SPINE_MIN, Math.min(SPINE_MAX, hubs))))
      .filter((n) => fanIn(n) > 0)
  ).sort((a, b) => navOrder.indexOf(a) - navOrder.indexOf(b));

  const nodes: GraphNode[] = names.map((n) => ({
    name: n,
    parents: parents.get(n) ?? [],
    children: children.get(n) ?? [],
    primaryParent: primaryParent.get(n) ?? null,
    treeChildren: treeChildren.get(n) ?? [],
    depth: depth.get(n) ?? 0,
    fanIn: fanIn(n),
    fanInFrom: fanInFrom.get(n) ?? [],
    isRoot: rootReason.has(n),
    rootReason: rootReason.get(n) ?? null,
    subtreeSize: subtree.get(n) ?? 1,
  }));
  const byName: Record<string, GraphNode> = {};
  for (const n of nodes) byName[n.name] = n;

  return { entities: names, nodes, byName, edges, junctions, roots, order, navOrder, spine, references, cycleBroken };
}
