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
