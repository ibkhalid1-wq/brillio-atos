/**
 * E2 · THE DEMO WEARS THE CLIENT'S BRAND, OR THE TOKENS ARE DECORATION.
 *
 * Meridian was tokenised from the day it was written and the Experience Design
 * studio has always stored a governed `theme` — and `assemblePrototype` called
 * `meridianStylesheet()` with no argument, so every build shipped the house
 * indigo. The palette reached the ZIP export's `design-tokens.json` and nothing
 * a client ever looked at.
 *
 * Three things have to be true for a palette to be worth accepting, and each is
 * a way this could pass while doing nothing:
 *
 *   1. IT REACHES THE DOCUMENT, on every surface that assembles one — the
 *      operator's studio, the stakeholder's link and the refine baseline read
 *      the same programme through the same one definition, or they skin three
 *      different applications.
 *   2. NO RULE CARRIES A COLOUR OF ITS OWN. A stylesheet whose `:root` is
 *      overridden while its rules still hold brand-family literals is a re-skin
 *      that half happens — which is what the sidebar was: five fixed tints of
 *      the house lilac, on a surface filled with `--m-brand`.
 *   3. THE CHROME STAYS READABLE at whatever brand arrives. Contrast is
 *      MEASURED here, not eyeballed: a pale brand with white navigation on it
 *      is a demo that lands as broken rather than as theirs.
 *
 * And a palette is an INPUT: it is interpolated into a `:root{…}` block inside
 * the document's one `<style>` element, so a value carrying `}` or `</style>`
 * is a way out of both. That is asserted on the rendered document, not on the
 * validator.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype, paletteFor } from "@shared/prototypeAssembly.ts";
import { pilotSliceFor } from "@shared/prototypePilot.ts";
import { prototypeBaselineFor } from "@shared/prototypeRefine.ts";
import {
  MERIDIAN_TOKENS, brandChrome, contrastRatio, meridianRootVars, meridianStylesheet, resolveTheme,
} from "@shared/prototypeDesignSystem.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const ROOT = resolve(__dirname, "../../..");
const snap = (f: string) => JSON.parse(readFileSync(resolve(ROOT, `docs/laila/snapshot-2026-08-07/${f}`), "utf8")) as Record<string, unknown>;
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

/** A palette from somewhere that is not this house: a mid teal, a warm accent. */
const CLIENT = { brand: "#0f5f5c", accent: "#c2571b", radius: 4 };
/** …and one that is nearly white, which is where the old fixed tints failed. */
const PALE = { brand: "#ffd400" };

/** The `:root` declarations of a built document, as a map. Read out of the
 *  rendered page's own stylesheet — not out of the token module. */
function rootVarsOf(html: string): Record<string, string> {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  const block = /:root\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const decl of block.split(";")) {
    const [k, ...v] = decl.split(":");
    if (k && k.trim().startsWith("--")) out[k.trim()] = v.join(":").trim();
  }
  return out;
}

/** Everything in the stylesheet that is NOT the `:root` token block. */
function rulesOf(css: string): string {
  return css.replace(/:root\{[\s\S]*?\}/, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the palette reaches the document", () => {
  it("a programme's theme skins the assembled build", () => {
    // MUTATION: drop the argument from meridianStylesheet(options.theme) → RED.
    const vars = rootVarsOf(assemblePrototype(ontology, atlas, undefined, { theme: CLIENT }).html);
    expect(vars["--m-brand"]).toBe(CLIENT.brand);
    expect(vars["--m-accent"]).toBe(CLIENT.accent);
    expect(vars["--m-r-md"]).toBe("4px");
    // …and without one it is exactly the house build it always was.
    expect(rootVarsOf(assemblePrototype(ontology, atlas).html)["--m-brand"]).toBe(MERIDIAN_TOKENS.brand);
  });

  it("is read off the programme by ONE definition, and all three surfaces use it", () => {
    // The operator's studio, the stakeholder's link and the refine baseline
    // must produce the same skin from the same record, or the client validates
    // an application the operator never saw.
    const design = { theme: CLIENT, parentEntities: [] };
    expect(paletteFor(design)).toEqual(CLIENT);
    const studio = assemblePrototype(ontology, atlas, undefined, { theme: paletteFor(design) }).html;
    const portal = pilotSliceFor({ domainOntology: ontology, currentStateAtlas: atlas, experienceDesign: design }).pilotHtml;
    const baseline = prototypeBaselineFor(ontology, atlas, design)!;
    expect(rootVarsOf(portal ?? "")["--m-brand"]).toBe(CLIENT.brand);
    expect(rootVarsOf(baseline.html)["--m-brand"]).toBe(CLIENT.brand);
    expect(portal).toBe(studio);
  });

  it("reads only the governed keys, and only usable values", () => {
    expect(paletteFor({ theme: { brand: "#123456", nonsense: "#000", radius: "12" } })).toEqual({ brand: "#123456" });
    expect(paletteFor({ theme: { brand: "   " } })).toEqual({});
    expect(paletteFor(null)).toEqual({});
    expect(paletteFor({ theme: "deep indigo" })).toEqual({});
  });
});

describe("a re-skin is a variable swap, and nothing else", () => {
  it("no rule outside :root states a colour of its own", () => {
    // MUTATION: put back `.m-btn--primary:hover{background:#2d2159}` (or any of
    // the five sidebar tints) → RED. THE property behind the whole token
    // surface: a rule holding its own brand-family colour does not follow the
    // palette, so a client build comes out half re-skinned.
    //
    // Plain white and black are allowed: they are not brand-derived, and the
    // pairing that has to survive an arbitrary brand is the one below.
    const rules = rulesOf(meridianStylesheet(CLIENT));
    const literals = [...rules.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase())
      .filter((c) => !/^#(fff|ffffff|000|000000)$/.test(c));
    expect(literals, `rules carrying their own colour:\n${literals.join("\n")}`).toEqual([]);
    const funcs = [...rules.matchAll(/\b(rgba?|hsla?)\([^)]*\)/g)].map((m) => m[0])
      .filter((c) => !/\(\s*(255,\s*255,\s*255|0,\s*0,\s*0)/.test(c));
    expect(funcs, `rules carrying their own colour:\n${funcs.join("\n")}`).toEqual([]);
  });

  it("the sidebar's own type is brand-derived, in the rendered document", () => {
    // Not a source read: the page is parsed and the cascade resolved, then the
    // declaration is traced back to the token it must come from.
    const { doc, styleOf } = loadPrototype(assemblePrototype(ontology, atlas, undefined, { theme: CLIENT }).html);
    const side = doc.querySelector("aside.m-side")!;
    const item = doc.querySelector(".m-nav-item")!;
    expect(styleOf(side).background).toContain("--m-brand");
    expect(styleOf(item).color).toContain("--m-on-brand");
  });
});

describe("the chrome stays readable at whatever brand arrives", () => {
  const AA_TEXT = 4.5;
  const AA_LARGE = 3;

  for (const [label, brand] of [
    ["the house indigo", MERIDIAN_TOKENS.brand],
    ["a mid teal", CLIENT.brand],
    ["a near-white yellow", PALE.brand],
    ["black", "#000000"],
    ["white", "#ffffff"],
  ] as const) {
    it(`${label}: type on the brand surface passes AA`, () => {
      // MUTATION: pin `onBrand` to "#ffffff" → RED on the pale brands. This is
      // the defect the fixed lilac tints WERE: navigation chosen for one brand,
      // painted on any brand.
      const c = brandChrome(brand, MERIDIAN_TOKENS.ink);
      expect(contrastRatio(brand, c.onBrand)!, "primary type on the brand").toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(brand, c.onBrandDim)!, "navigation type on the brand").toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(brand, c.onBrandMute)!, "section labels on the brand").toBeGreaterThanOrEqual(AA_LARGE);
      expect(contrastRatio(brand, c.brandMark)!, "the active marker on the brand").toBeGreaterThanOrEqual(AA_LARGE);
      // The hover state is a state, not a different surface: it must move and
      // must still carry the same type.
      expect(c.brandStrong).not.toBe(brand);
      expect(contrastRatio(c.brandStrong, c.onBrand)!).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  it("the ratio itself is measured, not assumed", () => {
    // Non-vacuity for the block above: the function returns real WCAG numbers.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("rgb(0,0,0)", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("papayawhip", "#fff")).toBeNull();
  });
});

describe("a palette is untrusted input", () => {
  it("a value that does not fit its slot keeps the house default", () => {
    expect(resolveTheme({ brand: "red; }" as string }).brand).toBe(MERIDIAN_TOKENS.brand);
    expect(resolveTheme({ radius: -4 }).radius).toBe(MERIDIAN_TOKENS.radius);
    expect(resolveTheme({ fontSans: "x</style><script>y" }).fontSans).toBe(MERIDIAN_TOKENS.fontSans);
    // …and a value that DOES fit is honoured, so the check is not just "no".
    expect(resolveTheme({ brand: "rgb(15, 95, 92)" }).brand).toBe("rgb(15, 95, 92)");
    expect(resolveTheme({ radius: 0 }).radius).toBe(0);
  });

  it("cannot escape the :root block or the style element", () => {
    // MUTATION: interpolate the raw value in meridianRootVars → RED. Asserted
    // on the PARSED document: the hostile value must not become a rule, an
    // element, or anything a browser executes.
    const hostile = {
      brand: "#fff}body{display:none}",
      ink: "</style><script>window.__pwned=1</script>",
      fontDisplay: 'x"><img src=x onerror=alert(1)>',
    } as never;
    const html = assemblePrototype(ontology, atlas, undefined, { theme: hostile }).html;
    const loaded = loadPrototype(html);
    expect(html).not.toContain("body{display:none}");
    expect(html).not.toContain("__pwned");
    expect(loaded.doc.querySelectorAll("style").length).toBe(1);
    expect(loaded.doc.querySelector("img")).toBeNull();
    expect((loaded.window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(loaded.consoleErrors).toEqual([]);
    expect(rootVarsOf(html)["--m-brand"]).toBe(MERIDIAN_TOKENS.brand);
  });

  it("the token block is the only place a colour literal enters", () => {
    const vars = meridianRootVars(CLIENT);
    expect(vars).toContain(`--m-brand:${CLIENT.brand}`);
    expect(vars).toContain("--m-on-brand:");
    expect(vars).toContain("--m-brand-strong:");
  });
});
