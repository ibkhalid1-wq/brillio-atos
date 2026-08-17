/**
 * A DEMO SCRIPT IS READ ALOUD IN FRONT OF A CLIENT.
 *
 * Which makes it the one document where a wrong sentence is not a defect
 * somebody fixes later — it is a presenter saying "and here you'd see the
 * dashboard" to a room looking at a screen that has no dashboard.
 *
 * MEASURED, on the surgery programme, before this existed. The script told the
 * presenter to show a "Performance Trend timeline for Hospital", a "dashboard",
 * and a "Set Target action" they could click. The build has none of those: no
 * dashboard screen, no timeline, and "Set targets and priorities for surgical
 * teams" appears exactly once — as a read-only STEP on a workbench, describing
 * the work rather than performing it. The script was written from the Experience
 * Design's intent and the built prototype was not one of its inputs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { checkDemoScripts, demoBriefOf, type DemoBrief } from "@shared/demoScriptCheck.ts";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

const built = assemblePrototype(ontology, atlas);
const names = (ontology.entities as Array<{ name: string }>).map((e) => e.name);
const brief = demoBriefOf(built.html, names);

const script = (show: string) => ({
  scripts: [{ stakeholder: "David Simaon", role: "Executive Sponsor", steps: [{ beat: "Review the numbers", show }] }],
});

describe("the inventory is read off the build, not off the design", () => {
  it("finds the screens the build actually routes to", () => {
    // Not "approvals": that screen exists only where a blueprint gates an
    // agent, and this fixture passes none — asserting it would have pinned a
    // screen the build is right not to draw.
    expect(brief.screens.some((s) => s.startsWith("list-"))).toBe(true);
    expect(brief.screens.some((s) => s.startsWith("detail-"))).toBe(true);
    expect(brief.screens.some((s) => s.startsWith("work-"))).toBe(true);
    expect(brief.screens).not.toContain("dashboard");
  });

  it("finds the controls it draws, by the label a presenter would say", () => {
    expect(brief.actions).toContain("Edit");
    expect(brief.actions.some((a) => a.startsWith("New "))).toBe(true);
  });

  it("only lists an entity that HAS a screen — a beat cannot open what was not built", () => {
    for (const e of brief.entities) {
      const slug = e.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      expect(brief.screens.some((s) => s === `list-${slug}` || s === `detail-${slug}`), e).toBe(true);
    }
    expect(brief.entities.length).toBeLessThanOrEqual(names.length);
  });
});

describe("a beat the build cannot honour is marked, not deleted", () => {
  it("a dashboard IS satisfiable now — the measures band is one", () => {
    // This changed when the workbench gained "Where this stands". Before it, the
    // beat was a gap; the honest answer is that the build now draws a summary,
    // so the script may promise one.
    expect(brief.hasMeasures).toBe(true);
    expect(checkDemoScripts(script("Set Target action on the dashboard, updating the target cancellation rate."), brief).gaps).toEqual([]);
  });

  it("…but a TREND OVER TIME never is — nothing in this product draws one", () => {
    // THE DEFECT, verbatim from the live document. The widget kinds are stat,
    // breakdown and funnel: bars, never a time series. Saying so beats
    // pretending a bar chart is a trend.
    const out = checkDemoScripts(script("Performance Trend timeline for Hospital, showing historical and current cancellation rates."), brief);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0]).toContain("David Simaon");
    expect(out.gaps[0]).toContain("trend over time");
  });

  it("and a chart needs a widget the DESIGN asked for, not the derived band", () => {
    // The band draws badges; only a spec widget draws bars. Keying this on
    // `.m-stat` made every build look widgeted the moment the band shipped, and
    // the check silently stopped firing — caught by these cases going green
    // when they should have stayed red.
    expect(brief.hasWidgets).toBe(false);
    expect(checkDemoScripts(script("A bar chart of cancellations by unit."), brief).gaps).toHaveLength(1);
    expect(checkDemoScripts(script("A bar chart of cancellations by unit."), { ...brief, hasWidgets: true }).gaps).toEqual([]);
  });

  it("KEEPS the beat and marks it — deleting it would hide the gap it proves", () => {
    // What the design intended is worth knowing; a silent drop would leave the
    // team believing the build covers a story it does not.
    const out = checkDemoScripts(script("A sparkline of cancellation rates over time."), brief);
    const step = (out.doc.scripts as Array<{ steps: Array<Record<string, unknown>> }>)[0].steps[0];
    expect(step.beat).toBe("Review the numbers");
    expect(step.unbuilt).toContain("does not draw");
  });

  it("passes a beat the build can honour", () => {
    const out = checkDemoScripts(script("The Hospital list, filtered to the ones with open cancellations."), brief);
    expect(out.gaps).toEqual([]);
    expect(out.checked).toBe(1);
  });

  it("does not cry wolf on the words every beat uses", () => {
    // "screen", "page", "view" appear in almost every show line. Flagging them
    // would make the whole check unreadable, and a gap channel that cries wolf
    // stops being read — the lesson six false verb refusals already taught.
    for (const show of ["The Hospital screen.", "Their own page of records.", "A view of today's work."]) {
      expect(checkDemoScripts(script(show), brief).gaps, show).toEqual([]);
    }
  });

  it("a widget does not buy a time series either", () => {
    // "by month" is a trend, and the funnel/breakdown/stat set cannot draw one
    // however many widgets the design asked for.
    const withWidgets: DemoBrief = { ...brief, hasWidgets: true };
    expect(checkDemoScripts(script("A chart of cancellations over time."), withWidgets).gaps).toHaveLength(1);
    expect(checkDemoScripts(script("A chart of cancellations by unit."), withWidgets).gaps).toEqual([]);
  });

  it("counts what it checked, so a silent no-op is visible", () => {
    expect(checkDemoScripts({ scripts: [] }, brief).checked).toBe(0);
    expect(checkDemoScripts({}, brief).doc.scripts).toEqual([]);
  });
});

describe("the build is an input, and the check is enforced", () => {
  const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

  it("the prototype is upstream of the script that describes it", () => {
    expect(EDGE).toMatch(/demoScripts: \["prototypeBuild"/);
  });

  it("the model is handed the inventory, not merely judged against it", () => {
    expect(EDGE).toContain("demoScriptsBrief(inner)");
    expect(EDGE).toContain("SHOW ONLY WHAT THE BUILD DRAWS");
  });

  it("and the answer is checked before it is stored", () => {
    expect(EDGE).toContain('request.agentId === "demo-scripts"');
    expect(EDGE).toContain("checkDemoScripts(formalResult");
  });
});
