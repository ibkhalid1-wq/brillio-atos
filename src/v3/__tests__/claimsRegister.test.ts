// Keeps docs/aura/claims-register.md honest. FAILS when a self-claim in a user- or
// model-facing surface is ADDED or REWORDED without the register accounting for it.
//
// Content-sensitive (not count-based): each claim-bearing line is normalized and
// hashed; the hash set per file lives in docs/aura/claims-allowlist.json. Rewording
// "grounded in the evidence" -> "fully traceable to source" changes the hash and
// trips the guard at identical line count. When it trips: re-status the affected
// register row, then run `npm run claims:regen`.
//
// Normalization / surface-set / vocabulary come from ONE module (claimsGuard) —
// imported here and by the regen script, so test and script can never disagree.
//
// No DB, no network — pure file scan.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, ALLOWLIST_PATH, REGISTER_PATH, VOCAB,
  surfaceFiles, relKey, claimLinesOf, claimHash,
} from "../lib/claimsGuard";

const allowlist = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_PATH), "utf8")) as {
  hashes: Record<string, string[]>;
  registerHash?: string;
};

describe("claims register guard", () => {
  it("no self-claim is added or reworded in a surface the register does not account for", () => {
    const offenders: string[] = [];
    for (const abs of surfaceFiles()) {
      const claimLines = claimLinesOf(abs);
      if (claimLines.length === 0) continue;
      const rel = relKey(abs);
      const allowed = new Set(allowlist.hashes[rel] ?? []);
      if (!allowlist.hashes[rel]) {
        offenders.push(
          `NEW SURFACE   ${rel} — ${claimLines.length} claim line(s), not in the register. ` +
            `Add these claims to ${REGISTER_PATH}, then run: npm run claims:regen`,
        );
        continue;
      }
      const changed = claimLines.filter((l) => !allowed.has(claimHash(l)));
      if (changed.length) {
        offenders.push(
          `CLAIM CHANGED ${rel} — ${changed.length} claim line(s) added or reworded, e.g.:\n` +
            changed.slice(0, 3).map((l) => `      > ${l.trim().slice(0, 120)}`).join("\n") +
            `\n    Fix: re-status the affected row in ${REGISTER_PATH}, then run: npm run claims:regen`,
        );
      }
    }
    expect(offenders, `\nClaims register is out of date:\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("the register and allowlist exist and are consistent", () => {
    expect(existsSync(join(ROOT, REGISTER_PATH))).toBe(true);
    expect(VOCAB.length).toBeGreaterThan(0);
    const missing = Object.keys(allowlist.hashes).filter((f) => !existsSync(join(ROOT, f)));
    expect(missing, `Allowlist lists files that no longer exist: ${missing.join(", ")}`).toEqual([]);
  });
});
