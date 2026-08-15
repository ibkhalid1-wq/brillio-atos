/**
 * A REFUSED DISPATCH MUST NOT LEAVE A TILE CLAIMING TO REBUILD.
 *
 * Reported as "architecture strategy, experience design and agentic blueprint remain
 * stuck in rebuilding". Reproduced on the running board: the label clears on reload,
 * so it was never persisted state — it was the in-memory latch, set for a run that
 * never happened.
 *
 * The chain:
 *   click → `regenerate()` latches busy and says "Regenerating…"
 *         → `onRunAgent` hits a guard (not signed in / read-only / AI NOT CONNECTED)
 *         → the guard toasts for six seconds and returns BARE
 *         → nothing dispatches, so no document ever changes
 *         → the latch clears only on a document change, so it never clears.
 *
 * The toast was transient and the false state was permanent. On this programme the
 * guard was "AI is not connected" — the same missing provider key behind the reported
 * inability to save one.
 *
 * `onRunAgent` now resolves FALSE when it refused, and the hook unlatches.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useArtifactRegen, type ArtifactRegen } from "@/v3/components/flow/useArtifactRegen";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

// Typed as itself, cast only where it is handed over — `as never` on the const
// would make CARD.id unreadable here, which `npm test` alone would not have caught.
const CARD = { id: "architecture-strategy", movementId: "envision", title: "Architecture Strategy" };
const PROGRAM = { id: "p1", rawData: { data: {} } } as never;

/** Mount the hook and hand back its API plus what it said. */
function mount(onRunAgent: (a: string, p?: string) => void | Promise<boolean | void>) {
    const said: string[] = [];
  let api!: ArtifactRegen;
  const Probe = () => { api = useArtifactRegen(PROGRAM, onRunAgent, (m) => { said.push(m); }); return null; };
  act(() => { root.render(createElement(Probe)); });
  return { get api() { return api; }, said };
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe("a dispatch that was refused", () => {
  it("does not leave the tile rebuilding", async () => {
    // MUTATION: make the guards in AppShellV3 `return` bare again (or drop the
    // unlatch in useArtifactRegen) → true, which is the reported bug.
    const h = mount(async () => false);
    act(() => { h.api.regenerate!(CARD as never); });
    expect(h.api.regenerating(CARD.id), "the latch never went on — the test proves nothing").toBe(true);
    await flush();
    expect(h.api.regenerating(CARD.id), "a refused run left the tile saying rebuilding…").toBe(false);
  });

  it("says it was not sent, rather than going quiet", async () => {
    // A tile that silently reverts is only marginally better than one that lies.
    const h = mount(async () => false);
    act(() => { h.api.regenerate!(CARD as never); });
    await flush();
    expect(h.said.at(-1)).toContain("was not sent");
  });

  it("unlatches when the dispatch THROWS, too", async () => {
    const h = mount(async () => { throw new Error("network"); });
    act(() => { h.api.regenerate!(CARD as never); });
    await flush();
    expect(h.api.regenerating(CARD.id)).toBe(false);
    expect(h.said.at(-1)).toContain("failed before it started");
  });
});

describe("a dispatch that went through", () => {
  it("stays latched — the document change is what clears it", async () => {
    // The guard against an over-eager unlatch: a real run must keep saying
    // "rebuilding…" until the regenerated document lands.
    const h = mount(async () => true);
    act(() => { h.api.regenerate!(CARD as never); });
    await flush();
    expect(h.api.regenerating(CARD.id), "a live run stopped reporting itself").toBe(true);
    expect(h.said[0]).toContain("Regenerating");
  });

  it("stays latched for a handler that returns nothing at all", async () => {
    // Back-compat: `void` is not a refusal. Only an explicit `false` unlatches, so a
    // caller that never opted in behaves exactly as before.
    const h = mount(() => undefined);
    act(() => { h.api.regenerate!(CARD as never); });
    await flush();
    expect(h.api.regenerating(CARD.id)).toBe(true);
  });

  it("answers the click immediately, before the dispatch resolves", async () => {
    // Awaiting the whole agent run before acknowledging would make this a dead
    // button for the length of a model call.
    let release!: (v: boolean) => void;
    const h = mount(() => new Promise<boolean>((r) => { release = r; }));
    act(() => { h.api.regenerate!(CARD as never); });
    expect(h.api.regenerating(CARD.id)).toBe(true);   // latched with the promise still open
    act(() => { release(true); });
    await flush();
    expect(h.api.regenerating(CARD.id)).toBe(true);
  });
});
