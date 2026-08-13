/**
 * AN ASSIGNMENT IS SPENT WHEN ITS QUESTION IS.
 *
 * Reported as "why not clearing", against eight Owned & in-flight rows.
 *
 * `activeAssignments` folds the operator's OWN verbs and nothing else — assign,
 * unassign, decide-fate. The event that actually ends an in-flight question, the
 * question BEING ANSWERED, was invisible to it. A claim landing on the locus closes
 * it on the burn-down, drops it off Discover, and left the Inbox saying "awaiting
 * Sales Operations SME" for ever. Every other route out of the queue had the same
 * hole: a dictionary upload answering a typing question, an adjudication settling a
 * frozen locus, a curation removing the element underneath it.
 *
 * MEASURED FIRST, and it matters: on Laila New this changes nothing — the section
 * still reads 8, because all eight really are open. Nothing there was stale. This is
 * the mechanism by which an in-flight row CAN clear, not an explanation of why those
 * eight have not.
 *
 * The hook is rendered for real rather than replayed step by step. The rule under
 * test is one line of filtering, and a test that re-derives it from the same parts
 * would pass whether or not the hook does it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useProgramLedger, type ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { serializeOperatorActions, type OperatorAction } from "@/v3/lib/ledger/operatorActions";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

/** Render the real hook and hand back what the surfaces would read. */
const readLedger = (program: unknown): ProgramLedger => {
  let out!: ProgramLedger;
  const Probe = () => { out = useProgramLedger(program as never); return null; };
  act(() => { root.render(createElement(Probe)); });
  return out;
};

const AT = "2026-08-13T00:00:00.000Z";
const ABOUT = "el:attr:account.segment#dataType";
const assign: OperatorAction = {
  kind: "assign", about: ABOUT, slot: "dataType",
  owner: { label: "Sales Operations SME", isRole: true }, by: "operator", at: AT,
};

/**
 * One entity, one attribute, and the locus under test is its `dataType`.
 * `answered` attaches a data dictionary — the typing-close path that needs no
 * stakeholder write path, so it is reachable on today's deployment.
 */
const programWith = (actions: OperatorAction[], answered: boolean) => ({
  id: "p1",
  rawData: {
    data: {
      phaseInputs: {
        listen: {
          _operatorActions: serializeOperatorActions(actions),
          ...(answered ? { _dataDictionary: "entity,attribute,type\nAccount,segment,text\n" } : {}),
        },
      },
      domainOntology: { entities: [{ name: "Account", attributes: [{ name: "segment" }] }] },
    },
  },
});

describe("an in-flight row lasts exactly as long as its question", () => {
  it("stays while the locus is still an open unknown", () => {
    // The guard against a filter that swallows everything. This is the LIVE case,
    // and it is what Laila New's eight rows are.
    const ledger = readLedger(programWith([assign], false));
    const open = new Set(ledger.queue.items.map((i) => i.about));
    expect(open.has(ABOUT), "the fixture's locus is not open — the test would prove nothing").toBe(true);
    expect(ledger.assignments.map((a) => a.about)).toContain(ABOUT);
  });

  it("drops once the question is answered — nothing is awaiting anyone", () => {
    // MUTATION: drop the `openAbouts` filter in useProgramLedger → the row outlives
    // its own question, which is the defect.
    const ledger = readLedger(programWith([assign], true));
    const open = new Set(ledger.queue.items.map((i) => i.about));
    expect(open.has(ABOUT), "the fixture did not actually close the locus").toBe(false);
    expect(ledger.assignments.map((a) => a.about),
      "the Inbox still says a settled question is awaiting its owner").not.toContain(ABOUT);
  });

  it("the operator's own verbs still end it, as they always did", () => {
    // Unassign is not a closure — it returns the locus to the unowned queue — but it
    // does end the in-flight. Kept so the new filter cannot be mistaken for the only
    // route out.
    const unassign: OperatorAction = { kind: "unassign", about: ABOUT, reason: "operator", by: "operator", at: AT };
    expect(readLedger(programWith([assign, unassign], false)).assignments).toHaveLength(0);
  });
});
