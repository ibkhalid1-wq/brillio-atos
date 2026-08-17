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

  it("binds the client to the project's REAL schema", () => {
    // It was briefly `SupabaseClient<any, any, any>` — the honest description
    // of a client given no schema. `database.types.ts` is the upgrade: a column
    // renamed out from under the edge is now a type error rather than an
    // `undefined` at runtime, which is the whole reason to check this tree.
    // Read from the DECLARATION, not the whole file: the comment above it
    // still says the words "SupabaseClient<any, any, any>" while explaining
    // what it used to be, and a file-wide match tested the prose.
    const amb = read("scripts/edge-types/ambient.d.ts");
    const decl = amb.slice(amb.indexOf("export function createClient"));
    expect(decl).toContain("database.types.ts");
    expect(decl).not.toContain("any, any, any");
  });

  it("the schema is generated and says so, with the command to refresh it", () => {
    // A generated file with no provenance gets hand-edited, and then it is not
    // a schema any more — it is a wish.
    const db = read("supabase/functions/_shared/database.types.ts");
    expect(db).toContain("GENERATED — DO NOT HAND-EDIT");
    expect(db).toContain("npm run gen:db-types");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["gen:db-types"]).toContain("gen types typescript");
  });
});

describe("what the real schema caught the moment it was switched on", () => {
  const db = read("supabase/functions/_shared/database.types.ts");
  const tableInSchema = (t: string) => db.includes(`      ${t}: {`);

  it("THREE TABLES THE EDGE WRITES TO DO NOT EXIST", () => {
    // Found by the typecheck within a minute of binding the real schema, and
    // invisible for the life of the repo before it. No migration creates any of
    // them and the live database has none of them.
    for (const t of ["adam_decisions", "adam_meeting_notes", "adam_raid_log"]) {
      expect(tableInSchema(t), `${t} unexpectedly exists — re-check the finding`).toBe(false);
    }
  });

  it("and the writes cannot report their own failure", () => {
    // The call sites wrap each insert in try/catch and push to an `errors`
    // array. supabase-js does not THROW on a failed write — it returns
    // `{ data, error }` — and the error is never read. So the catch never
    // fires, `errors` stays empty, and the handler answers `ok: true` with
    // `savedDecisions: N` having saved nothing at all.
    const fn = read("supabase/functions/meeting-notes-processor/index.ts");
    expect(fn).toContain('await admin.from("adam_decisions").insert({');
    expect(fn).toContain("ok: errors.length === 0");
    // The precise claim: the insert's RESULT is never destructured, so the
    // `error` it returns is never looked at. (An earlier version of this case
    // searched a 420-character window for the word "error" and matched the
    // `catch (err)` block below it — which proved nothing.) Goes RED the day
    // somebody reads the result, at which point the finding is fixed and this
    // case should be rewritten.
    expect(fn).toContain('await admin.from("adam_decisions").insert({');
    expect(fn).not.toMatch(/=\s*await admin\.from\("adam_decisions"\)/);
  });

  it("the tables the edge DOES use are all real", () => {
    // So the finding above is three specific tables, not a broken generator.
    for (const t of ["adam_programs", "adam_agent_runs", "adam_program_artifacts", "adam_program_texts"]) {
      expect(tableInSchema(t), t).toBe(true);
    }
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
