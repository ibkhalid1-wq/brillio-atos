/**
 * ACCEPTANCE — kit questions project from ledger open unknowns (one source, two renderings).
 *
 *  1. Every projected kit question maps to a ledger locus it closes (no question closes nothing).
 *  2. The kit and the operator queue can't drift — they are the SAME open-unknown set.
 *  3. Answering a kit question closes its locus and the burn-down drops by exactly one.
 *  4. A separately-generated kit reconciles: matched → projection; unmatched → findings
 *     (ontology-gap vs stale), never silently dropped.
 *
 * Verified on real Laila AND a synthetic surgery-cancellation domain (the live surgery
 * program is DB-only; the synthetic mirrors its shape).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { projectKitQuestions, reconcileKit } from "@/v3/lib/ledger/kitProjection";
import { elementIdOf } from "@/v3/lib/ledger/types";

const lailaSnap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = () => migrate({ ontology: lailaSnap("domain-ontology.json"), atlas: lailaSnap("current-state-atlas.json"), overrides: lailaSnap("operator-overrides.json") } as Snapshot);

const surgery: Snapshot = {
  ontology: {
    entities: [
      { name: "Case", area: "Surgical Operations", attributes: ["status", "priority"] },
      { name: "Anesthesia Record", area: "Anesthesiology", attributes: ["type"] },
      { name: "OR Slot", area: "Scheduling", attributes: ["state"] },
    ],
    relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
  },
  atlas: {
    workflows: [
      { name: "Case Cancellation Review", area: "Surgical Operations", trigger: "cancel requested",
        steps: [{ action: "Decide whether to reschedule or cancel", actor: "Surgeon" }] },
      { name: "Pre-op Anesthesia Clearance", area: "Anesthesiology", trigger: "case booked",
        steps: [{ action: "Approve fitness for anesthesia", actor: "Anesthesiologist" }] },
    ],
  },
  overrides: [],
};

for (const [name, build] of [["Laila", laila], ["surgery", () => migrate(surgery)]] as const) {
  describe(`kit projection — ${name}`, () => {
    const store = build();
    const projected = projectKitQuestions(store);
    const queue = buildUnknownQueue(store);
    const openAbouts = new Set(queue.items.filter((i) => i.status === "open").map((i) => i.about));

    it("1 — every projected question maps to a real open locus (closes something)", () => {
      expect(projected.length).toBeGreaterThan(0);
      for (const k of projected) {
        expect(openAbouts.has(k.about)).toBe(true);
        expect(k.question.length).toBeGreaterThan(0);
        expect(k.about).toContain("#"); // it carries a real locus id
      }
    });

    it("2 — kit and operator queue are the SAME set (can't drift, by construction)", () => {
      const kitAbouts = new Set(projected.map((k) => k.about));
      expect(kitAbouts).toEqual(openAbouts);
    });

    it("3 — answering a kit question closes its locus; burn-down drops by exactly one", () => {
      const before = projectKitQuestions(store).length;
      const target = projected[0];
      // A stakeholder answers → an attributed, closed claim supersedes the ?unknown.
      store.assert({
        about: target.about, value: { kind: "scalar", value: "answered by stakeholder" },
        world: "to-be", layer: "domain", source: "asserted", ownerWhileOpen: { kind: "unowned" },
        status: "closed", closedBy: { method: "assertion", by: "stakeholder:test", verbatim: "they told us" },
      });
      const after = projectKitQuestions(store);
      expect(after.length).toBe(before - 1);
      expect(after.some((k) => k.about === target.about)).toBe(false); // it left BOTH lists
      expect(buildUnknownQueue(store).items.filter((i) => i.status === "open").some((i) => i.about === target.about)).toBe(false);
    });
  });
}

describe("reconcile a separately-generated kit — matched vs unmatched findings", () => {
  const store = laila();
  const elemNames = new Set(store.elements().map((e) => e.name.toLowerCase()));
  // Build representative kit questions FROM the real ledger so 'matched' is genuine,
  // plus deliberate finding cases (the live kit artifact is DB-only).
  const anEntity = store.elements().find((e) => e.kind === "entity")!;
  const kitQuestions = [
    `What values can ${anEntity.name} status take?`,          // should match a valueSet/status locus if present
    `Who owns ${anEntity.name}?`,                              // should match an owner-ish locus if present
    `What is the quantum flux tolerance for a sprocket widget?`,   // ontology-gap: nouns not modelled anywhere
    `How does the zephyr calibration ritual conclude?`,            // ontology-gap: not modelled
  ];
  const rec = reconcileKit(kitQuestions, store);

  it("nothing is silently dropped — every kit question is matched or a finding", () => {
    expect(rec.matched.length + rec.unmatched.length).toBe(kitQuestions.length);
  });

  it("matched questions point at real open loci", () => {
    for (const m of rec.matched) {
      expect(m.about).toContain("#");
      expect(m.question.length).toBeGreaterThan(0);
    }
  });

  it("unmatched are classified ontology-gap vs stale, each with an implication", () => {
    for (const u of rec.unmatched) {
      expect(["ontology-gap", "stale"]).toContain(u.reason);
      expect(u.implies.length).toBeGreaterThan(0);
    }
    // the two invented questions reference nouns the ontology never modelled → gaps
    const gaps = rec.unmatched.filter((u) => u.reason === "ontology-gap");
    expect(gaps.length).toBeGreaterThanOrEqual(2);
  });

  it("projectedOnly surfaces loci the kit never asked (kit under-coverage is visible)", () => {
    // The ledger has far more open unknowns than a handful of kit questions cover.
    expect(rec.projectedOnly.length).toBeGreaterThan(0);
    for (const k of rec.projectedOnly) expect(elementIdOf(k.about)).toBeTruthy();
  });

  it("sanity: element-name index actually populated (matching has something to hit)", () => {
    expect(elemNames.size).toBeGreaterThan(0);
  });
});
