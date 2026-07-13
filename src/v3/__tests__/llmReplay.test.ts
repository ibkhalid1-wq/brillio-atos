/**
 * LLM replay layer — the T3 (determinism) and T7 (retrieval isolation) harness.
 * These prove the SEMANTICS the audit needs: identical requests replay
 * identically (T3), and a request/fixture is bound to exactly its evidence so
 * one programme's answer can never be served for another (T7).
 */
import { describe, it, expect } from "vitest";
import {
  fingerprintRequest, canonicalize, createReplayTransport, assertDeterministic,
  requestMentions, assertNoForeignEvidence, ReplayMissError, type LlmFixture,
} from "@/v3/lib/llmReplay";
import { fingerprintRequest as edgeFingerprint, canonicalize as edgeCanonicalize } from "../../../supabase/functions/_shared/llmReplay";

const fixture = (channel: string, request: unknown, response: unknown): LlmFixture => ({
  fingerprint: fingerprintRequest(channel, request), channel, request, response,
});

describe("llmReplay — fingerprint stability", () => {
  it("is invariant to key order", () => {
    const a = fingerprintRequest("run-agent", { agentId: "x", programId: "p", phaseId: "frame" });
    const b = fingerprintRequest("run-agent", { phaseId: "frame", programId: "p", agentId: "x" });
    expect(a).toBe(b);
  });

  it("excludes volatile fields (runId, timestamps) so the same logical call keys one fixture", () => {
    const a = fingerprintRequest("run-agent", { agentId: "x", runId: "r1", ts: 111 });
    const b = fingerprintRequest("run-agent", { agentId: "x", runId: "r2", ts: 222 });
    expect(a).toBe(b);
  });

  it("changes when any substantive field changes", () => {
    const base = fingerprintRequest("run-agent", { agentId: "x", programId: "p" });
    expect(fingerprintRequest("run-agent", { agentId: "y", programId: "p" })).not.toBe(base);
    expect(fingerprintRequest("run-agent", { agentId: "x", programId: "q" })).not.toBe(base);
    expect(fingerprintRequest("flow-extract", { agentId: "x", programId: "p" })).not.toBe(base); // channel counts
  });

  it("canonicalize drops volatile keys at every depth", () => {
    const s = canonicalize({ b: 1, a: { ts: 9, keep: 2 } });
    expect(s).toBe('{"a":{"keep":2},"b":1}');
  });
});

describe("llmReplay — T3 determinism", () => {
  it("replays a recorded response byte-identically across repeated runs", async () => {
    const req = { channel: "run-agent", programId: "p", agentId: "domain-ontology", phaseId: "listen" };
    const t = createReplayTransport({ mode: "replay", fixtures: [fixture("run-agent", req, { text: "ONTOLOGY-V1" })] });
    const verdict = await assertDeterministic(t, "run-agent", req, 5);
    expect(verdict.deterministic).toBe(true);
    expect(verdict.distinct).toBe(1);
    expect(t.stats.hits).toBe(5);
  });

  it("record mode captures the live response once, then replay reproduces it", async () => {
    const req = { channel: "run-agent", programId: "p", agentId: "charter" };
    let liveCalls = 0;
    const rec = createReplayTransport({ mode: "record", live: async () => { liveCalls += 1; return { text: `gen-${liveCalls}` }; } });
    const first = await rec("run-agent", req);
    expect(first).toEqual({ text: "gen-1" });
    expect(rec.recorded()).toHaveLength(1);

    // Replay from the captured fixture — deterministic, no further live calls.
    const rep = createReplayTransport({ mode: "replay", fixtures: rec.recorded() });
    const again = await rep("run-agent", req);
    expect(again).toEqual({ text: "gen-1" });
    expect(liveCalls).toBe(1);
  });

  it("strict replay throws a ReplayMiss instead of silently going live", async () => {
    const t = createReplayTransport({ mode: "replay", fixtures: [], strict: true, live: async () => ({ text: "LIVE" }) });
    await expect(t("run-agent", { agentId: "z" })).rejects.toBeInstanceOf(ReplayMissError);
  });
});

describe("llmReplay — client/edge lockstep", () => {
  // A fixture recorded by the edge must replay client-side and vice-versa, so the
  // two fingerprint implementations must agree byte-for-byte.
  it("client and edge fingerprints match on the same request", () => {
    const req = { agentId: "domain-ontology", programId: "p", phaseId: "listen", system: "S", messages: [{ role: "user", content: "hi" }] };
    expect(edgeFingerprint("run-agent", req)).toBe(fingerprintRequest("run-agent", req));
  });
  it("client and edge canonicalize identically (incl. volatile-key drop)", () => {
    const v = { b: 2, a: 1, runId: "r", nested: { ts: 9, keep: 3 } };
    expect(edgeCanonicalize(v)).toBe(canonicalize(v));
  });
});

describe("llmReplay — T7 retrieval isolation", () => {
  const evidenceA = "Sarah Okafor: our quote cycle is 9 days";
  const evidenceB = "CONFIDENTIAL ACME MERGER: target price $2.1B"; // must never leak into A

  it("a fixture recorded for programme A is a cache MISS for programme B, never a stale reuse", async () => {
    const reqA = { channel: "run-agent", programId: "A", agentId: "charter", context: evidenceA };
    const reqB = { channel: "run-agent", programId: "B", agentId: "charter", context: evidenceB };
    const t = createReplayTransport({ mode: "replay", strict: true, fixtures: [fixture("run-agent", reqA, { text: "A-CHARTER" })] });
    await expect(t("run-agent", reqA)).resolves.toEqual({ text: "A-CHARTER" });
    // B differs only by programme + evidence — the fingerprint diverges, so B cannot be served A's answer.
    await expect(t("run-agent", reqB)).rejects.toBeInstanceOf(ReplayMissError);
  });

  it("requestMentions flags foreign evidence that leaked into an assembled request", () => {
    const cleanRequest = { programId: "A", context: `Prior context:\n${evidenceA}` };
    const leakyRequest = { programId: "A", context: `Prior context:\n${evidenceA}\n${evidenceB}` };
    expect(requestMentions(cleanRequest, ["ACME MERGER", "$2.1B"])).toEqual([]);
    expect(requestMentions(leakyRequest, ["ACME MERGER"])).toEqual(["ACME MERGER"]);
  });

  it("assertNoForeignEvidence passes on isolated context and throws on a breach", () => {
    expect(() => assertNoForeignEvidence({ context: evidenceA }, ["ACME MERGER", "$2.1B"])).not.toThrow();
    expect(() => assertNoForeignEvidence({ context: `${evidenceA} ${evidenceB}` }, ["ACME MERGER"])).toThrow(/isolation breach/i);
  });
});
