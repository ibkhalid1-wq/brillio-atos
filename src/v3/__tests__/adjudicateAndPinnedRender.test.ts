/**
 * THE TWO SECTIONS NOBODY HAS SEEN.
 *
 * Every visual check this session ran against Laila New, which has no conflicts and
 * no pin conflicts — so ADJUDICATE and PINNED — IN FLIGHT were proven only by
 * source-level guards. Source guards cannot catch a section that throws on render, a
 * header contract that silently omits a part, or a count that never reaches the page.
 *
 * These mount the Inbox with each of those populations and read the DOM.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import OperatorInbox from "@/v3/components/flow/OperatorInbox";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";

let host: HTMLDivElement;
let root: Root;
const AT = "2026-08-13T00:00:00.000Z";

/**
 * A ledger with nothing in it but the one population under test.
 *
 * The field list is the same shape `operatorQueueTruth` uses — an Inbox reads more of
 * this object than any one section needs, and a hand-picked subset fails at render
 * with an unhelpful "cannot read properties of undefined".
 */
const ledgerWith = (over: Partial<ProgramLedger>): ProgramLedger => ({
  store: createLedgerStore(),
  queue: buildUnknownQueue(createLedgerStore()),
  actions: [], assignQueue: [], sessionQueue: [], conflicts: [], assignments: [], pinConflicts: [],
  decideFates: [], schedules: [], captures: [], redirects: [], pins: [], proposals: [],
  typingLoci: [], pinnedAbouts: new Set(), proposedAbouts: new Set(), capturedAbouts: new Set(),
  soloByOwner: new Map(),
  artifactAsks: { asks: [], unattributed: { weight: 0, abouts: [] }, frameComplete: true },
  ...over,
} as unknown as ProgramLedger);

const mount = (ledger: ProgramLedger) => {
  act(() => {
    root.render(createElement(OperatorInbox, {
      ledger, candidates: [{ label: "Ada Lovelace", role: "Sales Ops" }],
      by: "operator", onCommit: async () => {},
    }));
  });
};

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Adjudicate renders, and carries the shared header contract", () => {
  const conflicts = [{ about: "el:attr:account.segment#dataType", slot: "dataType", count: 2 }];

  it("draws its section with a tag, a verb, a count badge and a disclosure", () => {
    mount(ledgerWith({ conflicts } as Partial<ProgramLedger>));
    const section = host.querySelector("#ib-adjudicate");
    expect(section, "the adjudicate section did not render at all").not.toBeNull();
    expect(section!.querySelector(".v3ib-verb")!.textContent).toBe("Adjudicate");
    expect(section!.querySelector(".v3ib-n")!.textContent).toContain("1 conflict");
    expect(section!.querySelector("button.v3ib-disc[aria-expanded]"),
      "no disclosure — the section cannot be collapsed like its siblings").not.toBeNull();
    expect(section!.querySelector(".v3lc-own, .v3lc-src"), "no ownership/source tag").not.toBeNull();
  });

  it("carries its kind accent, so the board sorts by decision", () => {
    mount(ledgerWith({ conflicts } as Partial<ProgramLedger>));
    expect(host.querySelector("#ib-adjudicate")!.className).toContain("is-adjudicate");
  });
});

describe("Pinned — in flight renders, and carries the same contract", () => {
  const pin = { kind: "pin" as const, about: "el:attr:account.segment#dataType", slot: "dataType",
    owner: { label: "Ada Lovelace", isRole: false }, sentAt: AT, by: "operator", at: AT };
  const pinConflicts = [{ about: pin.about, slot: "dataType", pinned: "Ada Lovelace", derived: "Sales Ops", pin }];

  it("draws its section with the same parts", () => {
    mount(ledgerWith({ pinConflicts } as unknown as Partial<ProgramLedger>));
    const section = host.querySelector("#ib-pinned");
    expect(section, "the pinned section did not render at all").not.toBeNull();
    expect(section!.querySelector(".v3ib-verb")!.textContent).toContain("Pinned");
    expect(section!.querySelector(".v3ib-n")!.textContent).toContain("1 question");
    expect(section!.querySelector("button.v3ib-disc[aria-expanded]")).not.toBeNull();
  });

  it("names both sides of the disagreement, or the operator cannot decide it", () => {
    mount(ledgerWith({ pinConflicts } as unknown as Partial<ProgramLedger>));
    const text = host.querySelector("#ib-pinned")!.textContent ?? "";
    expect(text).toContain("Ada Lovelace");   // who it was sent to
    expect(text).toContain("Sales Ops");      // who the derivation now wants
  });
});
