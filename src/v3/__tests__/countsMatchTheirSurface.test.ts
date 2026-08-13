/**
 * A COUNT NAMES THE POPULATION IT SENDS YOU TO.
 *
 * Reported: "191 question count does not match discovery". Both halves of that line
 * were wrong, and each was wrong in a way that survives a casual read:
 *
 *  · the NUMBER was `blocking + answerable-without-a-meeting`, which includes the
 *    ~121 typing questions routed to a data dictionary — the ones Discover
 *    deliberately stopped showing on person cards, because no person is asked them.
 *    So it pointed at a surface holding ~70 of its 191.
 *  · the NAME called it "Listen's burn-down". The burn-down was 206 at the same
 *    moment. It is a subset of the burn-down, not the burn-down.
 *
 * The fix counts through `isDictionaryQuestion`, the ledger's own definition of that
 * bucket, so the number and the surface it links to cannot drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildUnknownQueue, isDictionaryQuestion } from "@/v3/lib/ledger/projections";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { aboutOf } from "@/v3/lib/ledger/types";

const SRC = (f: string) => readFileSync(resolve(__dirname, `../components/flow/${f}`), "utf8");

/** A programme with both populations: two typing questions, one decision question. */
function mixedQueue() {
  const store = createLedgerStore();
  store.addElement({ id: "el:ent:account", kind: "entity", name: "Account" });
  store.addElement({ id: "el:attr:account.segment", kind: "attribute", name: "segment", of: "el:ent:account" });
  store.addElement({ id: "el:wf:quote", kind: "workflow", name: "Quote to cash" });
  const owner = { kind: "role", role: "Sales Ops" } as const;
  const open = (about: string) => store.assert({
    about, value: { kind: "unknown" }, world: "as-is", layer: "domain",
    source: "generated", ownerWhileOpen: owner,
  });
  open(aboutOf("el:attr:account.segment", "dataType"));   // dictionary
  open(aboutOf("el:attr:account.segment", "valueSet"));   // dictionary
  open(aboutOf("el:wf:quote", "decision"));               // a person's to answer
  return buildUnknownQueue(store);
}

describe("the two populations really are different", () => {
  it("the fixture holds both, or the split below proves nothing", () => {
    const q = mixedQueue();
    expect(q.items.filter(isDictionaryQuestion).length, "no dictionary questions in the fixture").toBe(2);
    expect(q.items.filter((i) => !isDictionaryQuestion(i)).length, "no person questions in the fixture").toBe(1);
  });

  it("the old formula counts the dictionary questions as stakeholder work", () => {
    // The bug, stated as a fact about the data rather than about the code: this is
    // what the line printed, and it is 3 where Discover would show 1.
    const q = mixedQueue();
    const old = q.counts.blocking + q.counts["answerable-without-a-meeting"];
    expect(old).toBe(3);
  });

  it("the new one counts what Discover actually shows", () => {
    const q = mixedQueue();
    const shown = q.items.filter((i) =>
      (i.routing === "blocking" || i.routing === "answerable-without-a-meeting") && !isDictionaryQuestion(i)).length;
    expect(shown).toBe(1);
    expect(shown, "the recount changed nothing — the fixture cannot detect the bug")
      .not.toBe(q.counts.blocking + q.counts["answerable-without-a-meeting"]);
  });
});

describe("the line on screen", () => {
  const zones = SRC("DesignLoopZones.tsx");

  it("subtracts the dictionary bucket through the ledger's own definition", () => {
    // MUTATION: revert to `counts.blocking + counts[...]` → RED.
    expect(zones).toContain("!isDictionaryQuestion(i)");
    expect(zones, "a local re-derivation would drift from the surface it points at")
      .toContain('from "@/v3/lib/ledger/projections"');
  });

  it("no longer calls a subset of the burn-down the burn-down", () => {
    // MUTATION: restore the old sentence → RED.
    expect(zones).not.toContain("that is\n            Listen&rsquo;s burn-down");
    expect(zones).not.toMatch(/is Listen&rsquo;s burn-down/);
  });

  it("states the dictionary questions rather than dropping them", () => {
    // A miss stays visible: the ~121 are not hidden by the recount, they are named
    // and pointed at the surface that does work them.
    expect(zones).toContain("dictionaryOpen");
    expect(zones).toMatch(/answered by a data dictionary/);
  });
});

describe("every Inbox strip carries a control", () => {
  // The rule behind four separate reports in one sitting ("is this informational?",
  // "how does the operator action this?"). The Inbox is the operator's decision
  // surface; a strip that only describes belongs on the Record.
  const inbox = SRC("OperatorInbox.tsx");
  const STRIPS = ["v3ib-dict-derivedtypes", "v3ib-dict-ask", "v3ib-dict-answerhere", "v3ib-dict-settled"];

  for (const cls of STRIPS) {
    it(`${cls} offers an act`, () => {
      const at = inbox.indexOf(`className="${cls}"`);
      expect(at, `${cls} is not rendered at all — this case would pass over nothing`).toBeGreaterThan(-1);
      const block = inbox.slice(at, at + 2600);
      const end = block.indexOf("</div>");
      expect(block.slice(0, end > 0 ? end : undefined)).toContain("<button");
    });
  }

  it("a field with no source and no system can be ruled out of scope", () => {
    // The fourth answer, which did not exist: chase / ask / type-by-hand all assume
    // the field is real. Laila New carried "Does every Account need a ANOTHER…" —
    // an attribute the model invented while summarising, with nobody able to answer
    // because there is nothing to answer.
    // MUTATION: delete the button → RED.
    expect(inbox).toContain("this field shouldn’t exist");
    expect(inbox, "it must record WHY, or the field vanishes without a reason")
      .toContain('decision: "out-of-scope"');
    expect(inbox, "offered only where it is the right answer — sourceless AND system-less")
      .toContain("{!src && peek.orphan ?");
  });
});
