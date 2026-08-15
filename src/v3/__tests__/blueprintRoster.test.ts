/**
 * THE BLUEPRINT SHOWS WHAT CAN HURT YOU.
 *
 * It was a node graph with five lenses: agents as boxes, derived dataflow as edges,
 * and a toolbar to change which fact the boxes emphasised. It drew the least
 * interesting thing the document holds — that one agent's output tokens overlap
 * another's input tokens — and hid, one lens-click each, the fields that decide
 * whether the design is safe to build: `autonomyLevel`, `blastRadius`,
 * `reversibility`, `requiresHitl`, `guardrails[]`.
 *
 * The reading that replaces it is UNGOVERNED: an agent that can act on its own, where
 * the damage is wide or irreversible, and nothing gates it. Every part of that comes
 * from the document; the surface only reads them together. These pin the conjunction,
 * because a flag that over-fires is noise and one that under-fires is worse than none.
 */
import { describe, it, expect } from "vitest";
import { readAgentRows, isUngoverned, readAccepted, ACCEPTED_FIELD } from "@/v3/components/flow/studio/BlueprintGraph";

const agent = (over: Record<string, unknown> = {}) => ({
  name: "Reconciliation Agent", purpose: "Reconciles ledger entries",
  autonomyLevel: "high", blastRadius: "wide — customer-facing records",
  reversibility: "irreversible", requiresHitl: false, ...over,
});

describe("the ungoverned reading", () => {
  const base = { autonomy: "high", blast: "wide", reversibility: "irreversible", requiresHitl: false, gate: "" };

  it("flags an agent that acts alone on something wide and irreversible", () => {
    expect(isUngoverned(base)).toBe(true);
  });

  it("does NOT flag it when a human gates it — either way of saying so", () => {
    // The whole point of the flag is "nothing catches this". A gate is something.
    expect(isUngoverned({ ...base, requiresHitl: true })).toBe(false);
    expect(isUngoverned({ ...base, gate: "Finance approves each batch" })).toBe(false);
  });

  it("does NOT flag a low-autonomy agent, however wide the blast radius", () => {
    // It cannot act alone, so the radius is a fact about the workflow, not a risk
    // nobody is watching.
    expect(isUngoverned({ ...base, autonomy: "assisted" })).toBe(false);
  });

  it("does NOT flag a high-autonomy agent whose damage is narrow and reversible", () => {
    expect(isUngoverned({ ...base, blast: "single record", reversibility: "reversible" })).toBe(false);
  });

  it("flags on EITHER limb of the damage test, not both", () => {
    expect(isUngoverned({ ...base, blast: "single record" })).toBe(true);          // irreversible alone
    expect(isUngoverned({ ...base, reversibility: "reversible" })).toBe(true);     // wide alone
  });

  it("does not flag when autonomy is simply unstated", () => {
    // An undecided autonomy is a `?unknown` the header counts separately. Calling it
    // ungoverned would be asserting something the document does not say.
    expect(isUngoverned({ ...base, autonomy: "" })).toBe(false);
  });
});

describe("the roster", () => {
  const doc = {
    agents: [
      agent({ name: "Late Agent" }),
      agent({ name: "First Agent", autonomyLevel: "assisted" }),
      agent({ name: "Unsequenced Agent" }),
      { name: "" },
    ],
    buildSequence: ["Slice 1 — stand up the First Agent", "Slice 2 — the Late Agent follows"],
    hitlPoints: [{ agent: "Late Agent", point: "Ops approves each run" }],
    evalPlan: [{ agent: "First Agent", metric: "precision", passBar: "≥ 0.95" }],
  };

  it("orders by the build sequence, with the unsequenced last", () => {
    // Build order is implementation order — the order somebody will actually do this
    // in. An agent the sequence never names has "when" as its open question, so it
    // sorts last rather than claiming a position.
    // MUTATION: drop the sort → "Late Agent" leads, which is document order.
    expect(readAgentRows(doc).map((r) => r.name)).toEqual(["First Agent", "Late Agent", "Unsequenced Agent"]);
    expect(readAgentRows(doc).map((r) => r.buildIndex)).toEqual([1, 2, 0]);
  });

  it("drops a nameless agent rather than rendering an empty row", () => {
    expect(readAgentRows(doc).some((r) => !r.name)).toBe(false);
  });

  it("folds in the document-level gate and pass bar", () => {
    const rows = readAgentRows(doc);
    expect(rows.find((r) => r.name === "Late Agent")!.gate).toContain("Ops approves");
    expect(rows.find((r) => r.name === "First Agent")!.passBar).toBe("≥ 0.95");
  });

  it("a document-level gate is enough to un-flag an agent", () => {
    // "Late Agent" is high-autonomy, wide and irreversible, and its own record says
    // requiresHitl: false — but hitlPoints names a human. The two must be read
    // together or the flag lies.
    const late = readAgentRows(doc).find((r) => r.name === "Late Agent")!;
    expect(isUngoverned({ ...late, accepted: !!late.accepted })).toBe(false);
  });

  it("keeps guardrails, and keeps the empty ones out", () => {
    const rows = readAgentRows({
      agents: [agent({ guardrails: [
        { failureMode: "tool error", detection: "API timeout", fallback: "notify the SME" },
        {},
      ] })],
    });
    expect(rows[0].guardrails).toHaveLength(1);
    expect(rows[0].guardrails[0].fallback).toBe("notify the SME");
  });

  it("returns nothing for a document with no agents", () => {
    expect(readAgentRows({})).toEqual([]);
  });
});

describe("the decision an operator records on it", () => {
  it("an accepted agent stops being flagged", () => {
    // The strip asks once and records the answer. Without this it asks for ever, and
    // a question that will not take an answer is noise.
    const base = { autonomy: "high", blast: "wide", reversibility: "irreversible", requiresHitl: false, gate: "" };
    expect(isUngoverned({ ...base, accepted: true })).toBe(false);
    expect(isUngoverned({ ...base, accepted: false })).toBe(true);
  });

  it("reads an acceptance back off the document, with who and why", () => {
    const rows = readAgentRows({
      agents: [agent()],
      [ACCEPTED_FIELD]: [{ agent: "Reconciliation Agent", reason: "batch is reviewed nightly", by: "operator", at: "2026-08-15T00:00:00Z" }],
    });
    expect(rows[0].accepted?.reason).toBe("batch is reviewed nightly");
    expect(isUngoverned({ ...rows[0], accepted: !!rows[0].accepted })).toBe(false);
  });

  it("ignores an acceptance with no reason — the reason IS the attestation", () => {
    // A click with no rationale is not a decision on the record.
    expect(readAccepted({ [ACCEPTED_FIELD]: [{ agent: "X", reason: "" }, { agent: "", reason: "y" }] })).toEqual([]);
  });
});
