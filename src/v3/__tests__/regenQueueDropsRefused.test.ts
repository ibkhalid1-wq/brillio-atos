/**
 * A REFUSED RUN LEAVES THE QUEUE — it does not retry for ever.
 *
 * Reported twice more after the first fix: "experience design stuck in rebuilding",
 * then "agentify stuck in rebuilding". Different tiles, one cause, and it was NOT the
 * latch I had already fixed — it is the batch queue behind the status bar.
 *
 * An item only ever came off the queue when the backend reported it RUNNING. When a
 * guard turned the run away (not signed in, read-only, AI not connected) it never
 * started, so it never left — and the 8-second wedge-breaker re-dispatched it every
 * 8 seconds, for ever. "Regenerating N artifacts" pinned to the screen, tiles reading
 * "rebuilding…", and a refused agent call every 8 seconds behind it.
 *
 * The first fix made `runProgramAgent` resolve false on refusal. It did not reach
 * here, because `handleRunAgent` — the wrapper the queue runs through — discarded the
 * promise with `void`. Both ends are fixed; these pin the queue end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useRegenQueue } from "@/v3/hooks/useRegenQueue";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); act(() => root.unmount()); host.remove(); });

type Q = ReturnType<typeof useRegenQueue>;

/** Mount the queue with a controllable runAgent, and no backend ever reporting a run
 *  as running — which is exactly the refused case. */
function mount(runAgent: (a: string, p: string) => void | Promise<boolean | void>) {
  const calls: string[] = [];
  let api!: Q;
  const wrapped = (a: string, p: string) => { calls.push(a); return runAgent(a, p); };
  const Probe = () => {
    api = useRegenQueue({ runningAgentIds: new Set<string>(), runAgent: wrapped, orderIndex: () => 0 });
    return null;
  };
  act(() => { root.render(createElement(Probe)); });
  return { get api() { return api; }, calls };
}

const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe("a dispatch the guards refused", () => {
  it("is dropped from the queue instead of waiting for a run that never starts", async () => {
    const h = mount(async () => false);
    act(() => { h.api.enqueue("experience-design", "envision", "Experience Design"); });
    expect(h.api.queue.length, "nothing was enqueued — the test proves nothing").toBe(1);
    await settle();
    // MUTATION: drop the `.then(dispatched => …drop())` in useRegenQueue → 1, and the
    // status bar says "Regenerating 1 artifact" for ever.
    expect(h.api.queue.length, "a refused run stayed queued").toBe(0);
  });

  it("is NOT re-dispatched every 8 seconds", async () => {
    // The wedge-breaker used to resurrect it: guard released, effect re-runs, same
    // item at the head, dispatched again. For ever.
    const h = mount(async () => false);
    act(() => { h.api.enqueue("agentify", "envision", "Agentify"); });
    await settle();
    const afterFirst = h.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
    expect(h.calls.length, `re-dispatched ${h.calls.length - afterFirst} more times after being refused`).toBe(afterFirst);
  });

  it("drops an item whose dispatch threw, on the same rule", async () => {
    const h = mount(async () => { throw new Error("network"); });
    act(() => { h.api.enqueue("agentic-blueprint", "envision", "Agentic Blueprint"); });
    await settle();
    expect(h.api.queue.length).toBe(0);
  });

  it("moves on to the next item rather than wedging on the refused one", async () => {
    // The queue runs one at a time. If a refusal never cleared, everything behind it
    // starved — which is why three tiles could stick from one bad first item.
    const h = mount(async (a) => (a === "experience-design" ? false : true));
    act(() => {
      h.api.enqueue("experience-design", "envision", "Experience Design");
      h.api.enqueue("agentify", "envision", "Agentify");
    });
    await settle();
    await settle();
    expect(h.calls).toContain("agentify");
  });
});

describe("a dispatch that went through", () => {
  it("stays queued until the backend reports it running — unchanged", async () => {
    // The guard against an over-eager drop: a real run must stay visible in the status
    // bar until it actually starts, which is what `runningAgentIds` reports.
    const h = mount(async () => true);
    act(() => { h.api.enqueue("experience-design", "envision", "Experience Design"); });
    await settle();
    expect(h.api.queue.length, "a live run was dropped from the status bar").toBe(1);
  });

  it("stays queued for a handler that returns nothing at all", async () => {
    // Back-compat: `void` is not a refusal.
    const h = mount(() => undefined);
    act(() => { h.api.enqueue("experience-design", "envision", "Experience Design"); });
    await settle();
    expect(h.api.queue.length).toBe(1);
  });
});

describe("the wiring between them, which is what was actually broken", () => {
  it("handleRunAgent RETURNS the dispatch result instead of voiding it", () => {
    // Both ends can be correct and the bug still present: `runProgramAgent` resolved
    // false and the queue knew what to do with false, but the wrapper between them
    // discarded the promise with `void`, so the answer never arrived. Nothing typed
    // or tested caught that — re-adding the `void` compiles clean and passes every
    // other test in this file, because they mount the queue directly.
    const shell = readFileSync(resolve(__dirname, "../AppShellV3.tsx"), "utf8");
    const at = shell.indexOf("const handleRunAgent = useCallback(");
    expect(at, "handleRunAgent is gone — move or drop this guard").toBeGreaterThan(-1);
    const body = shell.slice(at, at + 400);
    // MUTATION: restore `void runProgramAgent({` → RED.
    expect(body, "handleRunAgent throws the refusal away again").not.toContain("void runProgramAgent(");
    expect(body).toContain("runProgramAgent({");
  });
});
