/**
 * REGRESSION — three live defects that all moved ONE number, operatorQueueCounts.total,
 * and are therefore fixed and pinned in one place.
 *
 * L1 · THE ADJUDICATE QUEUE WAS DEAD CODE.
 *   `store.resolve` returns contradictions as PAIRS, deduped by claim-pair key, so two
 *   contradicting live claims — the ordinary case, auto-linked by `store.assert` itself
 *   with no explicit `contradict()` anywhere — yield exactly ONE pair. useProgramLedger
 *   gated on `conflicts.length > 1`, i.e. more than one PAIR, which a locus only reaches
 *   at THREE mutually contradicting claims. Two execs disagreeing froze the element and
 *   then reached nobody: `ledger.conflicts` stayed empty, so the "to adjudicate" stat and
 *   its whole section never rendered and the rail badge never moved. Compounding it, the
 *   escalated loser is `blocked`, and blocked role-owned items are dropped from
 *   soloByOwner — so the contradiction was invisible on EVERY surface.
 *
 * L3 · THE BADGE COUNTED HISTORY, so it could never return to zero.
 *   `decided` (decideFates) was summed into the total under a rail label reading
 *   "responses and decisions waiting on you". decideFates only ever grows, so an operator
 *   who ruled every unknown out of scope kept a lit badge forever and could never reach
 *   "Nothing needs you right now". It is out of `total` and into `rendered` — the trace
 *   section still draws, it just stops claiming to be waiting on anyone.
 *
 * L2 · TWO NUMBERS FOR ONE SECTION ON ONE SCREEN, the header's mislabelled.
 *   The header stat read `sessionQueue.length` (SEAMS) inside a stat row terminated by
 *   "· questions"; fifteen lines below, the section printed "11 seams, 49 questions".
 *   The sessions term is joint QUESTIONS now, from `sessionQuestionCount` — the SAME
 *   function the section's summary line calls.
 *
 * THE ORDERING TRAP, stated so it is not re-sprung: inboxSessionsCollapse.test.ts asserts
 * the section against ITSELF (Σ per-row === collapsed total). That stays green however the
 * header is labelled. So the L2 test below renders the WHOLE OperatorInbox and reads the
 * HEADER stat out of the DOM, then the SECTION's own summary out of the DOM, and asserts
 * those two against each other.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createLedgerStore, type LedgerStore } from "@/v3/lib/ledger/store";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, type QueueItem } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { readConflicts, type ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { operatorQueueCounts, sessionQuestionCount } from "@/v3/lib/ledger/operatorQueue";
import OperatorInbox from "@/v3/components/flow/OperatorInbox";
import type { Owner } from "@/v3/lib/ledger/types";

// ── the real programme, for the sessions numbers ────────────────────────────────────
const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const lailaStore = migrate({
  ontology: snap("domain-ontology.json"),
  atlas: snap("current-state-atlas.json"),
  overrides: snap("operator-overrides.json"),
} as Snapshot);
const lailaQueue = buildUnknownQueue(lailaStore);
// Built exactly as useProgramLedger builds it: seam (jointly-owned) questions grouped by
// function pair, typing questions routed to the dictionary instead.
const sessionMap = new Map<string, QueueItem[]>();
for (const it of lailaQueue.items) {
  if (it.status === "open" && TYPING_SLOTS.has(it.slot)) continue;
  if (it.owner.kind !== "joint") continue;
  (sessionMap.get(it.ownerLabel) ?? sessionMap.set(it.ownerLabel, []).get(it.ownerLabel)!).push(it);
}
const sessionQueue = [...sessionMap.entries()]
  .map(([pair, items]) => ({ pair, items, abouts: items.map((i) => i.about) }))
  .sort((a, b) => b.items.length - a.items.length || a.pair.localeCompare(b.pair));

// ── a ledger with only the parts a case needs; everything else genuinely empty ───────
const emptyLedger = (store: LedgerStore): ProgramLedger => ({
  store,
  assignQueue: [], sessionQueue: [], conflicts: [], assignments: [], pinConflicts: [],
  decideFates: [], schedules: [], captures: [], redirects: [], pins: [], proposals: [],
  typingLoci: [], pinnedAbouts: new Set(), proposedAbouts: new Set(), capturedAbouts: new Set(),
  artifactAsks: { asks: [], unattributed: { weight: 0, abouts: [] }, frameComplete: true },
} as unknown as ProgramLedger);

// ── L1 fixture: TWO contradicting live claims, linked by store.assert alone ──────────
const salesOps: Owner = { kind: "role", role: "Sales Ops" };
const LOCUS = "el:attr:account.isclientorpartner#semantics";
const twoClaimContradiction = (): LedgerStore => {
  const s = createLedgerStore({ elements: [
    { id: "el:entity:account", kind: "entity", name: "Account" },
    { id: "el:attr:account.isclientorpartner", kind: "attribute", name: "isClientOrPartner", of: "el:entity:account" },
  ] });
  // Two stakeholder assertions, contradicting. NOTE: no `contradict()` call — the store
  // links them itself (escalate / same-world coexist), which is why this reaches the
  // inbox through ordinary stakeholder answers.
  s.assert({ about: LOCUS, value: { kind: "scalar", value: "client-only" }, world: "as-is", layer: "domain", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "exec-1", verbatim: "always the client" } });
  s.assert({ about: LOCUS, value: { kind: "scalar", value: "client-or-partner" }, world: "as-is", layer: "domain", source: "asserted", ownerWhileOpen: salesOps, closedBy: { method: "assertion", by: "exec-2", verbatim: "partners too" } });
  return s;
};

// ── DOM harness ─────────────────────────────────────────────────────────────────────
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const mount = (ledger: ProgramLedger) => {
  act(() => {
    root.render(createElement(OperatorInbox, {
      ledger, candidates: [], by: "operator",
      onCommit: async () => {},
    }));
  });
};
/**
 * The number the SECTION prints for itself, as an operator reads it.
 *
 * This read the Inbox's header strip, which was removed on 2026-08-13 — it printed
 * the same counts the sections print two inches below. The invariants these cases
 * prove are unchanged and still worth proving: the number on screen must match the
 * section's own rows, the Sessions figure must be QUESTIONS and not seams, and a
 * section with nothing must print no number at all. They just read the surviving
 * element, which is each section's count badge.
 */
const SECTION_OF: Record<string, string> = {
  "need an owner": "#ib-assign",
  "to adjudicate": "#ib-adjudicate",
  "awaiting a date": "#ib-sessions",
};
const headerStat = (label: string): number | null => {
  const section = host.querySelector(SECTION_OF[label] ?? "");
  if (!section) return null;
  const badge = section.querySelector(".v3ib-n");
  if (!badge) return null;
  // Sessions states two figures ("4 seams, 25 questions"); the one under test is the
  // question total, which is what its rows add up to.
  const text = badge.textContent ?? "";
  const q = /(\d+)\s+questions?/.exec(text);
  const m = q ?? /(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("L1 — a single two-claim contradiction reaches the operator", () => {
  it("the store links two contradicting assertions into ONE pair (the shape the gate misread)", () => {
    const s = twoClaimContradiction();
    const r = s.resolve(LOCUS);
    expect(r.live).toHaveLength(2);        // two live claims…
    expect(r.conflicts).toHaveLength(1);   // …reported as ONE pair. `> 1` never fired.
  });

  it("readConflicts finds it, and COUNTS CLAIMS not pairs", () => {
    const conflicts = readConflicts(twoClaimContradiction());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].about).toBe(LOCUS);
    expect(conflicts[0].slot).toBe("semantics");
    // the row prints "frozen · N live claims" — pairs would have said 1 over two of them
    expect(conflicts[0].count).toBe(2);
  });

  it("it RENDERS: the adjudicate section, its row, and the header stat", () => {
    const store = twoClaimContradiction();
    const conflicts = readConflicts(store);
    mount({ ...emptyLedger(store), conflicts });
    const section = host.querySelector("#ib-adjudicate");
    expect(section, "the adjudicate section never rendered").not.toBeNull();
    expect(section!.textContent).toContain("1 conflict");
    expect(section!.textContent).toContain("2 live claims");
    expect(headerStat("to adjudicate")).toBe(1);
  });

  it("and it lifts the badge — the whole point", () => {
    const conflicts = readConflicts(twoClaimContradiction());
    expect(operatorQueueCounts({ ...emptyLedger(createLedgerStore()), conflicts }).adjudicate).toBe(1);
    expect(operatorQueueCounts({ ...emptyLedger(createLedgerStore()), conflicts }).total).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("L3 — the decided trace is history, not a queue", () => {
  const decided = {
    kind: "decide-fate", about: "el:attr:account.isclientorpartner#phase", slot: "phase",
    decision: "out-of-scope", reason: "not in this programme", by: "op", at: "2026-08-01T00:00:00Z",
  } as ProgramLedger["decideFates"][number];

  it("ruling the last unknown out of scope takes the badge to 0", () => {
    const counts = operatorQueueCounts({ ...emptyLedger(createLedgerStore()), decideFates: [decided] });
    expect(counts.decided).toBe(1);
    expect(counts.total).toBe(0);     // "Nothing needs you right now" is reachable again
    expect(counts.rendered).toBe(1);  // …without deleting the record of the ruling
  });

  it("the trace SECTION still renders when nothing is waiting", () => {
    const store = twoClaimContradiction();
    mount({ ...emptyLedger(store), decideFates: [decided] });
    expect(host.innerHTML, "the inbox vanished and took the trace with it").not.toBe("");
    expect(host.textContent).toContain("Decided");
    expect(host.textContent).toContain("out-of-scope");
    expect(host.textContent).toContain("not in this programme");
    // …and it does NOT claim to be waiting on anyone: no header stat mentions it
    expect(host.querySelector(".v3ib-count")).toBeNull();   // no waiting terms at all
  });

  it("decided never inflates a total that has other work in it either", () => {
    const base = { ...emptyLedger(createLedgerStore()), sessionQueue };
    const withTrace = operatorQueueCounts({ ...base, decideFates: [decided, decided] });
    expect(withTrace.total).toBe(operatorQueueCounts(base).total);
    expect(withTrace.rendered).toBe(withTrace.total + 2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
describe("L2 — the header stat and the Sessions section print the SAME number", () => {
  it("the real programme distinguishes the two readings (49 questions across 11 seams)", () => {
    expect(sessionQueue.length).toBeGreaterThan(1);
    expect(sessionQuestionCount(sessionQueue)).toBeGreaterThan(sessionQueue.length);
  });

  /* REMOVED 2026-08-13 with the Sessions section. It proved the header stat and the
     section printed the same figure in the same unit (questions, not seams) — a real
     invariant while both existed. Seam questions now go out on both owners' links,
     so neither the section nor the stat is drawn, and there is nothing left to
     reconcile. The seam ROUTING is proved in `seamOutranksTyping.test.ts`. */


  it("and the term in the counts object is that same function's value", () => {
    const counts = operatorQueueCounts({ ...emptyLedger(lailaStore), sessionQueue });
    expect(counts.sessionQuestions).toBe(sessionQuestionCount(sessionQueue));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════
/**
 * L8 — A FROZEN LOCUS WAS TWO PIECES OF WORK.
 *
 * `operatorQueueCounts.total` summed terms that are not disjoint. A locus held by two
 * contradicting live claims is the adjudicate term; the SAME locus can still be an open
 * unowned question (assign) or a joint one (sessions). So one locus added two to the
 * badge and drew a row in two sections — one of which asked the operator to route a
 * question that is frozen until they adjudicate it first.
 *
 * This is not exotic: `store.assert` links contradictions itself (L1 above), so the
 * overlap arrives through ordinary stakeholder answers with no `contradict()` anywhere.
 * It measured zero on the Laila snapshot only because that programme happens to hold no
 * conflict pairs — a fact about DATA, which any new programme can change.
 *
 * THE ORDERING TRAP, stated so it is not re-sprung: fixing the SUM alone turns F7
 * (inboxBadgeIsThePage) red, because the page would still draw the frozen rows the badge
 * had stopped counting. So the subtraction is written ONCE in `unfrozenQueues`, and both
 * the badge and the page read it — which is what the DOM half of this test pins.
 */
describe("L8 — a frozen locus counts once, and draws once", () => {
  const frozenLedger = (): ProgramLedger => {
    const store = twoClaimContradiction();
    const conflicts = readConflicts(store);
    expect(conflicts).toHaveLength(1);          // guard: the fixture really is frozen
    expect(conflicts[0].about).toBe(LOCUS);
    // The same locus is ALSO an open unowned question — the overlap itself.
    const alsoUnowned: QueueItem = {
      about: LOCUS, owner: { kind: "unowned" }, ownerLabel: "",
      routing: "unowned", slot: "semantics", status: "open",
    };
    return { ...emptyLedger(store), conflicts, assignQueue: [alsoUnowned] };
  };

  it("the overlap is real: the same about is in BOTH source lists", () => {
    const l = frozenLedger();
    expect(l.assignQueue.map((i) => i.about)).toContain(LOCUS);
    expect(l.conflicts.map((c) => c.about)).toContain(LOCUS);
  });

  it("ONE locus of work counts ONE, not two", () => {
    const counts = operatorQueueCounts(frozenLedger());
    expect(counts.adjudicate).toBe(1);   // it is adjudication…
    expect(counts.assign).toBe(0);       // …and therefore not also an assignment
    expect(counts.total).toBe(1);        // the defect printed 2
  });

  it("a frozen JOINT locus is not also offered as a session to schedule", () => {
    const store = twoClaimContradiction();
    const item: QueueItem = {
      about: LOCUS, owner: { kind: "joint", roles: ["Sales Ops", "Finance"] } as unknown as Owner,
      ownerLabel: "Sales Ops ⋈ Finance", routing: "blocking", slot: "semantics", status: "open",
    };
    const counts = operatorQueueCounts({
      ...emptyLedger(store), conflicts: readConflicts(store),
      sessionQueue: [{ pair: "Sales Ops ⋈ Finance", items: [item], abouts: [LOCUS] }],
    });
    expect(counts.adjudicate).toBe(1);
    expect(counts.sessionQuestions).toBe(0);   // the seam emptied, so it is not a seam
    expect(counts.total).toBe(1);
  });

  it("THE ORDERING TRAP: the page draws it once too — badge and page agree", () => {
    const ledger = frozenLedger();
    mount(ledger);
    // the adjudicate section owns it…
    expect(host.querySelector("#ib-adjudicate")).not.toBeNull();
    // …and the assign section is not drawn at all, because its only row was frozen
    expect(host.querySelector("#ib-assign")).toBeNull();
    // the badge's own number, read through the public sum, matches what is on screen
    expect(operatorQueueCounts(ledger).total).toBe(1);
    expect(headerStat("need an owner")).toBeNull();   // no stat for a section with nothing
    expect(headerStat("to adjudicate")).toBe(1);
  });

  it("unfreezing returns it: the locus goes back to the queue it belongs in", () => {
    const l = frozenLedger();
    // same ledger, conflicts cleared (as adjudication would) — nothing else changed
    const counts = operatorQueueCounts({ ...l, conflicts: [] });
    expect(counts.adjudicate).toBe(0);
    expect(counts.assign).toBe(1);   // it was never dropped, only deferred
    expect(counts.total).toBe(1);
  });
});
