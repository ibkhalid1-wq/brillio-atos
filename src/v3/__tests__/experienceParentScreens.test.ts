/**
 * EXPERIENCE DESIGN DECIDES THE PROTOTYPE'S MENU.
 *
 * The studio was a screen designer — a palette, a device canvas, blocks dragged into
 * regions. Drawing a screen by hand is not the decision that movement exists to take:
 * the assembler already builds a list, a detail and the related collections for any
 * entity. What it could not know is which entities belong in the NAVIGATION.
 *
 * So there is now one decision (`parentEntities`) and one reader of it. These pin the
 * two halves that must agree — the studio's definition of "chosen" and the
 * assembler's definition of "the menu" — because a toggle that does not move a menu
 * item is the whole feature failing quietly.
 */
import { describe, it, expect } from "vitest";
import { experienceParentEntities, readEntityChoices } from "@/v3/components/flow/studio/ExperienceDesignStudio";
import { navigationFor } from "@shared/prototypeAssembly.ts";

describe("what the operator chose", () => {
  it("reads the chosen entities, in their order — order is menu order", () => {
    expect(experienceParentEntities({ parentEntities: ["Opportunity", "Account"] }))
      .toEqual(["Opportunity", "Account"]);
  });

  it("dedupes, trims, and drops the empties", () => {
    expect(experienceParentEntities({ parentEntities: ["Account", " Account ", "", "  ", "Lead"] }))
      .toEqual(["Account", "Lead"]);
  });

  it("falls back to a legacy document's screens, so old work still names a menu", () => {
    // A programme authored in the old designer has `screens`, not `parentEntities`.
    // It must not come back with an empty navigation.
    expect(experienceParentEntities({
      screens: [{ entities: ["Account", "Contact"] }, { entities: ["Contact", "Invoice"] }],
    })).toEqual(["Account", "Contact", "Invoice"]);
  });

  it("prefers the explicit choice over the legacy screens", () => {
    expect(experienceParentEntities({
      parentEntities: ["Lead"],
      screens: [{ entities: ["Account", "Contact"] }],
    })).toEqual(["Lead"]);
  });

  it("is empty for a document that has neither", () => {
    expect(experienceParentEntities({})).toEqual([]);
    expect(experienceParentEntities(null)).toEqual([]);
  });
});

describe("the entities the studio offers", () => {
  const program = {
    rawData: { data: { domainOntology: {
      entities: [
        { name: "Account", area: "Sales", definition: "A client", attributes: ["name", "arr"] },
        { name: "Opportunity", area: "Sales", attributes: ["stage"] },
        { name: "LineItem", attributes: [] },
        { name: "", attributes: [] },
      ],
      relations: [
        { from: "Account", to: "Opportunity", relation: "produces" },
        { from: "Opportunity", to: "LineItem", relation: "contains" },
        { from: "Opportunity", to: "Ghost", relation: "points at nothing" },
        { from: "Account", to: "Account", relation: "self" },
      ],
    } } },
  } as never;

  it("names every entity, and resolves relations BOTH ways", () => {
    const out = readEntityChoices(program);
    expect(out.map((e) => e.name)).toEqual(["Account", "Opportunity", "LineItem"]);   // "" dropped
    const acc = out.find((e) => e.name === "Account")!;
    expect(acc.related).toEqual(["Opportunity"]);       // what its detail can show
    expect(acc.parents).toEqual([]);                    // nothing owns it
    const li = out.find((e) => e.name === "LineItem")!;
    expect(li.parents).toEqual(["Opportunity"]);        // it sits under something
    expect(li.related).toEqual([]);
  });

  it("ignores a relation to an entity the ontology does not hold, and self-relations", () => {
    // A dangling `to` would otherwise offer a related tab pointing at nothing.
    const opp = readEntityChoices(program).find((e) => e.name === "Opportunity")!;
    expect(opp.related).toEqual(["LineItem"]);          // "Ghost" gone
    expect(readEntityChoices(program).find((e) => e.name === "Account")!.related).not.toContain("Account");
  });

  it("returns nothing when there is no ontology, rather than inventing entities", () => {
    expect(readEntityChoices({ rawData: { data: {} } } as never)).toEqual([]);
    expect(readEntityChoices(null)).toEqual([]);
  });
});

describe("the menu the prototype builds", () => {
  const KNOWN = ["Account", "Opportunity", "LineItem"];
  const DERIVED = ["Opportunity", "Account", "LineItem"];

  it("IS the operator's choice, in their order", () => {
    // MUTATION: return `derived` unconditionally → the toggle does nothing, which is
    // the whole feature failing quietly.
    expect(navigationFor(["Account", "Opportunity"], DERIVED, KNOWN)).toEqual(["Account", "Opportunity"]);
  });

  it("falls back to the derived order when nobody has chosen", () => {
    // An uncurated programme still assembles exactly as it did before.
    expect(navigationFor([], DERIVED, KNOWN)).toEqual(DERIVED);
    expect(navigationFor(undefined, DERIVED, KNOWN)).toEqual(DERIVED);
  });

  it("drops a chosen entity the ontology no longer holds", () => {
    // A regenerated ontology can retire an entity. A stale name must not mint a menu
    // item pointing at a screen that was never built.
    expect(navigationFor(["Account", "Retired"], DERIVED, KNOWN)).toEqual(["Account"]);
  });

  it("falls back rather than returning an empty menu when every choice is stale", () => {
    // The alternative is a prototype with no navigation at all.
    expect(navigationFor(["Retired", "Gone"], DERIVED, KNOWN)).toEqual(DERIVED);
  });
});
