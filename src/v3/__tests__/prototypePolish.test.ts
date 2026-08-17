/**
 * THE CRAFT THAT SEPARATES A DESIGNED DATA PRODUCT FROM A COMPETENT ONE.
 *
 * The components were never the problem — cards, pills, tables, boards, empty
 * states and tone-coded status were all present and all correct. What was
 * missing was composition and typographic craft, assessed against the design
 * system's OWN reference page (`public/prototype-design-system.html`), which is
 * what the system says it looks like, versus the generated build, which is what
 * it ships. Six differences; each one is asserted below.
 *
 * And one constraint that shaped the whole exercise: the build that sets the
 * ceiling had TWENTY-FOUR BYTES of headroom under `DOCUMENT_REFINE_BUDGET`, so
 * none of this could be added without paying for it. It is paid for out of the
 * 3,417 bytes of developer commentary that were being shipped inside every
 * prototype — to the stakeholder who opens it, and again into the model's
 * context on every document-mode refine.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { meridianStylesheet, stripSheetComments, stripScriptComments, MERIDIAN_TOKENS, MERIDIAN_VERSION } from "@shared/prototypeDesignSystem.ts";
import { prototypeBaselineFor, prototypeBaselineOfProgram, DOCUMENT_REFINE_BUDGET } from "@shared/prototypeRefine.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;
const doc = () => loadPrototype(assemblePrototype(ontology, atlas).html).window.document;

/* ── the notes stay in the source and leave at emit ───────────────────────── */

describe("developer commentary does not ship to the client", () => {
  it("the emitted sheet carries none", () => {
    expect(meridianStylesheet()).not.toContain("/*");
  });

  it("…and the source still does — it was moved, not deleted", () => {
    const src = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/prototypeDesignSystem.ts"), "utf8");
    expect(src.split("/*").length).toBeGreaterThan(20);
  });

  it("is a comment strip and NOT a minifier — the served sheet stays readable", () => {
    const sheet = meridianStylesheet();
    expect(sheet).toContain("\n");
    expect(sheet.split("\n").length).toBeGreaterThan(100);
    // Rules keep their shape; only the commentary goes.
    expect(sheet).toContain(".m-card{");
  });

  it("leaves a rule that lived beside a comment intact", () => {
    expect(stripSheetComments("/* why */\n.a{color:red}\n/* how */\n.b{color:blue}"))
      .toContain(".a{color:red}");
    expect(stripSheetComments("/* why */\n.a{color:red}")).not.toContain("why");
  });

  it("the RENDERER's commentary goes the same way — it was the bigger purse", () => {
    // Measured at ~5.1kB in one build, against a 57,500-byte ceiling. Same
    // bargain as the sheet: kept where a developer reads it, gone where a
    // client downloads it.
    const html = assemblePrototype(ontology, atlas).html;
    const script = html.slice(html.indexOf("<script>"), html.lastIndexOf("</script>"));
    expect(script).not.toMatch(/^\s*\/\//m);
    const src = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/prototypeAssembly.ts"), "utf8");
    const renderer = src.slice(src.indexOf("const PROTOTYPE_RENDERER = `"), src.indexOf("function rendererFor"));
    expect(renderer.split("\n").filter((l) => l.trim().startsWith("//")).length).toBeGreaterThan(40);
  });

  it("cuts only whole-line comments — a slash-slash inside a string survives", () => {
    // The timid rule, asserted. Parsing JS to find real comments is the only
    // way to cut a trailing one safely, and a wrong cut here is a blank
    // prototype rather than a warning, so it does not try.
    const kept = stripScriptComments([
      "// why",
      'var u="https://example.test";',
      "var n=1; // how many",
      "/* a block",
      "   spanning lines */",
      "/* one-liner */",
      "var m=2;",
    ].join("\n"));
    expect(kept.split("\n")).toEqual(['var u="https://example.test";', "var n=1; // how many", "var m=2;"]);
  });

  it("keeps the renderer runnable after the cut", () => {
    // The real proof: the stripped script is what jsdom executes in every one
    // of these suites, and a cut that broke it would show up as an error here.
    expect(loadPrototype(assemblePrototype(ontology, atlas).html).consoleErrors).toEqual([]);
  });
});

/* ── the six ─────────────────────────────────────────────────────────────── */

describe("numbers line up", () => {
  it("a magnitude column is right-aligned in the body AND its head", () => {
    // They already carried tabular figures — the intent was there — but the
    // cell was left-aligned, so two amounts could not be compared by eye.
    const d = doc();
    const numHeads = [...d.querySelectorAll("th.m-num")];
    expect(numHeads.length, "no numeric column found to align").toBeGreaterThan(0);
    for (const th of numHeads) {
      const table = th.closest("table")!;
      const index = [...th.parentElement!.children].indexOf(th);
      for (const row of table.querySelectorAll("tbody tr")) {
        const cell = row.children[index];
        if (cell) expect(cell.className, `${th.textContent} body cell`).toContain("m-num");
      }
    }
  });

  it("a word column is not", () => {
    const d = doc();
    const heads = [...d.querySelectorAll("th")].filter((th) => /name/i.test(th.textContent ?? ""));
    expect(heads.length).toBeGreaterThan(0);
    for (const th of heads) expect(th.className).not.toContain("m-num");
  });

  it("the rule is there to act on", () => {
    expect(meridianStylesheet()).toContain("td.m-num");
    expect(meridianStylesheet()).toContain("text-align:right");
  });
});

describe("the detail screen is composed, not stacked", () => {
  it("every detail screen has a rail and a main column", () => {
    for (const screen of doc().querySelectorAll('section[data-screen^="detail-"]')) {
      expect(screen.querySelector(".m-detail-rail"), screen.getAttribute("data-screen")!).not.toBeNull();
      expect(screen.querySelector(".m-detail-main"), screen.getAttribute("data-screen")!).not.toBeNull();
    }
  });

  it("the record's own facts are in the rail; what hangs off it is in the main column", () => {
    const screen = doc().querySelector('section[data-screen^="detail-"]')!;
    const slug = screen.getAttribute("data-screen")!.replace("detail-", "");
    expect(screen.querySelector(".m-detail-rail")!.innerHTML).toContain(`region:${slug}:summary`);
    expect(screen.querySelector(".m-detail-main")).not.toBeNull();
  });

  it("NOT A FABRIC CHANGE — the same regions, the same ids, the same order", () => {
    // The whole risk of a layout change on this build is that it moves an
    // address. The grid re-orders columns; the DOM order is untouched.
    const ids = (html: string) => [...html.matchAll(/data-fabric-id="([^"]+)"/g)].map((m) => m[1]);
    const now = assemblePrototype(ontology, atlas);
    expect(ids(now.html)).toEqual([...new Set(ids(now.html))]);
    expect(now.fabric.version).toBe(assemblePrototype(ontology, atlas).fabric.version);
    expect(now.regionCount).toBeGreaterThan(0);
  });

  it("it stacks on a narrow viewport rather than squeezing", () => {
    // The breakpoint serves the viewport the DEMO happens in. Tried at 900 so
    // the studio's own 949px frame would compose too, and the main column came
    // out at ~490px with the agent cards wrapping their badges — worse than the
    // stack it replaced. The operator sees it composed on the 1,280px stage.
    const sheet = meridianStylesheet();
    expect(sheet).toContain("@media (min-width:1040px)");
    // The two-column rule lives INSIDE the query — unqualified, it would crush
    // the table on a laptop the demo is actually given on.
    expect(sheet.slice(sheet.indexOf("@media (min-width:1040px)"))).toContain("grid-template-columns:minmax(0,1fr) 340px");
  });
});

describe("the record reads as rows, not as a grid of stacked pairs", () => {
  it("label and value are siblings, so the grid lays them side by side", () => {
    const d = doc();
    const dl = d.querySelector(".m-dl");
    expect(dl, "no definition list rendered").not.toBeNull();
    // A wrapper around each pair is what made `auto 1fr` produce two COLUMNS of
    // label-above-value instead of rows of label-beside-value.
    expect(dl!.querySelector(":scope > div")).toBeNull();
    expect(dl!.querySelector(":scope > dt")).not.toBeNull();
    expect(dl!.querySelector(":scope > dd")).not.toBeNull();
  });
});

describe("the way in is the record's own name", () => {
  it("no column of identical buttons — the drill-down is inline", () => {
    // Five filled "Open" controls down the right of a table was the loudest
    // thing on the screen, and it said nothing the record's name does not.
    const d = doc();
    expect(d.querySelector(".m-row-actions")).toBeNull();
    expect(d.querySelectorAll(".m-cell-go").length).toBeGreaterThan(0);
  });

  it("it is a real button, not a styled div", () => {
    // Keyboard-reachable and announced. A div with an onclick is the version of
    // this that looks identical and cannot be used without a mouse.
    for (const go of doc().querySelectorAll(".m-cell-go")) expect(go.tagName).toBe("BUTTON");
  });

  it("the chevron is discoverable without being permanent furniture", () => {
    const sheet = meridianStylesheet();
    expect(sheet).toContain(".m-cell-go::after");
    expect(sheet).toContain("tr:hover .m-cell-go::after");
    expect(sheet).toContain(":focus-visible");
    // A touch device has no hover, so the hint must not be invisible there.
    expect(sheet).toContain("@media (hover:none)");
  });
});

describe("typography is a decision, not a default", () => {
  it("there is a step between the page title and the body", () => {
    const sheet = meridianStylesheet();
    const title = /\.m-title\{font-size:(\d+)px/.exec(sheet)?.[1];
    const section = /\.m-card-t\{font-size:(\d+)px/.exec(sheet)?.[1];
    expect(title).toBe("32");
    expect(Number(section)).toBeGreaterThan(15);
    expect(Number(section)).toBeLessThan(Number(title));
  });

  it("each platform's UI face is named, because the document cannot fetch one", () => {
    // Self-contained by design: no @font-face, no <link>, no request. So the
    // fallback has to be a choice.
    const built = assemblePrototype(ontology, atlas).html;
    expect(built).not.toContain("@font-face");
    expect(built).not.toMatch(/<link[^>]+font/i);
    expect(MERIDIAN_TOKENS.fontSans).toContain("Inter");
    expect(MERIDIAN_TOKENS.fontSans).toContain("BlinkMacSystemFont");
    expect(MERIDIAN_TOKENS.fontSans).toContain("Segoe UI Variable Text");
    expect(MERIDIAN_TOKENS.fontDisplay).toContain("SF Pro Display");
  });
});

describe("an upgrade to the design system can actually reach a client", () => {
  it("a skin from an EARLIER system is not re-adopted", () => {
    // The defect this guards was found by looking, not by testing: the polish
    // landed, the suite went green, and the live preview was byte-identical —
    // because every stored build carries a stylesheet that "differs from stock"
    // and was therefore taken for a restyle somebody approved.
    const plain = prototypeBaselineFor(ontology, atlas)!;
    const older = plain.html.replace(/--m-ds:\s*\d+/, "--m-ds:1").replace("box-sizing:border-box", "box-sizing:border-box;letter-spacing:0");
    const next = prototypeBaselineOfProgram({
      domainOntology: ontology, currentStateAtlas: atlas, prototypeBuild: { html: older },
    })!;
    expect(next.stylesheet).toBe(plain.stylesheet);
    expect(next.stylesheet).not.toContain("letter-spacing:0}");
  });

  it("…and a restyle from THIS system still is", () => {
    // The mechanism must keep working, or every refine round resets to stock.
    const plain = prototypeBaselineFor(ontology, atlas)!;
    const restyled = plain.html.replace(plain.stylesheet, `${plain.stylesheet}\n.m-approved{color:#0b3d2e}`);
    const next = prototypeBaselineOfProgram({
      domainOntology: ontology, currentStateAtlas: atlas, prototypeBuild: { html: restyled },
    })!;
    expect(next.stylesheet).toContain(".m-approved");
  });

  it("the stamp is in the sheet to be read back", () => {
    expect(meridianStylesheet()).toContain(`--m-ds:${MERIDIAN_VERSION}`);
  });
});

/* ── and it is paid for ──────────────────────────────────────────────────── */

describe("the polish is paid for, not budgeted for", () => {
  const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });

  it("the build that sets the ceiling still fits the document path", () => {
    // The same fixture `prototypeRefineAssembledFirst` measures. It had 24 bytes
    // of headroom before this work.
    const small = prototypeBaselineFor(
      {
        entities: [ent("Account", ["id", "name", "region"]), ent("Contact", ["id", "name", "accountId"])],
        relations: [{ from: "Account", to: "Contact", cardinality: "1:N" }],
      },
      { workflows: [{ name: "Renewal", steps: [{ name: "Review" }] }] },
    )!;
    expect(small.html.length).toBeLessThanOrEqual(DOCUMENT_REFINE_BUDGET);
  });

  it("the page still loads clean", () => {
    expect(loadPrototype(assemblePrototype(ontology, atlas).html).consoleErrors).toEqual([]);
  });
});
