import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.js' 'src/**/*.jsx'", { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);

const text = new Map();
for (const f of files) text.set(f, readFileSync(f, "utf8"));

// Any file that does `import * as X from "<module>"` makes that module's
// exports unsafe to flag — record those module paths and skip them.
const namespaceImported = new Set();
for (const [, txt] of text) {
  const re = /import\s+\*\s+as\s+\w+\s+from\s*['"]([^'"]+)['"]/g;
  let m; while ((m = re.exec(txt))) namespaceImported.add(m[1].split("/").pop());
}

const exportRe = /export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
const candidates = files.filter(f => f.startsWith("src/v3/") && !f.includes("__tests__") && f !== "src/v3/AppShellV3.tsx");

const dead = [];
for (const f of candidates) {
  const base = f.replace(/\.(tsx|ts)$/, "").split("/").pop();
  if (namespaceImported.has(base)) continue; // module is `import *`-ed somewhere
  const txt = text.get(f);
  const seen = new Set();
  let m;
  while ((m = exportRe.exec(txt))) {
    const sym = m[1];
    if (seen.has(sym)) continue; seen.add(sym);
    // Count references to the bare identifier across ALL files except the defining one.
    const idRe = new RegExp("\\b" + sym + "\\b");
    let referenced = false;
    for (const [g, gtxt] of text) {
      if (g === f) continue;
      if (idRe.test(gtxt)) { referenced = true; break; }
    }
    if (!referenced) {
      const inFile = (txt.match(new RegExp("\\b" + sym + "\\b", "g")) || []).length;
      if (inFile <= 1) dead.push(`${f}  ::  ${sym}`); // declaration only = truly dead
    }
  }
}
console.log(dead.length + " truly-dead exports (declaration only, no refs anywhere)\n" + dead.join("\n"));
