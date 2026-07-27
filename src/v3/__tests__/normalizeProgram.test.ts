import { normalizeProgram } from "@/new/lib/programData";

describe("normalizeProgram", () => {
  const baseRow = {
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: { methodology: "atos-standard",
      projectMeta: { name: "ERP Transformation" },
      objective: "Modernize finance operations",
      phases: [
        { id: "strategy", pct: 100 },
        { id: "mobilise", pct: 40 },
        { id: "discover", pct: 0 },
      ],
      // Strategy's gate is approved, so the programme has moved past it — the
      // current (frontier) phase is the first one whose gate is NOT yet approved.
      gateReviews: {
        strategy: { status: "approved", readinessScore: 0.95 },
      },
    },
  };

  it("derives activePhaseId from the gate frontier (first unapproved gate)", () => {
    const program = normalizeProgram(baseRow);
    expect(program.activePhaseId).toBe("mobilise");
  });

  it("keeps a phase current until its gate is approved, even at 100% inputs", () => {
    // No gate approved anywhere: strategy stays the frontier despite 100% pct,
    // because advancing requires gate approval, not just complete inputs.
    const program = normalizeProgram({
      ...baseRow,
      data: { ...baseRow.data, gateReviews: {} },
    });
    expect(program.activePhaseId).toBe("strategy");
  });

  it("handles empty phases without throwing", () => {
    const program = normalizeProgram({
      ...baseRow,
      data: { methodology: "atos-standard", objective: "", phases: [] },
    });
    expect(program.phases.length).toBeGreaterThan(0);
    expect(program.activePhaseId).toBeTruthy();
  });

  it("honours phasePct when data.phases is empty (partial-recovery case)", () => {
    // AURA-Validation-style program: the phases[] array was lost but the agent's
    // phasePct estimate survived. Completion must come through, not default to 0.
    const program = normalizeProgram({
      ...baseRow,
      data: { methodology: "atos-standard",
        objective: "Recovered program",
        narrative: "Grounded narrative so agent output is detected",
        phases: [],
        phasePct: { strategy: 10, mobilise: 10, build: 10, discover: 0 },
      },
    });
    const byId = Object.fromEntries(program.phases.map((phase) => [phase.id, phase]));
    expect(byId.strategy.pct).toBe(10);
    expect(byId.mobilise.pct).toBe(10);
    expect(byId.build.pct).toBe(10);
    expect(byId.strategy.status).not.toBe("inactive");
    expect(byId.discover.pct).toBe(0);
    expect(byId.discover.status).toBe("inactive");
  });

  it("does not resurrect phasePct without agent output", () => {
    // Fresh program with no narrative/plan/deck: phasePct is treated as untrusted
    // init noise, so completion stays 0 (guards the fresh-program case).
    const program = normalizeProgram({
      ...baseRow,
      data: { methodology: "atos-standard",
        objective: "Fresh program",
        phases: [],
        phasePct: { strategy: 80 },
      },
    });
    const strategy = program.phases.find((phase) => phase.id === "strategy");
    expect(strategy?.pct).toBe(0);
  });

  it("returns stable output for the same input", () => {
    const first = normalizeProgram(baseRow);
    const second = normalizeProgram(baseRow);
    expect(second).toEqual(first);
  });

  it("surfaces resolved-decision audit fields onto decisionQueue", () => {
    // The Decision Audit screen reads these straight off program.decisionQueue,
    // so the resolution stamp must survive normalization.
    const program = normalizeProgram({
      ...baseRow,
      data: {
        ...baseRow.data,
        decisionQueue: [
          {
            id: "dec-1",
            title: "Approve vendor shortlist",
            phaseId: "mobilise",
            status: "approved",
            resolvedAt: "2026-06-15T10:00:00.000Z",
            resolvedBy: "lead@acme.com",
            humanNote: "Aligned with sourcing policy",
          },
        ],
      },
    });
    const decided = program.decisionQueue.find((d) => d.id === "dec-1");
    expect(decided?.status).toBe("approved");
    expect(decided?.resolvedAt).toBe("2026-06-15T10:00:00.000Z");
    expect(decided?.resolvedBy).toBe("lead@acme.com");
    expect(decided?.humanNote).toBe("Aligned with sourcing policy");
  });
});
