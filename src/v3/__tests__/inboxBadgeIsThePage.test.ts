/**
 * THE BADGE IS THE PAGE — asserted by RENDERING both and counting what appears.
 *
 * This file replaces a tautology. finalGateInvariants' headline invariant (c) used to
 * read:
 *
 *     expect(inboxWaitingCountFrom(programInboxItems(p), l)).toBe(inboxWaitingCount(p, l))
 *
 * and flowInbox.ts DEFINES `inboxWaitingCount` as exactly that expression. There is no
 * input for which it can fail. The invariant it claimed to defend — the rail badge equals
 * what the Inbox page actually draws — was asserted NOWHERE, by anything. Every other
 * test in the suite compares one arithmetic definition against another arithmetic
 * definition; not one of them had ever looked at the DOM.
 *
 * So this one mounts the real FlowShell (which owns the rail badge AND renders the Inbox
 * page, both from one `useProgramLedger`), reads the BADGE off the dock, counts the ROWS
 * on the page, and asserts they are the same integer. It fails if any term is counted and
 * not drawn, or drawn and not counted.
 *
 * FIXTURES ARE REAL. The ledger half comes from the Laila snapshot loaded into a
 * programme blob exactly as the app stores it (`domainOntology` / `currentStateAtlas` /
 * `flowOperatorOverrides`), so FlowShell runs its own migration and the numbers below are
 * the programme's, not invented ones. Four shapes:
 *   (a) empty            → no badge, no rows, the quiet block earns the page
 *   (b) ledger only      → badge > 0 with ZERO record-side rows (the bug that started this)
 *   (c) mixed            → record rows + ledger rows, one badge over both
 *   (d) mixed + a ruling → the decided trace: drawn, deliberately NOT counted
 *
 * THE ONE DELIBERATE DIVERGENCE, encoded rather than assumed away:
 * Sessions collapses ELEVEN pair rows into ONE summary line reading "11 seams, 49
 * questions", and the badge term is the 49. So `pageWaiting` reads the sessions term off
 * that summary LINE — the number the operator's eye actually lands on — instead of
 * counting `<li>`s, and a separate test expands the disclosure and proves the 49 is the
 * eleven rows added up. A second divergence, the decided trace, is subtracted by name:
 * `rendered = waiting + decided` (operatorQueue.ts), history the page keeps after the
 * badge has correctly gone quiet.
 *
 * D1 — BADGE OVER AN EMPTY PAGE — is the defect this test exists to have caught.
 * `programInboxItems` counts `listApprovalResponses` into `items.total` (and so into the
 * badge) UNCONDITIONALLY, while FlowShell drew those rows only `onRecordApproval ? … :
 * null` — and the prop was OPTIONAL. Latent only because AppShellV3 always passed it. The
 * fix makes the prop REQUIRED and the render unconditional; the last case here mounts with
 * the handler missing AT RUNTIME (a mount site that forgot it — now a type error) and
 * proves the row is drawn anyway. Restore the `onRecordApproval ? … : null` gate and this
 * file goes red on both mixed cases: badge 58, page 57.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { readConflicts } from "@/v3/lib/ledger/useProgramLedger";
import FlowShell from "@/v3/components/flow/FlowShell";
import { codeOnly } from "./helpers/sourceGuards";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));

// The real programme, in the shape the blob stores it — FlowShell migrates it itself.
const LAILA_BLOB = {
  domainOntology: snap("domain-ontology.json") as Record<string, unknown>,
  currentStateAtlas: snap("current-state-atlas.json") as Record<string, unknown>,
  flowOperatorOverrides: snap("operator-overrides.json") as unknown[],
};
// The same migration, run here, only to pick REAL loci for the operator actions below —
// an action on an invented `about` would render a question about nothing.
const lailaStore = migrate({
  ontology: LAILA_BLOB.domainOntology,
  atlas: LAILA_BLOB.currentStateAtlas,
  overrides: LAILA_BLOB.flowOperatorOverrides as Array<Record<string, unknown>>,
} as Snapshot);
const lailaQueue = buildUnknownQueue(lailaStore);

/**
 * THE INDEPENDENT WITNESS for the Sessions term.
 *
 * The collapsed summary prints `sessionQuestionCount(sessionQueue)` — Σ `abouts.length` —
 * and each expanded row prints its own `abouts.length`. So "Σ rows === summary" is
 * ARITHMETICALLY GUARANTEED: if `abouts` held the wrong set, both sides move together, the
 * assertion stays green, and the operator still reads a wrong number. That is precisely
 * what made the Sessions term of badge === page vacuous.
 *
 * This recomputes the joint-question total from the QUEUE ITEMS — the upstream definition
 * `sessionQueue` is a projection OF — so it never routes through an `abouts` array at any
 * point. It mirrors useProgramLedger's own loop, in that loop's order: open typing
 * questions leave for the dictionary FIRST (a BLOCKED typing question is not in the
 * dictionary bucket and so stays), and whatever is jointly owned after that is a session
 * question. Frozen loci are subtracted last, because a locus awaiting adjudication is not
 * a conversation anyone can schedule (see `unfrozenQueues`).
 */
const FROZEN_ABOUTS = new Set(readConflicts(lailaStore).map((c) => c.about));
const jointQuestionsFromItems = lailaQueue.items.filter((i) =>
  !(i.status === "open" && TYPING_SLOTS.has(i.slot))
  && i.owner.kind === "joint"
  && !FROZEN_ABOUTS.has(i.about)).length;

const AT = "2026-08-01T00:00:00Z";
type Props = Parameters<typeof FlowShell>[0];
const prog = (data: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", name: "Fixture", rawData: { data } } as unknown as ProgramSummary);

// ── the four programme shapes ───────────────────────────────────────────────────────
const EMPTY = prog({});
const LEDGER_ONLY = prog({ ...LAILA_BLOB });
/** One approval reply, one interview response, one unrecognised role: three record-side
 *  rows, of three different kinds, on top of the whole ledger half. */
const RECORD_SIDE = {
  flowPortalInbox: [
    {
      id: "ap-1", kind: "approval", artifactId: "currentStateAtlas", movementId: "listen",
      artifactTitle: "Current-State Atlas", verdict: "approved",
      approver: { name: "Dana", role: "Sponsor" }, receivedAt: AT,
    },
    { id: "pi-1", kind: "interview", stakeholder: "Ada", role: "Ops", receivedAt: AT, text: "we reconcile it weekly" },
  ],
  phaseInputs: {
    listen: { _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Ada", role: "Regional Ops", roleResolved: false }]) },
  },
};
const MIXED = prog({ ...LAILA_BLOB, ...RECORD_SIDE });
/** …plus two operator verbs: one assignment (an in-flight row, WAITING) and one
 *  decide-fate (a decided-trace row, RENDERED but never waiting). */
const RULED = prog({
  ...LAILA_BLOB,
  ...RECORD_SIDE,
  phaseInputs: {
    listen: {
      ...RECORD_SIDE.phaseInputs.listen,
      _operatorActions: JSON.stringify([
        {
          kind: "assign", about: lailaQueue.items[0].about, slot: lailaQueue.items[0].slot,
          owner: { label: "Sales Ops", isRole: true }, by: "op", at: AT,
        },
        {
          kind: "decide-fate", about: lailaQueue.items[1].about, slot: lailaQueue.items[1].slot,
          decision: "out-of-scope", reason: "not in this programme", by: "op", at: AT,
        },
      ]),
    },
  },
});
/** THE SHAPE (d) CANNOT REACH: one ruling and nothing else at all — no ledger blob, no
 *  record-side items, no second operator verb. `waiting === 0` while `decided === 1`, so
 *  the badge is legitimately hidden and the page is legitimately not empty. */
const DECIDED_ONLY = prog({
  phaseInputs: {
    listen: {
      _operatorActions: JSON.stringify([{
        kind: "decide-fate", about: lailaQueue.items[1].about, slot: lailaQueue.items[1].slot,
        decision: "out-of-scope", reason: "not in this programme", by: "op", at: AT,
      }]),
    },
  },
});

// React 18 wants the act() flag before any root renders.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const noop = async () => {};
/** Every FlowShell prop, stubbed. `onRecordApproval` is in here because it is REQUIRED —
 *  removing it from this object is a compile error, which is the D1 fix working. */
const shellProps = (program: ProgramSummary): Props => ({
  program, programs: [program], runningAgentIds: new Set<string>(),
  onSelectProgram: () => {}, onCreateProgram: () => {}, onDrillDown: () => {},
  onOpenSetup: () => {}, onOpenCopilot: () => {}, onRunAgent: () => {},
  onSaveInputs: noop, onResolveDecision: noop,
  fleet: [], loadMovementSpend: async () => ({}), onSetHaltAll: noop,
  onToggleAgentHalt: noop, onSetMovementBudget: noop, onMintPacks: noop,
  onMintDemoInvites: noop, onCompileShipLanes: noop, onToggleShipItem: noop,
  onSetShipLane: noop, onHydratePrograms: noop, onScheduleFollowUp: noop,
  onMintFollowUp: async () => null, onMintReview: async () => null, onMintBrief: async () => null,
  onRecordShowPass: noop, onSaveArtifactDoc: noop,
  onIngestPortalItem: noop, onDismissPortalItem: noop, onRecordApproval: noop,
} as unknown as Props);

/** Mount the shell and land on the Inbox. FlowShell's own landing rule opens Today only
 *  when something waits, so the empty case has to be navigated to — which is the point:
 *  the empty page must be reachable and must be empty. */
const mount = (program: ProgramSummary, patch: Partial<Props> = {}) => {
  act(() => { root.render(createElement(FlowShell, { ...shellProps(program), ...patch })); });
  const inbox = [...host.querySelectorAll("nav.v3fs-dock button")]
    .find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Inbox")) as HTMLButtonElement;
  act(() => { inbox.click(); });
};

const n = (sel: string) => host.querySelectorAll(sel).length;
/** THE BADGE — the integer on the rail's Inbox item. Absent === 0 (it hides at 0). */
const badge = (): number => Number(host.querySelector(".v3fs-dock-n")?.textContent ?? 0);
/** The Sessions summary line's question total, read as an operator reads it. */
const sessionsLine = (): number => {
  const line = host.querySelector("#ib-sessions button[aria-expanded]");
  if (!line) return 0;                                      // 0 seams → the section is hidden
  const m = /(\d+)\s+question/.exec(line.textContent ?? "");
  if (!m) throw new Error(`no question total on the sessions line: ${line.textContent}`);
  return Number(m[1]);
};

/**
 * WHAT THE PAGE IS SHOWING, counted off the DOM — one entry per thing an operator can see
 * and act on. Every selector is a row the surfaces actually render; nothing here re-reads
 * a count out of the ledger.
 */
const page = () => {
  const record = n("section.v3fs-inbox article.v3fs-dec");   // decisions/portal/approvals/disputes/roles/coverage/exceptions
  const assign = n("#ib-assign li.v3ib-grp-q");              // per QUESTION, not per element group
  const sessions = sessionsLine();                           // the collapsed line's own number — see the file header
  const adjudicate = n("#ib-adjudicate li.v3ib-row");
  const pinned = n("#ib-pinned li.v3ib-row");
  const inFlight = n("#ib-inflight li.v3ib-row");
  const chase = n(".v3ib-dict-ask");                         // one per SoR ask + one for the unattributed residue
  const decided = n("li.v3ib-row.is-decided");               // HISTORY — drawn, never waiting
  return {
    record, assign, sessions, adjudicate, pinned, inFlight, chase, decided,
    /** what the badge should equal */
    waiting: record + assign + sessions + adjudicate + pinned + inFlight + chase,
    /** every row on the page, the trace included */
    rendered: record + assign + sessions + adjudicate + pinned + inFlight + chase + decided,
  };
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // jsdom has no scrollTo; the view switch calls it. Stub, so the console stays honest.
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the rail badge equals the rows the Inbox page renders", () => {
  it("(a) an empty programme: no badge, no rows, the quiet block earns the page", () => {
    mount(EMPTY);
    expect(badge()).toBe(0);
    expect(host.querySelector(".v3fs-dock-n")).toBeNull();   // hidden, not a rendered "0"
    expect(page().rendered).toBe(0);
    expect(n(".v3ib")).toBe(0);                              // the whole operator inbox null-renders
    expect(n("section.v3fs-inbox")).toBe(0);                 // …and so does the record queue
    expect(n(".v3fs-quiet")).toBe(1);
  });

  it("(b) ledger items only — a NON-ZERO badge with zero record-side rows", () => {
    // This is the reported shape: nothing on the programme blob, an Inbox full of seams
    // and dictionary asks, and (before the fix that this test now guards) a bare icon.
    mount(LEDGER_ONLY);
    const p = page();
    expect(p.record).toBe(0);
    expect(p.waiting).toBeGreaterThan(0);
    expect(badge()).toBe(p.waiting);
    expect(n(".v3fs-quiet")).toBe(0);                        // "Nothing needs you" would be a lie
  });

  it("(c) a mixed programme — one badge over both halves of the page", () => {
    mount(MIXED);
    const p = page();
    expect(p.record).toBe(3);                                // approval + interview + unresolved role
    expect(p.sessions).toBeGreaterThan(0);                   // and the ledger half is still there
    expect(p.chase).toBeGreaterThan(0);
    expect(badge()).toBe(p.waiting);
    // the record section's own "N items" header is the same three rows
    expect(host.querySelector("section.v3fs-inbox .v3fs-ph span")?.textContent).toBe("3 items");
  });

  it("(d) a ruled unknown: the decided trace is DRAWN and is NOT on the badge", () => {
    mount(RULED);
    const p = page();
    expect(p.inFlight).toBe(1);                              // the assignment is waiting…
    expect(p.decided).toBe(1);                               // …the ruling is history
    expect(badge()).toBe(p.waiting);                         // badge === waiting
    expect(p.rendered).toBe(p.waiting + 1);                  // page === waiting + the trace
    expect(badge()).toBeLessThan(p.rendered);                // the divergence, stated
  });

  it("(e) a ruling and NOTHING ELSE: the trace is drawn, and the page does not also say it is empty", () => {
    // THE CASE (d) CANNOT REACH. (d) carries an `assign` as well, so `waiting > 0` and
    // FlowShell's quiet branch is never entered. `waiting === 0 && decided > 0` was
    // untested — and it was wrong. 45cfa62 took `decided` out of the badge (right: it
    // only grows) and moved OperatorInbox's null-render to `rendered` (right: the page
    // still draws the trace), but FlowShell's quiet block kept asking `waiting`. So the
    // moment an operator ruled the LAST unknown out of scope the Inbox drew
    //   "Decided — 1 unknown the operator ruled on — an honest trace"
    // directly above
    //   "Nothing needs you right now."
    // The badge is legitimately 0 here; the page is legitimately not empty. Both are true
    // at once, which is exactly why emptiness has to be asked of `rendered`.
    mount(DECIDED_ONLY);
    const p = page();
    expect(badge()).toBe(0);
    expect(host.querySelector(".v3fs-dock-n")).toBeNull();    // nothing waits — the badge hides
    expect(p.waiting).toBe(0);
    expect(p.decided).toBe(1);                               // …but a row IS on the screen
    expect(p.rendered).toBe(1);
    expect(n(".v3fs-quiet")).toBe(0);                        // and no quiet block over it
    expect(host.textContent).not.toContain("Nothing needs you right now.");
  });
});

describe("the ONE collapsed section — the summary line IS its rows", () => {
  it("Sessions shows one line for many pairs, and its number is those pairs added up", () => {
    // The only place the badge's term and the visible row count legitimately differ.
    // It is defensible because the number is on screen; this proves the number is true.
    mount(LEDGER_ONLY);
    const collapsed = sessionsLine();
    const disclosure = host.querySelector("#ib-sessions button[aria-expanded]") as HTMLButtonElement;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(n("#ib-sessions li.v3ib-seam")).toBe(0);          // collapsed: ONE line, no rows
    act(() => disclosure.click());
    const rows = [...host.querySelectorAll("#ib-sessions li.v3ib-seam")];
    expect(rows.length).toBeGreaterThan(1);                  // many pairs behind that one line
    expect(rows.length).toBeLessThan(collapsed);             // …carrying more questions than pairs
    const perPair = rows.map((li) => {
      const m = /(\d+)\s+joint question/.exec(li.textContent ?? "");
      if (!m) throw new Error(`no per-pair count: ${li.textContent}`);
      return Number(m[1]);
    });
    expect(perPair.reduce((a, b) => a + b, 0)).toBe(collapsed);
    // and expanding moved nothing: the badge still equals the page
    expect(badge()).toBe(page().waiting);
  });

  /**
   * …AND THE NUMBER IS THE RIGHT ONE. The assertion above compares the summary against its
   * own rows, and both are rendered from `abouts.length` — so it holds for ANY `abouts`,
   * including a wrong one. This is the half that was missing: the same on-screen number,
   * checked against a total recomputed from the queue items, which never touches `abouts`.
   * Wrong SET (a typing question kept, a frozen locus counted, a seam dropped) now fails
   * here even though the summary and its rows still agree with each other.
   */
  it("and that number is the joint questions the ledger actually holds, counted independently", () => {
    mount(LEDGER_ONLY);
    // the witness must be non-trivial, or this test passes by describing nothing
    expect(jointQuestionsFromItems).toBeGreaterThan(0);
    expect(sessionsLine()).toBe(jointQuestionsFromItems);

    // expanded, the rows carry that same total — the disclosure renders zero rows while
    // collapsed, so it has to be opened before the rows exist to be counted at all
    const disclosure = host.querySelector("#ib-sessions button[aria-expanded]") as HTMLButtonElement;
    act(() => disclosure.click());
    const perPair = [...host.querySelectorAll("#ib-sessions li.v3ib-seam")].map((li) => {
      const m = /(\d+)\s+joint question/.exec(li.textContent ?? "");
      if (!m) throw new Error(`no per-pair count: ${li.textContent}`);
      return Number(m[1]);
    });
    expect(perPair.reduce((a, b) => a + b, 0)).toBe(jointQuestionsFromItems);
  });
});

describe("D1 — approvals are counted unconditionally, so they render unconditionally", () => {
  it("an approval reply is drawn even when the record handler is missing", () => {
    // `onRecordApproval` is a REQUIRED prop now, so a mount site cannot omit it — this
    // case forces the omission past the type system to pin the RUNTIME behaviour the fix
    // depends on. With the old `onRecordApproval ? … : null` gate the approval row
    // vanishes here while `items.total` still counts it, and the badge stands over a page
    // one row short. That is the whole defect, in one assertion.
    mount(MIXED, { onRecordApproval: undefined as unknown as Props["onRecordApproval"] });
    const p = page();
    expect(badge()).toBe(p.waiting);                         // the invariant, first: 58 vs 57
    expect(p.record).toBe(3);                                // the approval row is one of them
    expect(host.querySelector("section.v3fs-inbox")?.textContent).toContain("Approved — Current-State Atlas");
  });

  it("SOURCE: the prop is required and the approvals list is not gated on it", () => {
    // CODE only: the comment above the prop quotes the very gate this forbids.
    const shell = codeOnly(readFileSync(resolve(__dirname, "../components/flow/FlowShell.tsx"), "utf8"));
    // required — no `?`. (Optionality is what made the defect latent rather than absent.)
    expect(shell).toMatch(/onRecordApproval: \(itemId: string\) => Promise<void>;/);
    expect(shell).not.toMatch(/onRecordApproval\?:/);
    // and no render gate anywhere
    expect(shell).not.toMatch(/onRecordApproval \?/);
  });
});
