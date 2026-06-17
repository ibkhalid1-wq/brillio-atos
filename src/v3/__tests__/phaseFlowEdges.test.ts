import { derivePhaseFlowEdges } from "@/v3/lib/phaseFlowEdges";
import { getPhaseArtifactIds } from "@/v3/lib/phaseArtifacts";
import { PHASE_INPUT_SCHEMAS } from "@/v3/lib/phaseInputSchema";

describe("derivePhaseFlowEdges", () => {
  it("wires every field to the Narrative as its first edge", () => {
    const edges = derivePhaseFlowEdges("mobilise", ["programDirector", "teamSize"]);
    expect(edges.filter((e) => e.from === "programDirector")[0]).toEqual({ from: "programDirector", to: "narrative" });
    expect(edges.some((e) => e.from === "teamSize" && e.to === "narrative")).toBe(true);
  });

  it("adds declared phase-specific targets (e.g. governance model) without duplicating", () => {
    const edges = derivePhaseFlowEdges("mobilise", ["governanceModel"]);
    expect(edges).toEqual([
      { from: "governanceModel", to: "narrative" },
      { from: "governanceModel", to: "governance-model" },
    ]);
  });

  it("falls back to Narrative-only for unmapped fields and phases", () => {
    expect(derivePhaseFlowEdges("mobilise", ["unmappedField"])).toEqual([{ from: "unmappedField", to: "narrative" }]);
    expect(derivePhaseFlowEdges("unknown-phase", ["whatever"])).toEqual([{ from: "whatever", to: "narrative" }]);
  });

  it("wires methodology-declared flow fields (e.g. keyRisks) to their artifacts", () => {
    expect(derivePhaseFlowEdges("mobilise", ["keyRisks"])).toEqual([
      { from: "keyRisks", to: "narrative" },
      { from: "keyRisks", to: "plan" },
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
