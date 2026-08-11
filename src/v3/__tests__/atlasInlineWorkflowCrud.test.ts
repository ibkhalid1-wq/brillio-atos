/**
 * THE ATLAS LOST A SURFACE — this file is the receipt that it lost no CAPABILITY.
 *
 * The Current-State Atlas used to be two lists of the same workflows: a read-only
 * "Areas & seams" view to look at, and an "Edit a workflow" section below it —
 * cascading Area/Workflow selects, a ＋ workflow button, the workflow summary
 * card, the swimlane and the step inspector — which was the ONLY place any of it
 * could be changed. That section is now deleted and its editing lives inside the
 * workflows view: a workflow's own row creates, opens, edits and dismisses it,
 * and opening a row expands the same summary card, swimlane and step inspector
 * inline underneath it.
 *
 * Deleting a working surface puts the burden of proof here. Every test below is
 * named for the affordance it is rescuing from the removed section, and every
 * assertion is on the DOCUMENT that came back through onChange — "the control
 * exists" is not the claim; "the write lands" is.
 *
 * It also asserts the REMOVAL (the heading and the cascading selects are gone,
 * not merely hidden) and the GATES (a locked artifact renders no editing control
 * anywhere in the new inline surface).
 */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import WorkflowStudio, { AtlasRegisters } from "@/v3/components/flow/studio/WorkflowStudio";
import { StudioLockContext, StudioAuthoringContext } from "@/v3/components/flow/studio/StudioKit";

/* ── the programme (supplies the Frame's areas) ───────────────────────────── */

/** The FRAME's areas come from the programme, not from the doc under edit — so
 * the stored atlas names three (Sales, Delivery, Finance) while the doc the
 * studio edits maps only two. Finance is therefore the "not mapped yet" area. */
const PROGRAM = {
  id: "p-atlas", name: "Atlas fixture", client: "Fixture Co", methodology: "atos-flow",
  rawData: {
    data: {
      currentStateAtlas: {
        workflows: [
          { name: "Quote to cash", area: "Sales", steps: [{ actor: "Sales Rep", action: "Draft the quote" }] },
          { name: "Delivery kickoff", area: "Delivery", steps: [{ actor: "Delivery Lead", action: "Run kickoff" }] },
          { name: "Invoice run", area: "Finance", steps: [{ actor: "Finance Analyst", action: "Raise the invoice" }] },
        ],
      },
      domainOntology: {
        entities: [{ name: "Quote" }, { name: "Engagement" }],
        relations: [{ from: "Quote", to: "Engagement", verb: "produces" }],
      },
    },
  },
} as unknown as ProgramSummary;

/** Two workflows over Sales and Delivery; Finance stays unmapped on purpose. */
const seedDoc = (): Record<string, unknown> => ({
  workflows: [
    {
      name: "Quote to cash", area: "Sales", owner: "Ada", trigger: "An RFQ arrives",
      handoffs: ["Sales → Delivery"], failureModes: ["the quote goes stale"],
      steps: [
        { actor: "Sales Rep", action: "Draft the quote", system: "CRM", duration: "2d", entities: ["Quote"] },
        { actor: "Delivery Lead", action: "Staff the engagement", system: "PSA", duration: "1d", entities: ["Engagement"] },
      ],
    },
    {
      name: "Renewal", area: "Delivery", owner: "", trigger: "",
      handoffs: [], failureModes: [],
      steps: [{ actor: "Delivery Lead", action: "Check the renewal date", system: "", entities: [] }],
    },
  ],
  painHeatmap: [], events: [], systemsInventory: [],
});

/* ── harness ──────────────────────────────────────────────────────────────── */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** The last document the studio wrote back — every assertion reads this, so a
 * control that renders but never writes fails the test it claims to pass. */
let wrote: Record<string, unknown> | null = null;

function Harness({ initial, locked, authoring }: {
  initial: Record<string, unknown>; locked: boolean; authoring: boolean;
}) {
  const [doc, setDoc] = useState(initial);
  return createElement(StudioLockContext.Provider, { value: locked },
    createElement(StudioAuthoringContext.Provider, { value: authoring },
      createElement(WorkflowStudio, {
        doc, program: PROGRAM,
        onChange: (next: Record<string, unknown>) => { wrote = next; setDoc(next); },
      })));
}

/** The registers' new home: the Atlas tab renders them with no workflow focus,
 * so the full editors are what mount. */
function RegisterHarness({ initial }: { initial: Record<string, unknown> }) {
  const [doc, setDoc] = useState(initial);
  return createElement(StudioLockContext.Provider, { value: false },
    createElement(StudioAuthoringContext.Provider, { value: true },
      createElement(AtlasRegisters, {
        doc, program: PROGRAM, focus: null,
        onChange: (next: Record<string, unknown>) => { wrote = next; setDoc(next); },
      })));
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(opts: { doc?: Record<string, unknown>; locked?: boolean; authoring?: boolean } = {}): HTMLElement {
  wrote = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(Harness, {
      initial: opts.doc ?? seedDoc(),
      locked: opts.locked ?? false,
      authoring: opts.authoring ?? true,
    }));
  });
  return host;
}

function mountRegisters(doc: Record<string, unknown> = seedDoc()): HTMLElement {
  wrote = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(RegisterHarness, { initial: doc })); });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null; host = null; wrote = null;
});

/* ── DOM helpers (real events, never a prop poke) ─────────────────────────── */

const texts = (el: ParentNode, sel: string) =>
  [...el.querySelectorAll(sel)].map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim());

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

/** React tracks input values on the node — set through the prototype setter so
 * the synthetic onChange actually fires (assigning .value alone is swallowed). */
function type(el: Element | null | undefined, value: string): void {
  if (!el) throw new Error("type: no element");
  const node = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
  act(() => { node.dispatchEvent(new Event("input", { bubbles: true })); });
}

function choose(el: Element | null | undefined, value: string): void {
  if (!el) throw new Error("choose: no element");
  const node = el as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(node, value);
  act(() => { node.dispatchEvent(new Event("change", { bubbles: true })); });
}

/** A StudioKit field (TextField / SelectField / ChipsField) by its visible label. */
function field(scope: ParentNode, label: string): HTMLInputElement | HTMLSelectElement {
  const hit = [...scope.querySelectorAll("label.v3fs-stu-field")]
    .find((l) => (l.querySelector(".v3fs-stu-fl")?.textContent ?? "").trim() === label);
  if (!hit) throw new Error(`no field labelled “${label}” (have: ${
    texts(scope, "label.v3fs-stu-field .v3fs-stu-fl").join(" | ")})`);
  const input = hit.querySelector("input, select");
  if (!input) throw new Error(`field “${label}” has no control`);
  return input as HTMLInputElement | HTMLSelectElement;
}

/** Open a workflow INLINE, the way an operator does: click its row in the
 * workflows view. Returns the expanded body — everything the removed section
 * used to hold now lives inside this element. */
function openWorkflow(el: HTMLElement, name: string): HTMLElement {
  click(buttonWith(el, name, "button.v3fs-seam-wf-open"));
  const detail = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail");
  if (!detail) throw new Error(`workflow “${name}” did not expand inline`);
  return detail;
}

const wf = (i: number): Record<string, unknown> =>
  (wrote?.workflows as Array<Record<string, unknown>>)[i];
const stepsOf = (i: number): Array<Record<string, unknown>> =>
  wf(i).steps as Array<Record<string, unknown>>;

/* ── the removal is asserted, not assumed ─────────────────────────────────── */

describe("the “Edit a workflow” section is gone", () => {
  it("renders no “Edit a workflow” heading", () => {
    const el = mount();
    expect(el.querySelector(".v3fs-wf-editor-h")).toBeNull();
    expect(el.textContent).not.toContain("Edit a workflow");
  });

  it("renders neither cascading select — no “Filter by area”, no “Pick a workflow”", () => {
    const el = mount();
    expect(el.querySelector("select[aria-label='Filter by area']")).toBeNull();
    expect(el.querySelector("select[aria-label='Pick a workflow']")).toBeNull();
  });

  it("puts the workflow's editor INSIDE its row in the workflows view, not in a panel below", () => {
    const el = mount();
    // Nothing is open until a row is opened — there is no editor standing by.
    expect(el.querySelector(".v3fs-wf-details")).toBeNull();
    const detail = openWorkflow(el, "Quote to cash");
    expect(detail.querySelector(".v3fs-wf-details")).not.toBeNull(); // the summary card
    expect(detail.querySelector(".v3fs-swim")).not.toBeNull();       // the swimlane
    expect(detail.closest(".v3fs-seam-wf")).not.toBeNull();          // inside the workflow's own block
  });

  it("opens the workflow inline when it is picked from the lifecycle grid too", () => {
    const el = mount();
    const chip = buttonWith(el, "Renewal", "button.v3fs-lgrid-chip");
    click(chip);
    const detail = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail");
    expect(detail).not.toBeNull();
    expect((field(detail!, "Name") as HTMLInputElement).value).toBe("Renewal");
  });
});

/* ── workflow-level CRUD, one test per affordance the section carried ─────── */

describe("workflow CRUD survives inline (was: the “Edit a workflow” section)", () => {
  it("CREATE — the ＋ workflow button (was: the filter row) adds a workflow and opens it", () => {
    const el = mount();
    click(el.querySelector("button.v3fs-seam-addwf"));
    expect((wrote!.workflows as unknown[]).length).toBe(3);
    expect(wf(2).name).toBe("Workflow 3");
    // and the new one is open, so it can be filled in immediately
    const detail = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail")!;
    expect((field(detail, "Name") as HTMLInputElement).value).toBe("Workflow 3");
  });

  it("RENAME — Workflow summary → Name", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    type(field(detail, "Name"), "Quote to cash (v2)");
    expect(wf(0).name).toBe("Quote to cash (v2)");
  });

  it("EDIT — Workflow summary → Trigger and Owner", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    type(field(detail, "Trigger"), "A signed MSA lands");
    expect(wf(0).trigger).toBe("A signed MSA lands");
    type(field(detail, "Owner"), "Bo");
    expect(wf(0).owner).toBe("Bo");
  });

  it("REASSIGN AREA — Workflow summary → Area (from the Frame), the only way an unmapped area gets a workflow", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    const select = field(detail, "Area (from the Frame)") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("Finance");
    choose(select, "Finance");
    expect(wf(0).area).toBe("Finance");
  });

  it("EDIT — Workflow summary → Hand-offs and Failure modes", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    type(field(detail, "Hand-offs"), "Sales → Delivery, Delivery → Finance");
    expect(wf(0).handoffs).toEqual(["Sales → Delivery", "Delivery → Finance"]);
    type(field(detail, "Failure modes"), "the quote goes stale, nobody staffs it");
    expect(wf(0).failureModes).toEqual(["the quote goes stale", "nobody staffs it"]);
  });

  it("DISMISS — from the workflow's own row, with a reason, on the curation trail", () => {
    const el = mount();
    const row = el.querySelector<HTMLElement>(".v3fs-seam-wf-dismiss")!;
    click(buttonWith(row, "Dismiss"));
    type(row.querySelector(".v3fs-dismiss-in"), "duplicated by the Renewal flow");
    click(buttonWith(row, "Dismiss workflow"));
    expect((wrote!.workflows as unknown[]).length).toBe(1);
    expect(wf(0).name).toBe("Renewal");
    const log = wrote!._curationLog as Array<Record<string, string>>;
    expect(log).toHaveLength(1);
    expect(log[0].action).toContain("Quote to cash");
    expect(log[0].reason).toBe("duplicated by the Renewal flow");
  });

  it("DISMISS — the summary card's own control writes the same reasoned removal", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(buttonWith(detail, "Dismiss this workflow"));
    type(detail.querySelector(".v3fs-dismiss-in"), "merged into Renewal");
    click(buttonWith(detail, "Dismiss workflow"));
    expect((wrote!.workflows as unknown[]).length).toBe(1);
    expect((wrote!._curationLog as unknown[])).toHaveLength(1);
  });
});

/* ── step-level CRUD: the swimlane + inspector, moved not rewritten ───────── */

describe("step CRUD survives inline (was: the swimlane + step inspector)", () => {
  it("ADD — the ＋ Step bar under the swimlane", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(buttonWith(detail, "＋ Step"));
    expect(stepsOf(0)).toHaveLength(3);
    expect(stepsOf(0)[2].action).toBe("New step");
  });

  it("EDIT — selecting a swimlane tile opens the inspector and its fields write through", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(detail.querySelector("button.v3fs-swim-tile"));
    const insp = detail.querySelector<HTMLElement>(".v3fs-wf-inspector")!;
    type(field(insp, "Action — what happens in this step"), "Draft and price the quote");
    expect(stepsOf(0)[0].action).toBe("Draft and price the quote");
    type(field(insp, "Persona (lane)"), "Deal Desk");
    expect(stepsOf(0)[0].actor).toBe("Deal Desk");
    type(field(insp, "System"), "CPQ");
    expect(stepsOf(0)[0].system).toBe("CPQ");
    type(field(insp, "Duration"), "4h");
    expect(stepsOf(0)[0].duration).toBe("4h");
    type(field(insp, "Entities touched (from the ontology)"), "Quote, Price Book");
    expect(stepsOf(0)[0].entities).toEqual(["Quote", "Price Book"]);
  });

  it("REORDER — ← Earlier / Later → in the inspector move the step in the sequence", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(detail.querySelector("button.v3fs-swim-tile"));
    click(buttonWith(detail.querySelector<HTMLElement>(".v3fs-wf-inspector")!, "Later →"));
    expect(stepsOf(0).map((s) => s.action)).toEqual(["Staff the engagement", "Draft the quote"]);
  });

  it("REMOVE — ⊘ Mark dropped (a claim-carrying step is never hard-deleted) and restores", () => {
    const el = mount();
    const detail = openWorkflow(el, "Quote to cash");
    click(detail.querySelector("button.v3fs-swim-tile"));
    click(buttonWith(detail.querySelector<HTMLElement>(".v3fs-wf-inspector")!, "⊘ Mark dropped"));
    expect(stepsOf(0)).toHaveLength(2);          // still on record — findable, with its claims
    expect(stepsOf(0)[0].dropped).toBe(true);
    const again = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail")!;
    click(buttonWith(again.querySelector<HTMLElement>(".v3fs-wf-inspector")!, "↩ Restore"));
    expect(stepsOf(0)[0].dropped).toBe(false);
  });
});

/* ── the strip, the empty state, and the registers still stand ────────────── */

describe("what surrounded the removed section still renders", () => {
  it("the unmapped-areas strip still names the Frame area the atlas has not mapped", () => {
    const el = mount();
    const strip = el.querySelector<HTMLElement>(".v3fs-wf-unmapped-row")!;
    expect(strip.textContent).toContain("Not mapped yet");
    expect(texts(strip, ".v3fs-wf-unmapped")).toContain("Finance");
  });

  it("the empty state still renders, and carries the ＋ workflow affordance", () => {
    const el = mount({ doc: { workflows: [], painHeatmap: [], events: [], systemsInventory: [] } });
    const empty = el.querySelector<HTMLElement>(".v3fs-emptc")!;
    expect(empty.textContent).toContain("No workflows on record yet");
    click(buttonWith(empty, "＋ workflow"));
    expect((wrote!.workflows as unknown[]).length).toBe(1);
  });

  // The registers (events · pain · systems) are the ATLAS document's, not a
  // workflow's, so when the workflows moved to Agentify they stayed behind — they
  // are `AtlasRegisters` on the Current-State Atlas tab now. The capability is
  // unchanged and still proved by the write, only from its new home.
  it("the document-level registers (events · pain · systems) are still editable, on the Atlas tab", () => {
    const el = mountRegisters();
    const reg = [...el.querySelectorAll(".v3fs-wf-reg")]
      .find((r) => (r.textContent ?? "").includes("Systems inventory")) as HTMLElement;
    click(buttonWith(reg, "Add system"));
    expect((wrote!.systemsInventory as unknown[]).length).toBe(1);
  });

  it("the workflow surface no longer carries the registers — they are not in two places", () => {
    const el = mount();
    expect(el.querySelector(".v3fs-wf-reg")).toBeNull();
    expect(el.textContent).not.toContain("Systems inventory");
  });
});

/* ── the gates ────────────────────────────────────────────────────────────── */

describe("the lock and authoring gates hold on the new inline surface", () => {
  it("a LOCKED atlas renders no editing control anywhere in the inline surface", () => {
    const el = mount({ locked: true });
    expect(el.querySelector("button.v3fs-seam-addwf")).toBeNull();      // no create
    expect(el.querySelector(".v3fs-seam-wf-dismiss")).toBeNull();       // no dismiss
    expect(el.querySelector(".v3fs-seam-edit")).toBeNull();             // no tile-popover editor
    const detail = openWorkflow(el, "Quote to cash");
    expect(detail.querySelector(".v3fs-wf-bar")).toBeNull();            // no ＋ Step
    expect(detail.textContent).not.toContain("Dismiss this workflow");
    const controls = [...detail.querySelectorAll("input, select, textarea")] as HTMLInputElement[];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((c) => c.disabled)).toBe(true);
    click(detail.querySelector("button.v3fs-swim-tile"));               // the inspector opens read-only
    const insp = el.querySelector<HTMLElement>(".v3fs-wf-inspector")!;
    expect(insp.querySelector(".v3fs-wf-insp-actions")).toBeNull();     // no reorder / drop
    expect([...insp.querySelectorAll("input, select, textarea")].every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect(wrote).toBeNull();                                           // and nothing was written
  });

  it("a CURATABLE-but-not-AUTHORABLE atlas hides ＋ workflow yet still edits the ones on record", () => {
    const el = mount({ authoring: false });
    expect(el.querySelector("button.v3fs-seam-addwf")).toBeNull();
    const detail = openWorkflow(el, "Quote to cash");
    type(field(detail, "Name"), "Quote to cash (curated)");
    expect(wf(0).name).toBe("Quote to cash (curated)");
  });
});
