/**
 * ONE CONTRADICTION, ONE ROW, ONE CARD.
 *
 * Reported from the running Inbox: "shows 4 identical records in contradiction log
 * and not very clear in terms of what is the contradiction". Two causes, both here:
 *
 *  1. the LOG append kept its own copy of the raw lowercase-substring comparison
 *     after that rule was replaced in `isContradictionHandled`, so the same finding
 *     written with " · " column separators no longer matched the version written
 *     with spaces, and filed again on every confirm;
 *  2. nothing collapsed the CARDS, so two watchers proposing the same dispute
 *     produced two decisions with different ids and two identical cards.
 *
 * Every assertion below fails if its fix is reverted — see the comment on each.
 */
import { describe, it, expect } from "vitest";
import {
  contradictionKey,
  dedupeContradictionDecisions,
  resolveFlowDecision,
} from "@/v3/components/flow/flowDecisions";

/** The log rows that a confirm wrote, parsed back. */
function loggedRows(inner: Record<string, unknown>): Array<Record<string, unknown>> {
  const phases = inner.phaseInputs as Record<string, unknown> | undefined;
  const listen = phases?.listen as Record<string, unknown> | undefined;
  const raw = listen?.contradictionLog;
  return typeof raw === "string" && raw.trim() ? JSON.parse(raw) : [];
}

/** Confirm a contradiction decision against `inner`, returning the next state. */
function confirmWith(inner: Record<string, unknown>, entries: unknown[]): Record<string, unknown> {
  const rawData = {
    ...inner,
    flowDecisions: [{ id: "d1", status: "open", payload: { contradictionEntries: entries } }],
  };
  const out = resolveFlowDecision({ rawData } as never, "d1", "confirmed", "op");
  expect(out, "resolveFlowDecision refused the decision — the fixture is wrong, not the code").not.toBeNull();
  return out as Record<string, unknown>;
}

describe("a contradiction is filed once", () => {
  // The SAME dispute, written the two ways the two watchers write it: the
  // deterministic detector joins its columns with " · ", the model writes prose
  // spacing. Raw-substring says these are different strings; they are one finding.
  const SPACED = "Renewals are owned by Sales but Ops states renewals are owned by Ops";
  const PIPED = "Renewals are owned by Sales · but Ops states renewals are owned by Ops";

  it("normalises separators, so the two spellings are one key", () => {
    // MUTATION: drop `.replace(/[^a-z0-9]+/g, " ")` from contradictionKey → RED.
    expect(contradictionKey(SPACED)).toBe(contradictionKey(PIPED));
  });

  it("does not append a second row for the same finding written differently", () => {
    const first = confirmWith({}, [{ statement: SPACED, between: "Sales vs Ops", positions: "p" }]);
    expect(loggedRows(first)).toHaveLength(1);

    // MUTATION: restore the raw `.trim().toLowerCase()` comparison at the append
    // site → this returns 2 rows, which is exactly the duplicate the user saw.
    const second = confirmWith(first, [{ statement: PIPED, between: "Sales vs Ops", positions: "p" }]);
    expect(loggedRows(second)).toHaveLength(1);
    expect(String(loggedRows(second)[0].statement)).toBe(SPACED);
  });

  it("does not append the same finding twice from ONE payload", () => {
    // Both watchers propose into a single confirm. `isLogged` reads only what was
    // already on file, so nothing but the in-payload guard catches this.
    // MUTATION: remove the `filing` Set filter → 2 rows.
    const out = confirmWith({}, [
      { statement: SPACED, between: "Sales vs Ops", positions: "p" },
      { statement: PIPED, between: "Sales vs Ops", positions: "p" },
    ]);
    expect(loggedRows(out)).toHaveLength(1);
  });

  it("still files a genuinely different dispute", () => {
    // The guard must not be a blanket "one contradiction ever". If this passes
    // while the three above pass, the dedupe discriminates rather than swallows.
    const first = confirmWith({}, [{ statement: SPACED, between: "Sales vs Ops", positions: "p" }]);
    const second = confirmWith(first, [{
      statement: "Pricing approval sits with Finance but Legal states it sits with Legal",
      between: "Finance vs Legal", positions: "p",
    }]);
    expect(loggedRows(second)).toHaveLength(2);
  });
});

describe("one card per contradiction", () => {
  const card = (id: string, statements: string[]) => ({
    id, payload: { contradictionEntries: statements.map((statement) => ({ statement })) },
  });

  it("collapses two decisions carrying the same dispute", () => {
    // Two ids, one finding — what put four identical cards on the board.
    // MUTATION: return `decisions` unchanged → 2.
    const out = dedupeContradictionDecisions([
      card("a", ["Renewals are owned by Sales but Ops states renewals are owned by Ops"]),
      card("b", ["Renewals are owned by Sales · but Ops states renewals are owned by Ops"]),
    ]);
    expect(out.map((d) => d.id)).toEqual(["a"]);
  });

  it("keeps a card whose dispute is different", () => {
    const out = dedupeContradictionDecisions([
      card("a", ["Renewals are owned by Sales but Ops states renewals are owned by Ops"]),
      card("b", ["Pricing approval sits with Finance but Legal states it sits with Legal"]),
    ]);
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("does not confuse a two-contradiction card with a one-contradiction card", () => {
    // Keying on the whole carried SET, not on any single member: a card proposing
    // A+B is not the card proposing A.
    // MUTATION: key on `entries[0]` only → "b" is dropped and this is RED.
    const out = dedupeContradictionDecisions([
      card("a", ["Renewals are owned by Sales but Ops states renewals are owned by Ops",
                 "Pricing approval sits with Finance but Legal states it sits with Legal"]),
      card("b", ["Renewals are owned by Sales but Ops states renewals are owned by Ops"]),
    ]);
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("passes non-contradiction decisions through untouched, including duplicates", () => {
    // This is NOT a general decision deduper. Two demo-invite decisions with the
    // same payload are two real decisions.
    // MUTATION: dedupe on a key that ignores the payload shape → 1.
    const plain = [
      { id: "x", payload: { demoInvites: ["ana"] } },
      { id: "y", payload: { demoInvites: ["ana"] } },
      { id: "z", payload: null },
    ];
    expect(dedupeContradictionDecisions(plain).map((d) => d.id)).toEqual(["x", "y", "z"]);
  });
});

describe("the survivor is the card that says what the conflict is", () => {
  // Measured on Laila New: FOUR stored decisions for one finding, differing only
  // by separator (tab / " · " / space) — four GENERATIONS of the watcher. The
  // oldest carried the bare glued statement as its summary and no `claim`; the
  // newest carried "Evidence: … — the charter still says …". A stored decision
  // renders the strings it was minted with, so keeping the first arrival kept the
  // card that never says what the contradiction IS.
  const generation = (id: string, statement: string, claim: string, summary: string) => ({
    id, summary,
    payload: { contradictionEntries: [{ statement, claim, between: "sheet vs Charter" }] },
  });
  const STMT = "Audit/previous-value fields dropped\t9\tUse proper change-history tracking";
  const oldest = generation("oldest", STMT, "", "Audit/previous-value fields dropped 9 Use proper change-history tracking");
  const newest = generation("newest", STMT.replace(/\t/g, " · "), "Replace the current CRM outright",
    "Evidence: “Audit/previous-value fields dropped · 9 · …” — the charter still says “Replace the current CRM outright”");

  it("keeps the generation carrying the contradicted claim", () => {
    // MUTATION: revert to first-wins (`if (seen.has(key)) continue`) → "oldest".
    expect(dedupeContradictionDecisions([oldest, newest]).map((d) => d.id)).toEqual(["newest"]);
  });

  it("keeps it whichever order they arrive in", () => {
    expect(dedupeContradictionDecisions([newest, oldest]).map((d) => d.id)).toEqual(["newest"]);
  });

  it("does not reorder the board — the survivor holds the first card's place", () => {
    // A richer duplicate arriving later must not jump the queue past unrelated
    // cards, or the operator's list reshuffles as generations land.
    const other = { id: "other", summary: "", payload: { demoInvites: ["ana"] } };
    expect(dedupeContradictionDecisions([oldest, other, newest]).map((d) => d.id))
      .toEqual(["newest", "other"]);
  });
});
