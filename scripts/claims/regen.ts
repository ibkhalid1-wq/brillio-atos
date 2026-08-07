// npm run claims:regen  —  regenerate docs/aura/claims-allowlist.json from the tree
// using the ONE normalizer (src/v3/lib/claimsGuard.ts). Run via vite-node.
//
// REFUSES to write unless the claims register has changed since the allowlist was
// last generated (it compares a recorded registerHash). This stops the easy path
// for an overclaim to enter — reword, regen, green — because regenerating a
// reworded claim requires touching the register, which a reviewer sees. Pass
// --force for a genuine mechanics-only regen (prints a warning).
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, ALLOWLIST_PATH, REGISTER_PATH, SURFACES, VOCAB,
  surfaceFiles, relKey, claimLinesOf, claimHash, registerHash,
} from "../../src/v3/lib/claimsGuard";

const force = process.argv.includes("--force");
const allowlistAbs = join(ROOT, ALLOWLIST_PATH);
const curReg = registerHash();

let prior: { registerHash?: string } | null = null;
if (existsSync(allowlistAbs)) {
  try { prior = JSON.parse(readFileSync(allowlistAbs, "utf8")); } catch { prior = null; }
}

if (prior && prior.registerHash === curReg && !force) {
  console.error(
    `\nclaims:regen refused — ${REGISTER_PATH} has NOT changed since the allowlist was last generated.\n` +
    `A reworded or added claim must be accounted for first:\n` +
    `  1. re-status the affected row in ${REGISTER_PATH}\n` +
    `  2. re-run: npm run claims:regen\n` +
    `If this is genuinely mechanics-only (no claim changed), re-run with:  npm run claims:regen -- --force\n`,
  );
  process.exit(1);
}
if (force && prior && prior.registerHash === curReg) {
  console.warn("\n⚠  claims:regen --force: regenerating WITHOUT a register change. Confirm no claim got worse.\n");
}

const hashes: Record<string, string[]> = {};
for (const abs of surfaceFiles()) {
  const lines = claimLinesOf(abs);
  if (lines.length) hashes[relKey(abs)] = lines.map(claimHash);
}

const doc =
  "Hash-based guard for docs/aura/claims-register.md, enforced by " +
  "src/v3/__tests__/claimsRegister.test.ts. Regenerate with: npm run claims:regen. " +
  "Each key is a claim-surface file; each value is the sha1-16 hashes of its " +
  "claim-bearing lines, normalized by src/v3/lib/claimsGuard.ts (the ONE definition, " +
  "shared with the test). The test fails when a claim line is added or reworded " +
  "(new hash) or a new surface introduces claim vocabulary. registerHash pins the " +
  "register content at generation time so regen cannot silently re-bless a claim the " +
  "register has not re-statused. DO NOT hand-edit; run npm run claims:regen.";

// Deterministic, diff-friendly serialization (one file per line, sorted).
const files = Object.keys(hashes).sort();
const body = files
  .map((f) => `    ${JSON.stringify(f)}: [${hashes[f].map((h) => `"${h}"`).join(",")}]`)
  .join(",\n");
const out =
  "{\n" +
  `  "_doc": ${JSON.stringify(doc)},\n` +
  `  "registerHash": ${JSON.stringify(curReg)},\n` +
  `  "surfaces": ${JSON.stringify(SURFACES)},\n` +
  `  "vocab": ${JSON.stringify(VOCAB)},\n` +
  `  "hashes": {\n${body}\n  }\n}\n`;

writeFileSync(allowlistAbs, out);
const total = files.reduce((n, f) => n + hashes[f].length, 0);
console.log(`claims:regen wrote ${ALLOWLIST_PATH}: ${files.length} files, ${total} hashes (registerHash ${curReg.slice(0, 12)}…).`);
