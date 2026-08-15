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
import { deriveRoles, readsLikeATitle, type ValueRole } from "./semanticRoles.ts";
import { deriveOntologyGraph, joinKeyFor, junctionKeyFor, nameWords, type OntologyGraph } from "./ontologyGraph.ts";
import { resolveVocabulary, vocabularyKey } from "./valueVocabulary.ts";

/** `_display` is what a person would call this record. It is present only when
 *  the ontology gives the entity no name-like attribute to call it by — see the
 *  `display-name` assumption, which sends that gap to Listen. */
export interface SeedRecord { id: string; _synthetic: true; _classification: "SYNTHETIC-SEED"; _display?: string; [k: string]: unknown; }
export interface SeedAssumption {
  kind: "optionality" | "fan-out" | "relation-verb" | "orphan-entity" | "display-name" | "value-vocabulary";
  subject: string;
  assumed: string;
  listenQuestion: string;
  /**
   * WHICH RELATION THIS ASSUMPTION IS ABOUT, as the pair of entity names in the
   * graph's normalised direction — present on every assumption a relation
   * produced, absent on the ones about a single entity.
   *
   * `subject` is prose for a person to read (`"Account → Escalation"`,
   * `"Campaign↔Account"`, and the optionality one carries the cardinality in
   * brackets as well). A consumer that wants to show a record's empty section
   * the assumption that produced it would have to rebuild that sentence and
   * hope it matches — the same string-guessed lookup the join key already had
   * to be rescued from. The pair is the address; the sentence stays prose.
   */
  pair?: [string, string];
}
/**
 * ONE LINK of a many-to-many. A junction owns no FK on either side, so its rows
 * live in their own table rather than pretending to be columns on one of the
 * two entities. `fromId`/`toId` are real record ids in the graph's normalised
 * direction — the same direction the fabric's `multi-select` region declares.
 */
export interface SeedJunctionLink { id: string; fromId: string; toId: string }
export interface SeedResult {
  records: Record<string, SeedRecord[]>;
  /**
   * Junction membership, keyed by `junctionKeyFor(from, to)` — the address the
   * fabric's multi-select region carries, so the renderer looks it up rather
   * than deriving it. Kept OUT of `records` on purpose: those are entity rows,
   * and every consumer of `records`/`counts` reads them per entity name.
   */
  junctionLinks: Record<string, SeedJunctionLink[]>;
  assumptions: SeedAssumption[];
  counts: Record<string, number>;
  /** The structure the generation walked — roots, parents/children, depth and
   *  fan-in. It used to be built here, used for the insert order, and thrown
   *  away; every consumer that needed shape then had to guess (or, in the
   *  assembler's case, sort by row count). Derived in `ontologyGraph`, returned
   *  here so a caller gets content AND the shape it was generated from. */
  graph: OntologyGraph;
}

// ── deterministic PRNG ──
function hashSeed(s: string): number { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const COMPANIES = ["Northwind", "Contoso", "Fabrikam", "Aperture", "Initech", "Umbra", "Halcyon", "Vertex", "Meridian Labs", "Blue Yonder", "Cobalt", "Sterling", "Ironwood", "Pinnacle", "Kestrel", "Lumen", "Orenda", "Quill", "Radian", "Solstice", "Tacit", "Vantage", "Wexford", "Zephyr"];
const WORDS = ["review", "renewal", "expansion", "migration", "pilot", "rollout", "audit", "handoff", "escalation", "onboarding", "assessment", "sync"];
const STATUSES = ["Open", "In progress", "Blocked", "Closed", "On hold"];
// Obviously-synthetic people, in the same register as the placeholder companies
// above. A person-shaped field needs a person-shaped value: before this list
// existed, an "owner" column rendered "Northwind onboarding" — an engagement
// standing in for a human, which is exactly the detail that tells a
// stakeholder a demo isn't real.
const PEOPLE = ["A. Whitfield", "R. Osei", "M. Lindqvist", "S. Nakamura", "D. Ferreira", "K. Abadi", "J. Mbeki", "L. Petrov", "T. Halvorsen", "N. Chaudhry", "C. Delacroix", "P. Okonkwo", "E. Vargas", "H. Sørensen", "B. Ramachandran", "F. Novak"];

// Neutral enum LABELS for a category/type/tier/segment column. A category is a
// word a person reads, so it has to look like one — the failing column showed
// PRA-5570, a handle, because a category shared the `code` branch.
const CATEGORIES = ["Standard", "Core", "Extended", "Strategic", "Enterprise", "Regional", "Global", "Priority", "Emerging", "Established", "Managed", "Direct"];

const singular = (name: string) => name.replace(/s$/i, "");

// ── lifecycle coherence ─────────────────────────────────────────────────────
//
// A RECORD IS NOT A ROW OF INDEPENDENT COLUMNS. It is one thing that happened,
// and its columns are statements about that thing which have to agree with each
// other. Every value below used to be drawn on its own, which produced, on a
// reviewed CRM build: a staffing assignment that ended four months before it
// started (165 of 366 generated date pairs — nearly half), an invoice due before
// it was issued, and an account whose opportunities, engagements and escalations
// were each owned by a different person, none of them the account's own owner.
//
// None of that is visible as a bug in a screenshot of one field. It is extremely
// visible to a client reading a row, and it is the difference between "synthetic
// data" and "nonsense" — the demo stops being about the product and becomes
// about the mistake.

/** Does this attribute name a lifecycle BEGINNING or an ENDING? Read from the
 *  attribute's own words, so `start_date`/`end_date`, `issue_date`/`due_date`
 *  and `closeDate` all answer without a per-ontology list. Neither, for a date
 *  that names an instant rather than a bound (`event_date`, `response_date`) —
 *  those carry no ordering to violate. */
const LIFECYCLE_START = /(^| )(start|started|begin|began|opened|open|created|create|issue|issued|submitted|received|entered|effective|kickoff|placed|activation|snapshot)($| )/i;
const LIFECYCLE_END = /(^| )(end|ended|close|closed|closing|complete|completed|completion|resolved|resolution|due|expiry|expires|expiration|until|termination|delivered|shipped|paid|settled)($| )/i;
function lifecyclePhase(attribute: string): "start" | "end" | undefined {
  const words = nameWords(attribute).join(" ");
  // An ending wins a tie: "close start"-shaped names do not occur, and where a
  // name carries both senses the terminal one is what bounds the record.
  if (LIFECYCLE_END.test(words)) return "end";
  if (LIFECYCLE_START.test(words)) return "start";
  return undefined;
}

/** A state that says the record's story is OVER. A record in one of these has
 *  been done, signed, closed or paid — so it cannot also be worth nothing. */
const SETTLED = /(won|closed|complete|completed|signed|executed|approved|delivered|invoiced|paid|fulfilled|settled)/i;

// Date arithmetic with no clock and no `Date` object — both banned in this
// module, and neither is needed: every generated date is `2026-MM-DD` with a day
// of 27 or less, and the offsets below are bounded well inside two years, so a
// fixed 365-day calendar is exact over the range that can actually occur.
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_STARTS = MONTH_LENGTHS.reduce<number[]>((acc, len, ix) => [...acc, acc[ix] + len], [0]);
const BASE_YEAR = 2026;
/** `YYYY-MM-DD` → days since 2026-01-01, or null for anything that is not one
 *  (a planted null, a value some other branch produced). */
function dayNumber(value: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return (y - BASE_YEAR) * 365 + MONTH_STARTS[mo - 1] + (d - 1);
}
function dayToIso(n: number): string {
  const clamped = Math.max(0, Math.min(n, 365 * 3 - 1));   // inside the exact range
  const year = BASE_YEAR + Math.floor(clamped / 365);
  const dayOfYear = clamped % 365;
  let month = 0;
  while (month < 11 && MONTH_STARTS[month + 1] <= dayOfYear) month += 1;
  const day = dayOfYear - MONTH_STARTS[month] + 1;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A synthetic value for one attribute, driven by its semantic role, deterministic.
 *
 * `vocab` is this field's OWN values when the programme has a stored value
 * vocabulary that answers for it (see `valueVocabulary.ts`) — "EMEA" in a region
 * column instead of "Managed", drawn from a list somebody can read and diff.
 * Absent, every branch falls back to the generic pool it always used.
 *
 * THE DRAW IS THE SAME EITHER WAY. Each branch below spends exactly the same
 * number of PRNG steps with a vocabulary as without one, so supplying a
 * vocabulary for one field cannot shift the values of any other field: the
 * covered column changes and the rest of the seed stays byte-identical.
 */
function valueFor(
  role: ValueRole | undefined,
  entity: string,
  attr: string,
  i: number,
  rnd: () => number,
  refValue: () => string | undefined,
  vocab?: readonly string[],
): unknown {
  const listed = vocab && vocab.length ? vocab : undefined;
  switch (role) {
    case "monetary": return Math.round((rnd() * 480000 + 2000) / 500) * 500;
    case "quantity": return Math.floor(rnd() * 200);
    // A share of a whole cannot exceed the whole. The bound IS the role.
    case "percent": return Math.floor(rnd() * 101);
    // Rotated by the attribute's own name so an entity carrying six category
    // columns (tier, region, industry, type, segment, category) doesn't print
    // one word six times across a row.
    case "category": { const pool = listed ?? CATEGORIES; return pool[(hashSeed(attr) + Math.floor(rnd() * 4)) % pool.length]; }
    case "date": { const m = 1 + Math.floor(rnd() * 12); const d = 1 + Math.floor(rnd() * 27); return `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
    case "boolean": return rnd() > 0.5;
    case "status": { const pool = listed ?? STATUSES; return pool[Math.floor(rnd() * pool.length)]; }
    // A health and a priority are closed sets too, and the generic branch has
    // nothing to say about either: without a vocabulary they fall to the
    // free-text pool below, exactly as before. With one, they read as the RAG or
    // the severity ladder the programme actually uses. One draw either way.
    case "health": case "priority":
      if (listed) return listed[Math.floor(rnd() * listed.length)];
      break;
    case "code": return `${entity.slice(0, 3).toUpperCase()}-${String(1000 + Math.floor(rnd() * 8999))}`;
    case "person-ref": return PEOPLE[Math.floor(rnd() * PEOPLE.length)];
    // A reference to another record reads as THAT RECORD'S name. When the
    // ontology names the entity being referenced, the value is the actual title
    // of the actual row the FK points at — so an Opportunity column on a
    // forecast split says what the split's own opportunity is called, instead of
    // "Northwind sync", which names an activity, not an opportunity. Without a
    // named target it falls back to the bare organisation.
    case "parent-ref": case "cross-ref": return refValue() ?? COMPANIES[Math.floor(rnd() * COMPANIES.length)];
    case "title": return `${COMPANIES[i % COMPANIES.length]} ${singular(entity)} ${i + 1}`;
    // An identifier is a HANDLE, not a second copy of the title. Sharing the
    // title's branch printed the same string into two adjacent columns.
    case "identifier": return `${entity.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${String(i + 1).padStart(5, "0")}`;
    default: break;
  }
  return `${COMPANIES[i % COMPANIES.length]} ${WORDS[Math.floor(rnd() * WORDS.length)]}`;
}

export interface SeedOptions {
  rootRows?: number;
  maxFanOut?: number;
  maxPerEntity?: number;
  /**
   * The programme's stored VALUE VOCABULARY artifact, if it has one — the
   * `{ "Entity.attribute": ["plausible","values"] }` object produced by one model
   * call per ontology change (`valueVocabulary.ts`). It is an INPUT, never a
   * generation step: the seeder reads it exactly as it reads the ontology, so a
   * rebuild moves nothing. Anything unusable (absent, empty, answering only
   * fields this ontology no longer has) resolves to no vocabulary at all and the
   * generic pools answer, byte for byte as before.
   */
  vocabulary?: unknown;
}

export function generateSeed(ontology: Record<string, unknown>, version: string, opts: SeedOptions = {}): SeedResult {
  const rootRows = opts.rootRows ?? 24;       // > page size (20) → a second page
  const maxFanOut = opts.maxFanOut ?? 5;
  const maxPerEntity = opts.maxPerEntity ?? 120;
  const vocabulary = resolveVocabulary(opts.vocabulary, ontology);
  const roles = deriveRoles(ontology);
  const entities = (Array.isArray(ontology.entities) ? ontology.entities : []) as Array<Record<string, unknown>>;
  const attrsOf = (name: string) => {
    const e = entities.find((x) => String(x.name) === name);
    return (Array.isArray(e?.attributes) ? e!.attributes : []).map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
  };
  const roleOf = new Map(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));
  const refOf = new Map(roles.attributeRoles.filter((r) => r.refEntity).map((r) => [`${r.entity} ${r.attribute}`, r.refEntity!] as const));

  // The parent→child structure, derived ONCE in ontologyGraph. This used to be
  // rebuilt here from `relations` and then discarded; now the same result is
  // returned to the caller, which is what lets the navigation be ordered by the
  // ontology instead of by how many rows this function happened to generate.
  const graph = deriveOntologyGraph(ontology);
  const { edges, order } = graph;
  const assumptions: SeedAssumption[] = [];
  for (const e of edges) {
    const { parent, child, cardinality: card, relation: verb } = e;
    // optionality is absent on every relation — assume child-optional/parent-optional
    assumptions.push({ kind: "optionality", subject: `${parent} → ${child} [${card}]`, pair: [parent, child], assumed: "child-optional, parent-optional (default)", listenQuestion: `Must every ${child} have a ${parent}? Can a ${parent} have zero ${child}?` });
    if (card.endsWith(":N")) assumptions.push({ kind: "fan-out", subject: `${parent} → ${child}`, pair: [parent, child], assumed: `0–${maxFanOut} per ${parent}`, listenQuestion: `Realistic count of ${child} per ${parent}?` });
    if (verb && verb.toLowerCase() === "produces") assumptions.push({ kind: "relation-verb", subject: `${parent} → ${child}`, pair: [parent, child], assumed: 'generic verb "produces" treated as parent→child FK', listenQuestion: `Is ${parent}→${child} a composition, a reference, or a lifecycle transition?` });
  }
  // An entity with NO name-like attribute has no way to introduce one of its
  // records to a person: the display name gets taken from whichever attribute
  // came first, so the demo shows account names under a "Category" heading.
  // That is a gap in the ontology, not a rendering choice — it goes to Listen.
  const needsDisplayName = new Set(graph.entities.filter((n) => {
    const attrs = attrsOf(n);
    return attrs.length > 0 && !attrs.some((a) => readsLikeATitle(a));
  }));
  for (const n of needsDisplayName) {
    assumptions.push({ kind: "display-name", subject: n, assumed: "no name-like attribute; a synthetic display name was supplied",
      listenQuestion: `What does a user call a single ${n}? It has no name, title or label attribute.` });
  }
  // WHAT THE VOCABULARY DID NOT ANSWER, said out loud.
  //
  // Only when there IS one: with no artifact the build is what it always was,
  // and an assumption about a feature nobody switched on is noise. With one, two
  // things can quietly be wrong — it can be older than the ontology it is read
  // against, and it can cover some fields and not others — and both look
  // identical on screen to a vocabulary that is right. So both are declared, and
  // the fields still on the generic pool are named, because "Region: Managed" is
  // a Listen question and not a finish.
  if (vocabulary) {
    if (!vocabulary.current) {
      assumptions.push({ kind: "value-vocabulary", subject: "stored value vocabulary",
        assumed: `generated for an earlier version of this ontology (${vocabulary.fingerprint}); ${vocabulary.covered.length} field(s) still matched`,
        listenQuestion: "The ontology has changed since these picklist values were produced — regenerate the value vocabulary and confirm the lists still read correctly?" });
    }
    if (vocabulary.missing.length) {
      const named = vocabulary.missing.slice(0, 3).map((t) => `${t.entity}.${t.attribute}`).join(", ");
      const rest = vocabulary.missing.length > 3 ? ` and ${vocabulary.missing.length - 3} more` : "";
      assumptions.push({ kind: "value-vocabulary", subject: `${vocabulary.missing.length} field(s) with no supplied values`,
        assumed: `neutral placeholder labels used for ${named}${rest}`,
        listenQuestion: `What values do ${named}${rest} actually hold? The demo is showing generic labels for them.` });
    }
  }
  const isRoot = new Set(graph.nodes.filter((n) => n.isRoot).map((n) => n.name));
  for (const n of graph.nodes) {
    if (n.parents.length === 0 && n.children.length === 0) {
      assumptions.push({ kind: "orphan-entity", subject: n.name, assumed: "seeded standalone (no relation in the ontology)", listenQuestion: `What does ${n.name} connect to?` });
    }
  }
  // generate
  const records: Record<string, SeedRecord[]> = {};
  /** Each entity's rows by id — how a child reaches the PARENT ROW it belongs to
   *  (not just the parent's id) when a value of its own has to agree with one of
   *  the parent's. Filled as each entity completes; the insert order is
   *  topological, so a parent is always indexed before its children generate. */
  const index: Record<string, Map<string, SeedRecord>> = {};
  const parentEdgesOf = new Map<string, typeof edges>(); // child -> its parent edges
  for (const e of edges) (parentEdgesOf.get(e.child) ?? parentEdgesOf.set(e.child, []).get(e.child)!).push(e);
  // What a REFERENCE to one of an entity's rows should read as: its title
  // attribute, else the display name this generator supplied for it.
  const titleAttrOf = (name: string) => attrsOf(name).find((a) => roleOf.get(`${name} ${a}`) === "title")
    ?? (needsDisplayName.has(name) ? "_display" : undefined)
    ?? attrsOf(name).find((a) => roleOf.get(`${name} ${a}`) === "identifier");
  let planted = false;
  for (const name of order) {
    const rnd = mulberry32(hashSeed(`${version}::${name}`));
    // A per-entity ceiling, deterministic from the entity's own name. With ONE
    // shared cap, every table deep enough in the graph saturated and reported
    // the identical round number — on a real 32-entity ontology, 12 tables all
    // read "120 records", which presents as a placeholder rather than as a
    // populated system. The cap still bounds the work; it just stops being the
    // headline figure. (Client names stay out of this cluster by design — see
    // the generic-naming gate in pipelineValidation.)
    const entityCap = maxPerEntity - Math.floor(mulberry32(hashSeed(`cap::${name}`))() * Math.min(40, maxPerEntity / 3));
    const attrs = attrsOf(name);
    const parents = parentEdgesOf.get(name) ?? [];
    const rows: SeedRecord[] = [];
    // The columns whose values have to AGREE WITH EACH OTHER, identified once
    // per entity rather than per row.
    const roleAttrs = (role: ValueRole) => attrs.filter((a) => roleOf.get(`${name} ${a}`) === role);
    const dateAttrs = roleAttrs("date");
    const startAttrs = dateAttrs.filter((a) => lifecyclePhase(a) === "start");
    const endAttrs = dateAttrs.filter((a) => lifecyclePhase(a) === "end");
    const stateAttrs = roleAttrs("status");
    const moneyAttrs = roleAttrs("monetary");
    const personAttrs = roleAttrs("person-ref");
    const mk = (i: number, parentIds: Record<string, string>): SeedRecord => {
      const rec: SeedRecord = { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(i + 1).padStart(4, "0")}`, _synthetic: true, _classification: "SYNTHETIC-SEED" };
      if (needsDisplayName.has(name)) rec._display = `${COMPANIES[i % COMPANIES.length]} ${singular(name)} ${i + 1}`;
      attrs.forEach((a) => {
        // What a reference column should SAY: the title of the row it points at.
        // When this record has an FK to that entity, it is that exact row — the
        // column and the relation agree, which is the whole point of a reference.
        const refValue = () => {
          const target = refOf.get(`${name} ${a}`);
          if (!target) return undefined;
          const pool = records[target] ?? [];
          if (!pool.length) return undefined;
          const ta = titleAttrOf(target);
          const linked = parentIds[target] ? pool.find((p) => p.id === parentIds[target]) : undefined;
          const row = linked ?? pool[i % pool.length];
          const v = ta ? row[ta] : undefined;
          return typeof v === "string" && v ? v : String(row.id);
        };
        rec[a] = valueFor(roleOf.get(`${name} ${a}`), name, a, i, rnd, refValue, vocabulary?.values.get(vocabularyKey(name, a)));
      });
      // FK columns — `joinKeyFor` is the ONE definition, shared with the fabric
      // region that declares the relation, so the reader never has to guess how
      // the writer spelled it.
      for (const [pName, pid] of Object.entries(parentIds)) rec[joinKeyFor(pName)] = pid;
      // planted edge cases (once, on the first non-root entity with attributes)
      if (!planted && !isRoot.has(name) && attrs.length) {
        if (i === 0) { const t = titleAttrOf(name) ?? attrs.find((a) => roleOf.get(`${name} ${a}`) === "identifier") ?? attrs[0]; rec[t] = `${rec[t]} — an unusually long synthetic label used to stress the layout of ${name} rows and columns`; }
        if (i === 1) { const opt = attrs[attrs.length - 1]; rec[opt] = null; } // missing optional
        if (i === 2) { const money = attrs.find((a) => roleOf.get(`${name} ${a}`) === "monetary"); if (money) rec[money] = 0; } // boundary
        if (i === 2) planted = true;
      }
      // ── the record now has to agree with itself ──
      //
      // Runs LAST, over the finished row, including the planted edge cases:
      // those are deliberate extremes, and an extreme is still a record. It
      // spends no PRNG draws — every repair is computed from values already on
      // the row — so the extremes stay exactly where the planting put them and
      // the run stays reproducible.
      //
      // 1 · AN ENDING CANNOT PRECEDE ITS BEGINNING. Each end-shaped date is
      //     re-placed after the earliest start-shaped one, keeping the spread its
      //     own drawn value gave it, so the dates still vary across rows.
      if (startAttrs.length && endAttrs.length) {
        const starts = startAttrs.map((a) => dayNumber(rec[a])).filter((n): n is number => n !== null);
        if (starts.length) {
          const opened = Math.min(...starts);
          for (const a of endAttrs) {
            const drawn = dayNumber(rec[a]);
            if (drawn === null) continue;             // a planted null stays a planted null
            rec[a] = dayToIso(opened + 1 + (drawn % 240));
          }
        }
      }
      // 2 · A RECORD THAT IS DONE IS WORTH SOMETHING. A closed-won deal with no
      //     amount is the contradiction a client spots first. The planted zero
      //     is not deleted to fix it — it is a real instrument for the layout —
      //     so the STATE moves back to one the record can honestly be in.
      //     Only where the state has no non-terminal value to move to does the
      //     amount take the correction, derived from the record's own id so no
      //     draw is spent.
      if (moneyAttrs.length && stateAttrs.length) {
        const money = moneyAttrs[0];
        const state = stateAttrs[0];
        const amount = rec[money];
        if (SETTLED.test(String(rec[state] ?? "")) && !(typeof amount === "number" && amount > 0)) {
          const pool = vocabulary?.values.get(vocabularyKey(name, state)) ?? STATUSES;
          const unsettled = pool.find((s) => !SETTLED.test(s));
          if (unsettled) rec[state] = unsettled;
          else rec[money] = 2000 + (hashSeed(String(rec.id)) % 960) * 500;
        }
      }
      // 3 · ONE ACCOUNT, ONE OWNER. Every person-shaped column used to be drawn
      //     independently, so an account's opportunities, engagements and
      //     escalations each named a different person and none of them named the
      //     account's owner — the relationship a CRM exists to represent,
      //     contradicted on every row of every child table. A record's first
      //     person column now inherits its parent's.
      if (personAttrs.length) {
        const edge = parents.find((e) => parentIds[e.parent]);
        const parentRow = edge ? index[edge.parent]?.get(parentIds[edge.parent]) : undefined;
        const parentPerson = edge ? attrsOf(edge.parent).find((a) => roleOf.get(`${edge.parent} ${a}`) === "person-ref") : undefined;
        const owner = parentRow && parentPerson ? parentRow[parentPerson] : undefined;
        if (typeof owner === "string" && owner) rec[personAttrs[0]] = owner;
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
        const k = pi === 0 ? 0 : pi === 1 ? maxFanOut : (primary?.parentToChild === "1:1" ? 1 : Math.floor(rnd() * (maxFanOut + 1)));
        for (let j = 0; j < k && rows.length < entityCap; j += 1) {
          const parentIds: Record<string, string> = { [primary!.parent]: String(p.id) };
          for (const pe of parents.slice(1)) { const alt = records[pe.parent] ?? []; if (alt.length) parentIds[pe.parent] = String(alt[(idx + j) % alt.length].id); }
          rows.push(mk(idx++, parentIds));
        }
      });
      if (!rows.length && attrs.length) rows.push(mk(0, {})); // ensure a non-empty table where sensible
    }
    records[name] = rows;
    index[name] = new Map(rows.map((r) => [String(r.id), r] as const));
  }
  // ── junction membership ──
  //
  // A many-to-many owns no foreign key on either side, so the FK pass above
  // cannot reach it, and this generator used to stop there: it declared the
  // skip as an assumption ("no junction generated") and left it. Honest, and
  // it meant every multi-select region in every prototype was permanently
  // empty — the one relation kind that renders as a SET of links had no links
  // to show, on every build, for every client.
  //
  // Membership is now materialised as its own rows, in the graph's normalised
  // direction, from the SAME fabric-version-seeded PRNG as everything else: no
  // clock, no Math.random, so two runs on one ontology produce byte-identical
  // links. It runs after the entity loop because a link can only point at rows
  // that exist. The extremes are planted here too — the first row of the `from`
  // side gets zero links so the empty state stays reachable, the second gets
  // the maximum so the wrap case is on screen.
  const junctionLinks: Record<string, SeedJunctionLink[]> = {};
  for (const j of graph.junctions) {
    const key = junctionKeyFor(j.from, j.to);
    const rnd = mulberry32(hashSeed(`${version}::junction::${j.from}::${j.to}`));
    const fromRows = records[j.from] ?? [];
    const toRows = records[j.to] ?? [];
    const links: SeedJunctionLink[] = [];
    const perRow = Math.min(maxFanOut, toRows.length);
    for (let fi = 0; fi < fromRows.length && links.length < maxPerEntity; fi += 1) {
      const k = fi === 0 ? 0 : fi === 1 ? perRow : Math.floor(rnd() * (perRow + 1));
      const taken = new Set<number>();
      for (let m = 0; m < k && links.length < maxPerEntity; m += 1) {
        let ix = Math.floor(rnd() * toRows.length);
        while (taken.has(ix)) ix = (ix + 1) % toRows.length;   // distinct within one row, never a duplicate chip
        taken.add(ix);
        links.push({ id: `${key}-${String(links.length + 1).padStart(4, "0")}`, fromId: String(fromRows[fi].id), toId: String(toRows[ix].id) });
      }
    }
    junctionLinks[key] = links;
    // The assumption now says what WAS generated — the miss it used to declare
    // no longer exists, and the fan-out it guessed at is still a Listen question.
    assumptions.push({ kind: "fan-out", subject: `${j.from}↔${j.to}`, pair: [j.from, j.to],
      assumed: `synthetic membership: 0–${perRow} ${j.to} per ${j.from} (${links.length} link${links.length === 1 ? "" : "s"})`,
      listenQuestion: `Is ${j.from}↔${j.to} a true many-to-many needing a join table, and how many ${j.to} does a ${j.from} really carry?` });
  }

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(records)) counts[k] = v.length;
  return { records, junctionLinks, assumptions, counts, graph };
}
