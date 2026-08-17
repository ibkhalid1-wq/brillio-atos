/**
 * THE EDGE TYPECHECK, AS A RATCHET.
 *
 * `supabase/functions` shipped untypechecked for the life of this repo, and the
 * reason was never indifference — it was that the first honest run returned 434
 * errors, of which 372 were artifacts of having no config: no `Deno` global, no
 * types for the `https://esm.sh/…` imports, and an unparameterised Supabase
 * client whose rows resolve to `never`. Nobody can act on a list like that, so
 * nobody looked at it, so the ~60 real ones were invisible.
 *
 * With `tsconfig.edge.json` and the ambient shim the number is real. It is not
 * zero, and pretending otherwise by suppressing the rest would recreate exactly
 * the problem this replaces. So: a BASELINE, and the build fails when a file's
 * count goes UP or a new file appears. Fixing errors is free and lowers the
 * bar; adding one costs you a red build.
 *
 * The baseline is per FILE, not a single total. A total lets a fix in one file
 * pay for a regression in another and net to green — which is how a ratchet
 * quietly stops ratcheting.
 *
 *   npm run check:edge-types           verify
 *   npm run check:edge-types -- --update   re-baseline (after fixing things)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baselinePath = resolve(here, "baseline.json");

/** Run tsc and count errors per file. tsc exits non-zero when it finds any, so
 *  a throw is the normal path and the output is what we came for. */
function countsByFile() {
  let out = "";
  try {
    out = execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.edge.json"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    // A config failure prints no "error TS####(line,col)" lines at all. Treating
    // that as "zero errors, all clear" would turn a broken checker into a green
    // build, which is worse than no checker.
    if (!/error TS\d+/.test(out)) {
      console.error("check:edge-types — tsc produced no readable diagnostics:\n" + out.slice(0, 2000));
      process.exit(2);
    }
  }
  const counts = {};
  for (const line of out.split("\n")) {
    const m = /^(\S+?)\((\d+),(\d+)\): error TS\d+/.exec(line.trim());
    if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return counts;
}

const counts = countsByFile();
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`check:edge-types baseline written: ${Object.keys(counts).length} file(s), ${total} error(s).`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("check:edge-types — no baseline. Run: npm run check:edge-types -- --update");
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const worse = [];
for (const [file, n] of Object.entries(counts)) {
  const was = baseline[file] ?? 0;
  if (n > was) worse.push(`  ${file}: ${was} → ${n} (+${n - was})`);
}
// Improvements are reported, not enforced: a stale-high baseline is harmless,
// and failing a build for FIXING something would be absurd.
const better = Object.entries(baseline)
  .filter(([file, was]) => (counts[file] ?? 0) < was)
  .map(([file, was]) => `  ${file}: ${was} → ${counts[file] ?? 0}`);

if (worse.length) {
  console.error(`check:edge-types FAILED — new type errors in supabase/functions:\n${worse.join("\n")}\n\n`
    + "Fix them, or if they are genuinely pre-existing, re-baseline with:\n"
    + "  npm run check:edge-types -- --update");
  process.exit(1);
}
console.log(`check:edge-types OK — ${total} known error(s) across ${Object.keys(counts).length} file(s), none new.`);
if (better.length) {
  console.log(`Improved since the baseline — re-baseline to lock it in:\n${better.join("\n")}`);
}
