// The ONE definition of a "claim line": which files are swept, which vocabulary
// counts, how a line is normalized, and how it is hashed. Imported by BOTH the
// guard test (src/v3/__tests__/claimsRegister.test.ts) and the regen script
// (scripts/claims/regen.ts). Never reimplement any of this elsewhere — a second
// implementation that drifts is the exact failure the guard exists to prevent,
// arriving through the guard itself.
//
// Node-only (fs/crypto). It is dev/CI tooling that happens to live in src so the
// test can import it with full types; nothing in the app graph imports it, so it
// is never bundled for the browser.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

export const ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const REGISTER_PATH = "docs/aura/claims-register.md";
export const ALLOWLIST_PATH = "docs/aura/claims-allowlist.json";

// Surfaces swept for self-claims — defined ONCE, shared by test and script.
export const SURFACES = {
  componentsDir: "src/v3/components",
  componentsExt: ".tsx",
  libFiles: ["src/v3/lib/agentMeta.ts", "src/v3/lib/methodology.ts", "src/v3/lib/adamUserGuide.ts"],
  edgeFunctionsDir: "supabase/functions", // each <dir>/index.ts
} as const;

export const VOCAB: readonly string[] = [
  "traceab", "grounded", "grounding", "auditable", "provenance",
  "reproducib", "evidence-based", "end-to-end", "governed", "verifiab",
  "single source of truth", "source of truth",
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const VOCAB_RE = new RegExp(VOCAB.map(escapeRe).join("|"), "i");

export const isClaimLine = (line: string): boolean => VOCAB_RE.test(line);

// ASCII whitespace strip + ASCII lowercase. Deliberately ASCII-only so identical
// bytes are produced everywhere (no locale / Unicode-fold surprises).
export const normalizeClaimLine = (line: string): string =>
  line.replace(/[ \t\r\n\f\v]/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());

export const claimHash = (line: string): string =>
  createHash("sha1").update(normalizeClaimLine(line), "utf8").digest("hex").slice(0, 16);

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

// Absolute paths of every surface file, deduped + sorted (stable output order).
export function surfaceFiles(root: string = ROOT): string[] {
  const edgeBase = join(root, SURFACES.edgeFunctionsDir);
  const edge = existsSync(edgeBase)
    ? readdirSync(edgeBase).map((d) => join(edgeBase, d, "index.ts")).filter(existsSync)
    : [];
  const files = [
    ...walk(join(root, SURFACES.componentsDir), SURFACES.componentsExt),
    ...SURFACES.libFiles.map((f) => join(root, f)),
    ...edge,
  ];
  return [...new Set(files)].filter(existsSync).sort();
}

export const relKey = (abs: string, root: string = ROOT): string =>
  relative(root, abs).split("\\").join("/");

export const claimLinesOf = (abs: string): string[] =>
  readFileSync(abs, "utf8").split("\n").filter(isClaimLine);

// sha1 of the register's current content — pins what the allowlist was generated
// against, so regen can refuse to re-bless claims the register hasn't re-statused.
export const registerHash = (root: string = ROOT): string =>
  createHash("sha1").update(readFileSync(join(root, REGISTER_PATH), "utf8"), "utf8").digest("hex");
