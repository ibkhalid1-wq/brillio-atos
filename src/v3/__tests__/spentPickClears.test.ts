/**
 * A SPENT PICK IS CLEARED; AN UNSAVED ONE IS KEPT.
 *
 * Reported from the running Inbox as "do not clear after reassigned", against the
 * Owned & in-flight rows. Picking a name committed the reassignment and the owner
 * line updated — but `sel[key]` held the chosen name forever, so once the ✓ timed
 * out (5s) the row read:
 *
 *     → owner: Sales SME        [ Reassign to… ▾ ] showing "Sales SME"
 *
 * The same fact twice, the second time from a control captioned "Reassign to…",
 * which is exactly how an UNCOMMITTED pick looks. The comment above `run` claimed
 * the select "snapped back" — it never did; the comment described an intent the
 * code did not implement, which is why no guard caught it.
 *
 * The failure half matters as much: a write that throws must NOT clear the pick
 * (it is the operator's unsaved work) and must say that nothing was recorded.
 * That path used to escape as an unhandled rejection and say nothing at all.
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
const ABOUT = "el:attr:account.segment#dataType";

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

/** One question, in flight, owned by Sales Ops SME — the shape of every row in the
 *  screenshot the report came with. */
const inFlight = ledgerWith({
  assignments: [{
    kind: "assign", about: ABOUT, slot: "dataType",
    owner: { label: "Sales Operations SME", isRole: true }, by: "operator", at: AT,
  }],
} as unknown as Partial<ProgramLedger>);

const mount = (onCommit: (a: unknown) => Promise<void>) => {
  act(() => {
    root.render(createElement(OperatorInbox, {
      ledger: inFlight,
      candidates: [{ label: "Sales SME", role: "Sales" }, { label: "Sales Operations SME", role: "Sales Ops" }],
      by: "operator", onCommit,
    } as never));
  });
};

/** Owned & in-flight is a READING, so it opens closed (2026-08-13) — nothing in it
 *  is waiting on the operator. Reassigning is still an operator move and still lives
 *  here; it is one click in. Every test below starts with that click, because that is
 *  what the operator does before touching any of these controls. */
const openInFlight = () => {
  const disc = host.querySelector<HTMLButtonElement>("#ib-inflight button.v3ib-disc[aria-expanded=false]");
  if (disc) act(() => { disc.click(); });
};

/** The reassign select on the one in-flight row. */
const reassignSelect = (): HTMLSelectElement => {
  openInFlight();
  const el = host.querySelector<HTMLSelectElement>("#ib-inflight .v3ib-reassign select");
  expect(el, "the in-flight row drew no reassign select — the fixture is wrong, not the code").not.toBeNull();
  return el!;
};

/** Pick a name the way a person does: React reads the native value, so set it
 *  through the prototype setter and fire the event it listens for. */
const pick = async (name: string) => {
  const el = reassignSelect();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, name);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
};

beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("the reassign control after a reassignment that SAVED", () => {
  it("clears the pick — the owner is stated by the owner line, not by the picker", async () => {
    mount(async () => {});
    await pick("Sales SME");
    // MUTATION: drop the `setSel` delete from `run` → "Sales SME", which is the
    // control still displaying a pick it already spent.
    expect(reassignSelect().value, "the reassign select is still holding the name it committed").toBe("");
  });

  it("says what the record now holds, with a tick", async () => {
    mount(async () => {});
    await pick("Sales SME");
    openInFlight();
    const said = host.querySelector("#ib-inflight .v3ib-said");
    expect(said?.textContent).toContain("reassigned to Sales SME");
    expect(said?.className, "a saved write must not read as a failure").not.toContain("bad");
    expect(said?.getAttribute("role"), "the confirmation is silent to a screen reader").toBe("status");
  });

  it("does not leave the name in two places at once", async () => {
    // The whole complaint, stated as the property it violates: after a reassign,
    // exactly ONE control or line on the row names the new owner as current.
    mount(async () => {});
    await pick("Sales SME");
    expect(reassignSelect().value).toBe("");
  });
});

describe("the reassign control after a reassignment that DID NOT save", () => {
  it("keeps the pick — it is the operator's unsaved work", async () => {
    mount(async () => { throw new Error("network"); });
    await pick("Sales SME");
    // MUTATION: move the `setSel` delete out of the try (or into `finally`) → "".
    expect(reassignSelect().value, "a failed write threw the operator's pick away").toBe("Sales SME");
  });

  it("says nothing was recorded, and does not draw a tick over it", async () => {
    mount(async () => { throw new Error("network"); });
    await pick("Sales SME");
    openInFlight();
    const said = host.querySelector("#ib-inflight .v3ib-said");
    // MUTATION: remove the catch in `run` → null here, and an unhandled rejection.
    expect(said, "a failed write said nothing at all").not.toBeNull();
    expect(said!.textContent).toContain("did not save");
    expect(said!.className, "the failure is wearing the success mark").toContain("bad");
  });
});
