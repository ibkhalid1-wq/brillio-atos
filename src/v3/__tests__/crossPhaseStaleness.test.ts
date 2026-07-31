/**
 * Regenerating an upstream deliverable stales what was built on it.
 *
 * crossPhaseArtifactsToStale discovers dependencies from a later phase's
 * `artifact-reference` input fields. It is correct, tested, and had never fired
 * once: `artifact-reference` exists in the codebase only as a member of a type
 * union — no phase declares a field of that type — so the engine ran with a
 * permanently empty input. Regenerating Frame's Discovery Kit left Listen's
 * documents claiming to be fresh.
 *
 * The edges are now DECLARED by artifact id.
 */
import { describe, expect, it } from "vitest";
import { crossPhaseArtifactsToStale, declaredCrossPhaseTargets, CROSS_PHASE_ARTIFACT_DEPS } from "@/v3/lib/artifactStaleness";

const buckets = () => ({
  frame: { "charter": { status: "approved" }, "discovery-kit": { status: "approved" } },
  listen: { "discovery-kit": { status: "approved" }, "domain-ontology": { status: "approved" }, "current-state-atlas": { status: "draft" } },
  prototype: { "architecture-strategy": { status: "approved" }, "experience-design": { status: "draft" }, "agentic-blueprint": { status: "approved" } },
});
const ids = (t: Array<{ phaseId: string; artifactId: string }>) => t.map((x) => `${x.phaseId}/${x.artifactId}`).sort();

describe("cross-phase staleness", () => {
  it("the Charter stales all three Listen documents", () => {
    expect(ids(crossPhaseArtifactsToStale("frame", ["charter"], buckets()))).toEqual([
      "listen/current-state-atlas", "listen/discovery-kit", "listen/domain-ontology",
    ]);
  });

  it("the Discovery Kit stales the ontology and the atlas", () => {
    expect(ids(crossPhaseArtifactsToStale("frame", ["discovery-kit"], buckets()))).toEqual([
      "listen/current-state-atlas", "listen/domain-ontology",
    ]);
  });

  it("the ontology stales the Prototype build documents", () => {
    expect(ids(crossPhaseArtifactsToStale("listen", ["domain-ontology"], buckets()))).toEqual([
      "prototype/agentic-blueprint", "prototype/architecture-strategy", "prototype/experience-design",
    ]);
  });

  it("the atlas stales them too", () => {
    expect(ids(crossPhaseArtifactsToStale("listen", ["current-state-atlas"], buckets()))).toEqual([
      "prototype/agentic-blueprint", "prototype/architecture-strategy", "prototype/experience-design",
    ]);
  });

  it("both together do not double-report a target", () => {
    const out = crossPhaseArtifactsToStale("listen", ["domain-ontology", "current-state-atlas"], buckets());
    expect(out).toHaveLength(new Set(ids(out)).size);
  });

  it("never stales inside the origin phase", () => {
    // frame/discovery-kit must not stale listen's own kit entry via the frame
    // origin — and nothing in frame itself.
    const out = crossPhaseArtifactsToStale("frame", ["charter"], buckets());
    expect(out.every((t) => t.phaseId !== "frame")).toBe(true);
  });

  it("skips a target already stale or archived", () => {
    const b = buckets() as Record<string, Record<string, { status: string }>>;
    b.listen["domain-ontology"].status = "stale";
    b.listen["current-state-atlas"].status = "archived";
    expect(ids(crossPhaseArtifactsToStale("frame", ["discovery-kit"], b))).toEqual([]);
  });

  it("skips a target the programme does not have", () => {
    expect(declaredCrossPhaseTargets(["domain-ontology"], { prototype: {} })).toEqual([]);
  });

  it("an artifact with no declared downstream stales nothing", () => {
    expect(crossPhaseArtifactsToStale("ship", ["runbook"], buckets())).toEqual([]);
  });

  it("every declared target names a real upstream artifact id", () => {
    // Guards the map against a typo silently disabling an edge.
    const known = new Set(["charter", "discovery-kit", "domain-ontology", "current-state-atlas"]);
    for (const key of Object.keys(CROSS_PHASE_ARTIFACT_DEPS)) expect(known.has(key)).toBe(true);
  });
});
