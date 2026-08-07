// Keeps docs/aura/claims-register.md honest. This test FAILS when self-claim
// vocabulary ("traceable", "grounded", "auditable", "governed", …) appears in a
// user- or model-facing surface that the claims register does not account for —
// either a brand-new surface file, or a rise in a listed file (a new claim).
//
// The point is not to ban the words. It is to make a NEW claim impossible to
// land without a human looking at the register and re-statusing what the
// platform may truthfully say. That is the mechanism that closes the gap the
// register exists to close (a claim that accretes because nothing tracks it).
//
// Green on landing (counts are calibrated to current reality in
// docs/aura/claims-allowlist.json). To change a surface: update the register,
// then update the allowlist. The failure message tells you exactly what moved.
//
// No DB, no network — pure file scan.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type Allowlist = {
  surfaces: { componentsDir: string; componentsExt: string; libFiles: string[]; edgeGlob: string };
  vocab: string[];
  strictCounts: boolean;
  allowed: Record<string, number>;
};

const allowlist = JSON.parse(
  readFileSync(join(ROOT, "docs/aura/claims-allowlist.json"), "utf8"),
) as Allowlist;

const VOCAB = new RegExp(
  allowlist.vocab.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);

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
  return readdirSync(base)
    .map((d) => join(base, d, "index.ts"))
    .filter(existsSync);
}

// count LINES that contain claim vocabulary (multiple hits on one line count once —
// matches the calibrated grep, and keeps the number about distinct assertions).
function vocabLineCount(abs: string): number {
  const text = readFileSync(abs, "utf8");
  let n = 0;
  for (const line of text.split("\n")) if (VOCAB.test(line)) n += 1;
  return n;
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
  it("no self-claim vocabulary appears in a surface the register does not account for", () => {
    const offenders: string[] = [];
    for (const abs of surfaceFiles()) {
      const rel = relative(ROOT, abs).split("\\").join("/");
      const count = vocabLineCount(abs);
      if (count === 0) continue;
      const allowed = allowlist.allowed[rel];
      if (allowed == null) {
        offenders.push(
          `NEW SURFACE  ${rel} — ${count} claim-vocab line(s), not in the register. ` +
            `Add these claims to docs/aura/claims-register.md, then list "${rel}": ${count} in claims-allowlist.json.`,
        );
      } else if (allowlist.strictCounts && count > allowed) {
        offenders.push(
          `NEW CLAIM    ${rel} — claim-vocab lines rose ${allowed} → ${count}. ` +
            `Re-status the affected claim(s) in docs/aura/claims-register.md, then bump the allowlist to ${count}.`,
        );
      }
    }
    expect(offenders, `\nClaims register is out of date:\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("the register and allowlist exist and agree on the vocabulary", () => {
    expect(existsSync(join(ROOT, "docs/aura/claims-register.md"))).toBe(true);
    expect(allowlist.vocab.length).toBeGreaterThan(0);
    // every allowlisted file should still exist (a removed file means a stale entry —
    // harmless, but flag it so the allowlist doesn't rot into fiction).
    const missing = Object.keys(allowlist.allowed).filter((f) => !existsSync(join(ROOT, f)));
    expect(missing, `Allowlist lists files that no longer exist: ${missing.join(", ")}`).toEqual([]);
  });
});
