/**
 * THE REFINE MUST NOT LOSE THE STRUCTURE IT WAS GIVEN.
 *
 * The prototype-build agent regenerated the whole application free-form on every
 * run: no fabric, no regions, nothing to diff, a fresh die-roll each time. The
 * evidence was a refine asking for detail-page breadcrumbs and related-entity
 * tabs that came back half applied and half declined — "no detail screens exist
 * in the current design" — because the free-form path never builds any.
 *
 * The order is now inverted: assemble first, then hand the model the assembled
 * build and the operator's direction. These pin the property that makes that
 * real, without a model call:
 *
 *   - a refine that honours the contract keeps the SAME data-fabric-id set, the
 *     same screens and the same seeded values (the acceptance criterion);
 *   - a refine that does not is REJECTED — the assembled build is stored and the
 *     breach is stated in the artifact's gaps, never absorbed silently;
 *   - the stylesheet path (the one a real programme takes, because its assembly
 *     is an order of magnitude larger than any answer a model can return)
 *     preserves structure by construction, and still produces a real diff.
 *
 * Every assertion is against RENDERED OUTPUT — ids and text read out of the
 * document — not a regex over the assembler's source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attrValuesIn, baselineWithPriorSkin, buildPrototypeRefineBrief,
  documentText, fabricIdsIn, prototypeBaselineFor, refineModeFor, resolvePrototypeDoc,
  screenIdsIn, stylesheetIn, withStylesheet, REFINE_CONTRACT, DOCUMENT_REFINE_BUDGET,
} from "@shared/prototypeRefine.ts";
import { parentEntitiesFor } from "@shared/prototypeAssembly.ts";
import { docSectionDiff } from "@/v3/components/flow/flowDecisions";

const ROOT = resolve(__dirname, "../../..");
const snap = (f: string) => JSON.parse(readFileSync(resolve(ROOT, `docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const EDGE = readFileSync(resolve(ROOT, "supabase/functions/run-agent/index.ts"), "utf8");

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });

/** Small enough that the whole document fits an answer — the document path. */
const smallOntology = {
  entities: [ent("Account", ["id", "name", "region"]), ent("Contact", ["id", "name", "accountId"])],
  relations: [{ from: "Account", to: "Contact", cardinality: "1:N" }],
};
const atlas = { workflows: [{ name: "Renewal", steps: [{ name: "Review" }] }] };

const small = prototypeBaselineFor(smallOntology, atlas)!;
const big = prototypeBaselineFor(snap("domain-ontology.json"), snap("current-state-atlas.json"))!;

/** A model that did as it was told: presentation changed, structure untouched. */
const restyledDocument = (html: string) => html
  .replace(/<style>[\s\S]*?<\/style>/, "<style>.m-card{border-radius:18px;box-shadow:0 2px 8px #0001}</style>")
  .replace(/class="m-card"/g, 'class="m-card m-card--soft"')
  .replace(/<h1 class="m-title">/g, '<h1 class="m-title m-title--display">');

describe("the baseline is assembled, not remembered", () => {
  it("derives a structured build from the record", () => {
    expect(small.fabricIds.length).toBeGreaterThan(0);
    expect(small.screenIds.length).toBeGreaterThan(0);
    expect(small.seedValues.length).toBeGreaterThan(0);
    // Not just record ids: the NAMES and values a stakeholder reads are what a
    // rewrite silently drops, so they are what must be pinned.
    expect(small.seedValues.some((v) => !/^[A-Z]{2,5}-\d+$/.test(v))).toBe(true);
    expect(small.stylesheet.length).toBeGreaterThan(0);
    // The ids in the baseline are the ids in the document — read back out of it.
    expect(small.fabricIds).toEqual([...new Set(fabricIdsIn(small.html))].sort());
  });

  it("is deterministic — same record, same document and same fabric version", () => {
    const again = prototypeBaselineFor(smallOntology, atlas)!;
    expect(again.html).toBe(small.html);
    expect(again.fabricVersion).toBe(small.fabricVersion);
    expect(again.seedValues).toEqual(small.seedValues);
  });

  it("returns null rather than a fake skeleton when the record cannot assemble", () => {
    expect(prototypeBaselineFor(null, atlas)).toBeNull();
    expect(prototypeBaselineFor(smallOntology, null)).toBeNull();
    expect(prototypeBaselineFor({ entities: [] }, atlas)).toBeNull();
  });

  it("honours the operator's parent-entity choice, through the one shared reading", () => {
    const curated = prototypeBaselineFor(snap("domain-ontology.json"), snap("current-state-atlas.json"), { parentEntities: ["Account"] })!;
    expect(parentEntitiesFor({ parentEntities: ["Account"] })).toEqual(["Account"]);
    expect(curated.screenIds).toEqual(["detail-account", "form-account", "list-account"]);
    expect(curated.fabricIds.length).toBeLessThan(big.fabricIds.length);
  });
});

// ── the acceptance criterion ────────────────────────────────────────────────
describe("fabric ids before == fabric ids after a refine", () => {
  it("a presentation-only refine ships, with the id set unchanged", () => {
    const { doc, source, verdict } = resolvePrototypeDoc({ html: restyledDocument(small.html) }, small);
    expect(verdict!.violations).toEqual([]);
    expect(source).toBe("refined");
    // THE property: the ids read out of the stored document equal the ids read
    // out of the assembled one. Not "the check passed" — the documents compared.
    expect([...new Set(fabricIdsIn(String(doc.html)))].sort()).toEqual(small.fabricIds);
    expect([...new Set(screenIdsIn(String(doc.html)))].sort()).toEqual(small.screenIds);
    // …and the seeded values are all still on the page.
    const text = documentText(String(doc.html));
    expect(small.seedValues.filter((v) => !text.nodes.has(v) && !text.flat.includes(v))).toEqual([]);
    // …and it is genuinely a different document, or nothing was refined at all.
    expect(doc.html).not.toBe(small.html);
    expect(docSectionDiff({ html: small.html }, doc as Record<string, unknown>)).toContain("Html — rewritten");
  });

  it("a restyle carries the seed and the structure through untouched", () => {
    const { doc, source } = resolvePrototypeDoc({ styleCss: ":root{--m-brand:#6b21a8}.m-card{border:0}" }, big);
    expect(source).toBe("restyled");
    expect([...new Set(fabricIdsIn(String(doc.html)))].sort()).toEqual(big.fabricIds);
    expect(String(doc.html)).toContain("#6b21a8");
    expect(stylesheetIn(String(doc.html))).not.toBe(big.stylesheet);
    const text = documentText(String(doc.html));
    expect(big.seedValues.filter((v) => !text.nodes.has(v) && !text.flat.includes(v))).toEqual([]);
  });
});

// ── the rejection path: a miss stays visible ────────────────────────────────
describe("a structure-losing rewrite is not stored, and says so", () => {
  const kept = (candidate: Record<string, unknown>) => resolvePrototypeDoc(candidate, small);

  it("a dropped region keeps the assembled build and names the loss", () => {
    const victim = small.fabricIds.find((id) => id.startsWith("region:"))!;
    const mangled = small.html.replace(`data-fabric-id="${victim}"`, 'data-role="detail"');
    const { doc, source, verdict } = kept({ html: mangled, gaps: ["a gap the model wrote"] });
    expect(source).toBe("assembled");
    expect(doc.html).toBe(small.html);
    expect(verdict!.droppedRegions).toContain(victim);
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toContain("a gap the model wrote");          // never eats the model's own gaps
    expect(gaps).toContain(victim);                            // and names what it refused
  });

  it("an invented or duplicated id is a breach, not a bonus", () => {
    const first = small.fabricIds[0];
    expect(kept({ html: small.html.replace("</body>", `<div data-fabric-id="region:invented:hero"></div></body>`) }).source).toBe("assembled");
    expect(kept({ html: small.html.replace("</body>", `<div data-fabric-id="${first}"></div></body>`) }).source).toBe("assembled");
  });

  it("a dropped screen is a breach", () => {
    const screen = small.screenIds.find((s) => s.startsWith("form-"))!;
    const mangled = small.html.replace(`data-screen="${screen}"`, 'data-screen="form-other"');
    const { source, verdict } = kept({ html: mangled });
    expect(source).toBe("assembled");
    expect(verdict!.droppedScreens).toContain(screen);
  });

  it("dropped seed rows are a breach even when every id survives", () => {
    // The model keeps the shell and empties the tables — the failure that shipped
    // dashboards with three ontology entities missing and gaps reporting [].
    const value = small.seedValues[0];
    expect(value).toBeTruthy();
    const mangled = small.html.split(value).join("Sample record");
    const { source, verdict } = kept({ html: mangled });
    expect(source).toBe("assembled");
    expect(verdict!.droppedSeedValues).toContain(value);
  });

  it("an empty answer keeps the assembled build rather than storing nothing", () => {
    const { doc, source } = kept({ html: "   " });
    expect(source).toBe("assembled");
    expect(doc.html).toBe(small.html);
    expect((doc.gaps as string[]).length).toBeGreaterThan(0);
  });

  it("the stored document always records which build it is", () => {
    for (const candidate of [{ html: restyledDocument(small.html) }, { styleCss: ".m-card{border:0}" }, { html: "<html></html>" }]) {
      const { doc, source } = resolvePrototypeDoc(candidate, small);
      expect((doc._prototypeStructure as Record<string, unknown>).source).toBe(source);
      expect((doc._prototypeStructure as Record<string, unknown>).fabricVersion).toBe(small.fabricVersion);
      expect(doc.styleCss).toBeUndefined();   // the skin lives in the document, not beside it
    }
  });
});

// ── what the model is actually asked for ────────────────────────────────────
describe("the ask is sized to what an answer can carry", () => {
  it("a small build is handed over whole; a real one is handed its stylesheet", () => {
    expect(small.html.length).toBeLessThanOrEqual(DOCUMENT_REFINE_BUDGET);
    expect(big.html.length).toBeGreaterThan(DOCUMENT_REFINE_BUDGET * 4);
    expect(refineModeFor(small)).toBe("document");
    expect(refineModeFor(big)).toBe("stylesheet");
  });

  it("the document brief carries the build; the stylesheet brief never does", () => {
    const d = buildPrototypeRefineBrief(small, { round: 2, designInstruction: "tighten the spacing" });
    expect(d.baselineHtml).toBe(small.html);
    expect(d.contract).toBe(REFINE_CONTRACT);
    expect(d.designInstruction).toBe("tighten the spacing");

    const s = buildPrototypeRefineBrief(big, {});
    expect(s.baselineHtml).toBeUndefined();
    expect(s.baselineStylesheet).toBe(big.stylesheet);
    // The whole brief must fit a context: it must NOT smuggle the 500KB build.
    expect(JSON.stringify(s).length).toBeLessThan(big.html.length / 4);
    // …and the omission is stated, not implied.
    expect(s.baselineNote).toMatch(/not in your context|styleCss/i);
  });

  it("the contract states the three things a refine may not touch", () => {
    expect(REFINE_CONTRACT).toMatch(/data-fabric-id/);
    expect(REFINE_CONTRACT).toMatch(/data-screen/);
    expect(REFINE_CONTRACT).toMatch(/seed/i);
  });
});

// ── the skin accumulates; the skeleton is re-derived ────────────────────────
describe("a second round starts from the skin the first one produced", () => {
  it("adopts the stored build's stylesheet onto the freshly assembled skeleton", () => {
    const round1 = resolvePrototypeDoc({ styleCss: ".m-card{outline:3px solid #123456}" }, big).doc;
    const round2 = baselineWithPriorSkin(prototypeBaselineFor(snap("domain-ontology.json"), snap("current-state-atlas.json"))!, round1.html);
    expect(round2.stylesheet).toContain("#123456");
    expect(round2.html).toContain("#123456");
    expect(round2.fabricIds).toEqual(big.fabricIds);          // structure still derived
  });

  it("ignores a stored build that is not this assembly", () => {
    const freeForm = "<html><head><style>.x{color:red}</style></head><body><div>hand-written</div></body></html>";
    expect(baselineWithPriorSkin(small, freeForm)).toBe(small);
    expect(baselineWithPriorSkin(small, "")).toBe(small);
  });
});

// ── the readers must not be fooled by markup they did not write ────────────
describe("reading a document the model wrote", () => {
  it("finds attributes however they are quoted", () => {
    const html = `<div data-fabric-id="a"></div><div data-fabric-id='b'></div><div data-fabric-id=c></div>`;
    expect(fabricIdsIn(html)).toEqual(["a", "b", "c"]);
    expect(attrValuesIn(`<i CLASS='m-chip'>`, "class")).toEqual(["m-chip"]);
  });

  it("reads text as content, and script/style bodies as neither", () => {
    const text = documentText(`<style>.a{content:"ghost"}</style><script>var x="ghost"</script><p>Northwind &amp; Co</p>`);
    expect(text.nodes.has("Northwind & Co")).toBe(true);
    expect(text.flat).not.toContain("ghost");
  });

  it("a replacement stylesheet cannot close the block or open a script", () => {
    const hostile = withStylesheet(small.html, "</style><script>alert(1)</script>.m-card{}");
    expect(hostile).not.toContain("<script>alert(1)</script>");
    expect([...new Set(fabricIdsIn(hostile))].sort()).toEqual(small.fabricIds);
  });
});

// ── read the DOM, not the string ───────────────────────────────────────────
describe("the stored document, parsed", () => {
  it("is one document with one stylesheet, and every region is an element in it", () => {
    // The regex readers above are how the pipeline sees the document; this is
    // how a browser sees it. A splice that produced a plausible STRING and a
    // broken DOCUMENT would pass everything else and fail here.
    const { doc } = resolvePrototypeDoc({ styleCss: ".m-card{outline:1px solid #abc123}" }, small);
    const parsed = new DOMParser().parseFromString(String(doc.html), "text/html");
    expect(parsed.querySelectorAll("style").length).toBe(1);
    expect(parsed.querySelector("style")!.textContent).toContain("#abc123");
    const ids = [...parsed.querySelectorAll("[data-fabric-id]")].map((el) => el.getAttribute("data-fabric-id")!);
    expect([...new Set(ids)].sort()).toEqual(small.fabricIds);
    expect(parsed.querySelectorAll(".m-screen").length).toBe(small.screenIds.length);
    // The seeded content is in the parsed document's text, not just the source.
    const shown = parsed.body.textContent ?? "";
    expect(small.seedValues.filter((v) => !shown.includes(v))).toEqual([]);
  });
});

// ── the edge is wired to all of it ─────────────────────────────────────────
describe("the build agent is handed the assembled build, both ways", () => {
  it("assembles before the call and checks after it", () => {
    // Two call sites, and they must be the SAME derivation or the document the
    // model was shown is not the document its answer is checked against.
    expect((EDGE.match(/prototypeBaselineOf\(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(EDGE).toMatch(/buildPrototypeRefineBrief\(\s*prototypeBaseline\s*,/);
    expect(EDGE).toMatch(/resolvePrototypeDoc\(formalResult,\s*baseline\)/);
  });

  it("the prompt carries the shared contract, not a paraphrase of it", () => {
    expect(EDGE).toContain("${REFINE_CONTRACT}");
    // The refine no longer starts from the last model-written document.
    expect(EDGE).not.toContain("prototypeRefineBrief.priorHtml");
  });
});
