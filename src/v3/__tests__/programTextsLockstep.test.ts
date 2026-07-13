import { describe, it, expect } from "vitest";
import * as client from "@/v3/lib/programTexts";
// The edge keeps its own Deno copy of the split/merge core. It MUST behave
// identically to the client's, since the client splits on write and the edge
// merges on read (and splits its own writes under cutover). This test imports
// both and asserts parity so the two copies can't silently drift.
import * as edge from "../../../supabase/functions/_shared/programTexts";

const big = "y ".repeat(client.MIN_EXTERNAL_LEN);

const sample = () => ({
  objective: "x",
  phaseInputs: {
    frame: { sponsor: "Raj", sponsorConversation: big },
    listen: { interviewTranscripts: big + "L", contradictionLog: "[]" },
  },
});

describe("client ↔ edge programTexts parity", () => {
  it("exposes the same field set and threshold", () => {
    expect([...edge.EXTERNALIZED_FIELD_NAMES].sort()).toEqual([...client.EXTERNALIZED_FIELD_NAMES].sort());
    expect(edge.MIN_EXTERNAL_LEN).toBe(client.MIN_EXTERNAL_LEN);
  });

  it("split produces identical extracted texts and shrunk blob", () => {
    const c = client.splitExternalTexts(sample());
    const e = edge.splitExternalTexts(sample());
    expect(e.texts).toEqual(c.texts);
    expect(e.inner).toEqual(c.inner);
  });

  it("edge merge reverses a client split (cross-implementation round trip)", () => {
    const original = sample();
    const { inner, texts } = client.splitExternalTexts(original);
    const restored = edge.mergeExternalTexts(inner, texts);
    expect(restored).toEqual(original);
  });

  it("client merge reverses an edge split", () => {
    const original = sample();
    const { inner, texts } = edge.splitExternalTexts(original);
    const restored = client.mergeExternalTexts(inner, texts);
    expect(restored).toEqual(original);
  });
});

describe("edge resolvePhaseInputsContainer", () => {
  it("returns the blob itself for flat programmes", () => {
    const flat = sample();
    expect(edge.resolvePhaseInputsContainer(flat)).toBe(flat);
  });

  it("returns the nested inner for nested-data programmes", () => {
    const nested = { data: sample(), _meta: 1 };
    expect(edge.resolvePhaseInputsContainer(nested)).toBe(nested.data);
  });

  it("returns null for a non-object", () => {
    expect(edge.resolvePhaseInputsContainer(null)).toBeNull();
    expect(edge.resolvePhaseInputsContainer("nope")).toBeNull();
  });
});
