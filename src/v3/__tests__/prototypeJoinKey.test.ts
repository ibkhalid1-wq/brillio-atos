/**
 * THE JOIN KEY IS THE RELATION'S, NOT A STRING THE READER GUESSED.
 *
 * The seeder wrote a child's foreign key and the assembler read it back, and
 * neither asked the other how it was spelled: both rebuilt
 * `entity.toLowerCase() + "Id"` independently. That is a convention being
 * reconstructed twice, not a key, and it fails the moment an entity has two
 * words in its name — `Alliance Partner` gives `alliance partnerId`, a column
 * name with a space in it, which is not an identifier in any schema the
 * prototype claims to be showing, and which anything spelling the convention
 * even slightly differently matches zero rows of. The parent then renders "0"
 * children with the children sitting right there in the seed.
 *
 * The fabric now carries the key on the region that DECLARES the relation, and
 * `joinKeyFor` is the one definition both sides use.
 *
 * WHAT IS PINNED HERE IS THE PROPERTY, not the spelling: the key the reader
 * uses is a key the writer actually wrote, the rendered children are exactly
 * the seeded children, and the count on the badge is the true one.
 *
 * MUTATIONS THAT MUST GO RED:
 *   1. assembler → `String(c[`${name.toLowerCase()}Id`])` instead of `n.joinKey`
 *   2. seeder    → `rec[pName.toLowerCase() + "Id"]` instead of `joinKeyFor`
 */
import { describe, it, expect } from "vitest";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed } from "@shared/seedData.ts";
import { renderedDoc } from "./helpers/renderPrototype";

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });

/** Multi-word entities on BOTH sides of a relation, plus a single-word control. */
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

const fabric = deriveFabric(ontology, {});
const seed = generateSeed(ontology, fabric.version);
const html = assemblePrototype(ontology, {}).html;

/**
 * READ THE RENDERED DOM, NOT THE SOURCE STRING. The review that produced this
 * work recorded two false readings from regexes over markup — one matched prose
 * and reported a feature present, one looked for `class="` in HTML that used
 * single quotes and reported it absent. Parsing and querying cannot make either
 * mistake, and it proves the output is well-formed on the way past.
 *
 * The page's own script is RUN before anything is read. The build ships its
 * records as a data island and draws the rows from it at load, so a document
 * that is merely parsed shows empty region wrappers — and every assertion
 * below about which children a record has would pass with the join key
 * string-guessed again.
 */
const doc = renderedDoc(html);
const regionEl = (id: string): Element | null => doc.querySelector(`[data-fabric-id="${id}"]`);
const badgeOf = (el: Element | null): number => Number(el?.querySelector(".m-badge")?.textContent ?? "-1");
/** The record ids a rendered table shows, read out of its sub-cells. */
const idsIn = (el: Element | null): string[] =>
  [...(el?.querySelectorAll("tbody tr") ?? [])].map((tr) => tr.querySelector(".m-cell-sub")?.textContent ?? "");

describe("the key the reader uses is the key the writer wrote", () => {
  it("every collection region and every parent nav carries a join key", () => {
    // A node with no key is a relation the renderer cannot resolve at all — the
    // silent-zero case, which is exactly what this item removes.
    const needsKey = fabric.nodes.filter((n) => (n.kind === "region" && n.role === "collection") || n.kind === "nav");
    expect(needsKey.length, "the fixture stopped producing collections and navs").toBeGreaterThan(2);
    for (const n of needsKey) expect(n.joinKey, `${n.kind} ${n.id} carries no join key`).toBeTruthy();
  });

  it("that key is a legal identifier — never a column name with a space in it", () => {
    for (const n of fabric.nodes) {
      if (!n.joinKey) continue;
      expect(n.joinKey, `${n.id} → "${n.joinKey}"`).toMatch(/^[a-z][A-Za-z0-9]*Id$/);
    }
    // …and the seeder agrees, on the rows themselves.
    for (const rows of Object.values(seed.records)) {
      for (const k of Object.keys(rows[0] ?? {})) {
        if (!k.endsWith("Id") || k === "id") continue;
        expect(k, `the seed wrote the column "${k}"`).toMatch(/^[a-z][A-Za-z0-9]*Id$/);
      }
    }
  });

  it("the key the fabric declares is present on the child's own rows", () => {
    // THE PROPERTY. Not "the key equals some expected string" — that would pass
    // while both sides drifted together somewhere new. The reader's key must be
    // a key the writer actually put on the rows it points at.
    for (const n of fabric.nodes) {
      if (n.kind !== "region" || n.role !== "collection" || !n.joinKey) continue;
      const child = n.source.relation?.[1] ?? "";
      const rows = seed.records[child] ?? [];
      expect(rows.length, `${child} seeded nothing`).toBeGreaterThan(0);
      const carrying = rows.filter((r) => r[n.joinKey!] != null);
      expect(carrying.length, `no ${child} row carries "${n.joinKey}" — the reader's key finds nothing`).toBeGreaterThan(0);
    }
  });
});

describe("a multi-word entity renders its children", () => {
  const id = "region:alliance-partner:joint-deal";

  it("shows a non-empty count and non-empty rows", () => {
    // MUTATION 1 or 2 → RED. Under the old string-built key this region read
    // "0" with ~100 deals in the seed, because `alliance partnerId` matched
    // nothing the seeder had written (or, once it did, was not a column name).
    const el = regionEl(id);
    expect(el, "the collection region is missing entirely").toBeTruthy();
    expect(el!.querySelector("table"), "a collection must render as a table").toBeTruthy();
    expect(badgeOf(el), "the multi-word parent shows no children").toBeGreaterThan(0);
    expect(idsIn(el).length, "the table rendered no rows").toBeGreaterThan(0);
  });

  it("shows exactly the seeded children of the record on screen, and counts them truthfully", () => {
    const el = regionEl(id);
    const shownIds = idsIn(el);
    const deals = seed.records["Joint Deal"] ?? [];
    const partnerIds = new Set((seed.records["Alliance Partner"] ?? []).map((p) => String(p.id)));
    // DISCOVER THE WRITER'S KEY FROM THE DATA — the column whose values are
    // Alliance Partner ids — rather than naming it here. Spelling it out would
    // make this test agree with the implementation by construction, which is
    // the failure mode the whole item is about.
    const fkOf = (d: Record<string, unknown>) =>
      Object.entries(d).find(([k, v]) => k !== "id" && typeof v === "string" && partnerIds.has(v))?.[0];
    const keys = new Set(deals.map(fkOf));
    expect(keys.size, `the seed writes ${keys.size} different parent columns: ${[...keys].join(", ")}`).toBe(1);
    const fk = [...keys][0]!;

    // Which parent is on screen: read it back from the rows the page rendered,
    // rather than re-deriving the showcase pick here.
    const parents = new Set(deals.filter((d) => shownIds.includes(String(d.id))).map((d) => String(d[fk])));
    expect(parents.size, "the rendered rows do not share one parent").toBe(1);
    const expected = deals.filter((d) => String(d[fk]) === [...parents][0]);
    expect(shownIds).toEqual(expected.slice(0, 5).map((d) => String(d.id)));
    expect(badgeOf(el), "the badge disagrees with the seed").toBe(expected.length);
  });

  it("the single-word control behaves identically — the fix is general", () => {
    const el = regionEl("region:alliance-partner:contact");
    expect(el).toBeTruthy();
    expect(badgeOf(el)).toBeGreaterThan(0);
    expect(idsIn(el).length).toBeGreaterThan(0);
  });
});

describe("the parent link resolves through the same key", () => {
  it("a multi-word parent's link card names a real record, not a dash", () => {
    // MUTATION 1 → RED here too: `nd.joinKey` reverted to the string build
    // leaves every N:1 link card reading "—" on a multi-word parent.
    const nav = fabric.nodes.find((n) => n.kind === "nav" && n.id === "nav:joint-deal:alliance-partner");
    expect(nav, "the fixture stopped producing the parent nav").toBeTruthy();
    const el = regionEl(nav!.id);
    expect(el, "the parent nav renders nothing").toBeTruthy();
    expect(el!.querySelector("button")?.getAttribute("onclick")).toBe("show('detail-alliance-partner')");
    const value = el!.querySelector(".m-linkcard-v")?.textContent ?? "";
    expect(value, "the parent link resolved to nothing").not.toBe("—");
    expect(value.length).toBeGreaterThan(0);
    // …and it names a partner that really exists.
    const partners = seed.records["Alliance Partner"] ?? [];
    expect(partners.some((p) => [p.partner_name, p._display, p.id].map(String).includes(value)),
      `the link card says "${value}", which is no seeded record`).toBe(true);
  });
});

describe("determinism survives the key change", () => {
  it("assembles byte-identically twice", () => {
    expect(assemblePrototype(ontology, {}).html).toBe(html);
    expect(deriveFabric(ontology, {}).version).toBe(fabric.version);
  });
});
