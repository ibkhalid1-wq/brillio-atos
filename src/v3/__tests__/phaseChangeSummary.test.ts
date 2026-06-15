import { normalizeProgram } from "@/new/lib/programData";
import { derivePhaseChanges } from "@/v3/lib/phaseChangeSummary";

const SINCE = "2026-06-10T00:00:00.000Z";
const BEFORE = "2026-06-01T00:00:00.000Z"; // older than SINCE → not a change
const AFTER = "2026-06-12T00:00:00.000Z"; // newer than SINCE → a change

function makeProgram() {
  return normalizeProgram({
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: {
      objective: "Modernize finance operations",
      phases: [{ id: "mobilise", pct: 40 }],
      phaseArtifacts: {
        mobilise: {
          a1: { title: "Mobilisation Plan", status: "draft", lastEditedBy: "agent", updatedAt: AFTER, version: 1, content: "x" },
          a2: { title: "Old Charter", status: "approved", lastEditedBy: "agent", updatedAt: BEFORE, version: 2, content: "x" },
        },
      },
      raidLog: {
        entries: [
          { id: "r1", type: "risk", title: "New budget risk", severity: "high", phase: "mobilise", status: "open", createdAt: AFTER },
          { id: "r2", type: "risk", title: "Resolved staffing risk", severity: "critical", phase: "mobilise", status: "closed", createdAt: BEFORE, closedAt: AFTER },
          { id: "r3", type: "risk", title: "Stale risk", severity: "low", phase: "mobilise", status: "open", createdAt: BEFORE },
        ],
      },
      decisionQueue: [
        { id: "d1", title: "Approve governance model", question: "Which?", priority: "high", phaseId: "mobilise", status: "open", createdAt: AFTER },
        { id: "d2", title: "Old decision", question: "Which?", priority: "low", phaseId: "mobilise", status: "open", createdAt: BEFORE },
      ],
    },
  });
}

describe("derivePhaseChanges", () => {
  it("returns [] without a baseline (first visit) or program", () => {
    expect(derivePhaseChanges(makeProgram(), "mobilise", null)).toEqual([]);
    expect(derivePhaseChanges(null, "mobilise", SINCE)).toEqual([]);
  });

  it("surfaces only items changed after the since timestamp", () => {
    const ids = derivePhaseChanges(makeProgram(), "mobilise", SINCE).map((c) => c.id);
    expect(ids).toContain("artifact:a1");        // edited after SINCE
    expect(ids).toContain("risk:r1");            // raised after SINCE
    expect(ids).toContain("risk-closed:r2");     // closed after SINCE
    expect(ids).toContain("decision:d1");        // raised after SINCE
    expect(ids).not.toContain("artifact:a2");    // edited before SINCE
    expect(ids).not.toContain("risk:r3");        // created before SINCE
    expect(ids).not.toContain("decision:d2");    // created before SINCE
  });

  it("tags a v1 artifact as added and a closed risk as resolved", () => {
    const changes = derivePhaseChanges(makeProgram(), "mobilise", SINCE);
    expect(changes.find((c) => c.id === "artifact:a1")?.tone).toBe("added");
    expect(changes.find((c) => c.id === "risk-closed:r2")?.tone).toBe("resolved");
  });
});
