/**
 * REGRESSION — owner routing has NO fabricated owners.
 *
 * The bug: every owner-queue question routed to one stakeholder (surgery: Chief of
 * Surgery held 50/50; five roles at 0). Two causes, both fixed here:
 *   (c) migrate/generator hardcoded ownerFor("sales ops") on dataType/
 *       automationDisposition/actorRole and as a jointOrOwner fallback — an owner
 *       unrelated to the locus. Fixed: each slot inherits its OWN element/step area;
 *       a double-miss is UNOWNED, never a constant.
 *   (b) functionOf's /ops|operation/ swallowed any "…Operations" area into Sales Ops.
 *       Fixed: the rule requires the SALES context (/sales ?op/), so "Surgical
 *       Operations" maps to none and stays unowned.
 *
 * Invariant: every owner assignment traces to an explicit rule hit; misses stay
 * unowned and visible. Conservation holds. No default owner, ever.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, functionOf, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";

const lailaSnap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));

describe("functionOf — most-specific wins, no broad swallow, no default", () => {
  it("Sales context still maps to Sales Ops (regression not over-tightened)", () => {
    // The guard this test exists for: the narrow `/sales ?op/` must win over the broad
    // `/sales/`, and tightening that must not stop Sales Ops resolving at all.
    expect(functionOf("Sales Ops")).toBe("Sales Ops");
    expect(functionOf("Sales Operations")).toBe("Sales Ops");
  });

  it("a label naming SEVERAL functions resolves to none of them — it is unowned", () => {
    // DELIBERATE RE-BASELINE. This case previously asserted `.not.toBeNull()`, which
    // encoded the old whole-string first-match-wins behaviour: "Sales / Sales Ops /
    // Practices" resolved to Practices purely because `/practice|…/` sits first in the
    // table. On the Laila snapshot that sent 78 questions — all of Practices'
    // entity-derived load — to a function the label names third.
    //
    // Picking any one of several named functions is a fabricated owner, so the record
    // now says what it actually knows: nothing. `ownerFor` turns null into `unowned` and
    // an operator routes it. Assertions above still hold, so the Sales Ops fix is intact.
    expect(functionOf("Sales / Sales Ops / Practices")).toBeNull();
    expect(functionOf("Sales / Practices / Delivery / Marketing / Legal / Finance")).toBeNull();
    // ONE recognised function is still an answer, even beside names we do not know.
    expect(functionOf("Delivery / Talent Acquisition")).toBe("Delivery");
  });

  it("a bare '…Operations' area is NOT swallowed into Sales Ops — it maps to none", () => {
    expect(functionOf("Surgical Operations")).toBeNull();
    expect(functionOf("Perioperative Operations")).toBeNull();
    expect(functionOf("Patient Flow Operations")).toBeNull();
    expect(functionOf("Anesthesiology")).toBeNull();
  });

  it("most-specific wins: an area matching both the ops rule and the sales rule → Sales Ops (ordered first), never a tie that fabricates", () => {
    // "Sales Ops" matches /sales ?op/ (specific) before /sales/ (broad) → Sales Ops.
    expect(functionOf("Sales Ops")).toBe("Sales Ops");
    // A pure sales area without ops falls through to Sales.
    expect(functionOf("Sales")).toBe("Sales");
    // No match anywhere → null (the caller turns this into UNOWNED, never a default).
    expect(functionOf("Radiology")).toBeNull();
  });
});

// A domain with NO function-mappable areas (mirrors the surgery-cancellation program).
// Remedy A: owners come from the DATA — the atlas's own stated `step.actor` /
// `workflow.owner` — where functionOf misses; a locus the data names nobody for stays
// UNOWNED. Never a constant, never the Chief-of-Surgery magnet.
const surgery: Snapshot = {
  ontology: {
    entities: [
      { name: "Case", area: "Surgical Operations", attributes: ["status", "priority"] },
      { name: "Anesthesia Record", area: "Anesthesiology", attributes: ["type"] },
    ],
    relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
  },
  atlas: {
    workflows: [
      { name: "Case Cancellation Review", area: "Surgical Operations", trigger: "cancel requested",
        steps: [{ action: "Decide whether to reschedule or cancel", actor: "Surgeon" }] },
      { name: "Pre-op Anesthesia Clearance", area: "Anesthesiology", trigger: "case booked",
        steps: [{ action: "Decide fitness for anesthesia", actor: "Anesthesiologist" }] },
    ],
  },
  overrides: [],
};

describe("surgery domain — owners from the DATA (stated actor/owner) or unowned; never a constant", () => {
  const q = buildUnknownQueue(migrate(surgery));
  const open = q.items.filter((i) => i.status === "open");

  it("NEVER a constant/fabricated owner — no CRM function label appears on surgery", () => {
    const labels = new Set(open.filter((i) => i.owner.kind === "role").map((i) => i.ownerLabel));
    for (const bad of ["Sales Ops", "Sales Leaders", "Sales", "Practices", "Alliances", "Finance", "Legal", "Delivery", "Marketing"]) {
      expect(labels.has(bad)).toBe(false);
    }
  });

  it("step questions are owned by their STATED actor, verbatim (data-grounded rule hit)", () => {
    const stepOwned = open.filter((i) => i.about.startsWith("el:step") && i.owner.kind === "role");
    expect(stepOwned.length).toBeGreaterThan(0);
    // exactly the fixture's stated actors — nothing invented, nothing else
    expect(new Set(stepOwned.map((i) => i.ownerLabel))).toEqual(new Set(["Surgeon", "Anesthesiologist"]));
  });

  it("a locus the data names NOBODY for stays UNOWNED and visible (no invention)", () => {
    // this fixture's workflows state no `owner` → workflow-level phase stays unowned
    const phase = open.filter((i) => i.slot === "phase");
    expect(phase.length).toBeGreaterThan(0);
    expect(phase.every((i) => i.owner.kind === "unowned")).toBe(true);
    // entity/attribute areas map to no function and no person exists in the data → unowned
    const entityLevel = open.filter((i) => i.about.startsWith("el:entity") || i.about.startsWith("el:attr"));
    expect(entityLevel.every((i) => i.owner.kind === "unowned")).toBe(true);
  });

  it("a STATED workflow owner takes the workflow-level questions (phase, decision)", () => {
    const owned = migrate({
      ...surgery,
      atlas: { workflows: [{ name: "Case Cancellation Review", area: "Surgical Operations", owner: "Chief of Surgery", trigger: "cancel requested",
        steps: [{ action: "Decide whether to reschedule or cancel", actor: "Surgeon" }] }] },
    } as Snapshot);
    const oq = buildUnknownQueue(owned).items.filter((i) => i.status === "open");
    const phase = oq.filter((i) => i.slot === "phase");
    expect(phase.length).toBeGreaterThan(0);
    expect(phase.every((i) => i.owner.kind === "role" && i.ownerLabel === "Chief of Surgery")).toBe(true);
    // the step decision rides the workflow owner; step disposition/actor-role ride the actor
    const decision = oq.filter((i) => i.slot === "decision");
    expect(decision.every((i) => i.ownerLabel === "Chief of Surgery")).toBe(true);
    const disp = oq.filter((i) => i.slot === "automationDisposition");
    expect(disp.every((i) => i.ownerLabel === "Surgeon")).toBe(true);
  });
});

describe("Laila — conservation + no dataType constant-owner fabrication", () => {
  const q = buildUnknownQueue(migrate({
    ontology: lailaSnap("domain-ontology.json"), atlas: lailaSnap("current-state-atlas.json"), overrides: lailaSnap("operator-overrides.json"),
  }));
  const open = q.items.filter((i) => i.status === "open");

  it("conservation: open === dictionary + role + joint + unowned (nothing vanishes)", () => {
    const dict = open.filter((i) => TYPING_SLOTS.has(i.slot)).length;
    const role = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "role").length;
    const joint = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "joint").length;
    const unowned = open.filter((i) => !TYPING_SLOTS.has(i.slot) && i.owner.kind === "unowned").length;
    expect(dict + role + joint + unowned).toBe(open.length);
  });

  it("dataType questions are NOT all funneled to one owner — they follow their entity's area", () => {
    const dataTypeOwners = new Set(open.filter((i) => i.slot === "dataType").map((i) => i.ownerLabel));
    // Before the fix every dataType was ownerFor("sales ops") — a single owner.
    // After: they spread across the entities' real area owners (and unowned).
    expect(dataTypeOwners.size).toBeGreaterThan(1);
  });
});
