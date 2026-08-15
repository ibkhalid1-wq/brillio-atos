/**
 * THE PROTOTYPE SHIPS ITS RECORDS, NOT NINETY-NINE PICTURES OF THEM.
 *
 * Every screen used to be baked markup. On the uncurated snapshot that was 99
 * screens and 536KB of HTML in which every row was a fixed string, one detail
 * page existed per entity, and every control implying state was inert: "Open"
 * on row 12 showed row 1, because row 1's detail was the only detail there was.
 * The document held pictures of records rather than records.
 *
 * It now ships ONE JSON data island and draws each region's contents from it at
 * load. Four things have to be true of that, and each is a way it could quietly
 * fail:
 *
 *   1. THE SKELETON IS STILL SERVED. Every `data-fabric-id` is in the bytes,
 *      before any script runs — `diffFabric` resolves a delta to the regions it
 *      touches by that attribute and the refine post-condition compares id sets,
 *      and neither can be asked to wait for a renderer.
 *   2. THE PAGE ACTUALLY RENDERS. A region whose contents never arrive is a
 *      hole that no source-reading guard can see, which is exactly the class of
 *      defect this file exists for.
 *   3. THE RECORDS ARE ALL THERE. The island has to reconstruct `generateSeed`'s
 *      output exactly — a renderer fed a truncated seed looks perfect and is a
 *      demo of 24 rows.
 *   4. IT IS SMALLER. The claim that made this worth doing is that data plus
 *      templates costs less than the same application baked, and the encoding
 *      is what makes it true.
 *
 * Everything below reads the document AFTER its own script has run, because the
 * served markup can no longer answer for what is on the screen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { generateSeed } from "@shared/seedData.ts";
import { documentText, prototypeBaselineFor, checkRefinedPrototype } from "@shared/prototypeRefine.ts";
import { splitPrototypeHtml } from "@/v3/components/flow/studio/prototypeExport";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

/** A three-entity ontology from another domain, carrying all three relation
 *  kinds — none of the rules below may have learned one build's shape. */
const clinic = {
  entities: [
    { name: "Case", attributes: ["id", "name", "status", "acuity"] },
    { name: "Anesthesia Record", attributes: ["id", "type", "caseId"] },
    { name: "Theatre", attributes: ["id", "label"] },
  ],
  relations: [
    { from: "Case", to: "Anesthesia Record", cardinality: "1:N" },
    { from: "Theatre", to: "Case", cardinality: "N:M" },
  ],
} as unknown as Record<string, unknown>;

const built = assemblePrototype(ontology, atlas);
const loaded = loadPrototype(built.html);
const renderedHtml = loaded.doc.documentElement.outerHTML;

/** The island, as the page reads it. */
const islandOf = (html: string): Record<string, unknown> => {
  const doc = loadPrototype(html).doc;
  const el = doc.getElementById("m-seed");
  expect(el, "the build ships no data island").toBeTruthy();
  return JSON.parse(el!.textContent ?? "{}") as Record<string, unknown>;
};
const island = islandOf(built.html);

/**
 * The three column encodings, undone independently of the renderer. Decoding
 * here rather than reusing the page's own function is the point: two
 * implementations that agree are evidence, one that agrees with itself is not.
 */
type Column = unknown[] | { u: unknown[]; x: number[] } | { p: string; s: string[] };
const decode = (c: Column): unknown[] => {
  if (Array.isArray(c)) return c;
  if ("p" in c) return c.s.map((s) => c.p + s);
  return c.x.map((i) => c.u[i]);
};
interface Table { cols: string[]; c: Column[]; n: number; t: number; d: number; f: number[] }
const tablesOf = (m: Record<string, unknown>) => m.data as Record<string, Table>;

// ── 1 · the skeleton is in the bytes ─────────────────────────────────────────

describe("the region skeleton is served, not rendered", () => {
  it("every region and nav node carries its id in the HTML before any script runs", () => {
    // MUTATION: emit a region only from the renderer → RED here, and the delta
    // contract in fabricDelta.ts silently loses its address.
    const fabric = deriveFabric(ontology, atlas);
    const addressable = fabric.nodes.filter((n) => n.kind === "region" || n.kind === "nav" || n.kind === "field");
    const missing = addressable
      .filter((n) => !built.html.includes(`data-fabric-id="${n.id}"`))
      .map((n) => `${n.kind} ${n.id}`);
    expect(missing, `fabric nodes with no served wrapper:\n${missing.join("\n")}`).toEqual([]);
    expect(addressable.length).toBeGreaterThan(200);
  });

  it("the served ids are exactly the rendered ids — the renderer neither adds nor loses one", () => {
    const served = [...built.html.matchAll(/data-fabric-id="([^"]+)"/g)].map((m) => m[1]).sort();
    const rendered = [...loaded.doc.querySelectorAll("[data-fabric-id]")]
      .map((el) => el.getAttribute("data-fabric-id")!).sort();
    expect(rendered).toEqual(served);
    expect(served.length).toBe(built.regionCount);
  });

  it("ships no baked rows: the tables are the renderer's, all of them", () => {
    // MUTATION: bake the list table server-side again → RED. This is the whole
    // payload claim in one assertion.
    //
    // Parsed WITHOUT running the script and then WITH it: the same document
    // holds no table before and ninety-nine screens' worth after. Grepping the
    // source for "<table" would only find the renderer's own string literals.
    const served = new DOMParser().parseFromString(built.html, "text/html");
    expect(served.querySelectorAll("table").length).toBe(0);
    expect(served.querySelectorAll("tr").length).toBe(0);
    expect(loaded.doc.querySelectorAll("table").length).toBeGreaterThan(20);
    expect(loaded.doc.querySelectorAll("tr").length).toBeGreaterThan(400);
  });
});

// ── 2 · the page renders, and renders everything ─────────────────────────────

describe("every region the fabric declares gets contents", () => {
  for (const [label, on, at] of [
    ["the 33-entity snapshot", ontology, atlas],
    ["a three-entity ontology from another domain", clinic, {} as Record<string, unknown>],
  ] as const) {
    it(`${label}: no rendered region is left empty`, () => {
      // MUTATION: drop `renderKid` (or `renderNav`, or `renderList`) from the
      // renderer → RED, naming every region that came out hollow. A wrapper
      // with nothing in it is invisible to every guard that reads the source.
      const page = assemblePrototype(on as Record<string, unknown>, at as Record<string, unknown>);
      const doc = loadPrototype(page.html).doc;
      const hollow = [...doc.querySelectorAll("[data-fabric-id]")]
        .filter((el) => (el.innerHTML ?? "").trim() === "")
        .map((el) => el.getAttribute("data-fabric-id")!);
      expect(hollow, `regions rendered empty:\n${hollow.join("\n")}`).toEqual([]);
    });
  }

  it("the page's own script throws nothing on the way", () => {
    expect(loaded.consoleErrors).toEqual([]);
  });

  it("and the contents are the right KIND for the relation's role", () => {
    // The role split survives the move to the client: a 1:N is a table, an N:M
    // is chips. Checked on the fixture that carries both.
    const doc = loadPrototype(assemblePrototype(clinic, {}).html).doc;
    const collection = doc.querySelector('[data-fabric-id="region:case:anesthesia-record"]')!;
    const multi = doc.querySelector('[data-fabric-id="region:theatre:case"]')!;
    expect(collection.querySelector("table"), "a 1:N did not render as a list").toBeTruthy();
    expect(multi.querySelector("table"), "an N:M rendered as a table").toBeNull();
    expect(multi.querySelector(".m-chips, .m-empty"), "an N:M rendered neither chips nor a stated gap").toBeTruthy();
  });
});

// ── 3 · the records are all there ────────────────────────────────────────────

describe("the island IS the seed", () => {
  it("reconstructs every shipped entity's records value for value", () => {
    // MUTATION: cap the rows written into the island (`rows.slice(0, 24)`) →
    // RED. A renderer fed a truncated seed looks entirely correct and is a demo
    // of one page.
    const seed = generateSeed(ontology, deriveFabric(ontology, atlas).version);
    const tables = tablesOf(island);
    expect(Object.keys(tables).length).toBeGreaterThan(20);
    for (const [entity, table] of Object.entries(tables)) {
      const rows = seed.records[entity] ?? [];
      expect(table.n, `${entity} ships a different number of records`).toBe(rows.length);
      const columns = table.c.map(decode);
      for (let i = 0; i < rows.length; i += 1) {
        for (let c = 0; c < table.cols.length; c += 1) {
          const expected = rows[i][table.cols[c]];
          expect(columns[c][i], `${entity}[${i}].${table.cols[c]}`).toEqual(expected === undefined ? null : expected);
        }
      }
    }
  });

  it("ships the entities the screens can reach, and no more", () => {
    // A curated build reaches its chosen parents and the children they show;
    // shipping the whole ontology's rows to a four-screen application is data
    // nobody can open.
    const curated = assemblePrototype(ontology, atlas, ["Account"]);
    const shipped = Object.keys(tablesOf(islandOf(curated.html)));
    expect(shipped).toContain("Account");
    expect(shipped.length).toBeLessThan(Object.keys(tablesOf(island)).length);
    expect(curated.html.length).toBeLessThan(built.html.length / 2);
  });

  it("a value in the island reaches the screen", () => {
    // Non-vacuity for the two above: the data is not merely present, it is
    // rendered. Takes a title from a record the page shows and finds it in the
    // rendered text.
    const seed = generateSeed(ontology, deriveFabric(ontology, atlas).version);
    const account = (seed.records.Account ?? [])[1];
    expect(account, "the fixture lost its Accounts").toBeTruthy();
    expect(loaded.doc.body.textContent).toContain(String(account._display));
  });
});

// ── 4 · the document is smaller than the application it draws ────────────────

describe("data plus templates costs less than the same application baked", () => {
  it("the served document is smaller than the document it becomes", () => {
    // MUTATION: bake the screens again → the two converge and this goes RED.
    expect(built.html.length).toBeLessThan(renderedHtml.length);
    // …and not by a rounding error: the served build is the skeleton, the
    // rendered one is the whole application.
    expect(built.html.length).toBeLessThan(renderedHtml.length * 0.85);
  });

  it("the column encoding is what pays for it", () => {
    // Two rungs, because two decisions are being defended and either could be
    // undone on its own:
    //
    //   column-major beats a record per object — the obvious encoding repeats
    //   every key on every row and is 3× the size;
    //
    //   MUTATION: make `encodeColumn` always return the raw array → RED on the
    //   second. Column-major alone still lost to the baked markup it replaced;
    //   stating each column in its shortest form is what turned that around.
    const shipped = JSON.stringify(island.data).length;
    const naive = JSON.stringify(generateSeed(ontology, deriveFabric(ontology, atlas).version).records).length;
    expect(shipped).toBeLessThan(naive / 2);
    const plain = JSON.stringify(Object.entries(tablesOf(island))
      .map(([entity, t]) => [entity, { cols: t.cols, rows: t.c.map(decode) }])).length;
    expect(shipped).toBeLessThan(plain * 0.8);
  });

  it("every column encoding round-trips, whichever one a column got", () => {
    // All three forms are in use on this fixture — a guard that only ever
    // exercised the raw array would pass with the other two broken.
    const forms = new Set<string>();
    for (const table of Object.values(tablesOf(island))) {
      for (const c of table.c) forms.add(Array.isArray(c) ? "raw" : "p" in c ? "prefix" : "dictionary");
    }
    expect([...forms].sort()).toEqual(["dictionary", "prefix", "raw"]);
  });
});

// ── 5 · determinism, and the readers downstream ──────────────────────────────

describe("the same ontology gives the same bytes", () => {
  it("assembles byte-identically, island included", () => {
    const again = assemblePrototype(ontology, atlas);
    expect(again.html).toBe(built.html);
    expect(again.fabric.version).toBe(built.fabric.version);
  });
});

describe("the readers downstream see the island as content", () => {
  it("the refine post-condition counts a seeded value that lives only in the data", () => {
    // MUTATION: strip application/json blocks in `documentText` again → RED.
    // Without this the post-condition reads a document whose tables are empty
    // and concludes the records were never there, which is how a model rewrite
    // that quietly drops every row would be stored as a success.
    const baseline = prototypeBaselineFor(ontology, atlas)!;
    expect(baseline.seedValues.length).toBeGreaterThan(500);
    const emptied = built.html.replace(/(<script type="application\/json" id="m-seed">)[\s\S]*?(<\/script>)/, "$1{}$2");
    const verdict = checkRefinedPrototype(baseline, emptied);
    expect(verdict.ok, "a document with an emptied data island passed the post-condition").toBe(false);
    expect(verdict.droppedSeedValues.length).toBeGreaterThan(0);
    // …and the structure is untouched, so it is the SEED that is reported lost.
    expect(verdict.droppedRegions).toEqual([]);
    expect(verdict.droppedScreens).toEqual([]);
  });

  it("a corrupted island is read as records lost, not waved through", () => {
    const text = documentText(`<script type="application/json">{"a":"Northwind Account 1"}</script>`);
    expect(text.nodes.has("Northwind Account 1")).toBe(true);
    // The key is the island's schema, not its content.
    expect(text.nodes.has("a")).toBe(false);
    expect(documentText(`<script type="application/json">{not json</script>`).nodes.size).toBe(0);
    // An executable script is still not content.
    expect(documentText(`<script>var x="ghost"</script>`).nodes.has("ghost")).toBe(false);
  });

  it("the project export leaves the island in the page instead of lifting it into app.js", () => {
    // MUTATION: drop the `executable` filter → the island lands in app.js as a
    // syntax error and leaves index.html with no records at all.
    const { indexHtml, js } = splitPrototypeHtml(built.html);
    expect(indexHtml).toContain('id="m-seed"');
    expect(js).toContain("m-seed");                       // the renderer did move
    expect(js.trimStart().startsWith("{")).toBe(false);   // the data did not
    expect(() => JSON.parse(indexHtml.split('id="m-seed">')[1].split("</script>")[0])).not.toThrow();
  });
});
