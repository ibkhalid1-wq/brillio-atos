import { normalizeProgram } from "@/new/lib/programData";
import {
  selectBlockers,
  selectHighRisks,
  selectRisks,
} from "@/v3/lib/programRaid";

/**
 * programRaid is the single source of truth for the risk / blocker lists every
 * surface counts. These tests pin the invariants the module exists to guarantee:
 * risks are risk-only (never silently mixed with blockers, the bug that made the
 * Today feed over-count), monitored risks stay counted (not just status "open"),
 * closed entries drop out, and phase scope narrows the set the same way everywhere.
 */
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
      ],
      raidLog: {
        entries: [
          { id: "r1", type: "risk", title: "Budget overrun", severity: "critical", phase: "strategy", status: "open" },
          { id: "r2", type: "risk", title: "Scope creep", severity: "medium", phase: "mobilise", status: "open" },
          { id: "r3", type: "risk", title: "Resolved risk", severity: "high", phase: "strategy", status: "closed" },
          { id: "r4", type: "risk", title: "Vendor delay", severity: "high", phase: "mobilise", status: "monitoring" },
          { id: "b1", type: "blocker", title: "Env access", severity: "high", phase: "strategy", status: "open" },
          { id: "b2", type: "blocker", title: "Old blocker", severity: "low", phase: "mobilise", status: "closed" },
        ],
      },
    },
  });
}

describe("selectRisks / selectBlockers", () => {
  it("returns risks only — never mixes in blockers", () => {
    const ids = selectRisks(makeProgram()).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["r1", "r2", "r4"]));
    expect(ids).not.toContain("b1");
  });

  it("counts monitored risks and drops closed ones", () => {
    const ids = selectRisks(makeProgram()).map((r) => r.id);
    expect(ids).toContain("r4"); // monitoring is still open work
    expect(ids).not.toContain("r3"); // closed drops out
  });

  it("sorts by severity (critical first)", () => {
    const sev = selectRisks(makeProgram()).map((r) => r.severity);
    expect(sev).toEqual(["critical", "high", "medium"]);
  });

  it("narrows to a single phase when scoped", () => {
    const ids = selectRisks(makeProgram(), { phaseId: "strategy" }).map((r) => r.id);
    expect(ids).toEqual(["r1"]); // r2/r4 are mobilise, r3 closed
  });

  it("selectHighRisks keeps only high/critical risks (no blockers)", () => {
    const ids = selectHighRisks(makeProgram()).map((r) => r.id);
    expect(ids).toEqual(["r1", "r4"]); // critical then high; r2 medium excluded
    expect(ids).not.toContain("b1");
  });

  it("selectBlockers returns open blockers only", () => {
    const ids = selectBlockers(makeProgram()).map((b) => b.id);
    expect(ids).toEqual(["b1"]); // b2 closed
  });
});
