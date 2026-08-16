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

describe("every fabric node has a rendering", () => {
  it("emits a data-fabric-id for every region and nav node", () => {
    // THE property that keeps the rest honest: a node the assembler forgets is
    // a silent hole. `nav` nodes were exactly that — derived, then unrendered.
    const missing = fabric.nodes
      .filter((n) => n.kind === "region" || n.kind === "nav")
      .filter((n) => !html.includes(`data-fabric-id="${n.id}"`))
      .map((n) => `${n.kind} ${n.id}`);
    expect(missing, `fabric nodes with no rendering:\n${missing.join("\n")}`).toEqual([]);
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

describe("an N:1 renders a LINK to the parent", () => {
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
