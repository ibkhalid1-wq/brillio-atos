/**
 * THE OPERATOR'S LINK LIST GROUPS ON CLOSURE, NOT ON "LAST HEARD FROM".
 *
 * `visibleLinks` split a person's packs into `answered` / `waiting` on `pack.respondedAt`.
 * That was true when a link was one-shot. It stopped being true when the durable link
 * learned PARTIAL submissions: the edge stamps `respondedAt: now` on EVERY send, partial
 * or final, and stamps `closedAt` only on an explicit "I'm done"
 * (`flow-portal/index.ts` — "…`respondedAt` keeps its old meaning (last heard from)").
 *
 * So a stakeholder who answered 2 of 8 and pressed send read as ANSWERED on the
 * operator's list while their link was still open and the operator was still waiting on
 * them — the worst possible reading, because it retires the follow-up.
 *
 * The fix is not a second closure rule. `linkIsOpen` calls `acceptsSubmission` from
 * `@shared/portalLinkState` — the SAME function the edge gates POSTs with. If the edge
 * would take another answer, the operator's list says the link is open. The tests below
 * therefore assert the client and the edge rule agree case by case, so the two can never
 * drift into a disagreement about the same link.
 *
 * PART B mounts the surface. `visibleLinks` was correct and CALLED BY NOTHING: TheLine's
 * Discover row read its link with `[...packs].reverse().find(matches)` — last in the blob
 * wins, closure never consulted — so the rule proved here did not reach a single pixel.
 * It does now, and Part B is what says so.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { listInterviewPacks, linkIsOpen, visibleLinks } from "@/v3/components/flow/flowPortal";
import { acceptsSubmission } from "@shared/portalLinkState";
import TheLine from "@/v3/components/flow/TheLine";

const programme = (packs: unknown[]): ProgramSummary =>
  ({ id: "p1", name: "Test", rawData: { flowInterviewPacks: packs } } as unknown as ProgramSummary);

const base = {
  role: "Follow-up", questions: ["Q1?", "Q2?"], token: "t", createdAt: "2026-07-01T00:00:00.000Z",
  askUpdatedAt: "2026-07-01T00:00:00.000Z",
};
/** The edge's own shape for a send: `respondedAt` ALWAYS moves; `final`/`closedAt` only
 *  when they said they were done. */
const partial = (ts: string) => ({ submissions: [{ ts, kind: "interview", preview: "2 of 8" }], respondedAt: ts });
const finalSend = (ts: string) => ({ submissions: [{ ts, kind: "interview", preview: "done", final: true }], respondedAt: ts, closedAt: ts });

describe("visibleLinks — open means the link still takes answers", () => {
  const packs = listInterviewPacks(programme([
    { ...base, id: "partial", stakeholder: "Sarah", token: "t1", ...partial("2026-07-04T09:00:00.000Z") },
    { ...base, id: "finished", stakeholder: "Dan", token: "t2", ...finalSend("2026-07-04T09:00:00.000Z") },
    // LEGACY: answered before submission history existed. No `submissions`, no
    // `closedAt` — one-shot by construction, and old semantics are preserved.
    { ...base, id: "legacy", stakeholder: "Mo", token: "t3", respondedAt: "2026-07-03T00:00:00.000Z" },
  ]));
  const byId = (id: string) => packs.find((p) => p.id === id)!;

  it("a PARTIAL submission leaves the link OPEN — the defect, stated", () => {
    const pack = byId("partial");
    // pre-condition: the pack carries exactly the stamp that used to mean "answered"
    expect(pack.respondedAt).toBeTruthy();
    expect(pack.closedAt).toBeUndefined();
    expect(pack.submissions?.[0].final).toBeUndefined();
    expect(linkIsOpen(pack)).toBe(true);
  });

  it("an explicit FINAL send closes the link", () => {
    const pack = byId("finished");
    expect(pack.submissions?.[0].final).toBe(true);
    expect(linkIsOpen(pack)).toBe(false);
  });

  it("a LEGACY pack carrying only respondedAt stays closed — old semantics preserved", () => {
    const pack = byId("legacy");
    expect(pack.submissions).toBeUndefined();
    expect(pack.closedAt).toBeUndefined();
    expect(linkIsOpen(pack)).toBe(false);
  });

  it("an operator `closedAt` closes it, with no final send and no submission of any kind", () => {
    const [pack] = listInterviewPacks(programme([
      { ...base, id: "op", stakeholder: "Ada", ...partial("2026-07-04T09:00:00.000Z"), closedAt: "2026-07-05T00:00:00.000Z" },
    ]));
    expect(linkIsOpen(pack)).toBe(false);
    // …and the submission it already holds is untouched by the closure.
    expect(pack.submissions).toHaveLength(1);
    expect(pack.submissions?.[0].preview).toBe("2 of 8");
  });

  it("a link never answered at all is open", () => {
    const [pack] = listInterviewPacks(programme([{ ...base, id: "fresh", stakeholder: "New" }]));
    expect(linkIsOpen(pack)).toBe(true);
  });

  it("ONE DEFINITION — the operator's read is the edge's own gate, case for case", () => {
    for (const pack of packs) {
      const edge = acceptsSubmission(pack as unknown as Record<string, unknown>).ok;
      expect(linkIsOpen(pack), `${pack.id} disagrees with the edge`).toBe(edge);
    }
  });

  it("the list shows the newest OPEN and the newest CLOSED link per person — grouped on closure", () => {
    // Sarah has three: an old open one, a newer open one carrying a PARTIAL send, and a
    // finished one. Grouped on `respondedAt` the partial would occupy the "answered"
    // slot and HIDE the genuinely finished link; grouped on closure both slots are right.
    const sarah = listInterviewPacks(programme([
      { ...base, id: "old-open", stakeholder: "Sarah", token: "a", createdAt: "2026-07-01T00:00:00.000Z" },
      { ...base, id: "new-open", stakeholder: "Sarah", token: "b", createdAt: "2026-07-05T00:00:00.000Z", ...partial("2026-07-06T00:00:00.000Z") },
      { ...base, id: "closed", stakeholder: "Sarah", token: "c", createdAt: "2026-07-02T00:00:00.000Z", ...finalSend("2026-07-03T00:00:00.000Z") },
    ]));
    const shown = visibleLinks(sarah);
    expect(shown.map((p) => p.id).sort()).toEqual(["closed", "new-open"]);
    expect(shown.filter((p) => linkIsOpen(p)).map((p) => p.id)).toEqual(["new-open"]);
    expect(shown.filter((p) => !linkIsOpen(p)).map((p) => p.id)).toEqual(["closed"]);
  });
});

// ── PART B · the rule reaches the surface ───────────────────────────────────────────
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const WHO = "Sarah Chen";
const KIT = { interviews: [{ stakeholder: WHO, role: "Head of Sales", questions: ["Walk us through your part."] }] };

/**
 * TWO packs for one person, in the order the blob actually stores them.
 *
 * `capInterviewPacks` re-sorts on DURABILITY — `askUpdatedAt || submissions || live
 * review` — and puts the durable ones LAST. A link that has been ANSWERED carries
 * `submissions`, so a FINISHED link is durable and sinks to the tail; a link that has
 * never been answered and predates `askUpdatedAt` is not, and stays at the head. Blob
 * order therefore promotes the finished link above the live one, which is exactly the
 * ordering the old `.reverse().find()` trusted.
 */
const LIVE = {                                   // open: no submissions, no closedAt
  id: "live", stakeholder: WHO, role: "Follow-up", questions: ["Q1?"], token: "tok-live",
  movementId: "listen", createdAt: "2026-07-05T00:00:00.000Z",
};
const FINISHED = {                               // closed: an explicit "I'm done" send
  id: "finished", stakeholder: WHO, role: "Follow-up", questions: ["Q0?"], token: "tok-dead",
  movementId: "listen", createdAt: "2026-07-01T00:00:00.000Z", askUpdatedAt: "2026-07-01T00:00:00.000Z",
  submissions: [{ ts: "2026-07-02T00:00:00.000Z", kind: "interview", preview: "done", final: true }],
  respondedAt: "2026-07-02T00:00:00.000Z", closedAt: "2026-07-02T00:00:00.000Z",
};

const RENDER_PROGRAM = (packs: unknown[]) => ({
  id: "p1", name: "Test", client: "Test",
  rawData: { data: { discoveryKit: KIT, flowInterviewPacks: packs } },
} as unknown as ProgramSummary);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const mount = (program: ProgramSummary) => {
  act(() => {
    root.render(createElement(TheLine, {
      program,
      onSaveInputs: async () => {},
      onMintFollowUp: async () => "https://example.test/?flowRespond=p1.MINTED",
      onCloseLink: async () => {},
    }));
  });
  const discover = [...host.querySelectorAll('[role="tab"]')]
    .find((b) => text(b).startsWith("Discover")) as HTMLButtonElement;
  act(() => { discover.click(); });
};

const rowFor = (name: string): HTMLElement => {
  const row = [...host.querySelectorAll(".v3ln-cr")]
    .find((el) => text(el.querySelector(".v3ln-cr-who b")) === name);
  if (!row) throw new Error(`no Discover card for ${name}`);
  return row as HTMLElement;
};
const actionsFor = (name: string) => rowFor(name).querySelector(".v3ln-cr-act") as HTMLElement;
const buttonSaying = (scope: HTMLElement, needle: string) =>
  [...scope.querySelectorAll("button")].find((b) => text(b).includes(needle));

describe("the Discover row reads its link through visibleLinks", () => {
  it("a person with a finished link AND a live one reads OPEN — blob order does not decide it", () => {
    // pre-condition: blob order really does put the closed link last, so `.reverse()`
    // would land on it. This is the defect, stated before it is fixed.
    const packs = listInterviewPacks(RENDER_PROGRAM([LIVE, FINISHED]));
    expect(packs[packs.length - 1].id).toBe("finished");
    expect(linkIsOpen(packs[packs.length - 1])).toBe(false);
    expect(visibleLinks(packs).find(linkIsOpen)?.id).toBe("live");

    mount(RENDER_PROGRAM([LIVE, FINISHED]));
    const acts = actionsFor(WHO);
    expect(text(acts), "the row must not claim a live link is closed").not.toContain("link closed");
    expect(buttonSaying(acts, "close link"), "an open link offers a close").toBeTruthy();
    expect(buttonSaying(acts, "reopen"), "nothing to reopen — the live link is open").toBeUndefined();
  });

  it("⎘ link hands over the LIVE token, not the dead one", async () => {
    mount(RENDER_PROGRAM([LIVE, FINISHED]));
    await act(async () => { buttonSaying(actionsFor(WHO), "⎘ link")!.click(); });
    const url = (rowFor(WHO).querySelector(".v3ln-cr-url") as HTMLInputElement).value;
    expect(url, "the operator was handed a URL that refuses answers").toContain("tok-live");
    expect(url).not.toContain("tok-dead");
    // …and it copied the link that exists, rather than minting a second one.
    expect(url).not.toContain("MINTED");
  });

  it("with ONLY a finished link the row still says closed — this narrows nothing", () => {
    mount(RENDER_PROGRAM([FINISHED]));
    const acts = actionsFor(WHO);
    expect(text(acts)).toContain("link closed");
    expect(buttonSaying(acts, "reopen")).toBeTruthy();
    expect(buttonSaying(acts, "close link")).toBeUndefined();
  });
});
