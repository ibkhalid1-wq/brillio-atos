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
import { contentId, aboutOf, type ClaimValue, type Owner, type Layer } from "./types";
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
  [/market/, "Marketing"],
  [/sales ops|ops|operation/, "Sales Ops"],
  [/sales|opportunity|account/, "Sales"],
];
const functionOf = (area: string): string | null => {
  const a = (area || "").toLowerCase();
  for (const [re, fn] of FUNCTIONS) if (re.test(a)) return fn;
  return null;
};
/** Preserve the ledger's existing role labels for the function tokens. */
const ROLE_LABEL: Record<string, string> = { Sales: "Sales Leaders" };

/**
 * Owner for a slot, from its area. Emits `unowned` where the area maps to no known
 * function (the fix: no more `return Sales Ops` fabrication), else a role token —
 * never a name join to a person.
 */
const ownerFor = (area: string): Owner => {
  const fn = functionOf(area);
  return fn ? { kind: "role", role: ROLE_LABEL[fn] ?? fn } : { kind: "unowned" };
};

/** A genuinely shared locus: joint(A ⋈ B) with endpoints sorted for determinism, else a fallback. */
const jointOrOwner = (areaA: string, areaB: string, fallback: string): Owner => {
  const a = functionOf(areaA), b = functionOf(areaB);
  if (a && b && a !== b) { const [x, y] = [a, b].sort(); return { kind: "joint", a: x, b: y }; }
  return ownerFor(a ? areaA : b ? areaB : fallback);
};

export interface Snapshot { ontology: Record<string, unknown>; atlas: Record<string, unknown>; overrides: Array<Record<string, unknown>>; }

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
      A(aboutOf(aid, "dataType"), OPEN, "generated", "to-be", "configuration", ownerFor("sales ops"), { status: "open" }); // F-D
      if (ENUMISH.test(an)) A(aboutOf(aid, "valueSet"), OPEN, "generated", "to-be", "domain", owner, { status: "open" }); // F-F
    }
  }

  for (const r of relations) {
    const from = String(r.from ?? ""), to = String(r.to ?? ""); if (!from || !to) continue;
    const rid = `el:rel:${slug(from)}-${slug(to)}`;
    store.addElement({ id: rid, kind: "relation", name: `${from}→${to}`, refs: { from: entIdByName.get(from) ?? "", to: entIdByName.get(to) ?? "" } });
    // a relation whose endpoints have different primary functions is a genuine seam → joint(A ⋈ B)
    const owner = jointOrOwner(areaByName.get(from) ?? "", areaByName.get(to) ?? "", "sales ops");
    if (r.cardinality) A(aboutOf(rid, "cardinality"), s(String(r.cardinality)), "code-derived", "to-be", "domain", owner, { status: "weak" });
    A(aboutOf(rid, "optionality"), OPEN, "generated", "to-be", "domain", owner, { status: "open" }); // F-D
    if (String(r.relation ?? "").toLowerCase() === "produces") A(aboutOf(rid, "semantics"), OPEN, "generated", "to-be", "domain", owner, { status: "open" });
  }

  // ── workflows + steps ──
  for (const w of workflows) {
    const wn = String(w.name ?? ""); if (!wn) continue;
    const wid = `el:wf:${slug(wn)}`;
    const area = String(w.area ?? "");
    const owner = ownerFor(area);
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
      const stepOwner = jointOrOwner(area, String(st.actor ?? ""), area || "sales ops");
      A(aboutOf(sid, "action"), s(action), "generated", "to-be", "domain", stepOwner, { status: "weak" });
      A(aboutOf(sid, "automationDisposition"), OPEN, "generated", "to-be", "configuration", ownerFor("sales ops"), { status: "open" }); // F-A
      A(aboutOf(sid, "actorRole"), OPEN, "generated", "to-be", "configuration", ownerFor("sales ops"), { status: "open" }); // 56-role
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
