/**
 * A RECORD IS ONE THING THAT HAPPENED (2026-08-16) — the third pass.
 *
 * Each case reproduces a contradiction measured on the live build, where the
 * columns of one row disagreed with each other:
 *
 *  · an "Intent Score" of 197 on a figure a business reads out of 100 — the
 *    generic quantity pool runs to 200 and nothing said otherwise;
 *  · a contract starting 2026-08-05 with a renewal date of 2026-03-17, five
 *    months before the agreement existed (3 of the first 8 rows);
 *  · an opportunity at stage "Closed Won" whose forecast category read
 *    "Pipeline", and one at "Proposal" reading "Closed" — a finished deal filed
 *    as live and a live deal filed as finished, on the two columns a sales
 *    leader reads together (3 of the first 8 rows).
 *
 * None of it is visible as a bug in one field. All of it is visible to a client
 * reading a row.
 */
import { describe, expect, it } from "vitest";
import { generateSeed } from "@shared/seedData.ts";

const ontology = {
  entities: [
    { name: "Opportunity", attributes: [
      { name: "opportunityName", kind: "string" },
      { name: "opportunityStage", kind: "enum", values: ["Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"] },
      { name: "forecastCategory", kind: "enum", values: ["Pipeline", "Best Case", "Commit", "Closed"] },
      { name: "dealValue", kind: "money" },
      { name: "intentScore", kind: "number", min: 0, max: 100 },
      { name: "startDate", kind: "date" },
      { name: "renewalDate", kind: "date" },
      { name: "closeDate", kind: "date" },
    ] },
  ],
  relations: [],
};

const seed = generateSeed(ontology, "coherence-v1");
const rows = seed.records.Opportunity ?? [];
const SETTLED = /(won|closed|complete|completed|signed|executed|approved|delivered|invoiced|paid|fulfilled|settled)/i;

describe("a declared range is the range the values fall in", () => {
  it("no score exceeds the bound the ontology states", () => {
    const scores = rows.map((r) => r.intentScore).filter((v): v is number => typeof v === "number");
    expect(scores.length).toBeGreaterThan(5);
    for (const s of scores) expect(s, `${s} is outside 0–100`).toBeGreaterThanOrEqual(0);
    for (const s of scores) expect(s, `${s} is outside 0–100`).toBeLessThanOrEqual(100);
    // …and still varies, so bounding did not flatten the column
    expect(new Set(scores).size).toBeGreaterThan(3);
  });

  it("an unbounded number still draws from the generic pool", () => {
    const loose = generateSeed({ entities: [{ name: "Thing", attributes: [
      { name: "thingName", kind: "string" }, { name: "count", kind: "number" },
    ] }], relations: [] }, "coherence-v1");
    const counts = (loose.records.Thing ?? []).map((r) => r.count).filter((v): v is number => typeof v === "number");
    expect(Math.max(...counts)).toBeGreaterThan(100);
  });
});

describe("nothing on a record precedes the record", () => {
  it("a renewal date never falls before the start it renews", () => {
    let checked = 0;
    for (const r of rows) {
      const start = String(r.startDate ?? ""); const renewal = String(r.renewalDate ?? "");
      if (!/^\d{4}-/.test(start) || !/^\d{4}-/.test(renewal)) continue;
      checked += 1;
      expect(renewal >= start, `renewal ${renewal} precedes start ${start}`).toBe(true);
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("and neither does the close date", () => {
    for (const r of rows) {
      const start = String(r.startDate ?? ""); const close = String(r.closeDate ?? "");
      if (!/^\d{4}-/.test(start) || !/^\d{4}-/.test(close)) continue;
      expect(close >= start).toBe(true);
    }
  });
});

describe("a record does not disagree with itself about being over", () => {
  it("every row's forecast agrees with its stage on whether the deal is finished", () => {
    let finished = 0; let live = 0;
    for (const r of rows) {
      const stage = String(r.opportunityStage ?? ""); const forecast = String(r.forecastCategory ?? "");
      if (!stage || !forecast) continue;
      const stageOver = SETTLED.test(stage);
      expect(SETTLED.test(forecast), `stage "${stage}" with forecast "${forecast}"`).toBe(stageOver);
      if (stageOver) finished += 1; else live += 1;
    }
    // the fixture must exercise BOTH directions or it proves nothing
    expect(finished, "no finished deals in the fixture").toBeGreaterThan(0);
    expect(live, "no live deals in the fixture").toBeGreaterThan(0);
  });

  it("a secondary state with nothing to move to is left alone, never invented", () => {
    const noTerminal = generateSeed({ entities: [{ name: "Ticket", attributes: [
      { name: "ticketName", kind: "string" },
      { name: "ticketStatus", kind: "enum", values: ["Open", "Closed"] },
      { name: "severity", kind: "enum", values: ["Low", "Medium", "High"] },
    ] }], relations: [] }, "coherence-v1");
    for (const r of (noTerminal.records.Ticket ?? [])) {
      expect(["Low", "Medium", "High"]).toContain(String(r.severity));
    }
  });

  it("the same ontology seeds byte-identical rows — repairs spend no randomness", () => {
    expect(generateSeed(ontology, "coherence-v1").records).toEqual(seed.records);
  });
});
