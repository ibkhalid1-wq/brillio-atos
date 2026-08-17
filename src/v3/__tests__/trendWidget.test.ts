/**
 * IS THIS GETTING BETTER OR WORSE — the question nothing could answer.
 *
 * The widget kinds were stat, breakdown and funnel: all snapshots of NOW. So the
 * one thing an oversight role actually asks had no answer on any screen, and a
 * demo script written for an executive promised a "Performance Trend timeline"
 * that the product could not draw in any form. The demo-script check reported it
 * as an always-gap, which was honest and unsatisfying.
 *
 * `trend` closes it: rows bucketed by MONTH of a date attribute and counted,
 * drawn from the same records the table below lists.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { demoBriefOf, checkDemoScripts } from "@shared/demoScriptCheck.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

/** The first entity that has both a list screen and a date to trend over. */
const target = (() => {
  const built = assemblePrototype(ontology, atlas);
  const e = built.specSchema.entities.find((x) => x.periods.length > 0);
  if (!e) throw new Error("no entity carries a date role — the fixture cannot exercise a trend");
  return { entity: e.entity, screen: e.screen, attribute: e.periods[0] };
})();

const withTrend = () => assemblePrototype(ontology, atlas, undefined, {
  spec: { screens: [{ screen: target.screen, widgets: [{ kind: "trend", entity: target.entity, attribute: target.attribute }] }] },
});

describe("a trend is a real widget, validated like every other", () => {
  it("the schema offers the kind and says which attributes can carry it", () => {
    const built = assemblePrototype(ontology, atlas);
    expect(built.specSchema.kinds).toContain("trend");
    // Dates only. A trend over a status would be a bar chart wearing a date's name.
    const e = built.specSchema.entities.find((x) => x.entity === target.entity)!;
    expect(e.periods).toContain(target.attribute);
    expect(e.periods.every((p) => !e.dimensions.includes(p))).toBe(true);
  });

  it("refuses a trend over something that is not a date, and says what is", () => {
    const built = assemblePrototype(ontology, atlas);
    const e = built.specSchema.entities.find((x) => x.entity === target.entity)!;
    const notDate = e.dimensions[0] ?? "nonesuch";
    const out = assemblePrototype(ontology, atlas, undefined, {
      spec: { screens: [{ screen: target.screen, widgets: [{ kind: "trend", entity: target.entity, attribute: notDate }] }] },
    });
    expect(out.specAccepted).toBe(0);
    expect(out.specViolations.join(" ")).toContain("datable:");
  });

  it("draws bars over months from the seeded rows", () => {
    const out = withTrend();
    expect(out.specAccepted).toBe(1);
    const d = loadPrototype(out.html).window.document;
    const spark = d.querySelector(".m-spark");
    expect(spark, "no trend rendered").not.toBeNull();
    const cols = [...spark!.querySelectorAll(".m-spark-c")];
    expect(cols.length).toBeGreaterThan(0);
    // Every column is a month key and a count — no invented labels.
    for (const c of cols) {
      expect(c.querySelector(".m-spark-k")?.textContent).toMatch(/^\d{2}$/);
      expect(Number(c.querySelector(".m-spark-v")?.textContent)).toBeGreaterThan(0);
    }
  });

  it("the counts add up to the rows it was drawn from", () => {
    // A summary that disagrees with its own records is the contradiction the
    // widget module exists to make impossible.
    const d = loadPrototype(withTrend().html).window.document;
    const total = [...d.querySelectorAll(".m-spark-c .m-spark-v")]
      .reduce((n, e) => n + Number(e.textContent), 0);
    const badge = d.querySelector(".m-spark")!.closest("section")!.querySelector(".m-badge")!.textContent!;
    expect(total).toBeGreaterThan(0);
    expect(badge).toMatch(/month/);
  });

  it("the page still loads clean", () => {
    expect(loadPrototype(withTrend().html).consoleErrors).toEqual([]);
  });
});

describe("and the demo script may now promise one — where the design asked", () => {
  const beat = (show: string) => ({ scripts: [{ stakeholder: "David", steps: [{ beat: "b", show }] }] });

  it("a build with no trend still refuses the promise", () => {
    const plain = assemblePrototype(ontology, atlas);
    const brief = demoBriefOf(plain.html, [target.entity]);
    expect(brief.hasTrend).toBe(false);
    expect(checkDemoScripts(beat("A timeline of cancellations over time."), brief).gaps).toHaveLength(1);
  });

  it("a build that draws one lets it through", () => {
    const brief = demoBriefOf(withTrend().html, [target.entity]);
    expect(brief.hasTrend).toBe(true);
    expect(checkDemoScripts(beat("A timeline of cancellations over time."), brief).gaps).toEqual([]);
  });

  it("a bar breakdown does NOT buy a trend — the same lie in a smaller hat", () => {
    const plain = assemblePrototype(ontology, atlas);
    const brief = { ...demoBriefOf(plain.html, [target.entity]), hasWidgets: true, hasTrend: false };
    expect(checkDemoScripts(beat("A sparkline of cancellations."), brief).gaps).toHaveLength(1);
  });
});
