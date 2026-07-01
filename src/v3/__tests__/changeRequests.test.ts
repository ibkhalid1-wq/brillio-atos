import { describe, it, expect } from "vitest";
import type { DecisionSummary, ProgramSummary } from "@/new/types";
import { deriveChangeRequests, isPcrDecision } from "@/v3/lib/changeRequests";

function decision(overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  return {
    id: "d1",
    title: "Add mobile payments to scope",
    type: "pcr-review",
    priority: "high",
    phaseId: "build",
    question: "Should we expand scope?",
    options: [],
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  } as DecisionSummary;
}

// A programme that grounds objectives/owners/timeline/KPIs, so absence-claim PCRs
// are provable false positives.
const GROUNDED_PROGRAM = {
  rawData: {
    data: {
      phaseInputs: {
        strategy: {
          businessObjective: "Transform fragmented commercial execution into a growth engine.",
          successMetric: "Reduce CRM licensing costs by 30% within twelve months.",
          startDate: "2026-01-01",
          targetEndDate: "2026-12-31",
        },
        mobilise: { coreTeam: [{ role: "Sponsor", name: "Dana Reed" }] },
      },
    },
  },
} as unknown as ProgramSummary;

describe("isPcrDecision", () => {
  it("matches PCR type variants", () => {
    expect(isPcrDecision(decision({ type: "pcr-review" }))).toBe(true);
    expect(isPcrDecision(decision({ type: "change_request" }))).toBe(true);
  });

  it("matches a scope-pcr source regardless of type", () => {
    expect(isPcrDecision(decision({ type: "escalation", source: "scope-pcr" }))).toBe(true);
  });

  it("ignores unrelated decision types", () => {
    expect(isPcrDecision(decision({ type: "gate_approval", source: undefined }))).toBe(false);
  });
});

describe("deriveChangeRequests", () => {
  it("returns empty log for a null program", () => {
    expect(deriveChangeRequests(null)).toEqual({ open: [], resolved: [], suppressedCount: 0 });
  });

  it("lists a genuine open change request", () => {
    const program = { ...GROUNDED_PROGRAM, decisionQueue: [decision()] } as ProgramSummary;
    const log = deriveChangeRequests(program);
    expect(log.open).toHaveLength(1);
    expect(log.open[0].title).toBe("Add mobile payments to scope");
    expect(log.suppressedCount).toBe(0);
  });

  it("suppresses a grounded false-positive open PCR", () => {
    const fp = decision({ id: "fp", title: "No objectives are defined at the program level" });
    const program = { ...GROUNDED_PROGRAM, decisionQueue: [fp] } as ProgramSummary;
    const log = deriveChangeRequests(program);
    expect(log.open).toHaveLength(0);
    expect(log.suppressedCount).toBe(1);
  });

  it("keeps resolved PCRs as history even when they were absence-claims", () => {
    const resolved = decision({
      id: "r1",
      title: "No objectives are defined",
      status: "rejected",
      resolvedAt: "2026-06-10T00:00:00Z",
    });
    const program = { ...GROUNDED_PROGRAM, decisionQueue: [resolved] } as ProgramSummary;
    const log = deriveChangeRequests(program);
    expect(log.resolved).toHaveLength(1);
    expect(log.resolved[0].resolution).toBe("rejected");
    expect(log.suppressedCount).toBe(0);
  });

  it("sorts open change requests newest-first", () => {
    const older = decision({ id: "old", createdAt: "2026-05-01T00:00:00Z" });
    const newer = decision({ id: "new", createdAt: "2026-06-15T00:00:00Z" });
    const program = { ...GROUNDED_PROGRAM, decisionQueue: [older, newer] } as ProgramSummary;
    const log = deriveChangeRequests(program);
    expect(log.open.map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("ignores non-PCR decisions entirely", () => {
    const other = decision({ type: "gate_approval", source: undefined });
    const program = { ...GROUNDED_PROGRAM, decisionQueue: [other] } as ProgramSummary;
    expect(deriveChangeRequests(program)).toEqual({ open: [], resolved: [], suppressedCount: 0 });
  });
});
