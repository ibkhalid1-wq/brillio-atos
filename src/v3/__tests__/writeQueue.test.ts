import { describe, it, expect, beforeEach, vi } from "vitest";
import { enqueueWrite, flushWriteQueue, getQueuedWriteCount } from "@/lib/writeQueue";

// Minimal in-memory localStorage for the queue.
beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});

/** A supabase stub: `from().select().eq().maybeSingle()` returns the seeded
 * live row; `from().update().eq()` records what was written. */
function makeSupabase(liveData: unknown, liveUpdatedAt = "2026-01-01T00:00:00Z") {
  const writes: unknown[] = [];
  const supabase = {
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: liveData === undefined ? null : { data: liveData, updated_at: liveUpdatedAt }, error: null }) }; } };
        },
        update(payload: unknown) {
          return { eq: async () => { writes.push(payload); return { error: null }; } };
        },
      };
    },
  };
  return { supabase: supabase as never, writes };
}

const FULL = { phaseInputs: { frame: { sponsor: "Raj" } }, transformationCharter: { businessObjective: "x" } };
const SKELETON = { _syncedAt: "t", flowAttestations: [{ action: "a" }], flowInterviewPacks: [{ id: "p" }] };

describe("writeQueue flush — never clobbers a populated programme", () => {
  it("drops a queued SKELETON write when the live row holds real content", async () => {
    enqueueWrite("adam_programs", "prog-1", { data: SKELETON, updated_at: "t2" });
    const { supabase, writes } = makeSupabase(FULL);
    const res = await flushWriteQueue(supabase);
    expect(res.dropped).toBe(1);
    expect(writes).toHaveLength(0);        // nothing written
    expect(getQueuedWriteCount()).toBe(0); // and not re-queued
  });

  it("drops a queued write whose base updated_at no longer matches the live row (stale)", async () => {
    enqueueWrite("adam_programs", "prog-1", { data: FULL, updated_at: "t2" }, "OLD-BASE");
    const { supabase, writes } = makeSupabase(FULL, "MOVED-ON");
    const res = await flushWriteQueue(supabase);
    expect(res.dropped).toBe(1);
    expect(writes).toHaveLength(0);
  });

  it("applies a substantive write when the base still matches", async () => {
    enqueueWrite("adam_programs", "prog-1", { data: FULL, updated_at: "t2" }, "BASE");
    const { supabase, writes } = makeSupabase(FULL, "BASE");
    const res = await flushWriteQueue(supabase);
    expect(res.flushed).toBe(1);
    expect(writes).toHaveLength(1);
  });

  it("applies a skeleton write only when the live row is ALSO empty (genuine new programme)", async () => {
    enqueueWrite("adam_programs", "prog-1", { data: SKELETON, updated_at: "t2" });
    const { supabase, writes } = makeSupabase(SKELETON);
    const res = await flushWriteQueue(supabase);
    expect(res.flushed).toBe(1);
    expect(writes).toHaveLength(1);
  });
});
