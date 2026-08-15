/**
 * A RUN THE EDGE DROPPED MUST NOT STAY "RUNNING" FOR EVER.
 *
 * Observed on the live board: `prototype-build` sat `status: running` for 17 minutes
 * against a 5-minute stale threshold and an edge wall-clock of ~2.5 minutes, with the
 * programme row untouched since before the run began — so nothing was written, the
 * invocation had been killed, and the row could never be corrected. The process that
 * would have written `failed` is the one that died.
 *
 * The reaper for this ALREADY EXISTED — `isStaleActiveRun` + `normalizeActiveRuns`.
 * The hole was that the 90-second poller, the ONLY path that fires for a long-running
 * run, merged the polled row straight into state without normalising: it re-read
 * "running" (which it always will), put it back, and kept the zombie alive. Every
 * other path — initial load, realtime upsert — normalised, which is why a page reload
 * cleared it and sitting on the page did not.
 *
 * These pin the reaper's rule, because a threshold that reaps a LIVE run is worse than
 * one that reaps nothing: it would tell an operator their build failed while it works.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../../hooks/useAgentRun.ts"), "utf8");

describe("the poller reaps, like every other path into activeRuns", () => {
  it("normalises the polled list instead of merging it raw", () => {
    // MUTATION: revert to `setActiveRuns((current) => current.map(...))` → RED, and a
    // dropped run is immortal again.
    const at = SRC.indexOf("const stalledRuns = activeRuns.filter");
    expect(at, "the stalled-run poller is gone — move or drop this guard").toBeGreaterThan(-1);
    const poller = SRC.slice(at, at + 1600);
    expect(poller, "the poller merges without reaping").toContain("normalizeActiveRuns(current.map(");
  });

  it("every path that sets activeRuns from a list goes through the reaper", () => {
    // The property, not the one site: initial load, upsert, poll. If a fourth path
    // appears and skips it, the same zombie comes back by another door.
    // A WINDOW, not a regex to the first paren — `setActiveRuns((current) => ...)`
    // closes several parens before the call that matters, so a lazy match cannot see
    // the reaper and reports a false offender. (It did, on the first run of this.)
    const offenders: string[] = [];
    for (let i = SRC.indexOf("setActiveRuns("); i !== -1; i = SRC.indexOf("setActiveRuns(", i + 1)) {
      const call = SRC.slice(i, i + 320);
      if (call.startsWith("setActiveRuns((prev) => upsertRun")) continue;   // upsert normalises inside
      if (call.startsWith("setActiveRuns([])")) continue;                   // clearing is not a list
      // A pure REMOVAL cannot revive a zombie — it only ever shortens the list. The
      // rule is about paths that add or refresh runs, which are the ones that can put
      // a stale "running" back into state.
      if (/^setActiveRuns\(\(prev\) => prev\.filter\(/.test(call)) continue;
      if (!call.includes("normalizeActiveRuns")) offenders.push(call.slice(0, 60).replace(/\n/g, " "));
    }
    expect(offenders, `a setActiveRuns path skips the reaper:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the threshold", () => {
  it("is comfortably longer than the edge can possibly run", () => {
    // Supabase edge functions are wall-clock capped (150s default, 400s paid). The
    // threshold must sit ABOVE that ceiling, or the reaper kills live work and tells
    // an operator a running build has failed — worse than the stuck tile it fixes.
    const m = SRC.match(/STALE_RUN_TIMEOUT_MS = (\d+) \* 60 \* 1000/);
    expect(m, "the threshold is gone or reworded").not.toBeNull();
    const minutes = Number(m![1]);
    expect(minutes, "below the 400s edge ceiling — this would reap live runs").toBeGreaterThan(7);
  });

  it("only ever reaps a NON-terminal run", () => {
    // A completed run is retained briefly on purpose (TERMINAL_RUN_RETENTION_MS) so
    // the UI can show the result. The reaper must not touch those.
    const at = SRC.indexOf("function isStaleActiveRun");
    const body = SRC.slice(at, at + 300);
    expect(body).toContain("if (isTerminalStatus(run.status as AgentRun[\"status\"])) return false;");
  });
});
