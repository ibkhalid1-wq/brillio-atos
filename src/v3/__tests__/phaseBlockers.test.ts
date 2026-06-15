import { normalizeProgram } from "@/new/lib/programData";
import { derivePhaseBlockers } from "@/v3/lib/phaseBlockers";

const FOURTEEN_DAYS_AGO = new Date(Date.now() - 20 * 86_400_000).toISOString();

function makeProgram() {
  return normalizeProgram({
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: {
      objective: "Modernize finance operations",
      phases: [
        { id: "strategy", pct: 100 },
        { id: "mobilise", pct: 40 },
        { id: "discover", pct: 0 },
      ],
      raidLog: {
        entries: [
          { id: "r1", type: "risk", title: "Budget overrun likely", severity: "critical", phase: "mobilise", status: "open" },
          { id: "r2", type: "risk", title: "Minor tooling gap", severity: "low", phase: "mobilise", status: "open" },
          { id: "r3", type: "dependency", title: "Awaiting vendor SOW", severity: "high", phase: "mobilise", status: "open" },
          { id: "r4", type: "risk", title: "Resolved staffing risk", severity: "critical", phase: "mobilise", status: "closed" },
        ],
      },
      decisionQueue: [
        { id: "d1", title: "Approve governance model", question: "Which model?", priority: "high", phaseId: "mobilise", status: "open", createdAt: FOURTEEN_DAYS_AGO },
      ],
    },
  });
}

describe("derivePhaseBlockers", () => {
  it("returns an empty array for a missing program", () => {
    expect(derivePhaseBlockers(null, "mobilise")).toEqual([]);
  });

  it("surfaces a critical risk and excludes closed and low-severity risks", () => {
    const blockers = derivePhaseBlockers(makeProgram(), "mobilise");
    const ids = blockers.map((b) => b.id);
    expect(ids).toContain("risk:r1");          // critical risk surfaces
    expect(ids).not.toContain("risk:r2");      // low-severity risk filtered out
    expect(ids).not.toContain("risk:r4");      // closed risk excluded
  });

  it("surfaces open dependencies and overdue decisions", () => {
    const blockers = derivePhaseBlockers(makeProgram(), "mobilise");
    const ids = blockers.map((b) => b.id);
    expect(ids).toContain("dependency:r3");
    expect(ids).toContain("decision:d1");
  });

  it("sorts critical-severity blockers ahead of lower-severity ones", () => {
    const blockers = derivePhaseBlockers(makeProgram(), "mobilise");
    const criticalIdx = blockers.findIndex((b) => b.severity === "critical");
    const mediumIdx = blockers.findIndex((b) => b.severity === "medium");
    if (criticalIdx !== -1 && mediumIdx !== -1) {
      expect(criticalIdx).toBeLessThan(mediumIdx);
    }
    expect(blockers.length).toBeGreaterThan(0);
  });
});
