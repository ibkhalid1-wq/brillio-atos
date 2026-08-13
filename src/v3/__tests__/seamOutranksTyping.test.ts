/**
 * A SEAM OUTRANKS THE TYPING ROUTE.
 *
 * Reported: "why not showing seams." Measured on Laila New: ELEVEN jointly-owned open
 * questions across four pairs (Sales Leaders ⋈ Sales Ops, Alliances ⋈ Sales Leaders,
 * Legal ⋈ Sales Leaders, Marketing ⋈ Sales Leaders) — and the Sessions section drew
 * NOTHING.
 *
 * Every one of the eleven is an `#optionality` question on a relation — "does every
 * Account need a Territory, or is that optional?" — and `optionality` is a typing
 * slot. The hook's loop tested typing FIRST, so all eleven were swallowed by the
 * dictionary bucket before the joint check ran.
 *
 * A dictionary can say a column is nullable. It cannot say whether the business
 * REQUIRES a Territory on every Account, and it certainly cannot settle that when two
 * functions own the answer jointly. That is a disagreement between people, which is
 * what a seam IS and what a joint session is for.
 */
import { describe, it, expect } from "vitest";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { aboutOf } from "@/v3/lib/ledger/types";

/** A relation two functions own jointly, with the optionality question open. */
function seamStore() {
  const store = createLedgerStore();
  store.addElement({ id: "el:ent:account", kind: "entity", name: "Account" });
  store.addElement({ id: "el:ent:territory", kind: "entity", name: "Territory" });
  store.addElement({
    id: "el:rel:account-territory", kind: "relation", name: "Account→Territory",
    refs: { from: "el:ent:account", to: "el:ent:territory" },
  });
  store.assert({
    about: aboutOf("el:rel:account-territory", "optionality"),
    value: { kind: "unknown" }, world: "as-is", layer: "domain", source: "generated",
    ownerWhileOpen: { kind: "joint", parties: ["Sales Leaders", "Sales Ops"] },
  });
  return store;
}

describe("a jointly-owned typing question is a seam, not a dictionary row", () => {
  it("the fixture really is both — joint AND a typing slot", () => {
    // Without this the case proves nothing: the whole bug is the overlap.
    const [item] = buildUnknownQueue(seamStore()).items;
    expect(item.owner.kind).toBe("joint");
    expect(TYPING_SLOTS.has(item.slot), "optionality stopped being a typing slot").toBe(true);
  });

  it("the hook sends it to the session queue, not the dictionary", () => {
    // MUTATION: put the typing skip back above the joint check in useProgramLedger →
    // RED, and the Sessions section goes empty on a programme with four live seams.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../lib/ledger/useProgramLedger.ts"), "utf8") as string;
    const jointAt = src.indexOf('if (it.owner.kind === "joint")');
    const typingAt = src.indexOf("TYPING_SLOTS.has(it.slot) && !lifecycleAsks");
    expect(jointAt, "the joint check is gone").toBeGreaterThan(-1);
    expect(typingAt, "the typing skip is gone").toBeGreaterThan(-1);
    expect(jointAt, "typing is tested first again — seams will be swallowed").toBeLessThan(typingAt);
  });

  it("and the dictionary bucket does not also claim it", () => {
    // A question counted in both buckets is one question waiting on two different
    // answers, which is how a burn-down starts lying.
    // MUTATION: drop the `owner.kind !== "joint"` filter on typingLoci → RED.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../lib/ledger/useProgramLedger.ts"), "utf8") as string;
    expect(src).toContain('.filter((i) => i.owner.kind !== "joint")');
  });
});
