/**
 * AN UNANSWERED QUESTION IS ASKED ONCE.
 *
 * Found live: four identical "Regenerated Agentify covers LESS than the record"
 * rows in one Inbox (04:45, 14:04, 14:38, 15:08) — same tier, title and summary,
 * differing only by id and timestamp, because `queueFlowDecision` appended
 * unconditionally with a fresh random id.
 *
 * The duplication was the visible half. Each row also carried its own
 * `payload.artifactDocs` — the draft from the run that minted it — so confirming
 * the oldest would have overwritten the record with a draft generated ten hours
 * earlier, with nothing on the surface to tell the rows apart. These pin the
 * collapse AND the freshness, because collapsing to a STALE row would be worse
 * than the duplicates.
 */
import { describe, it, expect } from "vitest";
import { upsertFlowDecision, FLOW_DECISION_CAP } from "@shared/flowDecisionQueue.ts";

const raise = (list: readonly unknown[], payload: string, id: string, now: string) =>
  upsertFlowDecision(list, {
    tier: 2,
    movementId: "listen",
    dedupeKey: "regen-guard:agentify",
    title: "Regenerated Agentify covers LESS than the record",
    payload: { artifactDocs: { agentify: payload } },
  }, id, now);

describe("a re-raised question refreshes the open row", () => {
  it("does not mint a second row for the same question", () => {
    // MUTATION: drop the dedupeKey branch → length 4, the live bug.
    let list: unknown[] = [];
    list = raise(list, "draft-1", "dec-1", "2026-08-15T04:45:00.000Z");
    list = raise(list, "draft-2", "dec-2", "2026-08-15T14:04:00.000Z");
    list = raise(list, "draft-3", "dec-3", "2026-08-15T14:38:00.000Z");
    list = raise(list, "draft-4", "dec-4", "2026-08-15T15:08:00.000Z");
    expect(list).toHaveLength(1);
  });

  it("keeps the NEWEST payload — confirming must never write a stale draft", () => {
    // The reason this is a correctness fix and not tidying. MUTATION: skip the
    // re-raise instead of refreshing → "draft-1" survives and the operator
    // confirms a proposal from hours ago.
    let list: unknown[] = raise([], "draft-1", "dec-1", "2026-08-15T04:45:00.000Z");
    list = raise(list, "draft-9", "dec-2", "2026-08-15T15:08:00.000Z");
    const row = list[0] as Record<string, any>;
    expect(row.payload.artifactDocs.agentify).toBe("draft-9");
  });

  it("preserves the original id and createdAt — the question is that old", () => {
    let list: unknown[] = raise([], "draft-1", "dec-1", "2026-08-15T04:45:00.000Z");
    list = raise(list, "draft-2", "dec-2", "2026-08-15T15:08:00.000Z");
    const row = list[0] as Record<string, unknown>;
    expect(row.id, "a surface holding the old id must keep resolving").toBe("dec-1");
    expect(row.createdAt).toBe("2026-08-15T04:45:00.000Z");
    expect(row.updatedAt).toBe("2026-08-15T15:08:00.000Z");
    expect(row.supersededCount).toBe(1);
  });
});

describe("what must NOT collapse", () => {
  it("re-raises after the operator settled it — a closed question is part of the trace", () => {
    // Confirming then regenerating again is a genuinely new question. Folding
    // it back onto the settled row would erase the fact that they answered.
    const settled = [{ id: "dec-1", status: "confirmed", createdAt: "2026-08-15T04:45:00.000Z", dedupeKey: "regen-guard:agentify" }];
    const list = raise(settled, "draft-2", "dec-2", "2026-08-15T15:08:00.000Z");
    expect(list).toHaveLength(2);
    expect((list[1] as Record<string, unknown>).status).toBe("open");
  });

  it("keeps decisions for DIFFERENT artifacts apart", () => {
    let list: unknown[] = raise([], "draft-1", "dec-1", "2026-08-15T04:45:00.000Z");
    list = upsertFlowDecision(list, { dedupeKey: "regen-guard:domain-ontology", title: "other" }, "dec-2", "2026-08-15T05:00:00.000Z");
    expect(list).toHaveLength(2);
  });

  it("leaves un-keyed decisions on the old append-always behaviour", () => {
    // No existing caller changes shape just because this landed.
    let list: unknown[] = upsertFlowDecision([], { title: "a" }, "dec-1", "2026-08-15T04:45:00.000Z");
    list = upsertFlowDecision(list, { title: "a" }, "dec-2", "2026-08-15T05:00:00.000Z");
    expect(list).toHaveLength(2);
  });
});

describe("the retention cap", () => {
  it("still caps appends, and a refresh cannot evict anything", () => {
    const many = Array.from({ length: FLOW_DECISION_CAP }, (_, i) =>
      ({ id: `old-${i}`, status: "confirmed", createdAt: "2026-01-01T00:00:00.000Z" }));
    const appended = upsertFlowDecision(many, { title: "new" }, "dec-new", "2026-08-15T15:08:00.000Z");
    expect(appended).toHaveLength(FLOW_DECISION_CAP);
    expect((appended[appended.length - 1] as Record<string, unknown>).id).toBe("dec-new");

    // A refresh replaces in place, so length is unchanged and the oldest row
    // is not silently pushed off the front.
    const withOpen = [{ id: "dec-open", status: "open", createdAt: "2026-08-15T04:45:00.000Z", dedupeKey: "regen-guard:agentify" }, ...many.slice(1)];
    const refreshed = raise(withOpen, "draft-2", "dec-x", "2026-08-15T15:08:00.000Z");
    expect(refreshed).toHaveLength(withOpen.length);
    expect((refreshed[0] as Record<string, unknown>).id).toBe("dec-open");
  });
});
