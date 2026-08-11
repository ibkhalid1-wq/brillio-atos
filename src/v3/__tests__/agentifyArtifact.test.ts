/**
 * AGENTIFY — Listen's third artifact, and the new home of the workflows.
 *
 * The Current-State Atlas says how the business runs today. Agentify says what
 * should happen to each of those steps: automate it, assist the human doing it,
 * or keep it a human judgement. That decision already existed in the codebase as
 * `FutureMode` in flowFutureState (inferred by a regex over the step's verb) and
 * as the "agentify" stakeholder review in flowPortal — but it had no home, no
 * document, and no place in the methodology. It does now, and the workflow
 * swimlane moved into it because the swimlane is where the call is made.
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

describe("the workflows moved off the Atlas tab and into Agentify", () => {
  it("the atlas no longer typesets workflows; Agentify leads with them", () => {
    expect(STUDIO_REGISTRY["current-state-atlas"].docOrder).not.toContain("workflows");
    expect(STUDIO_REGISTRY["agentify"].docOrder?.[0]).toBe("workflows");
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
    expect(EDGE).toContain('"agentify": ["workflows"]');
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

/* ── the diagram travelled with the workflows ─────────────────────────────── */

// Two lists in FlowArtifactStudio decide which artifact OPENS on its picture and
// which one EXPORTS its picture. Both named the atlas because the atlas drew the
// swimlanes; it doesn't any more. Parsed from source (the edgeLockstep idiom)
// because the alternative is mounting the whole artifact dialog to observe a
// default tab.
describe("the swimlane's studio behaviours followed it to Agentify", () => {
  const STUDIO = readFileSync(resolve(__dirname, "../components/flow/studio/FlowArtifactStudio.tsx"), "utf8");
  const listOf = (name: string) => {
    const block = STUDIO.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))![1];
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  it("Agentify opens on its diagram; the atlas opens as its typeset registers", () => {
    const graphFirst = listOf("GRAPH_FIRST");
    expect(graphFirst).toContain("agentify");
    expect(graphFirst).not.toContain("current-state-atlas");
  });

  it("Agentify exports the picture; the atlas — now a form — exports the document", () => {
    const printGraphic = listOf("PRINT_GRAPHIC_ARTIFACTS");
    expect(printGraphic).toContain("agentify");
    expect(printGraphic).not.toContain("current-state-atlas");
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

describe("the two Listen tabs draw different things", () => {
  it("the Atlas tab draws the registers and NO swimlane", () => {
    const el = mountStudio("current-state-atlas", structuredClone(ATLAS) as Record<string, unknown>, preAgentify());
    expect(el.textContent).toContain("Systems inventory");
    expect(el.textContent).toContain("Pain heatmap");
    expect(el.querySelector(".v3fs-swim")).toBeNull();
    expect(el.querySelector(".v3fs-seam-wf")).toBeNull();
  });

  it("the Agentify tab draws the workflows, and the call on a step WRITES", () => {
    const doc = { workflows: structuredClone(ATLAS.workflows), openQuestions: [], gaps: [] };
    const el = mountStudio("agentify", doc as Record<string, unknown>, preAgentify());
    // Open the workflow's row, then its first step.
    click([...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Quote to cash")));
    click(el.querySelector("button.v3fs-swim-tile"));
    const bar = el.querySelector<HTMLElement>(".v3fs-wf-modebar")!;
    expect(bar.textContent).toContain("Not decided yet");
    click([...bar.querySelectorAll("button")].find((b) => b.textContent === "Keep manual"));
    const steps = (wrote!.workflows as Array<Record<string, unknown>>)[0].steps as Array<Record<string, unknown>>;
    expect(steps[0].mode).toBe("keep");
    expect(steps[1].mode).toBeUndefined();  // only the selected step was decided
  });

  it("the pain the swimlane shades by still comes from the ATLAS, which Agentify does not own", () => {
    const doc = { workflows: structuredClone(ATLAS.workflows) };
    const el = mountStudio("agentify", doc as Record<string, unknown>, preAgentify());
    click([...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Quote to cash")));
    expect(el.querySelector(".v3fs-swim-tile.pain-high")).toBeTruthy();
    expect((doc as Record<string, unknown>).painHeatmap).toBeUndefined();
  });
});
