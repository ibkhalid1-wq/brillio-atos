/**
 * THE PROTOTYPE IS A SCREEN, AND THE REFINE BAR IS AN INSTRUMENT.
 *
 * Two operator-surface defects of the same kind: a thing whose whole value is
 * that you can LOOK at it, drawn as a thing you read about.
 *
 *  · The prototype was the fourth tile in a row of four — same 212px box, same
 *    "decided, on record" line as three documents. A tile can tell you the file
 *    is present; only the screen tells you whether the application is any good,
 *    and the application is what the other three exist to produce.
 *  · The refine bar was an unlabelled dark input floating above that prototype.
 *    It said nothing about what it was allowed to change, and nothing about what
 *    survives into the NEXT generation — which was asked out loud, twice, and
 *    answered in a handover document instead of in the product.
 *
 * These pin the behaviour, not the wording: that the stage draws the assembled
 * build and is inert, that the starters fill the line rather than firing it, and
 * that the carry rules are reachable without leaving the surface.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import PrototypeCommandBar from "@/v3/components/flow/PrototypeCommandBar";
import DesignLoopZones from "@/v3/components/flow/DesignLoopZones";
import type { ProgramSummary } from "@/new/types";
import type { LineBand, LineStation } from "@/v3/lib/lineModel";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: Parameters<Root["render"]>[0]) => act(() => root.render(el));
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const all = (sel: string) => [...host.querySelectorAll(sel)];
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });

/* ── the refine instrument ────────────────────────────────────────────────── */

describe("the refine bar says what it does before it does it", () => {
  it("names itself and states the contract it works under", () => {
    render(createElement(PrototypeCommandBar, { onRefine: () => {} }));
    expect(q(".v3fs-refine-t")?.textContent).toMatch(/refine/i);
    // The model IS held to this by checkRefinedPrototype. Saying it here is what
    // stops an operator reading a refusal as a bug.
    const scope = q(".v3fs-refine-scope")?.textContent ?? "";
    expect(scope).toMatch(/presentation/i);
    expect(scope).toMatch(/preserved/i);
  });

  it("offers openings that FILL the line — the operator's own wording is still the point", async () => {
    const onRefine = vi.fn();
    render(createElement(PrototypeCommandBar, { onRefine }));
    const starters = all(".v3fs-refine-starter");
    expect(starters.length).toBeGreaterThan(0);

    click(starters[0]);
    const input = q<HTMLInputElement>(".v3fs-protocmd-in")!;
    expect(input.value).toBe(starters[0].textContent);
    // A starter that SENT would take a minute of model time on a wording the
    // operator never got to adjust.
    expect(onRefine).not.toHaveBeenCalled();
    // …and once the line has something on it, the openings stop competing with it.
    expect(all(".v3fs-refine-starter")).toHaveLength(0);
  });

  it("every opening is something the refine contract can accept", () => {
    // A starter asking for a screen, a field or a record would be REFUSED by the
    // build agent and come back as a gap — an opening that teaches the operator
    // the wrong vocabulary is worse than no opening.
    render(createElement(PrototypeCommandBar, { onRefine: () => {} }));
    for (const s of all(".v3fs-refine-starter")) {
      expect(s.textContent ?? "").not.toMatch(/\b(add|remove|delete|new)\b.*\b(screen|field|record|entity|column)\b/i);
    }
  });

  it("answers what the next generation inherits, on the surface rather than in a handover", () => {
    render(createElement(PrototypeCommandBar, { onRefine: () => {} }));
    const keeps = q(".v3fs-refine-keeps")?.textContent ?? "";
    // Carried: the approved stylesheet and the accepted widgets.
    expect(keeps).toMatch(/stylesheet/i);
    // NOT carried: per-region presentation, because the skeleton is re-derived.
    expect(keeps).toMatch(/re-derived|not inherited/i);
    // Closed by default — this is reference, not status.
    expect(q<HTMLDetailsElement>(".v3fs-refine-keeps")!.open).toBe(false);
  });

  it("a round in flight is announced, not merely spun", () => {
    render(createElement(PrototypeCommandBar, { onRefine: () => {}, regenerating: true }));
    const busy = q(".v3fs-refine-busy");
    expect(busy?.getAttribute("role")).toBe("status");
    expect(busy?.textContent).toMatch(/only presentation moves/i);
    // Nothing here can be sent while it runs, so the openings are withdrawn.
    expect(all(".v3fs-refine-starter")).toHaveLength(0);
  });

  it("the carry disclosure is prototype-specific and can be switched off", () => {
    // Another artifact's refine has no skin and no accepted spec to carry, so
    // the copy would be false there. Off by parameter, not by rewording.
    render(createElement(PrototypeCommandBar, { onRefine: () => {}, showKeeps: false, starters: [] }));
    expect(q(".v3fs-refine-keeps")).toBeNull();
    expect(all(".v3fs-refine-starter")).toHaveLength(0);
    expect(q(".v3fs-protocmd-in")).not.toBeNull();
  });
});

/* ── the prototype stage ──────────────────────────────────────────────────── */

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));

const station = (id: string, title: string, present: boolean): LineStation => ({
  id,
  title,
  subtitle: `${title} subtitle`,
  card: { id: `card-${id}`, present, generatedAt: "2026-08-16T09:00:00.000Z" } as LineStation["card"],
  maturity: "provisional",
  perArea: null,
  needsRefresh: false,
  canGenerate: !present,
} as unknown as LineStation);

const band = (): LineBand => ({
  id: "loop",
  name: "Design Loop",
  scope: "the design",
  chip: { text: "in flight", tone: "accent" },
  gate: [],
  stations: [
    station("architecture-strategy", "Architecture Strategy", true),
    station("experience-design", "Experience Design", true),
    station("agentic-blueprint", "Agentic Blueprint", true),
    station("prototype", "Prototype", true),
    station("validation", "Validation", false),
  ],
});

const ledger = { ownership: { stakeholder: 0 }, devs: [] } as unknown as ProgramLedger;

const programWith = (data: Record<string, unknown>) =>
  ({ id: "p1", name: "Laila", rawData: { data } } as unknown as ProgramSummary);

const zones = (program: ProgramSummary) =>
  createElement(DesignLoopZones, {
    band: band(), program, ledger, roster: [],
    onOpen: () => {}, regenBusy: {}, genBusy: {},
  });

describe("the prototype is drawn, not described", () => {
  const real = programWith({
    domainOntology: snap("domain-ontology.json"),
    currentStateAtlas: snap("current-state-atlas.json"),
  });

  it("is no longer a fourth identical tile beside the documents it comes from", () => {
    render(zones(real));
    const tiles = all(".v3dl-tile .v3dl-tile-n").map((n) => n.textContent);
    expect(tiles).toContain("Experience Design");
    expect(tiles).not.toContain("Prototype");
    // Still operator work, still inside the operator zone — a stage, not a fifth zone.
    expect(q(".v3dl-zone.is-operator .v3dl-stage")).not.toBeNull();
  });

  it("draws the assembled application itself", () => {
    render(zones(real));
    const frame = q<HTMLIFrameElement>(".v3dl-stage-frame")!;
    const drawn = frame.getAttribute("srcdoc") ?? "";
    expect(drawn).toContain("data-screen");
    expect(drawn).toContain("data-fabric-id");
  });

  it("is inert on the board — a prototype you can get lost inside is the studio's job", () => {
    render(zones(real));
    const frame = q<HTMLIFrameElement>(".v3dl-stage-frame")!;
    // Sandboxed, and the attribute must SURVIVE — a missing one runs the
    // document unsandboxed. It grants scripts and nothing else: the build draws
    // its records from a JSON island through its own renderer, so a script-less
    // frame stages an application with every table empty. Without
    // allow-same-origin the frame sits on an opaque origin and reaches nothing.
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("tabindex")).toBe("-1");
    // The veil is the real control — so the click lands on "open", never inside.
    expect(q(".v3dl-stage-veil")).not.toBeNull();
  });

  it("opens the studio from the screen, and rebuilds from the claims", () => {
    const opened: string[] = [];
    const regenerated: string[] = [];
    render(createElement(DesignLoopZones, {
      band: band(), program: real, ledger, roster: [],
      onOpen: (c: { id: string }) => { opened.push(c.id); },
      onRegen: (c: { id: string }) => { regenerated.push(c.id); },
      regenBusy: {}, genBusy: {},
    } as never));
    click(q(".v3dl-stage-veil"));
    expect(opened).toEqual(["card-prototype"]);
    const rebuild = all(".v3dl-stage-foot .v3dl-mini").find((b) => /rebuild/i.test(b.textContent ?? ""));
    click(rebuild!);
    expect(regenerated).toEqual(["card-prototype"]);
  });

  it("does not draw an application for a programme that has no build", () => {
    // The assembly succeeds from the ontology and atlas alone. Drawing it under
    // "upstream not ready" would put a complete application beside a line
    // saying there isn't one — and the picture is the more persuasive of the two.
    const band2 = band();
    const proto = band2.stations.find((st) => st.id === "prototype")!;
    (proto.card as { present: boolean }).present = false;
    render(createElement(DesignLoopZones, {
      band: band2, program: real, ledger, roster: [],
      onOpen: () => {}, regenBusy: {}, genBusy: {},
    } as never));
    expect(q(".v3dl-stage-frame")).toBeNull();
    expect(q(".v3dl-stage-none")).not.toBeNull();
  });

  it("says what it will be built from when there is nothing to draw yet", () => {
    render(zones(programWith({})));
    expect(q(".v3dl-stage-frame")).toBeNull();
    const none = q(".v3dl-stage-none")?.textContent ?? "";
    expect(none).toMatch(/ontology/i);
    expect(none).toMatch(/atlas/i);
  });
});
