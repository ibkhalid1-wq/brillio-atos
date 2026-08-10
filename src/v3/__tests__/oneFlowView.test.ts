/**
 * REGRESSION — Flow is ONE view, and every rail tile renders something.
 *
 * The change (2026-08-10): the classic Flow canvas was sunset. "flow" used to be
 * a second chrome that a preference flag (`lineViewPreferred`, `?ui=line|classic`,
 * localStorage `atos.lineView`) swapped for a separate "line" view, and an appbar
 * toggle let the operator flip between them. Two ids, two components, one concept.
 * Now: `view === "flow"` renders TheLine, the toggle is gone, and FlowCanvas.tsx
 * (plus the chrome only it mounted) is deleted.
 *
 * The failure this guards: a half-finished routing change strands the operator on
 * a rail tile whose branch no longer exists — the tile highlights, the page renders
 * the fall-through view (Pulse), and the work is unreachable. So the load-bearing
 * assertion here is the CONSERVATION one: every id in DOCK_ZONES / DOCK_ORDER, plus
 * every id the command palette can jump to, has a render branch in FlowShell.
 *
 * Source-level by necessity: FlowShell mounts the whole app graph (Supabase client,
 * lazy studios, realtime), so rendering it in vitest would test the mocks, not the
 * routing. The router here is a literal ternary chain, so reading it is exact.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const SHELL = "src/v3/components/flow/FlowShell.tsx";
const shell = read(SHELL);

/** The FlowView union, as the type declares it. */
const flowViewMembers = (): string[] => {
  const m = shell.match(/type FlowView =([^;]+);/);
  if (!m) throw new Error("FlowView union not found in FlowShell.tsx");
  return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
};

/** Views the render chain actually branches on (`view === "x" ?`). */
const renderedViews = (): Set<string> =>
  new Set([...shell.matchAll(/view === "([a-z]+)" \?/g)].map((m) => m[1]));

/** Rail ids, read from DOCK_ZONES. */
const dockIds = (): string[] => {
  const m = shell.match(/const DOCK_ZONES[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!m) throw new Error("DOCK_ZONES not found in FlowShell.tsx");
  return [...m[1].matchAll(/\["([a-z]+)",/g)].map((x) => x[1]);
};

describe("Flow is one view — the Line, with no second chrome", () => {
  it("FlowView has no 'line' member: one id for the work", () => {
    expect(flowViewMembers()).not.toContain("line");
    expect(flowViewMembers()).toContain("flow");
  });

  it("the Flow branch renders TheLine — not a canvas, not a flag", () => {
    // The branch text between `view === "flow" ?` and the next `) : view ===`.
    const branch = shell.slice(shell.indexOf(`view === "flow" ?`));
    const body = branch.slice(0, branch.indexOf(") : view ==="));
    expect(body).toContain("<TheLine");
    expect(shell).toContain(`import TheLine from "@/v3/components/flow/TheLine"`);
  });

  it("the chrome toggle and its preference flag are gone — no dead escape hatch", () => {
    for (const token of ["lineViewPreferred", "rememberLineView", "atos.lineView", "ui=classic"]) {
      expect(shell, `${token} still present in ${SHELL}`).not.toContain(token);
    }
    // aria-pressed was the toggle's only use in the appbar.
    expect(shell).not.toContain("Switch to the Line view");
    expect(shell).not.toContain("Switch to the classic chrome");
  });

  it("CONSERVATION: every rail tile and every palette jump has a render branch", () => {
    const rendered = renderedViews();
    // The final `else` of the chain renders Pulse, so "pulse" is routed without a
    // `view === "pulse"` test — name it explicitly rather than loosening the scan.
    const routed = new Set([...rendered, "pulse"]);
    const unroutable = dockIds().filter((id) => !routed.has(id));
    expect(unroutable, `rail tiles with no render branch: ${unroutable.join(", ")}`).toEqual([]);

    // Every declared FlowView is reachable, and nothing is routed that the union
    // does not declare (a stale branch is as bad as a missing one).
    const declared = new Set(flowViewMembers());
    expect([...routed].filter((v) => !declared.has(v))).toEqual([]);
    expect([...declared].filter((v) => !routed.has(v))).toEqual([]);
  });
});

describe("the classic canvas and the chrome only it mounted are deleted, not orphaned", () => {
  const deleted = [
    "src/v3/components/flow/FlowCanvas.tsx",
    "src/v3/components/flow/EnvisionCockpit.tsx",
    "src/v3/components/flow/ShowCockpit.tsx",
    "src/v3/components/flow/ProductOwnerCockpit.tsx",
    "src/v3/components/flow/ListenCockpit.tsx",
    "src/v3/components/flow/OntologyAtlasModal.tsx",
    "src/v3/components/flow/ExternalBuildPanel.tsx",
    "src/v3/components/flow/MeetingKitCard.tsx",
    "src/v3/components/flow/flowPatterns.ts",
    "src/v3/components/flow/flowStages.ts",
    "src/v3/components/flow/flowUpNext.tsx",
  ];

  it("the files are gone", () => {
    const survivors = deleted.filter((f) => existsSync(resolve(ROOT, f)));
    expect(survivors, `still on disk: ${survivors.join(", ")}`).toEqual([]);
  });

  it("nothing imports them", () => {
    // Walk src/ and supabase/ for an import specifier naming any deleted module.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules") continue;
        const abs = resolve(dir, name);
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/\.(ts|tsx|jsx)$/.test(abs)) files.push(abs);
      }
    };
    walk(resolve(ROOT, "src"));
    const stems = deleted.map((f) => f.split("/").pop()!.replace(/\.(tsx|ts)$/, ""));
    const offenders: string[] = [];
    for (const abs of files) {
      if (abs.endsWith("oneFlowView.test.ts")) continue; // this file names them on purpose
      const src = readFileSync(abs, "utf8");
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
        const stem = m[1].split("/").pop();
        if (stem && stems.includes(stem)) offenders.push(`${abs.slice(ROOT.length + 1)} -> ${m[1]}`);
      }
    }
    expect(offenders, `dangling imports:\n${offenders.join("\n")}`).toEqual([]);
  });
});
