import { normalizeProgram } from "@/new/lib/programData";
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";
import { computePhaseReadiness, getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { derivePhaseMethodologyCompleteness } from "@/v3/lib/phaseMethodologyCompleteness";

/**
 * Sample-use-case contract: a single programme ("Orion ERP rollout") is driven
 * through every ATOS Standard phase. For each phase this proves the methodology
 * actually completes on the real selectors a PM relies on:
 *   • the phase becomes gate-approvable (computePhaseReadiness.canApproveGate)
 *     via the genuine scoring path — not the approved fast-path;
 *   • the phase is methodologically complete (every required input, artifact and
 *     mandatory exit criterion satisfied) on the one surface that reconciles them;
 *   • approving each gate in sequence unlocks the next phase and never skips ahead.
 */

const PHASES = ATOS_STANDARD.phases.map((p) => p.id);

/** Required inputs for a phase, each filled with a substantive placeholder. */
function filledInputs(phaseId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of getPhaseInputSchema(phaseId).fields) {
    if (!field.required) continue;
    out[field.id] =
      field.type === "grid"
        ? JSON.stringify([{ role: "Programme Director", person: "Jane Smith", org: "PMO" }])
        : `Defined ${field.label.toLowerCase()} for the Orion ERP rollout with measurable detail.`;
  }
  return out;
}

/** Required artifacts present, approved, high confidence. */
function presentArtifacts(phaseId: string): Record<string, unknown> {
  const phaseDef = ATOS_STANDARD.phases.find((p) => p.id === phaseId)!;
  const bucket: Record<string, unknown> = {};
  for (const agentId of phaseDef.requiredArtifacts) {
    bucket[agentId] = { confidence: 0.95, status: "approved", agentDrafted: true, title: agentId };
  }
  return bucket;
}

/** All mandatory exit criteria marked met. */
function metExitCriteria(phaseId: string) {
  return getMandatoryCriteria(phaseId).map((c) => ({ criterion: c.label, met: true, evidence: "validated" }));
}

/** A gate review that satisfies every hard gate condition for `phaseId`. */
function readyGate(phaseId: string, status: "ready" | "approved" = "ready") {
  return {
    status,
    phaseId,
    readinessScore: 95,
    exitCriteriaStatus: metExitCriteria(phaseId),
  };
}

/**
 * Build the Orion programme with `gateStatuses` per phase and every phase fully
 * provisioned (inputs + artifacts + exit criteria), so readiness and completeness
 * can be asserted phase-by-phase.
 */
function buildProgram(gateStatuses: Record<string, "ready" | "approved">) {
  const phaseInputs: Record<string, Record<string, string>> = {};
  const phaseArtifacts: Record<string, Record<string, unknown>> = {};
  const gateReviews: Record<string, unknown> = {};
  for (const phaseId of PHASES) {
    phaseInputs[phaseId] = filledInputs(phaseId);
    phaseArtifacts[phaseId] = presentArtifacts(phaseId);
    gateReviews[phaseId] = readyGate(phaseId, gateStatuses[phaseId] ?? "ready");
  }
  return normalizeProgram({
    id: "orion",
    name: "Orion ERP rollout",
    client: "Acme",
    industry: "Manufacturing",
    updated_at: new Date().toISOString(),
    data: {
      phases: PHASES.map((id) => ({ id, pct: 100 })),
      phaseInputs,
      phaseArtifacts,
      gateReviews,
    },
  });
}

describe("ATOS sample use case — every phase completes", () => {
  it("covers all nine ATOS Standard phases", () => {
    expect(PHASES).toEqual([
      "strategy", "mobilise", "discover", "design", "build",
      "operate", "govern", "optimize", "valuerealize",
    ]);
  });

  it.each(PHASES)("phase %s reaches gate-approvable readiness (real scoring path)", (phaseId) => {
    const program = buildProgram({}); // all gates "ready" → genuine computation, no fast-path
    const readiness = computePhaseReadiness(program, phaseId);
    expect(readiness.canApproveGate).toBe(true);
    expect(readiness.score).toBeGreaterThanOrEqual(readiness.threshold);
    expect(readiness.mandatoryExitsPassing).toBe(true);
  });

  it.each(PHASES)("phase %s is methodologically complete (inputs + artifacts + exit criteria)", (phaseId) => {
    const program = buildProgram({});
    const completeness = derivePhaseMethodologyCompleteness(program, phaseId);
    expect(completeness).not.toBeNull();
    expect(completeness!.complete).toBe(true);
    expect(completeness!.pct).toBe(100);
    // Every requirement group present === total.
    for (const group of completeness!.groups) {
      expect(group.present).toBe(group.total);
    }
  });
});

describe("ATOS sample use case — gate progression unlocks phases in order", () => {
  it("with no gates approved, only the frontier (next) phase is reachable", () => {
    const program = buildProgram({});
    const locked = getLockedPhaseIds(program);
    // strategy (current) and mobilise (frontier) open; everything beyond locked.
    expect(locked.has("strategy")).toBe(false);
    expect(locked.has("mobilise")).toBe(false);
    expect(locked.has("discover")).toBe(true);
    expect(locked.has("valuerealize")).toBe(true);
  });

  it("approving each gate in sequence unlocks the following phase without skipping ahead", () => {
    for (let i = 0; i < PHASES.length - 1; i += 1) {
      const gateStatuses: Record<string, "ready" | "approved"> = {};
      for (let j = 0; j <= i; j += 1) gateStatuses[PHASES[j]] = "approved";
      const program = buildProgram(gateStatuses);
      const locked = getLockedPhaseIds(program);
      const nextPhase = PHASES[i + 1];
      expect(locked.has(nextPhase)).toBe(false);
      // A phase two steps beyond the last approval must stay locked (no skipping).
      const skipAhead = PHASES[i + 3];
      if (skipAhead) expect(locked.has(skipAhead)).toBe(true);
    }
  });

  it("a fully approved programme leaves no phase locked and the final gate approvable", () => {
    const allApproved: Record<string, "ready" | "approved"> = {};
    for (const id of PHASES) allApproved[id] = "approved";
    const program = buildProgram(allApproved);
    expect(getLockedPhaseIds(program).size).toBe(0);
    const finalReadiness = computePhaseReadiness(program, "valuerealize");
    expect(finalReadiness.canApproveGate).toBe(true);
  });
});
