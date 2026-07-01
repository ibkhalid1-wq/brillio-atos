import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import type { ChangeRequest } from "@/v3/lib/changeControl";
import { deriveChangeRequests } from "@/v3/lib/changeRequests";

function cr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: "cr-1",
    phaseId: "design",
    title: "Engineering Lead / Architect",
    reason: "Change Architect to Nayana Pai",
    status: "open",
    requestedBy: "ibkhalid1@gmail.com",
    requestedAt: "2026-06-29T15:37:56.362Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  };
}

function program(changeRequests: ChangeRequest[]): ProgramSummary {
  return { rawData: { data: { changeRequests } } } as unknown as ProgramSummary;
}

describe("deriveChangeRequests", () => {
  it("returns an empty log for a null program", () => {
    expect(deriveChangeRequests(null)).toEqual({ open: [], history: [] });
  });

  it("reads change-control records from inner state (rawData.data)", () => {
    const log = deriveChangeRequests(program([cr()]));
    expect(log.open).toHaveLength(1);
    expect(log.open[0].title).toBe("Engineering Lead / Architect");
  });

  it("tolerates a flat rawData shape (no nested data)", () => {
    const flat = { rawData: { changeRequests: [cr()] } } as unknown as ProgramSummary;
    expect(deriveChangeRequests(flat).open).toHaveLength(1);
  });

  it("puts an approved (implemented) request in history, not open", () => {
    const approved = cr({
      id: "cr-a",
      status: "approved",
      decidedBy: "ibkhalid1@gmail.com",
      decidedAt: "2026-06-29T15:38:01.569Z",
    });
    const log = deriveChangeRequests(program([approved]));
    expect(log.open).toHaveLength(0);
    expect(log.history).toHaveLength(1);
    expect(log.history[0].status).toBe("approved");
  });

  it("includes rejected requests in history too", () => {
    const rejected = cr({ id: "cr-r", status: "rejected", decidedAt: "2026-06-30T00:00:00Z" });
    const log = deriveChangeRequests(program([rejected]));
    expect(log.history.map((c) => c.status)).toEqual(["rejected"]);
  });

  it("separates open from decided and orders each newest-first", () => {
    const openOld = cr({ id: "o1", status: "open", requestedAt: "2026-05-01T00:00:00Z" });
    const openNew = cr({ id: "o2", status: "open", requestedAt: "2026-06-01T00:00:00Z" });
    const decOld = cr({ id: "d1", status: "approved", decidedAt: "2026-05-10T00:00:00Z" });
    const decNew = cr({ id: "d2", status: "rejected", decidedAt: "2026-06-10T00:00:00Z" });
    const log = deriveChangeRequests(program([openOld, decOld, openNew, decNew]));
    expect(log.open.map((c) => c.id)).toEqual(["o2", "o1"]);
    expect(log.history.map((c) => c.id)).toEqual(["d2", "d1"]);
  });

  it("ignores malformed change-request entries", () => {
    const bad = { id: "x" } as unknown as ChangeRequest;
    const log = deriveChangeRequests(program([bad, cr()]));
    expect(log.open).toHaveLength(1);
  });
});
