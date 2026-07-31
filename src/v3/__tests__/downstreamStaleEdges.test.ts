/**
 * The regeneration cascade, read out of the edge function's own graph.
 *
 * run-agent persists artifacts server-side; the client only receives a realtime
 * update and never runs a save path for a generation. So the cascade has to
 * live there, and it inverts UPSTREAM_ARTIFACT_DEPS — the map that already
 * pulls upstream bodies into the generation context. That map is authoritative
 * because generation visibly breaks if it is wrong, which is the property a
 * second hand-maintained graph would not have.
 *
 * This test EXTRACTS the real map from the deployed source, so an edit that
 * drops an edge fails here rather than in a live programme.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

/** Parse UPSTREAM_ARTIFACT_DEPS out of the edge source. */
const DEPS: Record<string, string[]> = (() => {
  const start = SRC.indexOf("const UPSTREAM_ARTIFACT_DEPS");
  const body = SRC.slice(start, SRC.indexOf("\n};", start));
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
    out[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return out;
})();

/** Everything that consumes the given artifact — the inversion the cascade uses. */
const consumersOf = (fieldKey: string) =>
  Object.entries(DEPS).filter(([, deps]) => deps.includes(fieldKey)).map(([k]) => k).sort();

describe("downstream staleness edges", () => {
  it("the map parsed", () => {
    expect(Object.keys(DEPS).length).toBeGreaterThan(5);
  });

  it("the Charter is upstream of the kit and the ontology", () => {
    expect(consumersOf("transformationCharter")).toEqual(["discoveryKit", "domainOntology"]);
  });

  it("the Discovery Kit stales the ontology and the atlas", () => {
    expect(consumersOf("discoveryKit")).toEqual(["currentStateAtlas", "domainOntology"]);
  });

  it("the ontology stales the atlas and the Prototype documents", () => {
    const c = consumersOf("domainOntology");
    for (const expected of ["currentStateAtlas", "architectureStrategy", "experienceDesign", "agenticBlueprint"]) {
      expect(c).toContain(expected);
    }
  });

  it("the atlas stales the Prototype documents", () => {
    const c = consumersOf("currentStateAtlas");
    for (const expected of ["architectureStrategy", "experienceDesign"]) expect(c).toContain(expected);
  });

  it("no artifact declares itself as its own upstream", () => {
    for (const [key, deps] of Object.entries(DEPS)) expect(deps).not.toContain(key);
  });

  it("the cascade is wired into the persist path", () => {
    // Staling downstream must happen where the artifact is written, or a
    // regeneration lands with every consumer still claiming to be fresh.
    expect(SRC).toContain("function staleDownstreamArtifacts(");
    expect(SRC).toContain("nextProgramData = staleDownstreamArtifacts(nextProgramData, spec.fieldKey);");
  });

  it("an already-stale or archived consumer is left alone", () => {
    const fn = SRC.slice(SRC.indexOf("function staleDownstreamArtifacts("));
    expect(fn.slice(0, 2000)).toContain('status === "archived" || status === "stale"');
  });
});
