/**
 * Enforces the invariant the code only *asserts* in a comment: the client and edge
 * copies of the area-inference tables "MUST stay in lockstep" (their own words).
 *
 * The area model is implemented twice — client (`src/v3/components/flow/flowAreas.ts`)
 * and edge (`supabase/functions/_shared/flowAreas.ts`, the Deno generator's copy) —
 * because Deno can't import the client module. What MUST stay byte-identical, and is
 * enforced below:
 *   - the tables `AREA_KEYWORDS` and `AREA_STOP_TOKENS`, and
 *   - the pure consuming helpers `inferArea`, `labelTokens`, `labelsOverlap`.
 * A keyword or a scoring tweak added on one side only would tag the same workflow to
 * a different area on the client vs the edge, splitting the Show demo by the wrong
 * stakeholder lane — silently. This test makes that drift loud.
 *
 * NOT locked: `stakeholderPrimaryArea` itself. The two copies deliberately DIVERGE —
 * the client layers an operator role→area override (a correction path) that the edge
 * generator has no need for. Its shared base (the helpers above + the tables) is what
 * this test pins; its full behaviour is pinned by flowLibs.test.ts on the client side.
 *
 * Text-parse parity (the edgeLockstep idiom), since the tables/helpers are
 * module-private. No DB, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLIENT = readFileSync(resolve(__dirname, "../components/flow/flowAreas.ts"), "utf8");
const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/_shared/flowAreas.ts"), "utf8");

/** Extract the body of a `const NAME = <open> … <close>` block, whitespace-normalized. */
function block(src: string, name: string, open: string, close: string): string {
  const start = src.indexOf(`const ${name}`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const from = src.indexOf(open, start);
  const to = src.indexOf(close, from);
  expect(to, `${name} block not closed`).toBeGreaterThan(from);
  return src.slice(from + open.length, to).replace(/\s+/g, " ").trim();
}

/** Extract a top-level `function NAME(...) { … }` body, brace-matched and
 * whitespace-normalized. Balanced destructuring braces inside the body are
 * fine; these helpers carry no braces inside strings/regex. */
function fnBody(src: string, name: string): string {
  const sig = src.search(new RegExp(`function ${name}\\b`));
  expect(sig, `${name}() not found`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf("{", sig);
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) break; }
  }
  expect(i, `${name}() body not closed`).toBeLessThan(src.length);
  return src.slice(open + 1, i).replace(/\s+/g, " ").trim();
}

describe("flowAreas client ↔ edge lockstep (the 'MUST stay in lockstep' comment, enforced)", () => {
  it("AREA_KEYWORDS is identical on both sides", () => {
    expect(block(EDGE, "AREA_KEYWORDS", "[", "\n];"))
      .toEqual(block(CLIENT, "AREA_KEYWORDS", "[", "\n];"));
  });

  it("AREA_STOP_TOKENS is identical on both sides", () => {
    expect(block(EDGE, "AREA_STOP_TOKENS", "([", "])"))
      .toEqual(block(CLIENT, "AREA_STOP_TOKENS", "([", "])"));
  });

  // The consuming logic, not just the tables — this is the gap the comment
  // claimed ("core logic must stay in lockstep") that nothing checked.
  it.each(["inferArea", "labelTokens", "labelsOverlap"])(
    "%s is byte-identical on both sides", (fn) => {
      expect(fnBody(EDGE, fn)).toEqual(fnBody(CLIENT, fn));
    });
});
