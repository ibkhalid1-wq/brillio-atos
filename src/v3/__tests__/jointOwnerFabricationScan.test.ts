/**
 * THE SENTRY NARROWED WHILE THE TYPE WIDENED.
 *
 * Found in validation pass 2, hunting for regressions the FIX WINDOW itself
 * introduced — and this is one. `Owner` gained a joint arm when N-party seams
 * were authorised (`{ kind: "joint"; parties: string[] }` plus the `jointOwner`
 * constructor). Every fabrication gate in this repo matches `role: "…"`. So from
 * that commit onward, the Chief-of-Surgery fabrication — a constant owner
 * stamped on claims it never earned — could be reintroduced as
 *
 *     const O: Owner = jointOwner(["Chief of Surgery"]);
 *
 * and `literalRoleOwners` returned []. Every gate would have printed PASS over
 * it, exactly as they did for months over `overrideAdapter.ts`'s constant.
 *
 * This is the failure mode this codebase keeps rediscovering: not a missing
 * guard, but a guard that stopped covering its subject while still reporting on
 * it. A widened type is a widened attack surface for the guards that read it.
 */
import { describe, it, expect } from "vitest";
import { literalRoleOwners } from "./helpers/sourceGuards";

describe("the fabrication scan reads every Owner shape, not just `role`", () => {
  it("still catches the plain role literal (the shape it always caught)", () => {
    expect(literalRoleOwners(`const O: Owner = { kind: "role", role: "Chief of Surgery" };`))
      .toContain("Chief of Surgery");
  });

  it("catches a constant hidden in a joint OBJECT literal", () => {
    const src = `const O: Owner = { kind: "joint", parties: ["Chief of Surgery", "Sales Leaders"] };`;
    expect(literalRoleOwners(src)).toEqual(expect.arrayContaining(["Chief of Surgery", "Sales Leaders"]));
  });

  it("catches a constant hidden in a jointOwner() CALL", () => {
    const src = `const O: Owner = jointOwner(["Chief of Surgery", "Sales Leaders"]);`;
    expect(literalRoleOwners(src)).toEqual(expect.arrayContaining(["Chief of Surgery", "Sales Leaders"]));
  });

  it("reads joint parties whichever order the properties appear in", () => {
    const src = `const O: Owner = { parties: ["Finance", "Legal"], kind: "joint" };`;
    expect(literalRoleOwners(src)).toEqual(expect.arrayContaining(["Finance", "Legal"]));
  });

  it("does NOT flag a DERIVED joint owner — that is the correct pattern", () => {
    // `ownerFor` builds this from the area's functions. Flagging it would make the
    // gate cry wolf on the very code that does the right thing, and a gate people
    // learn to ignore is worse than no gate.
    expect(literalRoleOwners(`return jointOwner(fns);`)).toEqual([]);
    expect(literalRoleOwners(`return jointOwner(functionsOf(area).map(labelFor));`)).toEqual([]);
  });

  it("ignores a joint literal that only appears in a comment", () => {
    expect(literalRoleOwners(`// once was { kind: "joint", parties: ["Sales Leaders"] }\nconst x = 1;`)).toEqual([]);
  });

  it("the real ledger sources carry no literal joint owner", () => {
    // The live assertion, not a fixture one: if someone lands a constant joint
    // owner in the ledger, this is what turns red.
    const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
    const { resolve, join } = require("node:path") as typeof import("node:path");
    const dir = resolve(__dirname, "../lib/ledger");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      const joint = src.match(/jointOwner\(\s*\[[^\]]*["'`]/) || src.match(/kind:\s*["'`]joint["'`][^}]*?parties:\s*\[\s*["'`]/);
      if (joint) offenders.push(`${f}: ${joint[0].slice(0, 60)}`);
    }
    expect(offenders).toEqual([]);
  });
});
