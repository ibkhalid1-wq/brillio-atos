/**
 * ONE SET OF WORKFLOWS, TWO TABS — the receipt for the corrected Atlas/Agentify split.
 *
 * The workflows were moved OUT of the Current-State Atlas and into a new Agentify
 * artifact. Too far. Operator direction, verbatim:
 *
 *   "What is showing up in agentify should show in current state atlas — with CRUD
 *    ability visually to update workflows, add / delete steps etc.
 *    Agentify should show workflows with a flag to indicate steps that can be
 *    agentified"
 *
 * So the split is:
 *
 *   ATLAS     — the workflows themselves. The swimlane WITH full CRUD: workflow
 *               fields, add / reorder / drop a step, edit a step, dismiss a
 *               workflow. This is where the work is DESCRIBED. It makes, and shows,
 *               no automation call.
 *   AGENTIFY  — the SAME activities, LISTED by workflow, one toggle each: can this
 *               be agentified. Structure is not editable here at all. This is where
 *               the CALL is made, and it is the only thing Agentify decides.
 *               (It drew the swimlane too, until 2026-08-11. Operator direction,
 *               verbatim: "agentify, should show a list of activities by workflow
 *               with a toggle to agentify".)
 *
 * AND THERE IS NO SECOND COPY. That is the load-bearing half. Agentify used to hold
 * its own `workflows` array — carried forward verbatim, forked on the first
 * keystroke, with nothing to say which version was true. It now persists DECISIONS
 * ALONE, each under the LEDGER ELEMENT ID of the atlas step it is about
 * (agentifyDecisions, built on agentifyAnchor's migrate-derived ids). The tests
 * below are written so that reintroducing the copy — in the document, in the
 * projection, or in the typeset reading — fails one of them.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { STUDIO_REGISTRY } from "@/v3/components/flow/studio/studios";
import { StudioLockContext, StudioAuthoringContext } from "@/v3/components/flow/studio/StudioKit";
import { workflowElementId, stepElementId } from "@/v3/lib/ledger/migrate";
import {
  readDecisions, writeDecision, decisionStepId, DECISIONS_FIELD, DECISION_STEP_ID,
} from "@/v3/lib/ledger/agentifyDecisions";
// a11yFlowNames / a11yFlowKeyboard never open a studio, so they would pass
// vacuously on this surface. Their helpers are applied to it directly instead.
import { accessibleName, isWordless, roleOf } from "./helpers/accessibleName";

const STUDIOS = readFileSync(resolve(__dirname, "../components/flow/studio/studios.tsx"), "utf8");
const ARTIFACT = readFileSync(resolve(__dirname, "../components/flow/studio/FlowArtifactStudio.tsx"), "utf8");

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const RE_KEY = "Re-key the quote into the CRM";
const APPROVE = "Approve the discount";
const WID = workflowElementId("Quote to cash");
const RE_KEY_ID = stepElementId(WID, "Sales Rep", RE_KEY);
const APPROVE_ID = stepElementId(WID, "Sales Lead", APPROVE);

const atlasDoc = () => ({
  workflows: [{
    name: "Quote to cash", area: "Sales", owner: "Ada", trigger: "An RFQ arrives",
    handoffs: ["Sales → Delivery"], failureModes: ["the quote goes stale"],
    steps: [
      { actor: "Sales Rep", action: RE_KEY, system: "CRM", duration: "2d", entities: ["Quote"] },
      { actor: "Sales Lead", action: APPROVE, system: "CRM", entities: ["Quote"] },
    ],
  }],
  painHeatmap: [{ area: "Quote", pain: "the re-keying eats the week", severity: "high", quote: "I retype it twice" }],
  events: [], systemsInventory: [{ system: "CRM", usedFor: "quotes" }], openQuestions: [], gaps: [],
});

const programWith = (atlas: Record<string, unknown>, agentify?: Record<string, unknown>): ProgramSummary => ({
  id: "p-split", name: "Split", methodology: "atos-flow",
  rawData: { data: { currentStateAtlas: atlas, domainOntology: { entities: [{ name: "Quote" }] },
    ...(agentify ? { agentify } : {}) } },
} as unknown as ProgramSummary);

/* ── harness ──────────────────────────────────────────────────────────────── */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let wrote: Record<string, unknown> | null = null;

function mount(artifactId: string, doc: Record<string, unknown>, program: ProgramSummary, opts: { locked?: boolean } = {}): HTMLElement {
  const Component = STUDIO_REGISTRY[artifactId].Component;
  wrote = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const Harness = () => {
    const [current, setCurrent] = useState(doc);
    return createElement(StudioLockContext.Provider, { value: opts.locked ?? false },
      createElement(StudioAuthoringContext.Provider, { value: false },
        createElement(Component, {
          doc: current, program,
          onChange: (next: Record<string, unknown>) => { wrote = next; setCurrent(next); },
        })));
  };
  act(() => { root!.render(createElement(Harness)); });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null; host = null; wrote = null;
});

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("click: no element");
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
};
const openWorkflow = (el: HTMLElement, name: string) =>
  click([...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(name)));
const wroteDoc = () => wrote;
const rows = (doc: Record<string, unknown>) => (doc[DECISIONS_FIELD] ?? []) as Array<Record<string, unknown>>;

/* ── reading Agentify's LIST ──────────────────────────────────────────────── */

/** Every activity row on the Agentify list, in document order. */
const activityRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(".v3fs-ag-row")];
const actionOf = (row: HTMLElement) => row.querySelector(".v3fs-ag-act")?.textContent ?? "";
const rowFor = (el: HTMLElement, action: string) => {
  const row = activityRows(el).find((r) => actionOf(r) === action);
  if (!row) throw new Error(`no activity row for “${action}” — saw: ${activityRows(el).map(actionOf).join(" | ")}`);
  return row;
};
/** The one toggle on an activity's row. */
const toggleFor = (el: HTMLElement, action: string) =>
  rowFor(el, action).querySelector<HTMLButtonElement>('button[role="switch"]')!;
const stateOf = (el: HTMLElement, action: string) =>
  rowFor(el, action).querySelector(".v3fs-ag-state")?.textContent ?? "";
/** The surface's OWN running count — read off the lead, never off the whole page,
 *  so a per-workflow heading that happens to read the same cannot stand in for it. */
const counter = (el: HTMLElement) => el.querySelector(".v3fs-stu-lead")?.textContent ?? "";

/* ── 1 · the Atlas is the workflows, and it edits them ────────────────────── */

describe("the Current-State Atlas draws the workflows and edits them", () => {
  it("the swimlane is on the Atlas tab, not only on Agentify", () => {
    const el = mount("current-state-atlas", atlasDoc(), programWith(atlasDoc()));
    expect(el.querySelector(".v3fs-seam-wf"), "the Atlas draws no workflows").not.toBeNull();
    openWorkflow(el, "Quote to cash");
    expect(el.querySelector(".v3fs-swim")).not.toBeNull();
    expect(el.querySelector(".v3fs-wf-details")).not.toBeNull();   // the editable summary card
  });

  it("and it still draws its registers — the workflows did not displace them", () => {
    const el = mount("current-state-atlas", atlasDoc(), programWith(atlasDoc()));
    for (const register of ["Business events", "Pain heatmap", "Systems inventory"]) {
      expect(el.textContent).toContain(register);
    }
    expect(el.textContent).toContain("Open questions");
  });

  it("STEP CRUD lands on the atlas document: add, reorder, drop", () => {
    const el = mount("current-state-atlas", atlasDoc(), programWith(atlasDoc()));
    openWorkflow(el, "Quote to cash");
    const detail = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail")!;
    click([...detail.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("＋ Step")));
    const stepsOf = () => ((wrote!.workflows as Array<Record<string, unknown>>)[0].steps) as Array<Record<string, unknown>>;
    expect(stepsOf()).toHaveLength(3);

    click(el.querySelector("button.v3fs-swim-tile"));
    const insp = () => el.querySelector<HTMLElement>(".v3fs-wf-inspector")!;
    click([...insp().querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Later →")));
    expect(stepsOf()[0].action).toBe(APPROVE);
    click([...insp().querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Mark dropped")));
    expect(stepsOf().find((s) => s.action === RE_KEY)!.dropped).toBe(true);
  });

  it("the Atlas makes NO automation call — no control, and no flag on any tile", () => {
    // Hostile fixture: a programme whose Agentify has decided a step, AND a legacy
    // `mode` sitting on the atlas step itself. Neither may surface here — the Atlas
    // does not decide automation, so it does not report on it either.
    const doc = atlasDoc();
    ((doc.workflows[0] as Record<string, unknown>).steps as Array<Record<string, unknown>>)[0].mode = "keep";
    const el = mount("current-state-atlas", doc, programWith(atlasDoc(), { [DECISIONS_FIELD]: [
      { [DECISION_STEP_ID]: RE_KEY_ID, mode: "agentify", rationale: "" },
    ] }));
    openWorkflow(el, "Quote to cash");
    click(el.querySelector("button.v3fs-swim-tile"));
    expect(el.querySelector(".v3fs-wf-modebar"), "the Atlas offers the agentify control").toBeNull();
    expect(el.querySelector(".v3fs-wf-flag"), "the Atlas wears an agentify flag").toBeNull();
    expect(el.textContent).not.toContain("Keep manual");
  });
});

/* ── 2 · Agentify LISTS those activities, and toggles them ────────────────── */

/**
 * THE LIST (operator direction 2026-08-11, verbatim: "agentify, should show a list
 * of activities by workflow with a toggle to agentify").
 *
 * It replaced a structurally-frozen copy of the Atlas's swimlane whose call was
 * three buttons inside a step inspector — reachable only by opening a workflow and
 * clicking a tile. What the diagram did for Agentify, the Atlas already does
 * better; what Agentify needed was every decidable activity in one place with its
 * control in reach, and a visible count of what is still open.
 *
 * The hard part, pinned below: a toggle has two positions and the record has FOUR
 * readings — agentify, assist, keep manual, and undecided. Undecided is not "off".
 */
describe("Agentify lists the Atlas's activities, grouped by workflow", () => {
  it("one row per activity, under its workflow — and no diagram anywhere", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    expect(el.textContent).toContain("Quote to cash");                 // the group heading
    expect(activityRows(el).map(actionOf)).toEqual([RE_KEY, APPROVE]);  // a row each, in order
    // The swimlane is the ATLAS's surface, and it is not drawn here.
    expect(el.querySelector(".v3fs-swim"), "Agentify still draws the swimlane").toBeNull();
    expect(el.querySelector(".v3fs-swim-tile")).toBeNull();
    expect(el.querySelector(".v3fs-seam-wf")).toBeNull();
  });

  it("each row carries the context the call needs: the actor's lane and the system", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    const row = rowFor(el, RE_KEY);
    expect(row.querySelector(".v3fs-ag-actor")?.textContent).toBe("Sales Rep");
    expect(row.querySelector(".v3fs-ag-sys")?.textContent).toBe("CRM");
  });

  it("a rename on the ATLAS is a rename on Agentify — there is no second version to update", () => {
    const renamed = atlasDoc();
    (renamed.workflows[0] as Record<string, unknown>).name = "Quoting, end to end";
    const el = mount("agentify", { [DECISIONS_FIELD]: [] }, programWith(renamed));
    expect(el.textContent).toContain("Quoting, end to end");
    expect(el.textContent).not.toContain("Quote to cash");
  });

  it("a DROPPED step is not decidable work — it is off the list, and out of the count", () => {
    const dropped = atlasDoc();
    ((dropped.workflows[0] as Record<string, unknown>).steps as Array<Record<string, unknown>>)[0].dropped = true;
    const el = mount("agentify", {}, programWith(dropped));
    expect(activityRows(el).map(actionOf)).toEqual([APPROVE]);
    expect(counter(el)).toContain("0 of 1 decided");
  });

  it("STRUCTURE is not editable there: no add, no reorder, no drop, no dismiss, no workflow fields", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    expect(el.querySelector("button.v3fs-seam-addwf")).toBeNull();
    expect(el.querySelector(".v3fs-seam-wf-dismiss")).toBeNull();
    expect(el.querySelector(".v3fs-wf-insp-actions")).toBeNull();
    expect(el.textContent).not.toContain("Dismiss this workflow");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent ?? "")
      .filter((t) => t.includes("＋ Step"))).toEqual([]);
    // Nothing here offers a workflow's own fields — those are the Atlas's.
    expect([...el.querySelectorAll("label.v3fs-stu-field .v3fs-stu-fl")].map((n) => n.textContent))
      .not.toContain("Name");
  });

  it("the TOGGLE is the only edit — flipping one on writes a decision, never a workflow", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    click(toggleFor(el, RE_KEY));

    expect(wrote!.workflows, "a copy of the Atlas's workflows landed on Agentify").toBeUndefined();
    expect(rows(wrote!)).toHaveLength(1);
    expect(rows(wrote!)[0][DECISION_STEP_ID]).toBe(RE_KEY_ID);
    expect(rows(wrote!)[0].mode).toBe("agentify");
    // …and it comes straight back as the row's state.
    expect(toggleFor(el, RE_KEY).getAttribute("aria-checked")).toBe("true");
    expect(stateOf(el, RE_KEY)).toContain("Agentify");
    expect(counter(el)).toContain("1 of 2 decided");
  });

  it("flipping it OFF WITHDRAWS the call — back to undecided, never to a “no” nobody chose", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    click(toggleFor(el, RE_KEY));
    click(toggleFor(el, RE_KEY));
    expect(rows(wrote!)[0].mode).toBe("");            // stored as withdrawn, so it sticks
    expect(toggleFor(el, RE_KEY).getAttribute("aria-checked")).toBe("false");
    expect(stateOf(el, RE_KEY)).toBe("Not decided");  // NOT "Keep manual"
    expect(counter(el)).toContain("0 of 2 decided");
  });

  it("UNDECIDED renders UNSET — visibly its own state, not a decided “no”", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: RE_KEY_ID, mode: "keep", rationale: "" }] },
      programWith(atlasDoc()));
    // Both toggles are OFF, and that is exactly why off alone cannot be the whole story.
    expect(activityRows(el).map((r) => r.querySelector('[role="switch"]')!.getAttribute("aria-checked")))
      .toEqual(["false", "false"]);
    // The undecided one is marked un-set and says so…
    expect(rowFor(el, APPROVE).className).toContain("is-undecided");
    expect(stateOf(el, APPROVE)).toBe("Not decided");
    // …the decided one is marked decided and says WHICH call was made.
    expect(rowFor(el, RE_KEY).className).toContain("is-keep");
    expect(stateOf(el, RE_KEY)).toContain("Keep manual");
    expect(counter(el)).toContain("1 of 2 decided");
  });

  it("the gap stays legible: a running count on the lead AND on each workflow", () => {
    const twoWf = atlasDoc();
    twoWf.workflows = [...twoWf.workflows, {
      name: "Renewals", area: "Sales", owner: "Bo", trigger: "A renewal falls due",
      handoffs: [], failureModes: [],
      steps: [{ actor: "Sales Rep", action: "Chase the renewal", system: "CRM", duration: "", entities: [] }],
    }] as typeof twoWf.workflows;
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: RE_KEY_ID, mode: "agentify", rationale: "" }] },
      programWith(twoWf));
    expect(counter(el)).toContain("1 of 3 decided");
    expect(counter(el)).toContain("2 still open");
    expect([...el.querySelectorAll(".v3fs-ag-wf-c")].map((n) => n.textContent))
      .toEqual(["1 of 2 decided", "0 of 1 decided"]);
  });

  it("a call the Atlas has moved out from under is SAID, not quietly dropped from the count", () => {
    // A decision filed under an id the Atlas no longer holds — its step was reworded
    // or dismissed there. It is still in the document and still reaches Envision, so
    // "N of M decided" must not be the only thing this surface says about it.
    const el = mount("agentify", { [DECISIONS_FIELD]: [
      { [DECISION_STEP_ID]: "el:wf:quote-to-cash:step:gone", workflow: "Quote to cash", step: "A step that moved", mode: "agentify", rationale: "" },
    ] }, programWith(atlasDoc()));
    expect(counter(el)).toContain("0 of 2 decided");          // it is not counted…
    const notice = el.querySelector(".v3fs-ag-orphans")?.textContent ?? "";
    expect(notice).toContain("1 call");                       // …and it is not hidden either
    expect(notice).toContain("no longer match any activity");
  });

  it("…and no such notice appears when every call still names an activity", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: RE_KEY_ID, mode: "agentify", rationale: "" }] },
      programWith(atlasDoc()));
    expect(el.querySelector(".v3fs-ag-orphans")).toBeNull();
  });

  it("a recorded ASSIST is shown as assist — a binary control does not flatten it into off", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: APPROVE_ID, mode: "assist", rationale: "a human signs it" }] },
      programWith(atlasDoc()));
    expect(stateOf(el, APPROVE)).toContain("Assist");
    expect(rowFor(el, APPROVE).className).toContain("is-assist");
    // and the reason that was recorded with it is still on screen, still editable
    expect(rowFor(el, APPROVE).querySelector<HTMLInputElement>(".v3fs-ag-why input")!.value)
      .toBe("a human signs it");
    // MERELY LOOKING rewrites nothing — the call stays `assist` until a human moves it.
    expect(wrote).toBeNull();
  });

  it("…and it is the operator, never the render, who changes an assist", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: APPROVE_ID, mode: "assist", rationale: "" }] },
      programWith(atlasDoc()));
    // Its own Withdraw takes it back to undecided (the toggle cannot: it is already off).
    click(rowFor(el, APPROVE).querySelector(".v3fs-ag-withdraw"));
    expect(rows(wrote!).find((r) => r[DECISION_STEP_ID] === APPROVE_ID)!.mode).toBe("");
    expect(stateOf(el, APPROVE)).toBe("Not decided");
  });

  it("turning an assist ON records agentify — an explicit change, on one click", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: APPROVE_ID, mode: "assist", rationale: "" }] },
      programWith(atlasDoc()));
    click(toggleFor(el, APPROVE));
    expect(rows(wrote!).find((r) => r[DECISION_STEP_ID] === APPROVE_ID)!.mode).toBe("agentify");
  });

  it("a LOCKED Agentify renders every toggle GENUINELY inert — not merely dimmed", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: APPROVE_ID, mode: "assist", rationale: "" }] },
      programWith(atlasDoc()), { locked: true });
    const switches = [...el.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(switches).toHaveLength(2);
    expect(switches.every((b) => b.disabled)).toBe(true);
    // Every other control the row can carry is dead too.
    expect(el.querySelector<HTMLButtonElement>(".v3fs-ag-withdraw")!.disabled).toBe(true);
    expect(el.querySelector<HTMLInputElement>(".v3fs-ag-why input")!.disabled).toBe(true);
    for (const s of switches) click(s);
    click(el.querySelector(".v3fs-ag-withdraw"));
    expect(wrote, "a locked Agentify wrote a decision").toBeNull();
  });
});

/* ── 2b · every toggle says WHICH activity it decides ─────────────────────── */

/**
 * Twenty switches all announcing "Agentify" is the ambiguity failure this repo
 * already fixed once in the Inbox. a11yFlowNames/a11yFlowKeyboard cannot catch it
 * here — their fixture never opens a studio, so they would pass on an unlabelled
 * div — so their own helpers are applied directly to this surface instead.
 */
describe("the list collapses and filters — presentation only", () => {
  const type = (el: HTMLElement, selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    expect(input, `no ${selector}`).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  it("a workflow card collapses and expands from its own heading", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    const head = el.querySelector(".v3fs-ag-wf-h") as HTMLButtonElement;
    expect(head.tagName, "the disclosure must be a real button so the keyboard reaches it").toBe("BUTTON");
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(activityRows(el).length).toBeGreaterThan(0);

    click(head);
    expect((el.querySelector(".v3fs-ag-wf-h") as HTMLElement).getAttribute("aria-expanded")).toBe("false");
    expect(activityRows(el), "a collapsed card still lists its rows").toHaveLength(0);

    click(el.querySelector(".v3fs-ag-wf-h")!);
    expect(activityRows(el).length).toBeGreaterThan(0);
  });

  it("a COLLAPSED card still shows its counts — otherwise you reopen it to find out", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    click(el.querySelector(".v3fs-ag-wf-h")!);
    expect(el.querySelector(".v3fs-ag-wf-c")?.textContent).toMatch(/\d+ of \d+ decided/);
    expect(el.textContent).toContain("Quote to cash");
  });

  it("the query filters activities, and says what it is hiding", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    const before = activityRows(el).length;
    type(el, ".v3fs-ag-q", APPROVE.slice(0, 12));
    expect(activityRows(el).map(actionOf)).toEqual([APPROVE]);
    // The narrowed view must reconcile itself against the whole document.
    expect(el.querySelector(".v3fs-ag-filter-note")?.textContent)
      .toMatch(new RegExp(`Showing.*1.*of ${before}`));
  });

  it("matching a WORKFLOW keeps its activities — a hit must not answer with an empty card", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    type(el, ".v3fs-ag-q", "Quote to cash");
    expect(activityRows(el).length, "the workflow matched but its rows were hidden").toBeGreaterThan(0);
  });

  it("'only undecided' hides decided work without changing it", () => {
    const atlas = atlasDoc();
    const wf = atlas.workflows[0] as Record<string, unknown>;
    const decided = { [DECISIONS_FIELD]: [{ _stepId: RE_KEY_ID, mode: "agentify" }] };
    const el = mount("agentify", decided, programWith(atlas));
    expect(activityRows(el)).toHaveLength(2);
    const only = el.querySelector(".v3fs-ag-only input") as HTMLInputElement;
    click(only);
    expect(activityRows(el).map(actionOf), "the decided row is still listed").toEqual([APPROVE]);
  });

  it("THE COUNTER STAYS WHOLE-DOCUMENT — a filter cannot make the open work look smaller", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    const full = counter(el);
    type(el, ".v3fs-ag-q", APPROVE.slice(0, 12));
    expect(counter(el), "filtering rewrote the headline count").toBe(full);
  });

  it("a filter that matches nothing SAYS so rather than looking empty", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    type(el, ".v3fs-ag-q", "zzzz-no-such-activity");
    expect(activityRows(el)).toHaveLength(0);
    expect(el.querySelector(".v3fs-ag-filter-note")?.textContent).toContain("Nothing matches");
  });

  it("neither control writes anything — presentation only", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    type(el, ".v3fs-ag-q", "quote");
    click(el.querySelector(".v3fs-ag-wf-h"));
    click(el.querySelector(".v3fs-ag-only input"));
    expect(wroteDoc(), "collapsing or filtering wrote to the document").toBeNull();
  });
});

describe("the toggles are named, distinctly, after the activity they decide", () => {
  /** Two workflows sharing a step's wording — the case a generic name cannot survive. */
  const twoWorkflows = () => {
    const doc = atlasDoc();
    doc.workflows = [...doc.workflows, {
      name: "Renewals", area: "Sales", owner: "Bo", trigger: "A renewal falls due",
      steps: [{ actor: "Sales Rep", action: RE_KEY, system: "CRM" }],
    }] as typeof doc.workflows;
    return doc;
  };

  it("each toggle is a real switch with a real accessible name", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    for (const s of el.querySelectorAll('button[role="switch"]')) {
      expect(roleOf(s)).toBe("switch");
      expect(s.hasAttribute("aria-checked")).toBe(true);
      const name = accessibleName(s);
      expect(isWordless(name), `wordless toggle name: “${name}”`).toBe(false);
      expect(name).toContain(actionOf(s.closest(".v3fs-ag-row") as HTMLElement));
    }
  });

  it("no two toggles share a name — not even across workflows with the same step wording", () => {
    const el = mount("agentify", {}, programWith(twoWorkflows()));
    const names = [...el.querySelectorAll('button[role="switch"]')].map(accessibleName);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names.some((n) => n.includes("Renewals"))).toBe(true);
  });

  it("the STATE is announced with the toggle, so undecided and “decided otherwise” differ to AT", () => {
    // aria-checked is false for both; the described-by status is what tells them apart.
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: RE_KEY_ID, mode: "keep", rationale: "" }] },
      programWith(atlasDoc()));
    const described = (action: string) => {
      const toggle = toggleFor(el, action);
      const id = toggle.getAttribute("aria-describedby")!;
      return el.ownerDocument.getElementById(id)!.textContent ?? "";
    };
    expect(described(APPROVE)).toBe("Not decided");
    expect(described(RE_KEY)).toContain("Keep manual");
  });

  it("every other control on a row is named after its activity too", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: APPROVE_ID, mode: "assist", rationale: "" }] },
      programWith(atlasDoc()));
    for (const control of [el.querySelector(".v3fs-ag-withdraw")!, el.querySelector(".v3fs-ag-why input")!]) {
      const name = accessibleName(control);
      expect(isWordless(name)).toBe(false);
      expect(name).toContain(APPROVE);
    }
  });
});

/* ── 3 · the decisions are keyed, and they survive the Atlas being edited ─── */

describe("a decision is filed under the atlas step's ledger element id", () => {
  it("the id is migrate()'s own — not a second spelling of it", () => {
    const wf = atlasDoc().workflows[0] as Record<string, unknown>;
    const step = (wf.steps as Array<Record<string, unknown>>)[0];
    expect(decisionStepId(wf, step)).toBe(RE_KEY_ID);
  });

  it("REWORDING the step on the Atlas keeps the decision pointing at it", () => {
    // The decision was made; the Atlas then re-words the step. The anchor the atlas
    // step carries is what resolution uses, so the call still lands on it — the
    // exact failure text matching had.
    const decided = writeDecision({}, atlasDoc(), RE_KEY_ID, { mode: "keep", rationale: "judgement call" });
    const reworded = atlasDoc();
    const step = ((reworded.workflows[0] as Record<string, unknown>).steps as Array<Record<string, unknown>>)[0];
    step.action = "Type the quote in by hand, twice";
    step._atlasStepId = RE_KEY_ID;          // stamped when the rename was made (agentifyAnchor)

    const wf = reworded.workflows[0] as Record<string, unknown>;
    expect(readDecisions(decided, reworded)[decisionStepId(wf, step)]?.mode).toBe("keep");
  });

  it("the legend re-stamps from the Atlas on every write, so the typeset read never goes stale", () => {
    const first = writeDecision({}, atlasDoc(), RE_KEY_ID, { mode: "keep" });
    expect(rows(first)[0].step).toBe(RE_KEY);
    const reworded = atlasDoc();
    const step = ((reworded.workflows[0] as Record<string, unknown>).steps as Array<Record<string, unknown>>)[0];
    step.action = "Type the quote in by hand, twice";
    step._atlasStepId = RE_KEY_ID;
    const second = writeDecision(first, reworded, APPROVE_ID, { mode: "assist" });
    expect(rows(second).find((r) => r[DECISION_STEP_ID] === RE_KEY_ID)!.step)
      .toBe("Type the quote in by hand, twice");
  });

  it("the id never typesets as a column — it is underscore-prefixed on purpose", () => {
    expect(DECISION_STEP_ID.startsWith("_")).toBe(true);
    expect(Object.keys(rows(writeDecision({}, atlasDoc(), RE_KEY_ID, { mode: "keep" }))[0])
      .filter((k) => !k.startsWith("_"))).toEqual(["workflow", "step", "mode", "rationale"]);
  });
});

/* ── 4 · the copy is gone, and cannot come back ───────────────────────────── */

describe("Agentify holds no copy of the workflows", () => {
  it("a LEGACY document's per-step modes are read — nothing already decided is lost", () => {
    const legacy = { workflows: [{ name: "Quote to cash", steps: [
      { actor: "Sales Rep", action: RE_KEY, mode: "keep", modeRationale: "human eyes" },
      { actor: "Sales Lead", action: APPROVE, mode: "" },
    ] }] };
    const read = readDecisions(legacy, atlasDoc());
    expect(read[RE_KEY_ID]).toEqual({ mode: "keep", rationale: "human eyes" });
    expect(read[APPROVE_ID]).toBeUndefined();     // "" is not a call
  });

  it("…and the first new decision RETIRES that copy rather than editing it", () => {
    const legacy = { workflows: [{ name: "Quote to cash", steps: [
      { actor: "Sales Rep", action: RE_KEY, mode: "keep", modeRationale: "human eyes" },
    ] }] };
    const next = writeDecision(legacy, atlasDoc(), APPROVE_ID, { mode: "agentify" });
    expect(next.workflows, "the copy survived a write").toBeUndefined();
    expect(rows(next).map((r) => [r[DECISION_STEP_ID], r.mode]))
      .toEqual([[RE_KEY_ID, "keep"], [APPROVE_ID, "agentify"]]);   // migrated, not dropped
  });

  it("the studio reads the Atlas's array, never `doc.workflows`, when the Atlas has one", () => {
    // A legacy copy that DISAGREES with the Atlas: the Atlas wins on screen, because
    // the Atlas is the record of what the business does.
    const el = mount("agentify", { workflows: [{ name: "A stale copy", steps: [{ actor: "X", action: "Something old" }] }] },
      programWith(atlasDoc()));
    expect(el.textContent).toContain("Quote to cash");
    expect(el.textContent).not.toContain("A stale copy");
  });

  it("the reading pane suppresses a legacy copy instead of typesetting a rival atlas", () => {
    expect(ARTIFACT).toMatch(/artifact\.id === "agentify" \? new Set\(\["workflows"\]\)/);
    // …and the Atlas hides nothing: its workflows ARE its document.
    expect(ARTIFACT).not.toMatch(/current-state-atlas" \? new Set\(\["workflows"\]\)/);
    expect(STUDIO_REGISTRY["current-state-atlas"].docOrder?.[0]).toBe("workflows");
    expect(STUDIO_REGISTRY["agentify"].docOrder).not.toContain("workflows");
  });

  it("no path through the Agentify studio can write `workflows` — the door is gone, not just bolted", () => {
    // It used to be a guard: Agentify rendered the workflow studio and that studio
    // refused the structural write. Now Agentify does not render it at all, and the
    // only onChange in the whole component is the decision write — so there is no
    // door left to bolt. Both halves are asserted, because a second onChange
    // appearing here is exactly how a copy of the Atlas would get back on.
    const body = STUDIOS.slice(STUDIOS.indexOf("function AgentifyStudio"), STUDIOS.indexOf("/* ── Envision"));
    expect(body).not.toContain("WorkflowStudio");
    expect(body.match(/onChange\(/g)).toEqual(["onChange("]);
    expect(body).toContain("onChange(writeDecision(doc, atlasDoc, stepId, next))");
    // …and that one door is shut when the artifact is locked. Asserted from source
    // because a `disabled` control cannot exercise the guard behind it — the
    // behavioural half (a locked surface writes nothing) is the LOCKED test above.
    expect(body).toContain("if (locked) return;");
  });
});
