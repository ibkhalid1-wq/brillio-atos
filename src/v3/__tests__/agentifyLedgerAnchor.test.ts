/**
 * AGENTIFY'S CLAIMS SURVIVE A RENAME — and when they genuinely cannot, they SAY SO.
 *
 * The claims ledger is migrated from `currentStateAtlas` + `domainOntology` and from
 * nothing else. Agentify carries its OWN copy of the atlas's workflows, and
 * WorkflowStudio's ledger panel used to bridge the two by TEXT: workflow name
 * lowercased, step action's first 60 characters lowercased. That held only while the
 * generator's "carry the workflows forward verbatim" instruction held — i.e. until an
 * operator did the ordinary thing this tab exists for and renamed a workflow or
 * reworded a step. From that keystroke on, every claim on that step resolved to
 * nothing, and the panel said "No ledger claims matched this step yet" — the SAME
 * words it says for a step nobody has ever claimed. Evidence stranded, indistinguishable
 * from evidence never collected.
 *
 * These tests pin the two halves of the fix, and each is written to FAIL if the text
 * match comes back:
 *   §anchor      — identity is the atlas element id, carried on the document, so a
 *                  rename changes nothing about resolution.
 *   §stranded    — an anchor pointing at an element the ledger no longer holds is its
 *                  OWN state, never silently downgraded to the empty state and never
 *                  quietly re-resolved by text.
 *   §honest      — a step the atlas never held still reads empty, not stranded; and
 *                  reading the surface writes nothing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { anchorAgentifyToAtlas as edgeAnchor } from "@shared/agentifyAnchor.ts";
import { migrate, workflowElementId, stepElementId, stepElementName, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildAtlasView } from "@/v3/lib/ledger/projections";
import {
  anchorWorkflowsToAtlas, resolveWorkflow, resolveStep,
  ATLAS_WORKFLOW_ID, ATLAS_STEP_ID,
} from "@/v3/lib/ledger/agentifyAnchor";
import {
  decisionStepId, readDecisions, writeDecision, DECISION_STEP_ID,
} from "@/v3/lib/ledger/agentifyDecisions";
import { STUDIO_REGISTRY } from "@/v3/components/flow/studio/studios";
import { StudioLockContext, StudioAuthoringContext } from "@/v3/components/flow/studio/StudioKit";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const RE_KEY = "Re-key the quote into the CRM";
const APPROVE = "Approve the discount";

/** The Atlas the ledger is migrated from. */
const atlasDoc = (over: Partial<Record<string, unknown>> = {}) => ({
  workflows: [{
    name: "Quote to cash", area: "Sales", owner: "Ada", trigger: "An RFQ arrives",
    steps: [
      { actor: "Sales Rep", action: RE_KEY, system: "CRM", duration: "2d", entities: ["Quote"] },
      { actor: "Sales Lead", action: APPROVE, system: "CRM", entities: ["Quote"] },
    ],
  }],
  painHeatmap: [{ area: "Quote", pain: "the re-keying eats the week", severity: "high", quote: "I retype it twice" }],
  events: [], systemsInventory: [], openQuestions: [], gaps: [],
  ...over,
});

const ONTOLOGY = { entities: [{ name: "Quote", area: "Sales" }] };

/** Agentify's copy: the atlas's workflows, verbatim, plus the call on each step. */
const agentifyDoc = () => ({
  workflows: [{
    name: "Quote to cash", area: "Sales", owner: "Ada", trigger: "An RFQ arrives",
    steps: [
      { actor: "Sales Rep", action: RE_KEY, system: "CRM", duration: "2d", entities: ["Quote"], mode: "" },
      { actor: "Sales Lead", action: APPROVE, system: "CRM", entities: ["Quote"], mode: "" },
    ],
  }],
  openQuestions: [], gaps: [],
});

const programWith = (atlas: Record<string, unknown>): ProgramSummary => ({
  id: "p-anchor", name: "Anchor", methodology: "atos-flow",
  rawData: { data: { currentStateAtlas: atlas, domainOntology: ONTOLOGY } },
} as unknown as ProgramSummary);

const ledgerAtlasOf = (atlas: Record<string, unknown>) =>
  buildAtlasView(migrate({ ontology: ONTOLOGY, atlas, overrides: [] } as Snapshot));

const rec = (v: unknown) => v as Record<string, unknown>;
const wfOf = (doc: Record<string, unknown>, i = 0) => rec((doc.workflows as unknown[])[i]);
const stepOf = (doc: Record<string, unknown>, i = 0, j = 0) => rec((wfOf(doc, i).steps as unknown[])[j]);

/* ── the ids are the migration's own, not a second spelling of them ───────── */

describe("the anchor names the element the migration named", () => {
  it("the exported id builders reproduce migrate()'s element ids exactly", () => {
    const store = migrate({ ontology: ONTOLOGY, atlas: atlasDoc(), overrides: [] } as Snapshot);
    const wid = workflowElementId("Quote to cash");
    expect(store.elements().find((e) => e.kind === "workflow")!.id).toBe(wid);
    const stepIds = store.elements().filter((e) => e.kind === "step").map((e) => e.id).sort();
    expect(stepIds).toEqual([
      stepElementId(wid, "Sales Rep", RE_KEY),
      stepElementId(wid, "Sales Lead", APPROVE),
    ].sort());
  });

  it("stamping writes exactly those ids onto Agentify's copy", () => {
    const wfs = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    const wid = workflowElementId("Quote to cash");
    expect(wfs[0][ATLAS_WORKFLOW_ID]).toBe(wid);
    const steps = wfs[0].steps as Array<Record<string, unknown>>;
    expect(steps[0][ATLAS_STEP_ID]).toBe(stepElementId(wid, "Sales Rep", RE_KEY));
    expect(steps[1][ATLAS_STEP_ID]).toBe(stepElementId(wid, "Sales Lead", APPROVE));
  });

  it("it is idempotent, and a no-op pass returns the SAME array — a read is not a write", () => {
    const once = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    const twice = anchorWorkflowsToAtlas(once, atlasDoc());
    expect(twice).toBe(once);
  });

  it("a workflow the Atlas does not hold is left UNANCHORED, never given a made-up id", () => {
    const mine = [{ name: "A workflow I added", steps: [{ actor: "Me", action: "Do a thing" }] }];
    const wfs = anchorWorkflowsToAtlas(mine, atlasDoc());
    expect(wfs[0][ATLAS_WORKFLOW_ID]).toBeUndefined();
    expect(rec((wfs[0].steps as unknown[])[0])[ATLAS_STEP_ID]).toBeUndefined();
  });

  it("an existing anchor is never re-derived — that is what makes a rename survive", () => {
    const doc = agentifyDoc();
    const anchored = anchorWorkflowsToAtlas([wfOf(doc)], atlasDoc());
    const renamed = [{ ...anchored[0], name: "Quoting, end to end" }];
    expect(anchorWorkflowsToAtlas(renamed, atlasDoc())[0][ATLAS_WORKFLOW_ID])
      .toBe(workflowElementId("Quote to cash"));
  });
});

/* ── client ↔ edge lockstep ───────────────────────────────────────────────── */

// The edge stamps too, at generation time, so a document is BORN anchored — which is
// the only way a doc generated before an Atlas re-synthesis can read "stranded"
// rather than "empty" (the client has nothing left to match against by then). That is
// a second copy of the rule, for the usual reason: the edge is self-contained and
// imports nothing from src/. A second copy of a HASH is the drift that resolves
// silently to nothing, so it is pinned here — both run, output compared, no judgement.
describe("client and edge stamp identically", () => {
  // The fixtures below are chosen to make every arm of the rule observable, because a
  // lockstep test over an easy input agrees for the wrong reason: an action SHORTER
  // than the 60-char identity truncation agrees no matter what either side truncates
  // at. So one case straddles that boundary, one differs only past it, and one
  // exercises the actor fallback.
  const LONG_A = "Chase the customer for the signed order form and then file it in the shared drive";
  const LONG_B = "Chase the customer for the signed order form and then file it to the finance inbox";
  const HARD = () => ({
    workflows: [{
      name: "Order intake",
      steps: [
        { actor: "Sales Rep", action: LONG_A },
        { actor: "Sales Rep", action: LONG_B },        // identical for 60 chars, then diverges
        { actor: "Sales Ops", action: "Short one" },
      ],
    }],
  });

  it("the two implementations agree, field for field, on the same input", () => {
    const fromClient = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    const edgeResult = agentifyDoc();
    edgeAnchor("agentify", edgeResult, (atlasDoc().workflows as Array<Record<string, unknown>>));
    expect(edgeResult.workflows).toEqual(fromClient);
  });

  it("…including where the 60-char identity truncation actually decides the id", () => {
    // Both long actions share their first 60 characters, so they collapse to ONE
    // identity — the honest consequence of a truncating id, and a place where any
    // disagreement about WHERE to truncate shows up immediately.
    expect(stepElementName(LONG_A)).toBe(stepElementName(LONG_B));
    const fromClient = anchorWorkflowsToAtlas([wfOf(HARD())], HARD());
    const edgeResult = HARD();
    edgeAnchor("agentify", edgeResult, (HARD().workflows as Array<Record<string, unknown>>));
    expect(edgeResult.workflows).toEqual(fromClient);
    // and the ids are the ones migrate() files under, truncation and all
    const ids = new Set(migrate({ ontology: {}, atlas: HARD(), overrides: [] } as Snapshot)
      .elements().map((e) => e.id));
    for (const s of wfOf(edgeResult).steps as Array<Record<string, unknown>>) {
      expect(ids.has(String(s[ATLAS_STEP_ID]))).toBe(true);
    }
  });

  it("both name the ids migrate() actually files the claims under", () => {
    const edgeResult = agentifyDoc();
    edgeAnchor("agentify", edgeResult, (atlasDoc().workflows as Array<Record<string, unknown>>));
    const ids = new Set(migrate({ ontology: ONTOLOGY, atlas: atlasDoc(), overrides: [] } as Snapshot)
      .elements().map((e) => e.id));
    expect(ids.has(String(wfOf(edgeResult)[ATLAS_WORKFLOW_ID]))).toBe(true);
    for (const s of wfOf(edgeResult).steps as Array<Record<string, unknown>>) {
      expect(ids.has(String(s[ATLAS_STEP_ID]))).toBe(true);
    }
  });

  it("the edge stamps ONLY agentify, and is idempotent", () => {
    const other = agentifyDoc();
    edgeAnchor("currentStateAtlas", other, (atlasDoc().workflows as Array<Record<string, unknown>>));
    expect(wfOf(other)[ATLAS_WORKFLOW_ID]).toBeUndefined();

    const once = agentifyDoc();
    edgeAnchor("agentify", once, (atlasDoc().workflows as Array<Record<string, unknown>>));
    const snapshot = structuredClone(once);
    edgeAnchor("agentify", once, (atlasDoc().workflows as Array<Record<string, unknown>>));
    expect(once).toEqual(snapshot);
  });

  it("the edge wires it in — a stamper nothing calls anchors nothing", () => {
    expect(EDGE).toContain('import { anchorAgentifyToAtlas } from "../_shared/agentifyAnchor.ts"');
    expect(EDGE).toContain("anchorAgentifyToAtlas(spec.fieldKey, formalResult, areaGrounding(contextProgramData).workflows)");
  });
});

/* ── a GENERATED decision is filed where the operator's would be ──────────── */

describe("the edge files a generated decision under the client's own id", () => {
  // The generator emits decisions naming their step in the Atlas's words. If the
  // edge filed them under any id but the one writeDecision uses, the operator's
  // first call on that step would open a SECOND row and the generated one would
  // read as an orphan — a call on record that matches no activity.
  const generated = () => ({
    decisions: [
      { workflow: "Quote to cash", step: RE_KEY, mode: "agentify", rationale: "he retypes it twice" },
      { workflow: "Quote to cash", step: APPROVE, mode: "keep", rationale: "a person owns the discount" },
    ],
    agentCandidates: [], openQuestions: [], gaps: [],
  });

  it("every emitted row is stamped with the atlas step id the client derives", () => {
    const doc = generated();
    edgeAnchor("agentify", doc, (atlasDoc().workflows as Array<Record<string, unknown>>));
    const atlasWf = wfOf(atlasDoc());
    const expected = (atlasWf.steps as Array<Record<string, unknown>>)
      .map((step) => decisionStepId(atlasWf, step));
    expect(doc.decisions.map((d) => rec(d)[DECISION_STEP_ID])).toEqual(expected);
    // …and the ids are the ones migrate() files the claims under.
    const ids = new Set(migrate({ ontology: ONTOLOGY, atlas: atlasDoc(), overrides: [] } as Snapshot)
      .elements().map((e) => e.id));
    for (const id of expected) expect(ids.has(id)).toBe(true);
  });

  it("so the reader finds those calls, and an operator edit lands on the same rows", () => {
    const doc = generated() as unknown as Record<string, unknown>;
    edgeAnchor("agentify", doc, (atlasDoc().workflows as Array<Record<string, unknown>>));
    const atlasWf = wfOf(atlasDoc());
    const reKeyId = decisionStepId(atlasWf, rec((atlasWf.steps as unknown[])[0]));
    expect(readDecisions(doc, atlasDoc())[reKeyId]).toEqual({ mode: "agentify", rationale: "he retypes it twice" });

    // The operator takes that call back: still ONE row for the step, now cleared.
    const next = writeDecision(doc, atlasDoc(), reKeyId, { mode: "" });
    const rows = (next.decisions as Array<Record<string, unknown>>)
      .filter((r) => r[DECISION_STEP_ID] === reKeyId);
    expect(rows).toHaveLength(1);
    expect(readDecisions(next, atlasDoc())[reKeyId]).toBeUndefined();
  });

  it("a row the Atlas holds no step for is left unanchored, never given a made-up id", () => {
    const doc = {
      decisions: [
        { workflow: "Quote to cash", step: "Invent a step nobody does", mode: "agentify", rationale: "" },
        { workflow: "A workflow the atlas never had", step: RE_KEY, mode: "keep", rationale: "" },
      ],
    };
    edgeAnchor("agentify", doc, (atlasDoc().workflows as Array<Record<string, unknown>>));
    for (const row of doc.decisions) expect(rec(row)[DECISION_STEP_ID]).toBeUndefined();
    expect(readDecisions(doc, atlasDoc())).toEqual({});
  });

  it("an id already on a row is never re-derived, and a second pass changes nothing", () => {
    const doc = generated() as unknown as Record<string, unknown>;
    (doc.decisions as Array<Record<string, unknown>>)[0][DECISION_STEP_ID] = "el:step:already-decided";
    edgeAnchor("agentify", doc, (atlasDoc().workflows as Array<Record<string, unknown>>));
    expect((doc.decisions as Array<Record<string, unknown>>)[0][DECISION_STEP_ID]).toBe("el:step:already-decided");
    const snapshot = structuredClone(doc);
    edgeAnchor("agentify", doc, (atlasDoc().workflows as Array<Record<string, unknown>>));
    expect(doc).toEqual(snapshot);
  });
});

/* ── §anchor — the rename that used to strand the evidence ────────────────── */

describe("renaming on the Agentify tab no longer loses the claims", () => {
  const views = () => ledgerAtlasOf(atlasDoc());

  it("an ANCHORED workflow+step still resolve after both are renamed and reworded", () => {
    const anchored = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    // The operator renames the workflow and rewords the step — nothing text-matches now.
    const steps = (anchored[0].steps as Array<Record<string, unknown>>)
      .map((s, i) => (i === 0 ? { ...s, action: "Type the quote in by hand (again)" } : s));
    const edited = { ...anchored[0], name: "Quoting, end to end", steps };

    const wf = resolveWorkflow(views(), edited);
    expect(wf.state).toBe("anchored");
    expect(wf.view!.name).toBe("Quote to cash");

    const st = resolveStep(wf, rec(steps[0]));
    expect(st.state).toBe("anchored");
    expect(st.view!.name).toBe(stepElementName(RE_KEY));
    expect(st.view!.slots.length).toBeGreaterThan(0);
  });

  it("…and WITHOUT the anchor the very same edit resolves to nothing — the bug, pinned", () => {
    // Same rename, on a document that carries no anchors: this is exactly what the
    // text match did, and exactly why it had to go.
    const edited = { ...wfOf(agentifyDoc()), name: "Quoting, end to end" };
    expect(resolveWorkflow(views(), edited).state).toBe("unmatched");
  });

  it("a pre-anchoring document still resolves by text, and SAYS it did so", () => {
    const wf = resolveWorkflow(views(), wfOf(agentifyDoc()));
    expect(wf.state).toBe("matched");     // not "anchored" — a surface can tell them apart
    expect(resolveStep(wf, stepOf(agentifyDoc())).state).toBe("matched");
  });
});

/* ── §stranded — the break that must never look like the empty state ──────── */

describe("when the Atlas moves out from under it, the step says so", () => {
  it("an anchor the ledger no longer holds is STRANDED, not unmatched", () => {
    const anchored = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    // The Atlas is re-synthesised and its workflow comes back under a new name.
    const moved = atlasDoc({
      workflows: [{ ...rec((atlasDoc().workflows as unknown[])[0]), name: "Quote to cash (revised)" }],
    });
    const wf = resolveWorkflow(ledgerAtlasOf(moved), anchored[0]);
    expect(wf.state).toBe("stranded");
    expect(wf.anchor).toBe(workflowElementId("Quote to cash"));
    expect(wf.view).toBeNull();
    // and every step beneath it is stranded too — its claims are filed under that id
    expect(resolveStep(wf, rec((anchored[0].steps as unknown[])[0])).state).toBe("stranded");
  });

  it("a step whose Atlas twin was reworded strands ALONE, inside a healthy workflow", () => {
    const anchored = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    const atlas = atlasDoc();
    const wfSrc = rec((atlas.workflows as unknown[])[0]);
    const reworded = atlasDoc({
      workflows: [{
        ...wfSrc,
        steps: [{ actor: "Sales Rep", action: "Copy the quote across into the CRM", system: "CRM", entities: ["Quote"] },
          rec((wfSrc.steps as unknown[])[1])],
      }],
    });
    const wf = resolveWorkflow(ledgerAtlasOf(reworded), anchored[0]);
    expect(wf.state).toBe("anchored");
    const steps = anchored[0].steps as Array<Record<string, unknown>>;
    expect(resolveStep(wf, steps[0]).state).toBe("stranded");
    expect(resolveStep(wf, steps[1]).state).toBe("anchored");   // its neighbour is untouched
  });

  it("stranding is NEVER silently re-resolved by text, but it does report the near miss", () => {
    // The Atlas keeps the action and changes the ACTOR — so the step's content id moves
    // while its ledger NAME (the action) still reads identically. A text match would
    // sail straight through this and show claims filed under a different element.
    const anchored = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    const wfSrc = rec((atlasDoc().workflows as unknown[])[0]);
    const reassigned = atlasDoc({
      workflows: [{
        ...wfSrc,
        steps: [{ actor: "Sales Ops", action: RE_KEY, system: "CRM", entities: ["Quote"] },
          rec((wfSrc.steps as unknown[])[1])],
      }],
    });
    const wf = resolveWorkflow(ledgerAtlasOf(reassigned), anchored[0]);
    const st = resolveStep(wf, rec((anchored[0].steps as unknown[])[0]));
    expect(st.state).toBe("stranded");
    expect(st.view).toBeNull();                                   // no fallback resolution
    expect(st.textWouldMatch).toBeTruthy();                       // but the diagnosis is offered
    expect(st.textWouldMatch).not.toBe(st.anchor);
  });
});

/* ── §honest — the states that were always empty stay empty ───────────────── */

describe("nothing that was honestly empty is now noisy", () => {
  it("a workflow the operator added reads UNMATCHED, not stranded", () => {
    const mine = { name: "A workflow I added", steps: [{ actor: "Me", action: "Do a thing" }] };
    const wf = resolveWorkflow(ledgerAtlasOf(atlasDoc()), mine);
    expect(wf.state).toBe("unmatched");
    expect(resolveStep(wf, rec((mine.steps as unknown[])[0])).state).toBe("unmatched");
  });

  it("a step added under a real workflow reads UNMATCHED — no evidence yet is not a break", () => {
    const anchored = anchorWorkflowsToAtlas([wfOf(agentifyDoc())], atlasDoc());
    const wf = resolveWorkflow(ledgerAtlasOf(atlasDoc()), anchored[0]);
    expect(resolveStep(wf, { actor: "Sales Rep", action: "New step" }).state).toBe("unmatched");
  });
});

/* ── the surface: the same three states, through the studio ───────────────── */

/**
 * WHICH SURFACE. These scenarios were written against the Agentify tab, back when
 * Agentify carried its own copy of the workflows and was therefore the place a
 * workflow could be renamed or a step reworded. It isn't any more: the workflows
 * are the ATLAS's, both tabs draw that one array, and every structural edit —
 * including the rename this whole module exists to survive — happens on the Atlas.
 *
 * So the scenarios move to the Atlas studio, unchanged in what they pin. The bug is
 * identical there and for the identical reason: the claims ledger is migrated from
 * the SAVED atlas, the studio edits an unsaved DRAFT of it, and the moment the
 * operator renames a workflow the draft's text stops matching the ledger's. Text
 * identity breaks on the first keystroke; the anchor does not.
 */
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let wrote: Record<string, unknown> | null = null;

function mountStudio(artifactId: string, doc: Record<string, unknown>, program: ProgramSummary): HTMLElement {
  const Component = STUDIO_REGISTRY[artifactId].Component;
  wrote = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const Harness = () => {
    const [current, setCurrent] = useState(doc);
    return createElement(StudioLockContext.Provider, { value: false },
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

/** Type into a CONTROLLED React input: set through the native setter so React's
 *  value-tracker sees a change, then fire the event it listens for. */
const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** Open the workflow row, then select its first step. */
const openFirstStep = (el: HTMLElement, wfLabel: string) => {
  click([...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(wfLabel)));
  click(el.querySelector("button.v3fs-swim-tile"));
};
const panel = (el: HTMLElement) => el.querySelector<HTMLElement>(".v3fs-wf-inspector .v3fs-wf-claims")!;
const fieldNamed = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("label.v3fs-stu-field")]
    .find((l) => l.querySelector(".v3fs-stu-fl")?.textContent === label)!
    .querySelector("input") as HTMLInputElement;

describe("the ledger panel, driven through the studio that edits the workflows", () => {
  it("an unedited document shows its step's claims", () => {
    const el = mountStudio("current-state-atlas", atlasDoc(), programWith(atlasDoc()));
    openFirstStep(el, "Quote to cash");
    expect(panel(el).textContent).toContain("Ledger claims on this step");
  });

  it("RENAMING the workflow keeps them — the regression this whole change exists for", () => {
    const el = mountStudio("current-state-atlas", atlasDoc(), programWith(atlasDoc()));
    openFirstStep(el, "Quote to cash");
    type(fieldNamed(el, "Name"), "Quoting, end to end");
    expect(panel(el).textContent).toContain("Ledger claims on this step");
    expect(panel(el).textContent).not.toContain("No ledger claims matched");
    // and the anchor is now ON the document, so the next reader needs no text at all
    expect(wfOf(wrote!)[ATLAS_WORKFLOW_ID]).toBe(workflowElementId("Quote to cash"));
    expect(wfOf(wrote!).name).toBe("Quoting, end to end");
  });

  it("REWORDING the step's action keeps them too", () => {
    const el = mountStudio("current-state-atlas", atlasDoc(), programWith(atlasDoc()));
    openFirstStep(el, "Quote to cash");
    type(fieldNamed(el, "Action — what happens in this step"), "Type the quote in by hand, twice");
    expect(panel(el).textContent).toContain("Ledger claims on this step");
    expect(stepOf(wrote!)[ATLAS_STEP_ID])
      .toBe(stepElementId(workflowElementId("Quote to cash"), "Sales Rep", RE_KEY));
  });

  it("an Atlas that moved under the draft shows STRANDED — visibly not the empty state", () => {
    // The draft on screen was anchored to the atlas as it WAS; the saved atlas (and
    // therefore the ledger) has since been re-synthesised with the workflow renamed.
    const draft = { ...atlasDoc(), workflows: anchorWorkflowsToAtlas([wfOf(atlasDoc())], atlasDoc()) };
    const moved = atlasDoc({
      workflows: [{ ...rec((atlasDoc().workflows as unknown[])[0]), name: "Quote to cash (revised)" }],
    });
    const el = mountStudio("current-state-atlas", draft as Record<string, unknown>, programWith(moved));
    openFirstStep(el, "Quote to cash");
    const text = panel(el).textContent ?? "";
    expect(text).toContain("Evidence stranded");
    expect(text).toContain("no longer matches its Atlas evidence");
    expect(text).not.toContain("No ledger claims matched");
    expect(panel(el).className).toContain("stranded");
    // …and it is announced on the workflow card too, without selecting a step
    expect(el.querySelector(".v3fs-wf-details .v3fs-wf-claims.stranded")?.textContent)
      .toContain("no longer holds the workflow this was drafted from");
  });

  it("a workflow the operator added reads empty, and is NOT dressed up as stranded", () => {
    // Anchoring reads the SAVED atlas, never this draft — anchoring the draft to
    // itself would stamp this invented workflow with an id the ledger has never
    // held, and honestly-empty would read as broken.
    const doc = { workflows: [{ name: "A workflow I added", steps: [{ actor: "Me", action: "Do a thing" }] }] };
    const el = mountStudio("current-state-atlas", doc as Record<string, unknown>, programWith(atlasDoc()));
    openFirstStep(el, "A workflow I added");
    expect(panel(el).textContent).toContain("No ledger claims matched this step yet");
    expect(panel(el).className).not.toContain("stranded");
    expect(el.querySelector(".v3fs-wf-claims.stranded")).toBeNull();
  });

  it("READING the tab writes nothing — anchors reach the document only on an operator's edit", () => {
    const doc = atlasDoc();
    const before = structuredClone(doc);
    const el = mountStudio("current-state-atlas", doc as Record<string, unknown>, programWith(atlasDoc()));
    openFirstStep(el, "Quote to cash");
    expect(wrote).toBeNull();
    expect(doc).toEqual(before);
  });

  // AGENTIFY no longer draws this panel. It is a LIST of activities with a toggle
  // each (studios.tsx), and a step's evidence is read where the step is DESCRIBED —
  // on the Atlas, above. The half of it this module is about still holds there, and
  // is what is asserted instead: Agentify reads the atlas's OWN steps, keys off
  // them, and rendering it writes nothing.
  it("Agentify lists the Atlas's own steps, with no document of its own, and writes nothing", () => {
    const el = mountStudio("agentify", {}, programWith(atlasDoc()));
    expect([...el.querySelectorAll(".v3fs-ag-act")].map((n) => n.textContent)).toEqual([RE_KEY, APPROVE]);
    expect(el.querySelector(".v3fs-wf-claims"), "the claims panel came back to Agentify").toBeNull();
    expect(wrote).toBeNull();
  });
});
