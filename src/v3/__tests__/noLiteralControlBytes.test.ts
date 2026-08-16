/**
 * SOURCE STAYS GREPPABLE.
 *
 * `prototypeRefine.ts` carried two literal NUL bytes as an array-join separator.
 * The byte is the RIGHT separator — no fabric id can contain it, so ["a","b"]
 * cannot compare equal to ["a\u0000b"] — but written raw it makes the file
 * BINARY: `grep` and `ripgrep` skip it in silence, returning no hits rather than
 * an error. In one session that cost two searches and very nearly a wrong
 * conclusion that a symbol did not exist. `file` called a 600-line TypeScript
 * module "data".
 *
 * The escape `\u0000` is the same value to the runtime and ASCII in the source,
 * so nothing is given up. This pins the property for every source file, because
 * the failure is silent by nature: nobody notices a search that returns nothing.
 *
 * KNOWN EXCEPTION — `src/v3/lib/ledger/types.ts` holds a literal 0x01 as the
 * contentId separator and is part of the FROZEN claims-ledger core, which this
 * work is not permitted to edit. It is listed here so the guard passes today
 * while keeping the debt visible and addressed the moment the core is opened.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "public", ".tmp", "coverage"]);
const EXT = /\.(ts|tsx|js|mjs|cjs|json)$/;

/** Frozen core — a needed change there is a FINDING, not an edit. */
const ALLOWED = new Set(["src/v3/lib/ledger/types.ts"]);

/** Tab (0x09), LF (0x0A) and CR (0x0D) are ordinary whitespace, not the hazard. */
const isHazard = (b: number) => b < 0x09 || b === 0x0b || b === 0x0c || (b >= 0x0e && b < 0x20);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

describe("no source file is binary to grep", () => {
  it("carries no literal control byte — use the \\uXXXX escape instead", () => {
    // MUTATION: put a raw NUL back into any joined separator → RED.
    const offenders: string[] = [];
    for (const p of walk(ROOT)) {
      const rel = p.slice(ROOT.length + 1);
      if (ALLOWED.has(rel)) continue;
      const raw = readFileSync(p);
      const bytes = [...new Set(raw)].filter(isHazard);
      if (bytes.length) offenders.push(`${rel} — ${bytes.map((b) => `0x${b.toString(16)}`).join(", ")}`);
    }
    expect(offenders, `literal control bytes make these unsearchable:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the frozen-core exception is real, so the allow-list cannot rot unnoticed", () => {
    // An allow-list nobody checks becomes a place to hide things. If the ledger
    // core is ever cleaned, this fails and the entry must go.
    for (const rel of ALLOWED) {
      const raw = readFileSync(resolve(ROOT, rel));
      expect([...new Set(raw)].some(isHazard),
        `${rel} no longer has a literal control byte — drop it from ALLOWED`).toBe(true);
    }
  });
});
