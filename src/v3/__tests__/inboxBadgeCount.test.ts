/**
 * REGRESSION — the left-rail INBOX badge counts the WHOLE Inbox page.
 *
 * Reported: the Inbox read "8 awaiting a date" plus 5 dictionary asks while the rail
 * icon was bare. Cause: the badge summed only the programme-blob queue (decisions,
 * portal, approvals, disputes, roles, coverage names, exceptions). The LEDGER operator
 * queue moved onto that page (assign / sessions / adjudicate / pinned / in-flight /
 * dictionary chase / decided) and counted for nothing.
 *
 * The fix is ONE definition per half, composed once:
 *   operatorQueueCounts (lib/ledger/operatorQueue.ts) — the ledger half, and the Inbox's
 *     own empty state (`total === 0` is when OperatorInbox renders nothing).
 *   programInboxItems   (components/flow/flowInbox.ts) — the record half, and the lists
 *     the page renders from.
 *   inboxWaitingCount   — the badge: the two halves added in one place.
 *
 * Fixtures are REAL: the ledger reads are derived from the Laila snapshot with the same
 * functions useProgramLedger uses, so the session/chase numbers below are the programme's
 * own, not invented ones.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProgramSummary } from "@/new/types";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, type QueueItem } from "@/v3/lib/ledger/projections";
import { TYPING_SLOTS } from "@/v3/lib/ledger/dictionary";
import { deriveArtifactAsks, asksNeedingChase } from "@/v3/lib/ledger/artifactAsks";
import {
  operatorQueueCounts, operatorQueueCount,
  type OperatorQueueReads, type OperatorQueueCounts,
} from "@/v3/lib/ledger/operatorQueue";
import { programInboxItems, inboxWaitingCount } from "@/v3/components/flow/flowInbox";

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
const sessionQueue = [...sessionMap.entries()].map(([pair, items]) => ({ pair, items, abouts: items.map((i) => i.about) }));
const artifactAsks = deriveArtifactAsks(store, {});

const NO_LEDGER_ITEMS: OperatorQueueReads = {
  assignQueue: [], sessionQueue: [], conflicts: [], assignments: [], pinConflicts: [], decideFates: [],
  artifactAsks: { asks: [], unattributed: { weight: 0, abouts: [] }, frameComplete: true },
};
// The reported screen: seams awaiting a date + the dictionary asks, and nothing else.
const SESSIONS_AND_ASKS: OperatorQueueReads = { ...NO_LEDGER_ITEMS, sessionQueue, artifactAsks };

const prog = (data: Record<string, unknown> = {}): ProgramSummary =>
  ({ id: "p1", rawData: { data } } as unknown as ProgramSummary);
const bare = prog();
const AT = "2026-08-01T00:00:00Z";
// One record-side item (a person whose role the programme does not recognise yet).
const withRecordItem = prog({
  phaseInputs: { listen: { _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Ada", role: "Regional Ops", roleResolved: false }]) } },
});

describe("the ledger operator queue is part of the badge", () => {
  it("a programme with ONLY ledger items (no decisions, no approvals) gets a NON-ZERO badge", () => {
    expect(programInboxItems(bare).total).toBe(0);          // nothing on the record side
    expect(operatorQueueCount(SESSIONS_AND_ASKS)).toBeGreaterThan(0);
    expect(inboxWaitingCount(bare, SESSIONS_AND_ASKS)).toBeGreaterThan(0);
  });

  it("the badge equals the Inbox page's own item count — record half + ledger half", () => {
    for (const [program, ledger] of [
      [bare, SESSIONS_AND_ASKS], [bare, NO_LEDGER_ITEMS],
      [withRecordItem, SESSIONS_AND_ASKS], [withRecordItem, NO_LEDGER_ITEMS],
    ] as Array<[ProgramSummary, OperatorQueueReads]>) {
      expect(inboxWaitingCount(program, ledger))
        .toBe(programInboxItems(program).total + operatorQueueCounts(ledger).total);
    }
  });

  it("an empty programme yields 0 — the badge hides and the inbox renders nothing", () => {
    expect(inboxWaitingCount(bare, NO_LEDGER_ITEMS)).toBe(0);
    // OperatorInbox returns null on exactly this condition, so 0 badge === no inbox.
    expect(operatorQueueCounts(NO_LEDGER_ITEMS).total).toBe(0);
  });

  it("the record half still counts on its own (the seven terms did not regress)", () => {
    const items = programInboxItems(withRecordItem);
    expect(items.unresolvedRoles).toHaveLength(1);
    expect(items.total).toBe(1);
    expect(inboxWaitingCount(withRecordItem, NO_LEDGER_ITEMS)).toBe(1);
  });
});

describe("operatorQueueCounts — every rendered section is a term", () => {
  it("sessions and the dictionary chase both count (the reported pair)", () => {
    const counts = operatorQueueCounts(SESSIONS_AND_ASKS);
    const chase = asksNeedingChase(artifactAsks).length + (artifactAsks.unattributed.weight ? 1 : 0);
    expect(sessionQueue.length).toBeGreaterThan(0);
    expect(chase).toBeGreaterThan(0);
    expect(counts.sessions).toBe(sessionQueue.length);
    expect(counts.chase).toBe(chase);
    expect(counts.total).toBe(sessionQueue.length + chase);
  });

  it("every section is wired: one item in any one of them lifts the badge off 0", () => {
    // One item per section, each the shape that section renders from. Laila's own
    // assign queue is empty (its open unknowns are owned or typing), so the assign
    // case borrows a real queue item rather than inventing one.
    const cases: Array<[keyof OperatorQueueReads, OperatorQueueReads, keyof OperatorQueueCounts]> = [
      ["assignQueue", { ...NO_LEDGER_ITEMS, assignQueue: queue.items.slice(0, 1) }, "assign"],
      ["sessionQueue", { ...NO_LEDGER_ITEMS, sessionQueue: sessionQueue.slice(0, 1) }, "sessions"],
      ["conflicts", { ...NO_LEDGER_ITEMS, conflicts: [{ about: "el:attr:case.status?dataType", slot: "dataType", count: 2 }] }, "adjudicate"],
      ["pinConflicts", { ...NO_LEDGER_ITEMS, pinConflicts: [{ about: "b", slot: "phase", pinned: "Ada", derived: "Ops", pin: { kind: "pin", about: "b", slot: "phase", owner: { label: "Ada", isRole: false }, sentAt: AT, by: "op", at: AT } }] }, "pinned"],
      ["assignments", { ...NO_LEDGER_ITEMS, assignments: [{ kind: "assign", about: "a", slot: "phase", owner: { label: "Ops", isRole: true }, by: "op", at: AT }] }, "inFlight"],
      ["decideFates", { ...NO_LEDGER_ITEMS, decideFates: [{ kind: "decide-fate", about: "c", slot: "phase", decision: "out-of-scope", reason: "not in this programme", by: "op", at: AT }] }, "decided"],
      ["artifactAsks", { ...NO_LEDGER_ITEMS, artifactAsks }, "chase"],
    ];
    for (const [section, reads, field] of cases) {
      const c = operatorQueueCounts(reads);
      expect(c[field], `${String(section)} does not reach the badge`).toBeGreaterThan(0);
      expect(c.total).toBe(c.assign + c.sessions + c.adjudicate + c.pinned + c.inFlight + c.chase + c.decided);
      expect(inboxWaitingCount(bare, reads)).toBe(c.total);
    }
  });
});

describe("one definition — the badge and the page cannot drift apart again", () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, `../../../${rel}`), "utf8");
  const shell = src("src/v3/components/flow/FlowShell.tsx");
  const inbox = src("src/v3/components/flow/OperatorInbox.tsx");

  it("the badge reads inboxWaitingCount and the inbox reads operatorQueueCounts", () => {
    expect(shell).toContain("inboxWaitingCount(program, ledger)");
    expect(inbox).toContain("operatorQueueCounts(ledger)");
  });

  it("neither surface re-adds the terms itself", () => {
    // The copied chase expression and the old whole-inbox empty check are gone; the
    // per-section `=== 0 ? null` guards stay — those hide ONE section, they do not
    // restate the sum.
    for (const file of [shell, inbox]) {
      expect(file).not.toContain("asksNeedingChase(ledger.artifactAsks).length +");
    }
    expect(inbox).not.toContain("nothingToShow");
  });
});
