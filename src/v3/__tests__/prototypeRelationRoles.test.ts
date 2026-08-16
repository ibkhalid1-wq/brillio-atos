/**
 * THE PROTOTYPE MUST SAY WHAT THE ONTOLOGY SAID.
 *
 * `relationshipRolesFor` already maps cardinality to three distinct roles —
 * 1:N → `collection`, N:M → `multi-select`, N:1 / 1:1 → `parent-ref` — and
 * `deriveFabric` files them into region and nav nodes accordingly. The
 * assembler then threw the distinction away: it selected child regions by ID
 * PREFIX and rendered every one as the same `<dl>` of id/name pairs, and it
 * read `kind === "nav"` zero times. Measured on the source before the fix:
 * occurrences of `.role` → 0, occurrences of `kind === "nav"` → 0.
 *
 * So a one-to-many did not render as a list, a many-to-many was
 * indistinguishable from it, and a reference relation rendered nothing at all.
 *
 * These pin the CONTRACT BETWEEN THE FABRIC AND THE DOM: every node the fabric
 * emits has a rendering, and the rendering matches the role. That is the check
 * whose absence let three separate drops ship unnoticed — assert it here, per
 * node, rather than trusting a reading of the assembler.
 */
import { describe, it, expect } from "vitest";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { renderedDoc } from "./helpers/renderPrototype";

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });

/** One ontology carrying all three cardinalities at once. */
const ontology = {
  entities: [
    ent("Account", ["id", "name", "region"]),
    ent("Opportunity", ["id", "name", "stage", "accountId"]),
    ent("Contact", ["id", "name", "accountId"]),
    ent("Campaign", ["id", "name"]),
    ent("Invoice", ["id", "ref", "accountId"]),
  ],
  relations: [
    { from: "Account", to: "Opportunity", cardinality: "1:N" },   // → collection
    { from: "Account", to: "Contact", cardinality: "1:N" },       // → collection
    { from: "Account", to: "Invoice", cardinality: "1:N" },       // → collection
    { from: "Campaign", to: "Account", cardinality: "N:M" },      // → multi-select
  ],
};

const html = assemblePrototype(ontology, {}).html;
const fabric = deriveFabric(ontology, {});
/**
 * THE PAGE AS A BROWSER HAS IT. The assembler ships the seed as data and draws
 * each region's contents at load, so slicing the served markup between two
 * `data-fabric-id`s — which is what this file used to do — now reads an empty
 * wrapper and would pass with every renderer deleted. The document is parsed
 * and its script is RUN, and the assertions below read the tree.
 */
const doc = renderedDoc(html);

/** The markup of one region, by its fabric id — its own subtree, no sibling's. */
const regionHtml = (id: string): string =>
  doc.querySelector(`[data-fabric-id="${id}"]`)?.outerHTML ?? "";

/**
 * A SECOND ONTOLOGY, SHAPED SO THE JUNCTION CLAIM CANNOT BE VACUOUS.
 *
 * The claim below is that the non-owning side of a many-to-many gets NO
 * "Belongs to" card. Asked of the ontology above, that is a question about a
 * band which does not exist: Account is the root there and has no parent at
 * all, so "no card names Campaign" would pass with the whole link-card renderer
 * deleted — the exact shape of vacuity that let the previous version of this
 * file certify the defect.
 *
 * Here Account has BOTH: one real parent (Region, 1:N) and one membership
 * (Campaign, N:M). So the band exists and is rendered, and the assertion is
 * that it holds the parent and ONLY the parent.
 */
const mixed = {
  entities: [
    ent("Region", ["id", "name"]),
    ent("Account", ["id", "name", "regionId"]),
    ent("Campaign", ["id", "name"]),
  ],
  relations: [
    { from: "Region", to: "Account", cardinality: "1:N" },     // Account belongs to ONE Region
    { from: "Campaign", to: "Account", cardinality: "N:M" },   // …and is a member of MANY Campaigns
  ],
};
const mixedFabric = deriveFabric(mixed, {});
const mixedDoc = renderedDoc(assemblePrototype(mixed, {}).html);

/** Every relation pair the graph settled as a many-to-many, both directions —
 *  a junction is symmetric, so neither side may be claimed as the other's one
 *  parent. */
const junctionPairs = (f: typeof fabric): Set<string> =>
  new Set(f.graph.junctions.flatMap((j) => [`${j.from}>${j.to}`, `${j.to}>${j.from}`]));

describe("every fabric node has a rendering", () => {
  it("emits a data-fabric-id for every node, of every kind", () => {
    // THE property that keeps the rest honest: a node the assembler forgets is
    // a silent hole. `nav` nodes were exactly that — derived, then unrendered.
    //
    // THIS USED TO FILTER TO `region` AND `nav`, and that filter was itself a
    // hole: the `screen` kind was covered by nothing here or anywhere else, and
    // 33 of the snapshot's 66 screen nodes had no element in the document. No
    // kind is exempt now, and the total contract — per kind, on two ontologies,
    // and with the curated build's declared exemptions checked both ways —
    // lives in prototypeFabricDomFidelity.test.ts.
    const missing = fabric.nodes
      .filter((n) => !html.includes(`data-fabric-id="${n.id}"`))
      .map((n) => `${n.kind} ${n.id}`);
    expect(missing, `fabric nodes with no rendering:\n${missing.join("\n")}`).toEqual([]);
    expect(new Set(fabric.nodes.map((n) => n.kind)).size, "the fixture stopped emitting several kinds").toBeGreaterThan(3);
  });
});

describe("a 1:N renders as a LIST of the child entity", () => {
  const id = `region:account:opportunity`;

  it("is a table, not a definition list of ids", () => {
    // MUTATION: restore the `<dl>` renderer → RED. This is the reported bug.
    const r = regionHtml(id);
    expect(r, "the collection region is missing").toBeTruthy();
    expect(r).toContain("<table");
    expect(r).not.toContain('<div class="m-dl">');
  });

  it("is headed the way that entity's OWN list screen heads it", () => {
    // One definition of the lead columns, so a collection and its list screen
    // cannot disagree about what an Opportunity looks like.
    const r = regionHtml(id);
    expect(r).toContain("Stage");                    // a real Opportunity column
    expect(r).not.toContain("Account Id");           // the FK is not a column
  });

  it("carries the true total", () => {
    // The title used to promise "and offers the rest", asserted behind
    // `if (badge > 5)` — which NEVER RAN, and hid a real defect while looking
    // like coverage.
    //
    // THE DEFECT IT HID: the seeder's default `maxFanOut` is 5 and the detail
    // page shows `all.slice(0, 5)`, offering "View all N" only when there are
    // MORE than five. The two numbers are equal, so on a default build the
    // overflow branch is unreachable and that control can never render. Raising
    // the fan-out to 6 was tried and the badge still came back 5, so something
    // further caps it — recorded here rather than half-fixed, because a seed
    // change moves every generated build and this one is not yet understood.
    //
    // What IS true is asserted; the unreachable claim is not.
    const r = regionHtml(id);
    const badge = Number(r.match(/<span class="m-badge">(\d+)<\/span>/)?.[1]);
    expect(badge, "no opportunities reached the card").toBeGreaterThan(0);
    const rows = [...doc.querySelectorAll(`[data-fabric-id="${id}"] tbody tr`)];
    expect(rows.length, "the badge and the rendered rows disagree")
      .toBe(Math.min(badge, 5));
  });
});

describe("an N:M renders as a SET, distinguishably", () => {
  it("is chips, not a table", () => {
    // MUTATION: render multi-select through the collection branch → RED, and
    // the two cardinalities become indistinguishable again.
    const r = regionHtml("region:campaign:account");
    expect(r, "the multi-select region is missing").toBeTruthy();
    expect(r).not.toContain("<table");
    expect(r).toMatch(/m-chips|m-empty/);
  });

  it("shows real membership — the seeder now generates it", () => {
    // WAS VACUOUS. This asserted the empty state cited an assumption, guarded by
    // `if (r.includes("m-empty"))` — and once A3 made the seeder materialise
    // junction membership that precondition became permanently false, so the
    // test passed while asserting nothing at all. A guard whose body never runs
    // is worse than a missing one: it reports coverage it does not have.
    //
    // The honest assertion for the CURRENT behaviour is that membership is
    // really there. MUTATION: return [] from the junction seeding → RED.
    const r = regionHtml("region:campaign:account");
    expect(r, "the multi-select region is missing").toBeTruthy();
    expect(r).toContain("m-chips");
    const chips = [...doc.querySelectorAll(`[data-fabric-id="region:campaign:account"] .m-chip`)];
    expect(chips.length, "a many-to-many with no members — A3 regressed").toBeGreaterThan(0);
    // and the chips name real Account records, not ids or the seed marker
    expect(chips.every((c) => !/SYNTHETIC|^account-\d+$/i.test((c.textContent || "").trim()))).toBe(true);
  });
});

describe("the nav node is the N:1's, and ONLY the N:1's", () => {
  /**
   * THIS GUARD USED TO CERTIFY THE DEFECT.
   *
   * It walked `kind === "nav"` and asserted each one navigates like a
   * parent-ref — with no opinion about which relations are ENTITLED to a nav.
   * `link()` in deriveFabric pushed a parentRef for every pair, junctions
   * included, so the junction's `nav:account:campaign` was inside that loop and
   * the loop blessed it. The same build then said two contradictory things
   * about one relation: chips naming five linked Accounts on the Campaign side,
   * and a single-parent "Belongs to" card on the Account side — a card that
   * could not even name the parent it claimed, because a `parent-ref` resolves
   * through `joinKey` and a many-to-many owns no FK on either side, so it read
   * "— none named" for a record whose membership shipped in the same document.
   *
   * The claim is now per RELATION KIND, in both directions: an edge earns a
   * nav, a junction earns none, and the junction is still rendered — as a set,
   * on the side that owns the membership.
   */
  it("no junction pair mints a nav — a many-to-many has no single parent", () => {
    for (const [label, f] of [["all-cardinalities", fabric], ["mixed", mixedFabric]] as const) {
      const pairs = junctionPairs(f);
      expect(pairs.size, `${label}: the fixture stopped declaring a junction`).toBeGreaterThan(0);
      const navs = f.nodes.filter((n) => n.kind === "nav");
      expect(navs.length, `${label}: the fixture stopped producing parent-refs`).toBeGreaterThan(0);
      const wrong = navs
        .filter((n) => pairs.has(`${n.source.relation?.[0]}>${n.source.relation?.[1]}`))
        .map((n) => n.id);
      expect(wrong, `${label}: these navs claim a single parent for a many-to-many:\n${wrong.join("\n")}`).toEqual([]);
      // …and the other half of the property: every nav that DOES exist stands
      // for an edge the graph actually settled as one-directional.
      const edges = new Set(f.graph.edges.map((e) => `${e.parent}>${e.child}`));
      for (const n of navs) {
        expect(edges.has(`${n.source.relation?.[0]}>${n.source.relation?.[1]}`),
          `${label}: nav ${n.id} stands for no edge`).toBe(true);
      }
    }
  });

  it("the non-owning side's Belongs-to band holds the parent, and only the parent", () => {
    // THE RENDERED CLAIM, on the fixture built for it: Account has one parent
    // (Region) and one membership (Campaign). MUTATION: make the parentRefs
    // push unconditional again → the band gains a second card reading
    // "Campaign — none named" → RED.
    const cards = [...mixedDoc.querySelectorAll('[data-screen="detail-account"] .m-linkcard-k')]
      .map((e) => (e.textContent ?? "").trim());
    expect(cards, "the band is not the parent and only the parent").toEqual(["Region"]);
    // and it is a real link to a real record — not the empty shell a junction
    // produced, which is how the defect looked from the outside.
    const value = mixedDoc.querySelector('[data-screen="detail-account"] .m-linkcard-v')?.textContent ?? "";
    expect(value.trim(), "the parent card names no record").not.toMatch(/none named/i);
    expect(value.trim().length, "the parent card is empty").toBeGreaterThan(0);
  });

  it("still renders the many-to-many — as a set, on the membership's own side", () => {
    // Dropping the nav must not drop the RELATION. It is rendered once, where
    // the membership table is addressed, and it is chips.
    const el = mixedDoc.querySelector('[data-fabric-id="region:campaign:account"]');
    expect(el, "the multi-select region is missing").toBeTruthy();
    expect(el!.querySelectorAll(".m-chip").length, "the many-to-many renders no members").toBeGreaterThan(0);
    expect(el!.querySelector("table"), "a many-to-many rendered as owned rows").toBeNull();
  });

  it("renders every nav node as a control that navigates to the parent detail", () => {
    // MUTATION: drop the parentNavs block → RED. Before the fix this was the
    // whole of the reference relation's rendering: nothing.
    const navs = fabric.nodes.filter((n) => n.kind === "nav");
    expect(navs.length, "the fixture stopped producing parent-refs").toBeGreaterThan(0);
    for (const n of navs) {
      const parent = n.source.relation?.[0] ?? "";
      const r = regionHtml(n.id);
      expect(r, `nav ${n.id} has no rendering`).toBeTruthy();
      // THE PROPERTY, NOT THE SPELLING. This used to pin the literal
      // `onclick="show('detail-…')"`, which broke the day the application
      // learned to address a RECORD rather than a screen — and would have gone
      // on passing if the link had kept the call and lost the destination.
      // What must be true is that the control goes to an address owned by the
      // parent entity: its record, or its list when this one names no parent.
      const el = doc.querySelector(`[data-fabric-id="${n.id}"]`)!;
      const control = el.querySelector("button,a");
      expect(control, `nav ${n.id} renders no control`).toBeTruthy();
      const target = control!.getAttribute("onclick") ?? control!.getAttribute("href") ?? "";
      const parentSlug = parent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      expect(target, `nav ${n.id} does not navigate to ${parent}`).toMatch(new RegExp(`#${parentSlug}(/|['"]|$)`));
      expect(r).toContain(parent);
    }
  });
});

describe("determinism survives the role switch", () => {
  it("assembles byte-identically twice, and the fabric version is unmoved", () => {
    expect(assemblePrototype(ontology, {}).html).toBe(html);
    expect(deriveFabric(ontology, {}).version).toBe(fabric.version);
  });
});
