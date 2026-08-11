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
 *   AGENTIFY  — the SAME workflows, and one flag per step: can this be agentified.
 *               Structure is read-only. This is where the CALL is made, and it is
 *               the only thing Agentify decides.
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
const flagButton = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll(".v3fs-wf-modebar button")].find((b) => b.textContent === label);
const rows = (doc: Record<string, unknown>) => (doc[DECISIONS_FIELD] ?? []) as Array<Record<string, unknown>>;

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

/* ── 2 · Agentify shows the same workflows, and only flags them ───────────── */

describe("Agentify shows the Atlas's workflows with a flag per step", () => {
  it("it draws them with no document of its own — nothing to generate first", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    expect(el.querySelector(".v3fs-seam-wf")).not.toBeNull();
    openWorkflow(el, "Quote to cash");
    expect(el.querySelectorAll("button.v3fs-swim-tile")).toHaveLength(2);
  });

  it("a rename on the ATLAS is a rename on Agentify — there is no second version to update", () => {
    const renamed = atlasDoc();
    (renamed.workflows[0] as Record<string, unknown>).name = "Quoting, end to end";
    const el = mount("agentify", { [DECISIONS_FIELD]: [] }, programWith(renamed));
    expect(el.textContent).toContain("Quoting, end to end");
    expect(el.textContent).not.toContain("Quote to cash");
  });

  it("STRUCTURE is read-only there: no add, no reorder, no drop, no dismiss, no fields", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    expect(el.querySelector("button.v3fs-seam-addwf")).toBeNull();
    expect(el.querySelector(".v3fs-seam-wf-dismiss")).toBeNull();
    openWorkflow(el, "Quote to cash");
    const detail = el.querySelector<HTMLElement>(".v3fs-seam-wfdetail")!;
    expect(detail.textContent).not.toContain("Dismiss this workflow");
    expect([...detail.querySelectorAll("button")].map((b) => b.textContent ?? "")
      .filter((t) => t.includes("＋ Step"))).toEqual([]);
    click(detail.querySelector("button.v3fs-swim-tile"));
    expect(el.querySelector(".v3fs-wf-insp-actions")).toBeNull();
    // The workflow's facts are STATED, not offered.
    expect(detail.querySelector(".v3fs-wf-ro")).not.toBeNull();
    expect(detail.textContent).toContain("An RFQ arrives");
  });

  it("the flag is the ONLY edit — and it writes a decision, never a workflow", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    openWorkflow(el, "Quote to cash");
    click(el.querySelector("button.v3fs-swim-tile"));
    click(flagButton(el, "Agentify"));

    expect(wrote!.workflows, "a copy of the Atlas's workflows landed on Agentify").toBeUndefined();
    expect(rows(wrote!)).toHaveLength(1);
    expect(rows(wrote!)[0][DECISION_STEP_ID]).toBe(RE_KEY_ID);
    expect(rows(wrote!)[0].mode).toBe("agentify");
    expect(el.querySelector(".v3fs-wf-flag")?.textContent).toBe("Agentify");
  });

  it("clicking the chosen flag again WITHDRAWS it — back to undecided, not to a default", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()));
    openWorkflow(el, "Quote to cash");
    click(el.querySelector("button.v3fs-swim-tile"));
    click(flagButton(el, "Assist"));
    click(flagButton(el, "Assist"));
    expect(rows(wrote!)[0].mode).toBe("");
    expect(el.querySelector(".v3fs-wf-flag")).toBeNull();
    expect(el.querySelector(".v3fs-wf-modebar")!.textContent).toContain("Not decided yet");
  });

  it("an UNDECIDED step wears no flag — absence is the honest rendering", () => {
    const el = mount("agentify", { [DECISIONS_FIELD]: [{ [DECISION_STEP_ID]: RE_KEY_ID, mode: "keep", rationale: "" }] },
      programWith(atlasDoc()));
    openWorkflow(el, "Quote to cash");
    const flags = [...el.querySelectorAll(".v3fs-wf-flag")].map((n) => n.textContent);
    expect(flags).toEqual(["Keep manual"]);     // one decided step, one silent one
  });

  it("a LOCKED Agentify renders the flag control dead — the gate holds", () => {
    const el = mount("agentify", {}, programWith(atlasDoc()), { locked: true });
    openWorkflow(el, "Quote to cash");
    click(el.querySelector("button.v3fs-swim-tile"));
    const buttons = [...el.querySelectorAll<HTMLButtonElement>(".v3fs-wf-modebar button")];
    expect(buttons.length).toBe(3);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    click(buttons[0]);
    expect(wrote).toBeNull();
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

  it("no path through the Agentify studio can write `workflows` — the door is bolted, not just hidden", () => {
    // The seam view, the lifecycle grid and the swimlane all route their writes
    // through one callback; on Agentify it returns without calling onChange.
    const source = readFileSync(resolve(__dirname, "../components/flow/studio/WorkflowStudio.tsx"), "utf8");
    const body = source.slice(source.indexOf("const writeWorkflows"), source.indexOf("const patchWorkflow"));
    expect(body).toContain("if (structureLocked) return;");
    expect(STUDIOS).toMatch(/surface="agentify"/);
  });
});
