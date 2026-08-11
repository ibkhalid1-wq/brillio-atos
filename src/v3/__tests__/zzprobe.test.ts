/** SCRATCH PROBE — delete me. */
import { describe, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import FlowShell from "@/v3/components/flow/FlowShell";
import { accessibleName, isWordless, interactiveElements, roleOf } from "./helpers/accessibleName";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const LAILA_BLOB = {
  domainOntology: snap("domain-ontology.json") as Record<string, unknown>,
  currentStateAtlas: snap("current-state-atlas.json") as Record<string, unknown>,
  flowOperatorOverrides: snap("operator-overrides.json") as unknown[],
};
const PROGRAM = {
  id: "p1", name: "Laila", client: "Laila Skin", methodology: "atos-flow",
  rawData: { data: { ...LAILA_BLOB } },
} as unknown as ProgramSummary;
const noop = async () => {};
type Props = Parameters<typeof FlowShell>[0];
const shellProps = (): Props => ({
  program: PROGRAM, programs: [PROGRAM], runningAgentIds: new Set<string>(),
  onSelectProgram: () => {}, onCreateProgram: () => {}, onDrillDown: () => {},
  onOpenSetup: () => {}, onOpenCopilot: () => {}, onRunAgent: () => {},
  onSaveInputs: noop, onResolveDecision: noop,
  fleet: [], loadMovementSpend: async () => ({}), onSetHaltAll: noop,
  onToggleAgentHalt: noop, onSetMovementBudget: noop, onMintPacks: noop,
  onMintDemoInvites: noop, onCompileShipLanes: noop, onToggleShipItem: noop,
  onSetShipLane: noop, onHydratePrograms: noop, onScheduleFollowUp: noop,
  onMintFollowUp: async () => null, onMintReview: async () => null, onMintBrief: async () => null,
  onRecordShowPass: noop, onSaveArtifactDoc: noop,
  onIngestPortalItem: noop, onDismissPortalItem: noop, onRecordApproval: noop,
  onRenameProgram: () => {}, onDeleteProgram: () => {}, onTagClaim: noop, onGoFlow: () => {},
  presence: [],
} as unknown as Props);
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement; let root: Root;
const goto = (label: string) => {
  const b = [...host.querySelectorAll("nav.v3fs-dock button, header.v3fs-appbar button")]
    .find((x) => (x.getAttribute("aria-label") ?? "").startsWith(label)) as HTMLButtonElement;
  act(() => { b.click(); });
};
const expandEverything = () => {
  for (let pass = 0; pass < 3; pass++) {
    const togglers = [
      ...host.querySelectorAll('button[aria-expanded="false"]'),
      ...host.querySelectorAll(".v3ib-tab, .v3dl-drillbtn, .v3fs-ev-ghead, .v3ib-disc"),
    ] as HTMLButtonElement[];
    for (const t of togglers) { if (!t.disabled) act(() => { t.click(); }); }
    for (const d of Array.from(host.querySelectorAll("details"))) act(() => { (d as HTMLDetailsElement).open = true; });
  }
};
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  act(() => { root.render(createElement(FlowShell, shellProps())); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const GLYPHS = /[←-⇿⌀-⏿■-➿⬀-⯿！-～\u{1F300}-\u{1FAFF}]/u;
const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()} role=${roleOf(el)} class="${el.getAttribute("class") ?? ""}">`;

describe("probe", () => {
  it("atlas studio full audit", async () => {
    goto("Library");
    const rows = [...host.querySelectorAll(".v3fs-art-row")] as HTMLElement[];
    console.log("PRESENT ROWS:", rows.map((r) => (r.textContent ?? "").slice(0, 26)).join(" | "));
    const atlas = rows.find((r) => (r.textContent ?? "").includes("Current-State Atlas"))!;
    act(() => { atlas.click(); });
    await act(async () => { await import("@/v3/components/flow/studio/FlowArtifactStudio"); });
    expandEverything();
    const tiles = [...host.querySelectorAll("button.v3fs-swim-tile")] as HTMLElement[];
    console.log("COUNTS swim-tile:", tiles.length, "seam-tile:", host.querySelectorAll(".v3fs-seam-tile").length,
      "wf-bar btn:", host.querySelectorAll(".v3fs-wf-bar button").length,
      "swim-acts btn:", host.querySelectorAll(".v3fs-swim-acts button").length);
    if (tiles[0]) act(() => { tiles[0].click(); });
    console.log("inspector:", host.querySelectorAll(".v3fs-wf-inspector").length);

    const wordless: string[] = []; const glyphs = new Map<string, string>();
    const byName = new Map<string, Element[]>();
    for (const el of interactiveElements(host)) {
      const name = accessibleName(el);
      if (isWordless(name)) wordless.push(`${describeEl(el)} → ${JSON.stringify(name)} text=${JSON.stringify((el.textContent ?? "").slice(0, 30))}`);
      const hit = name.match(GLYPHS);
      if (hit) glyphs.set(`${el.getAttribute("class")}|${name.slice(0, 40)}`, `${describeEl(el)} → ${JSON.stringify(name.slice(0, 50))}`);
      if (name) (byName.get(name) ?? byName.set(name, []).get(name)!).push(el);
    }
    console.log("=== WORDLESS ===\n" + [...new Set(wordless)].join("\n"));
    console.log("=== GLYPHS ===\n" + [...glyphs.values()].join("\n"));
    console.log("=== CLASHES ===");
    for (const [name, els] of byName) {
      if (els.length > 1) console.log(`  ${els.length}x ${JSON.stringify(name.slice(0, 50))} (${els[0].tagName}.${els[0].getAttribute("class")})`);
    }
  });
});
