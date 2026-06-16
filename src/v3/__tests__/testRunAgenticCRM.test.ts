import { normalizeProgram } from "@/new/lib/programData";
import { ATOS_STANDARD } from "@/v3/lib/methodology";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { getMandatoryCriteria } from "@/v3/lib/exitCriteriaLibrary";
import { computePhaseReadiness, getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { derivePhaseMethodologyCompleteness } from "@/v3/lib/phaseMethodologyCompleteness";
import { derivePhaseBlockers } from "@/v3/lib/phaseBlockers";

/**
 * "Test Run" sample use case — build an **agentic CRM** programme and drive it
 * through every ATOS Standard phase to completion, proving along the way that the
 * three live programme-management signals behave as a PM expects:
 *
 *   • RISKS      — open critical/high risks surface as phase blockers; low and
 *                  closed risks do not. An open risk is advisory: it stays visible
 *                  but never hard-stops a gate.
 *   • BLOCKERS   — derivePhaseBlockers aggregates risks, dependencies and the
 *                  readiness model; an unvalidated critical assumption and a
 *                  blocking cross-phase dependency check DO hard-stop the gate, and
 *                  clearing them restores approval.
 *   • ACTIONS    — an under-provisioned phase yields the right recommendedActions
 *                  and cannot pass its gate; resolving the recommended action flips
 *                  the gate to approvable (action → gate coupling).
 *
 * Storage note: assumptions are stored exactly where the app writes them —
 * `data.raidLog.entries`, with a `severity` and (once validated) a `validatedAt`
 * field. The gate's critical-assumption check reads the same normalized
 * `program.raidEntries` that risk/blocker surfacing uses, so the test exercises the
 * real production storage path rather than a parallel key.
 */

const PHASES = ATOS_STANDARD.phases.map((p) => p.id);

/** Required inputs for a phase, each filled with a substantive placeholder. */
function filledInputs(phaseId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fieldDef of getPhaseInputSchema(phaseId).fields) {
    if (!fieldDef.required) continue;
    out[fieldDef.id] =
      fieldDef.type === "grid"
        ? JSON.stringify([{ role: "Programme Director", person: "Jane Smith", org: "PMO" }])
        : `Defined ${fieldDef.label.toLowerCase()} for the agentic CRM build with measurable detail.`;
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
  return { status, phaseId, readinessScore: 95, exitCriteriaStatus: metExitCriteria(phaseId) };
}

interface CrmOpts {
  gateStatuses?: Record<string, "ready" | "approved">;
  /** Phases left empty (no inputs/artifacts/gate) — used to simulate an unstarted phase. */
  skipProvision?: string[];
  /** data.raidLog.entries — the canonical store for all RAID entries (risks,
   *  dependencies and assumptions), feeding normalized program.raidEntries. */
  raidLog?: Array<Record<string, unknown>>;
  /** data.dependencyCheck — persisted cross-phase verdict, a hard gate condition. */
  dependencyCheck?: Record<string, unknown>;
}

/**
 * Build the "Agentic CRM" programme. Every phase is fully provisioned (inputs +
 * artifacts + exit criteria) unless listed in `skipProvision`, so a single phase
 * can be isolated as the one with an outstanding risk/blocker/action.
 */
function buildCrm(opts: CrmOpts = {}) {
  const { gateStatuses = {}, skipProvision = [], raidLog = [], dependencyCheck } = opts;
  const phaseInputs: Record<string, Record<string, string>> = {};
  const phaseArtifacts: Record<string, Record<string, unknown>> = {};
  const gateReviews: Record<string, unknown> = {};
  for (const phaseId of PHASES) {
    if (skipProvision.includes(phaseId)) continue;
    phaseInputs[phaseId] = filledInputs(phaseId);
    phaseArtifacts[phaseId] = presentArtifacts(phaseId);
    gateReviews[phaseId] = readyGate(phaseId, gateStatuses[phaseId] ?? "ready");
  }
  return normalizeProgram({
    id: "agentic-crm",
    name: "Agentic CRM",
    client: "Brillio",
    industry: "Software",
    updated_at: new Date().toISOString(),
    data: {
      objective: "Ship an agentic CRM with autonomous pipeline, enrichment and outreach agents",
      phases: PHASES.map((id) => ({ id, pct: skipProvision.includes(id) ? 0 : 100 })),
      phaseInputs,
      phaseArtifacts,
      gateReviews,
      raidLog: { entries: raidLog, generatedAt: new Date().toISOString() },
      ...(dependencyCheck ? { dependencyCheck } : {}),
    },
  });
}

const risk = (over: Record<string, unknown>) => ({
  type: "risk",
  phase: "strategy",
  status: "open",
  severity: "high",
  description: "",
  mitigation: null,
  ...over,
});

describe("Test Run — Agentic CRM: actions on an under-provisioned phase", () => {
  it("recommends the right next actions and cannot pass its gate", () => {
    const program = buildCrm({ skipProvision: ["strategy"] });
    const readiness = computePhaseReadiness(program, "strategy");

    expect(readiness.canApproveGate).toBe(false);
    expect(readiness.missing).toContain("No artifacts generated yet");
    expect(readiness.missing).toContain("No inputs provided for this phase");

    const actionIds = readiness.recommendedActions.map((a) => a.id);
    expect(actionIds).toContain("run-narrative"); // generate the primary artifact
    expect(actionIds).toContain("add-inputs"); // complete phase inputs
    // Actions are ranked critical-first so the PM sees the blocking work at the top.
    expect(readiness.recommendedActions[0].priority).toBe("critical");
  });
});

describe("Test Run — Agentic CRM: risks behave as expected", () => {
  it("surfaces open critical/high risks as blockers and filters low + closed risks", () => {
    const program = buildCrm({
      raidLog: [
        risk({ id: "crit", title: "LLM hallucinated enrichment data", severity: "critical" }),
        risk({ id: "hi", title: "CRM sync latency", severity: "high" }),
        risk({ id: "lo", title: "Minor UI copy gap", severity: "low" }),
        risk({ id: "done", title: "Resolved data-residency risk", severity: "critical", status: "closed" }),
      ],
    });
    const ids = derivePhaseBlockers(program, "strategy").map((b) => b.id);

    expect(ids).toContain("risk:crit");
    expect(ids).toContain("risk:hi");
    expect(ids).not.toContain("risk:lo"); // low-severity risk is not a blocker
    expect(ids).not.toContain("risk:done"); // closed risk excluded
  });

  it("treats an open risk as advisory — it stays a blocker but does not stop gate approval", () => {
    const program = buildCrm({
      raidLog: [risk({ id: "crit", title: "Outreach agent over-contacts leads", severity: "critical" })],
    });
    const blockerIds = derivePhaseBlockers(program, "strategy").map((b) => b.id);

    // The risk is visible to the PM…
    expect(blockerIds).toContain("risk:crit");
    // …but the gate still approves: risks inform, they don't hard-gate.
    expect(computePhaseReadiness(program, "strategy").canApproveGate).toBe(true);
  });

  it("scopes risks to their own phase — a strategy risk does not block mobilise", () => {
    const program = buildCrm({
      raidLog: [risk({ id: "crit", title: "Pipeline agent mis-scores deals", severity: "critical", phase: "strategy" })],
    });
    expect(derivePhaseBlockers(program, "mobilise").map((b) => b.id)).not.toContain("risk:crit");
  });
});

describe("Test Run — Agentic CRM: blockers hard-stop and then clear", () => {
  // An assumption stored exactly as useRaidLog.addEntry writes it: in
  // data.raidLog.entries, with a `severity` field and no `validatedAt` yet.
  const assumption = (over: Record<string, unknown>) => ({
    type: "assumption",
    phase: "strategy",
    status: "open",
    severity: "critical",
    description: "",
    mitigation: null,
    ...over,
  });

  it("an unvalidated critical assumption blocks the gate and recommends a validate action", () => {
    const program = buildCrm({
      raidLog: [assumption({ id: "asm", title: "Sales team adopts agent suggestions" })],
    });
    const readiness = computePhaseReadiness(program, "strategy");

    expect(readiness.canApproveGate).toBe(false);
    expect(readiness.missing.some((m) => m.includes("critical assumption"))).toBe(true);
    expect(readiness.recommendedActions.map((a) => a.id)).toContain("validate-assumptions");
  });

  it("validating that assumption unblocks the gate (action → gate coupling)", () => {
    // validateAssumption stamps `validatedAt` (and flips status to monitoring) onto
    // the same raidLog entry — the gate keys off the persisted validatedAt flag.
    const validated = buildCrm({
      raidLog: [
        assumption({
          id: "asm",
          title: "Sales team adopts agent suggestions",
          status: "monitoring",
          validatedAt: "2026-06-16T00:00:00.000Z",
        }),
      ],
    });
    const readiness = computePhaseReadiness(validated, "strategy");

    expect(readiness.canApproveGate).toBe(true);
    expect(readiness.missing.some((m) => m.includes("critical assumption"))).toBe(false);
  });

  it("a non-critical (high) assumption does not hard-stop the gate", () => {
    const program = buildCrm({
      raidLog: [assumption({ id: "asm", title: "Data quality is adequate", severity: "high" })],
    });
    expect(computePhaseReadiness(program, "strategy").canApproveGate).toBe(true);
  });

  it("a closed critical assumption does not block — closeEntry never stamps validatedAt", () => {
    const program = buildCrm({
      raidLog: [assumption({ id: "asm", title: "Legacy CRM can be decommissioned", status: "closed" })],
    });
    // status:"closed" with validatedAt still null must not deadlock the gate.
    expect(computePhaseReadiness(program, "strategy").canApproveGate).toBe(true);
  });

  it("a critical assumption is scoped to its own phase — a design assumption does not block strategy", () => {
    const program = buildCrm({
      raidLog: [assumption({ id: "asm", title: "Microservice split is feasible", phase: "design" })],
    });
    expect(computePhaseReadiness(program, "strategy").canApproveGate).toBe(true);
    expect(computePhaseReadiness(program, "design").canApproveGate).toBe(false);
  });

  it("a blocking cross-phase dependency check hard-stops the gate; clearing it restores approval", () => {
    const blocked = buildCrm({
      dependencyCheck: { strategy: { passed: false, issues: [{ severity: "blocking", description: "Charter contradicts the value roadmap" }] } },
    });
    const blockedReadiness = computePhaseReadiness(blocked, "strategy");
    expect(blockedReadiness.canApproveGate).toBe(false);
    expect(blockedReadiness.dependencyCheckPassed).toBe(false);
    expect(blockedReadiness.missing.some((m) => m.includes("dependency check failed"))).toBe(true);

    const cleared = buildCrm({ dependencyCheck: { strategy: { passed: true, issues: [] } } });
    const clearedReadiness = computePhaseReadiness(cleared, "strategy");
    expect(clearedReadiness.canApproveGate).toBe(true);
    expect(clearedReadiness.dependencyCheckPassed).toBe(true);
  });
});

describe("Test Run — Agentic CRM: full methodology completion", () => {
  it("covers all nine ATOS Standard phases", () => {
    expect(PHASES).toEqual([
      "strategy", "mobilise", "discover", "design", "build",
      "operate", "govern", "optimize", "valuerealize",
    ]);
  });

  it.each(PHASES)("phase %s reaches gate-approvable readiness and is methodologically complete", (phaseId) => {
    const program = buildCrm(); // every phase provisioned, all gates "ready" → genuine scoring
    const readiness = computePhaseReadiness(program, phaseId);
    expect(readiness.canApproveGate).toBe(true);
    expect(readiness.score).toBeGreaterThanOrEqual(readiness.threshold);
    expect(readiness.mandatoryExitsPassing).toBe(true);

    const completeness = derivePhaseMethodologyCompleteness(program, phaseId);
    expect(completeness).not.toBeNull();
    expect(completeness!.complete).toBe(true);
    expect(completeness!.pct).toBe(100);
  });

  it.each(PHASES)("phase %s has no fabricated risk or dependency blockers when none exist", (phaseId) => {
    const blockers = derivePhaseBlockers(buildCrm(), phaseId);
    expect(blockers.some((b) => b.category === "risk")).toBe(false);
    expect(blockers.some((b) => b.category === "dependency")).toBe(false);
  });

  it("approving each gate in sequence unlocks the following phase without skipping ahead", () => {
    for (let i = 0; i < PHASES.length - 1; i += 1) {
      const gateStatuses: Record<string, "ready" | "approved"> = {};
      for (let j = 0; j <= i; j += 1) gateStatuses[PHASES[j]] = "approved";
      const locked = getLockedPhaseIds(buildCrm({ gateStatuses }));
      expect(locked.has(PHASES[i + 1])).toBe(false);
      const skipAhead = PHASES[i + 3];
      if (skipAhead) expect(locked.has(skipAhead)).toBe(true);
    }
  });

  it("a fully approved programme leaves no phase locked and the final gate approvable", () => {
    const allApproved: Record<string, "ready" | "approved"> = {};
    for (const id of PHASES) allApproved[id] = "approved";
    const program = buildCrm({ gateStatuses: allApproved });
    expect(getLockedPhaseIds(program).size).toBe(0);
    expect(computePhaseReadiness(program, "valuerealize").canApproveGate).toBe(true);
  });
});
