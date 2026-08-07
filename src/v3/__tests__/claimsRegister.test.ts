// Keeps docs/aura/claims-register.md honest. This test FAILS when a self-claim in
// a user- or model-facing surface is ADDED or REWORDED without the register
// accounting for it — a brand-new surface file, a new claim line, or an existing
// claim line whose wording changed.
//
// It is content-sensitive, not count-based: each claim-bearing line is normalized
// (ASCII whitespace stripped, ASCII-lowercased — so reindent/reflow is silent) and
// hashed; the hash set per file lives in docs/aura/claims-allowlist.json. Rewording
// "grounded in the evidence" to "fully traceable to source" changes the hash and
// trips the guard even though the line count is unchanged. That is the point: a
// claim cannot get WORSE (or get added) without a human looking at the register.
//
// Green on landing — the allowlist is calibrated to the current tree. On an
// intentional claim change: re-status the register row, then regenerate the
// allowlist. The failure message says exactly that.
//
// No DB, no network — pure file scan.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type Allowlist = {
  surfaces: { componentsDir: string; componentsExt: string; libFiles: string[]; edgeGlob: string };
  vocab: string[];
  hashes: Record<string, string[]>;
};

const allowlist = JSON.parse(
  readFileSync(join(ROOT, "docs/aura/claims-allowlist.json"), "utf8"),
) as Allowlist;

const VOCAB = new RegExp(
  allowlist.vocab.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

// EXACT mirror of the generator (Perl): strip ASCII whitespace, lowercase A-Z only,
// sha1, first 16 hex. Must not drift from how claims-allowlist.json was produced.
function claimHash(line: string): string {
  const norm = line.replace(/[ \t\r\n\f\v]/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, ext, out);
    else if (abs.endsWith(ext)) out.push(abs);
  }
  return out;
}

function edgeIndexFiles(): string[] {
  const base = join(ROOT, "supabase/functions");
  if (!existsSync(base)) return [];
  return readdirSync(base).map((d) => join(base, d, "index.ts")).filter(existsSync);
}

function surfaceFiles(): string[] {
  const files = [
    ...walk(join(ROOT, allowlist.surfaces.componentsDir), allowlist.surfaces.componentsExt),
    ...allowlist.surfaces.libFiles.map((f) => join(ROOT, f)),
    ...edgeIndexFiles(),
  ];
  return [...new Set(files)].filter(existsSync);
}

describe("claims register guard", () => {
  it("no self-claim is added or reworded in a surface the register does not account for", () => {
    const offenders: string[] = [];
    for (const abs of surfaceFiles()) {
      const rel = relative(ROOT, abs).split("\\").join("/");
      const claimLines = readFileSync(abs, "utf8").split("\n").filter((l) => VOCAB.test(l));
      if (claimLines.length === 0) continue;
      const allowed = new Set(allowlist.hashes[rel] ?? []);
      if (!allowlist.hashes[rel]) {
        offenders.push(
          `NEW SURFACE  ${rel} — ${claimLines.length} claim line(s), not in the register. ` +
            `Add these claims to docs/aura/claims-register.md, then regenerate claims-allowlist.json.`,
        );
        continue;
      }
      const changed = claimLines.filter((l) => !allowed.has(claimHash(l)));
      if (changed.length) {
        offenders.push(
          `CLAIM CHANGED ${rel} — ${changed.length} claim line(s) added or reworded, e.g.:\n` +
            changed.slice(0, 3).map((l) => `      > ${l.trim().slice(0, 120)}`).join("\n") +
            `\n    Re-status the affected row in docs/aura/claims-register.md, then regenerate claims-allowlist.json.`,
        );
      }
    }
    expect(offenders, `\nClaims register is out of date:\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("the register and allowlist exist and are consistent", () => {
    expect(existsSync(join(ROOT, "docs/aura/claims-register.md"))).toBe(true);
    expect(allowlist.vocab.length).toBeGreaterThan(0);
    const missing = Object.keys(allowlist.hashes).filter((f) => !existsSync(join(ROOT, f)));
    expect(missing, `Allowlist lists files that no longer exist: ${missing.join(", ")}`).toEqual([]);
  });
});
