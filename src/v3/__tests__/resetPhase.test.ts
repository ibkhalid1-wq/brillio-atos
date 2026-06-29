import { resetPhaseInner } from "@/new/lib/useGateReview";

function makeInner() {
  return {
    phaseInputs: { mobilise: { coreTeamRoster: [["Jane", "PM"]] }, strategy: { objective: "x" } },
    phaseArtifacts: { mobilise: { charter: "generated" } },
    gateReviews: { mobilise: { phaseId: "mobilise", status: "approved" } },
    phasePct: { mobilise: 80, strategy: 100 },
    dependencyCheck: { mobilise: { ok: false } },
    raciGaps: { mobilise: ["sponsor"] },
    decisionQueue: [
      { id: "d1", phaseId: "mobilise", title: "Approve roster" },
      { id: "d2", phaseId: "strategy", title: "Keep me" },
    ],
    humanNotes: [
      { id: "n1", phaseId: "mobilise", text: "drop me" },
      { id: "n2", phaseId: "strategy", text: "keep me" },
    ],
    raidLog: { entries: [{ id: "r1", type: "risk", phase: "mobilise", status: "open" }] },
    dynamicSchema: {
      inputFields: {
        mobilise: [{ id: "coreTeamRoster", label: "Named individuals per core team role", type: "grid" }],
      },
      artifacts: { mobilise: [{ id: "charter" }] },
    },
  } as Record<string, unknown>;
}

describe("resetPhaseInner", () => {
  it("clears the target phase's captured working data", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.phaseInputs.mobilise).toBeUndefined();
    expect(out.phaseArtifacts.mobilise).toBeUndefined();
    expect(out.gateReviews.mobilise).toBeUndefined();
    expect(out.phasePct.mobilise).toBeUndefined();
    expect(out.dependencyCheck.mobilise).toBeUndefined();
    expect(out.raciGaps.mobilise).toBeUndefined();
  });

  it("preserves the seeded scaffolding — suggested roles must survive a reset", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.dynamicSchema).toBeDefined();
    expect(out.dynamicSchema.inputFields.mobilise).toHaveLength(1);
    expect(out.dynamicSchema.inputFields.mobilise[0].id).toBe("coreTeamRoster");
    expect(out.dynamicSchema.artifacts.mobilise).toHaveLength(1);
  });

  it("leaves other phases and the RAID log untouched", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.phaseInputs.strategy).toEqual({ objective: "x" });
    expect(out.phasePct.strategy).toBe(100);
    expect((out.raidLog as any).entries).toHaveLength(1);
  });

  it("removes only the phase's own decision-queue and human-note entries", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.decisionQueue.map((d: any) => d.id)).toEqual(["d2"]);
    expect(out.humanNotes.map((n: any) => n.id)).toEqual(["n2"]);
  });
});
