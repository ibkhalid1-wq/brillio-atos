/**
 * REGENERATING ANSWERS "EVIDENCE MOVED", SO IT CLEARS THE FLAG THAT SAID SO.
 *
 * Reported: "domain ontology shows evidence moved - even after regenerated." It did,
 * and it always would have. The client marks an artifact stale on EITHER of two
 * signals (flowShellData ~479):
 *
 *   1. `inputsFingerprint` no longer matches the movement's inputs
 *   2. the stub carries `status: "stale"` — written by the cascade when an UPSTREAM
 *      deliverable is regenerated and confirmed
 *
 * The edge's post-run stamp updated the fingerprint and spread the rest of the stub
 * through untouched, so signal 2 survived its own cure. On the live programme the
 * Domain Ontology stub reads `status: "stale"` with a FRESH fingerprint — the exact
 * fixed point where regenerating changes nothing the badge reads.
 *
 * These are source-level: the function is Deno-side inside `run-agent/index.ts`,
 * which vitest cannot import. They pin the two properties that matter and would each
 * fail if the fix were reverted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = readFileSync(
  resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");
const STAMP = EDGE.slice(
  EDGE.indexOf("function stampFlowArtifactFingerprint"),
  EDGE.indexOf("function stampFlowArtifactFingerprint") + 1800);

describe("the stamp clears the stale flag it just answered", () => {
  it("resets a stale stub to draft", () => {
    // MUTATION: delete the `next.status === "stale"` branch → RED, and the badge
    // becomes permanent again.
    expect(STAMP).toContain('if (next.status === "stale")');
    expect(STAMP).toContain('next.status = "draft"');
  });

  it("drops the reason and timestamp with it", () => {
    // They are the record of WHY it went stale. Left behind, a fresh document carries
    // an explanation for a state it is not in.
    expect(STAMP).toContain("delete next.staleReason");
    expect(STAMP).toContain("delete next.staleAt");
  });

  it("does NOT touch any other status", () => {
    // An approved or draft stub says nothing about this run, so this run says nothing
    // about it. The clear is conditional, never an unconditional assignment.
    // MUTATION: change the branch to always set draft → RED.
    const assignments = STAMP.match(/next\.status = /g) ?? [];
    expect(assignments, "status is being set outside the stale branch").toHaveLength(1);
  });

  it("still stamps the fingerprint — the other half of the signal", () => {
    expect(STAMP).toContain("inputsFingerprint: fingerprint");
  });
});

describe("the client still honours both signals", () => {
  it("reads status AND fingerprint, so neither fix hides the other", () => {
    // The bug was NOT that the client reads `status`. It should: that is how an
    // upstream regeneration reaches a downstream consumer at all.
    const shell = readFileSync(resolve(__dirname, "../components/flow/flowShellData.ts"), "utf8");
    expect(shell).toContain('stub.status === "stale"');
    expect(shell).toContain("stub?.inputsFingerprint === \"string\" && stub.inputsFingerprint !== currentFingerprint");
  });
});
