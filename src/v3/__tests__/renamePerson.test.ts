import { describe, it, expect } from "vitest";
import { renamePersonInProgram } from "@/v3/components/flow/flowStakeholders";
import type { ProgramSummary } from "@/new/types";

const prog = (data: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", rawData: data } as unknown as ProgramSummary);

const base = () => ({
  discoveryKit: {
    interviews: [
      { stakeholder: "Smitha", role: "Marketing SME" },
      { stakeholder: "Raj Mamodia", role: "Executive Sponsor" },
    ],
    personas: [{ name: "Marketing", spokenForBy: ["Smitha"] }],
  },
  phaseInputs: {
    frame: { sponsor: "Raj Mamodia", _roleBindings: JSON.stringify({ "Raj Mamodia": { name: "Raj Mamodia", email: "raj@brillio.com" } }) },
    listen: { _roleBindings: JSON.stringify({ Smitha: { name: "Smitha", email: "smitha@brillio.com" } }) },
  },
});

describe("renamePersonInProgram", () => {
  it("renames the kit roster entry and re-keys the contact binding (email follows)", () => {
    const out = renamePersonInProgram(prog(base()), "Smitha", "Smita Rao", "op") as Record<string, any>;
    expect(out).not.toBeNull();
    expect(out.discoveryKit.interviews[0].stakeholder).toBe("Smita Rao");
    expect(out.discoveryKit.personas[0].spokenForBy).toEqual(["Smita Rao"]);
    const rb = JSON.parse(out.phaseInputs.listen._roleBindings);
    expect(rb["Smita Rao"]).toEqual({ name: "Smita Rao", email: "smitha@brillio.com" });
    expect(rb.Smitha).toBeUndefined();
  });

  it("renames the sponsor (plain string on frame inputs) + its binding", () => {
    const out = renamePersonInProgram(prog(base()), "Raj Mamodia", "Rajesh Mamodia", "op") as Record<string, any>;
    expect(out.phaseInputs.frame.sponsor).toBe("Rajesh Mamodia");
    const rb = JSON.parse(out.phaseInputs.frame._roleBindings);
    expect(rb["Rajesh Mamodia"].email).toBe("raj@brillio.com");
    expect(out.discoveryKit.interviews[1].stakeholder).toBe("Rajesh Mamodia");
  });

  it("records the rename as an attestation", () => {
    const out = renamePersonInProgram(prog(base()), "Smitha", "Smita", "op") as Record<string, any>;
    const last = out.flowAttestations[out.flowAttestations.length - 1];
    expect(last.action).toBe("Person renamed — Smitha → Smita");
  });

  it("no-ops on an unchanged, empty, or unknown name", () => {
    expect(renamePersonInProgram(prog(base()), "Smitha", "Smitha", "op")).toBeNull();
    expect(renamePersonInProgram(prog(base()), "Smitha", "  ", "op")).toBeNull();
    expect(renamePersonInProgram(prog(base()), "Nobody Here", "X", "op")).toBeNull();
  });

  it("leaves other people untouched", () => {
    const out = renamePersonInProgram(prog(base()), "Smitha", "Smita", "op") as Record<string, any>;
    expect(out.discoveryKit.interviews[1].stakeholder).toBe("Raj Mamodia");
    expect(JSON.parse(out.phaseInputs.frame._roleBindings)["Raj Mamodia"]).toBeTruthy();
  });
});
