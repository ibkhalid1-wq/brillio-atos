/**
 * Seed data generation (docs/aura/seed-data.md) — ontology in, referentially
 * consistent synthetic records out, deterministic. Buildable-now: no model call,
 * no ids that don't exist.
 *
 * - Referentially consistent: topological insert order over the relation graph;
 *   every child FK points at a real parent; cardinality respected.
 * - Seeded + reproducible: a mulberry32 PRNG keyed by a hash of the ontology
 *   version + entity name (no Date.now/Math.random — both banned here anyway).
 * - Synthetic + marked: every record carries `_synthetic` + a classification; a
 *   neutral synthetic pool supplies names — NO real client/employee/deal values.
 * - Instrument: volume paginates lists, empty states are reachable, and planted
 *   edge cases (long name, missing optional, boundary value) make design errors
 *   visible on a populated screen.
 *
 * Every cardinality/optionality the generator must ASSUME is emitted in the
 * assumptions list — direct input to the Listen sessions.
 */
import { deriveRoles, type ValueRole } from "./semanticRoles.ts";

export interface SeedRecord { id: string; _synthetic: true; _classification: "SYNTHETIC-SEED"; [k: string]: unknown; }
export interface SeedAssumption {
  kind: "optionality" | "fan-out" | "relation-verb" | "orphan-entity";
  subject: string;
  assumed: string;
  listenQuestion: string;
}
export interface SeedResult {
  records: Record<string, SeedRecord[]>;
  assumptions: SeedAssumption[];
  counts: Record<string, number>;
}

// ── deterministic PRNG ──
function hashSeed(s: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const COMPANIES = ["Northwind", "Contoso", "Fabrikam", "Aperture", "Initech", "Umbra", "Halcyon", "Vertex", "Meridian Labs", "Blue Yonder", "Cobalt", "Sterling", "Ironwood", "Pinnacle", "Kestrel", "Lumen", "Orenda", "Quill", "Radian", "Solstice", "Tacit", "Vantage", "Wexford", "Zephyr"];
const WORDS = ["review", "renewal", "expansion", "migration", "pilot", "rollout", "audit", "handoff", "escalation", "onboarding", "assessment", "sync"];
const STATUSES = ["Open", "In progress", "Blocked", "Closed", "On hold"];

const singular = (name: string) => name.replace(/s$/i, "");

/** A synthetic value for one attribute, driven by its semantic role, deterministic. */
function valueFor(role: ValueRole | undefined, entity: string, attr: string, i: number, rnd: () => number): unknown {
  switch (role) {
    case "monetary": return Math.round((rnd() * 480000 + 2000) / 500) * 500;
    case "quantity": return Math.floor(rnd() * 200);
    case "date": { const m = 1 + Math.floor(rnd() * 12); const d = 1 + Math.floor(rnd() * 27); return `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
    case "boolean": return rnd() > 0.5;
    case "status": return STATUSES[Math.floor(rnd() * STATUSES.length)];
    case "code": return `${entity.slice(0, 3).toUpperCase()}-${String(1000 + Math.floor(rnd() * 8999))}`;
    case "title": case "identifier": return `${COMPANIES[i % COMPANIES.length]} ${singular(entity)} ${i + 1}`;
    default: return `${COMPANIES[i % COMPANIES.length]} ${WORDS[Math.floor(rnd() * WORDS.length)]}`;
  }
}

export interface SeedOptions { rootRows?: number; maxFanOut?: number; maxPerEntity?: number; }

export function generateSeed(ontology: Record<string, unknown>, version: string, opts: SeedOptions = {}): SeedResult {
  const rootRows = opts.rootRows ?? 24;       // > page size (20) → a second page
  const maxFanOut = opts.maxFanOut ?? 5;
  const maxPerEntity = opts.maxPerEntity ?? 120;
  const roles = deriveRoles(ontology);
  const entities = (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
  const relations = (Array.isArray(ontology.relations) ? ontology.relations : []) as Array<Record<string, unknown>>;
  const names = entities.map((e) => String(e.name ?? "")).filter(Boolean);
  const attrsOf = (name: string) => {
    const e = entities.find((x) => String(x.name) === name);
    return (Array.isArray(e?.attributes) ? e!.attributes : []).map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
  };
  const roleOf = new Map(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));

  // parent → child edges from cardinality (FK ownership)
  interface Edge { parent: string; child: string; card: string; }
  const edges: Edge[] = [];
  const assumptions: SeedAssumption[] = [];
  for (const r of relations) {
    const from = String(r.from ?? ""), to = String(r.to ?? ""), card = String(r.cardinality ?? "").toUpperCase().replace(/\s/g, "");
    const verb = String(r.relation ?? "");
    if (!names.includes(from) || !names.includes(to)) continue;
    let parent = from, child = to;
    if (card === "N:1") { parent = to; child = from; }
    if (card === "N:M" || card === "M:N") { assumptions.push({ kind: "fan-out", subject: `${from}↔${to}`, assumed: "skipped (no junction generated)", listenQuestion: `Is ${from}↔${to} a true many-to-many needing a join table?` }); continue; }
    edges.push({ parent, child, card });
    // optionality is absent on every relation — assume child-optional/parent-optional
    assumptions.push({ kind: "optionality", subject: `${parent} → ${child} [${card}]`, assumed: "child-optional, parent-optional (default)", listenQuestion: `Must every ${child} have a ${parent}? Can a ${parent} have zero ${child}?` });
    if (card.endsWith(":N") || card === "1:N") assumptions.push({ kind: "fan-out", subject: `${parent} → ${child}`, assumed: `0–${maxFanOut} per ${parent}`, listenQuestion: `Realistic count of ${child} per ${parent}?` });
    if (verb && verb.toLowerCase() === "produces") assumptions.push({ kind: "relation-verb", subject: `${parent} → ${child}`, assumed: 'generic verb "produces" treated as parent→child FK', listenQuestion: `Is ${parent}→${child} a composition, a reference, or a lifecycle transition?` });
  }
  // topological order (Kahn); break cycles by dropping a back-edge
  const childrenOf = new Map<string, Edge[]>();
  const indeg = new Map<string, number>(names.map((n) => [n, 0]));
  for (const e of edges) { (childrenOf.get(e.parent) ?? childrenOf.set(e.parent, []).get(e.parent)!).push(e); indeg.set(e.child, (indeg.get(e.child) ?? 0) + 1); }
  const order: string[] = []; const q = names.filter((n) => (indeg.get(n) ?? 0) === 0);
  const seenDeg = new Map(indeg);
  while (q.length) { const n = q.shift()!; order.push(n); for (const e of childrenOf.get(n) ?? []) { const d = (seenDeg.get(e.child) ?? 1) - 1; seenDeg.set(e.child, d); if (d === 0) q.push(e.child); } }
  for (const n of names) if (!order.includes(n)) order.push(n); // cycle remnants
  const isRoot = new Set(names.filter((n) => (indeg.get(n) ?? 0) === 0));
  for (const n of names) if (isRoot.has(n) && !edges.some((e) => e.parent === n)) assumptions.push({ kind: "orphan-entity", subject: n, assumed: "seeded standalone (no relation in the ontology)", listenQuestion: `What does ${n} connect to?` });

  // generate
  const records: Record<string, SeedRecord[]> = {};
  const parentEdgesOf = new Map<string, Edge[]>(); // child -> its parent edges
  for (const e of edges) (parentEdgesOf.get(e.child) ?? parentEdgesOf.set(e.child, []).get(e.child)!).push(e);
  let planted = false;
  for (const name of order) {
    const rnd = mulberry32(hashSeed(`${version}::${name}`));
    const attrs = attrsOf(name);
    const parents = parentEdgesOf.get(name) ?? [];
    const rows: SeedRecord[] = [];
    const mk = (i: number, parentIds: Record<string, string>): SeedRecord => {
      const rec: SeedRecord = { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(i + 1).padStart(4, "0")}`, _synthetic: true, _classification: "SYNTHETIC-SEED" };
      attrs.forEach((a) => { rec[a] = valueFor(roleOf.get(`${name} ${a}`), name, a, i, rnd); });
      // FK columns
      for (const [pName, pid] of Object.entries(parentIds)) rec[`${pName.toLowerCase()}Id`] = pid;
      // planted edge cases (once, on the first non-root entity with attributes)
      if (!planted && !isRoot.has(name) && attrs.length) {
        if (i === 0) { const t = attrs.find((a) => (roleOf.get(`${name} ${a}`) === "title" || roleOf.get(`${name} ${a}`) === "identifier")) ?? attrs[0]; rec[t] = `${rec[t]} — an unusually long synthetic label used to stress the layout of ${name} rows and columns`; }
        if (i === 1) { const opt = attrs[attrs.length - 1]; rec[opt] = null; } // missing optional
        if (i === 2) { const money = attrs.find((a) => roleOf.get(`${name} ${a}`) === "monetary"); if (money) rec[money] = 0; } // boundary
        if (i === 2) planted = true;
      }
      return rec;
    };
    if (isRoot.has(name)) { for (let i = 0; i < rootRows; i += 1) rows.push(mk(i, {})); }
    else {
      // for each parent edge, fan out from existing parent rows
      const primary = parents[0];
      const pRows = primary ? (records[primary.parent] ?? []) : [];
      let idx = 0;
      pRows.forEach((p, pi) => {
        // deliberately include the extremes: first parent gets 0, second gets max
        const k = pi === 0 ? 0 : pi === 1 ? maxFanOut : (primary?.card === "1:1" ? 1 : Math.floor(rnd() * (maxFanOut + 1)));
        for (let j = 0; j < k && rows.length < maxPerEntity; j += 1) {
          const parentIds: Record<string, string> = { [primary!.parent]: String(p.id) };
          for (const pe of parents.slice(1)) { const alt = records[pe.parent] ?? []; if (alt.length) parentIds[pe.parent] = String(alt[(idx + j) % alt.length].id); }
          rows.push(mk(idx++, parentIds));
        }
      });
      if (!rows.length && attrs.length) rows.push(mk(0, {})); // ensure a non-empty table where sensible
    }
    records[name] = rows;
  }
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(records)) counts[k] = v.length;
  return { records, assumptions, counts };
}
