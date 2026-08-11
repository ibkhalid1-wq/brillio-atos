/**
 * THE DORMANT GENERATOR PATH — dormant BY DECISION, and provably still dormant.
 *
 * `_shared/ledgerGenerator.ts`, `_shared/optionA.ts` and `_shared/overrideAdapter.ts`
 * (439 lines) are reached only by the hand-run harnesses in `scripts/ledger/`. No deployed
 * function entrypoint imports them. On 2026-08-10 that was recorded as a decision — keep
 * them as script-only tooling rather than wiring or deleting — and this test is what makes
 * the decision hold instead of drifting.
 *
 * WHY IT MATTERS, twice over:
 *
 *   · It already cost a wrong conclusion. The owner-derivation fix is MIRRORED into
 *     `ledgerGenerator.ts`, and because the mirror runs nowhere, the fix was reported as
 *     shipped when nothing in production executes it. Regenerating a programme through
 *     `run-agent` does not exercise this code, which is why the surgery-drain test cannot
 *     be settled by a regeneration (brief §7.1).
 *
 *   · Dormant code is where fabrications survive. `overrideAdapter.ts` held a constant
 *     `{ kind: "role", role: "Sales Leaders" }` stamped on every imported claim, and every
 *     gate printed PASS over it for months — because no source guard read
 *     `supabase/functions/_shared` at all. Both holes are closed now (W-4, W-7), but the
 *     lesson is that "it runs nowhere" is a reason to guard it, not a reason to relax.
 *
 * THIS TEST IS NOT A BAN. Wiring an edge entry point is a legitimate future choice. It just
 * has to be a DELIBERATE one: adding the import fails this test, so the change arrives with
 * a reviewer looking at the decision rather than sliding in as a side effect.
 *
 * No DB, no network — pure source scan of the real function directories.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const FUNCTIONS = resolve(__dirname, "../../../supabase/functions");
const DORMANT = ["ledgerGenerator", "optionA", "overrideAdapter"] as const;

/** Every deployed function entrypoint — the directory listing, never a hand-kept list. */
const entrypoints = (): string[] =>
  readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_shared")
    .map((e) => join(FUNCTIONS, e.name, "index.ts"))
    .filter((p) => existsSync(p));

describe("the generator path is dormant by decision, and still is", () => {
  it("the scan sees the real functions (a broken path would pass vacuously)", () => {
    expect(entrypoints().length).toBeGreaterThan(5);
  });

  it("NO entrypoint imports the dormant modules", () => {
    const wired: string[] = [];
    for (const path of entrypoints()) {
      const src = readFileSync(path, "utf8");
      for (const mod of DORMANT) {
        // matches `from "../_shared/optionA.ts"` and any dynamic import of the same
        if (new RegExp(`_shared/${mod}(\\.ts)?["']`).test(src)) {
          wired.push(`${path.slice(FUNCTIONS.length + 1)} → ${mod}`);
        }
      }
    }
    expect(
      wired,
      `\nA dormant generator module is now imported by a deployed entrypoint:\n${wired.join("\n")}\n\n` +
      `That may be exactly right — but it is a DECISION, not a detail. If you are wiring it:\n` +
      `  1. update this test in the same change, and\n` +
      `  2. re-check the surgery-drain conclusion in the brief (§7.1), which currently rests\n` +
      `     on this code running nowhere, and\n` +
      `  3. re-read the owner derivation: a mirror that suddenly goes live starts stamping\n` +
      `     owners on real claims.\n`,
    ).toEqual([]);
  });

  it("each dormant module SAYS it is dormant, at the top, where an editor will see it", () => {
    // A decision recorded only in a doc is a decision the next person edits past.
    const missing = DORMANT.filter((mod) =>
      !readFileSync(join(FUNCTIONS, "_shared", `${mod}.ts`), "utf8").includes("STATUS: SCRIPT-ONLY TOOLING"));
    expect(missing, `\nNo dormancy note at the top of: ${missing.join(", ")}\n`).toEqual([]);
  });

  it("the harnesses that DO use them still exist — dormant, not abandoned", () => {
    // If these disappear, the modules have no caller at all and the decision changes from
    // "script-only tooling" to "dead code", which is a different conversation.
    const scripts = resolve(__dirname, "../../../scripts/ledger");
    const users = readdirSync(scripts).filter((f) => f.endsWith(".ts")).filter((f) =>
      DORMANT.some((mod) => readFileSync(join(scripts, f), "utf8").includes(mod)));
    expect(users.length, "no scripts/ledger harness references the dormant modules any more").toBeGreaterThan(0);
  });
});
