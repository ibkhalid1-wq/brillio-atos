/**
 * A REFINE MAY NOT TURN THE APPLICATION BACK INTO A SCREENSHOT.
 *
 * The assembled build is a working application: one executable `<script>` draws
 * every row from the JSON data island at load, and each control carries an
 * inline handler that calls into it. The post-condition between the model's
 * document and the stored artifact compared ids, screens, regions and seeded
 * values — every one of which a document keeps when it comes back with the
 * script deleted or the handlers stripped off the controls. Both passed
 * `ok: true` and shipped as source "refined", and the prototype the stakeholder
 * opened rendered no rows and answered no click.
 *
 * These pin the property that ends that: the returned document must still DEFINE
 * the behaviours its controls call, and must still carry at least as many
 * controls calling each of them as the assembled build did. On a breach the
 * assembled build is kept and the breach is stated in the artifact's gaps, like
 * every other structural loss.
 *
 * The premise of each rejection case is proven against the RENDERED document —
 * loaded in jsdom with the page's own script run — because the whole claim is
 * about what the page DOES, and a regex over the source cannot see that.
 */
import { describe, it, expect } from "vitest";
import {
  checkRefinedPrototype, handlerCallsIn, prototypeBaselineFor, refineModeFor,
  resolvePrototypeDoc, scriptDefinesIn, withStylesheet, REFINE_CONTRACT,
} from "@shared/prototypeRefine.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });
/** Small enough that the model is handed the whole document — the only mode in
 *  which it can return markup at all, and therefore the only one at risk. */
const ontology = {
  entities: [ent("Account", ["id", "name", "region"]), ent("Contact", ["id", "name", "accountId"])],
  relations: [{ from: "Account", to: "Contact", cardinality: "1:N" }],
};
const atlas = { workflows: [{ name: "Renewal", steps: [{ name: "Review" }] }] };
const baseline = prototypeBaselineFor(ontology, atlas)!;

/** The page as a browser has it: script run, rows drawn, cascade resolved. */
const live = (html: string) => loadPrototype(html, { url: "https://prototype.test/#account" });
const controlsIn = (doc: Document) => doc.querySelectorAll("[onclick],[oninput]").length;

/**
 * A MODEL THAT DELETED THE RENDERER. Everything a reader sees in the source is
 * still there — ids, screens, the data island, the markup — and the application
 * is gone.
 */
const rendererDeleted = baseline.html.replace(/<script>[\s\S]*?<\/script>/gi, "");

/**
 * A MODEL THAT STRIPPED THE HANDLERS. Only the MARKUP's handlers go: the
 * renderer's own source contains handler markup inside its string literals, and
 * a strip that reached into it would break the script and be caught as a page
 * that throws rather than as a page that does nothing.
 */
const unwired = (html: string, only = /\son[a-z]+\s*=\s*"[^"]*"/gi) => html
  .split(/(<script[\s\S]*?<\/script>)/i)
  .map((part) => (/^<script/i.test(part) ? part : part.replace(only, "")))
  .join("");
const handlersStripped = unwired(baseline.html);
/** One behaviour unwired, the rest untouched — Save that no longer saves. */
const saveUnwired = unwired(baseline.html, / onclick="saveRec\([^"]*\)"/g);
/** The renderer still there, under a name its controls do not call. */
const rendererRenamed = baseline.html.replace(/function go\(/, "function goAway(");

/**
 * A MODEL THAT DID AS IT WAS TOLD: a new stylesheet, richer classes, and the
 * handler attributes re-quoted the way a rewrite legitimately might. Structure,
 * script and controls all intact.
 */
const restyled = withStylesheet(baseline.html, ".m-card{border-radius:18px;box-shadow:0 2px 8px #0001}")
  .split(/(<script[\s\S]*?<\/script>)/i)
  .map((part) => (/^<script/i.test(part)
    ? part
    : part
      .replace(/class="m-card"/g, 'class="m-card m-card--soft"')
      .replace(/ onclick="([^"]*)"/g, (_m, body: string) => ` onclick='${body.replace(/'/g, "&#39;")}'`)))
  .join("");

// ── 0 · the fixture is a working application, and the guarded set is real ────

describe("the baseline this is checked against is an application", () => {
  it("is handed to the model as a whole document — the mode where markup can be lost", () => {
    expect(refineModeFor(baseline)).toBe("document");
  });

  it("names behaviours its own script defines, and its controls call", () => {
    const guarded = Object.entries(baseline.handlers);
    expect(guarded.length).toBeGreaterThan(3);
    const defined = new Set(scriptDefinesIn(baseline.html));
    for (const [name, n] of guarded) {
      expect(defined.has(name), `${name} is guarded but no script defines it`).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
    // The count is of CONTROLS, not of occurrences in the bytes: the renderer
    // writes handler markup inside its own strings, and counting those would
    // measure the renderer's source rather than the page's controls.
    expect(handlerCallsIn(baseline.html).go).toBeLessThan(
      (baseline.html.match(/onclick="[^"]*\bgo\(/g) ?? []).length,
    );
  });

  it("renders rows and wires controls when it is loaded", () => {
    const page = live(baseline.html);
    expect(page.consoleErrors).toEqual([]);
    expect(page.doc.querySelectorAll("table").length).toBeGreaterThan(0);
    expect(page.doc.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(controlsIn(page.doc)).toBeGreaterThan(10);
  });

  it("passes its own post-condition", () => {
    const verdict = checkRefinedPrototype(baseline, baseline.html);
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

// ── 1 · the renderer deleted — the page becomes a shell ──────────────────────

describe("a document that came back without the renderer is refused", () => {
  it("renders nothing at all, while keeping every id, screen and value", () => {
    const page = live(rendererDeleted);
    expect(page.doc.querySelectorAll("table").length).toBe(0);
    expect(page.doc.querySelectorAll("tbody tr").length).toBe(0);
    // …and that is invisible to every check that came before this one.
    const verdict = checkRefinedPrototype(baseline, rendererDeleted);
    expect(verdict.droppedRegions).toEqual([]);
    expect(verdict.droppedScreens).toEqual([]);
    expect(verdict.droppedFills).toEqual([]);
  });

  it("is rejected, naming every behaviour the page can no longer answer", () => {
    const verdict = checkRefinedPrototype(baseline, rendererDeleted);
    expect(verdict.ok, "a document with no renderer passed the post-condition").toBe(false);
    expect(verdict.lostRenderer.sort()).toEqual(Object.keys(baseline.handlers).sort());
    expect(verdict.violations.join(" ")).toMatch(/renderer/i);
  });

  it("keeps the assembled build and says so in gaps", () => {
    const { doc, source, verdict } = resolvePrototypeDoc({ html: rendererDeleted, gaps: [] }, baseline);
    expect(source).toBe("assembled");
    expect(doc.html).toBe(baseline.html);
    expect(verdict!.ok).toBe(false);
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toMatch(/NOT stored/);
    for (const name of Object.keys(baseline.handlers)) expect(gaps).toContain(name);
    expect((doc._prototypeStructure as Record<string, unknown>).source).toBe("assembled");
  });
});

// ── 2 · the handlers stripped — the page looks right and does nothing ────────

describe("a document that came back with its controls unwired is refused", () => {
  it("still loads and still draws its rows — the loss is silent to every other check", () => {
    const page = live(handlersStripped);
    expect(page.consoleErrors).toEqual([]);
    expect(page.doc.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    // The navigation is the plainest reading: the menu is drawn and dead.
    const nav = [...page.doc.querySelectorAll("[data-nav]")];
    expect(nav.length).toBeGreaterThan(0);
    for (const item of nav) expect(item.getAttribute("onclick")).toBe(null);
    const verdict = checkRefinedPrototype(baseline, handlersStripped);
    expect(verdict.droppedRegions).toEqual([]);
    expect(verdict.droppedScreens).toEqual([]);
    expect(verdict.droppedSeedValues).toEqual([]);
    expect(verdict.lostRenderer).toEqual([]);
  });

  it("is rejected, and reports what each behaviour lost", () => {
    const verdict = checkRefinedPrototype(baseline, handlersStripped);
    expect(verdict.ok, "a document with every control unwired passed the post-condition").toBe(false);
    expect(verdict.lostHandlers.length).toBe(Object.keys(baseline.handlers).length);
    for (const [name, n] of Object.entries(baseline.handlers)) {
      expect(verdict.lostHandlers.join(" ")).toContain(`${name} (${n} → 0)`);
    }
    const { doc, source } = resolvePrototypeDoc({ html: handlersStripped }, baseline);
    expect(source).toBe("assembled");
    expect(doc.html).toBe(baseline.html);
    expect((doc.gaps as string[]).join(" ")).toMatch(/NOT stored/);
  });

  it("catches ONE behaviour unwired, not only a wholesale strip", () => {
    const verdict = checkRefinedPrototype(baseline, saveUnwired);
    expect(verdict.ok).toBe(false);
    expect(verdict.lostHandlers).toEqual([`saveRec (${baseline.handlers.saveRec} → 0)`]);
    // The rendered proof: the form still offers Save, and Save calls nothing.
    const page = live(saveUnwired);
    const saves = [...page.doc.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Save");
    expect(saves.length).toBeGreaterThan(0);
    for (const button of saves) expect(button.getAttribute("onclick")).toBe(null);
  });

  it("catches a renderer that kept the controls and renamed what they call", () => {
    const verdict = checkRefinedPrototype(baseline, rendererRenamed);
    expect(verdict.ok).toBe(false);
    expect(verdict.lostRenderer).toEqual(["go"]);
    // Rendered proof that this is a real breakage, not a spelling complaint:
    // the page throws on load and draws no rows at all.
    const page = live(rendererRenamed);
    expect(page.consoleErrors.join(" ")).toMatch(/ReferenceError: go is not defined/);
    expect(page.doc.querySelectorAll("tbody tr").length).toBe(0);
  });
});

// ── 3 · a legitimate refine still ships ─────────────────────────────────────

describe("a restyle that kept the application is stored", () => {
  it("passes the post-condition with its handlers re-quoted", () => {
    expect(restyled).not.toBe(baseline.html);
    expect(restyled).toContain("m-card--soft");
    expect(restyled).toContain("onclick='");
    const verdict = checkRefinedPrototype(baseline, restyled);
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(resolvePrototypeDoc({ html: restyled }, baseline).source).toBe("refined");
  });

  it("still renders its rows and answers its controls", () => {
    const page = live(restyled);
    expect(page.consoleErrors).toEqual([]);
    expect(page.doc.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(controlsIn(page.doc)).toBeGreaterThan(10);
  });

  it("the stylesheet path is untouched — its structure is the assembler's", () => {
    const { source, verdict } = resolvePrototypeDoc({ styleCss: ".m-card{border:0}" }, baseline);
    expect(source).toBe("restyled");
    expect(verdict!.violations).toEqual([]);
  });
});

// ── 4 · the two readers, on documents written every legal way ───────────────

/**
 * The model writes the markup on this path, so neither reader may assume the
 * assembler's own spelling. These are the cases a rewrite actually produces —
 * and the ones that would make the check either blind or wrong.
 */
describe("the readers read a document however it is written", () => {
  it("counts a control once per behaviour it calls, in any quoting", () => {
    expect(handlerCallsIn(`<a onclick="go('#a')">1</a>`)).toEqual({ go: 1 });
    expect(handlerCallsIn(`<a onclick='go("#a")'>1</a>`)).toEqual({ go: 1 });
    expect(handlerCallsIn(`<a onclick=go(1)>1</a>`)).toEqual({ go: 1 });
    // A method on something is not a name the page has to define.
    expect(handlerCallsIn(`<a onclick="event.preventDefault();go('#a')">1</a>`)).toEqual({ go: 1 });
    // Two controls, one behaviour; and one control calling a behaviour twice
    // is still one control that reaches it.
    expect(handlerCallsIn(`<a onclick="go(1)">1</a><a oninput="go(2);go(3)">2</a>`)).toEqual({ go: 2 });
  });

  it("does not read the renderer's own strings as the page's controls", () => {
    const doc = `<div onclick="go('#a')"></div><script>var row='<td onclick="go(2)"></td>';</script>`;
    expect(handlerCallsIn(doc)).toEqual({ go: 1 });
  });

  it("finds a definition however the renderer declares it, and never in the island", () => {
    expect(scriptDefinesIn(`<script>function go(x){}</script>`)).toEqual(["go"]);
    expect(scriptDefinesIn(`<script>const go = (x) => x</script>`)).toEqual(["go"]);
    expect(scriptDefinesIn(`<script>window.go = function(){}</script>`)).toEqual(["go"]);
    expect(scriptDefinesIn(`<script type="application/json">{"go":"function go(){}"}</script>`)).toEqual([]);
  });

  it("holds a refine only to the behaviours the assembled page actually answers", () => {
    // A control calling something no script defines is already inert in the
    // baseline: demanding a refine preserve it would be demanding it preserve
    // a defect, so it never enters the guarded set.
    const doc = `<a onclick="ghost()">1</a><a onclick="go(1)">2</a><script>function go(){}</script>`;
    const guarded = Object.keys(handlerCallsIn(doc)).filter((n) => scriptDefinesIn(doc).includes(n));
    expect(guarded).toEqual(["go"]);
    expect(Object.keys(baseline.handlers).every((n) => scriptDefinesIn(baseline.html).includes(n))).toBe(true);
  });
});

// ── 5 · the model is TOLD, not only judged ──────────────────────────────────

describe("the contract states what the check enforces", () => {
  it("names the renderer and the handlers", () => {
    expect(REFINE_CONTRACT).toMatch(/renderer/i);
    expect(REFINE_CONTRACT).toMatch(/onclick/i);
  });
});
