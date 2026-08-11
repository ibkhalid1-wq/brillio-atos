/**
 * THE MOVE MUST NOT MAKE THE DIAGRAM DISAPPEAR.
 *
 * Reported from the running app: "current state atlas not showing the visual
 * workflows". Both halves of that were true, and together they were a
 * regression rather than a relocation:
 *
 *  1. Agentify's document does not exist until it is GENERATED. Moving the
 *     workflows there left every existing programme — all 11 live ones — with
 *     no swimlane anywhere, until someone ran a new agent.
 *  2. The Atlas still CARRIES `workflows` (it is the evidence record and the
 *     source Agentify generates from), and removing the key from `docOrder`
 *     did not stop it rendering: the generic renderer appended it as a raw
 *     NAME / OWNER / STEPS / ACTION field dump. Worse than the swimlane, and
 *     worse than nothing.
 *
 * The fix is a read-through, not a copy. The Atlas stays the source; Agentify
 * shows those workflows immediately and becomes the working copy on the first
 * edit. Once Agentify holds its own, they win — a recorded decision is never
 * overwritten by the source it came from.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STUDIOS = readFileSync(resolve(__dirname, "../components/flow/studio/studios.tsx"), "utf8");
const ARTIFACT = readFileSync(resolve(__dirname, "../components/flow/studio/FlowArtifactStudio.tsx"), "utf8");

/** The AgentifyStudio body — where the read-through has to live. */
function agentifyBody(): string {
  const start = STUDIOS.indexOf("function AgentifyStudio");
  expect(start, "AgentifyStudio not found — re-anchor this scan").toBeGreaterThan(-1);
  const end = STUDIOS.indexOf("\nfunction ", start + 10);
  return STUDIOS.slice(start, end > start ? end : undefined);
}

describe("Agentify shows the workflows before it has a document of its own", () => {
  it("still renders the diagram at all (the scan is not vacuous)", () => {
    expect(agentifyBody()).toContain("<WorkflowStudio");
  });

  it("falls back to the Atlas's workflows when its own are empty", () => {
    const body = agentifyBody();
    expect(body, "no fallback — a programme with no Agentify document shows no diagram")
      .toMatch(/workflowDoc/);
    expect(body).toContain('FORMAL_ARTIFACT_FIELD_KEYS["current-state-atlas"]');
    // The fallback must be conditional on Agentify having none of its own.
    expect(body).toMatch(/ownWorkflows\.length\s*\n?\s*\?\s*doc/);
  });

  it("does NOT pass Agentify's own doc straight through any more", () => {
    // The exact shape of the regression: `doc={doc}` meant an ungenerated
    // Agentify rendered an empty diagram.
    expect(agentifyBody()).not.toMatch(/<WorkflowStudio doc=\{doc\}/);
  });

  it("seeds the WHOLE array, so one step edit cannot persist a one-workflow document", () => {
    const body = agentifyBody();
    expect(body).toMatch(/\.\.\.doc,\s*workflows:/);
  });

  it("Agentify's OWN workflows win once it has them — a decision is not overwritten by its source", () => {
    const body = agentifyBody();
    const cond = body.slice(body.indexOf("const workflowDoc"), body.indexOf("const workflowDoc") + 220);
    expect(cond).toMatch(/ownWorkflows\.length/);
    expect(cond.indexOf("? doc")).toBeGreaterThan(-1);
  });
});

describe("the Atlas stops presenting workflows as a raw field dump", () => {
  it("hides the key it no longer presents", () => {
    expect(ARTIFACT, "the Atlas still appends `workflows` through the generic renderer")
      .toMatch(/current-state-atlas[\s\S]{0,120}new Set\(\["workflows"\]\)/);
  });

  it("does not hide it from the DOCUMENT — the Atlas is still the source", () => {
    // Suppression is presentational only. If this ever became a data change the
    // generator would lose its input, so the registry must still carry the key
    // nowhere near a delete.
    expect(STUDIOS).toContain('"current-state-atlas": { fieldKey:');
    expect(ARTIFACT).not.toMatch(/delete\s+\w*\.workflows/);
  });

  it("leaves the Discovery Kit's own hide rule intact", () => {
    expect(ARTIFACT).toContain('new Set(["interviews"])');
  });
});
