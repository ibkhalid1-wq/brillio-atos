import { describe, it, expect } from "vitest";
import { renameRoleInProgram } from "@/v3/components/flow/flowStakeholders";
import type { ProgramSummary } from "@/new/types";

const prog = (data: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", rawData: data } as unknown as ProgramSummary);

const base = () => ({
  discoveryKit: {
    interviews: [
      { stakeholder: "Finance", role: "Finance" },
      { stakeholder: "Raj Mamodia", role: "Executive Sponsor" },
    ],
    coverageMap: [
      { domain: "Finance", coveredBy: ["Finance", "Raj Mamodia"] },
      { domain: "Marketing", coveredBy: ["Marketing"] },
    ],
  },
  phaseInputs: {
    frame: {
      listenPlan: JSON.stringify({ roles: ["Finance"], areas: [], coverage: { Finance: ["Finance"] }, dismissedAreas: [] }),
      _listenPlanOrder: JSON.stringify({ areas: [], roles: ["Finance", "Marketing"] }),
    },
    listen: {
      _roleBindings: JSON.stringify({ Finance: { name: "Finance", email: "cfo@brillio.com" } }),
      _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Finance", role: "Finance", movementId: "listen" }]),
    },
  },
  flowInterviewPacks: [{ id: "pack-1", stakeholder: "Finance" }],
});

describe("renameRoleInProgram", () => {
  it("renames the role on kit interviews, coverage lists and standing links", () => {
    const out = renameRoleInProgram(prog(base()), "Finance", "Finance Leader", "op") as Record<string, any>;
    expect(out).not.toBeNull();
    expect(out.discoveryKit.interviews[0]).toEqual({ stakeholder: "Finance Leader", role: "Finance Leader" });
    expect(out.discoveryKit.coverageMap[0].coveredBy).toEqual(["Finance Leader", "Raj Mamodia"]);
    expect(out.flowInterviewPacks[0].stakeholder).toBe("Finance Leader");
  });

  it("re-keys the contact binding and follows through the plan + order overlays", () => {
    const out = renameRoleInProgram(prog(base()), "Finance", "Finance Leader", "op") as Record<string, any>;
    const rb = JSON.parse(out.phaseInputs.listen._roleBindings);
    expect(rb["Finance Leader"]).toEqual({ name: "Finance Leader", email: "cfo@brillio.com" });
    expect(rb.Finance).toBeUndefined();
    const plan = JSON.parse(out.phaseInputs.frame.listenPlan);
    expect(plan.roles).toEqual(["Finance Leader"]);
    expect(plan.coverage.Finance).toEqual(["Finance Leader"]);
    const order = JSON.parse(out.phaseInputs.frame._listenPlanOrder);
    expect(order.roles).toEqual(["Finance Leader", "Marketing"]);
    const dir = JSON.parse(out.phaseInputs.listen._directoryPeople);
    expect(dir[0]).toMatchObject({ name: "Finance Leader", role: "Finance Leader" });
  });

  it("records the rename as an attestation and no-ops on unchanged/empty/unknown", () => {
    const out = renameRoleInProgram(prog(base()), "Finance", "CFO", "op") as Record<string, any>;
    const last = out.flowAttestations[out.flowAttestations.length - 1];
    expect(last.action).toBe("Role renamed — Finance → CFO");
    expect(renameRoleInProgram(prog(base()), "Finance", "finance", "op")).toBeNull();
    expect(renameRoleInProgram(prog(base()), "Finance", " ", "op")).toBeNull();
    expect(renameRoleInProgram(prog(base()), "No Such Role", "X", "op")).toBeNull();
  });

  it("leaves other roles untouched", () => {
    const out = renameRoleInProgram(prog(base()), "Finance", "CFO", "op") as Record<string, any>;
    expect(out.discoveryKit.interviews[1]).toEqual({ stakeholder: "Raj Mamodia", role: "Executive Sponsor" });
    expect(out.discoveryKit.coverageMap[1].coveredBy).toEqual(["Marketing"]);
  });
});
