/**
 * Capture controls have to be REACHABLE, not merely defined.
 *
 * The defect this pins: the classic-canvas sunset (564cd3d) deleted the last
 * importer of CollectBoard's `IntervieweeDiscovery`, and TranscribeButton — the
 * only entry point for file-upload transcription — was rendered *inside* that
 * component. Nothing threw, nothing failed to compile, no test went red. The
 * control simply stopped existing for users, and the flow-transcribe edge
 * function it calls went on being deployed and paid for.
 *
 * Why a FILE-level dead-code sweep cannot catch this, and why this test is
 * symbol-aware instead: CollectBoard.tsx *is* imported — TheLine, FlowShell and
 * DiscoveryKitAlign all pull `stakeholderCollection` out of it. The module is
 * alive; the exported component holding the render site is not. So reachability
 * is asked of the ENCLOSING EXPORTED SYMBOL, not of the file, and only against
 * modules the app entry can actually reach.
 *
 * Scope is deliberately the capture controls in flowCapture.tsx rather than
 * every component in the tree. These are the controls that gate an OUTSIDE
 * dependency (the flow-transcribe / document-parse endpoints): when one is
 * orphaned the loss is invisible in the UI and silent in the bill, which is
 * exactly the failure a cheap unit test should be spending its budget on.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { enclosingExport } from "./helpers/sourceGuards";

const SRC = resolve(__dirname, "../..");
const ENTRY = "main.jsx";

const CODE_EXT = [".ts", ".tsx", ".js", ".jsx"];
const isCode = (f: string) => CODE_EXT.some((e) => f.endsWith(e)) && !f.endsWith(".d.ts");

/** Every source module, keyed by its path relative to src/. */
const allModules = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "test" || entry === "node_modules") continue;
        walk(full);
      } else if (isCode(entry)) out.push(relative(SRC, full));
    }
  };
  walk(SRC);
  return out.sort();
};

const MODULES = allModules();
const MODULE_SET = new Set(MODULES);
const source = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * Resolve an import specifier to a module key. Bare package names resolve to
 * null — a control mounted inside node_modules is not a thing this repo can own.
 */
const resolveSpec = (fromModule: string, spec: string): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = relative(SRC, resolve(dirname(join(SRC, fromModule)), spec));
  else return null;
  const candidates = [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => `${base}/index${e}`)];
  return candidates.find((c) => MODULE_SET.has(c)) ?? null;
};

/** Static and dynamic import specifiers in a module. */
const importSpecs = (src: string): string[] => [
  ...[...src.matchAll(/(?:^|\n)\s*import\s[\s\S]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
];

/** Modules the app entry can actually get to (static or lazy). */
const reachableModules = (): Set<string> => {
  const seen = new Set<string>([ENTRY]);
  const queue = [ENTRY];
  while (queue.length) {
    const current = queue.shift()!;
    for (const spec of importSpecs(source(current))) {
      const target = resolveSpec(current, spec);
      if (target && !seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  return seen;
};

const REACHABLE = reachableModules();

/**
 * Which symbols each module has imported OUT of a given module — the default
 * import is recorded as "default". This is what makes the check symbol-aware:
 * an exported component nobody names is dead even when its file is not.
 */
const importedSymbolsOf = (target: string, importers: Iterable<string>): Set<string> => {
  const out = new Set<string>();
  for (const importer of importers) {
    if (importer === target) continue;
    const src = source(importer);
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
      if (resolveSpec(importer, m[2]) !== target) continue;
      const clause = m[1];
      const named = clause.match(/\{([\s\S]*?)\}/);
      if (named) for (const part of named[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (name) out.add(name);
      }
      const def = clause.replace(/\{[\s\S]*?\}/, "").split(",")[0].trim();
      if (def && !def.startsWith("*") && /^[A-Za-z_$][\w$]*$/.test(def)) out.add("default");
    }
  }
  return out;
};

/**
 * The top-level exported symbol a source offset sits inside, if any.
 *
 * IT MUST CONSIDER EVERY TOP-LEVEL DECLARATION, not only the exported ones. The first
 * spelling took the last `export function` ABOVE the offset and never asked whether the
 * offset was still inside it, and it did not recognise `export const X = () => …`. Move
 * the `<TranscribeButton>` JSX into a local
 *
 *     function CaptureDialog() { … }        // declared BELOW `export default function TheLine`
 *
 * and the old scanner still attributed the site to TheLine: the control is orphaned again
 * — the exact defect ed82514 was written to prevent — and the guard stays green.
 *
 * Top level is COLUMN ZERO: this codebase indents every declaration inside a function, so
 * the enclosing declaration of an offset is simply the last column-zero declaration above
 * it. If that one is not exported, the offset is inside a local host and the answer is
 * `null` — which makes the render site not-live, the fail-safe direction.
 */
// `enclosingExport` now lives in ./helpers/sourceGuards, where it can be fed its own
// bypasses — see sourceGuards.test.ts "H8". It walks the AST instead of matching
// column-zero text, because the local-host distinction is structural and a relaxed anchor
// turns correct code red (the reasoning is in the helper's doc comment).

/** Every place `<Control` is rendered, with the exported symbol that holds it. */
const renderSites = (control: string) =>
  MODULES.flatMap((mod) => {
    const src = source(mod);
    return [...src.matchAll(new RegExp(`<${control}[\\s/>]`, "g"))].map((m) => ({
      module: mod,
      host: enclosingExport(src, m.index!),
    }));
  });

/** A render site is LIVE when the app entry reaches a module that names its host. */
const liveSites = (control: string) =>
  renderSites(control).filter(({ module, host }) => {
    if (!host) return false;
    const wanted = host.isDefault ? "default" : host.name;
    return importedSymbolsOf(module, REACHABLE).has(wanted);
  });

describe("capture controls are reachable from the app entry", () => {
  it("the module graph resolved (guard against a scanner that quietly reads nothing)", () => {
    expect(MODULES.length).toBeGreaterThan(100);
    expect(REACHABLE.size).toBeGreaterThan(50);
    expect(REACHABLE.has("v3/components/flow/TheLine.tsx")).toBe(true);
    expect(REACHABLE.has("v3/components/flow/flowCapture.tsx")).toBe(true);
  });

  it("the scanner is symbol-aware: CollectBoard's file is live but IntervieweeDiscovery is not", () => {
    // Both halves matter. If the first ever goes false the module was deleted and
    // this test is asserting nothing; if the second goes true, someone re-mounted
    // IntervieweeDiscovery and the orphaning below is no longer the real defect.
    expect(REACHABLE.has("v3/components/flow/CollectBoard.tsx")).toBe(true);
    expect(importedSymbolsOf("v3/components/flow/CollectBoard.tsx", REACHABLE).has("IntervieweeDiscovery")).toBe(false);
  });

  // TranscribeButton is the one 564cd3d orphaned; AttachFileButton is held to the
  // same bar so the next sunset cannot quietly take the other one instead.
  it.each(["TranscribeButton", "AttachFileButton"])(
    "%s has at least one render site a user can reach",
    (control) => {
      expect(renderSites(control).length).toBeGreaterThan(0);
      expect(liveSites(control).map((s) => s.module)).not.toHaveLength(0);
    },
  );

  it("the HOST RESOLVER refuses a local function — the scanner's own bypass, fed to it", () => {
    // Without this, the whole suite is theatre: a render site could be moved into a
    // helper declared BELOW the export, the control would be orphaned exactly as
    // 564cd3d orphaned it, and `liveSites` would keep reporting it reachable because
    // it attributed the site to the last `export function` it happened to walk past.
    const bypass = [
      `export default function TheLine() {`,
      `  return <div />;`,
      `}`,
      ``,
      `function CaptureDialog() {`,
      `  return <TranscribeButton onTranscript={x} />;`,   // ← the offset under test
      `}`,
    ].join("\n");
    const at = bypass.indexOf("<TranscribeButton");
    expect(enclosingExport(bypass, at)).toBeNull();          // NOT "TheLine"

    // and the honest arrangements still resolve, so this is a tightening and not a mute
    const inside = [`export default function TheLine() {`, `  return <TranscribeButton />;`, `}`].join("\n");
    expect(enclosingExport(inside, inside.indexOf("<TranscribeButton"))).toEqual({ name: "TheLine", isDefault: true });
    const arrow = [`export const Panel = () => {`, `  return <TranscribeButton />;`, `};`].join("\n");
    expect(enclosingExport(arrow, arrow.indexOf("<TranscribeButton"))).toEqual({ name: "Panel", isDefault: false });
  });

  it("the capture dialog appends a transcript rather than overwriting the box", () => {
    // The dialog's textarea is a working surface: the operator may have pasted
    // notes before reaching for the recording. Overwriting would destroy them,
    // and nothing here is evidence until Capture is pressed.
    const line = source("v3/components/flow/TheLine.tsx");
    const mount = line.slice(line.indexOf("<TranscribeButton"));
    expect(mount.slice(0, mount.indexOf("/>"))).toContain("current.trim()");
  });
});
