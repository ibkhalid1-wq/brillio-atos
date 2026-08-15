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
  /** The ONE home in the nesting tree; null for a tree root. */
  primaryParent: string | null;
  /**
   * The structural parent this entity was LIFTED OUT OF to stand as a tree root
   * — null when it was never promoted. The relation is untouched (it is still in
   * `parents`, and that parent still carries this entity as a child collection);
   * this records that the NESTING chose not to file it there, and why it could:
   * see the promotion rule below.
   */
  promotedFrom: string | null;
  /** Children in the nesting tree — those whose `primaryParent` is this node. */
  treeChildren: string[];
  /** Shortest distance from a RELATION root (`isRoot`) over parent edges; those
   *  are 0. A tree root promoted for primacy keeps its structural distance —
   *  this measures the relations, not the navigation. */
  depth: number;
  /** How many distinct OTHER entities reference this one (FK, attribute, or N:M). */
  fanIn: number;
  /** Who they are — so a consumer can show its work. */
  fanInFrom: string[];
  /** A root of the RELATION graph: nothing produces it (or a cycle was broken
   *  here). This is the seeding fact — a root has no parent rows to fan out
   *  from. It is NOT the same question as "does the tree start here": for that,
   *  read `primaryParent === null` / `treeRoots`. */
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
  /** Top-level entities of the RELATION graph: no parent, plus any promoted to
   *  break a relation cycle. The seeding fact — see `GraphNode.isRoot`. */
  roots: string[];
  /**
   * Where the NESTING TREE starts — `roots`, plus every entity promoted out of
   * its structural parent by the primacy rule below. This is what a navigation
   * walks; `roots` is what a generator seeds from. They were one list until an
   * ontology filed its most-referenced object under a footnote that happened to
   * own a foreign key.
   */
  treeRoots: string[];
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

/**
 * THE JOIN KEY — the ONE definition of the column a child row carries to name
 * the parent that owns it. The seeder WRITES this key; the assembler READS it
 * (off the fabric region that declares the relation); nothing else invents it.
 *
 * It used to be rebuilt independently on both sides as
 * `entity.toLowerCase() + "Id"`, which is not a key derivation but a convention
 * being guessed at. Two things follow from a guess. A multi-word entity got a
 * column with a SPACE in it — `alliance partnerId` — which is not an identifier
 * in any schema the prototype claims to be showing, and which any consumer
 * spelling the convention even slightly differently (camelCase, snake_case)
 * matches nothing at all: the parent renders zero children while the seed holds
 * hundreds. And it silently weakened the referential-integrity guard, whose
 * `endsWith("Id")` lookup could no longer find the entity a spaced key named.
 *
 * So the key is derived from the entity's NAME WORDS — the same decomposition
 * the reference detection uses — and is always a legal identifier:
 * `Alliance Partner` → `alliancePartnerId`, `Account` → `accountId` (unchanged,
 * which is why single-word ontologies see no movement at all).
 *
 * A many-to-many has NO join key in either direction — that is what makes it a
 * many-to-many. Its membership lives in its own table; see `junctionKeyFor`.
 */
export function joinKeyFor(parent: unknown): string {
  const w = nameWords(parent);
  if (!w.length) return "xId";
  return w[0] + w.slice(1).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join("") + "Id";
}

/**
 * Where a junction's MEMBERSHIP lives — the one address the seeder writes and
 * the assembler reads, so a many-to-many stops being an untyped hole between
 * them. Direction is the graph's normalised `from`/`to`, never positional.
 */
export function junctionKeyFor(from: unknown, to: unknown): string {
  return `_junction:${nameWords(from).join("-") || "x"}:${nameWords(to).join("-") || "x"}`;
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
  const structuralParent = new Map<string, string | null>();
  for (const n of names) {
    if (rootReason.has(n)) { structuralParent.set(n, null); continue; }
    const ps = [...(parents.get(n) ?? [])].sort((a, b) =>
      (depth.get(a) ?? 0) - (depth.get(b) ?? 0) || fanIn(b) - fanIn(a) || index.get(a)! - index.get(b)!);
    structuralParent.set(n, ps[0] ?? null);
  }
  /** The nesting tree implied by a home-per-entity map. */
  const treeUnder = (home: Map<string, string | null>) => {
    const kids = new Map<string, string[]>(names.map((n) => [n, []]));
    for (const n of names) { const p = home.get(n); if (p) kids.get(p)!.push(n); }
    return kids;
  };
  /** Subtree size, post-order (the tree is acyclic by construction). */
  const sizesOf = (kids: Map<string, string[]>) => {
    const size = new Map<string, number>();
    const sizeOf = (n: string): number => {
      const cached = size.get(n); if (cached != null) return cached;
      size.set(n, 1); // guard, overwritten below
      const total = 1 + (kids.get(n) ?? []).reduce((s, c) => s + sizeOf(c), 0);
      size.set(n, total);
      return total;
    };
    for (const n of names) sizeOf(n);
    return size;
  };
  const structuralSubtree = sizesOf(treeUnder(structuralParent));

  // ── the spine: the objects everything else hangs off ──
  // MEMBERSHIP is decided by fan-in — the ontology says which objects everything
  // else points at. It is computed HERE, before the tree, because the tree's
  // roots are chosen against it; the spine is ORDERED by the finished tree
  // further down, so it reads as the top of the navigation and not as a second,
  // differently-sorted list.
  const SPINE_MIN = 5, SPINE_MAX = 7, FLAT_AT = 8, HUB_MIN = 2;
  const byFanIn = [...names].sort((a, b) => fanIn(b) - fanIn(a) || (structuralSubtree.get(b) ?? 0) - (structuralSubtree.get(a) ?? 0) || index.get(a)! - index.get(b)!);
  // Below FLAT_AT entities a flat list IS the right IA — there is no long tail to
  // hide behind a spine, so the spine is the whole set.
  const hubs = names.filter((n) => fanIn(n) >= HUB_MIN).length;
  const spineMembers = new Set(names.length <= FLAT_AT
    ? names
    : byFanIn.slice(0, Math.min(names.length, Math.max(SPINE_MIN, Math.min(SPINE_MAX, hubs)))).filter((n) => fanIn(n) > 0));

  // ── BUSINESS PRIMACY PICKS THE TREE ROOT ──
  //
  // The home above is the SHALLOWEST parent, which is graph-true and can be
  // backwards to every user of the system it describes: on a reviewed CRM build
  // it filed the account — the object seven other entities point at — underneath
  // a partner record that exactly one entity points at, because that one
  // relation happened to start a level higher. Fan-in already knows which object
  // is central; only the root choice ignored it.
  //
  // THE RULE (generic, never a list of names). An entity stands as its own tree
  // root when BOTH hold:
  //   1. it is ON THE SPINE — one of the objects the ontology itself points at,
  //      so promotion can only ever raise something a user navigates by, never
  //      lift a leaf out of a chain to sit beside its own siblings;
  //   2. its fan-in MATERIALLY exceeds its structural parent's — at least
  //      PRIMACY_RATIO times as many distinct entities reference it as reference
  //      the thing claiming to contain it.
  //
  // Why a multiple and not a difference: the failure this rule must not have is
  // promoting everything, and every legitimate nesting in the fixtures is a near
  // miss on a difference. A CRM's opportunity out-references its account 14 to 7
  // and belongs under it; a facility's asset out-references its room 4 to 2 and
  // belongs in it. Both are 2×. The defect — an account referenced by seven
  // entities filed under a partner referenced by one — is 7×. A container the
  // rest of the ontology points at a third as often as at its contents is not
  // being used as a container; it is a footnote that happens to own a foreign
  // key. Below that margin the graph's answer stands.
  //
  // A structural parent always has fan-in ≥ 1 (its own child references it), so
  // there is no runaway ratio and no empty ontology special case.
  const PRIMACY_RATIO = 3;
  const primaryParent = new Map(structuralParent);
  const promotedFrom = new Map<string, string | null>(names.map((n) => [n, null]));
  for (const n of names) {
    const p = structuralParent.get(n);
    if (!p || !spineMembers.has(n)) continue;
    if (fanIn(n) < PRIMACY_RATIO * fanIn(p)) continue;
    primaryParent.set(n, null);
    promotedFrom.set(n, p);
  }

  const treeChildren = treeUnder(primaryParent);
  const subtree = sizesOf(treeChildren);

  // presentation order: biggest structures first, then the strongest reference hubs
  const rank = (a: string, b: string) =>
    (subtree.get(b) ?? 0) - (subtree.get(a) ?? 0) || fanIn(b) - fanIn(a) || index.get(a)! - index.get(b)!;
  for (const n of names) treeChildren.get(n)!.sort(rank);
  const roots = names.filter((n) => rootReason.has(n)).sort(rank);
  const treeRoots = names.filter((n) => primaryParent.get(n) == null).sort(rank);
  const navOrder: string[] = [];
  const walk = (n: string) => { navOrder.push(n); for (const c of treeChildren.get(n) ?? []) walk(c); };
  for (const r of treeRoots) walk(r);
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

  // The spine's ORDER is the structure's, the same rule as the rest of the
  // navigation (membership was decided by fan-in, above).
  const spine = [...spineMembers].sort((a, b) => navOrder.indexOf(a) - navOrder.indexOf(b));

  const nodes: GraphNode[] = names.map((n) => ({
    name: n,
    parents: parents.get(n) ?? [],
    children: children.get(n) ?? [],
    primaryParent: primaryParent.get(n) ?? null,
    promotedFrom: promotedFrom.get(n) ?? null,
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

  return { entities: names, nodes, byName, edges, junctions, roots, treeRoots, order, navOrder, spine, references, cycleBroken };
}

/**
 * A NAME WRITTEN SOMEWHERE ELSE, RESOLVED AGAINST THIS ONTOLOGY'S OWN NAMES.
 *
 * The atlas names entities inside workflow steps and the blueprint names them in
 * each agent's inputs and outputs. Both are told to spell them exactly as the
 * ontology does; neither always does ("Invoices" for `Invoice`, "lead score" for
 * `Lead Score`). Every consumer of those documents therefore needs the same
 * question answered — which entity is this, if any — and it must be answered the
 * SAME way in each of them, or one surface shows a queue the other says does not
 * exist.
 *
 * It resolves on case, spacing and punctuation first, then on a trailing plural,
 * and then it STOPS. There is no nearest-match: a name that resolves to nothing
 * returns null, and its caller's job is to say so on the screen rather than bind
 * it to whichever entity happened to look similar.
 */
export function entityNameResolver(names: readonly string[]): (raw: unknown) => string | null {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const singular = (s: string) => (s.length > 3 && s.endsWith("s") ? s.slice(0, -1) : s);
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  for (const n of names) {
    const k = key(String(n ?? ""));
    if (!k) continue;
    if (!exact.has(k)) exact.set(k, n);
    const s = singular(k);
    if (!loose.has(s)) loose.set(s, n);
  }
  return (raw: unknown) => {
    const k = key(String(raw ?? "").trim());
    if (!k) return null;
    return exact.get(k) ?? loose.get(singular(k)) ?? null;
  };
}
