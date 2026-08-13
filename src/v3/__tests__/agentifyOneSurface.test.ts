/**
 * ONE PLACE DECIDES WHETHER A STEP IS AGENTIFIED.
 *
 * Reported: "experience design - workflows to agentify - this is duplicate with
 * agentify in listen". It was worse than a duplicate. Two toggles over the same
 * Atlas steps, with two different stores behind them:
 *
 *   Agentify (Listen)   `agentify.decisions`, keyed by the step's ELEMENT ID
 *   Experience Design   `experienceDesign.agentifyMarks`, keyed by "workflow::action"
 *
 * and two different readers: the future-state projection read only the register, the
 * Blueprint read only the marks. A team that made its calls in Listen got an empty
 * "agentic direction" in the Blueprint, a team that used the design studio got no
 * agentified steps in the projection, and a workflow rename broke the text-keyed half
 * without saying anything.
 *
 * The marks were real decisions people made, so the fix is a fold, not a delete.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readDecisions, writeDecision, decisionStepId } from "@/v3/lib/ledger/agentifyDecisions";

const ATLAS = {
  workflows: [{
    name: "Quote to cash",
    steps: [
      { actor: "Rep", action: "Draft the quote" },
      { actor: "Manager", action: "Approve the discount" },
    ],
  }],
};
const stepId = (i: number) => decisionStepId(ATLAS.workflows[0], ATLAS.workflows[0].steps[i]);

describe("a call made on the retired surface survives", () => {
  it("an Experience Design mark reads as an agentify decision", () => {
    // MUTATION: drop the marks fold from readDecisions → RED, and every call the
    // delivery team made on that card is silently gone.
    const decisions = readDecisions({}, ATLAS, {
      agentifyMarks: { "Quote to cash::Approve the discount": { workflow: "Quote to cash", action: "Approve the discount" } },
    });
    expect(decisions[stepId(1)]).toEqual({ mode: "agentify", rationale: "" });
  });

  it("it lands under the ELEMENT ID, so a rename cannot orphan it", () => {
    // The whole reason the register exists. The mark's own key is the workflow's
    // words; what it resolves to is not.
    const decisions = readDecisions({}, ATLAS, {
      agentifyMarks: { "Quote to cash::Draft the quote": {} },
    });
    const id = Object.keys(decisions)[0];
    expect(id).toBe(stepId(0));
    expect(id, "the text key was carried through as the identity").not.toContain("::");
  });

  it("a mark for a step the Atlas does not have is not invented", () => {
    // Resolution is through the Atlas. A mark left over from a step somebody deleted
    // resolves to nothing, and nothing is exactly what it should become.
    const decisions = readDecisions({}, ATLAS, {
      agentifyMarks: { "Quote to cash::A step that was removed": {} },
    });
    expect(decisions).toEqual({});
  });

  it("marks do not touch a programme that has none", () => {
    expect(readDecisions({}, ATLAS, {})).toEqual({});
    expect(readDecisions({}, ATLAS, null)).toEqual({});
    expect(readDecisions({}, ATLAS)).toEqual({});
  });
});

describe("the register outranks both legacy sources", () => {
  it("a withdrawal in Agentify is not resurrected by an old mark", () => {
    // The failure this ordering prevents: the operator takes a call back in Agentify,
    // and the retired card's mark puts it straight back on every read.
    // MUTATION: fold the marks AFTER the decisions register → RED.
    const withdrawn = writeDecision({}, ATLAS, stepId(1), { mode: "" });
    const decisions = readDecisions(withdrawn, ATLAS, {
      agentifyMarks: { "Quote to cash::Approve the discount": {} },
    });
    expect(decisions[stepId(1)], "a withdrawn call came back from the retired surface").toBeUndefined();
  });

  it("an explicit call in Agentify wins over the mark's implied one", () => {
    // A mark only ever meant "agentify"; Agentify can say "assist" or "keep".
    const kept = writeDecision({}, ATLAS, stepId(1), { mode: "keep" });
    const decisions = readDecisions(kept, ATLAS, {
      agentifyMarks: { "Quote to cash::Approve the discount": {} },
    });
    expect(decisions[stepId(1)].mode).toBe("keep");
  });
});

describe("there is one decision surface, and one reader", () => {
  const SRC = (f: string) => readFileSync(resolve(__dirname, `../components/flow/${f}`), "utf8");

  it("Experience Design no longer makes the call", () => {
    const ed = SRC("studio/ExperienceDesignStudio.tsx");
    // MUTATION: restore the card → each of these is RED.
    expect(ed).not.toContain('EdCard label="Workflows to agentify"');
    expect(ed, "the write path is back").not.toContain("patch({ agentifyMarks: next })");
  });

  it("the Blueprint reads the register, not the retired store", () => {
    const studios = SRC("studio/studios.tsx");
    expect(studios, "the Blueprint is reading a store nothing writes any more")
      .not.toContain("asRecord(ed.agentifyMarks)");
    expect(studios).toContain("projectFutureState(program).workflows");
  });

  it("every reader passes the Experience Design doc, or the fold is dead code", () => {
    // A fold no caller reaches is the same as no fold: the guard against fixing this
    // in the library and forgetting the call sites.
    expect(SRC("flowFutureState.ts")).toContain("readDecisions(agentify, atlas, design)");
    expect(SRC("studio/studios.tsx")).toContain("readDecisions(doc, atlasDoc, edDoc)");
  });
});
