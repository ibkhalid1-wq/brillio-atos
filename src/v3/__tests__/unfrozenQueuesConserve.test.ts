/**
 * THE COMMON PATH WAS THE UNTESTED ONE.
 *
 * Found by mutation-testing the harness in validation pass 2. A deliberate
 * conservation leak was planted in `unfrozenQueues` — the assign queue silently
 * dropped its first item — and ALL 23 harness checks printed PASS, exit 0.
 *
 * Two reasons it was invisible, and both are worth keeping in view:
 *
 *  1. `unfrozenQueues` is the ONE definition of the frozen-locus subtraction,
 *     read by BOTH `operatorQueueCounts` (the badge) and `OperatorInbox` (the
 *     page). The badge-equals-page sentry therefore still passed: both surfaces
 *     read the same leaking function and agreed with each other perfectly. Single
 *     source makes two surfaces consistent — it does not make them correct, and a
 *     sentry that only compares them cannot tell the difference.
 *
 *  2. The existing L8 test builds a fixture WITH a conflict, so it only ever
 *     exercises the `frozen.size > 0` branch. The early return for zero
 *     conflicts — the overwhelmingly common case on every real programme — had
 *     no conservation assertion at all. The leak was planted there.
 *
 * So this holds the identity itself, on both branches: every item that goes in
 * comes out either kept or frozen, and never neither.
 */
import { describe, it, expect } from "vitest";
import { unfrozenQueues } from "@/v3/lib/ledger/operatorQueue";
import type { OperatorQueueReads } from "@/v3/lib/ledger/operatorQueue";

type Assign = OperatorQueueReads["assignQueue"];
type Sessions = OperatorQueueReads["sessionQueue"];

const assignItem = (about: string) => ({ about, slot: "phase", element: about.split("#")[0], label: about }) as unknown as Assign[number];
const session = (id: string, abouts: string[]) =>
  ({
    id, parties: ["Sales", "Finance"], label: id, abouts,
    // `items` is the parallel list unfrozenQueues filters alongside `abouts`;
    // both must survive the subtraction together or the section renders a count
    // its own rows do not support.
    items: abouts.map((about) => ({ about, slot: "phase", label: about })),
  }) as unknown as Sessions[number];

const ledgerOf = (assign: Assign, sessions: Sessions, frozenAbouts: string[]): OperatorQueueReads =>
  ({
    assignQueue: assign,
    sessionQueue: sessions,
    conflicts: frozenAbouts.map((about) => ({ about })),
    assignments: [], pinConflicts: [], decideFates: [], artifactAsks: [],
  }) as unknown as OperatorQueueReads;

describe("unfrozenQueues conserves — nothing leaves except what freezes", () => {
  const ASSIGN = [assignItem("el:a#phase"), assignItem("el:b#phase"), assignItem("el:c#phase")];
  const SESSIONS = [session("s1", ["el:a#phase", "el:d#phase"]), session("s2", ["el:e#phase"])];

  it("zero conflicts: the assign queue passes through WHOLE (the leak's branch)", () => {
    const out = unfrozenQueues(ledgerOf(ASSIGN, SESSIONS, []));
    expect(out.frozen.size).toBe(0);
    expect(out.assign).toHaveLength(ASSIGN.length);
    expect(out.assign.map((i) => i.about)).toEqual(ASSIGN.map((i) => i.about));
  });

  it("zero conflicts: session loci pass through whole too", () => {
    const out = unfrozenQueues(ledgerOf(ASSIGN, SESSIONS, []));
    const before = SESSIONS.flatMap((s) => s.abouts);
    const after = out.sessions.flatMap((s) => s.abouts);
    expect(after.slice().sort()).toEqual(before.slice().sort());
  });

  it("THE IDENTITY, both branches: kept + frozen === everything that went in", () => {
    for (const frozenAbouts of [[], ["el:b#phase"], ["el:a#phase", "el:c#phase"], ["el:a#phase", "el:b#phase", "el:c#phase"]]) {
      const out = unfrozenQueues(ledgerOf(ASSIGN, SESSIONS, frozenAbouts));
      const kept = out.assign.map((i) => i.about);
      const frozenIn = ASSIGN.map((i) => i.about).filter((a) => out.frozen.has(a));
      // No item may be both kept and frozen, and none may be neither.
      expect(kept.filter((a) => out.frozen.has(a)), `frozen item survived: ${frozenAbouts}`).toEqual([]);
      expect(
        [...kept, ...frozenIn].slice().sort(),
        `assign queue lost an item that was neither kept nor frozen (frozen=${JSON.stringify(frozenAbouts)})`,
      ).toEqual(ASSIGN.map((i) => i.about).slice().sort());
    }
  });

  it("removes EXACTLY the frozen loci from sessions — no collateral", () => {
    const out = unfrozenQueues(ledgerOf(ASSIGN, SESSIONS, ["el:a#phase"]));
    const after = out.sessions.flatMap((s) => s.abouts);
    expect(after).not.toContain("el:a#phase");
    // Everything else that was there is still there.
    expect(after.slice().sort()).toEqual(["el:d#phase", "el:e#phase"]);
  });

  it("a session whose every locus froze stops being a session to schedule", () => {
    // The documented behaviour: otherwise the surface prints "0 joint questions"
    // beside a live "propose a time" button.
    const out = unfrozenQueues(ledgerOf(ASSIGN, [session("s3", ["el:x#phase"])], ["el:x#phase"]));
    expect(out.sessions.flatMap((s) => s.abouts)).toEqual([]);
  });
});
