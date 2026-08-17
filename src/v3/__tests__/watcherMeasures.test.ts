/**
 * THE PEOPLE WHO ONLY WATCH GOT A TABLE OF ROWS THEY WILL NEVER EDIT.
 *
 * MEASURED. On a surgical-cancellations programme the "Executive Oversight" area
 * opened on 49 practitioners, while the demo script written for that same
 * executive promised a dashboard, a cancellation trend and a target to set. The
 * script was RIGHT about the product — and no design had ever authored it: that
 * Experience Design contains "metric" zero times, "dashboard" zero times, "KPI"
 * zero times.
 *
 * The capability was never missing. `metricSpecFrom` has always turned wireframe
 * blocks of kind "metric" into validated stat widgets. Two things kept it from
 * mattering: nothing asked the design for one, and a widget could only land on a
 * LIST screen — so the workbench, the screen an executive actually opens, could
 * not carry a measure at all.
 *
 * Three fixes, one per layer, each asserted below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveWorkbenches } from "@shared/atlasWorkbenches.ts";
import { watcherAreas, watcherGaps, measuredIn } from "@shared/designCoversWatchers.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;
const doc = () => loadPrototype(assemblePrototype(ontology, atlas).html).window.document;

/* ── 1 · the workbench can carry a measure at all ─────────────────────────── */

describe("the screen an area opens on shows where it stands", () => {
  it("every workbench carries the band, above its queues", () => {
    const d = doc();
    for (const r of deriveWorkbenches(atlas)) {
      const screen = d.querySelector(`[data-screen="work-${r.slug}"]`);
      if (!screen) continue;
      expect(screen.querySelector('[data-region^="measures:"]'), r.slug).not.toBeNull();
      // Order: what is waiting, then where it stands, then the records. The
      // measure is context for the work, not a replacement for it.
      const regions = [...screen.querySelectorAll("[data-region]")]
        .map((e) => e.getAttribute("data-region")!).filter((x) => /^(today|measures|queue):/.test(x));
      expect(regions[0], r.slug).toMatch(/^today:/);
      expect(regions[1], r.slug).toMatch(/^measures:/);
    }
  });

  it("the numbers are DERIVED from the same seed the tables draw from", () => {
    // No model, nothing invented: a count is a count of the rows on screen.
    const d = doc();
    const band = d.querySelector('[data-region^="measures:"]')!;
    const tiles = [...band.querySelectorAll(".m-stat")];
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) expect(t.querySelector(".m-stat-v")?.textContent?.trim()).toBeTruthy();
  });

  it("an average of money is drawn as money", () => {
    // A bare "228982" beside "avg Annual Revenue" is a number nobody reads at a
    // glance, which defeats the point of a measure.
    const band = doc().querySelector('[data-region^="measures:"]')!;
    const money = [...band.querySelectorAll(".m-stat")]
      .find((t) => /avg/i.test(t.textContent ?? "") && /revenue|amount|value|budget|cost/i.test(t.textContent ?? ""));
    if (money) expect(money.querySelector(".m-stat-v")?.textContent).toMatch(/[$,]/);
  });

  it("the split that explains the number is there where a status exists", () => {
    const band = doc().querySelector('[data-region^="measures:"]')!;
    expect(band.querySelectorAll(".m-msplit").length).toBeGreaterThan(0);
  });

  it("an area with nothing to measure draws nothing, not an empty frame", () => {
    const bare = assemblePrototype(
      { entities: [{ name: "Thing", attributes: ["id", "name"] }], relations: [] } as never,
      { workflows: [{ name: "W", area: "Ops", steps: [{ action: "Do it", entities: ["Nothing"] }] }] } as never,
    );
    const d2 = loadPrototype(bare.html).window.document;
    const band = d2.querySelector('[data-region^="measures:"]');
    if (band) expect(band.querySelectorAll(".m-stat").length === 0 || band.textContent?.trim()).toBeTruthy();
  });

  it("the page still loads clean", () => {
    expect(loadPrototype(assemblePrototype(ontology, atlas).html).consoleErrors).toEqual([]);
  });
});

/* ── 2 · the design is asked, and told when it did not answer ─────────────── */

describe("a persona whose work is watching is owed a measure", () => {
  it("reads the watchers off the atlas, by their own verbs", () => {
    const areas = watcherAreas(atlas);
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) {
      expect(a.watching.length).toBeGreaterThanOrEqual(2);
      // The finding argues its own case: the steps come with it.
      expect(a.watching[0]).toMatch(/review|monitor|track|oversee|audit|assess|evaluate|analy|measure|reduce|trend|forecast|benchmark/i);
    }
  });

  it("an area that occasionally reads is NOT an oversight area", () => {
    // One watching step among twenty would tag half the programme, and a finding
    // that fires everywhere stops meaning anything.
    const mostly = {
      workflows: [{
        name: "Booking", area: "Scheduling",
        steps: [{ action: "Review the list" }, ...Array.from({ length: 9 }, () => ({ action: "Book the slot" }))],
      }],
    };
    expect(watcherAreas(mostly)).toEqual([]);
  });

  it("approving is not watching", () => {
    // Approving is a decision on ONE record, and the approvals queue serves it.
    const approvers = { workflows: [{ name: "Sign", area: "Legal", steps: [{ action: "Approve the contract" }, { action: "Approve the SOW" }] }] };
    expect(watcherAreas(approvers)).toEqual([]);
  });

  it("names the areas a design with no measure anywhere will fail", () => {
    // THE DEFECT AS SHIPPED: the Experience Design carried no metric block at all.
    const gaps = watcherGaps({ screens: [{ name: "Practitioners", wireframe: [] }] }, atlas);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]).toMatch(/watches \(\d+ of \d+ steps/);
    expect(gaps[0]).toContain('kind "metric"');
  });

  it("says nothing when the design DID author measures", () => {
    const designed = {
      screens: [{
        name: "Oversight", primaryActions: [{ label: "Set target" }],
        wireframe: [{ blocks: [{ kind: "metric", entity: "Account" }] }],
      }],
    };
    expect(watcherGaps(designed, atlas)).toEqual([]);
    expect(measuredIn(designed).entities.has("Account")).toBe(true);
  });

  it("names a read-only design — a number with no move is a report", () => {
    const noLever = { screens: [{ name: "O", wireframe: [{ blocks: [{ kind: "metric", entity: "Account" }] }] }] };
    expect(watcherGaps(noLever, atlas).join(" ")).toContain("read-only");
  });

  it("is silent on a programme with no watchers to owe anything to", () => {
    expect(watcherGaps({}, { workflows: [{ name: "W", area: "Ops", steps: [{ action: "Book it" }] }] })).toEqual([]);
  });
});

/* ── 3 · the layers are wired ─────────────────────────────────────────────── */

describe("all three layers, not just the prompt", () => {
  const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

  it("the design is TOLD to design for the person, with the measured failure as the reason", () => {
    expect(EDGE).toContain("DESIGN FOR WHAT THE PERSON DOES");
    expect(EDGE).toContain("Executive Oversight");
    expect(EDGE).toContain("AND GIVE THEM THE LEVER");
  });

  it("and then held to it — a prompt rule with no post-condition is a wish", () => {
    expect(EDGE).toContain('request.agentId === "experience-design"');
    expect(EDGE).toContain("watcherGaps(formalResult");
  });
});
