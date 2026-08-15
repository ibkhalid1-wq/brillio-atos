/**
 * A MANY-TO-MANY MUST HAVE MEMBERS.
 *
 * `generateSeed` wrote foreign keys for graph EDGES only. For a junction it
 * pushed an assumption reading "skipped (no junction generated)" and moved on —
 * honest, and it meant every multi-select region in every prototype ever built
 * was permanently empty. The one relation kind that renders as a set of links
 * had no links, on every build, for every client, and the screen that was
 * supposed to demonstrate "this partner runs in these campaigns" demonstrated
 * an empty state instead.
 *
 * Membership is now materialised: its own rows, in the graph's normalised
 * direction, from the same fabric-version-seeded PRNG as the rest of the seed.
 *
 * THE CRITICAL INVARIANT: the FABRIC MUST NOT MOVE. Only the seed gains rows.
 * The seed is keyed by the fabric version, so a fabric that shifts re-rolls
 * every value in every prototype — which is why the versions below are pinned
 * to the bytes measured BEFORE this change, and why the independence of fabric
 * from seed volume is asserted directly rather than assumed.
 *
 * MUTATIONS THAT MUST GO RED:
 *   1. seeder    → `junctionLinks[key] = []` (restore the skip)
 *   2. assembler → resolve multi-select children through the FK filter again
 *   3. fabric    → add `joinKey`/`junctionKey` to the node hash (versions move)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed } from "@shared/seedData.ts";
import { junctionKeyFor } from "@shared/ontologyGraph.ts";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });

const ontology = {
  entities: [
    ent("Alliance Partner", ["partner_name", "tier", "region"]),
    ent("Joint Deal", ["deal_name", "stage", "amount"]),
    ent("Contact", ["contact_name", "email"]),
    ent("Campaign", ["campaign_name"]),
  ],
  relations: [
    { from: "Alliance Partner", to: "Joint Deal", cardinality: "1:N" },
    { from: "Alliance Partner", to: "Contact", cardinality: "1:N" },
    { from: "Campaign", to: "Alliance Partner", cardinality: "N:M" },
  ],
};

const KEY = junctionKeyFor("Campaign", "Alliance Partner");
const fabric = deriveFabric(ontology, {});
const seed = generateSeed(ontology, fabric.version);
const html = assemblePrototype(ontology, {}).html;

/** The rendered DOM, queried — never a regex over the markup. */
const doc = new DOMParser().parseFromString(html, "text/html");
const regionEl = (id: string): Element | null => doc.querySelector(`[data-fabric-id="${id}"]`);

describe("junction membership exists at all", () => {
  it("emits links for every junction the graph declares", () => {
    // MUTATION 1 → RED.
    expect(fabric.graph.junctions.length, "the fixture stopped declaring a junction").toBeGreaterThan(0);
    for (const j of fabric.graph.junctions) {
      const links = seed.junctionLinks[junctionKeyFor(j.from, j.to)] ?? [];
      expect(links.length, `${j.from}↔${j.to} generated no membership`).toBeGreaterThan(0);
    }
  });

  it("every link names two REAL records, in the declared direction", () => {
    const from = new Set((seed.records.Campaign ?? []).map((r) => String(r.id)));
    const to = new Set((seed.records["Alliance Partner"] ?? []).map((r) => String(r.id)));
    for (const l of seed.junctionLinks[KEY] ?? []) {
      expect(from.has(l.fromId), `dangling fromId ${l.fromId}`).toBe(true);
      expect(to.has(l.toId), `dangling toId ${l.toId}`).toBe(true);
    }
  });

  it("keeps both extremes reachable — a record with none, a record with several", () => {
    // The empty state has to stay demonstrable, and so does the wrap case.
    const per = new Map<string, number>();
    for (const l of seed.junctionLinks[KEY] ?? []) per.set(l.fromId, (per.get(l.fromId) ?? 0) + 1);
    const campaigns = (seed.records.Campaign ?? []).map((r) => String(r.id));
    expect(campaigns.some((c) => (per.get(c) ?? 0) === 0), "no campaign has zero links").toBe(true);
    expect(Math.max(...campaigns.map((c) => per.get(c) ?? 0)), "no campaign has several links").toBeGreaterThan(1);
    // and never the same partner twice on one record
    for (const c of campaigns) {
      const ids = (seed.junctionLinks[KEY] ?? []).filter((l) => l.fromId === c).map((l) => l.toId);
      expect(new Set(ids).size, `${c} links the same record twice`).toBe(ids.length);
    }
  });
});

describe("the same ontology gives the same rows", () => {
  it("two generateSeed calls produce identical junction links", () => {
    // No clock, no Math.random — the seeded PRNG is the whole source of variety.
    const a = generateSeed(ontology, fabric.version);
    const b = generateSeed(ontology, fabric.version);
    expect(JSON.stringify(a.junctionLinks)).toBe(JSON.stringify(b.junctionLinks));
    expect(JSON.stringify(a.junctionLinks)).toBe(JSON.stringify(seed.junctionLinks));
  });

  it("the links are driven by the fabric version, not by a fixed pattern", () => {
    const other = generateSeed(ontology, `${fabric.version}-moved`);
    expect(JSON.stringify(other.junctionLinks)).not.toBe(JSON.stringify(seed.junctionLinks));
  });
});

describe("THE FABRIC DOES NOT MOVE", () => {
  it("holds the versions measured before junction membership existed", () => {
    // MUTATION 3 → RED. These two hashes were taken on the tree before this
    // change. If either moves, the fabric moved with the seed — and every
    // prototype's values re-roll for a structural derivation that did not
    // change. Update them only when the FABRIC is deliberately changed.
    expect(deriveFabric(ontology, {}).version).toBe("56915c24");
    expect(deriveFabric(snap("domain-ontology.json"), snap("current-state-atlas.json")).version).toBe("861c45fe");
  });

  it("is independent of how much seed there is", () => {
    // The structural statement, not a hash: change the volume knobs — which
    // changes the membership — and the fabric is byte-identical.
    const small = generateSeed(ontology, fabric.version, { rootRows: 6, maxFanOut: 2 });
    expect(JSON.stringify(small.junctionLinks)).not.toBe(JSON.stringify(seed.junctionLinks));
    expect(deriveFabric(ontology, {}).version).toBe(fabric.version);
    expect(JSON.stringify(deriveFabric(ontology, {}))).toBe(JSON.stringify(fabric));
  });
});

describe("the multi-select region shows real linked records", () => {
  const id = "region:campaign:alliance-partner";

  it("renders chips naming records that are actually linked to the record on screen", () => {
    // MUTATION 1 or 2 → RED: the region falls back to its empty state.
    const el = regionEl(id);
    expect(el, "the multi-select region is missing").toBeTruthy();
    const chips = [...el!.querySelectorAll(".m-chip")].map((c) => c.textContent ?? "");
    expect(chips.length, "the many-to-many still renders no members").toBeGreaterThan(0);
    expect(new Set(chips).size, "the same member is chipped twice").toBe(chips.length);

    const partners = seed.records["Alliance Partner"] ?? [];
    // Which campaign is on screen: the one whose linked set the chips name.
    const named = chips.map((c) => partners.find((p) => [p.partner_name, p._display, p.id].map(String).includes(c)));
    for (const [i, p] of named.entries()) expect(p, `chip "${chips[i]}" names no seeded record`).toBeTruthy();
    const namedIds = named.map((p) => String(p!.id));
    const campaigns = (seed.records.Campaign ?? []).map((c) => String(c.id))
      .filter((c) => namedIds.every((pid) => (seed.junctionLinks[KEY] ?? []).some((l) => l.fromId === c && l.toId === pid)));
    expect(campaigns.length, "the chips do not correspond to any one campaign's membership").toBeGreaterThan(0);
    // and the count on the badge is that campaign's true membership
    const badge = Number(el!.querySelector(".m-badge")?.textContent ?? "-1");
    const trueCount = (seed.junctionLinks[KEY] ?? []).filter((l) => l.fromId === campaigns[0]).length;
    expect(badge).toBe(trueCount);
    expect(chips.length).toBe(Math.min(5, trueCount));
  });

  it("stays a SET — chips, never a table", () => {
    const el = regionEl(id);
    expect(el!.querySelector("table"), "a many-to-many rendered as a table of owned rows").toBeNull();
    expect(el!.querySelector(".m-chips"), "the chip container is gone").toBeTruthy();
  });
});

describe("the assumption describes what was generated", () => {
  it("no longer declares a skip, and states the fan-out it assumed", () => {
    const a = seed.assumptions.find((x) => x.subject === "Campaign↔Alliance Partner");
    expect(a, "the junction contributes no assumption at all").toBeTruthy();
    expect(a!.assumed, "the seeder still claims it generated nothing").not.toMatch(/skip/i);
    expect(a!.assumed).toMatch(/\d/);                       // it says how many
    expect(a!.listenQuestion.length).toBeGreaterThan(20);   // and it still asks
  });

  it("generates membership for the junctions declared, and for nothing else", () => {
    // Both halves of the property, on a real committed ontology. That ontology
    // declares no many-to-many at all — so the correct output is NO membership
    // table and no assumption about one. A generator that invented links here
    // would be fabricating a relation the client never described, which is the
    // opposite failure to the one this item fixes and just as bad.
    const ont = snap("domain-ontology.json");
    const s = generateSeed(ont, deriveFabric(ont, snap("current-state-atlas.json")).version);
    expect(Object.keys(s.junctionLinks).sort()).toEqual(s.graph.junctions.map((j) => junctionKeyFor(j.from, j.to)).sort());
    for (const [key, links] of Object.entries(s.junctionLinks)) {
      expect(links.length, `${key} is declared but empty`).toBeGreaterThan(0);
    }
    for (const a of s.assumptions) expect(a.assumed, `"${a.subject}" still declares a skip`).not.toMatch(/skip/i);
  });
});
