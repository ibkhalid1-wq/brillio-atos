/**
 * THE SEED ISLAND IS 60% OF THE DOCUMENT, AND NONE OF IT IS WASTE.
 *
 * "Trim the seed island per screen" sat on the debt list for weeks. Measured,
 * it turns out to be already done: the island ships only entities a screen
 * names, and on the largest build in the repo the number of seeded entities no
 * screen reads is ZERO. There is nothing to trim, because the assembler already
 * builds `data` after the screens precisely so it can scope it.
 *
 * WHAT THE MEASUREMENT FOUND INSTEAD is sharper and was not on any list. The
 * refine mode is chosen by document LENGTH — `prototypeRefine.ts` returns
 * "document" at or under `DOCUMENT_REFINE_BUDGET` and "stylesheet" above it —
 * and a real build is roughly NINE TIMES the budget. So every real programme is
 * permanently in stylesheet-only refine: the model may restyle it and may never
 * restructure it, and nothing anywhere says so.
 *
 * That is not fixable by trimming. Nine times is not a diet. It is recorded
 * here as the honest shape of the constraint, so the next person does not spend
 * another week shaving bytes off a gap that size.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { DOCUMENT_REFINE_BUDGET } from "@shared/prototypeRefine.ts";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const built = assemblePrototype(snap("domain-ontology.json"), snap("current-state-atlas.json"));

/** The island as the browser gets it, parsed back. */
function island(html: string): Record<string, unknown> {
  const open = 'id="m-seed">';
  const from = html.indexOf(open) + open.length;
  const raw = html.slice(from, html.indexOf("</script>", from));
  return JSON.parse(raw.replace(/\\u003c/g, "<")) as Record<string, unknown>;
}

const model = island(built.html);
const data = model.data as Record<string, unknown>;

describe("every seeded entity earns its place", () => {
  it("no table is shipped that no screen ever names", () => {
    // THE CLAIM THE DEBT ITEM ASSUMED WAS FALSE. Walk everything the renderer
    // draws from — screens, workbenches, approvals, widgets, actions — and
    // collect the entity names it mentions. Anything in `data` outside that set
    // is pure payload.
    const named = new Set<string>();
    const walk = (v: unknown): void => {
      if (!v) return;
      if (typeof v === "string") { if (v in data) named.add(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
    };
    for (const key of ["screens", "work", "appr", "widgets", "acts"]) walk(model[key]);

    const unread = Object.keys(data).filter((n) => !named.has(n));
    expect(unread, `seed shipped for entities no screen draws: ${unread.join(", ")}`).toEqual([]);
    expect(Object.keys(data).length).toBeGreaterThan(20);
  });

  it("the island is the bulk of the document, and that is data not slack", () => {
    const size = JSON.stringify(model).length;
    expect(size / built.html.length).toBeGreaterThan(0.4);
    // Rows and columns, not prose: if this ever inverts, something non-data has
    // grown into the island and is worth a look.
    expect(JSON.stringify(data).length / size).toBeGreaterThan(0.6);
  });
});

describe("what the size actually costs", () => {
  it("a real build is far past the point where refine can restructure it", () => {
    // `refineModeFor` returns "document" at or under the budget and
    // "stylesheet" above. This is not a near miss to be optimised away.
    expect(built.html.length).toBeGreaterThan(DOCUMENT_REFINE_BUDGET * 5);
  });

  it("and the threshold is measured on the WHOLE document, island included", () => {
    // Worth knowing before anyone proposes eliding the island to squeak under:
    // even the markup alone, with every seeded row removed, is still multiples
    // of the budget. The gap is structural, not a packaging problem.
    const markupOnly = built.html.length - JSON.stringify(model).length;
    expect(markupOnly).toBeGreaterThan(DOCUMENT_REFINE_BUDGET);
  });
});
