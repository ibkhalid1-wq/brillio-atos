/**
 * Client ↔ edge lockstep — the contracts that must never drift.
 *
 * The edge function mirrors several client-side derivations byte-for-byte
 * (staleness fingerprints) or key-for-key (industry vocabulary steering,
 * value-chain segments). These tests parse BOTH source files and compare, so
 * a change on one side fails CI until the other side moves with it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_OPTIONS, INDUSTRY_SEGMENTS } from "@/v3/lib/methodology";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

describe("industry vocabulary steering covers the client's industry list", () => {
  const block = EDGE.match(/INDUSTRY_VOCABULARY_STEERING[^=]*=\s*\{([\s\S]*?)\n\};/);
  const edgeKeys = block ? [...block[1].matchAll(/\n\s*"([^"]+)":/g)].map((m) => m[1]) : [];

  it("every client industry option has a steering line on the edge", () => {
    expect(block).toBeTruthy();
    const missing = INDUSTRY_OPTIONS.map((opt) => opt.toLowerCase()).filter((key) => !edgeKeys.includes(key));
    expect(missing).toEqual([]);
  });

  it("the edge has no steering keys the client no longer offers", () => {
    const client = new Set(INDUSTRY_OPTIONS.map((opt) => opt.toLowerCase()));
    expect(edgeKeys.filter((key) => !client.has(key))).toEqual([]);
  });
});

describe("value-chain segment tables match key-for-key", () => {
  const block = EDGE.match(/INDUSTRY_SEGMENT_STEERING[^=]*=\s*\{([\s\S]*?)\n\};/);

  it("edge segment industries and segments mirror INDUSTRY_SEGMENTS exactly", () => {
    expect(block).toBeTruthy();
    const edgeMap: Record<string, string[]> = {};
    for (const match of block![1].matchAll(/\n {2}"([^"]+)": \{([\s\S]*?)\n {2}\}/g)) {
      edgeMap[match[1]] = [...match[2].matchAll(/\n {4}"([^"]+)":/g)].map((m) => m[1]).sort();
    }
    const clientMap = Object.fromEntries(
      Object.entries(INDUSTRY_SEGMENTS).map(([industry, segments]) => [
        industry.toLowerCase(),
        segments.map((segment) => segment.toLowerCase()).sort(),
      ]),
    );
    expect(edgeMap).toEqual(clientMap);
  });
});

describe("staleness fingerprint algorithm is mirrored byte-compatibly", () => {
  it("the edge hashes the same shape with the same djb2 xor variant", () => {
    // The client derivation (flowShellData.movementInputsFingerprint): key-sorted
    // [key, value] pairs, `_`-prefixed keys excluded, djb2 ((h*33)^c)>>>0, hex.
    expect(EDGE).toMatch(/filter\(\(key\) => !key\.startsWith\("_"\)\)\.sort\(\)/);
    expect(EDGE).toMatch(/hash \* 33\) \^ .*charCodeAt/);
    expect(EDGE).toMatch(/toString\(16\)/);
  });
});

describe("conflicts route to the Inbox (propose-then-confirm)", () => {
  it("atlas-detected contradictions are stripped from the doc and queued as a decision", () => {
    // The stored Atlas never keeps a contradictions section…
    expect(EDGE).toMatch(/delete \(formalResult as Record<string, unknown>\)\.contradictions/);
    // …and what it found queues as a contradictionEntries decision, deduped
    // against any open filing.
    const routing = EDGE.slice(EDGE.indexOf("atlasContradictions.length && isFlowProgramme"));
    expect(routing.slice(0, 1500)).toContain("queueFlowDecision");
    expect(routing.slice(0, 1500)).toContain("contradictionEntries");
  });

  it("the contradiction watcher proposes — one open filing at a time", () => {
    const block = EDGE.slice(EDGE.indexOf('agentId === "contradiction-watcher"') - 500);
    expect(block.slice(0, 2500)).toContain("queueFlowDecision");
    expect(block.slice(0, 2500)).toContain("contradictionEntries");
  });
});

describe("studio document order matches the edge output contracts", () => {
  // Both sides parsed from source: the studio registry names the sections it
  // renders (docOrder); each edge agent's system prompt embeds the JSON
  // template it must emit. Every rendered section must exist in the contract,
  // or the studio typesets keys the generator never produces.
  const STUDIOS = readFileSync(resolve(__dirname, "../components/flow/studio/studios.tsx"), "utf8");
  const entries = [...STUDIOS.matchAll(/"([a-z-]+)": \{ fieldKey: flowFieldKey\("[a-z-]+"\), docOrder: \[([^\]]+)\]/g)]
    .map((match) => [match[1], [...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1])] as const);

  it("the registry parse found every studio with a document order", () => {
    expect(entries.length).toBeGreaterThanOrEqual(12);
  });

  it.each(entries.map(([id, keys]) => ({ id, keys })))(
    "the $id contract emits every section its studio renders",
    ({ id, keys }) => {
      const start = EDGE.search(new RegExp(`\\n {2}"${id}": \\{\\n {4}phase:`));
      expect(start, `edge agent block for ${id}`).toBeGreaterThan(-1);
      const rest = EDGE.slice(start + 4);
      const next = rest.search(/\n {2}"[a-z-]+": \{\n {4}phase:/);
      const block = next > -1 ? rest.slice(0, next) : rest.slice(0, 12000);
      const missing = keys.filter((key) => !block.includes(`"${key}"`));
      expect(missing).toEqual([]);
    },
  );
});

describe("the Discovery Kit guarantees coverage-roster inclusion", () => {
  it("unions every rostered person into the kit's interviews, deterministically", () => {
    // A prompt promise is not a guarantee — the edge must fold the coverage
    // roster into interviews after generation so no known stakeholder is dropped.
    const block = EDGE.slice(EDGE.indexOf('request.agentId === "discovery-kit"'));
    expect(block.slice(0, 2400)).toContain("interviewRoster");
    expect(block.slice(0, 2400)).toContain("present.has(norm(name))");
    expect(block.slice(0, 2400)).toContain("interviews: [...interviews, ...added]");
  });

  it("the kit prompt names the roster as a seed source", () => {
    expect(EDGE).toContain('knownStakeholder');
    expect(EDGE).toMatch(/Every named person on that roster MUST get an interview/);
  });
});
