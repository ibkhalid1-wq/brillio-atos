/**
 * A STAFFING ASSIGNMENT THAT ENDED FOUR MONTHS BEFORE IT BEGAN.
 *
 * Every value in a seeded record used to be drawn on its own. A row was a set of
 * independently plausible columns and, taken together, an impossible event: on
 * the 33-entity snapshot, 165 of 366 generated date pairs — nearly half — closed
 * before they opened. An invoice fell due before it was issued. An account's
 * opportunities, engagements and escalations each named a different owner, none
 * of them the account's own.
 *
 * None of that reads as a bug in one field. It reads, to a client looking at a
 * row, as a system that does not understand its own business — and the demo
 * stops being about the product.
 *
 * A record is ONE THING THAT HAPPENED, and its columns are statements about that
 * thing which have to agree. This file pins the three agreements, and pins them
 * as PROPERTIES OF THE OUTPUT: it classifies the fixture's own attributes with
 * its own rules, so a generator that stopped recognising `issue_date` as a
 * beginning fails here rather than agreeing with itself.
 *
 * What must NOT be sacrificed to coherence, and is asserted too: the planted
 * extremes (a null, a zero, an over-long label) are deliberate instruments for
 * the layout, so making a record consistent must not launder them away; and the
 * generation stays deterministic and free of any clock.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSeed, type SeedRecord } from "@shared/seedData.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { deriveRoles } from "@shared/semanticRoles.ts";
import { deriveOntologyGraph, joinKeyFor } from "@shared/ontologyGraph.ts";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");
const version = deriveFabric(ontology, atlas).version;
const seed = generateSeed(ontology, version);

/** THIS FILE'S OWN reading of an attribute name — deliberately not the
 *  generator's. Two implementations that agree are evidence; one that agrees
 *  with itself is not. */
const words = (s: string) => s.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
const OPENS = /\b(start|opened|created|issue|issued|submitted|effective|placed)\b/;
const CLOSES = /\b(end|close|closed|completed|due|expires|until|delivered|paid)\b/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SETTLED = /(won|closed|complete|signed|approved|delivered|paid)/i;

const roles = deriveRoles(ontology);
const roleOf = new Map(roles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));
const attributesOf = (entity: string) => roles.attributeRoles.filter((r) => r.entity === entity).map((r) => r.attribute);

interface Pairing { entity: string; opens: string[]; closes: string[] }
const datePairs = (entity: string): Pairing => {
  const dates = attributesOf(entity).filter((a) => roleOf.get(`${entity} ${a}`) === "date");
  return {
    entity,
    opens: dates.filter((a) => OPENS.test(words(a)) && !CLOSES.test(words(a))),
    closes: dates.filter((a) => CLOSES.test(words(a))),
  };
};

// ── 1 · nothing ends before it starts ────────────────────────────────────────

describe("a record cannot close before it opened", () => {
  it("every start/end date pair in the 33-entity snapshot is ordered", () => {
    // MUTATION: remove the end-date re-placement from the coherence pass → RED,
    // with 165 of 366 pairs backwards, which is what shipped.
    const violations: string[] = [];
    let checked = 0;
    for (const [entity, rows] of Object.entries(seed.records)) {
      const { opens, closes } = datePairs(entity);
      if (!opens.length || !closes.length) continue;
      for (const rec of rows) {
        for (const o of opens) for (const c of closes) {
          const from = rec[o];
          const to = rec[c];
          if (typeof from !== "string" || typeof to !== "string" || !ISO.test(from) || !ISO.test(to)) continue;
          checked += 1;
          // ISO dates compare correctly as strings — that is the format's point.
          if (to < from) violations.push(`${entity} ${rec.id}: ${o}=${from} but ${c}=${to}`);
        }
      }
    }
    expect(checked, "no date pair was examined — the classification found nothing").toBeGreaterThan(300);
    expect(violations.slice(0, 8), `${violations.length} records end before they start`).toEqual([]);
  });

  it("ordering did not flatten the data — the spans still vary", () => {
    // The cheap way to pass the test above is to make every record span one day.
    // A demo of four hundred identical durations is a different defect, so the
    // spread is pinned as well.
    const spans = new Set<number>();
    for (const [entity, rows] of Object.entries(seed.records)) {
      const { opens, closes } = datePairs(entity);
      if (!opens.length || !closes.length) continue;
      for (const rec of rows) {
        const from = rec[opens[0]];
        const to = rec[closes[0]];
        if (typeof from === "string" && typeof to === "string" && ISO.test(from) && ISO.test(to)) {
          spans.add(Date.parse(to) - Date.parse(from));
        }
      }
    }
    expect(spans.size).toBeGreaterThan(20);
  });

  it("dates stay real calendar dates — no month 13, no day 32", () => {
    // The arithmetic runs on a fixed calendar (no clock is allowed in the
    // generator), so its edges are worth pinning rather than assuming.
    let seen = 0;
    for (const rows of Object.values(seed.records)) for (const rec of rows) for (const v of Object.values(rec)) {
      if (typeof v !== "string" || !ISO.test(v)) continue;
      seen += 1;
      const [y, m, d] = v.split("-").map(Number);
      expect(y, `impossible year in ${v}`).toBeGreaterThanOrEqual(2026);
      expect(m >= 1 && m <= 12, `impossible month in ${v}`).toBe(true);
      expect(d >= 1 && d <= 31, `impossible day in ${v}`).toBe(true);
      expect(new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10), `${v} is not a real date`).toBe(v);
    }
    expect(seen).toBeGreaterThan(100);
  });
});

// ── 2 · a record that is done is worth something ─────────────────────────────

/** A two-entity fixture whose deals can ONLY be in settled states — the case
 *  that puts a "Closed-Won" beside the seeder's planted zero amount. */
const deals = {
  entities: [
    { name: "Client", attributes: ["name", "owner"] },
    { name: "Deal", attributes: ["name", "stage", "amount", "client"] },
  ],
  relations: [{ from: "Client", to: "Deal", cardinality: "1:N" }],
} as unknown as Record<string, unknown>;
const dealsVersion = deriveFabric(deals, {}).version;

describe("a settled record carries a value", () => {
  const check = (records: Record<string, SeedRecord[]>, roleLookup: Map<string, string>, attrsFor: (e: string) => string[]) => {
    const violations: string[] = [];
    let checked = 0;
    for (const [entity, rows] of Object.entries(records)) {
      const attrs = attrsFor(entity);
      const money = attrs.filter((a) => roleLookup.get(`${entity} ${a}`) === "monetary");
      const state = attrs.filter((a) => roleLookup.get(`${entity} ${a}`) === "status");
      if (!money.length || !state.length) continue;
      for (const rec of rows) {
        if (!SETTLED.test(String(rec[state[0]] ?? ""))) continue;
        checked += 1;
        const amount = rec[money[0]];
        if (!(typeof amount === "number" && amount > 0)) violations.push(`${entity} ${rec.id}: ${state[0]}="${rec[state[0]]}" with ${money[0]}=${JSON.stringify(amount)}`);
      }
    }
    return { violations, checked };
  };

  it("no settled record in the snapshot is worth nothing", () => {
    const { violations, checked } = check(seed.records, roleOf, attributesOf);
    expect(checked, "no settled record was examined").toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });

  it("a fixture whose every stage is settled still cannot show a zero amount", () => {
    // MUTATION: remove the amount/state repair → RED here. This fixture exists
    // because the snapshot's planted zero happens to land on an open record; the
    // invariant has to hold when it does not.
    const vocabulary = { values: { "Deal.stage": ["Closed-Won", "Closed-Lost"] } };
    const dealRoles = deriveRoles(deals);
    const lookup = new Map(dealRoles.attributeRoles.map((r) => [`${r.entity} ${r.attribute}`, r.role] as const));
    const attrsFor = (e: string) => dealRoles.attributeRoles.filter((r) => r.entity === e).map((r) => r.attribute);
    const { records } = generateSeed(deals, dealsVersion, { vocabulary });
    const { violations, checked } = check(records, lookup, attrsFor);
    expect(checked).toBeGreaterThan(5);
    expect(violations).toEqual([]);
    // And the repair did not simply delete the extreme: the boundary case is
    // still in the build, on a record whose state can honestly carry it.
    const plainRecords = generateSeed(deals, dealsVersion).records;
    const zeros = plainRecords.Deal.filter((r) => r.amount === 0);
    expect(zeros.length, "the planted zero-amount boundary case was laundered away").toBeGreaterThan(0);
    for (const r of zeros) expect(SETTLED.test(String(r.stage))).toBe(false);
  });
});

// ── 3 · one account, one owner ───────────────────────────────────────────────

describe("a record's people are its parent's people", () => {
  it("every child's first person column names the owner of the record it belongs to", () => {
    // MUTATION: remove the person inheritance → RED. Before it, an account, its
    // opportunities and its escalations named three different owners on the same
    // screen, which is the relationship a CRM exists to represent.
    //
    // THE RECORD IT BELONGS TO is its OWNING relation — the parent it was fanned
    // out from, which the graph states as the first edge naming it as a child. A
    // record with several parents (an escalation references an account AND an
    // opportunity) carries no ownership claim about the others, and asserting one
    // would be asserting something the ontology does not say.
    const graph = deriveOntologyGraph(ontology);
    const owningEdge = (child: string) => graph.edges.find((e) => e.child === child);
    const personOf = (entity: string) => attributesOf(entity).find((a) => roleOf.get(`${entity} ${a}`) === "person-ref");
    const violations: string[] = [];
    let checked = 0;
    let unowned = 0;
    for (const [entity, rows] of Object.entries(seed.records)) {
      const edge = owningEdge(entity);
      if (!edge) continue;
      const parentPerson = personOf(edge.parent);
      const childPerson = personOf(entity);
      if (!parentPerson || !childPerson) continue;
      const parentsById = new Map((seed.records[edge.parent] ?? []).map((r) => [String(r.id), r] as const));
      for (const child of rows) {
        const fk = child[joinKeyFor(edge.parent)];
        const parent = typeof fk === "string" ? parentsById.get(fk) : undefined;
        if (!parent) continue;
        // A parent with no name in its own person column has no owner to pass on
        // — the planted missing-optional. The child keeps the one it drew.
        if (typeof parent[parentPerson] !== "string" || !parent[parentPerson]) { unowned += 1; continue; }
        checked += 1;
        if (child[childPerson] !== parent[parentPerson]) {
          violations.push(`${entity} ${child.id}.${childPerson}="${child[childPerson]}" but ${edge.parent} ${parent.id}.${parentPerson}="${parent[parentPerson]}"`);
        }
      }
    }
    expect(checked, "no parent/child pair carried people on both sides").toBeGreaterThan(50);
    expect(unowned, "every parent examined was ownerless — the check proved nothing").toBeLessThan(checked);
    expect(violations.slice(0, 8), `${violations.length} children disown their parent's owner`).toEqual([]);
    // Not vacuous the other way either: inheritance must not collapse the build
    // onto ONE person. A demo where every record in every table names the same
    // human is as wrong as one where no two agree.
    const owners = new Set<string>();
    for (const [entity, rows] of Object.entries(seed.records)) {
      for (const attribute of attributesOf(entity)) {
        if (roleOf.get(`${entity} ${attribute}`) !== "person-ref") continue;
        for (const rec of rows) if (typeof rec[attribute] === "string") owners.add(String(rec[attribute]));
      }
    }
    expect(owners.size).toBeGreaterThan(3);
  });
});

// ── 4 · coherence costs neither determinism nor the instruments ──────────────

describe("making records coherent moved nothing else", () => {
  it("two runs are byte-identical — no clock, no draw spent on a repair", () => {
    const a = generateSeed(ontology, version);
    const b = generateSeed(ontology, version);
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
    expect(JSON.stringify(a.junctionLinks)).toBe(JSON.stringify(b.junctionLinks));
  });

  it("the planted extremes survived — a null, a zero and an over-long label", () => {
    // The coherence pass runs LAST, over the finished row. A pass that made
    // every record tidy would remove exactly the rows that make design errors
    // visible, and every screen would demo its own comfortable case.
    const all = Object.values(seed.records).flat();
    expect(all.some((r) => Object.values(r).some((v) => v === null))).toBe(true);
    expect(all.some((r) => Object.values(r).some((v) => v === 0))).toBe(true);
    expect(all.some((r) => Object.values(r).some((v) => typeof v === "string" && v.length > 60))).toBe(true);
  });

  it("the fabric is untouched: content changed, structure did not", () => {
    expect(deriveFabric(ontology, atlas).version).toBe(version);
  });
});
