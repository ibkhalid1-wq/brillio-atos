import { describe, it, expect } from "vitest";
import {
  getChangeRequests,
  makeChangeRequest,
  applyDecision,
  openChangeRequests,
  openRequestsForPhase,
  isValidChangeRequest,
  phasesToReopenForChange,
  type ChangeRequest,
} from "@/v3/lib/changeControl";

const ORDER = ["strategy", "mobilise", "discover", "design", "build", "operate"];

function sampleCR(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: "cr-1",
    phaseId: "strategy",
    title: "Adjust target end date",
    reason: "Client moved the go-live.",
    status: "open",
    requestedBy: "Alex PM",
    requestedAt: "2026-06-01T00:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  };
}

describe("getChangeRequests", () => {
  it("returns [] for missing / non-array changeRequests", () => {
    expect(getChangeRequests(null)).toEqual([]);
    expect(getChangeRequests({})).toEqual([]);
    expect(getChangeRequests({ changeRequests: "nope" })).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const good = sampleCR();
    const inner = { changeRequests: [good, { id: 1 }, null, { phaseId: "x" }] };
    expect(getChangeRequests(inner)).toEqual([good]);
  });
});

describe("isValidChangeRequest", () => {
  it("accepts a well-formed request and rejects junk", () => {
    expect(isValidChangeRequest(sampleCR())).toBe(true);
    expect(isValidChangeRequest({})).toBe(false);
    expect(isValidChangeRequest([])).toBe(false);
    expect(isValidChangeRequest("cr")).toBe(false);
  });
});

describe("makeChangeRequest", () => {
  it("trims input and starts in the open state with a unique id", () => {
    const cr = makeChangeRequest({
      phaseId: "design",
      title: "  Rework the org model  ",
      reason: "  New regulatory constraint  ",
      requestedBy: "Sam",
      now: "2026-06-10T12:00:00.000Z",
    });
    expect(cr.phaseId).toBe("design");
    expect(cr.title).toBe("Rework the org model");
    expect(cr.reason).toBe("New regulatory constraint");
    expect(cr.status).toBe("open");
    expect(cr.requestedBy).toBe("Sam");
    expect(cr.requestedAt).toBe("2026-06-10T12:00:00.000Z");
    expect(cr.decidedBy).toBeNull();
    expect(cr.id).toMatch(/^cr-design-/);
  });
});

describe("applyDecision", () => {
  it("approves only the matching open request", () => {
    const list = [sampleCR({ id: "a" }), sampleCR({ id: "b" })];
    const next = applyDecision(list, "a", "approved", "Reviewer", "ok", "2026-06-11T00:00:00.000Z");
    expect(next.find((c) => c.id === "a")).toMatchObject({
      status: "approved",
      decidedBy: "Reviewer",
      decisionNote: "ok",
      decidedAt: "2026-06-11T00:00:00.000Z",
    });
    expect(next.find((c) => c.id === "b")?.status).toBe("open");
  });

  it("does not re-decide an already-decided request", () => {
    const list = [sampleCR({ id: "a", status: "rejected", decidedBy: "First" })];
    const next = applyDecision(list, "a", "approved", "Second");
    expect(next[0]).toMatchObject({ status: "rejected", decidedBy: "First" });
  });

  it("normalizes a blank note to null", () => {
    const next = applyDecision([sampleCR({ id: "a" })], "a", "rejected", "R", "   ");
    expect(next[0].decisionNote).toBeNull();
  });

  it("is a no-op for an unknown id", () => {
    const list = [sampleCR({ id: "a" })];
    expect(applyDecision(list, "zzz", "approved", "R")).toEqual(list);
  });
});

describe("selectors", () => {
  it("openChangeRequests keeps only open ones", () => {
    const list = [sampleCR({ id: "a" }), sampleCR({ id: "b", status: "approved" })];
    expect(openChangeRequests(list).map((c) => c.id)).toEqual(["a"]);
  });

  it("openRequestsForPhase filters by phase and status", () => {
    const list = [
      sampleCR({ id: "a", phaseId: "strategy" }),
      sampleCR({ id: "b", phaseId: "design" }),
      sampleCR({ id: "c", phaseId: "strategy", status: "approved" }),
    ];
    expect(openRequestsForPhase(list, "strategy").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("phasesToReopenForChange", () => {
  it("reopens the target plus every prior approved phase, in program order", () => {
    // strategy..design are closed; design is the change target.
    const approved = ["strategy", "mobilise", "discover", "design"];
    expect(phasesToReopenForChange(ORDER, approved, "design")).toEqual([
      "strategy", "mobilise", "discover", "design",
    ]);
  });

  it("skips prior phases that are not approved", () => {
    // mobilise was never closed, so it is not reopened.
    const approved = ["strategy", "discover", "design"];
    expect(phasesToReopenForChange(ORDER, approved, "design")).toEqual([
      "strategy", "discover", "design",
    ]);
  });

  it("never includes phases after the target", () => {
    const approved = ["strategy", "mobilise", "discover", "design", "build"];
    expect(phasesToReopenForChange(ORDER, approved, "discover")).toEqual([
      "strategy", "mobilise", "discover",
    ]);
  });

  it("returns just the target when it is the first phase", () => {
    expect(phasesToReopenForChange(ORDER, ["strategy"], "strategy")).toEqual(["strategy"]);
  });

  it("always includes the target even if it is not in the approved set", () => {
    expect(phasesToReopenForChange(ORDER, ["strategy"], "design")).toEqual(["strategy", "design"]);
  });

  it("falls back to just the target when order is unknown", () => {
    expect(phasesToReopenForChange([], ["strategy"], "design")).toEqual(["design"]);
  });
});
