import { describe, it, expect } from "vitest";
import { normalizeProgram } from "@/new/lib/programData";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { derivePhaseInputQuality } from "@/v3/lib/phaseInputQuality";

/**
 * Confidence-calculation validity under the dynamic-schema model.
 *
 * Strategy and Design carry static input schemas; the remaining phases are
 * dynamic-only, so `derivePhaseInputQuality` returns null for them (no static
 * fields to assess). `deriveProgramConfidence` must therefore degrade
 * gracefully on a dynamic phase — falling back to the readiness-derived
 * inputScore and the data-driven gate readiness — rather than emitting NaN or a
 * permanently dead 0. These tests pin that the headline confidence remains
 * numerically sound and still responds to real inputs/artifacts on a dynamic
 * phase (Build), which is what the executive-summary header renders.
 */

const PHASE_IDS = [
  "strategy", "mobilise", "discover", "design", "build",
  "operate", "govern", "optimize", "valuerealize",
];

function programOnBuild(over: { inputs?: Record<string, unknown>; artifacts?: Record<string, unknown> } = {}) {
  return normalizeProgram({
    id: "crm",
    name: "Agentic CRM",
    client: "Brillio",
    industry: "Software",
    updated_at: new Date().toISOString(),
    data: {
      phases: PHASE_IDS.map((id) => ({ id, pct: 0 })),
      phaseInputs: over.inputs ? { build: over.inputs } : {},
      phaseArtifacts: over.artifacts ? { build: over.artifacts } : {},
      gateReviews: {},
    },
  });
}

describe("deriveProgramConfidence under dynamic-only phases", () => {
  it("build carries no static input schema, so input quality is null", () => {
    expect(derivePhaseInputQuality("build", {})).toBeNull();
  });

  it("produces a numerically valid score with no NaN signals on a bare dynamic phase", () => {
    const conf = deriveProgramConfidence(programOnBuild(), "build");
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
      modelRouting: "Route enrichment to a small model and outreach drafting to a larger model with guardrails and mandatory human review before send.",
      designConstraints: "Must integrate with the existing Salesforce instance and respect strict tenant data isolation across every deployed region.",
    };
    // The static-schema path yields nothing for a dynamic phase…
    expect(derivePhaseInputQuality("build", filled)).toBeNull();
    // …but the confidence input signal still rises from the actual stored inputs.
    const conf = deriveProgramConfidence(programOnBuild({ inputs: filled }), "build");
    expect(conf.breakdown.inputCompleteness).toBeGreaterThan(0);
  });

  it("reflects produced dynamic artifacts in gate readiness", () => {
    const bare = deriveProgramConfidence(programOnBuild(), "build").breakdown.gateReadiness;
    const withArtifact = deriveProgramConfidence(
      programOnBuild({ artifacts: { "build-primary": { confidence: 0.95, status: "approved" } } }),
      "build",
    ).breakdown.gateReadiness;
    expect(withArtifact).toBeGreaterThan(bare);
  });
});
