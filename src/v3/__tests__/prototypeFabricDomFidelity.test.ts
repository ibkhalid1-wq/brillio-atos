/**
 * A5 · EVERY KIND OF NODE THE FABRIC EMITS HAS A RENDERING, AND THE BUILD SAYS
 * WHERE ONE DOES NOT.
 *
 * The fabric is the contract between the ontology and the document: five kinds
 * of node — `screen`, `region`, `field`, `nav`, `flow` — each with a stable,
 * non-positional id, and `data-fabric-id` is the address `diffFabric`
 * (src/v3/lib/fabricDelta.ts) resolves an incremental change against. A node
 * with no element is a node a delta cannot reach.
 *
 * WHAT WAS WRONG. Every fidelity assertion in this suite filtered to
 * `region`, `nav` and `field` — `prototypeRelationRoles` and
 * `prototypeClientRender` both — so the `screen` kind was covered by nothing.
 * Measured on the uncurated snapshot build before the fix: 33 of 66 screen
 * nodes (every `screen:{entity}` detail node) carried no `data-fabric-id`
 * anywhere in the document, and no test in the repository could tell. A whole
 * node kind had already stopped being rendered, silently, which is precisely
 * the failure this guard exists to stop — and the brief's "allow-list with a
 * reason" for a node that legitimately has no rendering was never built, so
 * there was nowhere the absence could have been declared either.
 *
 * WHAT THIS PINS.
 *
 *   1. The kinds are ENUMERATED. Every kind the fabric emits must appear in
 *      `CONTRACT` below with the element it must produce. A sixth kind added to
 *      `deriveFabric` and rendered nowhere fails here rather than shipping.
 *   2. On an uncurated build every node of every kind — no exemptions, and the
 *      test says so by asserting the exempt set is EMPTY — carries its id in
 *      the SERVED bytes and in the RENDERED tree.
 *   3. A screen node's element is the screen the router addresses for that
 *      entity, and that screen names the entity. An id parked on any element
 *      would satisfy "has a rendering"; it would not satisfy this.
 *   4. The delta contract: the ids `diffFabric` reports for an ontology change
 *      — screen nodes among them — all resolve to an element in the document
 *      built from the new ontology.
 *   5. On a CURATED build, where the operator's menu means some entities get no
 *      screen at all, the exemption is the build's own `coverageGaps`
 *      declaration and it is checked BOTH ways: an entity that is not declared
 *      must have its screen rendered, and an entity that IS declared must
 *      render nothing at all. An allow-list nobody checks becomes a place to
 *      hide things (see noLiteralControlBytes.test.ts for the same pattern).
 *
 * WHAT THIS DELIBERATELY DOES NOT BLESS. On a curated build the entities the
 * drill-through closure reaches get a detail screen but no list and no form, so
 * their `screen:{s}:list` and `field:` nodes have no element and nothing
 * declares that — a narrower miss than the one fixed here, still open, and NOT
 * asserted as acceptable anywhere below.
 *
 * Read off the PARSED, SCRIPTED document, never a regex over the assembler's
 * source: the build ships its records as data and draws the regions at load, so
 * a source grep measures the island rather than the screen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric, type FabricKind, type FabricNode } from "@shared/fabric.ts";
import { diffFabric } from "@/v3/lib/fabricDelta";
import { renderedDoc } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

/**
 * A SECOND ONTOLOGY FROM ANOTHER DOMAIN, so nothing below can be a property of
 * one CRM's shape. Three entities, all three cardinalities, and an atlas with a
 * workflow — enough that all five node kinds exist in its fabric too.
 */
const depot = {
  entities: [
    { name: "Depot", attributes: ["id", "name", "region", "status"] },
    { name: "Shipment", attributes: ["id", "reference", "status", "depotId"] },
    { name: "Carrier", attributes: ["id", "name"] },
  ],
  relations: [
    { from: "Depot", to: "Shipment", cardinality: "1:N" },
    { from: "Carrier", to: "Shipment", cardinality: "N:M" },
  ],
} as unknown as Record<string, unknown>;
const depotAtlas = {
  workflows: [{
    name: "Late Shipment Triage", owner: "Depot Supervisor",
    steps: [{ action: "Read the late shipment", actor: "Depot Supervisor", entities: ["Shipment", "Depot"] }],
  }],
} as unknown as Record<string, unknown>;

/**
 * THE CONTRACT, PER KIND — what element the document must carry for a node of
 * that kind. The map is the enumeration: a kind absent from it is a kind whose
 * rendering nobody has decided, and the first test refuses to let one exist.
 */
const CONTRACT: Record<FabricKind, string> = {
  screen: "the `.m-screen` section the router addresses for that entity",
  region: "an element carrying its id, which the renderer fills with the records",
  field: "an element carrying its id on that entity's form",
  nav: "an element carrying its id holding the link to the parent record",
  flow: "an element carrying its id on the workbench of the role that owns the workflow",
};

const idsIn = (html: string) => new Set([...html.matchAll(/data-fabric-id="([^"]+)"/g)].map((m) => m[1]));

interface Build { html: string; nodes: FabricNode[]; served: Set<string>; doc: Document; gaps: string[] }
const build = (o: Record<string, unknown>, a: Record<string, unknown>, parents?: string[]): Build => {
  const { html, coverageGaps } = assemblePrototype(o, a, parents);
  return { html, nodes: deriveFabric(o, a).nodes, served: idsIn(html), doc: renderedDoc(html), gaps: coverageGaps };
};

/**
 * THE ENTITY WHOSE SCREEN CARRIES THIS NODE — read off the node's own `source`,
 * never rebuilt from the id's spelling. A region declared by a relation belongs
 * to the parent whose detail lists the children; a `nav` belongs to the child
 * whose detail links up to the parent. That asymmetry is the fabric's, and
 * getting it backwards is the defect `deriveFabric`'s own comment records.
 */
const ownerOf = (n: FabricNode): string =>
  n.source.entity ?? (n.kind === "nav" ? n.source.relation?.[1] : n.source.relation?.[0]) ?? "";

const uncurated = build(ontology, atlas);
const other = build(depot, depotAtlas);

describe("every node kind has a declared rendering contract", () => {
  it("the fabric emits no kind this guard has not been told about", () => {
    // MUTATION: add a kind to `deriveFabric` (or delete an entry here) → RED.
    // This is what makes the coverage below total rather than a list of the
    // kinds somebody remembered.
    const kinds = (b: Build) => [...new Set(b.nodes.map((n) => n.kind))].sort();
    const declared = Object.keys(CONTRACT).sort();
    expect(kinds(uncurated), "a kind with no declared contract").toEqual(declared);
    expect(kinds(other), "the second ontology emits a different set of kinds").toEqual(declared);
  });
});

describe("the uncurated build renders every node of every kind", () => {
  for (const [label, b] of [["the snapshot ontology", uncurated], ["a depot ontology", other]] as const) {
    it(`${label}: no kind is silently unrendered, and nothing is exempt`, () => {
      // THE PROPERTY THE `screen` KIND FAILED. Grouped by kind so the failure
      // names the kind that stopped rendering rather than one node of it.
      //
      // MUTATION: drop `data-fabric-id` from the detail `<section>` → RED, 33
      // screen nodes missing on the snapshot. Same for the region wrapper, the
      // nav slot, the form field or the flow region.
      const perKind = new Map<FabricKind, { total: number; missing: string[] }>();
      for (const n of b.nodes) {
        const e = perKind.get(n.kind) ?? { total: 0, missing: [] };
        e.total += 1;
        // SERVED, not merely rendered: the delta and the refine post-condition
        // read the bytes, before any script has run.
        if (!b.served.has(n.id)) e.missing.push(n.id);
        perKind.set(n.kind, e);
      }
      const unrendered = [...perKind].filter(([, v]) => v.missing.length)
        .map(([k, v]) => `${k}: ${v.missing.length} of ${v.total} unrendered (${v.missing.slice(0, 3).join(", ")})`);
      expect(unrendered, `fabric nodes with no element:\n${unrendered.join("\n")}`).toEqual([]);
      // NON-VACUITY: every kind is really exercised here, so "no missing" is a
      // statement about nodes rather than about an empty fixture.
      for (const kind of Object.keys(CONTRACT) as FabricKind[]) {
        expect(perKind.get(kind)?.total ?? 0, `the fixture emits no ${kind} node`).toBeGreaterThan(0);
      }
      // An uncurated build shows the whole ontology, so there is no legitimate
      // exemption on this path at all. Stated as an assertion so a future fix
      // cannot buy coverage by widening an allow-list.
      expect(b.nodes.filter((n) => !b.served.has(n.id)).length, "an uncurated build exempts nothing").toBe(0);
    });

    it(`${label}: the renderer neither drops nor invents an id`, () => {
      // MUTATION: have the renderer replace a region's wrapper instead of its
      // innerHTML → RED. The served skeleton and the live tree are one set.
      const rendered = new Set([...b.doc.querySelectorAll("[data-fabric-id]")].map((el) => el.getAttribute("data-fabric-id")!));
      expect([...rendered].sort()).toEqual([...b.served].sort());
    });
  }
});

describe("a screen node's element is that entity's screen", () => {
  it("resolves to the section the router addresses, and that section names the entity", () => {
    // "Has a rendering" is satisfied by an id parked on any element. What must
    // be TRUE is that the element is the screen: the one the hash router shows
    // (`data-screen="detail-account"`), carrying the entity's own name.
    //
    // MUTATION: move the attribute to a `<div>` outside the section, or point
    // the detail id at the list section → RED.
    const screens = uncurated.nodes.filter((n) => n.kind === "screen");
    expect(screens.length, "the fixture emits no screen nodes").toBeGreaterThan(20);
    const wrong: string[] = [];
    let details = 0;
    let lists = 0;
    for (const n of screens) {
      const [, entitySlug, tail] = n.id.split(":");
      const address = tail === "list" ? `list-${entitySlug}` : `detail-${entitySlug}`;
      if (tail === "list") lists += 1; else details += 1;
      const el = uncurated.doc.querySelector(`[data-fabric-id="${n.id}"]`);
      if (!el) { wrong.push(`${n.id}: no element`); continue; }
      const section = el.closest(".m-screen");
      if (!section) { wrong.push(`${n.id}: its element is not on or inside a screen`); continue; }
      if (section.getAttribute("data-screen") !== address) {
        wrong.push(`${n.id}: sits on screen "${section.getAttribute("data-screen")}", not "${address}"`);
        continue;
      }
      const name = String(n.source.entity ?? "");
      if (!(section.textContent ?? "").includes(name)) wrong.push(`${n.id}: screen "${address}" never names ${name}`);
    }
    expect(wrong, `screen nodes not resolving to their screen:\n${wrong.join("\n")}`).toEqual([]);
    // Both halves of the pair are exercised — the detail node is the one that
    // was missing, so a fix that covered only lists must not read as coverage.
    expect(details, "no detail screen node was examined").toBeGreaterThan(0);
    expect(lists, "no list screen node was examined").toBeGreaterThan(0);
  });
});

describe("the delta resolves against the document", () => {
  it("every id an ontology change moves is an address the new build carries", () => {
    // WHY THIS IS THE POINT OF `data-fabric-id`. `diffFabric` answers "what
    // moved"; the answer is only actionable if each id it names can be found in
    // the document. Adding an entity and a relation moves screen nodes — the
    // parent's detail gains a child region, and the new entity brings its own
    // pair — so this case would have failed before the fix.
    const grown = {
      entities: [...(depot.entities as unknown[]), { name: "Pallet", attributes: ["id", "code", "shipmentId"] }],
      relations: [...(depot.relations as unknown[]), { from: "Shipment", to: "Pallet", cardinality: "1:N" }],
    } as unknown as Record<string, unknown>;
    const after = build(grown, depotAtlas);
    const delta = diffFabric(deriveFabric(depot, depotAtlas), deriveFabric(grown, depotAtlas));
    const moved = [...delta.added, ...delta.changed.map((c) => c.after)];
    expect(moved.some((n) => n.kind === "screen"), "the change moved no screen node — pick a change that does").toBe(true);
    const unaddressable = moved.filter((n) => !after.served.has(n.id)).map((n) => `${n.kind} ${n.id}`);
    expect(unaddressable, `delta ids with no element to resolve against:\n${unaddressable.join("\n")}`).toEqual([]);
  });
});

describe("a curated build declares the entities it does not render", () => {
  /** The operator's menu; the closure adds whatever these relate to. */
  const curated = build(ontology, atlas, ["Account", "Opportunity"]);
  const names = (ontology.entities as Array<{ name: string }>).map((e) => e.name);
  /** The build's own declaration, matched by the entity it names first. */
  const declared = names.filter((n) => curated.gaps.some((g) => g.startsWith(`${n} has no screen`)));
  const kept = names.filter((n) => !declared.includes(n));
  /** This entity's detail-screen node, found through the fabric's `source`
   *  rather than by re-spelling the slug the assembler used. */
  const detailNode = (name: string) =>
    curated.nodes.find((n) => n.kind === "screen" && n.source.entity === name && !n.id.endsWith(":list"));

  it("every entity the build keeps has its screen node addressable", () => {
    // The exemption is the build's own declaration, and this is the half that
    // stops it swallowing everything: an entity that is NOT declared must be
    // rendered, screen node included.
    //
    // MUTATION: drop `data-fabric-id` from the detail section → RED here too,
    // on the path the operator actually ships.
    expect(kept.length, "the curated fixture kept nothing").toBeGreaterThan(5);
    expect(declared.length, "the curated fixture declared nothing — it exempts nothing, so it proves nothing").toBeGreaterThan(0);
    const missing = kept.filter((n) => !curated.served.has(detailNode(n)?.id ?? ""));
    expect(missing, `entities rendered but with no addressable screen node:\n${missing.join(", ")}`).toEqual([]);
  });

  it("every declared entity is really absent, so the exemption cannot rot", () => {
    // An allow-list nobody checks becomes a place to hide things. If a declared
    // entity starts rendering, the declaration is a lie and this goes RED — the
    // entry has to go.
    const rot = declared.map((name) => {
      const rendered = curated.nodes.filter((n) => ownerOf(n) === name && curated.served.has(n.id));
      return rendered.length ? `${name}: declared absent, yet ${rendered.length} of its nodes render (${rendered[0].id})` : "";
    }).filter(Boolean);
    expect(rot, `stale coverage declarations:\n${rot.join("\n")}`).toEqual([]);
    expect(declared.length, "nothing was declared, so nothing was checked").toBeGreaterThan(0);
    // …and each declared entity really owns nodes, so the loop above examined
    // something. An entity the fabric never mentions would pass it for free.
    const ownerless = declared.filter((name) => !curated.nodes.some((n) => ownerOf(n) === name));
    expect(ownerless, `declared entities the fabric holds no node for:\n${ownerless.join(", ")}`).toEqual([]);
  });
});
