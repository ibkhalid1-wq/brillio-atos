/**
 * KEYBOARD AND STRUCTURE — the half of accessibility a screen-reader label cannot buy.
 *
 * FlowShell makes several DIVs behave like buttons (`role="button" tabIndex={0}`): the
 * portfolio card head, the drill-down row, the claims row, an evidence row, an artifact
 * row. ARIA's own rule for that pattern is exact — a widget with role="button" must
 * activate on ENTER and on SPACE, must swallow Space's default (or the page scrolls out
 * from under the operator), and must not fire when the key was pressed on a control
 * NESTED inside it.
 *
 * FlowShell already knew this once: the portfolio card carries a written-out comment
 * about pressing Enter on its Rename pencil arming the rename and then navigating off
 * the card, fixed there with an `e.target !== e.currentTarget` guard. The guard was
 * never applied to the other four rows, and two of them nest a real button. This file
 * asserts the rule for EVERY such row rather than for the one that was reported.
 *
 * Everything is driven through real KeyboardEvents dispatched at the real element, and
 * every assertion is on a prop spy — "the handler ran" means the programme actually
 * changed, not that a listener exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import FlowShell from "@/v3/components/flow/FlowShell";
import { interactiveElements, accessibleName } from "./helpers/accessibleName";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const LAILA_BLOB = {
  domainOntology: snap("domain-ontology.json") as Record<string, unknown>,
  currentStateAtlas: snap("current-state-atlas.json") as Record<string, unknown>,
  flowOperatorOverrides: snap("operator-overrides.json") as unknown[],
};
const AT = "2026-08-01T00:00:00Z";

/**
 * A programme with a DRILL-DOWN CHILD and a TAGGED CLAIM, because those are the two
 * rows that nest a button inside the clickable row — the double-fire shapes. Without
 * them the rows exist but the defect cannot be reproduced.
 */
const PARENT = {
  id: "p1", name: "Laila", client: "Laila Skin", methodology: "atos-flow",
  rawData: {
    data: {
      ...LAILA_BLOB,
      claimTags: [{
        id: "c1", quote: "we reconcile the pipeline weekly by hand",
        who: "Ada", movementId: "listen", ts: AT, by: "op",
        target: { kind: "process", refId: "pr-1", label: "Pipeline reconciliation" },
      }],
      phaseInputs: {
        listen: { transcripts: [{ who: "Ada", text: "we reconcile the pipeline weekly by hand, every Friday", capturedAt: AT }] },
      },
    },
  },
} as unknown as ProgramSummary;
/** The child that makes a drill-down row render, wired to the parent by anchor. */
const CHILD = {
  id: "p2", name: "Pipeline drill-down", parentProgramId: "p1", methodology: "atos-flow",
  rawData: { data: { lineage: { parentId: "p1", anchor: { kind: "process", refId: "pr-1", label: "Pipeline reconciliation" } } } },
} as unknown as ProgramSummary;

type Props = Parameters<typeof FlowShell>[0];
const noop = async () => {};

let host: HTMLDivElement;
let root: Root;
let onSelectProgram: ReturnType<typeof vi.fn>;
let onTagClaim: ReturnType<typeof vi.fn>;

const shellProps = (): Props => ({
  program: PARENT, programs: [PARENT, CHILD], runningAgentIds: new Set<string>(),
  onSelectProgram, onCreateProgram: () => {}, onDrillDown: () => {},
  onOpenSetup: () => {}, onOpenCopilot: () => {}, onRunAgent: () => {},
  onSaveInputs: noop, onResolveDecision: noop,
  fleet: [], loadMovementSpend: async () => ({}), onSetHaltAll: noop,
  onToggleAgentHalt: noop, onSetMovementBudget: noop, onMintPacks: noop,
  onMintDemoInvites: noop, onCompileShipLanes: noop, onToggleShipItem: noop,
  onSetShipLane: noop, onHydratePrograms: noop, onScheduleFollowUp: noop,
  onMintFollowUp: async () => null, onMintReview: async () => null, onMintBrief: async () => null,
  onRecordShowPass: noop, onSaveArtifactDoc: noop,
  onIngestPortalItem: noop, onDismissPortalItem: noop, onRecordApproval: noop,
  onRenameProgram: () => {}, onDeleteProgram: () => {}, onTagClaim, onGoFlow: () => {},
  presence: [],
} as unknown as Props);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const goto = (label: string) => {
  const b = [...host.querySelectorAll("nav.v3fs-dock button, header.v3fs-appbar button")]
    .find((x) => (x.getAttribute("aria-label") ?? "").startsWith(label)) as HTMLButtonElement | undefined;
  if (!b) throw new Error(`no navigation control for ${label}`);
  act(() => { b.click(); });
};

/** A real key press, bubbling and cancellable, exactly as the browser sends it. */
const press = (el: Element, key: string): KeyboardEvent => {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onSelectProgram = vi.fn();
  onTagClaim = vi.fn(async () => {});
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  act(() => { root.render(createElement(FlowShell, shellProps())); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Every DIV-as-button on the page: the pattern with the obligations. */
const divButtons = () => [...host.querySelectorAll('[role="button"][tabindex="0"]')] as HTMLElement[];

describe("a div with role=button behaves like a button", () => {
  it("Library draws the rows this file is about", () => {
    goto("Library");
    // If this ever goes to zero the rest of the file is vacuously green, so it is
    // asserted rather than assumed.
    expect(divButtons().length).toBeGreaterThan(0);
    expect(host.querySelector(".v3fs-dd-row"), "the drill-down row must render").toBeTruthy();
    expect(host.querySelector(".v3fs-claims .v3fs-row-open"), "the claims row must render").toBeTruthy();
  });

  it("EVERY div-button on every view activates on Enter AND on Space", () => {
    // Rather than naming rows one by one, this drives whatever the page draws. A row
    // "activates" if its keydown is prevented — the same signal the browser uses to
    // decide whether to scroll — which every correct role=button handler must set.
    const misses: string[] = [];
    for (const view of ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"]) {
      goto(view);
      // Re-queried by INDEX before every press: activating one row re-renders the
      // view, and a captured node that React has since replaced is detached — a key
      // dispatched at it never reaches React's root listener, so a stale reference
      // reads as "this row handles nothing" and the case silently inverts.
      for (let i = 0; i < divButtons().length; i++) {
        for (const key of ["Enter", " "]) {
          const el = divButtons()[i];
          if (!el) break;
          const ev = press(el, key);
          if (!ev.defaultPrevented) {
            misses.push(`${view}: ${el.className} does not handle ${JSON.stringify(key)} (accessible name: ${accessibleName(el)})`);
          }
        }
      }
    }
    expect([...new Set(misses)]).toEqual([]);
  });

  it("Space is swallowed, so pressing it does not scroll the page away", () => {
    // The specific half of the rule above that is easiest to get wrong: a handler
    // that calls the action but forgets preventDefault still scrolls.
    goto("Library");
    const rows = divButtons();
    expect(rows.length).toBeGreaterThan(0);
    for (const el of rows) expect(press(el, " ").defaultPrevented, `${el.className} lets Space scroll`).toBe(true);
  });

  it("a key press on a NESTED control does not also fire the row", () => {
    // THE DOUBLE-FIRE. `onKeyDown` on the row sees keydowns that bubbled up from the
    // buttons inside it, so activating "Pull findings" or "Untag" with the keyboard
    // ran that action AND opened/navigated the row underneath it. Mouse users never
    // saw it: the nested onClick calls stopPropagation, keydown does not.
    //
    // THE PROBE IS `defaultPrevented`, not a prop spy and not the rendered HTML.
    // Both of those were tried and both were too weak: most of these rows act on
    // FlowShell's own state (setDocFor / setEvFor) rather than a prop, and a row whose
    // action happens to find nothing to open changes no HTML either — so the guard
    // could be deleted and the test stayed green. `rowActivate` calls preventDefault
    // as its FIRST act after deciding to fire, so a bubbled event coming back
    // defaultPrevented is the row having fired, whatever the action then did or
    // failed to do. A native <button> does not cancel keydown, so nothing else can
    // set it. The HTML/spy checks are kept as a second net.
    const offenders: string[] = [];
    let nestedSeen = 0;
    for (const view of ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"]) {
      goto(view);
      for (const row of divButtons()) {
        for (const child of interactiveElements(row).filter((n) => n !== row)) {
          nestedSeen++;
          for (const key of ["Enter", " "]) {
            onSelectProgram.mockClear(); onTagClaim.mockClear();
            const before = host.innerHTML;
            const ev = press(child, key);
            const fired = ev.defaultPrevented
              || host.innerHTML !== before
              || onSelectProgram.mock.calls.length > 0
              || onTagClaim.mock.calls.length > 0;
            if (fired) {
              offenders.push(`${view}: ${row.className} fires on ${JSON.stringify(key)} at its nested ${child.tagName}.${child.className} (${accessibleName(child)})`);
            }
          }
        }
      }
    }
    // If nothing nests, the case is vacuous — say so rather than pass quietly.
    expect(nestedSeen, "no row on any view nests an interactive control — this case proves nothing").toBeGreaterThan(0);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("the drill-down row really does navigate, on both keys", () => {
    // The guard above must not be over-tight: a press on the ROW itself still works.
    goto("Library");
    const row = host.querySelector(".v3fs-dd-row") as HTMLElement;
    expect(row).toBeTruthy();
    onSelectProgram.mockClear(); press(row, "Enter");
    expect(onSelectProgram).toHaveBeenCalledWith("p2");
    onSelectProgram.mockClear(); press(row, " ");
    expect(onSelectProgram).toHaveBeenCalledWith("p2");
  });
});

describe("structure", () => {
  const headings = () =>
    [...host.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .filter((h) => (h.textContent ?? "").trim())
      .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim().slice(0, 40) }));

  it("no view skips a heading level", () => {
    const bad: string[] = [];
    for (const view of ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"]) {
      goto(view);
      const hs = headings();
      expect(hs.length, `${view} draws no headings at all`).toBeGreaterThan(0);
      let prev = hs[0].level;
      if (prev !== 1) bad.push(`${view}: starts at h${prev} ("${hs[0].text}"), not h1`);
      for (const h of hs.slice(1)) {
        if (h.level > prev + 1) bad.push(`${view}: h${prev} → h${h.level} skips a level at "${h.text}"`);
        prev = h.level;
      }
    }
    expect(bad).toEqual([]);
  });

  it("the shell has its landmarks, each named, and only one main heading", () => {
    goto("Inbox");
    const nav = [...host.querySelectorAll("nav")];
    expect(nav.length, "the rail and the breadcrumb are both <nav>").toBeGreaterThanOrEqual(2);
    for (const n of nav) {
      expect(accessibleName(n) || n.getAttribute("aria-label"), `an unnamed <nav> is indistinguishable from the others`).toBeTruthy();
    }
    expect(host.querySelectorAll("h1").length, "exactly one h1 per view").toBe(1);
  });

  it("live regions are reserved for genuine updates, and are not stacked", () => {
    // role="status" is announced every time its content changes. Two failure modes:
    // too many (the page natters) and nesting (one change announced twice). The dock's
    // NEXT cue and the doc-router banner are the legitimate ones on this fixture.
    const live: string[] = [];
    for (const view of ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"]) {
      goto(view);
      for (const r of host.querySelectorAll('[role="status"],[role="alert"],[aria-live]')) {
        live.push(`${view}:${r.getAttribute("class") ?? r.getAttribute("role")}`);
        // A live region inside another live region announces its change twice.
        const outer = r.parentElement?.closest('[role="status"],[role="alert"],[aria-live]');
        expect(outer, `${r.className} is nested inside another live region`).toBeFalsy();
      }
      // A page-load burst of announcements is the "over-used" failure. Three is the
      // most any single view draws here; more than that and the shell is chattering.
      const perView = live.filter((x) => x.startsWith(`${view}:`)).length;
      expect(perView, `${view} draws ${perView} live regions at once`).toBeLessThanOrEqual(3);
    }
    // …and at least one, or the "NEXT · N waiting" cue is not being announced at all.
    expect(live.length).toBeGreaterThan(0);
  });

  it("the rail's NEXT cue is a status region that names itself in words", () => {
    goto("Flow");
    const next = host.querySelector(".v3fs-next");
    if (!next) return;                       // no next hint on this fixture — nothing to check
    expect(next.getAttribute("role")).toBe("status");
    // It sits INSIDE the rail button, so it must not swallow or duplicate that
    // button's name: the button carries its own aria-label, which wins.
    const button = next.closest("button")!;
    expect(button.getAttribute("aria-label")).toBeTruthy();
    expect(accessibleName(button)).toBe(button.getAttribute("aria-label"));
  });

  it("every table that carries data associates its headers", () => {
    const bad: string[] = [];
    for (const view of ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"]) {
      goto(view);
      for (const table of host.querySelectorAll("table")) {
        const ths = table.querySelectorAll("th");
        if (!ths.length) { bad.push(`${view}: a <table> with no <th> at all`); continue; }
        for (const th of ths) {
          // A <th> in a header ROW needs scope="col"; one leading a body row needs
          // scope="row". Without it, a screen reader guesses.
          if (!th.getAttribute("scope") && !th.getAttribute("id")) {
            bad.push(`${view}: <th>${(th.textContent ?? "").trim().slice(0, 24)}</th> has no scope`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
