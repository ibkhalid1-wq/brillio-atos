import { normalizeProgram } from "@/new/lib/programData";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { isDecisionOpen } from "@/v3/utils";

/**
 * A decision is "open" until it reaches a terminal status. buildDecisionQueue
 * re-emits a persisted decision as live unless it is dismissed/resolved, and
 * resolveDecision writes approved/deferred/rejected/modified when a user acts on
 * one — so "pending" (the state persisted PCRs are seeded with) is unresolved and
 * must count as open. A prior "open"-only check silently dropped every pending
 * PCR from the Actions queue and its badge; these tests pin the terminal set.
 */
describe("isDecisionOpen", () => {
  const decision = (status?: string) => ({ id: "d", title: "x", type: "decision", priority: "high", phaseId: "all", question: "?", options: [], createdAt: "", status } as never);

  it("treats pending and open (and missing) as open", () => {
    expect(isDecisionOpen(decision("pending"))).toBe(true);
    expect(isDecisionOpen(decision("open"))).toBe(true);
    expect(isDecisionOpen(decision(undefined))).toBe(true);
  });

  it("treats resolution and dismissal statuses as closed", () => {
    for (const s of ["approved", "deferred", "rejected", "modified", "dismissed", "resolved", "closed"]) {
      expect(isDecisionOpen(decision(s))).toBe(false);
    }
  });
});

describe("pending PCRs surface in the recommended-actions queue", () => {
  function makeProgram(pcrStatus: string) {
    return normalizeProgram({
      id: "program-pcr",
      name: "PCRs",
      updated_at: "2026-06-13T00:00:00.000Z",
      data: {
        objective: "x",
        decisionQueue: [
          { id: "pcr_missing-objectives", type: "pcr-review", phaseId: "all", status: pcrStatus, title: "PCR recommended", createdAt: "2026-06-13T00:00:00.000Z" },
        ],
      },
    });
  }

  it("includes a pending PCR as an open action", () => {
    const ids = deriveOpenRecommendedActions(makeProgram("pending"), "all").map((d) => d.id);
    expect(ids).toContain("pcr_missing-objectives");
  });

  it("drops the PCR once it is approved", () => {
    const ids = deriveOpenRecommendedActions(makeProgram("approved"), "all").map((d) => d.id);
    expect(ids).not.toContain("pcr_missing-objectives");
  });
});
