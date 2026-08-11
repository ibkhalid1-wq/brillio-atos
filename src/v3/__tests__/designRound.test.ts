/**
 * THE DESIGN REVIEW ROUND — the model layer of the redesigned Design Loop.
 *
 * These tests pin the two invariants the work exists for:
 *
 *   (a) an operator recording "Priya approved in the meeting" is NOT the same evidence
 *       as Priya clicking approve, and the two can never be conflated — not in the
 *       data, not in the rollup, not in the gate;
 *   (b) "all stakeholders approve" has a DEFINED failure state — waive with a reason
 *       or delegate to a named other, both on the record — and the gate can never be
 *       reached by quietly dropping the person who will not answer.
 *
 * …plus the gate move itself: `envision`/`show` close on APPROVALS, not on documents
 * existing, and a programme that has never opened a round reads as NOT STARTED rather
 * than as passed or as some fabricated state.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  openDesignRound, currentDesignRound, listDesignRounds, designRoundRollup, designRoundGate,
  recordDesignRoundVerdict, waiveDesignRoundParticipant, delegateDesignRoundParticipant,
  closeDesignRound, designRoundReviewInput, designRoundLinkFor, attachDesignRoundLinks,
  readDesignVersion, inboxItemRoundAttribution, recordInboxResponseOnRound,
  DESIGN_ROUND_REVIEW_KIND,
} from "@/v3/components/flow/flowDesignRound";
import { mintReviewPack, mintFollowUpPack } from "@/v3/components/flow/flowPortal";
import { gateChecklist, gateReadiness, flowMovements, movementArtifacts } from "@/v3/components/flow/flowShellData";

beforeAll(() => {
  if (!globalThis.crypto?.getRandomValues) {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.map(() => 7) });
  }
});

const prog = (data: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", name: "Laila CRM", rawData: data } as unknown as ProgramSummary);

/** A generated document, as the artifact readers see one: a summary is what makes
 * `movementArtifacts` read it as present. */
const doc = (summary: string, at = "2026-08-01T09:00:00.000Z") => ({ summary, generatedAt: at, confidence: 0.9 });

/** A programme whose design is BUILT — the state a round can be opened against. */
const built = (extra: Record<string, unknown> = {}) => prog({
  prototypeBuild: { ...doc("A clickable Laila CRM prototype."), title: "Laila CRM prototype", html: "<div/>" },
  demoScripts: { ...doc("One script per stakeholder.", "2026-08-01T10:00:00.000Z"), title: "Demo scripts" },
  ...extra,
});

const ROSTER = [
  { name: "Priya Raghunathan", role: "Head of Sales Ops", email: "priya@x.com" },
  { name: "João Álvares", role: "Regional Director", email: "joao@x.com" },
  { name: "Dan Reyes", role: "Account Executive", email: "dan@x.com" },
];

/** Open a round on a built design and hand back the programme carrying it. */
function withRound(roster = ROSTER, base = built()): ProgramSummary {
  const blob = openDesignRound(base, { roster }, "operator");
  expect(blob).not.toBeNull();
  return prog(blob as Record<string, unknown>);
}

/** Mint the round's link for one person — the SAME durable review link every other
 * share uses, stamped with the round id. */
function withLink(program: ProgramSummary, who: string): ProgramSummary {
  const round = currentDesignRound(program)!;
  const input = designRoundReviewInput(program, round.id, who);
  expect(input).not.toBeNull();
  const blob = mintReviewPack(program, input!, "operator");
  expect(blob).not.toBeNull();
  return prog(blob as Record<string, unknown>);
}

function withLinks(program: ProgramSummary, names: string[]): ProgramSummary {
  return names.reduce((p, name) => withLink(p, name), program);
}

describe("design round — the object", () => {
  it("refuses to open a round when there is no prototype build to review", () => {
    expect(openDesignRound(prog({}), { roster: ROSTER }, "operator")).toBeNull();
    // Demo scripts alone are not a design either.
    expect(openDesignRound(prog({ demoScripts: { generatedAt: "x" } }), { roster: ROSTER }, "operator")).toBeNull();
  });

  it("refuses to open a round that asks nobody", () => {
    expect(openDesignRound(built(), { roster: [] }, "operator")).toBeNull();
    expect(openDesignRound(built(), { roster: [{ name: "   " }] }, "operator")).toBeNull();
  });

  it("bundles the design version, the roster and each stakeholder's state — N asked at once", () => {
    const p = withRound();
    const round = currentDesignRound(p)!;
    expect(round.ordinal).toBe(1);
    expect(round.design.key).toBe(readDesignVersion(p).key);
    expect(round.design.hasPrototype).toBe(true);
    expect(round.design.hasDemoScripts).toBe(true);
    const rollup = designRoundRollup(p);
    expect(rollup.asked).toBe(3);
    expect(rollup.outstanding).toBe(3);
    expect(rollup.outstandingNames).toEqual(["Priya Raghunathan", "João Álvares", "Dan Reyes"]);
    expect(rollup.people.every((person) => person.state === "asked")).toBe(true);
  });

  it("round 2 supersedes round 1 — iteration is visible, never overwritten", () => {
    const first = withLinks(withRound(), ["Priya Raghunathan"]);
    const answered = prog(recordDesignRoundVerdict(first, {
      who: "Priya Raghunathan", verdict: "changes", attestation: "self", text: "The pipeline board is wrong.",
    }, "operator")!);
    const second = prog(openDesignRound(answered, { roster: ROSTER }, "operator")!);
    const rounds = listDesignRounds(second);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].supersededBy).toBe(rounds[1].id);
    // Round 1 keeps what it heard.
    expect(rounds[0].participants.find((p) => p.name === "Priya Raghunathan")!.response!.verdict).toBe("changes");
    expect(currentDesignRound(second)!.ordinal).toBe(2);
    // The current rollup is round 2's own — round 1's verdict does not bleed into it.
    expect(designRoundRollup(second).objected).toBe(0);
  });

  it("every link in a round carries the round id, and a later follow-up clears it", () => {
    const p = withLink(withRound(), "Priya Raghunathan");
    const round = currentDesignRound(p)!;
    const pack = designRoundLinkFor(p, round.id, "Priya Raghunathan")!;
    expect(pack).not.toBeNull();
    expect(pack.designRoundId).toBe(round.id);
    expect(pack.role).toBe(`review:${DESIGN_ROUND_REVIEW_KIND}`);
    // The round records which pack carries its ask.
    const attached = prog(attachDesignRoundLinks(p, round.id, "operator")!);
    expect(currentDesignRound(attached)!.participants[0].packId).toBe(pack.id);
    // A follow-up on the SAME durable link is not part of the round: an answer to it
    // must never be attributed to the round.
    const followed = prog(mintFollowUpPack(attached, {
      movementId: "listen", who: "Priya Raghunathan", questions: ["Which system holds amendments?"], captureField: "interviewTranscripts",
    }, "operator")!);
    expect(designRoundLinkFor(followed, round.id, "Priya Raghunathan")).toBeNull();
  });

  it("re-sharing an IDENTICAL review for a new round is not a no-op — the link moves to round 2", () => {
    // Byte-identical asks, distinguished ONLY by the round they belong to: a person's
    // durable link is idempotent per ask, so without the round in the ask's identity
    // the re-share is a silent no-op and their link keeps pointing at round 1.
    const ask = (designRoundId: string) => ({
      movementId: "show", who: "Priya Raghunathan", role: "Reviewer", captureField: "demoFeedback",
      reviewKind: DESIGN_ROUND_REVIEW_KIND, review: { kind: DESIGN_ROUND_REVIEW_KIND },
      questions: ["Do you approve this design?"], intro: "Round.", designRoundId,
    });
    const p = withRound();
    const roundOne = currentDesignRound(p)!;
    const shared = prog(mintReviewPack(p, ask(roundOne.id), "operator")!);
    const second = prog(openDesignRound(shared, { roster: ROSTER }, "operator")!);
    const roundTwo = currentDesignRound(second)!;
    const reshared = mintReviewPack(second, ask(roundTwo.id), "operator");
    expect(reshared).not.toBeNull();
    expect(designRoundLinkFor(prog(reshared!), roundTwo.id, "Priya Raghunathan")).not.toBeNull();
    expect(designRoundLinkFor(prog(reshared!), roundOne.id, "Priya Raghunathan")).toBeNull();
  });
});

describe("design round — invariant (a): self-attested is never the same as operator-attested", () => {
  it("an operator's meeting capture is recorded AS the operator's, and counted apart", () => {
    const p = withRound();
    const blob = recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "operator",
      text: "Approved out loud in the Thursday design review.", source: "meeting",
    }, "operator");
    expect(blob).not.toBeNull();
    const rollup = designRoundRollup(prog(blob!));
    const priya = rollup.people.find((person) => person.name === "Priya Raghunathan")!;
    expect(priya.state).toBe("accepted");
    expect(priya.attestation).toBe("operator");
    expect(rollup.accepted).toBe(1);
    expect(rollup.acceptedOperatorAttested).toBe(1);
    expect(rollup.acceptedSelfAttested).toBe(0);
    // The gate states the split rather than reporting a bare "1 approved".
    const gate = designRoundGate(prog(blob!));
    expect(gate.detail ?? gate.label).toMatch(/recorded by the operator/);
  });

  it("an operator capture with no stated basis is refused", () => {
    const p = withRound();
    expect(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "operator",
    }, "operator")).toBeNull();
    expect(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "operator", text: "   ",
    }, "operator")).toBeNull();
  });

  it("nobody can be said to have answered for themselves on an ask they never got", () => {
    const p = withRound();
    // No link minted for Dan — a "self" answer from him is not attributable.
    expect(recordDesignRoundVerdict(p, {
      who: "Dan Reyes", verdict: "approved", attestation: "self",
    }, "operator")).toBeNull();
    const linked = withLink(p, "Dan Reyes");
    expect(recordDesignRoundVerdict(linked, {
      who: "Dan Reyes", verdict: "approved", attestation: "self",
    }, "operator")).not.toBeNull();
  });

  it("an operator capture can NEVER overwrite the stakeholder's own answer", () => {
    const p = withLink(withRound(), "Priya Raghunathan");
    const selfAnswered = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "changes", attestation: "self", text: "Two screens are wrong.",
    }, "operator")!);
    // "She told me in the meeting she's happy now" does not land on top of her own word.
    expect(recordDesignRoundVerdict(selfAnswered, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "operator",
      text: "Said she was happy in the follow-up call.",
    }, "operator")).toBeNull();
    const rollup = designRoundRollup(selfAnswered);
    expect(rollup.objected).toBe(1);
    expect(rollup.accepted).toBe(0);
  });

  it("their own later answer supersedes an operator capture — and the capture stays on the record", () => {
    const p = withLink(withRound(), "Priya Raghunathan");
    const captured = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "operator", text: "Nodded along in the review.",
    }, "operator")!);
    const answered = prog(recordDesignRoundVerdict(captured, {
      who: "Priya Raghunathan", verdict: "changes", attestation: "self", text: "Actually, the board is wrong.",
    }, "operator")!);
    const person = currentDesignRound(answered)!.participants.find((x) => x.name === "Priya Raghunathan")!;
    expect(person.history).toHaveLength(2);
    expect(person.history![0].attestation).toBe("operator");
    expect(person.history![0].verdict).toBe("approved");
    expect(person.response!.attestation).toBe("self");
    expect(person.response!.verdict).toBe("changes");
    // The operator capture is still marked as the operator's — never promoted.
    expect(person.history!.some((entry) => entry.attestation === "self" && entry.verdict === "approved")).toBe(false);
  });

  it("an unrecognised attestation is refused — it is never defaulted", () => {
    const p = withRound();
    expect(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved",
      attestation: "" as unknown as "self", text: "x",
    }, "operator")).toBeNull();
  });
});

describe("design round — invariant (b): the recorded escape, and no quiet drops", () => {
  it("a waiver needs a reason, and the reason stays visible in the rollup", () => {
    const p = withRound();
    expect(waiveDesignRoundParticipant(p, { who: "Dan Reyes", reason: "" }, "operator")).toBeNull();
    expect(waiveDesignRoundParticipant(p, { who: "Dan Reyes", reason: "  x " }, "operator")).toBeNull();
    const waived = prog(waiveDesignRoundParticipant(p, {
      who: "Dan Reyes", reason: "On parental leave until October; sponsor agreed to proceed.",
    }, "operator")!);
    const rollup = designRoundRollup(waived);
    expect(rollup.waived).toBe(1);
    expect(rollup.waivedNames).toEqual(["Dan Reyes"]);
    expect(rollup.asked).toBe(3);
    const dan = rollup.people.find((person) => person.name === "Dan Reyes")!;
    expect(dan.state).toBe("waived");
    expect(dan.resolution!.reason).toMatch(/parental leave/);
    expect(dan.resolution!.by).toBe("operator");
    // A waiver is NOT an approval.
    expect(rollup.accepted).toBe(0);
  });

  it("a delegation names the other, adds them to the roster, and keeps the original on it", () => {
    const p = withRound();
    expect(delegateDesignRoundParticipant(p, {
      who: "Dan Reyes", to: { name: "" }, reason: "Handing over to his deputy.",
    }, "operator")).toBeNull();
    expect(delegateDesignRoundParticipant(p, {
      who: "Dan Reyes", to: { name: "Dan Reyes" }, reason: "Handing over to his deputy.",
    }, "operator")).toBeNull();
    const delegated = prog(delegateDesignRoundParticipant(p, {
      who: "Dan Reyes", to: { name: "Mia Okonkwo", role: "Sales Ops Lead" },
      reason: "Dan is out; Mia owns the pipeline board day to day.",
    }, "operator")!);
    const rollup = designRoundRollup(delegated);
    expect(rollup.asked).toBe(4);
    expect(rollup.delegatedNames).toEqual(["Dan Reyes"]);
    const dan = rollup.people.find((person) => person.name === "Dan Reyes")!;
    expect(dan.state).toBe("delegated");
    expect(dan.resolution!.to!.name).toBe("Mia Okonkwo");
    const mia = rollup.people.find((person) => person.name === "Mia Okonkwo")!;
    expect(mia.state).toBe("asked");
    expect(mia.delegatedFrom).toBe("Dan Reyes");
    // The delegate now has to answer — the phase is not closed by the delegation.
    expect(rollup.outstandingNames).toContain("Mia Okonkwo");
    expect(designRoundGate(delegated).done).toBe(false);
  });

  it("the roster only ever GROWS — the gate cannot be reached by dropping someone", () => {
    let p = withRound();
    const before = currentDesignRound(p)!.participants.map((person) => person.name);
    // Exercise every exported mutator that touches a round.
    p = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "operator", text: "Approved in the review.",
    }, "operator")!);
    p = prog(waiveDesignRoundParticipant(p, { who: "João Álvares", reason: "Unreachable for six weeks." }, "operator")!);
    p = prog(delegateDesignRoundParticipant(p, {
      who: "Dan Reyes", to: { name: "Mia Okonkwo", role: "Sales Ops Lead" }, reason: "Dan is out.",
    }, "operator")!);
    const after = currentDesignRound(p)!.participants.map((person) => person.name);
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    for (const name of before) expect(after).toContain(name);
    // The waived and delegated people are still COUNTED and NAMED in the rollup.
    const rollup = designRoundRollup(p);
    expect(rollup.asked).toBe(4);
    expect(rollup.waivedNames).toEqual(["João Álvares"]);
    expect(rollup.delegatedNames).toEqual(["Dan Reyes"]);
    // …and the round still cannot close, because the delegate has not answered.
    expect(closeDesignRound(p, currentDesignRound(p)!.id, "operator")).toBeNull();
  });

  it("neither escape can erase an answer the stakeholder already gave for themselves", () => {
    const p = withLink(withRound(), "Priya Raghunathan");
    const objected = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "changes", attestation: "self", text: "The board is wrong.",
    }, "operator")!);
    expect(waiveDesignRoundParticipant(objected, {
      who: "Priya Raghunathan", reason: "Let us just move on.",
    }, "operator")).toBeNull();
    expect(delegateDesignRoundParticipant(objected, {
      who: "Priya Raghunathan", to: { name: "Mia Okonkwo" }, reason: "Let us just move on.",
    }, "operator")).toBeNull();
  });

  it("closing records a fact — it is refused while anyone is outstanding, and stands once all are resolved", () => {
    let p = withRound();
    const roundId = currentDesignRound(p)!.id;
    expect(closeDesignRound(p, roundId, "operator")).toBeNull();
    for (const who of ["Priya Raghunathan", "João Álvares", "Dan Reyes"]) {
      p = prog(recordDesignRoundVerdict(p, {
        who, verdict: "approved", attestation: "operator", text: "Approved in the joint review session.",
      }, "operator")!);
    }
    const closed = closeDesignRound(p, roundId, "operator");
    expect(closed).not.toBeNull();
    expect(currentDesignRound(prog(closed!))!.closedAt).toBeTruthy();
  });
});

describe("design round — the gate reads honestly in all three states", () => {
  const envision = () => flowMovements().find((m) => m.id === "envision")!;
  const show = () => flowMovements().find((m) => m.id === "show")!;
  const verdict = (p: ProgramSummary, movement = envision()) => {
    const artifacts = movementArtifacts(p, movement);
    return gateReadiness(p, movement, artifacts, gateChecklist(p, movement, artifacts));
  };
  const approvalRow = (p: ProgramSummary, movement = envision()) =>
    gateChecklist(p, movement, movementArtifacts(p, movement)).find((item) => item.id === "design-approval");

  /** Everything the OLD artifact-based gate wanted for Envision: every document
   * generated, a direction on record, a track plan adopted, the Inbox clear. */
  const fullyBuilt = () => built({
    architectureStrategy: doc("Agentic core, three candidates weighed."),
    experienceDesign: doc("Screens and flows for every persona."),
    agenticBlueprint: doc("Agents, tools, orchestration, HITL points."),
    prototypePack: doc("The build pack the prototype was assembled from."),
    tracks: [{ id: "a" }],
    phaseInputs: {
      envision: { directionDecision: "Agentic core, for the reasons in the steering note." },
      show: {
        prototypeLocation: "https://laila.demo.internal",
        demoTour: JSON.stringify(ROSTER.map((person) => ({ stakeholder: person.name, verdict: "Accepted" }))),
      },
      frame: { sponsor: "Priya Raghunathan" },
    },
  });

  it("(a) NO ROUND — the loop reads not-started, and a fully generated programme is never complete", () => {
    const p = fullyBuilt();
    const gate = designRoundGate(p);
    expect(gate.done).toBe(false);
    expect(gate.tone).toBe("dim");
    expect(gate.label).toMatch(/not opened/);
    expect(gate.rollup.round).toBeNull();
    expect(gate.rollup.asked).toBe(0);
    expect(gate.rollup.state).toBe("not-started");
    // Every document exists — under the old gate this was "Ready for the gate".
    const row = approvalRow(p)!;
    expect(row).toBeDefined();
    expect(row.done).toBe(false);
    expect(row.advisory).toBeUndefined();
    const readiness = verdict(p);
    expect(readiness.kind).not.toBe("ready");
    expect(readiness.tone).not.toBe("green");
    expect(readiness.detail).toMatch(/not opened/);
    // …and Show reads the same closing criterion — they are one band.
    expect(approvalRow(p, show())!.done).toBe(false);
  });

  it("(a) a programme with nothing at all still reads as not-started, never as a fabricated state", () => {
    const gate = designRoundGate(prog({}));
    expect(gate.done).toBe(false);
    expect(gate.rollup.asked).toBe(0);
    expect(gate.rollup.accepted).toBe(0);
    expect(gate.detail).toMatch(/Build the prototype first/);
  });

  it("(b) ROUND IN FLIGHT — the gate says who it is waiting on, by name", () => {
    const p = withRound(ROSTER, fullyBuilt());
    const gate = designRoundGate(p);
    expect(gate.done).toBe(false);
    expect(gate.tone).toBe("amber");
    expect(gate.label).toContain("Priya Raghunathan");
    expect(gate.label).toContain("João Álvares");
    const readiness = verdict(p);
    expect(readiness.kind).toBe("approvals");
    expect(readiness.detail).toContain("Priya Raghunathan");
    expect(readiness.tone).toBe("amber");
  });

  it("(b) an objection blocks the gate and names who asked for changes", () => {
    const p = withLink(withRound(ROSTER, fullyBuilt()), "Priya Raghunathan");
    const objected = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "changes", attestation: "self", text: "The pipeline board is wrong.",
    }, "operator")!);
    const gate = designRoundGate(objected);
    expect(gate.done).toBe(false);
    expect(gate.label).toContain("changes requested by Priya Raghunathan");
  });

  it("(c) ALL RESOLVED — the loop closes, and the escape routes count without hiding anyone", () => {
    let p = withLink(withRound(ROSTER, fullyBuilt()), "Priya Raghunathan");
    p = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "self", text: "Happy with it.",
    }, "operator")!);
    p = prog(recordDesignRoundVerdict(p, {
      who: "João Álvares", verdict: "approved", attestation: "operator", text: "Approved in the Lisbon session.",
    }, "operator")!);
    p = prog(waiveDesignRoundParticipant(p, {
      who: "Dan Reyes", reason: "On parental leave; sponsor agreed to proceed without him.",
    }, "operator")!);
    const gate = designRoundGate(p);
    expect(gate.done).toBe(true);
    expect(gate.tone).toBe("green");
    expect(gate.detail).toContain("1 self-attested");
    expect(gate.detail).toContain("1 recorded by the operator");
    expect(gate.detail).toContain("1 waived");
    expect(approvalRow(p)!.done).toBe(true);
    expect(verdict(p).kind).toBe("ready");
    expect(verdict(p, show()).kind).toBe("ready");
  });

  it("approvals do not survive the design moving underneath them", () => {
    let p = withRound(ROSTER, fullyBuilt());
    for (const who of ["Priya Raghunathan", "João Álvares", "Dan Reyes"]) {
      p = prog(recordDesignRoundVerdict(p, {
        who, verdict: "approved", attestation: "operator", text: "Approved in the joint session.",
      }, "operator")!);
    }
    expect(designRoundGate(p).done).toBe(true);
    // The prototype is rebuilt after they approved.
    const rebuilt = prog({
      ...(p.rawData as Record<string, unknown>),
      prototypeBuild: { title: "Laila CRM prototype", generatedAt: "2026-08-09T09:00:00.000Z", html: "<div/>" },
    });
    const gate = designRoundGate(rebuilt);
    expect(gate.rollup.designMoved).toBe(true);
    expect(gate.done).toBe(false);
    expect(gate.label).toMatch(/earlier version of the design/);
    expect(approvalRow(rebuilt)!.done).toBe(false);
  });

  it("the hand-typed demo tour stops gating once a real round exists — and gates when there is none", () => {
    const tour = {
      phaseInputs: {
        frame: { sponsor: "Priya Raghunathan" },
        show: { demoTour: JSON.stringify([{ stakeholder: "Priya Raghunathan", verdict: "Accepted" }]) },
      },
    };
    const noRound = built(tour);
    const rowOf = (p: ProgramSummary) => gateChecklist(p, show(), movementArtifacts(p, show())).find((i) => i.id === "verdicts")!;
    expect(rowOf(noRound).advisory).toBeFalsy();
    const withARound = withRound(ROSTER, built(tour));
    expect(rowOf(withARound).advisory).toBe(true);
    // An operator's "Accepted" typed in the grid never closes the loop on its own.
    expect(designRoundGate(withARound).done).toBe(false);
  });
});

describe("design round — feedback attributes to a round, a person and a design version", () => {
  const inboxItem = (over: Record<string, unknown> = {}) => ({
    id: "item-1", kind: "design-feedback", stakeholder: "Priya Raghunathan", role: "Head of Sales Ops",
    receivedAt: "2026-08-05T09:00:00.000Z", text: "The pipeline board should default to my region.", ...over,
  });

  const withInbox = (p: ProgramSummary, item: Record<string, unknown>) =>
    prog({ ...(p.rawData as Record<string, unknown>), flowPortalInbox: [item] });

  it("a quarantined response resolves to its round, stakeholder and design version through the link", () => {
    const p = withInbox(withLink(withRound(), "Priya Raghunathan"), inboxItem({ verdict: "accepted" }));
    const round = currentDesignRound(p)!;
    const attribution = inboxItemRoundAttribution(p, "item-1")!;
    expect(attribution.roundId).toBe(round.id);
    expect(attribution.ordinal).toBe(1);
    expect(attribution.who).toBe("Priya Raghunathan");
    expect(attribution.designVersion).toBe(round.design.key);
    expect(attribution.verdict).toBe("approved");
    expect(attribution.text).toMatch(/pipeline board/);
  });

  it("a response from someone holding no round link is not attributed to the round", () => {
    const p = withInbox(withRound(), inboxItem());
    expect(inboxItemRoundAttribution(p, "item-1")).toBeNull();
    expect(inboxItemRoundAttribution(withInbox(withLink(withRound(), "Priya Raghunathan"), inboxItem()), "nope")).toBeNull();
  });

  it("recording it lands as the person's OWN answer, carrying their words and the version they saw", () => {
    const p = withInbox(withLink(withRound(), "Priya Raghunathan"), inboxItem({ verdict: "rework" }));
    const recorded = prog(recordInboxResponseOnRound(p, "item-1", "operator")!);
    const person = designRoundRollup(recorded).people.find((x) => x.name === "Priya Raghunathan")!;
    expect(person.state).toBe("objected");
    expect(person.attestation).toBe("self");
    expect(person.text).toMatch(/pipeline board/);
    expect(person.answeredVersion).toBe(currentDesignRound(recorded)!.design.key);
    expect(person.versionStale).toBe(false);
    // The quarantined item is NOT consumed — the existing portal ingest still owns it.
    expect((recorded.rawData as Record<string, unknown[]>).flowPortalInbox).toHaveLength(1);
  });

  it("feedback with no verdict is a response, not an approval — the phase still waits", () => {
    const p = withInbox(withLink(withRound(), "Priya Raghunathan"), inboxItem());
    const recorded = prog(recordInboxResponseOnRound(p, "item-1", "operator")!);
    const rollup = designRoundRollup(recorded);
    expect(rollup.responded).toBe(1);
    expect(rollup.accepted).toBe(0);
    expect(rollup.outstandingNames).toContain("Priya Raghunathan");
    expect(rollup.people.find((x) => x.name === "Priya Raghunathan")!.state).toBe("responded");
  });

  it("a recording is carried as a reference beside the text", () => {
    const p = withLink(withRound(), "Priya Raghunathan");
    const recorded = prog(recordDesignRoundVerdict(p, {
      who: "Priya Raghunathan", verdict: "approved", attestation: "self",
      text: "Voice note attached.", recordingRef: "portal://rec/abc",
    }, "operator")!);
    expect(designRoundRollup(recorded).people[0].recordingRef).toBe("portal://rec/abc");
  });
});
