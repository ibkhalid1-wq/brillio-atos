/**
 * `supabase/functions` SHIPPED UNTYPECHECKED FOR THE LIFE OF THIS REPO.
 *
 * Not out of indifference. The first honest run returned 434 errors, of which
 * 372 were artifacts of having no config at all: no `Deno` global, no types for
 * the `https://esm.sh/…` imports, and a Supabase client carrying no `Database`
 * generic, whose rows therefore resolve to `never` so that every `row.id` in
 * the file is an error. Nobody can act on a list like that, so nobody read it,
 * so the ~60 real errors underneath were invisible.
 *
 * The single largest cause was one signature. `isRecord(value: unknown): value
 * is Record<string, unknown>` does not satisfy `Array.filter`'s type-predicate
 * overload against a `JsonValue[]`, because `Record<string, unknown>` does not
 * extend `JsonValue` — so `.filter(isRecord)` narrowed NOTHING and every
 * subsequent property read was reported as possibly-null. 109 errors, one
 * cause, and no runtime defect behind any of them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const at = (p: string) => resolve(__dirname, "../../../", p);
const read = (p: string) => readFileSync(at(p), "utf8");

describe("the edge is typechecked, and the check is in the gate", () => {
  it("validate runs it — a check nobody runs is a file, not a gate", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.validate).toContain("check:edge-types");
    expect(pkg.scripts["check:edge-types"]).toBeTruthy();
  });

  it("it has a config of its own, because the app's cannot read Deno", () => {
    const cfg = JSON.parse(read("tsconfig.edge.json")) as { include: string[]; compilerOptions: Record<string, unknown> };
    expect(cfg.include.some((i) => i.startsWith("supabase/functions"))).toBe(true);
    expect(cfg.compilerOptions.strict).toBe(true);
    // Without this the .ts import specifiers Deno requires read as 40 errors.
    expect(cfg.compilerOptions.allowImportingTsExtensions).toBe(true);
  });

  it("the ambient shim declares only what the edge uses", () => {
    // A fuller `Deno` type would invite reaching for an API this repo does not
    // use, and the point is to typecheck what is written.
    const amb = read("scripts/edge-types/ambient.d.ts");
    expect(amb).toContain("declare const Deno");
    expect(amb).toContain('declare module "https://esm.sh/@supabase/supabase-js@2.49.8"');
  });

  it("and says out loud that the client is untyped, rather than implying it is not", () => {
    // `createClient` is re-declared with `any` rows. That is the accurate
    // description of a client given no schema — the alternative was editing the
    // edge to satisfy the measuring instrument.
    expect(read("scripts/edge-types/ambient.d.ts")).toContain("SupabaseClient<any, any, any>");
  });
});

describe("the ratchet only ever tightens", () => {
  const baseline = JSON.parse(read("scripts/edge-types/baseline.json")) as Record<string, number>;

  it("the baseline is per FILE, not one total", () => {
    // A single total lets a fix in one file pay for a regression in another and
    // net to green, which is how a ratchet quietly stops ratcheting.
    expect(existsSync(at("scripts/edge-types/baseline.json"))).toBe(true);
    expect(Object.keys(baseline).every((k) => k.startsWith("supabase/functions/"))).toBe(true);
  });

  it("records what is genuinely still owed — not zero, and not the scary number", () => {
    // 434 was the number with no config; 62 is the number with one. Neither is
    // zero, and a baseline that claimed zero would be the same lie in reverse.
    const total = Object.values(baseline).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(120);
  });

  it("the shared modules — where every post-condition lives — are clean", () => {
    // This is the part that matters most: `_shared` is pure, tested, and read
    // by the app as well as the edge. Only `extractText.ts` still carries any,
    // and those are the fflate import having no types.
    const shared = Object.keys(baseline).filter((f) => f.includes("/_shared/"));
    expect(shared).toEqual(["supabase/functions/_shared/extractText.ts"]);
  });

  it("a checker that cannot run must FAIL, never pass", () => {
    // tsc exits non-zero when it finds errors, so a throw is the normal path.
    // A config failure also throws but prints no diagnostics — reading that as
    // "zero errors" would turn a broken checker into a green build.
    const script = read("scripts/edge-types/check.mjs");
    expect(script).toContain("no readable diagnostics");
    expect(script).toContain("process.exit(2)");
  });
});

describe("the guard that caused 109 of them", () => {
  it("is generic, so .filter(isRecord) actually narrows", () => {
    const edge = read("supabase/functions/run-agent/index.ts");
    expect(edge).toContain("function isRecord<T>(value: T): value is T & Record<string, unknown>");
    // The runtime check is unchanged — this was never a runtime defect.
    expect(edge).toContain('return typeof value === "object" && value !== null && !Array.isArray(value);');
  });
});
