/**
 * AGENTIFY — Listen's third artifact, and the home of ONE call about the Atlas.
 *
 * The Current-State Atlas says how the business runs today, and it is where that
 * description is edited. Agentify says what should happen to each of those steps:
 * agentify it, assist the human doing it, or keep it a human judgement. That
 * decision already existed in the codebase as `FutureMode` in flowFutureState
 * (inferred by a regex over the step's verb) and as the "agentify" stakeholder
 * review in flowPortal — but it had no home, no document, and no place in the
 * methodology. It does now.
 *
 * WHAT DID *NOT* MOVE. The first cut of this artifact took the workflows off the
 * Atlas entirely and gave Agentify a copy of them. That was wrong twice over: the
 * Atlas is the workflows (nowhere else can they be edited), and a copy forks on the
 * first keystroke. So both tabs draw the SAME array — the Atlas's — and Agentify
 * persists only decisions, keyed by the atlas step's ledger element id.
 *
 * THIS IS A GATING CHANGE and the tests below are written to make that fact
 * checkable rather than pleasant. Listen now requires three documents where it
 * required two, so all 11 live programmes gain an unmet Listen criterion the
 * moment this ships. The honest behaviours that has to come with are pinned
 * here, each as its own test:
 *   - an ungenerated Agentify reads NOT PRESENT — no excerpt, no confidence, no
 *     half-state (§"degrades honestly");
 *   - the gate NAMES it rather than going amber for no stated reason;
 *   - reading a pre-Agentify programme mutates nothing on it;
 *   - a step nobody has decided carries NO mode — the projection falls back to
 *     the old heuristic rather than reading silence as a decision.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { getPhaseDefinition } from "@/v3/lib/methodology";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { FORMAL_ARTIFACT_FIELD_KEYS, FORMAL_ARTIFACT_PHASES } from "@/v3/lib/formalArtifacts";
import { STUDIO_REGISTRY } from "@/v3/components/flow/studio/studios";
import { workflowElementId, stepElementId } from "@/v3/lib/ledger/migrate";
import { declaredCrossPhaseTargets } from "@/v3/lib/artifactStaleness";
import { buildLineModel } from "@/v3/lib/lineModel";
import { movementArtifacts, gateChecklist, gateReadiness, flowMovements } from "@/v3/components/flow/flowShellData";
import { projectFutureState } from "@/v3/components/flow/flowFutureState";
import { StudioLockContext, StudioAuthoringContext } from "@/v3/components/flow/studio/StudioKit";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");
const listen = () => flowMovements().find((m) => m.id === "listen")!;

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/** One atlas workflow with two steps: one mechanical, one that reads like
 * judgement. Enough for the heuristic and the recorded decision to disagree. */
const ATLAS = {
  workflows: [{
    name: "Quote to cash", area: "Sales", owner: "Ada", trigger: "An RFQ arrives",
    steps: [
      { actor: "Sales Rep", action: "Re-key the quote into the CRM", system: "CRM", duration: "2d", entities: ["Quote"] },
      { actor: "Sales Lead", action: "Approve the discount", system: "CRM", entities: ["Quote"] },
    ],
  }],
  painHeatmap: [{ area: "Quote", pain: "the re-keying eats the week", severity: "high", quote: "I retype it twice" }],
  events: [{ name: "Quote Amended", triggers: "a change", produces: "a new version" }],
  systemsInventory: [{ system: "CRM", usedFor: "quotes" }],
  openQuestions: [], gaps: [],
};

/** Listen's EVIDENCE criteria, all met — every roster voice attested heard and
 * no open contradiction. Without this the gate stops at the evidence facet and
 * never reaches the record facet, which is the one Agentify sits in. */
const LISTEN_INPUTS = {
  interviewRoster: JSON.stringify([{ name: "Ada", role: "Sales", status: "Heard" }]),
  contradictionLog: JSON.stringify([]),
};

/** A programme exactly as the 11 live ones are today: an Atlas, no Agentify. */
const preAgentify = (): ProgramSummary => ({
  id: "p-pre", name: "Pre-Agentify", methodology: "atos-flow",
  rawData: {
    data: {
      currentStateAtlas: structuredClone(ATLAS),
      domainOntology: { entities: [{ name: "Quote" }] },
      phaseInputs: { listen: { ...LISTEN_INPUTS } },
      phaseArtifacts: { listen: { "current-state-atlas": { status: "approved" }, "domain-ontology": { status: "approved" } } },
    },
  },
} as unknown as ProgramSummary);

/** The same programme once Agentify has been generated. */
const withAgentify = (steps: Array<Record<string, unknown>>): ProgramSummary => ({
  id: "p-post", name: "Post-Agentify", methodology: "atos-flow",
  rawData: {
    data: {
      currentStateAtlas: structuredClone(ATLAS),
      domainOntology: { entities: [{ name: "Quote" }] },
      agentify: { workflows: [{ name: "Quote to cash", area: "Sales", steps }], summary: "s", confidence: 0.8, generatedAt: "2026-08-11" },
    },
  },
} as unknown as ProgramSummary);

const cardFor = (program: ProgramSummary, id: string) =>
  movementArtifacts(program, listen()).find((a) => a.id === id)!;

/* ── where it sits ────────────────────────────────────────────────────────── */

describe("Agentify sits under Listen, immediately after the Current-State Atlas", () => {
  it("the methodology declares it third, and the order comes from that array alone", () => {
    expect(getPhaseDefinition("listen", "atos-flow")!.requiredArtifacts)
      .toEqual(["domain-ontology", "current-state-atlas", "agentify"]);
    const order = getPhaseArtifactDefs("listen").map((d) => d.id);
    expect(order.indexOf("agentify")).toBe(order.indexOf("current-state-atlas") + 1);
  });

  it("it renders as a real deliverable with a label, not a bare id", () => {
    const def = getPhaseArtifactDefs("listen").find((d) => d.id === "agentify")!;
    expect(def.label).toBe("Agentify");
    expect(def.description.length).toBeGreaterThan(20);
  });

  it("it has its OWN document, not a second view of the atlas's", () => {
    expect(FORMAL_ARTIFACT_FIELD_KEYS["agentify"]).toBe("agentify");
    expect(FORMAL_ARTIFACT_FIELD_KEYS["agentify"]).not.toBe(FORMAL_ARTIFACT_FIELD_KEYS["current-state-atlas"]);
    expect(FORMAL_ARTIFACT_PHASES["agentify"]).toBe("listen");
  });
});

/* ── what moved, and what stayed ──────────────────────────────────────────── */

describe("the workflows stayed on the Atlas; Agentify decides about them", () => {
  // The first cut of this artifact moved the whole workflow surface OUT of the
  // Atlas. That was too much: the Atlas IS the workflows — it is where the work is
  // described and where every structural change to it is made. Agentify decides ONE
  // thing about those same workflows and owns no copy of them.
  it("the atlas leads with its workflows; Agentify's document holds none", () => {
    expect(STUDIO_REGISTRY["current-state-atlas"].docOrder?.[0]).toBe("workflows");
    expect(STUDIO_REGISTRY["agentify"].docOrder).not.toContain("workflows");
  });

  it("the atlas KEEPS its registers — they are the document's, not a workflow's", () => {
    for (const key of ["events", "painHeatmap", "systemsInventory", "openQuestions", "coverage"]) {
      expect(STUDIO_REGISTRY["current-state-atlas"].docOrder).toContain(key);
    }
  });

  it("the Agentify studio resolves to a real field key (the flowLibs registry rule)", () => {
    expect(STUDIO_REGISTRY["agentify"]?.fieldKey).toBe("agentify");
  });
});

/* ── it degrades honestly on the 11 programmes that predate it ────────────── */

describe("a programme with no Agentify yet", () => {
  it("reads NOT PRESENT — no excerpt, no confidence, no half-state", () => {
    const card = cardFor(preAgentify(), "agentify");
    expect(card.present).toBe(false);
    expect(card.excerpt).toBeNull();
    expect(card.confidence).toBeNull();
    expect(card.gaps).toBe(0);
    expect(card.stale).toBe(false);   // never generated ≠ out of date
  });

  it("does not disturb the Atlas beside it", () => {
    expect(cardFor(preAgentify(), "current-state-atlas").present).toBe(true);
  });

  it("holds the Listen gate, and the gate SAYS WHAT IS MISSING by name", () => {
    const program = preAgentify();
    const artifacts = movementArtifacts(program, listen());
    const checks = gateChecklist(program, listen(), artifacts);
    const row = checks.find((c) => c.artifactId === "agentify")!;
    expect(row.label).toBe("Agentify generated");
    expect(row.done).toBe(false);
    expect(row.group).toBe("record");
    // …and the composed verdict names it rather than going amber unexplained.
    const verdict = gateReadiness(program, listen(), artifacts, checks);
    expect(verdict.tone).not.toBe("green");
    expect(`${verdict.detail ?? ""}${verdict.headline}`).toContain("Agentify");
  });

  it("shows on the Line as a station that can be generated — but only once the Atlas exists", () => {
    const empty = buildLineModel({ id: "p0", name: "Empty", methodology: "atos-flow", rawData: { data: {} } } as unknown as ProgramSummary);
    const dead = empty.bands[1].stations.find((s) => s.id === "agentify")!;
    expect(dead.maturity).toBe(0);
    expect(dead.canGenerate).toBe(false);   // nothing to read yet — no dead Generate
    const seeded = buildLineModel(preAgentify()).bands[1].stations.find((s) => s.id === "agentify")!;
    expect(seeded.maturity).toBe(0);        // still absent…
    expect(seeded.canGenerate).toBe(true);  // …but now producible
  });

  it("READING it mutates nothing — no artifact is conjured onto the blob", () => {
    const program = preAgentify();
    const before = structuredClone(program.rawData);
    const artifacts = movementArtifacts(program, listen());
    gateReadiness(program, listen(), artifacts, gateChecklist(program, listen(), artifacts));
    projectFutureState(program);
    expect(program.rawData).toEqual(before);
    expect((program.rawData as Record<string, Record<string, unknown>>).data.agentify).toBeUndefined();
  });
});

/* ── the decision it now owns ─────────────────────────────────────────────── */

describe("Agentify is the home of the automate / assist / keep call", () => {
  it("a RECORDED mode wins over the verb heuristic — a human said so", () => {
    // "Approve the discount" is judgement by the heuristic (→ assist). The
    // record says agentify; the projection must not overrule the record.
    const state = projectFutureState(withAgentify([
      { action: "Re-key the quote into the CRM", mode: "keep" },
      { action: "Approve the discount", mode: "agentify" },
    ]));
    expect(state.workflows[0].steps.map((s) => s.mode)).toEqual(["keep", "agentify"]);
    expect(state.workflows[0].steps[0].hitl).toBe(true);      // kept manual ⇒ human
    expect(state.workflows[0].steps[1].hitl).toBeUndefined(); // agentified ⇒ not
  });

  it("a step nobody decided falls back to the heuristic — silence is not a call", () => {
    const state = projectFutureState(withAgentify([
      { action: "Re-key the quote into the CRM", mode: "" },
      { action: "Approve the discount" },
    ]));
    expect(state.workflows[0].steps.map((s) => s.mode)).toEqual(["agentify", "assist"]);
  });

  it("a programme with no Agentify document reads exactly as it did before", () => {
    const state = projectFutureState(preAgentify());
    expect(state.workflows[0].name).toBe("Quote to cash");
    expect(state.workflows[0].steps.map((s) => s.mode)).toEqual(["agentify", "assist"]);
  });

  // The two shapes must project identically — the whole point of storing decisions
  // by element id is that nothing downstream has to know which shape it is reading.
  it("a decision in the KEYED shape reaches Envision, with no copy of the workflows anywhere", () => {
    const wid = workflowElementId("Quote to cash");
    const program = {
      id: "p-keyed", name: "Keyed", methodology: "atos-flow",
      rawData: { data: {
        currentStateAtlas: structuredClone(ATLAS),
        agentify: { decisions: [
          { _stepId: stepElementId(wid, "Sales Rep", "Re-key the quote into the CRM"), workflow: "Quote to cash", step: "Re-key…", mode: "keep", rationale: "" },
          { _stepId: stepElementId(wid, "Sales Lead", "Approve the discount"), workflow: "Quote to cash", step: "Approve…", mode: "agentify", rationale: "" },
        ] },
      } },
    } as unknown as ProgramSummary;
    const state = projectFutureState(program);
    expect(state.workflows[0].steps.map((s) => s.mode)).toEqual(["keep", "agentify"]);
    expect(state.workflows[0].steps[0].hitl).toBe(true);
    expect(state.workflows[0].steps[1].hitl).toBeUndefined();
    // and the Atlas is what supplied the steps — Agentify holds no workflows at all
    expect((program.rawData as Record<string, Record<string, Record<string, unknown>>>).data.agentify.workflows).toBeUndefined();
  });

  it("a WITHDRAWN decision (mode:\"\") beats a legacy copy that still says otherwise", () => {
    const wid = workflowElementId("Quote to cash");
    const program = {
      id: "p-clear", name: "Cleared", methodology: "atos-flow",
      rawData: { data: {
        currentStateAtlas: structuredClone(ATLAS),
        agentify: {
          workflows: [{ name: "Quote to cash", steps: [{ actor: "Sales Rep", action: "Re-key the quote into the CRM", mode: "keep" }] }],
          decisions: [{ _stepId: stepElementId(wid, "Sales Rep", "Re-key the quote into the CRM"), mode: "", rationale: "" }],
        },
      } },
    } as unknown as ProgramSummary;
    // Back to the heuristic — not stuck on the call the operator took back.
    expect(projectFutureState(program).workflows[0].steps[0].mode).toBe("agentify");
  });
});

/* ── the generator ────────────────────────────────────────────────────────── */

describe("Agentify has a real generator — a gating artifact nothing can produce is a trap", () => {
  it("the edge registers the agent under Listen with its own field key", () => {
    expect(EDGE).toMatch(/\n {2}"agentify": \{\n {4}phase: "listen",\n {4}fieldKey: "agentify",/);
    expect(EDGE.slice(EDGE.indexOf("const VALID_AGENT_IDS"), EDGE.indexOf("const AGENT_ID_ALIASES")))
      .toContain('"agentify"');
  });

  it("it is fed the Atlas body it carries forward", () => {
    const deps = EDGE.match(/\n {2}agentify: \[([^\]]+)\]/)![1];
    expect(deps).toContain('"currentStateAtlas"');
  });

  it("a shrunken re-run cannot silently overwrite the decisions on record", () => {
    // The guarded section must be the one the document IS. Guarding `workflows` —
    // a key the generator no longer emits — is a guard over an always-empty array,
    // which lets a re-run with half the calls wipe the other half in silence.
    expect(EDGE).toContain('"agentify": ["decisions"]');
  });

  it("the generator emits DECISIONS, and owns no copy of the Atlas's workflows", () => {
    const start = EDGE.indexOf('\n  "agentify": {');
    const block = EDGE.slice(start, EDGE.indexOf('\n  "domain-ontology": {', start));
    // The output contract's row is the shape agentifyDecisions reads: which step,
    // which call, why — identified by the Atlas's own words.
    expect(block).toMatch(/"decisions": \[ \{ "workflow":[^\n]*"step":[^\n]*"mode":[^\n]*"rationale":/);
    // …and NOT a second copy of the current state. `"workflows": [` in the contract
    // is what the correction removed; the prompt says so in words too.
    expect(block).not.toContain('"workflows": [');
    expect(block).toContain('DO NOT RETURN THE WORKFLOWS');
  });

  it("a re-synthesised Atlas leaves Agentify trailing its own evidence", () => {
    // The client's confirm path reads this map; the edge's UPSTREAM_ARTIFACT_DEPS
    // is the same edge on the server side. Both are asserted so the two graphs
    // cannot silently disagree about what an Atlas rewrite invalidates.
    const targets = declaredCrossPhaseTargets(["current-state-atlas"], {
      listen: { "agentify": { status: "draft" } },
    } as Parameters<typeof declaredCrossPhaseTargets>[1]);
    expect(targets).toContainEqual({ phaseId: "listen", artifactId: "agentify" });
  });

  it("the prompt makes 'undecided' an available answer, not an invented mode", () => {
    const start = EDGE.indexOf('\n  "agentify": {');
    const block = EDGE.slice(start, EDGE.indexOf('\n  "domain-ontology": {', start));
    expect(block).toContain('"mode": ""');
    expect(block).toContain("openQuestions");
  });
});

/* ── both Listen tabs are diagrams ────────────────────────────────────────── */

// Two lists in FlowArtifactStudio decide which artifact OPENS on its studio and
// which one EXPORTS that studio rather than the typeset document. BOTH Listen tabs
// qualify: the Atlas because the swimlane IS the atlas (and the only place its
// workflows can be edited), Agentify because its studio — the activity list with
// the calls on it — is the artifact, and a typeset export of a decisions register
// prints hashes where the work should be. Parsed from source (the edgeLockstep
// idiom) because the alternative is mounting the whole artifact dialog to observe
// a default tab.
describe("both Listen tabs open on, and export, their own studio", () => {
  const STUDIO = readFileSync(resolve(__dirname, "../components/flow/studio/FlowArtifactStudio.tsx"), "utf8");
  const listOf = (name: string) => {
    const block = STUDIO.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))![1];
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  it("both open on their studio, not on the typeset reading view", () => {
    const graphFirst = listOf("GRAPH_FIRST");
    expect(graphFirst).toContain("agentify");
    expect(graphFirst).toContain("current-state-atlas");
  });

  it("both export that studio — an exported Atlas without its swimlanes is a cover sheet", () => {
    const printGraphic = listOf("PRINT_GRAPHIC_ARTIFACTS");
    expect(printGraphic).toContain("agentify");
    expect(printGraphic).toContain("current-state-atlas");
  });
});

/* ── the surfaces ─────────────────────────────────────────────────────────── */

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

describe("the two Listen tabs draw the SAME workflows, and decide different things", () => {
  it("the Atlas tab draws the swimlane AND the registers — it is the whole current state", () => {
    const el = mountStudio("current-state-atlas", structuredClone(ATLAS) as Record<string, unknown>, preAgentify());
    expect(el.querySelector(".v3fs-seam-wf")).not.toBeNull();
    expect(el.textContent).toContain("Systems inventory");
    expect(el.textContent).toContain("Pain heatmap");
  });

  it("the Atlas offers NO agentify control — describing the work is not deciding about it", () => {
    const el = mountStudio("current-state-atlas", structuredClone(ATLAS) as Record<string, unknown>, preAgentify());
    click([...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Quote to cash")));
    click(el.querySelector("button.v3fs-swim-tile"));
    expect(el.querySelector(".v3fs-wf-inspector")).not.toBeNull();   // the step DOES open for editing…
    expect(el.querySelector(".v3fs-wf-modebar")).toBeNull();         // …but the call is not made here
    expect(el.querySelector(".v3fs-wf-flag")).toBeNull();            // and no flag is worn
  });

  it("the Agentify tab LISTS the ATLAS's activities — with no document of its own at all", () => {
    // The 11 live programmes: an Atlas, no Agentify. The activities must be there.
    const el = mountStudio("agentify", {}, preAgentify());
    expect(el.textContent).toContain("Quote to cash");                       // the group heading
    expect([...el.querySelectorAll(".v3fs-ag-act")].map((n) => n.textContent))
      .toEqual(["Re-key the quote into the CRM", "Approve the discount"]);
    expect(el.querySelectorAll('button[role="switch"]')).toHaveLength(2);    // a toggle each
  });

  it("the call on an activity WRITES — as a decision keyed by the atlas step id, never as a workflow", () => {
    const el = mountStudio("agentify", {}, preAgentify());
    const row = [...el.querySelectorAll<HTMLElement>(".v3fs-ag-row")]
      .find((r) => r.querySelector(".v3fs-ag-act")?.textContent === "Re-key the quote into the CRM")!;
    expect(row.querySelector(".v3fs-ag-state")?.textContent).toBe("Not decided");
    click(row.querySelector('button[role="switch"]'));

    // No copy of the atlas landed on the Agentify document…
    expect(wrote!.workflows).toBeUndefined();
    // …and the decision is filed under the ledger element id of the atlas step.
    const rows = wrote!.decisions as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);                       // only the toggled activity was decided
    expect(rows[0].mode).toBe("agentify");
    expect(rows[0]._stepId).toBe(
      stepElementId(workflowElementId("Quote to cash"), "Sales Rep", "Re-key the quote into the CRM"));
    expect(rows[0].step).toBe("Re-key the quote into the CRM");   // a legend, for the typeset read
    // and it comes back as the row's own state
    expect(el.querySelector('button[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
  });

  it("Agentify cannot reshape a workflow — no add, no reorder, no drop, no dismiss, no fields", () => {
    const el = mountStudio("agentify", {}, preAgentify());
    expect(el.querySelector("button.v3fs-seam-addwf")).toBeNull();
    expect(el.querySelector(".v3fs-seam-wf-dismiss")).toBeNull();
    expect(el.querySelector(".v3fs-swim-tile")).toBeNull();                 // no diagram to edit through
    expect(el.querySelector(".v3fs-wf-insp-actions")).toBeNull();           // no reorder / drop
    expect(el.textContent).not.toContain("Dismiss this workflow");
    // No kit field anywhere: the activities are stated, and only the calls are edits.
    expect([...el.querySelectorAll("label.v3fs-stu-field .v3fs-stu-fl")].map((n) => n.textContent))
      .toEqual([]);
  });

  it("the activities are read from the ATLAS, and nothing is copied back onto Agentify", () => {
    const doc = {};
    const el = mountStudio("agentify", doc, preAgentify());
    expect([...el.querySelectorAll(".v3fs-ag-act")]).toHaveLength(2);
    expect(doc).toEqual({});                      // reading wrote nothing at all
    expect(wrote).toBeNull();
  });
});
