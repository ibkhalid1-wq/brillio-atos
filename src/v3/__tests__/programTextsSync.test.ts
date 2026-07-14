import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { persistExternalTexts, hydrateExternalTexts, externalization } from "@/v3/lib/programTextsSync";
import { MIN_EXTERNAL_LEN } from "@/v3/lib/programTexts";

const big = "x".repeat(MIN_EXTERNAL_LEN + 50);

const sampleInner = () => ({
  objective: "Improve sales velocity",
  phaseInputs: {
    frame: { sponsor: "Raj", sponsorConversation: big },
    listen: { interviewTranscripts: big + "L" },
  },
});

/** Minimal chainable Supabase mock: records upsert/delete/select calls and
 * returns thenables shaped like PostgREST responses. */
function mockSupabase(opts: { rows?: unknown[]; failTable?: boolean } = {}) {
  const calls = { upsert: [] as any[], delete: [] as any[], select: 0 };
  const from = vi.fn((_table: string) => {
    const respond = (value: any) => (opts.failTable ? Promise.resolve({ error: new Error("boom"), data: null }) : Promise.resolve(value));
    return {
      upsert: (rows: any[], o: any) => { calls.upsert.push({ rows, o }); return respond({ error: null }); },
      delete: () => {
        const q: any = {
          _filters: [] as any[],
          eq(col: string, val: any) { this._filters.push(["eq", col, val]); return this; },
          not(col: string, op: string, val: any) { this._filters.push(["not", col, op, val]); return this; },
          then(res: any, rej: any) { calls.delete.push(this._filters); return respond({ error: null }).then(res, rej); },
        };
        return q;
      },
      select: (_cols: string) => ({
        eq: (_col: string, _val: any) => { calls.select++; return respond({ data: opts.rows ?? [], error: null }); },
      }),
    };
  });
  return { supabase: { from } as any, calls };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("programTextsSync — ON by default (no flags set)", () => {
  it("persist externalizes and (cutover default-on) shrinks the blob", async () => {
    const { supabase, calls } = mockSupabase();
    const payload = sampleInner();
    const out = await persistExternalTexts(supabase, "p1", payload) as any;
    expect(calls.upsert).toHaveLength(1); // wrote the transcripts to the table
    expect(out.phaseInputs.frame.sponsorConversation).toBeUndefined(); // stripped
    expect(out.objective).toBe("Improve sales velocity"); // small fields untouched
  });

  it("hydrate reads the table and merges rows back", async () => {
    const { supabase, calls } = mockSupabase({ rows: [{ field_key: "sponsorConversation", movement_id: "frame", content: big }] });
    const shrunk = { objective: "x", phaseInputs: { frame: { sponsor: "Raj" } } };
    const out = await hydrateExternalTexts(supabase, "p1", shrunk) as any;
    expect(calls.select).toBe(1);
    expect(out.phaseInputs.frame.sponsorConversation).toBe(big);
  });

  it("GUARD: a payload with no large texts never deletes the shadow rows", async () => {
    const { supabase, calls } = mockSupabase();
    // A failed hydrate would present transcripts as absent/small — must NOT wipe.
    const payload = { objective: "x", phaseInputs: { listen: { interviewTranscripts: "short" } } };
    await persistExternalTexts(supabase, "p1", payload);
    expect(calls.upsert).toHaveLength(0);
    expect(calls.delete).toHaveLength(0);
  });
});

describe("programTextsSync — forced OFF per-browser (rollback) is inert", () => {
  beforeEach(() => {
    localStorage.setItem("atos:externalize:dual-write", "off");
    localStorage.setItem("atos:externalize:dual-read", "off");
    localStorage.setItem("atos:externalize:cutover", "off");
  });

  it("persist returns the payload unchanged and touches no table", async () => {
    const { supabase, calls } = mockSupabase();
    const payload = sampleInner();
    const out = await persistExternalTexts(supabase, "p1", payload);
    expect(out).toBe(payload); // same reference — no copy, no work
    expect(calls.upsert).toHaveLength(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("hydrate returns the data unchanged and reads no table", async () => {
    const { supabase, calls } = mockSupabase({ rows: [{ field_key: "sponsorConversation", movement_id: "frame", content: big }] });
    const data = sampleInner();
    const out = await hydrateExternalTexts(supabase, "p1", data);
    expect(out).toBe(data);
    expect(calls.select).toBe(0);
  });
});

describe("programTextsSync — dual-write on", () => {
  beforeEach(() => localStorage.setItem("atos:externalize:dual-write", "on"));

  it("upserts the large fields and (no cutover) keeps them inline", async () => {
    localStorage.setItem("atos:externalize:cutover", "off"); // cutover defaults on now — force off for this case
    const { supabase, calls } = mockSupabase();
    const payload = sampleInner();
    const out = await persistExternalTexts(supabase, "p1", payload) as any;
    // both transcripts written to the table
    const keys = calls.upsert[0].rows.map((r: any) => r.field_key).sort();
    expect(keys).toEqual(["interviewTranscripts", "sponsorConversation"]);
    // inline copy retained (cutover off) — full blob still returned
    expect(out.phaseInputs.frame.sponsorConversation).toBe(big);
  });

  it("with cutover on, strips the inline copy so the stored blob shrinks", async () => {
    localStorage.setItem("atos:externalize:cutover", "on");
    const { supabase } = mockSupabase();
    const payload = sampleInner();
    const out = await persistExternalTexts(supabase, "p1", payload) as any;
    expect(out.phaseInputs.frame.sponsorConversation).toBeUndefined();
    expect(out.phaseInputs.listen.interviewTranscripts).toBeUndefined();
    expect(out.objective).toBe("Improve sales velocity"); // small fields untouched
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(payload).length / 2);
  });

  it("a table failure falls back to the full inline blob (never loses transcripts)", async () => {
    localStorage.setItem("atos:externalize:cutover", "on");
    const { supabase } = mockSupabase({ failTable: true });
    const payload = sampleInner();
    const out = await persistExternalTexts(supabase, "p1", payload) as any;
    // cutover would strip inline, but the failure path must keep the full blob
    expect(out).toBe(payload);
    expect(out.phaseInputs.frame.sponsorConversation).toBe(big);
  });
});

describe("programTextsSync — dual-read on", () => {
  beforeEach(() => localStorage.setItem("atos:externalize:dual-read", "on"));

  it("merges table rows back into a cutover blob", async () => {
    const rows = [
      { field_key: "sponsorConversation", movement_id: "frame", content: big },
      { field_key: "interviewTranscripts", movement_id: "listen", content: big + "L" },
    ];
    const { supabase } = mockSupabase({ rows });
    // simulate a shrunk stored blob (transcripts externalized)
    const shrunk = { objective: "x", phaseInputs: { frame: { sponsor: "Raj" }, listen: {} } };
    const out = await hydrateExternalTexts(supabase, "p1", shrunk) as any;
    expect(out.phaseInputs.frame.sponsorConversation).toBe(big);
    expect(out.phaseInputs.listen.interviewTranscripts).toBe(big + "L");
  });

  it("a read failure degrades to the inline blob as-is", async () => {
    const { supabase } = mockSupabase({ failTable: true });
    const data = sampleInner();
    const out = await hydrateExternalTexts(supabase, "p1", data);
    expect(out).toBe(data);
  });
});

describe("externalization flag accessor", () => {
  it("defaults ON, and each flag can be forced off for rollback", () => {
    expect(externalization.anyOn).toBe(true); // on by default now
    expect(externalization.cutover).toBe(true);
    localStorage.setItem("atos:externalize:dual-write", "off");
    localStorage.setItem("atos:externalize:dual-read", "off");
    localStorage.setItem("atos:externalize:cutover", "off");
    expect(externalization.anyOn).toBe(false);
    localStorage.setItem("atos:externalize:dual-read", "on"); // "on" forces on
    expect(externalization.dualRead).toBe(true);
  });
});
