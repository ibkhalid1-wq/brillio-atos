import { derivePhaseFlowEdges } from "@/v3/lib/phaseFlowEdges";
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { PHASE_INPUT_SCHEMAS } from "@/v3/lib/phaseInputSchema";

// Strategy is the only static phase (narrative + a hand-declared field→artifact
// map + methodology artifactInputFlow), so the narrative-first / static-target
// behaviour is asserted there. Every later phase is dynamic-only: its edges come
// entirely from the programme's dynamicSchema store (covered in dynamicSchema.test.ts),
// so without a store a dynamic phase yields no edges at all.
describe("derivePhaseFlowEdges", () => {
  it("wires every field to the Narrative as its first edge", () => {
    const edges = derivePhaseFlowEdges("strategy", ["businessObjective", "sponsor"]);
    expect(edges.filter((e) => e.from === "businessObjective")[0]).toEqual({ from: "businessObjective", to: "narrative" });
    expect(edges.some((e) => e.from === "sponsor" && e.to === "narrative")).toBe(true);
  });

  it("adds declared phase-specific targets (e.g. charter) without duplicating", () => {
    const edges = derivePhaseFlowEdges("strategy", ["sponsor"]);
    expect(edges).toEqual([
      { from: "sponsor", to: "narrative" },
      { from: "sponsor", to: "charter" },
    ]);
  });

  it("falls back to Narrative-only for an unmapped field on a static phase", () => {
    expect(derivePhaseFlowEdges("strategy", ["unmappedField"])).toEqual([{ from: "unmappedField", to: "narrative" }]);
  });

  it("yields no edges for a dynamic-only phase or unknown phase without a store", () => {
    // Narrative is no longer guaranteed, so a phase with no resolvable artifacts
    // (no store, empty artifact set) produces nothing rather than a dangling edge.
    expect(derivePhaseFlowEdges("mobilise", ["governanceModel"])).toEqual([]);
    expect(derivePhaseFlowEdges("unknown-phase", ["whatever"])).toEqual([]);
  });

  it("wires methodology-declared flow fields (e.g. industry) to their artifacts", () => {
    expect(derivePhaseFlowEdges("strategy", ["industry"])).toEqual([
      { from: "industry", to: "narrative" },
      { from: "industry", to: "charter" },
      { from: "industry", to: "business-case" },
    ]);
  });

  it("only ever targets artifacts that exist in the phase's artifact set", () => {
    for (const phaseId of Object.keys(PHASE_INPUT_SCHEMAS)) {
      const valid = new Set<string>(getPhaseArtifactIds(phaseId));
      const fieldIds = PHASE_INPUT_SCHEMAS[phaseId].fields.map((f) => f.id);
      for (const edge of derivePhaseFlowEdges(phaseId, fieldIds)) {
        expect(valid.has(edge.to)).toBe(true);
      }
    }
  });
});
