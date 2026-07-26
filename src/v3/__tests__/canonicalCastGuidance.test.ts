import { describe, it, expect } from "vitest";
import { listenCanonicalCastGuidance } from "@/v3/components/flow/listenCoverage";
import type { ProgramSummary } from "@/new/types";

const prog = (data: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", rawData: data } as unknown as ProgramSummary);

describe("listenCanonicalCastGuidance", () => {
  it("pins current roster and area labels and forbids removed ones", () => {
    const out = listenCanonicalCastGuidance(prog({
      discoveryKit: {
        interviews: [
          { stakeholder: "Finance Leader", role: "Finance Leader" },
          { stakeholder: "Raj Mamodia", role: "Executive Sponsor" },
        ],
      },
      phaseInputs: {
        frame: { listenPlan: JSON.stringify({ roles: [], areas: ["Revenue Ops"], coverage: {}, dismissedAreas: ["Finance"] }) },
        listen: { _dismissedListenRoles: JSON.stringify(["finance"]) },
      },
    }));
    expect(out).not.toBeNull();
    expect(out).toContain("VERBATIM");
    expect(out).toContain("Finance Leader");
    expect(out).toContain("Revenue Ops");
    // The removed/renamed-away labels are called out as forbidden.
    expect(out).toMatch(/never reintroduce.*finance/is);
  });

  it("returns null when there is no cast at all", () => {
    expect(listenCanonicalCastGuidance(prog({}))).toBeNull();
  });
});
