import { describe, it, expect } from "vitest";
import { normalizeProgram } from "@/new/lib/programData";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";

/**
 * Confidence-calculation validity under the dynamic-schema model.
 *
 * Strategy, Mobilise, Discover, Design and Build carry static input schemas; the
 * remaining phases are dynamic-only, so `derivePhaseInputQuality` returns null for
 * them (no static fields to assess). `deriveProgramConfidence` must therefore
 * degrade gracefully on a dynamic phase — falling back to the readiness-derived
 * inputScore and the data-driven gate readiness — rather than emitting NaN or a
 * permanently dead 0. These tests pin that the headline confidence remains
 * numerically sound and still responds to real inputs/artifacts on a dynamic
 * phase (Operate), which is what the executive-summary header renders.
 */

const PHASE_IDS = [
  "strategy", "mobilise", "discover", "design", "build",
  "operate", "govern", "optimize", "valuerealize",
];

function programOnOperate(over: { inputs?: Record<string, unknown>; artifacts?: Record<string, unknown> } = {}) {
  return normalizeProgram({
    id: "crm",
    name: "Agentic CRM",
    client: "Brillio",
    industry: "Software",
    updated_at: new Date().toISOString(),
    data: {
      phases: PHASE_IDS.map((id) => ({ id, pct: 0 })),
      phaseInputs: over.inputs ? { operate: over.inputs } : {},
      phaseArtifacts: over.artifacts ? { operate: over.artifacts } : {},
      gateReviews: {},
    },
  });
}

describe("deriveProgramConfidence under dynamic-only phases", () => {
  it("operate carries no static input schema, so input quality is null", () => {
    expect(derivePhaseInputQuality("operate", {})).toBeNull();
  });

  it("produces a numerically valid score with no NaN signals on a bare dynamic phase", () => {
    const conf = deriveProgramConfidence(programOnOperate(), "operate");
    expect(Number.isFinite(conf.score)).toBe(true);
    expect(conf.score).toBeGreaterThanOrEqual(0);
    expect(conf.score).toBeLessThanOrEqual(100);
    for (const value of Object.values(conf.breakdown)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // Nothing produced yet → input completeness resolves to 0 via the fallback,
    // not NaN from the absent static schema.
    expect(conf.breakdown.inputCompleteness).toBe(0);
  });

  it("counts filled dynamic inputs via the readiness fallback (input quality is null)", () => {
    const filled = {
      supportModel: "Run tier-2 support during hyper-care with a small on-call rota, then hand to ops with a runbook and mandatory incident review before close.",
      adoptionPlan: "Drive adoption through role-based enablement and weekly usage reviews, respecting strict tenant data isolation across every deployed region.",
    };
    // The static-schema path yields nothing for a dynamic phase…
    expect(derivePhaseInputQuality("operate", filled)).toBeNull();
    // …but the confidence input signal still rises from the actual stored inputs.
    const conf = deriveProgramConfidence(programOnOperate({ inputs: filled }), "operate");
    expect(conf.breakdown.inputCompleteness).toBeGreaterThan(0);
  });

  it("reflects produced dynamic artifacts in gate readiness", () => {
    const bare = deriveProgramConfidence(programOnOperate(), "operate").breakdown.gateReadiness;
    const withArtifact = deriveProgramConfidence(
      programOnOperate({ artifacts: { "operate-primary": { confidence: 0.95, status: "approved" } } }),
      "operate",
    ).breakdown.gateReadiness;
    expect(withArtifact).toBeGreaterThan(bare);
  });
});
