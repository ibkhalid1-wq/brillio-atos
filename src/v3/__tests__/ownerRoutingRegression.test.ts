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
    expect(functionOf("Sales Ops")).toBe("Sales Ops");
    expect(functionOf("Sales Operations")).toBe("Sales Ops");
    expect(functionOf("Sales / Sales Ops / Practices")).not.toBeNull();
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

// A domain with NO function-mappable areas (mirrors the surgery-cancellation program):
// the CRM function table owns none of it, so EVERY open question must be unowned —
// never fabricated onto a default owner (the Chief-of-Surgery magnet).
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

describe("surgery domain — no function-mappable area → all unowned, none fabricated", () => {
  const q = buildUnknownQueue(migrate(surgery));
  const open = q.items.filter((i) => i.status === "open");

  it("ZERO open questions are role-owned (no fabricated owner)", () => {
    expect(open.filter((i) => i.owner.kind === "role")).toHaveLength(0);
  });

  it("every open question is unowned and therefore visible in burn-down / inbox", () => {
    expect(open.every((i) => i.owner.kind === "unowned")).toBe(true);
    expect(open.length).toBeGreaterThan(0);
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
