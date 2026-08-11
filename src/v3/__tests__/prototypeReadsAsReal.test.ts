/**
 * THE PROTOTYPE IS THE THING A STAKEHOLDER JUDGES US BY.
 *
 * It is labelled "synthetic seed data" and it should be — the honesty is
 * deliberate. But a demo still has to survive a look, and driving the real
 * Laila CRM prototype in the live app turned up four tells that it wouldn't:
 *
 *   1. `BUYINGROLE` as a column head. The ontology stores schema-shaped field
 *      names and the design system upper-cases table heads, so the raw key
 *      showed through: a database column in front of the client.
 *   2. The Owner column read "Northwind onboarding" — an ENGAGEMENT standing
 *      where a person belongs. `owner` did derive a reference role, but the
 *      seed generator had no branch for it, so it fell through to the generic
 *      "<company> <word>" filler.
 *   3. Two adjacent columns held the identical string, because "first
 *      attribute is the title" and "an attribute named title is the
 *      identifier" both generated the same value.
 *   4. Twelve of Laila's 32 entities all reported exactly "120 records" — one
 *      shared cap saturating, printed as if it were a count.
 *
 * None of these is a lie about the client's business; all four are the reasons
 * a demo reads as scaffolding. Each is held below against the REAL ontology
 * shape that produced it.
 */
import { describe, it, expect } from "vitest";
import { humanizeField } from "@shared/prototypeAssembly";
import { deriveRoles } from "@shared/semanticRoles";
import { generateSeed } from "@shared/seedData";

/** A CRM-shaped ontology in the exact shape Laila's is: camelCase attributes,
 *  a person-shaped owner, a title that isn't first, and a deep parent chain. */
const ONTOLOGY = {
  entities: [
    { name: "Account", attributes: ["name", "industry", "owner"] },
    { name: "Contact", attributes: ["buyingRole", "title", "account", "owner"] },
    { name: "Opportunity", attributes: ["dealName", "amount", "closeDate", "owner"] },
    { name: "Quote", attributes: ["quoteName", "amount"] },
    { name: "Contract", attributes: ["contractName", "status"] },
  ],
  relations: [
    { from: "Account", to: "Contact", cardinality: "1:N" },
    { from: "Contact", to: "Opportunity", cardinality: "1:N" },
    { from: "Opportunity", to: "Quote", cardinality: "1:N" },
    { from: "Quote", to: "Contract", cardinality: "1:N" },
  ],
};

const roleFor = (entity: string, attribute: string) =>
  deriveRoles(ONTOLOGY).attributeRoles.find((r) => r.entity === entity && r.attribute === attribute)?.role;

describe("field labels are written for people, not for schemas", () => {
  it("splits camelCase so an upper-casing table head stays legible", () => {
    expect(humanizeField("buyingRole")).toBe("Buying Role");
    expect(humanizeField("closeDate")).toBe("Close Date");
    expect(humanizeField("close_date")).toBe("Close Date");
    // The failing case exactly: uppercased, the raw key is one unreadable run.
    expect(humanizeField("buyingRole").toUpperCase()).toBe("BUYING ROLE");
    expect("buyingRole".toUpperCase()).toBe("BUYINGROLE"); // what shipped
  });

  it("keeps acronyms intact instead of exploding them", () => {
    expect(humanizeField("ARRValue")).toBe("ARR Value");
    expect(humanizeField("id")).toBe("Id");
  });

  it("survives the empty and the already-human", () => {
    expect(humanizeField("")).toBe("");
    expect(humanizeField(null)).toBe("");
    expect(humanizeField("Close date")).toBe("Close date");
  });
});

describe("a person-shaped field gets a person-shaped value", () => {
  it("derives a person reference for owner, not a generic parent reference", () => {
    expect(roleFor("Contact", "owner")).toBe("person-ref");
    // An entity reference is still an entity reference — the split must not
    // swallow the other case.
    expect(roleFor("Contact", "account")).toBe("parent-ref");
  });

  it("puts a name in the Owner column, never an engagement", () => {
    const seed = generateSeed(ONTOLOGY, "v-test");
    const owners = (seed.records.Contact ?? []).map((r) => String(r.owner));
    expect(owners.length).toBeGreaterThan(0);
    // The shipped bug produced "<Company> <activity-word>" — the words are the
    // giveaway, and each one names something that is not a human.
    for (const owner of owners) {
      expect(owner, `"${owner}" is an engagement, not a person`).not.toMatch(
        /\b(onboarding|renewal|migration|audit|assessment|escalation|handoff|rollout|pilot|expansion|review|sync)\b/i,
      );
    }
  });
});

describe("the title column is the title", () => {
  it("names the attribute that reads like a title, not the one listed first", () => {
    expect(roleFor("Contact", "title")).toBe("title");
    expect(roleFor("Contact", "buyingRole")).not.toBe("title");
  });

  it("gives exactly one title per entity", () => {
    const roles = deriveRoles(ONTOLOGY).attributeRoles;
    for (const entity of ONTOLOGY.entities) {
      const titles = roles.filter((r) => r.entity === entity.name && r.role === "title");
      expect(titles, `${entity.name} has ${titles.length} title attributes`).toHaveLength(1);
    }
  });

  it("never prints the same synthetic string into two columns of one row", () => {
    // An entity carrying BOTH roles — `name` is the title, `label` matches the
    // identifier pattern. They used to share one value branch, so both columns
    // rendered the identical string.
    const twoRoles = {
      entities: [{ name: "Account", attributes: ["name", "label", "industry"] }],
      relations: [],
    };
    expect(deriveRoles(twoRoles).attributeRoles.find((r) => r.attribute === "name")?.role).toBe("title");
    expect(deriveRoles(twoRoles).attributeRoles.find((r) => r.attribute === "label")?.role).toBe("identifier");

    const row = (generateSeed(twoRoles, "v-test").records.Account ?? [])[0];
    expect(row).toBeTruthy();
    expect(String(row!.label), "the identifier is a second copy of the title").not.toBe(String(row!.name));

    const shown = Object.entries(row!)
      .filter(([k, v]) => !k.startsWith("_") && k !== "id" && typeof v === "string")
      .map(([, v]) => v as string);
    expect(new Set(shown).size, `duplicate cell values in one row: ${JSON.stringify(shown)}`).toBe(shown.length);
  });
});

describe("record counts are counts, not one shared ceiling", () => {
  it("does not report the identical number for every saturated entity", () => {
    // Laila: 12 of 32 entities all read exactly 120 because one cap bound them
    // all. A low cap forces that saturation deterministically here — with a
    // single shared ceiling every deep entity lands on the same figure, which
    // is precisely the tell.
    const counts = Object.values(generateSeed(ONTOLOGY, "v-test", { maxPerEntity: 30 }).counts).filter((n) => n > 0);
    expect(counts.length).toBeGreaterThan(3);
    const top = Math.max(...counts);
    const atTop = counts.filter((n) => n === top).length;
    expect(atTop, `${atTop} of ${counts.length} entities report the same ceiling (${top})`).toBeLessThan(counts.length - 1);
    // And the ceiling is still a ceiling: nothing exceeds what was asked for.
    expect(top).toBeLessThanOrEqual(30);
  });

  it("stays deterministic — the same version seeds the same counts", () => {
    expect(generateSeed(ONTOLOGY, "v-test").counts).toEqual(generateSeed(ONTOLOGY, "v-test").counts);
  });
});
