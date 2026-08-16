/**
 * THE MODEL EMITS A SPEC, AND THE ASSEMBLER DRAWS IT.
 *
 * Free-form HTML is where the model-written build's defects lived: stat cards
 * out of flow over the tables, hiding a column on every screen; a row badged
 * "Qualified (BANT)" inside a table headed "Leads (Unqualified)"; three ontology
 * entities absent from the app while `gaps` came back `[]`. The answer is not a
 * better prompt — it is to take the markup away from the model and leave it the
 * judgement: WHICH screen deserves a funnel, WHICH number leads a list.
 *
 * These guards pin the two halves of that bargain:
 *
 *   1. AN INVALID REFERENCE FAILS LOUDLY. The schema is derived from the
 *      ontology, so an entity, attribute, screen or filter value the build does
 *      not hold is refused BY NAME into the artifact's gaps and never drawn.
 *   2. WHAT IS DRAWN PASSES THE RENDER GATE BY CONSTRUCTION. The output of a
 *      valid spec — including a deliberately adversarial one — is loaded and put
 *      through the same four checks (`src/v3/lib/prototypeQa.ts`) the free-form
 *      build failed all of.
 *
 * Everything is asserted against the LOADED DOCUMENT, never against a regex over
 * the assembler's source: the page draws its regions from a JSON island at load,
 * so the source is not the screen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { generateSeed } from "@shared/seedData.ts";
import {
  buildSpecSchema, validatePrototypeSpec, widgetRegionId, WIDGETS_PER_SCREEN,
} from "@shared/prototypeScreenSpec.ts";
import { prototypeBaselineFor, resolvePrototypeDoc, regionIdsIn, fabricIdsIn, screenIdsIn } from "@shared/prototypeRefine.ts";
import { auditPrototype } from "@/v3/lib/prototypeQa";
import { loadPrototype } from "./helpers/renderPrototype";

// ── the fixture: small, synthetic, and shaped like the build that failed ─────
const ontology = {
  entities: [
    { name: "Account", attributes: ["id", "name", "region", "annualRevenue"] },
    { name: "Lead", attributes: ["id", "name", "status", "source", "score", "conversionPercent", "accountId"] },
    { name: "Opportunity", attributes: ["id", "name", "stage", "amount", "accountId"] },
  ],
  relations: [
    { from: "Account", to: "Lead", cardinality: "1:N" },
    { from: "Account", to: "Opportunity", cardinality: "1:N" },
  ],
};
const atlas = { workflows: [{ name: "Qualify", owner: "Sales", steps: [{ action: "Score the lead", entities: ["Lead"] }] }] };
/**
 * The value vocabulary that reproduces the ORIGINAL DEFECT'S RAW MATERIAL: a
 * status whose two values negate each other. "Qualified" inside a section headed
 * "Unqualified" is the contradiction the render gate exists to catch, and a
 * fixture that cannot produce it would let the guard below pass vacuously.
 */
const vocabulary = {
  "Lead.status": ["Qualified", "Unqualified"],
  "Opportunity.stage": ["Discovery", "Proposal", "Closed Won"],
};

const build = (spec?: unknown) => assemblePrototype(ontology, atlas, undefined, { vocabulary, ...(spec === undefined ? {} : { spec }) });
const bare = build();
const seed = generateSeed(ontology, bare.fabric.version, { vocabulary });
const leads = seed.records.Lead ?? [];
const countWhere = (attribute: string, value: string) => leads.filter((r) => String(r[attribute]) === value).length;

const goodSpec = {
  screens: [
    {
      screen: "list-lead",
      widgets: [
        { kind: "stat", entity: "Lead" },
        { kind: "stat", entity: "Lead", where: { attribute: "status", equals: "Unqualified" } },
        { kind: "stat", entity: "Lead", measure: "conversionPercent" },
        { kind: "breakdown", entity: "Lead", attribute: "status" },
      ],
    },
    {
      screen: "list-opportunity",
      widgets: [
        { kind: "funnel", entity: "Opportunity", attribute: "stage" },
        { kind: "stat", entity: "Opportunity", measure: "amount" },
      ],
    },
  ],
};

const load = (html: string, url = "https://prototype.test/#lead") =>
  loadPrototype(html, { entities: ontology.entities.map((e) => e.name), url });
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const bandIn = (doc: Document, screen: string, band: "stats" | "charts") =>
  doc.querySelector(`[data-region="${widgetRegionId(screen, band)}"]`);

/**
 * The heading the render gate will read for a table: the nearest preceding text,
 * walking outward — the same walk `sectionsOf` performs. Asserted directly as
 * well as through the gate, so the property holds whatever the labels happen to
 * be long enough for.
 */
function headingOf(table: Element): string {
  let node: Element = table;
  for (let hop = 0; hop < 4 && node.parentElement; hop += 1) {
    const parent: Element = node.parentElement;
    const kids = [...parent.children];
    const before = kids.slice(0, kids.indexOf(node)).map((k) => text(k)).filter(Boolean);
    const heading = before[before.length - 1] ?? "";
    if (heading) return heading;
    node = parent;
  }
  return "";
}

// ── 1 · the schema is the ontology's, not the model's memory ────────────────
describe("the spec schema is derived from the ontology", () => {
  const schema = bare.specSchema;

  it("lists exactly the entities and screens this build has", () => {
    expect(schema.entities.map((e) => e.entity).sort()).toEqual(["Account", "Lead", "Opportunity"]);
    const doc = load(bare.html).doc;
    for (const e of schema.entities) {
      expect(doc.querySelector(`[data-screen="${e.screen}"]`), `${e.screen} must be a screen in the build`).not.toBeNull();
    }
  });

  it("separates what can be measured from what can be grouped by", () => {
    const lead = schema.entities.find((e) => e.entity === "Lead")!;
    expect(lead.measures).toContain("score");
    expect(lead.measures).toContain("conversionPercent");
    // A share of a whole is averaged, never totalled — read off the derived
    // role, not guessed back out of the name.
    expect(lead.shares).toEqual(["conversionPercent"]);
    expect(lead.dimensions).toContain("status");
    // A number is not a grouping, and a free-text name is neither.
    expect(lead.dimensions).not.toContain("score");
    expect([...lead.measures, ...lead.dimensions]).not.toContain("name");
    // Nothing in the schema names anything the ontology does not hold.
    const held = new Set(ontology.entities.flatMap((e) => e.attributes));
    for (const e of schema.entities) for (const a of [...e.measures, ...e.dimensions]) expect(held.has(a)).toBe(true);
  });

  it("shrinks with the operator's menu — a spec cannot reference a screen nobody built", () => {
    const curated = assemblePrototype(ontology, atlas, ["Lead"], { vocabulary });
    expect(curated.specSchema.entities.map((e) => e.entity)).toEqual(["Lead"]);
    const { violations, accepted } = validatePrototypeSpec(
      { screens: [{ screen: "list-opportunity", widgets: [{ kind: "stat", entity: "Opportunity" }] }] },
      curated.specSchema,
    );
    expect(accepted).toBe(0);
    expect(violations.join(" ")).toContain("list-opportunity");
  });
});

// ── 2 · an invalid reference fails loudly rather than rendering ─────────────
describe("an invalid reference is refused by name", () => {
  const refuse = (widget: Record<string, unknown>, screen = "list-lead") =>
    build({ screens: [{ screen, widgets: [widget] }] });

  /** what is asked for · the name the refusal must state · the label the page
   *  must NOT carry, which is what "refused" means when nobody is looking. */
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ["an entity the ontology does not hold", { kind: "stat", entity: "Deal" }, "Deal", "Deal"],
    ["an attribute the entity does not hold", { kind: "breakdown", entity: "Lead", attribute: "temperature" }, "temperature", "Lead by Temperature"],
    ["a grouping by a measured value", { kind: "funnel", entity: "Lead", attribute: "score" }, "score", "Lead by Score"],
    ["a total of a label", { kind: "stat", entity: "Lead", measure: "status" }, "status", "Total Status"],
    ["a widget kind the renderer does not draw", { kind: "sankey", entity: "Lead" }, "sankey", "sankey"],
    ["a filter on an attribute that is not groupable", { kind: "stat", entity: "Lead", where: { attribute: "score", equals: "9" } }, "score", "Lead — Score"],
  ];

  for (const [what, widget, named, absent] of cases) {
    it(`refuses ${what}, and draws nothing`, () => {
      const out = refuse(widget);
      expect(out.specAccepted).toBe(0);
      expect(out.specViolations.join(" ")).toContain(named);
      // THE PROPERTY: refused means NOT ON THE PAGE. Not "flagged and rendered".
      const doc = load(out.html).doc;
      expect(doc.querySelectorAll('[data-region^="widget:"]').length).toBe(0);
      expect(doc.body.textContent).not.toContain(absent);
    });
  }

  it("refuses a screen this build does not have", () => {
    const out = refuse({ kind: "stat", entity: "Lead" }, "list-invoice");
    expect(out.specAccepted).toBe(0);
    expect(out.specViolations.join(" ")).toContain("list-invoice");
    // …and says what WOULD have worked, so the next attempt is not another guess.
    expect(out.specViolations.join(" ")).toContain("list-lead");
  });

  it("refuses a filter on a value no record holds — the \"Qualified (BANT)\" defect", () => {
    const out = refuse({ kind: "stat", entity: "Lead", where: { attribute: "status", equals: "Qualified (BANT)" } });
    expect(out.specAccepted).toBe(0);
    const said = out.specViolations.join(" ");
    expect(said).toContain("Qualified (BANT)");
    expect(said).toContain("Unqualified");            // the values that DO occur, quoted back
    expect(load(out.html).doc.body.textContent).not.toContain("Qualified (BANT)");
  });

  it("refuses a total of a share, because a sum of percentages states nothing", () => {
    const out = refuse({ kind: "stat", entity: "Lead", measure: "conversionPercent", agg: "sum" });
    expect(out.specAccepted).toBe(0);
    expect(out.specViolations.join(" ")).toMatch(/share of a whole|avg/i);
    // …and the same measure averaged is drawn.
    expect(build({ screens: [{ screen: "list-lead", widgets: [{ kind: "stat", entity: "Lead", measure: "conversionPercent" }] }] }).specAccepted).toBe(1);
  });

  it("holds the per-screen budget, and names what it dropped", () => {
    const widgets = Array.from({ length: WIDGETS_PER_SCREEN + 2 }, () => ({ kind: "stat", entity: "Lead" }));
    const out = build({ screens: [{ screen: "list-lead", widgets }] });
    expect(out.specAccepted).toBe(WIDGETS_PER_SCREEN);
    expect(out.specViolations.length).toBe(2);
    const doc = load(out.html).doc;
    expect(bandIn(doc, "list-lead", "stats")!.querySelectorAll(".m-stat").length).toBe(WIDGETS_PER_SCREEN);
  });

  it("survives a spec that is not a spec at all", () => {
    for (const junk of ["", 7, [], { screens: "all of them" }, { screens: [null, { screen: "list-lead", widgets: [42] }] }]) {
      const out = build(junk);
      expect(out.specAccepted).toBe(0);
      expect(out.specViolations.length).toBeGreaterThan(0);
      expect(load(out.html).consoleErrors).toEqual([]);
    }
  });
});

// ── 3 · nothing the model WRITES reaches the document ──────────────────────
describe("the model contributes judgement, never markup", () => {
  it("ignores every string the spec carries that is not a reference", () => {
    const hostile = {
      screens: [{
        screen: "list-lead",
        widgets: [{
          kind: "stat", entity: "Lead",
          label: "MODEL WROTE THIS", caption: "<script>alert(1)</script>", title: "97% conversion",
          html: "<div style='position:absolute;top:0'>floating</div>",
          style: "position:absolute", className: "m-floating", value: 9999,
        }],
      }],
    };
    const out = build(hostile);
    expect(out.specAccepted).toBe(1);
    const rendered = load(out.html).doc.body.textContent ?? "";
    for (const written of ["MODEL WROTE THIS", "alert(1)", "97% conversion", "floating", "9999"]) {
      expect(rendered).not.toContain(written);
    }
    // What IS there is derived: the entity's own name, and the count of its rows.
    expect(text(bandIn(load(out.html).doc, "list-lead", "stats"))).toContain(String(leads.length));
    expect(out.html).not.toContain("position:absolute");
  });
});

// ── 4 · what is drawn passes the render gate ───────────────────────────────
describe("the renderer's output passes the render-QA gate", () => {
  const out = build(goodSpec);
  const loaded = load(out.html);

  it("draws every accepted widget, and reports no gap", () => {
    expect(out.specViolations).toEqual([]);
    expect(out.specAccepted).toBe(6);
    expect([...new Set(regionIdsIn(out.html))].filter((r) => r.startsWith("widget:")).sort())
      .toEqual(["widget:list-lead:charts", "widget:list-lead:stats", "widget:list-opportunity:charts", "widget:list-opportunity:stats"]);
  });

  it("passes all four checks — overlap, console, coverage, header agreement", () => {
    const report = auditPrototype(loaded);
    expect(report.errors.map((f) => `[${f.check}] ${f.message}`)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(loaded.consoleErrors).toEqual([]);
  });

  it("keeps the summary band out of the table's flow, and out of its heading", () => {
    const doc = loaded.doc;
    const band = bandIn(doc, "list-lead", "stats")!;
    // IN FLOW. The defect was a card that reserved no space and painted over the
    // columns; the band is a block in the ordinary layout and says so.
    for (const el of [band, band.parentElement!, ...band.querySelectorAll(".m-stat")]) {
      const cs = loaded.styleOf(el);
      expect(["static", ""]).toContain(cs.position);
      expect(cs.float === "none" || !cs.float).toBe(true);
    }
    // NOT THE TABLE'S HEADING. A band of filtered numbers immediately above an
    // unfiltered table reads as that table's header — to a person and to the
    // gate alike — which is the "Leads (Unqualified)" contradiction. The list
    // carries its own heading, and it is true of every row under it.
    const table = doc.querySelector('[data-fabric-id="screen:lead:list"] table')!;
    expect(table).not.toBeNull();
    expect(headingOf(table)).toBe("All Lead");
  });

  it("does not let a filtered number become the unfiltered table's header", () => {
    // THE ORIGINAL DEFECT, REPRODUCED AS FAR AS IT CAN BE: one filtered stat —
    // short enough that the gate WILL read it as a heading if it is the nearest
    // text above the table — over a table whose rows hold the value that negates
    // it. "Unqualified" heading, "Qualified" rows: the gate fails exactly this
    // pair, and the only thing standing between them is the list's own heading.
    const one = build({
      screens: [{ screen: "list-lead", widgets: [{ kind: "stat", entity: "Lead", where: { attribute: "status", equals: "Unqualified" } }] }],
    });
    const loadedOne = load(one.html);
    const band = bandIn(loadedOne.doc, "list-lead", "stats")!;
    expect(text(band)).toContain("Unqualified");
    expect(text(band).length).toBeLessThan(160);      // short enough to be read as a heading
    const table = loadedOne.doc.querySelector('[data-fabric-id="screen:lead:list"] table')!;
    expect(text(table)).toContain("Qualified");        // and the rows below it deny it
    const report = auditPrototype(loadedOne);
    expect(report.byCheck["header-agreement"]).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("counts what is on the page, not what the model believed", () => {
    const doc = loaded.doc;
    const stats = [...bandIn(doc, "list-lead", "stats")!.querySelectorAll(".m-stat")];
    expect(stats.length).toBe(3);
    expect(text(stats[0].querySelector(".m-stat-v"))).toBe(leads.length.toLocaleString("en-US"));
    // The filtered stat counts exactly the rows that hold the value it names.
    expect(text(stats[1].querySelector(".m-stat-k"))).toContain("Unqualified");
    expect(text(stats[1].querySelector(".m-stat-v"))).toBe(String(countWhere("status", "Unqualified")));
    // …and the breakdown's bars add up to the whole population.
    const bars = [...bandIn(doc, "list-lead", "charts")!.querySelectorAll(".m-bar")];
    expect(bars.length).toBe(2);
    expect(bars.reduce((n, b) => n + Number(text(b.querySelector(".m-bar-v"))), 0)).toBe(leads.length);
    for (const bar of bars) expect(countWhere("status", text(bar.querySelector(".m-bar-k")))).toBe(Number(text(bar.querySelector(".m-bar-v"))));
  });

  it("draws the numbers at load from the same rows the tables read", () => {
    // The served bytes carry an EMPTY band: a number baked at assembly time is a
    // second source of truth, and the first thing a session that deletes a row
    // makes wrong.
    expect(out.html).toContain(`data-region="${widgetRegionId("list-lead", "stats")}"></div>`);
    expect(text(bandIn(loaded.doc, "list-lead", "stats"))).not.toBe("");
  });

  it("orders a funnel by volume and a breakdown by name", () => {
    const funnel = [...bandIn(load(out.html, "https://prototype.test/#opportunity").doc, "list-opportunity", "charts")!.querySelectorAll(".m-bar")];
    const counts = funnel.map((b) => Number(text(b.querySelector(".m-bar-v"))));
    expect(counts.length).toBeGreaterThan(1);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    const breakdown = [...bandIn(loaded.doc, "list-lead", "charts")!.querySelectorAll(".m-bar-k")].map((b) => text(b));
    expect([...breakdown].sort()).toEqual(breakdown);
  });
});

// ── 5 · the spec adds; it never moves the structure ────────────────────────
describe("a spec cannot move the structure it decorates", () => {
  const out = build(goodSpec);

  it("leaves the fabric, the screens and the seeded values exactly as they were", () => {
    expect(out.fabric.version).toBe(bare.fabric.version);
    expect(out.regionCount).toBe(bare.regionCount);
    expect([...new Set(fabricIdsIn(out.html))].sort()).toEqual([...new Set(fabricIdsIn(bare.html))].sort());
    expect([...new Set(screenIdsIn(out.html))].sort()).toEqual([...new Set(screenIdsIn(bare.html))].sort());
  });

  it("is deterministic — the same spec draws the same bytes", () => {
    expect(build(goodSpec).html).toBe(out.html);
    expect(build(JSON.parse(JSON.stringify(goodSpec))).html).toBe(out.html);
  });

  it("costs a build with no spec nothing at all", () => {
    // No band in the document (the class vocabulary is always in the stylesheet;
    // what must be absent is any element using it), no renderer segment, and no
    // key for one in the data island.
    expect(load(bare.html).doc.querySelectorAll(".m-widgets, [data-region^='widget:']").length).toBe(0);
    expect(bare.html).not.toContain("function renderWidgets");   // the segment is not shipped
    expect(bare.html).not.toContain('"widgets"');          // …and the island has no key for it
    expect(bare.specViolations).toEqual([]);
    expect(bare.specAccepted).toBe(0);
    expect(load(bare.html).consoleErrors).toEqual([]);
  });
});

// ── 6 · the refine path: drawn, or declared ────────────────────────────────
describe("a screen spec on the refine path", () => {
  const baseline = prototypeBaselineFor(ontology, atlas, undefined, { vocabulary })!;

  it("is drawn into the stored build, and counted on the record", () => {
    const { doc, source } = resolvePrototypeDoc({ screenSpec: goodSpec }, baseline);
    expect(source).toBe("assembled");
    const html = String(doc.html);
    expect(regionIdsIn(html).filter((r) => r.startsWith("widget:")).length).toBe(4);
    expect((doc._prototypeStructure as Record<string, unknown>).widgets).toBe(6);
    expect(doc.gaps).toEqual([]);                        // nothing was refused, so nothing is claimed
    // …and the structure is still the assembled structure.
    expect([...new Set(fabricIdsIn(html))].sort()).toEqual(baseline.fabricIds);
  });

  it("writes every refusal into the artifact's gaps — a miss stays visible", () => {
    const { doc } = resolvePrototypeDoc({
      screenSpec: { screens: [{ screen: "list-lead", widgets: [{ kind: "stat", entity: "Pipeline" }] }] },
      gaps: ["a gap the model wrote"],
    }, baseline);
    const gaps = (doc.gaps as string[]).join(" ");
    expect(gaps).toContain("a gap the model wrote");
    expect(gaps).toContain("Pipeline");
    expect(String(doc.html)).toBe(baseline.html);        // nothing drawn, nothing changed
  });

  it("keeps what a round accepted, so the loop accumulates", () => {
    // ROUND 1 draws the spec and stores it with the build it produced.
    const round1 = resolvePrototypeDoc({ screenSpec: goodSpec }, baseline).doc;
    expect(round1.screenSpec).toEqual(goodSpec);
    // ROUND 2 re-derives the skeleton from the ontology — as it must — and the
    // judgement round 1 made is still in the application the model is handed.
    const next = prototypeBaselineFor(ontology, atlas, undefined, { vocabulary, screenSpec: round1.screenSpec })!;
    expect(regionIdsIn(next.html).filter((r) => r.startsWith("widget:")).length).toBe(4);
    expect(next.fabricIds).toEqual(baseline.fabricIds);
    // …and a round in which the model says nothing about the screens leaves them
    // exactly as they were, rather than quietly undoing the round before it.
    const silent = resolvePrototypeDoc({ styleCss: ".m-card{border:0}" }, next).doc;
    expect(regionIdsIn(String(silent.html)).filter((r) => r.startsWith("widget:")).length).toBe(4);
    expect(silent.screenSpec).toEqual(goodSpec);
    // A NEW spec replaces the old one — round two may put the funnel elsewhere —
    // and the bands the old one owned go with it.
    const moved = { screens: [{ screen: "list-account", widgets: [{ kind: "stat", entity: "Account", measure: "annualRevenue" }] }] };
    const round3 = resolvePrototypeDoc({ screenSpec: moved }, next).doc;
    expect(regionIdsIn(String(round3.html)).filter((r) => r.startsWith("widget:")))
      .toEqual([widgetRegionId("list-account", "stats")]);
    expect(round3.screenSpec).toEqual(moved);
  });

  it("re-checks the carried spec against the ontology it now has", () => {
    // The ontology moves. A widget the previous round drew against an entity
    // this one no longer holds does not quietly stop appearing: it is refused
    // again, out loud, on every run that inherits it.
    const shrunk = { entities: ontology.entities.filter((e) => e.name !== "Lead"), relations: [] };
    const inherited = prototypeBaselineFor(shrunk, atlas, undefined, { screenSpec: goodSpec })!;
    expect(inherited.specAccepted).toBe(2);                       // the Opportunity pair still draws
    expect(inherited.specViolations.join(" ")).toContain("list-lead");
    const { doc } = resolvePrototypeDoc({}, inherited);
    expect((doc.gaps as string[]).join(" ")).toContain("list-lead");
    expect((doc._prototypeStructure as Record<string, unknown>).widgets).toBe(2);
  });

  it("carries the skin the operator already approved", () => {
    const skinned = resolvePrototypeDoc({ styleCss: ".m-card{outline:3px solid #123456}" }, baseline).doc;
    const second = prototypeBaselineFor(ontology, atlas, undefined, { vocabulary })!;
    const withSkin = { ...second, html: String(skinned.html), stylesheet: ".m-card{outline:3px solid #123456}" };
    const { doc } = resolvePrototypeDoc({ screenSpec: goodSpec }, withSkin);
    expect(String(doc.html)).toContain("#123456");
    expect(regionIdsIn(String(doc.html)).filter((r) => r.startsWith("widget:")).length).toBe(4);
  });

  it("rejects a returned document that dropped the bands it was given", () => {
    const drawn = String(resolvePrototypeDoc({ screenSpec: goodSpec }, baseline).doc.html);
    // The model returns the document with one band deleted — the widgets carry
    // no fabric id, so nothing else in the check would notice.
    const stripped = drawn.replace(`<div class="m-stats" data-region="${widgetRegionId("list-lead", "stats")}"></div>`, "");
    expect(stripped).not.toBe(drawn);
    const { source, verdict } = resolvePrototypeDoc({ screenSpec: goodSpec, html: stripped }, baseline);
    expect(source).toBe("assembled");
    expect(verdict!.droppedFills).toContain(widgetRegionId("list-lead", "stats"));
  });

  it("is wired into the edge on both sides of the call", () => {
    // The two ends no unit test can reach: the schema going out with the brief,
    // and the accepted spec coming back on the record for the next round.
    const edge = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");
    expect(edge).toMatch(/screenSpec:\s*priorBuild\?\.screenSpec/);
    expect(edge).toContain("prototypeRefineBrief.screenSpecSchema");
    expect(edge).toContain('"screenSpec"');
  });

  it("puts the schema in the brief the model is given, and nothing it must invent", () => {
    expect(baseline.specSchema.entities.map((e) => e.screen)).toEqual(baseline.specSchema.entities.map((e) => e.screen).filter((s) => baseline.screenIds.includes(s)));
    expect(baseline.specSchema.rules.join(" ")).toMatch(/refused|gap/i);
  });
});

// ── 7 · the validator alone, without an assembly ───────────────────────────
describe("validation is a pure function of the schema", () => {
  const schema = buildSpecSchema({
    version: "test",
    entities: [{ entity: "Case", screen: "list-case", attributes: [{ name: "priority", role: "priority" }, { name: "hours", role: "quantity" }] }],
  });

  it("accepts what the schema allows and refuses what it does not", () => {
    const ok = validatePrototypeSpec({ screens: [{ screen: "list-case", widgets: [{ kind: "breakdown", entity: "Case", attribute: "priority" }] }] }, schema);
    expect(ok.violations).toEqual([]);
    expect(ok.screens[0].widgets[0].label).toBe("Case by Priority");
    const bad = validatePrototypeSpec({ screens: [{ screen: "list-case", widgets: [{ kind: "breakdown", entity: "Case", attribute: "hours" }] }] }, schema);
    expect(bad.accepted).toBe(0);
    expect(bad.violations.join(" ")).toContain("hours");
  });

  it("does not check values when it has no data to check them against", () => {
    const noData = validatePrototypeSpec(
      { screens: [{ screen: "list-case", widgets: [{ kind: "stat", entity: "Case", where: { attribute: "priority", equals: "Urgent" } }] }] },
      schema,
    );
    expect(noData.accepted).toBe(1);
    // …and does when it has.
    const withData = validatePrototypeSpec(
      { screens: [{ screen: "list-case", widgets: [{ kind: "stat", entity: "Case", where: { attribute: "priority", equals: "Urgent" } }] }] },
      schema,
      { valuesOf: () => ["High", "Low"] },
    );
    expect(withData.accepted).toBe(0);
    expect(withData.violations.join(" ")).toContain("High, Low");
  });
});
