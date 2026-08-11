/**
 * Migration: today's blob shape → the claims ledger (docs/aura/ledger-spec.md §2.2).
 * Deterministic, pure. Input is the docs/laila snapshot (never the live blob).
 *
 * Rules:
 *  - every ontology/atlas field value → a claim, source `code-derived` (extracted) or
 *    `generated` (prose the model wrote), world `to-be` (the prototype is a to-be draft).
 *  - every absent-but-schema-relevant slot → an explicit `?unknown` (F-D/F-F/F-G).
 *  - the override log → closures attributed to the operator, `weak` (a touch, no verbatim).
 *  - a "removed" entity → an as-is `exists=true` (the source had it) vs a to-be `exists=false`
 *    (the removal), so the deviation register can catch "removed while still referenced".
 *  - a step entity-name that resolves to no element → a first-class `unresolved-ref` (no name join).
 */
import { createLedgerStore, type LedgerStore } from "./store";
import { contentId, aboutOf, jointOwner, type ClaimValue, type Owner, type Layer } from "./types";
import type { Source, World } from "./precedence";

const slug = (s: unknown): string => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const s = (v: string | number | boolean): ClaimValue => ({ kind: "scalar", value: v });
const OPEN = { kind: "unknown" } as const;
const ENUMISH = /(^|_)(stage|status|phase|state|type|category|tier|priority|severity|health|rag|disposition|outcome)($|_)/i;

/**
 * Primary business function for an area/actor string, or null when it maps to none.
 * The FIRST match wins (Laila areas carry multi-area strings; the first is the owner).
 * Single source of truth for both single-owner and seam (joint) decisions.
 */
const FUNCTIONS: Array<[RegExp, string]> = [
  [/practice|capability|competenc/, "Practices"],
  [/alliance|partner/, "Alliances"],
  [/finance|invoic|billing|revenue/, "Finance"],
  [/legal|contract/, "Legal"],
  [/deliver|engagement/, "Delivery"],
  // Marketing requires the FUNCTION, not the word. `/market/` is a substring match, so
  // "Go-To-Market", "Market Research" and "Aftermarket Ops" all became Marketing — and on
  // live Laila that put Head of GTM and Head of Marketing on the SAME 15 loci, each told
  // they owned questions the other was accountable for. Same failure the Sales Ops rule
  // below already guards against: a compound term is not the function it contains.
  [/\bmarketing\b|^market/, "Marketing"],
  // Sales Ops requires the SALES context: "Sales Ops", "Sales Operations". A bare
  // "…Operations" (e.g. "Surgical Operations") is NOT Sales Ops — it maps to no
  // known function and stays unowned, rather than being swallowed by a broad match.
  [/sales ?op/, "Sales Ops"],
  [/sales|opportunity|account/, "Sales"],
];
/** One segment of an area label → its function, by the ORDERED table above. Order is
 *  load-bearing within a segment: "Sales Ops" must reach `/sales ?op/` before the broader
 *  `/sales/`, which is why this cannot be a set-membership test. */
const functionOfSegment = (segment: string): string | null => {
  const s = segment.toLowerCase();
  for (const [re, fn] of FUNCTIONS) if (re.test(s)) return fn;
  return null;
};

/**
 * AREA LABEL → FUNCTION(S).
 *
 * The original spelling tested the WHOLE label against the ordered table and returned the
 * first hit. Fine for a single-function area; wrong for what this programme produces. An
 * entity whose area reads "Sales / Practices / Delivery / Marketing / Legal / Finance" went
 * entirely to Practices — not because the record says so, but because `/practice|…/` sits
 * first in the array. On the Laila snapshot that was 78 questions, all of Practices'
 * entity-derived load, sent to a function the label names fifth.
 *
 * Matching is now SEGMENT-WISE, and the table order still decides within a segment (so
 * "Sales Ops" reaches `/sales ?op/` before the broader `/sales/`). A label naming several
 * functions is no longer collapsed to one: `ownerFor` makes it a JOINT owner, which is what
 * the record actually says. That became possible when `Owner.parties` replaced `{a, b}` —
 * 73 of those 78 name three or more functions, so a pair could not hold them.
 *
 * `functionOf` therefore returns null for a multi-function label. That is not "no owner";
 * it means "not a SINGLE owner", and callers that need one (the roster→loci routing in
 * `ownerRoleLabelForArea`) correctly decline rather than pick.
 */
/** EVERY recognised function an area label names, de-duplicated, in table order. */
export const functionsOf = (area: string): string[] =>
  [...new Set(
    String(area || "").split("/").map((seg) => functionOfSegment(seg.trim())).filter(Boolean),
  )] as string[];

/** The SINGLE function that owns an area, or null when the label names none — or several.
 *  Several is not a failure to parse: it is the record describing shared ownership, which
 *  `ownerFor` now expresses as a joint owner rather than collapsing to one name. */
export const functionOf = (area: string): string | null => {
  const found = functionsOf(area);
  return found.length === 1 ? found[0] : null;
};
/** Preserve the ledger's existing role labels for the function tokens. */
const ROLE_LABEL: Record<string, string> = { Sales: "Sales Leaders" };

/**
 * The ledger OWNER LABEL for an area/role string — the exact label `ownerFor`
 * stamps on a role-owned locus (function mapping + ROLE_LABEL), or null when the
 * string maps to no known function. Exported so a surface can route a roster
 * person to the loci THEY OWN using the SAME mapping the ledger owns by — one
 * source of truth, no drifting copy of the FUNCTIONS table. Pure; no behaviour
 * change to migrate() itself.
 */
export const ownerRoleLabelForArea = (area: string): string | null => {
  const fn = functionOf(area);
  return fn ? (ROLE_LABEL[fn] ?? fn) : null;
};

/**
 * Owner for a slot, from its area. Emits `unowned` where the area maps to no known
 * function (the fix: no more `return Sales Ops` fabrication), else a role token —
 * never a name join to a person.
 */
/**
 * The owner an area label states — one function, several, or none.
 *
 * SEVERAL IS A SEAM, not a failure. "Sales / Practices / Delivery" names three functions;
 * the honest owner is all three jointly, which is now expressible (`Owner.parties`). Before
 * that it had to be flattened to one — first-regex-wins, which handed Practices 78 questions
 * the record never gave it — or to `unowned`, which is honest but hands an operator routing
 * work the record had already answered.
 *
 * NONE is still unowned. A miss stays visible in burn-down and the inbox; it is never a
 * fabricated fallback role.
 */
export const ownerFor = (area: string): Owner => {
  const fns = functionsOf(area).map((fn) => ROLE_LABEL[fn] ?? fn);
  if (fns.length === 0) return { kind: "unowned" };
  if (fns.length === 1) return { kind: "role", role: fns[0] };
  return jointOwner(fns);
};

/**
 * A role owner STATED BY THE DATA — the atlas's own `workflow.owner` / `step.actor`
 * string, verbatim. Used only where the function table misses (non-CRM domains, where
 * functionOf knows no turf): an explicit, data-grounded rule hit, never an invented
 * constant. Null when the data states nothing — the caller stays unowned then.
 */
const statedOwner = (stated: unknown): Owner | null => {
  const s = String(stated ?? "").trim();
  return s ? { kind: "role", role: s } : null;
};

/**
 * A genuinely shared locus: joint(A ⋈ B) with endpoints sorted for determinism.
 * When only one side resolves, that side owns it. When NEITHER resolves, the locus
 * is UNOWNED — never a fabricated fallback owner. A miss stays visible in burn-down
 * and the operator inbox rather than being silently attributed to a default role.
 */
const jointOrOwner = (areaA: string, areaB: string): Owner => {
  const a = functionOf(areaA), b = functionOf(areaB);
  if (a && b && a !== b) return jointOwner([a, b]);
  return a ? ownerFor(areaA) : b ? ownerFor(areaB) : { kind: "unowned" };
};

export interface Snapshot { ontology: Record<string, unknown>; atlas: Record<string, unknown>; overrides: Array<Record<string, unknown>>; }

// ── ambiguities → ledger loci ─────────────────────────────────────────────────
/** The document still ASKS when it records no resolution, or one that says so. The
 *  SAME predicate the movement gate applied while ambiguities lived only in the blob —
 *  migrating them must not silently change WHICH collisions ask. */
const UNRESOLVED_RE = /unresolved/i;

/** The slot family carrying a term's competing readings, one claim per reading. The
 *  renderer reads them back to name the rivals in the meaning question; nothing here
 *  composes question text. */
export const READING_SLOT_PREFIX = "semantics.reading.";

/** One terminology collision, resolved onto the ledger locus that carries it. */
export interface AmbiguityLocus {
  /** the disputed word, as the ontology spelled it */
  term: string;
  /** the element whose `#semantics` slot this collision opens */
  elementId: string;
  /** the ontology entity the term names, or null when the ontology holds none */
  entityName: string | null;
  /** the competing readings, in document order — never invented, sometimes empty */
  meanings: string[];
  /** the resolution the generator PROPOSED (never a human closure), or "" */
  resolution: string;
  /** true while the document still asks (no resolution, or one that says "unresolved") */
  unresolved: boolean;
}

/**
 * THE definition of which ledger loci an ontology's `ambiguities[]` open — one
 * function, shared by the migration that writes them and by any surface that asks
 * whether one is still open, so the two cannot drift.
 *
 * A term is matched to the entity it names (exactly, then case-insensitively, then
 * through an alias). A term the ontology holds NO entity for still gets a locus, on
 * an `el:term:` element carrying the word verbatim — dropping it would delete the
 * only place a generator-detected collision is ever raised. That prefix marks its
 * provenance exactly as `el:removed:` marks an override-born element; no entity is
 * invented under `el:entity:`.
 *
 * Two rows naming one element are ONE question: their readings union, and it asks
 * while EITHER row asks.
 */
export function ambiguityLoci(ontology: Record<string, unknown> | null | undefined): AmbiguityLocus[] {
  const doc = (ontology ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(doc.ambiguities) ? doc.ambiguities : []) as unknown[];
  if (!rows.length) return [];
  const entities = (Array.isArray(doc.entities) ? doc.entities : []) as Array<Record<string, unknown>>;
  const byLower = new Map<string, string>();          // lowercased name/alias → entity name (names win)
  for (const e of entities) { const n = String(e.name ?? "").trim(); if (n) byLower.set(n.toLowerCase(), n); }
  for (const e of entities) {
    const n = String(e.name ?? "").trim(); if (!n) continue;
    for (const a of (Array.isArray(e.aliases) ? e.aliases : []) as unknown[]) {
      const al = String(a).trim().toLowerCase();
      if (al && !byLower.has(al)) byLower.set(al, n);
    }
  }
  const byElement = new Map<string, AmbiguityLocus>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const term = String(r.term ?? "").trim();
    if (!term) continue;
    const entityName = byLower.get(term.toLowerCase()) ?? null;
    const elementId = entityName ? `el:entity:${slug(entityName)}` : `el:term:${slug(term)}`;
    const meanings = ((Array.isArray(r.conflictingMeanings) ? r.conflictingMeanings : []) as unknown[])
      .map((m) => String(m).trim()).filter(Boolean);
    const resolution = String(r.resolution ?? "").trim();
    const unresolved = !resolution || UNRESOLVED_RE.test(resolution);
    const prior = byElement.get(elementId);
    if (!prior) { byElement.set(elementId, { term, elementId, entityName, meanings, resolution, unresolved }); continue; }
    for (const m of meanings) if (!prior.meanings.includes(m)) prior.meanings.push(m);
    if (!prior.resolution) prior.resolution = resolution;
    prior.unresolved = prior.unresolved || unresolved;
  }
  return [...byElement.values()];
}

/**
 * @deprecated Option A replaces this. Change now flows through the generator + override
 * adapter → reconcile (`supabase/functions/_shared/optionA.ts` → `PgLedger.reconcile`),
 * proven to reproduce this function's output (see docs/aura/option-a-report.md). migrate()
 * is retained only as a bootstrap/equivalence baseline — route nothing new through it.
 */
export function migrate(snap: Snapshot): LedgerStore {
  const store = createLedgerStore();
  const entities = (Array.isArray(snap.ontology.entities) ? snap.ontology.entities : []) as Array<Record<string, unknown>>;
  const relations = (Array.isArray(snap.ontology.relations) ? snap.ontology.relations : []) as Array<Record<string, unknown>>;
  const workflows = (Array.isArray(snap.atlas.workflows) ? snap.atlas.workflows : []) as Array<Record<string, unknown>>;

  const entIdByName = new Map<string, string>();
  const nameByLower = new Map<string, string>();
  const areaByName = new Map<string, string>();
  for (const e of entities) { const n = String(e.name ?? ""); if (n) { const id = `el:entity:${slug(n)}`; entIdByName.set(n, id); nameByLower.set(n.toLowerCase(), n); areaByName.set(n, String(e.area ?? "")); } }

  const A = (about: string, value: ClaimValue, source: Source, world: World, layer: Layer, owner: Owner, opts: { closed?: { by: string; method?: "assertion" | "disposition" | "document" | "import"; verbatim?: string }; status?: "open" | "weak" | "closed" | "blocked" | "n/a" } = {}) =>
    store.assert({ about, value, source, world, layer, ownerWhileOpen: owner, status: opts.status,
      closedBy: opts.closed ? { method: opts.closed.method ?? "import", by: opts.closed.by, verbatim: opts.closed.verbatim } : undefined });

  // ── entities + attributes + relations ──
  for (const e of entities) {
    const name = String(e.name ?? ""); if (!name) continue;
    const eid = entIdByName.get(name)!;
    const area = String(e.area ?? "");
    const owner = ownerFor(area);
    store.addElement({ id: eid, kind: "entity", name });
    A(aboutOf(eid, "exists"), s(true), "code-derived", "to-be", "domain", owner, { closed: { by: "prototype" }, status: "weak" });
    if (e.definition) A(aboutOf(eid, "definition"), s(String(e.definition)), "generated", "to-be", "domain", owner, { status: "weak" });
    if (e.systemOfRecord) A(aboutOf(eid, "systemOfRecord"), s(String(e.systemOfRecord)), "code-derived", "to-be", "configuration", owner, { status: "weak" });
    for (const alias of (Array.isArray(e.aliases) ? e.aliases : []) as unknown[]) {
      const an = String(alias);
      const collides = nameByLower.has(an.toLowerCase()) && an.toLowerCase() !== name.toLowerCase();
      A(aboutOf(eid, `alias.${slug(an)}`), collides ? { kind: "unresolved-ref", name: an, why: "alias collides with a distinct element name (A2)" } : s(an), "generated", "to-be", "domain", owner, { status: "weak" });
    }
    const attrs = (Array.isArray(e.attributes) ? e.attributes : []) as unknown[];
    for (const a of attrs) {
      const an = typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""); if (!an) continue;
      const aid = `el:attr:${slug(name)}.${slug(an)}`;
      store.addElement({ id: aid, kind: "attribute", name: an, of: eid });
      A(aboutOf(aid, "exists"), s(true), "code-derived", "to-be", "configuration", owner, { closed: { by: "prototype" }, status: "weak" });
      A(aboutOf(aid, "dataType"), OPEN, "generated", "to-be", "configuration", owner, { status: "open" }); // F-D — owned by the attribute's OWN entity area, not a constant
      if (ENUMISH.test(an)) A(aboutOf(aid, "valueSet"), OPEN, "generated", "to-be", "domain", owner, { status: "open" }); // F-F
    }
  }

  // ── ambiguities → a real #semantics locus on the term's ELEMENT ──
  // A terminology collision the ontology recorded is a MEANING question, so it becomes
  // the ordinary thing a meaning question is here: an open `#semantics` unknown — owned,
  // routable, closable — with the rival readings beside it as weak `semantics.reading.*`
  // claims the renderer reads back. A recorded resolution is the generator's PROPOSAL,
  // not a human closure: asserted as a weak scalar on the same locus, where precedence
  // supersedes the unknown (store.ts) and the slot settles weakly and stops asking —
  // exactly the population the document gate asked for, now with a closure path.
  for (const amb of ambiguityLoci(snap.ontology)) {
    const owner = ownerFor(areaByName.get(amb.entityName ?? "") ?? "");
    if (!amb.entityName) store.addElement({ id: amb.elementId, kind: "entity", name: amb.term });
    A(aboutOf(amb.elementId, "semantics"), OPEN, "generated", "to-be", "domain", owner, { status: "open" });
    for (const m of amb.meanings) A(aboutOf(amb.elementId, `${READING_SLOT_PREFIX}${slug(m)}`), s(m), "generated", "to-be", "domain", owner, { status: "weak" });
    if (!amb.unresolved) A(aboutOf(amb.elementId, "semantics"), s(amb.resolution), "generated", "to-be", "domain", owner, { status: "weak" });
  }

  for (const r of relations) {
    const from = String(r.from ?? ""), to = String(r.to ?? ""); if (!from || !to) continue;
    const rid = `el:rel:${slug(from)}-${slug(to)}`;
    store.addElement({ id: rid, kind: "relation", name: `${from}→${to}`, refs: { from: entIdByName.get(from) ?? "", to: entIdByName.get(to) ?? "" } });
    // a relation whose endpoints have different primary functions is a genuine seam → joint(A ⋈ B)
    const owner = jointOrOwner(areaByName.get(from) ?? "", areaByName.get(to) ?? "");
    if (r.cardinality) A(aboutOf(rid, "cardinality"), s(String(r.cardinality)), "code-derived", "to-be", "domain", owner, { status: "weak" });
    A(aboutOf(rid, "optionality"), OPEN, "generated", "to-be", "domain", owner, { status: "open" }); // F-D
    if (String(r.relation ?? "").toLowerCase() === "produces") A(aboutOf(rid, "semantics"), OPEN, "generated", "to-be", "domain", owner, { status: "open" });
  }

  // ── workflows + steps ──
  for (const w of workflows) {
    const wn = String(w.name ?? ""); if (!wn) continue;
    const wid = `el:wf:${slug(wn)}`;
    const area = String(w.area ?? "");
    // functionOf hit → the function owns it; miss → the atlas's OWN stated owner
    // (data-grounded), else unowned. Never a constant.
    const fnOwner = ownerFor(area);
    const owner = fnOwner.kind === "unowned" ? (statedOwner(w.owner) ?? fnOwner) : fnOwner;
    store.addElement({ id: wid, kind: "workflow", name: wn });
    A(aboutOf(wid, "name"), s(wn), "generated", "to-be", "domain", owner, { status: "weak" });
    if (w.area) A(aboutOf(wid, "area"), s(String(w.area)), "code-derived", "to-be", "configuration", owner, { status: "weak" });
    if (w.owner) A(aboutOf(wid, "owner"), s(String(w.owner)), "generated", "to-be", "configuration", owner, { status: "weak" });
    if (w.trigger) A(aboutOf(wid, "trigger"), s(String(w.trigger)), "generated", "to-be", "domain", owner, { status: "weak" });
    A(aboutOf(wid, "phase"), OPEN, "generated", "to-be", "domain", owner, { status: "open" }); // F-G
    const steps = (Array.isArray(w.steps) ? w.steps : []) as Array<Record<string, unknown>>;
    for (const st of steps) {
      const action = String(st.action ?? "");
      const sid = contentId("el:step", wid, String(st.actor ?? ""), action.slice(0, 60)); // A6 content id, not index
      store.addElement({ id: sid, kind: "step", name: action.slice(0, 60), of: wid });
      // a step whose actor-area differs from the workflow's owning area is a handoff seam → joint
      // Seam/function first (unchanged); on a double-miss the step's own stated actor
      // owns it, else the workflow's stated owner, else unowned. Data-grounded only.
      const seamOrFn = jointOrOwner(area, String(st.actor ?? ""));
      const stepOwner = seamOrFn.kind === "unowned"
        ? (statedOwner(st.actor) ?? statedOwner(w.owner) ?? seamOrFn) : seamOrFn;
      A(aboutOf(sid, "action"), s(action), "generated", "to-be", "domain", stepOwner, { status: "weak" });
      A(aboutOf(sid, "automationDisposition"), OPEN, "generated", "to-be", "configuration", stepOwner, { status: "open" }); // F-A — the step's OWN owner, not a constant
      A(aboutOf(sid, "actorRole"), OPEN, "generated", "to-be", "configuration", stepOwner, { status: "open" }); // 56-role — the step's OWN owner, not a constant
      const isDecision = /approv|review|decide|gate|threshold/i.test(action);
      if (isDecision) A(aboutOf(sid, "decision"), OPEN, "generated", "to-be", "domain", owner, { status: "open" }); // F-B
      for (const ent of (Array.isArray(st.entities) ? st.entities : []) as unknown[]) {
        const en = String(ent);
        const target = entIdByName.get(en);
        A(aboutOf(sid, `touches.${slug(en)}`),
          target ? { kind: "ref", to: target } : { kind: "unresolved-ref", name: en, why: "step references an entity the ontology does not hold (F-C coherence gap)" },
          "code-derived", "to-be", "domain", stepOwner, target ? { closed: { by: "prototype" }, status: "weak" } : { status: "blocked" });
      }
    }
  }

  // ── override log → attributed weak closures + removed-entity world split ──
  for (const o of snap.overrides) {
    const note = String(o.note ?? "");
    const by = String(o.by ?? "operator");
    const mRemoved = note.match(/Entity removed:\s*"?([^"]+)"?/i);
    const mEdited = note.match(/(Entity|Workflow) edited:\s*"?([^"]+)"?/i);
    if (mRemoved) {
      const name = mRemoved[1].trim();
      const rid = `el:removed:${slug(name)}`;
      store.addElement({ id: rid, kind: "entity", name });
      A(aboutOf(rid, "exists"), s(true), "code-derived", "as-is", "domain", ownerFor("sales"), { closed: { by: "prototype", method: "import" }, status: "weak" });
      A(aboutOf(rid, "exists"), s(false), "dispositioned", "to-be", "domain", ownerFor("sales"), { closed: { by, method: "disposition" }, status: "weak" }); // touched, no verbatim
    } else if (mEdited) {
      const name = mEdited[2].trim();
      const eid = entIdByName.get(name) ?? `el:wf:${slug(name)}`;
      A(aboutOf(eid, "operatorCorrected"), s(note), "dispositioned", "to-be", "domain", ownerFor("sales"), { closed: { by, method: "disposition" }, status: "weak" }); // closed-without-verbatim
    }
  }

  return store;
}

// ── measured stats (replaces the estimates) ───────────────────────────────────
export interface MigrationStats {
  elements: number;
  claims: number;
  live: number;
  bySource: Record<string, number>;
  byWorld: Record<string, number>;
  openUnknowns: number;
  weak: number;
  closedWithoutVerbatim: number; // the operator "touched, not confirmed" closures
  unresolvedRefs: number;
  blocked: number;
}

export function migrationStats(store: LedgerStore): MigrationStats {
  const claims = store.claims();
  const live = claims.filter((c) => !c.supersededBy);
  const bySource: Record<string, number> = {};
  const byWorld: Record<string, number> = {};
  for (const c of live) { bySource[c.source] = (bySource[c.source] ?? 0) + 1; byWorld[c.world] = (byWorld[c.world] ?? 0) + 1; }
  return {
    elements: store.elements().length,
    claims: claims.length,
    live: live.length,
    bySource, byWorld,
    openUnknowns: live.filter((c) => c.status === "open").length,
    weak: live.filter((c) => c.status === "weak").length,
    closedWithoutVerbatim: live.filter((c) => c.closedBy && !c.closedBy.verbatim && c.source === "dispositioned").length,
    unresolvedRefs: live.filter((c) => c.value.kind === "unresolved-ref").length,
    blocked: live.filter((c) => c.status === "blocked").length,
  };
}
