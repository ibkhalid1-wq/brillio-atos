/**
 * THE SIDEBAR IS THE OPERATOR'S MENU — NOT THE ONTOLOGY'S.
 *
 * Experience Design's promise is "each entity ON becomes a menu item". The
 * choice (`parentEntities`) reached the SCREENS but never the NAV: the sidebar
 * kept walking every entity in the ontology. Found on the live board — the
 * operator toggled Opportunity ON and it did not appear as its own item under
 * "All records"; it sat nested under its structural parent. Three faults, one
 * omission:
 *
 *   1. an entity switched OFF still got a nav row → a dead click (no screen);
 *   2. an entity switched ON was filed under the structural tree the operator
 *      had just overridden by choosing;
 *   3. `lead` (the opening screen) came from the spine, which could name an
 *      entity outside the choice → the prototype opened on a hidden screen.
 *
 * A curated menu is a FLAT list in the operator's order. An uncurated build
 * keeps the derived spine-and-tree exactly as before.
 */
import { describe, it, expect } from "vitest";
import { assemblePrototype, curatedNavigation, navigationFor } from "@shared/prototypeAssembly.ts";

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });
// >8 entities so the spine/tree split is in play, and Opportunity has parents —
// the live shape in which the fault was found (it is NOT a graph root).
const ontology = {
  entities: [
    ent("Account", ["id", "name"]), ent("Lead", ["id", "name", "accountId"]),
    ent("Activity", ["id", "subject", "accountId"]), ent("Opportunity", ["id", "name", "leadId", "activityId", "accountId"]),
    ent("Contract", ["id", "title", "opportunityId"]), ent("Invoice", ["id", "ref", "contractId"]),
    ent("Order", ["id", "ref", "contractId"]), ent("Product", ["id", "name"]),
    ent("Contact", ["id", "name", "accountId"]), ent("Territory", ["id", "name"]),
  ],
  relations: [
    { from: "Account", to: "Lead" }, { from: "Account", to: "Activity" }, { from: "Account", to: "Contact" },
    { from: "Lead", to: "Opportunity" }, { from: "Activity", to: "Opportunity" },
    { from: "Opportunity", to: "Contract" }, { from: "Contract", to: "Invoice" }, { from: "Contract", to: "Order" },
  ],
};

const navTargets = (html: string) => [...html.matchAll(/data-nav="list-([a-z0-9-]+)"/g)].map((m) => m[1]);
const builtLists = (html: string) => [...html.matchAll(/data-screen="list-([a-z0-9-]+)"/g)].map((m) => m[1]);
const sections = (html: string) => [...html.matchAll(/class="m-nav-sec">([^<]+)</g)].map((m) => m[1]);
const opensOn = (html: string) => html.match(/show\('(list-[a-z0-9-]+)'\)<\/script>/)?.[1];

describe("a curated build", () => {
  const CHOSEN = ["Account", "Lead", "Opportunity", "Contract"];
  const html = assemblePrototype(ontology, {}, CHOSEN).html;

  it("gives every nav item a screen, and every chosen entity a nav item", () => {
    // MUTATION: build the nav from `names` again → six dead rows here.
    expect(navTargets(html)).toEqual(["account", "lead", "opportunity", "contract"]);
    expect(builtLists(html)).toEqual(["account", "lead", "opportunity", "contract"]);
  });

  it("lists a chosen entity as its OWN menu item, not nested under a parent", () => {
    // The live find: Opportunity, toggled ON, did not stand top-level. In a
    // curated menu nothing nests — the structural tree is the IA the operator
    // overrode by choosing. Assert against the MARKUP, not the bare class name:
    // the stylesheet always defines `.m-nav-sub`, so a bare-name check fails on
    // the CSS in every build.
    expect(html).not.toContain('<div class="m-nav-sub">');
    expect(sections(html)).toEqual(["Records"]);
  });

  it("opens on a screen that exists", () => {
    // MUTATION: `lead = graph.spine[0]` unconditionally → a choice that omits
    // the spine's head opens the prototype on a hidden screen.
    const entry = opensOn(html);
    expect(entry).toBeTruthy();
    expect(builtLists(html).map((s) => `list-${s}`)).toContain(entry!);
  });

  it("opens on the FIRST chosen entity — their order is the menu order", () => {
    expect(opensOn(html)).toBe("list-account");
  });
});

describe("an uncurated build keeps the derived IA", () => {
  const html = assemblePrototype(ontology, {}).html;

  it("still splits Primary from All records, with the tree nested", () => {
    expect(sections(html)).toEqual(["Primary", "All records"]);
    expect(html).toContain('<div class="m-nav-sub">');
  });

  it("still builds a screen for every entity", () => {
    expect(builtLists(html).length).toBe(10);
  });
});

describe("curatedNavigation", () => {
  it("is empty when nothing was chosen — the signal navigationFor cannot give", () => {
    // `navigationFor` folds the fallback in, so its output cannot say WHETHER
    // the operator chose. The sidebar needs that distinction; comparing outputs
    // would break the moment a choice equals the derived order.
    expect(curatedNavigation(undefined, ["Account"])).toEqual([]);
    expect(curatedNavigation(["Ghost"], ["Account"])).toEqual([]);
    expect(curatedNavigation(["Account", " Account "], ["Account"])).toEqual(["Account"]);
  });

  it("navigationFor still folds in the fallback for the screens", () => {
    expect(navigationFor(["Ghost"], ["Account"], ["Account"])).toEqual(["Account"]);
  });
});
