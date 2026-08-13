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
 * The card is gone and every reader now comes here. NO migration was kept for the
 * marks: measured across all 125 programme blobs, deleted included, `agentifyMarks`
 * held ZERO entries, and it can never gain one now that the only surface writing it
 * is deleted. A reader for a provably extinct input is a test passing over an empty
 * set. The legacy `workflows` copy is a different matter and is exercised below —
 * 55 live calls on two programmes still arrive that way.
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

describe("the register outranks the legacy copy", () => {
  /**
   * The legacy shape that is REAL: Agentify's own copy of the workflows with a
   * `mode` per step. Measured across every blob, 55 live calls on two programmes
   * still arrive this way — unlike `agentifyMarks`, which held zero and whose
   * writing surface no longer exists, so no fold was kept for it.
   */
  const legacyCopy = {
    workflows: [{
      name: "Quote to cash",
      steps: [
        { actor: "Rep", action: "Draft the quote" },
        { actor: "Manager", action: "Approve the discount", mode: "agentify" },
      ],
    }],
  };

  it("reads a call made in the legacy copy", () => {
    expect(readDecisions(legacyCopy, ATLAS)[stepId(1)]?.mode).toBe("agentify");
  });

  it("a withdrawal in the register is not resurrected by the legacy copy", () => {
    // The ordering failure that would be hardest to notice and worst to live with:
    // the operator takes a call back, and the old copy puts it straight back.
    // MUTATION: read the legacy copy AFTER the register → RED.
    const withdrawn = writeDecision(legacyCopy, ATLAS, stepId(1), { mode: "" });
    expect(readDecisions(withdrawn, ATLAS)[stepId(1)],
      "a withdrawn call came back from the legacy copy").toBeUndefined();
  });

  it("an explicit call outranks the legacy one", () => {
    const kept = writeDecision(legacyCopy, ATLAS, stepId(1), { mode: "keep" });
    expect(readDecisions(kept, ATLAS)[stepId(1)].mode).toBe("keep");
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

  it("no reader is left holding the extinct store", () => {
    // The fold that once read `agentifyMarks` is gone with the surface that wrote it
    // (zero entries across all 125 blobs, and no writer left to make one). This is
    // the guard against it creeping back in as "compatibility".
    expect(SRC("flowFutureState.ts")).toContain("readDecisions(agentify, atlas)");
    expect(SRC("studio/studios.tsx")).toContain("readDecisions(doc, atlasDoc)");
    const module = readFileSync(resolve(__dirname, "../lib/ledger/agentifyDecisions.ts"), "utf8");
    expect(module, "the extinct store is being read again").not.toContain("agentifyMarks)");
  });
});
