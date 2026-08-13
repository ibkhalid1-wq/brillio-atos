/**
 * REGRESSION — the operator inbox's Sessions section is ONE line until it is opened,
 * and that line's numbers are the expanded rows added up.
 *
 * Reported: on Laila the section rendered 8 pair cards, each carrying a single control
 * ("propose a time") for a write that is GATED — the action records intent and books
 * nothing. Eight cards of a verb that cannot complete out-shouted every section an
 * operator can actually finish.
 *
 * The section could NOT simply go away. A seam locus is jointly owned, and
 * useProgramLedger excludes joint owners from `soloByOwner` (the joint branch pushes to
 * sessionMap and continues), so these questions sit on no individual's Discover list.
 * This panel is their only home. So the fix is presentation: collapse to a summary whose
 * numbers stay lit, keep every row behind a disclosure, unchanged.
 *
 * What this test pins, against the REAL Laila session queue (derived here with the same
 * functions useProgramLedger uses, so the seam/question numbers are the programme's own):
 *   · 0 seams renders nothing (the hide-on-empty rule survives the rewrite)
 *   · collapsed, BOTH numbers are on screen and NO row is
 *   · the collapsed question total === the sum of the per-pair counts the rows print,
 *     and the collapsed seam count === how many rows appear (one read, two readings)
 *   · expanding reveals exactly sessionQueue.length rows, and re-collapsing hides them
 *   · the disclosure is a real <button> with aria-expanded (keyboard reaches the rows)
 *   · default is COLLAPSED and is not persisted across mounts
 *   · the gated-scheduling ProvisionalMark and the per-pair propose-a-time control,
 *     with its (pair, abouts) payload, are untouched
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, type QueueItem } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { SessionsSection } from "@/v3/components/flow/OperatorInbox";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const store = migrate({
  ontology: snap("domain-ontology.json"),
  atlas: snap("current-state-atlas.json"),
  overrides: snap("operator-overrides.json"),
} as Snapshot);
const queue = buildUnknownQueue(store);

// The session queue, built exactly as useProgramLedger builds it: seam (jointly-owned)
// questions grouped by function pair, typing questions routed to the dictionary instead.
const sessionMap = new Map<string, QueueItem[]>();
for (const it of queue.items) {
  if (it.status === "open" && TYPING_SLOTS.has(it.slot)) continue;
  if (it.owner.kind !== "joint") continue;
  (sessionMap.get(it.ownerLabel) ?? sessionMap.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
}
const sessionQueue = [...sessionMap.entries()]
  .map(([pair, items]) => ({ pair, items, abouts: items.map((i) => i.about) }))
  .sort((a, b) => b.items.length - a.items.length || a.pair.localeCompare(b.pair));

// React 18 wants the act() flag before any root renders.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
type Proposed = { pair: string; abouts: string[] };
let proposed: Proposed[];

const mount = (props: Partial<Parameters<typeof SessionsSection>[0]> = {}) => {
  act(() => {
    root.render(createElement(SessionsSection, {
      sessionQueue, plannedPairs: new Set<string>(), busy: null,
      onPropose: (pair: string, abouts: string[]) => { proposed.push({ pair, abouts }); },
      ...props,
    }));
  });
};
const disclosure = () => host.querySelector("#ib-sessions button[aria-expanded]") as HTMLButtonElement | null;
const rows = () => [...host.querySelectorAll("li.v3ib-seam")];
const toggle = () => act(() => { disclosure()!.click(); });
/** the two numbers as the operator reads them off the collapsed line */
const summary = () => {
  const m = /(\d+)\s+seams?,\s*(\d+)\s+questions?/.exec(disclosure()!.textContent ?? "");
  if (!m) throw new Error(`no summary numbers in: ${disclosure()!.textContent}`);
  return { seams: Number(m[1]), questions: Number(m[2]) };
};
/** the per-pair number each expanded row prints */
const rowQuestions = () => rows().map((li) => {
  const m = /(\d+)\s+joint questions?/.exec(li.textContent ?? "");
  if (!m) throw new Error(`no per-pair count in row: ${li.textContent}`);
  return Number(m[1]);
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  proposed = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Sessions — the fixture is the real programme", () => {
  it("Laila has seams, and they carry more questions than there are seams", () => {
    expect(sessionQueue.length).toBeGreaterThan(1);
    const total = sessionQueue.reduce((n, s) => n + s.abouts.length, 0);
    expect(total).toBeGreaterThan(sessionQueue.length);   // "N seams" alone under-reads the work
  });
});

describe("Sessions — collapsed by default, one line", () => {
  it("0 seams renders NOTHING (the section is hidden, not empty-stated)", () => {
    mount({ sessionQueue: [] });
    expect(host.innerHTML).toBe("");
  });

  it("with seams it renders one summary line and no rows", () => {
    mount();
    expect(host.querySelector("#ib-sessions")).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(disclosure()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("BOTH numbers stay visible collapsed — seams AND the joint-question total", () => {
    mount();
    expect(summary()).toEqual({
      seams: sessionQueue.length,
      questions: sessionQueue.reduce((n, s) => n + s.abouts.length, 0),
    });
  });

  it("the collapsed line names the joint conversation and the gate", () => {
    mount();
    const text = host.querySelector("#ib-sessions")!.textContent ?? "";
    expect(text).toContain("Sessions");
    expect(text).toContain("joint conversation");
    expect(text).toContain("scheduling gated");
    // the gated-scheduling provisional mark survives the collapse
    expect(host.querySelector("#ib-sessions .v3lc-prov")).not.toBeNull();
  });
});

describe("Sessions — the summary IS the rows added up", () => {
  it("collapsed counts equal the expanded rows' sum", () => {
    mount();
    const collapsed = summary();
    toggle();
    const perRow = rowQuestions();
    expect(perRow).toHaveLength(collapsed.seams);                                  // seams === rows
    expect(perRow.reduce((a, b) => a + b, 0)).toBe(collapsed.questions);           // questions === Σ rows
    expect(summary()).toEqual(collapsed);                                          // and the line does not move
  });

  it("expanding reveals exactly sessionQueue.length rows, one per pair", () => {
    mount();
    toggle();
    expect(rows()).toHaveLength(sessionQueue.length);
    // VISIBLE text, not raw textContent. The heading also carries a
    // visually-hidden "joint seam: " prefix (`.v3ib-sr`) so a screen reader
    // announces what the ⋈ glyph means to everyone else. `textContent` cannot
    // tell the two apart — it concatenates what is shown with what is only
    // spoken — so a correct accessibility change read here as a content change.
    // Strip the sr-only nodes and the decorative glyph, then compare.
    const visible = (el: Element): string => {
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll(".v3ib-sr, [aria-hidden='true']").forEach((n) => n.remove());
      return clone.textContent!.trim();
    };
    expect(rows().map((li) => visible(li.querySelector(".v3ib-seam-h")!)))
      .toEqual(sessionQueue.map((s) => s.pair));
  });

  it("re-collapsing hides the rows again and keeps the numbers", () => {
    mount();
    toggle();
    expect(rows().length).toBeGreaterThan(0);
    toggle();
    expect(rows()).toHaveLength(0);
    expect(disclosure()!.getAttribute("aria-expanded")).toBe("false");
    expect(summary().questions).toBe(sessionQueue.reduce((n, s) => n + s.abouts.length, 0));
  });
});

describe("Sessions — the disclosure itself", () => {
  it("is a real <button> with aria-expanded (so the keyboard gets there)", () => {
    mount();
    const btn = disclosure()!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.hasAttribute("disabled")).toBe(false);
    toggle();
    expect(disclosure()!.getAttribute("aria-expanded")).toBe("true");
    // open → it points at the body it opened
    expect(disclosure()!.getAttribute("aria-controls")).toBe("ib-sessions-body");
    expect(host.querySelector("#ib-sessions-rows")).not.toBeNull();
  });

  it("is COLLAPSED on every fresh mount — the open state is not persisted", () => {
    mount();
    toggle();
    expect(disclosure()!.getAttribute("aria-expanded")).toBe("true");
    act(() => root.unmount());
    root = createRoot(host);
    mount();
    expect(disclosure()!.getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toHaveLength(0);
  });
});

describe("Sessions — the expanded rows are unchanged", () => {
  it("every unplanned pair still offers propose-a-time, carrying its own abouts", () => {
    mount();
    toggle();
    const buttons = [...host.querySelectorAll("li.v3ib-seam .v3ib-btn")] as HTMLButtonElement[];
    expect(buttons).toHaveLength(sessionQueue.length);
    expect(buttons.every((b) => b.textContent === "propose a time")).toBe(true);
    act(() => buttons[0].click());
    expect(proposed).toEqual([{ pair: sessionQueue[0].pair, abouts: sessionQueue[0].abouts }]);
    // awaiting-a-date is still the state each row reports
    expect(rows().every((li) => li.textContent?.includes("awaiting a date"))).toBe(true);
  });

  it("a pair already on the session plan shows the recorded intent, not a second ask", () => {
    mount({ plannedPairs: new Set([sessionQueue[0].pair]) });
    toggle();
    const first = rows()[0];
    expect(first.className).toContain("planned");
    expect(first.textContent).toContain("on the session plan");
    expect(first.querySelector(".v3ib-btn")).toBeNull();
    expect([...host.querySelectorAll("li.v3ib-seam .v3ib-btn")]).toHaveLength(sessionQueue.length - 1);
  });
});
