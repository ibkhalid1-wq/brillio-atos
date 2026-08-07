/**
 * Enforces the invariant the code only *asserts* in a comment: the client and edge
 * copies of the area-inference tables "MUST stay in lockstep" (their own words).
 *
 * `stakeholderPrimaryArea` / `inferArea` are implemented twice — client
 * (`src/v3/components/flow/flowAreas.ts`) and edge
 * (`supabase/functions/_shared/flowAreas.ts`, the Deno generator's copy). The edge
 * file carries three "Keep in lockstep" / "MUST stay in lockstep" comments and
 * NOTHING enforced them: a keyword added on one side only would tag the same
 * workflow to a different area on the client vs the edge, splitting the Show demo
 * by the wrong stakeholder lane — silently. This test makes that drift loud.
 *
 * Text-parse parity (the edgeLockstep idiom), since the tables are module-private
 * consts. No DB, no network.
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

describe("flowAreas client ↔ edge lockstep (the 'MUST stay in lockstep' comment, enforced)", () => {
  it("AREA_KEYWORDS is identical on both sides", () => {
    expect(block(EDGE, "AREA_KEYWORDS", "[", "\n];"))
      .toEqual(block(CLIENT, "AREA_KEYWORDS", "[", "\n];"));
  });

  it("AREA_STOP_TOKENS is identical on both sides", () => {
    expect(block(EDGE, "AREA_STOP_TOKENS", "([", "])"))
      .toEqual(block(CLIENT, "AREA_STOP_TOKENS", "([", "])"));
  });
});
