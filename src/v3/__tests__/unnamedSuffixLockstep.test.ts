/**
 * ONE definition of the "— TBC" placeholder convention — asserted across the Deno boundary.
 *
 * The kit generator emits `"<Domain> SME — TBC"` when it knows a voice is needed but not
 * who fills it: a machine token, deliberately not a job title, so the gap stays VISIBLE
 * rather than being filled with a fabricated name. Several readers detect it and strip it.
 *
 * It was hand-written in five places — twice inside `flowStakeholders.ts` itself (directly
 * above the export that already declared it), once in `FlowShell.tsx`, and twice in the
 * edge. One convention, five spellings, each free to drift: narrowing the dash class in
 * one of them silently strands a placeholder as a real person's name, and the surface that
 * did so would look correct.
 *
 * Two copies are irreducible — Deno cannot import from `src/v3`, which is the same
 * boundary `answerCapLockstep` and `edgeLockstep` live across, and this file follows their
 * text-parse idiom. What is NOT irreducible is a third copy, which is what this pins.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { UNNAMED_SUFFIX_RE, displayPersonLabel } from "@/v3/components/flow/flowStakeholders";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const CLIENT_SRC = read("src/v3/components/flow/flowStakeholders.ts");
const EDGE_SRC = read("supabase/functions/_shared/unnamedSuffix.ts");

/** The literal as written in a source file, so the two spellings can be compared. */
const literalIn = (source: string): string => {
  const m = /export const UNNAMED_SUFFIX_RE = (\/.*\/i);/.exec(source);
  expect(m, "UNNAMED_SUFFIX_RE declaration not found").toBeTruthy();
  return m![1];
};

describe("the — TBC convention has one definition per runtime, and no more", () => {
  it("the client and the edge declare character-for-character the same pattern", () => {
    expect(literalIn(EDGE_SRC)).toBe(literalIn(CLIENT_SRC));
  });

  it("the dash class covers every dash the generator and operators actually produce", () => {
    // em dash, en dash, minus sign, non-breaking hyphen, plain hyphen — pasted from
    // documents interchangeably. This is the assertion that makes narrowing the class a
    // test failure rather than a silent mis-read.
    for (const dash of ["—", "–", "−", "‑", "-"]) {
      expect(UNNAMED_SUFFIX_RE.test(`Fulfilment SME ${dash} TBC`), `dash ${dash}`).toBe(true);
    }
    expect(UNNAMED_SUFFIX_RE.test("Fulfilment SME — tbc")).toBe(true);   // case-insensitive
    expect(UNNAMED_SUFFIX_RE.test("Ada Lovelace")).toBe(false);
    expect(UNNAMED_SUFFIX_RE.test("TBC Holdings Ltd")).toBe(false);      // anchored to the end
  });

  it("the display translation still reads as English, not as trade jargon", () => {
    expect(displayPersonLabel("Fulfilment SME — TBC")).toBe("Fulfilment SME — no one named yet");
    expect(displayPersonLabel("Ada Lovelace")).toBe("Ada Lovelace");
  });

  it("NO THIRD COPY: the pattern is written in exactly the two files that define it", () => {
    // Scans real source, not a hand-kept list, so a copy added tomorrow is caught the day
    // it lands. Comments are excluded — the convention is described in prose in several
    // places, and a guard that fires on its own documentation gets deleted.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) return [];
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(path) ? [path] : [];
    });
    const files = [...walk(resolve(ROOT, "src")), ...walk(resolve(ROOT, "supabase/functions"))];
    expect(files.length, "source scan found nothing — the walk is broken").toBeGreaterThan(20);

    const DEFINITIONS = [
      "src/v3/components/flow/flowStakeholders.ts",
      "supabase/functions/_shared/unnamedSuffix.ts",
    ];
    const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const offenders: string[] = [];
    for (const path of files) {
      const rel = relative(ROOT, path);
      if (rel.includes("__tests__")) continue;              // this file quotes the pattern
      if (DEFINITIONS.includes(rel)) continue;
      if (/TBC\\s\*\$/.test(codeOnly(readFileSync(path, "utf8")))) offenders.push(rel);
    }
    expect(
      offenders,
      `\nThe "— TBC" pattern is written again in:\n${offenders.join("\n")}\n` +
      `Import UNNAMED_SUFFIX_RE (client: flowStakeholders.ts; Deno: _shared/unnamedSuffix.ts).\n` +
      `Five copies of one convention is how the dash class drifts in one reader and a\n` +
      `placeholder silently becomes somebody's name.\n`,
    ).toEqual([]);
  });
});
