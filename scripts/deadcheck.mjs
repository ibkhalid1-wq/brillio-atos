import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);

// Build a corpus of import specifiers used anywhere.
const importRe = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const usedSpecifiers = new Set();
const fileText = new Map();
for (const f of files) {
  const txt = readFileSync(f, "utf8");
  fileText.set(f, txt);
  let m;
  while ((m = importRe.exec(txt))) usedSpecifiers.add(m[1] || m[2]);
}

// Candidate = any file under src/v3 (excluding tests + entry).
const candidates = files.filter(f => f.startsWith("src/v3/") && !f.includes("__tests__"));

function basenames(f) {
  const noExt = f.replace(/\.(tsx|ts)$/, "");
  return new Set([noExt, noExt.split("/").pop()]);
}

const dead = [];
for (const f of candidates) {
  const noExt = f.replace(/\.(tsx|ts)$/, "");
  const base = noExt.split("/").pop();
  // A file is "used" if some import specifier resolves to it: ends with /<base> or is @/<path>.
  const aliasPath = "@/" + noExt.replace(/^src\//, "");
  let used = false;
  for (const spec of usedSpecifiers) {
    if (spec === aliasPath) { used = true; break; }
    const specBase = spec.split("/").pop();
    if (specBase === base && (spec.includes("/v3/") || spec.startsWith(".") )) { used = true; break; }
  }
  if (!used) dead.push(f);
}

console.log(JSON.stringify(dead, null, 2));
