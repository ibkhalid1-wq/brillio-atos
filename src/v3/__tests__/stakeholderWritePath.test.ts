/**
 * THE STAKEHOLDER WRITE PATH — end to end, through the real hook.
 *
 * Before this existed, a question could go OUT with its locus attached and nothing
 * could ever come back to it. The consequences were all visible on the running board
 * and all had the same cause: `heard` read 0 on every real programme, the burn-down
 * never moved on a person's answer, and Owned & in-flight could only grow.
 *
 * The four assertions that matter are the four things that were impossible:
 *   1. the locus CLOSES;
 *   2. `heard` TICKS — and ticks for the band that owned the question;
 *   3. the in-flight row CLEARS (it is the same `assignments` filter as the
 *      spent-assignment guard, now driven by an answer rather than by the operator);
 *   4. an operator CAPTURE still does none of those — the boundary this whole
 *      feature is defined against.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useProgramLedger, type ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { buildHeardRegister } from "@/v3/lib/ledger/projections";
import { serializeOperatorActions, type OperatorAction } from "@/v3/lib/ledger/operatorActions";
import { readStakeholderAnswers, stakeholderAnswerClaims, type StakeholderAnswer } from "@/v3/lib/ledger/stakeholderAnswers";
import { createLedgerStore } from "@/v3/lib/ledger/store";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const readLedger = (program: unknown): ProgramLedger => {
  let out!: ProgramLedger;
  const Probe = () => { out = useProgramLedger(program as never); return null; };
  act(() => { root.render(createElement(Probe)); });
  return out;
};

const AT = "2026-08-13T09:00:00.000Z";
const ABOUT = "el:attr:account.segment#dataType";
const OWNER = "Sales Operations SME";

const assign: OperatorAction = {
  kind: "assign", about: ABOUT, slot: "dataType",
  owner: { label: OWNER, isRole: true }, by: "operator", at: AT,
};

const answer: StakeholderAnswer = {
  about: ABOUT, answer: "Enterprise, Mid-Market or SMB — set at qualification.",
  saidByName: "Priya Raman", saidByRole: "Sales Operations Lead", at: AT, via: "pack:abc123",
};

/** One entity, one attribute; `answers` is what arrived on links. */
const program = (opts: { answers?: unknown[]; captures?: boolean } = {}) => ({
  id: "p1",
  rawData: {
    data: {
      phaseInputs: {
        listen: {
          _operatorActions: serializeOperatorActions([
            assign,
            ...(opts.captures
              ? [{ kind: "capture", about: ABOUT, slot: "dataType", answer: "Priya said it's the three tiers",
                  saidByName: "Priya Raman", saidByRole: "", by: "operator", at: AT } as OperatorAction]
              : []),
          ]),
          ...(opts.answers ? { _stakeholderAnswers: JSON.stringify(opts.answers) } : {}),
        },
      },
      domainOntology: { entities: [{ name: "Account", attributes: [{ name: "segment" }] }] },
    },
  },
});

describe("a person answers the question they were asked", () => {
  it("closes the locus — it leaves the open queue", () => {
    const before = readLedger(program());
    expect(before.queue.items.map((i) => i.about), "the fixture's locus is not open").toContain(ABOUT);

    // MUTATION: drop the reconcile in useProgramLedger → still open, and every
    // assertion below goes with it.
    const after = readLedger(program({ answers: [answer] }));
    expect(after.queue.items.map((i) => i.about)).not.toContain(ABOUT);
  });

  it("ticks HEARD, for the band that owned the question", () => {
    // The number that read 0 on every real programme. `isHeardClosure` wants an
    // attributed source, a non-import method and a human actor — all three, or this
    // is a closure that does not count as having heard anybody.
    const heard = buildHeardRegister(readLedger(program({ answers: [answer] })).store);
    expect(heard.total, "an answer through the system did not count as heard").toBe(1);
    expect(heard.byBand.find((b) => b.band === OWNER)?.heard,
      "heard ticked, but not for the band that was waiting").toBe(1);
  });

  it("clears the in-flight row — nothing is awaiting them any more", () => {
    expect(readLedger(program()).assignments.map((a) => a.about)).toContain(ABOUT);
    expect(readLedger(program({ answers: [answer] })).assignments).toHaveLength(0);
  });

  it("keeps their words as the closure's verbatim, attributed to them", () => {
    // A closure without verbatim is a touch, not an answer — and the `by` has to be
    // the PERSON, or the heard register credits the wrong band and the record cannot
    // say who settled it.
    const closed = readLedger(program({ answers: [answer] })).store
      .liveClaimsAbout(ABOUT).find((c) => c.status === "closed");
    expect(closed?.closedBy?.verbatim).toBe(answer.answer);
    expect(closed?.closedBy?.by).toBe("Priya Raman");
    expect(closed?.source).toBe("asserted");
    expect(closed?.closedBy?.note, "the record does not say it arrived on their link").toContain("pack:abc123");
  });
});

describe("the boundary this is defined against", () => {
  it("an operator CAPTURE still closes nothing and still ticks nothing", () => {
    // The operator retyping what someone said in a corridor. If this ever starts
    // behaving like the case above, the heard count has stopped meaning anything.
    const ledger = readLedger(program({ captures: true }));
    expect(ledger.captures, "the fixture recorded no capture").toHaveLength(1);
    expect(ledger.queue.items.map((i) => i.about), "a capture closed the question").toContain(ABOUT);
    expect(buildHeardRegister(ledger.store).total, "a capture ticked heard").toBe(0);
    expect(ledger.assignments, "a capture cleared the in-flight row").toHaveLength(1);
  });
});

describe("what will not be trusted to close a locus", () => {
  const bad = (over: Partial<Record<keyof StakeholderAnswer, unknown>>) =>
    readStakeholderAnswers(program({ answers: [{ ...answer, ...over }] }) as never);

  it("drops a row with no link to have arrived on", () => {
    // `via` is the whole difference between an answer and somebody typing into the
    // blob. MUTATION: drop the `!via` check → an unattributed row can close a locus.
    expect(bad({ via: "" })).toHaveLength(0);
  });

  it("drops a row whose author is the system, or the operator", () => {
    expect(bad({ saidByName: "system" })).toHaveLength(0);
    expect(bad({ saidByName: "operator" })).toHaveLength(0);
    expect(bad({ saidByName: "" })).toHaveLength(0);
  });

  it("drops a row with no locus and a row with no words", () => {
    expect(bad({ about: "" })).toHaveLength(0);
    expect(bad({ answer: "   " })).toHaveLength(0);
  });

  it("keeps the good row, so the drops above discriminate", () => {
    expect(readStakeholderAnswers(program({ answers: [answer] }) as never)).toHaveLength(1);
  });

  it("mints nothing for a locus that has no open claim to answer", () => {
    // An answer to a question nobody asked. It stays on the record as what they
    // said; it does not get to invent a claim.
    expect(stakeholderAnswerClaims(createLedgerStore(), [answer])).toHaveLength(0);
  });
});
