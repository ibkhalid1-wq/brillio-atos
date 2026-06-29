import { resetPhaseInner } from "@/new/lib/useGateReview";

function makeInner() {
  return {
    phaseInputs: { mobilise: { coreTeamRoster: [["Programme Manager", ""], ["Product Owner", ""]] }, strategy: { objective: "x" } },
    phaseArtifacts: { mobilise: { charter: "generated" }, strategy: { vision: "kept" } },
    gateReviews: { mobilise: { phaseId: "mobilise", status: "approved" }, strategy: { phaseId: "strategy", status: "approved" } },
    phasePct: { mobilise: 80, strategy: 100 },
    dependencyCheck: { mobilise: { ok: false } },
    raciGaps: { mobilise: ["sponsor"] },
    decisionQueue: [
      { id: "d1", phaseId: "mobilise", title: "Approve roster" },
      { id: "d2", phaseId: "strategy", title: "Keep me" },
    ],
    humanNotes: [{ id: "n1", phaseId: "mobilise", text: "keep me" }],
    raidLog: { entries: [{ id: "r1", type: "risk", phase: "mobilise", status: "open" }] },
    dynamicSchema: {
      inputFields: {
        mobilise: [{ id: "coreTeamRoster", label: "Named individuals per core team role", type: "grid" }],
      },
    },
  } as Record<string, unknown>;
}

describe("resetPhaseInner", () => {
  it("clears the target phase's generated outputs and gate state", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.phaseArtifacts.mobilise).toBeUndefined();
    expect(out.gateReviews.mobilise).toBeUndefined();
    expect(out.phasePct.mobilise).toBeUndefined();
    expect(out.dependencyCheck.mobilise).toBeUndefined();
    expect(out.raciGaps.mobilise).toBeUndefined();
  });

  it("preserves the seeded inputs — suggested roles must survive a reset", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.phaseInputs.mobilise.coreTeamRoster).toEqual([["Programme Manager", ""], ["Product Owner", ""]]);
    expect(out.dynamicSchema.inputFields.mobilise[0].id).toBe("coreTeamRoster");
  });

  it("keeps the phase's open actions and notes so the Action Center still shows them", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.decisionQueue.map((d: any) => d.id)).toEqual(["d1", "d2"]);
    expect(out.humanNotes.map((n: any) => n.id)).toEqual(["n1"]);
  });

  it("leaves other phases and the RAID log untouched", () => {
    const out = resetPhaseInner(makeInner(), "mobilise") as Record<string, any>;
    expect(out.phaseInputs.strategy).toEqual({ objective: "x" });
    expect(out.phaseArtifacts.strategy).toEqual({ vision: "kept" });
    expect(out.gateReviews.strategy).toEqual({ phaseId: "strategy", status: "approved" });
    expect(out.phasePct.strategy).toBe(100);
    expect((out.raidLog as any).entries).toHaveLength(1);
  });
});
