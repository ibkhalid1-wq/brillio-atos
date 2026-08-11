/**
 * THE OPERATOR CAN CLOSE A DURABLE LINK — the missing half of the closure rule.
 *
 * `portalLinkState` has honoured `pack.closedAt` since it existed, and the edge refuses
 * a POST to a link that carries it. Nothing ever SET it. A stakeholder could finish their
 * own link with an "I'm done" send; the operator's only lever was "don't re-mint", which
 * closes nothing at all — the token keeps resolving and keeps taking answers. This is the
 * verb that was missing, and deliberately nothing more than that verb.
 *
 * What is pinned here, because each one is a way this control could do harm:
 *   · it stamps `closedAt` and the SHARED rule then reads the link as closed (no second
 *     closure definition on the client — `linkIsOpen` is `acceptsSubmission`);
 *   · it does NOT delete or alter a submission, a recap row, `respondedAt`, or the token.
 *     Closing says "stop asking", never "unsay what they said";
 *   · it is REVERSIBLE: re-minting clears `closedAt`, INCLUDING when the re-mint carries
 *     the identical ask — the idempotency guard that makes a same-ask mint a no-op would
 *     otherwise make the control's "reopen any time" copy a lie;
 *   · a closed link's row SAYS it is closed and keeps its controls. A row that silently
 *     loses its buttons is indistinguishable from one that was never sent.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import {
  closeDurableLink, linkIsOpen, listInterviewPacks, mintFollowUpPack, mintReviewPack,
} from "@/v3/components/flow/flowPortal";
import { acceptsSubmission } from "@shared/portalLinkState";
import TheLine from "@/v3/components/flow/TheLine";

const WHO = "Sarah Chen";
const LIVE_PACK = {
  id: "pack-1", stakeholder: WHO, role: "Follow-up", intro: "",
  questions: ["Q1?", "Q2?"], token: "tok-1", movementId: "listen",
  createdAt: "2026-07-01T00:00:00.000Z", askUpdatedAt: "2026-07-01T00:00:00.000Z",
  // One PARTIAL send already on the record — the state that must survive a close.
  submissions: [{ ts: "2026-07-04T09:00:00.000Z", kind: "interview", preview: "answered 1 of 2" }],
  respondedAt: "2026-07-04T09:00:00.000Z",
};

const programme = (inner: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", name: "Test", rawData: inner } as unknown as ProgramSummary);
const withPack = (over: Record<string, unknown> = {}) =>
  programme({ flowInterviewPacks: [{ ...LIVE_PACK, ...over }] });
const packOf = (blob: Record<string, unknown> | null) => listInterviewPacks(programme(blob ?? {}))[0];

// ── PART A · the mutator ────────────────────────────────────────────────────────────
describe("closeDurableLink — the operator's close, and nothing more", () => {
  it("stamps closedAt, and the SHARED rule then reads the link as closed", () => {
    const before = listInterviewPacks(withPack())[0];
    expect(linkIsOpen(before)).toBe(true);                      // pre-condition: partial ⇒ open
    const pack = packOf(closeDurableLink(withPack(), WHO, "you"));
    expect(pack.closedAt).toBeTruthy();
    expect(linkIsOpen(pack)).toBe(false);
    // …and the EDGE would refuse the next submission on exactly this pack — the operator
    // is not looking at a client-only idea of "closed".
    expect(acceptsSubmission(pack as unknown as Record<string, unknown>)).toMatchObject({ ok: false, status: 409 });
  });

  it("does NOT touch anything already on the record — submissions, recap, respondedAt, token", () => {
    const blob = closeDurableLink(withPack(), WHO, "you")!;
    const pack = packOf(blob);
    expect(pack.submissions).toHaveLength(1);
    expect(pack.submissions?.[0]).toMatchObject({ ts: "2026-07-04T09:00:00.000Z", preview: "answered 1 of 2" });
    expect(pack.submissions?.[0].final).toBeUndefined();        // it never fakes an "I'm done"
    expect(pack.respondedAt).toBe(LIVE_PACK.respondedAt);
    expect(pack.token).toBe(LIVE_PACK.token);                   // the link still resolves
    expect(pack.questions).toEqual(LIVE_PACK.questions);
    expect(pack.id).toBe(LIVE_PACK.id);
  });

  it("leaves the quarantine inbox alone — closing a link is not a verdict on its answers", () => {
    const inbox = [{ id: "i1", kind: "interview", stakeholder: WHO, receivedAt: "2026-07-04", text: "…" }];
    const blob = closeDurableLink(programme({ flowInterviewPacks: [LIVE_PACK], flowPortalInbox: inbox }), WHO, "you")!;
    expect(blob.flowPortalInbox).toEqual(inbox);
  });

  it("is attested, and idempotent — closing an already-closed link writes nothing", () => {
    const blob = closeDurableLink(withPack(), WHO, "you")!;
    const log = blob.flowAttestations as Array<Record<string, unknown>>;
    expect(String(log[log.length - 1].action)).toContain("Closed the durable link");
    const closed = programme(blob);
    expect(closeDurableLink(closed, WHO, "you")).toBeNull();
    expect(closeDurableLink(withPack(), "Nobody At All", "you")).toBeNull();
    expect(closeDurableLink(programme({}), WHO, "you")).toBeNull();
  });

  it("REVERSIBLE — re-minting the IDENTICAL ask reopens it (the copy promises this)", () => {
    const closed = programme(closeDurableLink(withPack(), WHO, "you")!);
    expect(linkIsOpen(listInterviewPacks(closed)[0])).toBe(false);
    // The same two questions the pack already carries: on an OPEN link this mint is a
    // deliberate no-op. On a CLOSED one it is the reopen, so it must land.
    const blob = mintFollowUpPack(closed,
      { movementId: "listen", who: WHO, questions: LIVE_PACK.questions, captureField: "interviewTranscripts" }, "you");
    expect(blob, "a same-ask re-mint on a closed link must not be swallowed as idempotent").not.toBeNull();
    const pack = packOf(blob);
    expect(pack.closedAt).toBeUndefined();
    expect(linkIsOpen(pack)).toBe(true);
    expect(pack.token).toBe(LIVE_PACK.token);                   // same durable token
    expect(pack.submissions).toHaveLength(1);                   // their answer survives the reopen
  });

  it("re-minting an OPEN link with the identical ask is still a no-op (the guard is intact)", () => {
    expect(mintFollowUpPack(withPack(),
      { movementId: "listen", who: WHO, questions: LIVE_PACK.questions, captureField: "interviewTranscripts" }, "you")).toBeNull();
  });

  it("a NEW ask reopens too, and so does a review share — both mints clear the closure", () => {
    const closed = programme(closeDurableLink(withPack(), WHO, "you")!);
    expect(packOf(mintFollowUpPack(closed,
      { movementId: "listen", who: WHO, questions: ["Something else?"], captureField: "x" }, "you")).closedAt).toBeUndefined();
    expect(packOf(mintReviewPack(closed, {
      movementId: "envision", who: WHO, role: "Reviewer", captureField: "x",
      reviewKind: "agentify", review: { kind: "agentify" }, questions: ["Check this?"], intro: "i",
    }, "you")).closedAt).toBeUndefined();
  });
});

// ── PART B · the control on the row ─────────────────────────────────────────────────
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const RENDER_PROGRAM = (packOver: Record<string, unknown> = {}) => ({
  id: "p1", name: "Test", client: "Test",
  rawData: {
    data: {
      discoveryKit: { interviews: [{ stakeholder: WHO, role: "Head of Sales", questions: ["Walk us through your part."] }] },
      flowInterviewPacks: [{ ...LIVE_PACK, ...packOver }],
    },
  },
} as unknown as ProgramSummary);

let host: HTMLDivElement;
let root: Root;
let closes: string[];
let mints: string[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  closes = [];
  mints = [];
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const mount = (program: ProgramSummary, withCloseHandler = true) => {
  act(() => {
    root.render(createElement(TheLine, {
      program,
      onSaveInputs: async () => {},
      onMintFollowUp: async (input) => { mints.push(input.who); return "https://example.test/?flowRespond=p1.tok-1"; },
      ...(withCloseHandler ? { onCloseLink: async (who: string) => { closes.push(who); } } : {}),
    }));
  });
  const discover = [...host.querySelectorAll('[role="tab"]')]
    .find((b) => text(b).startsWith("Discover")) as HTMLButtonElement;
  act(() => { discover.click(); });
};

const actionsFor = (name: string): HTMLElement => {
  const row = [...host.querySelectorAll(".v3ln-cr")]
    .find((el) => text(el.querySelector(".v3ln-cr-who b")) === name);
  if (!row) throw new Error(`no Discover card for ${name}`);
  return row.querySelector(".v3ln-cr-act") as HTMLElement;
};
const buttonSaying = (host: HTMLElement, needle: string) =>
  [...host.querySelectorAll("button")].find((b) => text(b).includes(needle));

describe("the close control on the Discover row", () => {
  it("an OPEN link offers close, and the first click ARMS rather than writing", () => {
    mount(RENDER_PROGRAM());
    const acts = actionsFor(WHO);
    const close = buttonSaying(acts, "close link")!;
    expect(close, "an open link must offer a close").toBeTruthy();
    // The copy states the two things an operator needs before pressing it.
    expect(close.getAttribute("title")).toMatch(/Nothing already sent is deleted or changed/);
    expect(close.getAttribute("title")).toMatch(/reopen/i);
    act(() => { close.click(); });
    expect(closes, "the first click must not write").toEqual([]);
    expect(text(actionsFor(WHO))).toMatch(/confirm — close \(reopen any time\)/);
  });

  it("the confirming click writes the close, once", async () => {
    mount(RENDER_PROGRAM());
    act(() => { buttonSaying(actionsFor(WHO), "close link")!.click(); });
    await act(async () => { buttonSaying(actionsFor(WHO), "confirm — close")!.click(); });
    expect(closes).toEqual([WHO]);
  });

  it("a CLOSED link SAYS so, and keeps its controls — copy the link, or reopen it", () => {
    mount(RENDER_PROGRAM({ closedAt: "2026-07-06T00:00:00.000Z" }));
    const acts = actionsFor(WHO);
    expect(text(acts)).toContain("link closed");
    // it did not silently lose its buttons…
    expect(buttonSaying(acts, "⎘ link"), "the link is still copyable").toBeTruthy();
    expect(buttonSaying(acts, "reopen"), "the close must be reversible from the row").toBeTruthy();
    // …and it no longer offers a second close.
    expect(buttonSaying(acts, "close link")).toBeUndefined();
  });

  it("reopen goes through the MINT — the one path that clears closedAt", async () => {
    mount(RENDER_PROGRAM({ closedAt: "2026-07-06T00:00:00.000Z" }));
    await act(async () => { buttonSaying(actionsFor(WHO), "reopen")!.click(); });
    expect(mints).toEqual([WHO]);
  });

  it("no close handler ⇒ no close control (a read-only lens stays read-only)", () => {
    mount(RENDER_PROGRAM(), false);
    expect(buttonSaying(actionsFor(WHO), "close link")).toBeUndefined();
    expect(buttonSaying(actionsFor(WHO), "⎘ link")).toBeTruthy();
  });
});
