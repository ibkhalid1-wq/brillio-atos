/**
 * DIRECT MANIPULATION ON THE CURRENT-STATE ATLAS'S SWIMLANE — and the four things
 * that had to stay true while it was added.
 *
 * Until now a step could only be moved, added or dropped INDIRECTLY: select a tile,
 * then reach for a toolbar under the diagram. The diagram is the document, so the
 * document should be editable where it is drawn — a tile is now draggable, and each
 * tile carries its own "insert a step after this one" and "mark dropped".
 *
 * Four things this file exists to hold down, in the order they can break:
 *
 *  1. ONE WRITE PATH. Drag-drop reorders through the SAME `reorderStep` the `←
 *     Earlier` / `Later →` buttons call, and lands as exactly one `onChange`. A
 *     second write path is how two ways of doing one thing start to disagree.
 *
 *  2. KEYBOARD PARITY. HTML5 drag-and-drop cannot be reached from a keyboard at all,
 *     so the reorder buttons MUST remain and the tile's own controls must be real
 *     buttons. Asserted here as well as in a11yFlow*, because those audit whatever
 *     the shell happens to draw and this fixture guarantees the surface is drawn.
 *
 *  3. THE GATES. A locked/derived artifact gets NO drag affordance and NO
 *     add/delete — the tile is not draggable at all, rather than
 *     draggable-but-refused.
 *
 *  4. THE ANCHORS, AND THEREFORE AGENTIFY'S DECISIONS. Steps carry `_atlasStepId`,
 *     and Agentify files its calls under that id. Reordering must carry the step
 *     OBJECT, not rebuild it: a reorder that dropped or re-derived an anchor would
 *     silently lose or misattribute a decision. The last describe() proves it,
 *     including for a step whose anchor deliberately DISAGREES with its text (an
 *     atlas step reworded after Agentify was generated) — the case where a rebuilt
 *     anchor would land the call on the wrong step and nothing else would notice.
 *
 * jsdom implements no real drag-and-drop: there is no DragEvent constructor and no
 * DataTransfer. So the handlers are driven DIRECTLY with synthetic dragstart /
 * dragover / drop events carrying a hand-rolled dataTransfer, and the drop column's
 * box is stubbed so the before/after half can be aimed at. Nothing here claims a
 * browser-level drag was performed.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import WorkflowStudio from "@/v3/components/flow/studio/WorkflowStudio";
import { StudioLockContext, StudioAuthoringContext } from "@/v3/components/flow/studio/StudioKit";
import { ATLAS_STEP_ID } from "@/v3/lib/ledger/agentifyAnchor";
import { decisionStepId, readDecisions, type DecisionMap } from "@/v3/lib/ledger/agentifyDecisions";
import { accessibleName, isWordless, interactiveElements } from "./helpers/accessibleName";

/* ── fixture ──────────────────────────────────────────────────────────────── */

const PROGRAM = {
  id: "p-dm", name: "Direct manipulation fixture", client: "Fixture Co", methodology: "atos-flow",
  rawData: { data: { currentStateAtlas: { workflows: [] }, domainOntology: { entities: [] } } },
} as unknown as ProgramSummary;

/** Four steps across two lanes, so a move crosses a lane and the order is legible. */
const seedDoc = (): Record<string, unknown> => ({
  workflows: [{
    name: "Quote to cash", area: "Sales", owner: "Ada", trigger: "An RFQ arrives",
    handoffs: [], failureModes: [],
    steps: [
      { actor: "Sales Rep", action: "Draft the quote", system: "CRM", duration: "2d" },
      { actor: "Sales Rep", action: "Price the quote", system: "CPQ", duration: "1d" },
      { actor: "Delivery Lead", action: "Staff the engagement", system: "PSA", duration: "1d" },
      { actor: "Finance Analyst", action: "Raise the invoice", system: "ERP", duration: "2h" },
    ],
  }],
  painHeatmap: [], events: [], systemsInventory: [],
});

/* ── harness ──────────────────────────────────────────────────────────────── */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let wrote: Record<string, unknown> | null = null;
let onChangeSpy: ReturnType<typeof vi.fn>;

function Harness({ initial, locked, anchorDoc }: {
  initial: Record<string, unknown>; locked: boolean;
  anchorDoc?: Record<string, unknown>;
}) {
  const [doc, setDoc] = useState(initial);
  return createElement(StudioLockContext.Provider, { value: locked },
    createElement(StudioAuthoringContext.Provider, { value: true },
      createElement(WorkflowStudio, {
        doc, program: PROGRAM, anchorDoc,
        onChange: (next: Record<string, unknown>) => { wrote = next; onChangeSpy(next); setDoc(next); },
      })));
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(opts: {
  doc?: Record<string, unknown>; locked?: boolean; anchorDoc?: Record<string, unknown>;
} = {}): HTMLElement {
  wrote = null;
  onChangeSpy = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(Harness, {
      initial: opts.doc ?? seedDoc(),
      locked: opts.locked ?? false,
      anchorDoc: opts.anchorDoc,
    }));
  });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null; host = null; wrote = null;
});

/* ── DOM helpers ──────────────────────────────────────────────────────────── */

function click(el: Element | null | undefined): void {
  if (!el) throw new Error("click: no element");
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

function buttonWith(el: ParentNode, label: string, sel = "button"): HTMLButtonElement {
  const hit = [...el.querySelectorAll(sel)]
    .find((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim().includes(label));
  if (!hit) throw new Error(`no ${sel} containing “${label}”`);
  return hit as HTMLButtonElement;
}

/** Open a workflow inline the way an operator does — click its row. */
function openWorkflow(el: HTMLElement, name: string): HTMLElement {
  click(buttonWith(el, name, "button.v3fs-seam-wf-open"));
  const detail = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail");
  if (!detail) throw new Error(`workflow “${name}” did not expand inline`);
  return detail;
}

const tiles = (el: ParentNode) => [...el.querySelectorAll("button.v3fs-swim-tile")] as HTMLButtonElement[];
/** The tile for step `i` — the swimlane draws each step's tile exactly once. */
const tile = (el: ParentNode, i: number): HTMLButtonElement => {
  const hit = tiles(el)[i];
  if (!hit) throw new Error(`no tile for step ${i}`);
  return hit;
};
/** Every cell of a column — the tile's own, plus the empty ones in other lanes. */
const cells = (el: ParentNode, step: number) =>
  [...el.querySelectorAll(`.v3fs-swim-cell[data-step="${step}"]`)] as HTMLElement[];

const order = (): string[] =>
  ((wrote!.workflows as Array<Record<string, unknown>>)[0].steps as Array<Record<string, unknown>>)
    .map((s) => String(s.action));
const writtenSteps = (): Array<Record<string, unknown>> =>
  (wrote!.workflows as Array<Record<string, unknown>>)[0].steps as Array<Record<string, unknown>>;

/* ── synthetic drag (jsdom has no DragEvent and no DataTransfer) ──────────── */

interface FakeTransfer {
  dropEffect: string; effectAllowed: string;
  setData: (t: string, v: string) => void;
  getData: (t: string) => string;
}
const makeTransfer = (): FakeTransfer => {
  const store: Record<string, string> = {};
  return {
    dropEffect: "", effectAllowed: "",
    setData: (t, v) => { store[t] = v; },
    getData: (t) => store[t] ?? "",
  };
};

/** A drag-family event React will route to onDragStart / onDragOver / onDrop. */
function fireDrag(el: Element, type: string, opts: { clientX?: number; dataTransfer?: FakeTransfer } = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: opts.clientX ?? 0 });
  Object.defineProperty(ev, "dataTransfer", { value: opts.dataTransfer ?? makeTransfer(), configurable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

/** Give a column a real box so the before/after half can be aimed at. */
const stubBox = (el: HTMLElement, left: number, width: number) => {
  el.getBoundingClientRect = () => ({
    left, width, right: left + width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}),
  }) as DOMRect;
};

/**
 * Drag the tile of step `from` and drop it on column `onto`, on the given half.
 * Returns the drop event so a caller can assert it was accepted.
 */
function dragStepOnto(detail: HTMLElement, from: number, onto: number, half: "before" | "after") {
  const dt = makeTransfer();
  fireDrag(tile(detail, from), "dragstart", { dataTransfer: dt });
  const target = cells(detail, onto)[0];
  if (!target) throw new Error(`no cell for column ${onto}`);
  stubBox(target, 100, 100);
  const x = half === "before" ? 120 : 180;
  fireDrag(target, "dragover", { clientX: x, dataTransfer: dt });
  return fireDrag(target, "drop", { clientX: x, dataTransfer: dt });
}

/* ── 1 · reorder by drag, through the one write path ──────────────────────── */

describe("dragging a tile reorders the step", () => {
  it("dropping on the LEFT half of a later column puts the step just before it", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 0, 2, "before");
    expect(order()).toEqual(["Price the quote", "Draft the quote", "Staff the engagement", "Raise the invoice"]);
  });

  it("dropping on the RIGHT half of a later column puts the step just after it", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 0, 2, "after");
    expect(order()).toEqual(["Price the quote", "Staff the engagement", "Draft the quote", "Raise the invoice"]);
  });

  it("a step can be dragged EARLIER too — dropping on the left half of an earlier column", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 3, 0, "before");
    expect(order()).toEqual(["Raise the invoice", "Draft the quote", "Price the quote", "Staff the engagement"]);
  });

  it("dropping a step back where it started writes nothing at all", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 1, 1, "before");
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(wrote).toBeNull();
  });

  it("a reorder is ONE write — the same onChange the toolbar buttons use, not a second path", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 0, 3, "after");
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    // …and the write is a whole document with the workflows on it, exactly as
    // patchWorkflow → writeWorkflows → onChange emits.
    expect(Object.keys(onChangeSpy.mock.calls[0][0])).toContain("workflows");
  });

  it("the drop is ACCEPTED — dragover and drop are both prevented, or the browser refuses the drop", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const dt = makeTransfer();
    fireDrag(tile(detail, 0), "dragstart", { dataTransfer: dt });
    const target = cells(detail, 2)[0];
    stubBox(target, 100, 100);
    expect(fireDrag(target, "dragover", { clientX: 120, dataTransfer: dt }).defaultPrevented).toBe(true);
    expect(fireDrag(target, "drop", { clientX: 120, dataTransfer: dt }).defaultPrevented).toBe(true);
  });

  it("a drag that did not start here is ignored — a stray dragover never moves a step", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const target = cells(detail, 2)[0];
    stubBox(target, 100, 100);
    // No dragstart: this is a file, or a drag from another part of the page.
    expect(fireDrag(target, "dragover", { clientX: 120 }).defaultPrevented).toBe(false);
    fireDrag(target, "drop", { clientX: 120 });
    expect(wrote).toBeNull();
  });

  it("the whole COLUMN takes the drop, not only the lane the tile sits in", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    // Column 2's step is a Delivery Lead step; drop onto the Sales Rep lane's empty
    // cell in that same column. Three lanes → three cells per column.
    const column = cells(detail, 2);
    expect(column.length).toBeGreaterThan(1);
    const empty = column.find((c) => !c.classList.contains("has"))!;
    expect(empty).toBeTruthy();
    const dt = makeTransfer();
    fireDrag(tile(detail, 0), "dragstart", { dataTransfer: dt });
    stubBox(empty, 100, 100);
    fireDrag(empty, "dragover", { clientX: 180, dataTransfer: dt });
    fireDrag(empty, "drop", { clientX: 180, dataTransfer: dt });
    expect(order()).toEqual(["Price the quote", "Staff the engagement", "Draft the quote", "Raise the invoice"]);
  });
});

describe("the drag says where the step will land", () => {
  it("an insertion marker appears at the target column while dragging, and nowhere else", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    expect(detail.querySelectorAll(".v3fs-swim-ins").length).toBe(0);
    const dt = makeTransfer();
    fireDrag(tile(detail, 0), "dragstart", { dataTransfer: dt });
    const target = cells(detail, 2)[0];
    stubBox(target, 100, 100);
    fireDrag(target, "dragover", { clientX: 120, dataTransfer: dt });
    const marks = [...detail.querySelectorAll(".v3fs-swim-ins")] as HTMLElement[];
    // One per lane of the target column — read as a single line between two steps.
    expect(marks.length).toBe(cells(detail, 2).length);
    expect(marks.every((m) => m.closest(".v3fs-swim-cell")!.getAttribute("data-step") === "2")).toBe(true);
    expect(marks.every((m) => m.classList.contains("before"))).toBe(true);
  });

  it("the marker follows the pointer to the other half of the column", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const dt = makeTransfer();
    fireDrag(tile(detail, 0), "dragstart", { dataTransfer: dt });
    const last = cells(detail, 3)[0];
    stubBox(last, 100, 100);
    fireDrag(last, "dragover", { clientX: 180, dataTransfer: dt });   // right half of the LAST column
    const marks = [...detail.querySelectorAll(".v3fs-swim-ins")] as HTMLElement[];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => m.classList.contains("after"))).toBe(true);
  });

  it("the dragged tile is marked while it is in flight, and unmarked when the drag ends", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const dt = makeTransfer();
    fireDrag(tile(detail, 1), "dragstart", { dataTransfer: dt });
    expect(tile(detail, 1).classList.contains("dragging")).toBe(true);
    fireDrag(tile(detail, 1), "dragend", { dataTransfer: dt });
    expect(detail.querySelectorAll("button.v3fs-swim-tile.dragging").length).toBe(0);
    expect(detail.querySelectorAll(".v3fs-swim-ins").length).toBe(0);
  });
});

/* ── 2 · keyboard parity ──────────────────────────────────────────────────── */

describe("keyboard parity — nothing here is reachable only by dragging", () => {
  it("← Earlier and Later → are still on the inspector and still move the step", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(tile(detail, 0));
    const insp = detail.querySelector<HTMLElement>(".v3fs-wf-inspector")!;
    click(buttonWith(insp, "Later →"));
    expect(order()).toEqual(["Price the quote", "Draft the quote", "Staff the engagement", "Raise the invoice"]);
    const again = el.querySelector<HTMLElement>(".v3fs-wf-inspector")!;
    click(buttonWith(again, "← Earlier"));
    expect(order()).toEqual(["Draft the quote", "Price the quote", "Staff the engagement", "Raise the invoice"]);
  });

  it("the tile's own controls are native <button>s with word accessible names, not div-buttons", () => {
    // NOTE the a11yFlow* audits mount FlowShell and walk whatever the shell draws;
    // on their fixture the Library's artifact router never opens the Atlas studio, so
    // this swimlane is not among the controls they see. The bar is therefore applied
    // HERE — through the audits' OWN accessibleName / isWordless, so it is the same
    // rule and not a second, kinder one.
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const acts = [...detail.querySelectorAll(".v3fs-swim-acts > *")] as HTMLElement[];
    expect(acts.length).toBe(tiles(detail).length * 2);           // add + drop, per tile
    const GLYPH = /[←-⇿⌀-⏿■-➿⬀-⯿！-～\u{1F300}-\u{1FAFF}]/u;
    for (const a of acts) {
      expect(a.tagName).toBe("BUTTON");                            // Enter AND Space, for free
      const name = accessibleName(a);
      expect(isWordless(name), `“${name}” announces no words`).toBe(false);
      // A glyph beside real text is read twice — once as its Unicode name. Ours is
      // inside aria-hidden, so it must not reach the announced name.
      expect(name.match(GLYPH), `“${name}” announces a decorative glyph`).toBeNull();
    }
    // …and the tile itself is still a real button that a keyboard can operate.
    for (const t of tiles(detail)) {
      expect(t.tagName).toBe("BUTTON");
      expect(isWordless(accessibleName(t))).toBe(false);
    }
    // Nothing in the swimlane is focusable-but-nameless.
    const nameless = interactiveElements(detail.querySelector(".v3fs-swim")!)
      .filter((n) => isWordless(accessibleName(n)));
    expect(nameless.map((n) => n.className)).toEqual([]);
  });

  it("each tile control names the step it acts on, so twenty of them are told apart", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const names = [...detail.querySelectorAll(".v3fs-swim-acts button")]
      .map((b) => b.getAttribute("aria-label") ?? "");
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Insert a new step after step 1");
  });

  it("the swimlane adds no div-with-role=button — the pattern with the Enter/Space obligations", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const lane = detail.querySelector<HTMLElement>(".v3fs-swim")!;
    expect([...lane.querySelectorAll('[role="button"]')].map((n) => n.className)).toEqual([]);
  });
});

/* ── 3 · add and delete on the tile ───────────────────────────────────────── */

describe("add and delete are reachable from the tile itself", () => {
  it("＋ on a tile inserts a step immediately after THAT step, in that step's lane", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(detail.querySelectorAll(".v3fs-swim-acts button")[2]);   // tile 2's add (0-indexed pairs)
    expect(order()).toEqual([
      "Draft the quote", "Price the quote", "New step", "Staff the engagement", "Raise the invoice",
    ]);
    expect(writtenSteps()[2].actor).toBe("Sales Rep");             // inherits the tile's lane
  });

  it("⊘ on a tile marks THAT step dropped — and it is still in the array, restorable", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const dropBtn = (i: number) => detail.querySelectorAll(".v3fs-swim-acts button")[i * 2 + 1];
    click(dropBtn(2));
    expect(writtenSteps()).toHaveLength(4);                        // nothing destroyed
    expect(writtenSteps()[2].dropped).toBe(true);
    expect(writtenSteps().map((s) => s.dropped)).toEqual([undefined, undefined, true, undefined]);
    // …and the same control restores it, now announcing itself as a restore.
    const again = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail")!;
    const restore = again.querySelectorAll(".v3fs-swim-acts button")[5];
    expect(restore.getAttribute("aria-label")).toContain("Restore step 3");
    click(restore);
    expect(writtenSteps()[2].dropped).toBe(false);
  });

  it("the mark-dropped control says it is reversible — there is no hard delete on this surface", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const drop = detail.querySelectorAll(".v3fs-swim-acts button")[1];
    expect(drop.getAttribute("aria-label")).toContain("reversible");
    expect(drop.getAttribute("title")).toContain("nothing is deleted");
    click(tile(detail, 0));
    const insp = detail.querySelector<HTMLElement>(".v3fs-wf-inspector")!;
    expect(buttonWith(insp, "Mark dropped").textContent).toContain("reversible");
  });

  it("the toolbar keeps its ＋ Step — the tile controls are discoverability, not a replacement", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    expect(detail.querySelector(".v3fs-wf-bar")).not.toBeNull();
    click(buttonWith(detail, "＋ Step"));
    expect(order()).toHaveLength(5);
  });

  it("a DROPPED step reorders like any other — it is neither skipped nor resurrected", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(detail.querySelectorAll(".v3fs-swim-acts button")[3]);   // mark step 2 dropped
    expect(writtenSteps()[1].dropped).toBe(true);
    const again = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail")!;
    dragStepOnto(again, 1, 3, "after");                            // drag the dropped step to the end
    expect(order()).toEqual(["Draft the quote", "Staff the engagement", "Raise the invoice", "Price the quote"]);
    expect(writtenSteps().map((s) => s.dropped)).toEqual([undefined, undefined, undefined, true]);
  });
});

/* ── 4 · the gates ────────────────────────────────────────────────────────── */

describe("a committed or derived artifact offers none of it", () => {
  it("LOCKED: no tile is draggable, and no tile carries add or drop", () => {
    const el = mount({ locked: true });
    const detail = openWorkflow(el, "Quote to cash");
    expect(tiles(detail).length).toBeGreaterThan(0);
    expect(tiles(detail).every((t) => t.getAttribute("draggable") !== "true")).toBe(true);
    expect(detail.querySelectorAll(".v3fs-swim-acts").length).toBe(0);
  });

  it("LOCKED: a drop event is not even accepted, let alone written", () => {
    const el = mount({ locked: true });
    const detail = openWorkflow(el, "Quote to cash");
    const dt = makeTransfer();
    fireDrag(tile(detail, 0), "dragstart", { dataTransfer: dt });
    const target = cells(detail, 2)[0];
    stubBox(target, 100, 100);
    expect(fireDrag(target, "dragover", { clientX: 120, dataTransfer: dt }).defaultPrevented).toBe(false);
    fireDrag(target, "drop", { clientX: 120, dataTransfer: dt });
    expect(wrote).toBeNull();
    expect(detail.querySelectorAll(".v3fs-swim-ins").length).toBe(0);
  });

  // (There used to be a third gate here: `surface="agentify"`, a structurally
  // frozen twin of this swimlane that Agentify rendered. Agentify is a LIST of
  // activities now — studios.tsx, AgentifyList — and this component draws the
  // Atlas and nothing else, so the prop and its test are gone. The two LOCKED
  // cases above pin the identical behaviour, which is all that gate ever added.)
});

/* ── 5 · the anchors, and Agentify's decisions ────────────────────────────── */

/** The stored atlas the draft is anchored against — same text, so every step
 *  resolves and gets stamped with a real `_atlasStepId`. */
const storedAtlas = (): Record<string, unknown> => seedDoc();

describe("reordering a step does not lose or misattribute its Agentify decision", () => {
  it("every step keeps its OWN `_atlasStepId` across a reorder — the anchor rides with the object", () => {
    const el = mount({ anchorDoc: storedAtlas() });
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 0, 3, "after");
    const after = writtenSteps();
    const pairs = Object.fromEntries(after.map((s) => [String(s.action), String(s[ATLAS_STEP_ID] ?? "")]));
    // Present, distinct, and still paired with the same action text.
    expect(Object.values(pairs).every((id) => id.length > 0)).toBe(true);
    expect(new Set(Object.values(pairs)).size).toBe(after.length);
    expect(pairs["Draft the quote"]).toBe(
      // the id the FIRST render stamped, recomputed from the untouched stored atlas
      decisionStepId(
        { name: "Quote to cash" },
        { actor: "Sales Rep", action: "Draft the quote" },
      ),
    );
  });

  it("a call recorded on a step is still on THAT step after it is dragged elsewhere", () => {
    const el = mount({ anchorDoc: storedAtlas() });
    const detail = openWorkflow(el, "Quote to cash");
    // Agentify files its call under the step's atlas element id — computed here the
    // same way agentifyDecisions does, off the atlas as it stands BEFORE the move.
    const wf = { name: "Quote to cash" };
    const idOf = (actor: string, action: string) => decisionStepId(wf, { actor, action });
    const agentifyDoc = {
      decisions: [
        { _stepId: idOf("Sales Rep", "Draft the quote"), workflow: "Quote to cash", step: "Draft the quote", mode: "assist", rationale: "a human still prices it" },
        { _stepId: idOf("Finance Analyst", "Raise the invoice"), workflow: "Quote to cash", step: "Raise the invoice", mode: "agentify", rationale: "fully mechanical" },
      ],
    };
    const before: DecisionMap = readDecisions(agentifyDoc, seedDoc());
    expect(Object.keys(before)).toHaveLength(2);

    dragStepOnto(detail, 0, 3, "after");                       // "Draft the quote" to the end
    expect(order()).toEqual(["Price the quote", "Staff the engagement", "Raise the invoice", "Draft the quote"]);

    // Re-read the decisions against the atlas AS IT NOW STANDS. Each step is asked
    // for its own id and the answer must be the call that was made about IT — not
    // about whatever step now occupies its old position.
    const after = readDecisions(agentifyDoc, wrote!);
    expect(after).toEqual(before);                             // nothing lost
    const modeFor = (action: string) => {
      const step = writtenSteps().find((s) => s.action === action)!;
      return after[decisionStepId((wrote!.workflows as Array<Record<string, unknown>>)[0], step)]?.mode ?? "";
    };
    expect(modeFor("Draft the quote")).toBe("assist");         // moved, kept its call
    expect(modeFor("Raise the invoice")).toBe("agentify");     // displaced, kept its call
    expect(modeFor("Price the quote")).toBe("");               // undecided, and still undecided
    expect(modeFor("Staff the engagement")).toBe("");
  });

  it("a DRIFTED anchor survives too — the case a rebuilt id would silently misattribute", () => {
    // The hard case. This step's `_atlasStepId` deliberately does NOT match what its
    // own text would derive: the Atlas reworded it after the anchor was stamped. If
    // a reorder rebuilt anchors from text, the call filed under the old id would go
    // to nobody and this step would answer to a different id — a loss and a
    // misattribution that comparing derived ids alone would never see.
    const drifted = "el:step:quote-to-cash:0000drifted0000";
    const doc = seedDoc();
    const wfDoc = (doc.workflows as Array<Record<string, unknown>>)[0];
    (wfDoc.steps as Array<Record<string, unknown>>)[1] = {
      ...(wfDoc.steps as Array<Record<string, unknown>>)[1], [ATLAS_STEP_ID]: drifted,
    };
    const agentifyDoc = { decisions: [{ _stepId: drifted, workflow: "Quote to cash", step: "Price the quote", mode: "keep", rationale: "judgement call" }] };

    const el = mount({ doc, anchorDoc: storedAtlas() });
    const detail = openWorkflow(el, "Quote to cash");
    dragStepOnto(detail, 1, 3, "after");                       // drag the drifted step to the end
    expect(order()).toEqual(["Draft the quote", "Staff the engagement", "Raise the invoice", "Price the quote"]);

    const moved = writtenSteps()[3];
    expect(moved[ATLAS_STEP_ID]).toBe(drifted);                // the anchor moved WITH it
    const map = readDecisions(agentifyDoc, wrote!);
    expect(map[decisionStepId((wrote!.workflows as Array<Record<string, unknown>>)[0], moved)]?.mode).toBe("keep");
    // …and no OTHER step answers to that id.
    const others = writtenSteps().filter((s) => s !== moved);
    expect(others.map((s) => s[ATLAS_STEP_ID])).not.toContain(drifted);
  });
});
