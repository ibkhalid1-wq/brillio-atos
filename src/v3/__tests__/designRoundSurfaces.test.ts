/**
 * THE DESIGN REVIEW ROUND'S SURFACES — the operator's board and the stakeholder's page.
 *
 * `flowDesignRound.ts` and its 29 cases already pin the MODEL. This file pins the two
 * things a model cannot: that the operator can actually reach every verb through the
 * running prop chain (FlowShell → TheLine → DesignLoopZones), and that what the surface
 * SAYS is what the rollup says — names and all.
 *
 * Two invariants are load-bearing here, and both are asserted on the DOM rather than on
 * a return value:
 *
 *   (a) SELF ≠ OPERATOR, ON SCREEN. The model keeps the two apart in the data; a surface
 *       that renders them identically hands the difference straight back. "Priya approved
 *       on her link" and "someone wrote down that Priya approved" must be distinguishable
 *       without reading carefully — different words AND a different mark.
 *
 *   (b) THE REFUSALS ARE COLLECTED, NOT DISCOVERED. `recordDesignRoundVerdict` returns
 *       null for an operator capture with no stated basis, and the escapes return null
 *       without a reason. A button that fires and silently writes nothing is worse than
 *       no button, so the controls stay disabled until the model would accept them.
 *
 * The fixture is built by the MODEL's own verbs — open, mint, record, waive — so the
 * programme under test is a real round rather than a hand-written blob that might not be
 * reachable in the product.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import FlowShell from "@/v3/components/flow/FlowShell";
import FlowRespond from "@/v3/components/flow/FlowRespond";
import {
  DESIGN_ROUND_REVIEW_KIND, attachDesignRoundLinks, currentDesignRound, designRoundGate,
  designRoundReviewInput, designRoundRollup, openDesignRound, recordDesignRoundVerdict,
  recordInboxResponseOnRound, waiveDesignRoundParticipant, inboxItemRoundAttribution,
} from "@/v3/components/flow/flowDesignRound";
import { mintReviewPack, ingestPortalResponse, listPortalInbox } from "@/v3/components/flow/flowPortal";
import { accessibleName, interactiveElements, isWordless } from "./helpers/accessibleName";

const AT = "2026-08-01T00:00:00Z";
const src = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

/** The four people asked in the round — one per outcome the surface must draw. */
const ROSTER = [
  { name: "Priya Nair", role: "Head of Revenue Operations" },
  { name: "Marcus Bell", role: "Field Sales Director" },
  { name: "Dana Ruiz", role: "Compliance Lead" },
  { name: "Sam Okafor", role: "Partner Alliances" },
];

/** A programme with a BUILT prototype and demo scripts — `openDesignRound` refuses
 *  without the first, and the stakeholder page shows the second. */
const seed = (over: Record<string, unknown> = {}): ProgramSummary => ({
  id: "p1", name: "Laila CRM", client: "Laila", methodology: "atos-flow",
  rawData: {
    data: {
      prototypeBuild: { title: "Laila CRM pilot", generatedAt: AT, html: "<main>pilot</main>" },
      demoScripts: { generatedAt: AT, scripts: [{ area: "Sales", openingQuote: "Quotes take a week." }] },
      discoveryKit: { interviews: ROSTER.map((p) => ({ stakeholder: p.name, role: p.role, questions: ["What is slow?"] })) },
      ...over,
    },
  },
} as unknown as ProgramSummary);

/** Apply a model blob back onto the programme — what `persistFlowMutation` does. */
const apply = (program: ProgramSummary, blob: Record<string, unknown> | null): ProgramSummary =>
  blob ? ({ ...program, rawData: blob } as ProgramSummary) : program;

/**
 * A live round: everyone asked, Priya linked and self-attested, Marcus recorded by the
 * operator, Dana waived with a reason, Sam still outstanding.
 */
const withRound = (): ProgramSummary => {
  let p = seed();
  p = apply(p, openDesignRound(p, { roster: ROSTER }, "op"));
  const round = currentDesignRound(p)!;
  // The link, minted through the SAME review-pack path the surface uses.
  p = apply(p, mintReviewPack(p, designRoundReviewInput(p, round.id, "Priya Nair")!, "op"));
  p = apply(p, attachDesignRoundLinks(p, round.id, "op"));
  p = apply(p, recordDesignRoundVerdict(p, { who: "Priya Nair", verdict: "approved", attestation: "self", text: "Runs my quoting workflow end to end." }, "op"));
  p = apply(p, recordDesignRoundVerdict(p, { who: "Marcus Bell", verdict: "approved", attestation: "operator", text: "Said yes in the 4 August walkthrough — wants the pricing panel wider." }, "op"));
  p = apply(p, waiveDesignRoundParticipant(p, { who: "Dana Ruiz", reason: "on sabbatical until October; Legal signed the same design in Frame" }, "op"));
  return p;
};

/* ------------------------------------------------------------------ *
 * The OPERATOR's board, mounted through the real prop chain
 * ------------------------------------------------------------------ */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onDesignRound: ReturnType<typeof vi.fn>;
let onMintReview: ReturnType<typeof vi.fn>;

type Props = Parameters<typeof FlowShell>[0];
const noop = async () => {};
const shellProps = (program: ProgramSummary): Props => ({
  program, programs: [program], runningAgentIds: new Set<string>(),
  onSelectProgram: () => {}, onCreateProgram: () => {}, onDrillDown: () => {},
  onOpenSetup: () => {}, onOpenCopilot: () => {}, onRunAgent: () => {},
  onSaveInputs: noop, onResolveDecision: noop,
  fleet: [], loadMovementSpend: async () => ({}), onSetHaltAll: noop,
  onToggleAgentHalt: noop, onSetMovementBudget: noop, onMintPacks: noop,
  onMintDemoInvites: noop, onCompileShipLanes: noop, onToggleShipItem: noop,
  onSetShipLane: noop, onHydratePrograms: noop, onScheduleFollowUp: noop,
  onMintFollowUp: async () => null, onMintReview, onMintBrief: async () => null,
  onRecordShowPass: noop, onSaveArtifactDoc: noop,
  onIngestPortalItem: noop, onDismissPortalItem: noop, onRecordApproval: noop,
  onRenameProgram: () => {}, onDeleteProgram: () => {}, onTagClaim: noop, onGoFlow: () => {},
  onDesignRound, presence: [],
} as unknown as Props);

const mountShell = (program: ProgramSummary) => {
  act(() => { root.render(createElement(FlowShell, shellProps(program))); });
  const flow = [...host.querySelectorAll("nav.v3fs-dock button")]
    .find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Flow")) as HTMLButtonElement;
  act(() => { flow.click(); });
};

const zone = () => host.querySelector(".v3dr") as HTMLElement | null;
const zoneText = () => zone()?.textContent ?? "";
/** The row the round drew for one person. */
const personRow = (name: string) =>
  [...host.querySelectorAll(".v3dr-person")].find((li) => (li.textContent ?? "").includes(name)) as HTMLElement | undefined;
const buttonSaying = (scope: ParentNode, fragment: string) =>
  [...scope.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(fragment)) as HTMLButtonElement | undefined;
/** Type into a controlled field the way a person does. */
const typeInto = (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
/** Open one person's record/waive/delegate panel. */
const openPanel = (name: string) => {
  const row = personRow(name)!;
  act(() => { (row.querySelector(".v3dr-disc") as HTMLButtonElement).click(); });
  return personRow(name)!;
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onDesignRound = vi.fn(async () => {});
  onMintReview = vi.fn(async () => "https://example.test/link");
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: class { observe() {} unobserve() {} disconnect() {} },
    writable: true, configurable: true,
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Design Loop band draws the round, by name", () => {
  it("reaches the surface at all — the whole prop chain is wired", () => {
    // If FlowShell or TheLine stops passing the handler down, the round renders
    // read-only and every case below goes vacuous. Assert the wiring first.
    mountShell(withRound());
    expect(zone(), "the Design Loop band draws no round surface").toBeTruthy();
    expect(host.querySelectorAll(".v3dr-person").length).toBe(ROSTER.length);
    // …and the WRITE half is reachable, not just the reading. A dropped handler
    // anywhere on the chain renders the round read-only, which looks fine.
    expect(buttonSaying(zone()!, "meeting mode"), "the round is read-only — a handler is unwired").toBeTruthy();
    expect(buttonSaying(zone()!, "share the round link"), "no way to send the ask — the mint is unwired").toBeTruthy();
  });

  it("every participant is named with the state the ROLLUP gives them", () => {
    const program = withRound();
    const rollup = designRoundRollup(program);
    mountShell(program);
    for (const person of rollup.people) {
      const row = personRow(person.name);
      expect(row, `${person.name} has no row`).toBeTruthy();
      expect(row!.className).toContain(`is-${person.state}`);
    }
    // …and the outstanding one is named, not just counted
    expect(rollup.outstandingNames).toEqual(["Sam Okafor"]);
    expect(zoneText()).toContain("Sam Okafor");
  });

  it("the approval total is printed WITH its attestation split, never merged", () => {
    const program = withRound();
    const rollup = designRoundRollup(program);
    mountShell(program);
    const counts = host.querySelector(".v3dr-counts")!.textContent ?? "";
    expect(rollup.accepted).toBe(2);
    expect(counts).toContain(`${rollup.accepted}`);
    expect(counts).toContain(`${rollup.acceptedSelfAttested} self-attested`);
    expect(counts).toContain(`${rollup.acceptedOperatorAttested} recorded by the operator`);
    // every printed number is the rollup's own
    expect(counts).toContain(`${rollup.waived}`);
    expect(counts).toContain(`${rollup.outstanding}`);
  });
});

describe("(a) a person's own word never looks like a note about them", () => {
  it("the two attestations differ in WORDS and in MARK", () => {
    mountShell(withRound());
    const self = personRow("Priya Nair")!.querySelector(".v3dr-att")!;
    const operator = personRow("Marcus Bell")!.querySelector(".v3dr-att")!;
    expect(self.className).toContain("is-self");
    expect(operator.className).toContain("is-operator");
    expect(self.className).not.toEqual(operator.className);
    expect(self.textContent).toContain("own word");
    expect(operator.textContent).toContain("recorded by the operator");
    expect(operator.textContent).toContain("not Marcus Bell");
    // The exact failure this guards: identical rendering for two different facts.
    expect(self.textContent).not.toEqual(operator.textContent);
  });

  it("an operator capture shows the basis it was recorded on", () => {
    mountShell(withRound());
    expect(personRow("Marcus Bell")!.textContent).toContain("4 August walkthrough");
  });

  it("the operator is not offered a control that would overwrite a self-attested answer", () => {
    // The model REFUSES this write. Offering the button and letting it write nothing
    // is the failure — the surface says why instead.
    mountShell(withRound());
    const priya = personRow("Priya Nair")!;
    expect(priya.querySelector(".v3dr-disc"), "a record control over Priya's own word").toBeNull();
    expect(priya.textContent).toContain("cannot be recorded over");
    // …and it IS offered for the person who has not answered for themselves
    expect(personRow("Sam Okafor")!.querySelector(".v3dr-disc")).toBeTruthy();
  });
});

describe("(b) the refusals are collected up front, not discovered on click", () => {
  it("a verdict cannot be recorded until a basis is stated — and it rides as `operator`", async () => {
    mountShell(withRound());
    const row = openPanel("Sam Okafor");
    const record = buttonSaying(row, "record Sam Okafor")!;
    act(() => { buttonSaying(row, "approved the design")!.click(); });
    expect(record.disabled, "recordable with no stated basis — the model would refuse it").toBe(true);
    typeInto(row.querySelector("textarea") as HTMLTextAreaElement, "Approved on the 6 August call.");
    expect(buttonSaying(personRow("Sam Okafor")!, "record Sam Okafor")!.disabled).toBe(false);
    await act(async () => { buttonSaying(personRow("Sam Okafor")!, "record Sam Okafor")!.click(); });
    expect(onDesignRound).toHaveBeenCalledWith(expect.objectContaining({
      op: "verdict", who: "Sam Okafor", verdict: "approved",
      attestation: "operator", text: "Approved on the 6 August call.",
    }));
  });

  it("meeting mode says whose word it is, and stamps the source", async () => {
    mountShell(withRound());
    act(() => { buttonSaying(zone()!, "meeting mode")!.click(); });
    expect(zoneText()).toContain("attested by you");
    // it opens every outstanding person's panel — that is what "one sitting" means
    const row = personRow("Sam Okafor")!;
    expect(row.querySelector("textarea"), "meeting mode left the panel shut").toBeTruthy();
    act(() => { buttonSaying(row, "asked for changes")!.click(); });
    typeInto(personRow("Sam Okafor")!.querySelector("textarea") as HTMLTextAreaElement, "Wants partner tiers first.");
    await act(async () => { buttonSaying(personRow("Sam Okafor")!, "record Sam Okafor")!.click(); });
    expect(onDesignRound).toHaveBeenCalledWith(expect.objectContaining({
      attestation: "operator", verdict: "changes", source: "meeting",
    }));
  });

  it("waive and delegate each demand a reason before they can fire", async () => {
    mountShell(withRound());
    const row = openPanel("Sam Okafor");
    expect(buttonSaying(row, "waive Sam Okafor")!.disabled).toBe(true);
    expect(buttonSaying(row, "delegate Sam Okafor")!.disabled).toBe(true);
    typeInto(row.querySelector(".v3dr-field input") as HTMLInputElement, "left the programme in July");
    const withReason = personRow("Sam Okafor")!;
    expect(buttonSaying(withReason, "waive Sam Okafor")!.disabled).toBe(false);
    // a delegation still needs the NAMED other
    expect(buttonSaying(withReason, "delegate Sam Okafor")!.disabled).toBe(true);
    typeInto(withReason.querySelectorAll(".v3dr-field input")[1] as HTMLInputElement, "Rae Lin");
    await act(async () => { buttonSaying(personRow("Sam Okafor")!, "delegate Sam Okafor")!.click(); });
    expect(onDesignRound).toHaveBeenCalledWith(expect.objectContaining({
      op: "delegate", who: "Sam Okafor", to: { name: "Rae Lin" }, reason: "left the programme in July",
    }));
  });

  it("a waiver already on the record reads as a waiver, with its reason — never as an approval", () => {
    mountShell(withRound());
    const dana = personRow("Dana Ruiz")!;
    expect(dana.textContent).toContain("waived");
    expect(dana.textContent).toContain("sabbatical");
    expect(dana.querySelector(".v3dr-att"), "a waiver is not an attestation").toBeNull();
  });
});

describe("the gate, the mint and the empty state", () => {
  it("the band states the gate the model computes — outstanding people by name", () => {
    const program = withRound();
    const gate = designRoundGate(program);
    mountShell(program);
    expect(gate.done).toBe(false);
    expect(host.querySelector(".v3dr-gate")!.className).toContain(`tone-${gate.tone}`);
    expect(host.querySelector(".v3dr-gate-l")!.textContent).toBe(gate.label);
    expect(host.querySelector(".v3dr-gate-d")!.textContent).toBe(gate.detail);
    expect(gate.label).toContain("Sam Okafor");
  });

  it("sharing a round link goes through the EXISTING review mint, stamped with the round", async () => {
    const program = withRound();
    const round = currentDesignRound(program)!;
    mountShell(program);
    await act(async () => { buttonSaying(zone()!, "share the round link")!.click(); });
    // Priya already holds hers and Dana is waived — nobody is sent a link for a
    // review they are on the record as not giving. The other two are minted, each
    // with the round stamp.
    const asked = onMintReview.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(asked.map((a) => a.who).sort()).toEqual(["Marcus Bell", "Sam Okafor"]);
    for (const input of asked) {
      expect(input.reviewKind).toBe(DESIGN_ROUND_REVIEW_KIND);
      expect(input.designRoundId).toBe(round.id);
      expect(input.movementId).toBe("show");
    }
    // …then the round records which pack carries whose ask
    expect(onDesignRound).toHaveBeenCalledWith({ op: "link", roundId: round.id });
  });

  it("the attestation for a round link SAYS it was a round link", () => {
    // Found live: the mint's log line was a two-branch ternary, so a design-round
    // share was recorded as "Shared a ontology & current-state review — <name>".
    // The trail then said we had shared the ontology with someone we had actually
    // asked to approve a prototype.
    const program = withRound();
    const round = currentDesignRound(program)!;
    const blob = mintReviewPack(program, designRoundReviewInput(program, round.id, "Sam Okafor")!, "op")!;
    const inner = (blob.data ?? blob) as Record<string, unknown>;
    const last = (inner.flowAttestations as Array<{ action: string }>).slice(-1)[0];
    expect(last.action).toContain("Sam Okafor");
    expect(last.action).toContain("design review round");
    expect(last.action, "a round link logged as an ontology share").not.toContain("ontology");
  });

  it("the mint records the round's back-reference in the SAME write", () => {
    // Found on a live programme: minting, then attaching as a SECOND mutation, runs
    // the attach against the programme as it stood BEFORE the mint — no pack carries
    // the round yet, so `attachDesignRoundLinks` writes nothing and the participant
    // keeps no `packId`. The two must be one write.
    const program = withRound();
    const round = currentDesignRound(program)!;
    const input = designRoundReviewInput(program, round.id, "Sam Okafor")!;
    const minted = mintReviewPack(program, input, "op")!;
    const attached = attachDesignRoundLinks({ ...program, rawData: minted } as ProgramSummary, round.id, "op");
    expect(attached, "the attach found no freshly-minted pack").toBeTruthy();
    const sam = currentDesignRound(apply(program, attached))!.participants.find((p) => p.name === "Sam Okafor")!;
    expect(sam.packId, "the round kept no back-reference to the link it just sent").toBeTruthy();
    // …and the shell is what chains them
    expect(src("AppShellV3.tsx")).toContain("attachDesignRoundLinks(base, input.designRoundId, actor)");
  });

  it("a programme with no round reads as NOT STARTED — no count, no pass", () => {
    const program = seed();
    const gate = designRoundGate(program);
    mountShell(program);
    // The GATE is the one voice for this fact now (2026-08-11). It used to be said
    // twice: the gate's own empty state, and — one line below it — a hand-written
    // paragraph ("No design review round has been opened. Nothing is approved and
    // nothing has failed — nobody has been asked.") saying the same thing in the
    // surface's words. The gate won because it is DERIVED: label, tone and next action
    // all come from `designRoundGate`, so they cannot drift from the model the way a
    // second sentence maintained by hand can.
    expect(gate.label).toContain("not opened");
    expect(host.querySelector(".v3dr-gate-l")!.textContent).toBe(gate.label);
    expect(host.querySelector(".v3dr-gate")!.className).toContain("tone-dim");
    expect(host.querySelectorAll(".v3dr-person").length).toBe(0);
    expect(host.querySelector(".v3dr-counts"), "counts printed for a round that does not exist").toBeNull();
    // the roster picker is the way in, and it names real people
    act(() => { buttonSaying(zone()!, "open a design review round")!.click(); });
    for (const person of ROSTER) expect(zoneText()).toContain(person.name);
  });

  it("the not-started fact is stated ONCE — the round's paragraph no longer echoes the gate", () => {
    // The defect, precisely: the round's empty state landed underneath the gate's own
    // empty state, neither aware of the other, so the operator read the same fact in
    // two voices. Reverting either half of the fix trips this.
    mountShell(seed());
    const text = zoneText();
    expect(text, "the hand-written echo of the gate is back").not.toContain("No design review round has been opened");
    expect(text, "the hand-written echo of the gate is back").not.toContain("nobody has been asked");
    // …and the fact itself survived: exactly one element says the round is not opened
    const saying = [...zone()!.querySelectorAll("*")]
      .filter((el) => !el.querySelector("*") && /not opened/i.test(el.textContent ?? ""));
    expect(saying).toHaveLength(1);
    expect(saying[0].className).toBe("v3dr-gate-l");
  });

  it("a LOCKED Design Loop opens no round and records no verdict", () => {
    const locked = { ...withRound(), gateReviews: { show: { status: "approved" } } } as unknown as ProgramSummary;
    mountShell(locked);
    expect(zone(), "the round still reads").toBeTruthy();
    expect(host.querySelectorAll(".v3dr-disc").length, "verdict controls on a locked programme").toBe(0);
    expect(buttonSaying(zone()!, "meeting mode")).toBeUndefined();
    expect(buttonSaying(zone()!, "share the round link")).toBeUndefined();
    // …and the same lock on a programme with no round hides the way in entirely
    const lockedEmpty = { ...seed(), gateReviews: { envision: { status: "approved" } } } as unknown as ProgramSummary;
    act(() => { root.render(createElement(FlowShell, shellProps(lockedEmpty))); });
    const flow = [...host.querySelectorAll("nav.v3fs-dock button")]
      .find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Flow")) as HTMLButtonElement;
    act(() => { flow.click(); });
    expect(buttonSaying(zone()!, "open a design review round")).toBeUndefined();
  });
});

describe("accessibility of the round's controls", () => {
  it("every control announces words, and no two of them announce the same words", () => {
    mountShell(withRound());
    // Open every panel there is, so the audit sees the repeated row — twenty
    // buttons all called "Approve" is the exact failure this catches.
    act(() => { buttonSaying(zone()!, "meeting mode")!.click(); });
    for (const disc of [...host.querySelectorAll(".v3dr-disc")] as HTMLButtonElement[]) {
      act(() => { disc.click(); });
    }
    // The WHOLE page, not just the zone: a round control that answers to the same
    // words as something else on Flow is just as ambiguous as two of its own.
    const named = interactiveElements(host).map((el) => ({ el, name: accessibleName(el) }));
    expect(named.length, "the round drew no controls — this case proves nothing").toBeGreaterThan(4);
    expect(named.filter((x) => isWordless(x.name)).map((x) => x.el.className)).toEqual([]);
    const clashes = new Map<string, number>();
    for (const { name } of named) clashes.set(name, (clashes.get(name) ?? 0) + 1);
    expect([...clashes.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it("the round adds no div-as-button — every control is a real button or field", () => {
    mountShell(withRound());
    act(() => { buttonSaying(zone()!, "meeting mode")!.click(); });
    const focusableDivs = [...zone()!.querySelectorAll('[tabindex="0"], [role="button"]')]
      .filter((el) => !["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));
    expect(focusableDivs.map((el) => el.className)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The STAKEHOLDER's page
 * ------------------------------------------------------------------ */

const realFetch = globalThis.fetch;

/** The pack the edge serves for a round link: an interview pack on the SHOW
 *  movement, stamped `design-round`, carrying the built prototype and their script. */
const servedRoundPack = (over: Record<string, unknown> = {}) => ({
  kind: "interview", programme: "Laila CRM", stakeholder: "Priya Nair",
  role: `review:${DESIGN_ROUND_REVIEW_KIND}`, movementId: "show",
  intro: "Round 1 of the design review.", questions: ["Do you approve this design?"],
  objective: "Cut quote turnaround from a week to a day",
  reviewKind: DESIGN_ROUND_REVIEW_KIND,
  review: { kind: DESIGN_ROUND_REVIEW_KIND, roundId: "round-1", ordinal: 1, designVersion: AT, prototypeTitle: "Laila CRM pilot" },
  pilotHtml: "<main>the built pilot</main>", pilotSource: "assembled",
  script: { openingQuote: "Quotes take a week.", scenario: "You are quoting a mid-market renewal.", acceptanceAsk: "Do you approve this design as the one we build on?", steps: [{ beat: "Open the deal", say: "Everything is already on the record." }] },
  responded: false, closed: false, answered: false,
  ...over,
});

describe("the stakeholder's round page", () => {
  let posted: Array<Record<string, unknown>>;
  const text = () => host.textContent ?? "";
  const mountLink = async (pack: Record<string, unknown>) => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posted.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => pack };
    }) as unknown as typeof fetch;
    await act(async () => { root.render(createElement(FlowRespond, { token: "p1.deadbeef" })); });
  };
  const sent = () => posted.filter((p) => typeof p.answers === "string");

  beforeEach(() => { posted = []; localStorage.clear(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("shows the prototype and THEIR demo script, and asks the round's one question", async () => {
    await mountLink(servedRoundPack());
    expect(host.querySelector("iframe, .v3fs-pilot, .v3fs-dr-proto"), "no prototype on the page").toBeTruthy();
    expect(text()).toContain("Your demo script");
    expect(text()).toContain("Quotes take a week.");
    expect(text()).toContain("Do you approve this design as the one we build on?");
    expect(text()).toContain("round 1 of the design review");
    // It must NOT fall through to the ontology/workflow review — that surface
    // reads `terms`, which a round stamp does not have.
    expect(text()).not.toContain("The terms we heard");
  });

  it("asking for changes needs the changes said; approving does not", async () => {
    await mountLink(servedRoundPack());
    const send = () => host.querySelector(".v3fs-rvw-send") as HTMLButtonElement;
    expect(send().disabled, "sendable before any answer").toBe(true);
    const [approve, changes] = [...host.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    act(() => { changes.click(); });
    expect(send().disabled, "a change request with nothing to change").toBe(true);
    typeInto(host.querySelector(".v3fs-rvw-bq textarea") as HTMLTextAreaElement, "Partner tiers are missing.");
    expect(send().disabled).toBe(false);
    act(() => { approve.click(); });
    expect(send().disabled).toBe(false);
  });

  it("the answer rides the QUARANTINE path, carrying the verdict word the inbox stores", async () => {
    await mountLink(servedRoundPack());
    const [approve] = [...host.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    act(() => { approve.click(); });
    typeInto(host.querySelector(".v3fs-rvw-bq textarea") as HTMLTextAreaElement, "Exactly how we quote.");
    await act(async () => { (host.querySelector(".v3fs-rvw-send") as HTMLButtonElement).click(); });
    expect(sent()).toHaveLength(1);
    expect(sent()[0].verdict).toBe("accepted");
    expect(String(sent()[0].answers)).toContain("I approve this design");
    expect(String(sent()[0].answers)).toContain("Exactly how we quote.");
    // it does not close the durable link — a later round re-asks on the same token
    expect(sent()[0].final).toBeUndefined();
    expect(text()).toContain("Thank you");
  });

  it("a change request sends the word the round maps to `changes`", async () => {
    await mountLink(servedRoundPack());
    const [, changes] = [...host.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    act(() => { changes.click(); });
    typeInto(host.querySelector(".v3fs-rvw-bq textarea") as HTMLTextAreaElement, "Partner tiers are missing.");
    await act(async () => { (host.querySelector(".v3fs-rvw-send") as HTMLButtonElement).click(); });
    expect(sent()[0].verdict).toBe("rework");
  });

  it("no control on the page is nameless or glyph-named", async () => {
    await mountLink(servedRoundPack());
    const bad = interactiveElements(host)
      .map((el) => ({ el, name: accessibleName(el) }))
      .filter((x) => isWordless(x.name));
    expect(bad.map((x) => x.el.className)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The INGEST — the round hears the answer only through the operator
 * ------------------------------------------------------------------ */

describe("ingest wires a quarantined response to the round, in that order", () => {
  /** The one thing the shell composes: round FIRST, ingest on the result. */
  const ingestLikeTheShell = (program: ProgramSummary, itemId: string, reversed = false): ProgramSummary => {
    if (reversed) {
      const ingested = ingestPortalResponse(program, itemId, "op");
      const after = apply(program, ingested);
      return apply(after, recordInboxResponseOnRound(after, itemId, "op"));
    }
    const onRound = recordInboxResponseOnRound(program, itemId, "op");
    const next = apply(program, onRound);
    return apply(next, ingestPortalResponse(next, itemId, "op") ?? onRound);
  };

  /** A round with Priya linked and her portal reply quarantined in the inbox. */
  const withReply = (): ProgramSummary => {
    let p = seed();
    p = apply(p, openDesignRound(p, { roster: ROSTER }, "op"));
    const round = currentDesignRound(p)!;
    p = apply(p, mintReviewPack(p, designRoundReviewInput(p, round.id, "Priya Nair")!, "op"));
    p = apply(p, attachDesignRoundLinks(p, round.id, "op"));
    const inner = (p.rawData as { data: Record<string, unknown> }).data;
    return apply(p, { data: { ...inner, flowPortalInbox: [{
      id: "pi-round", kind: "interview", stakeholder: "Priya Nair", role: `review:${DESIGN_ROUND_REVIEW_KIND}`,
      receivedAt: AT, verdict: "accepted", text: "I approve this design as the one we build on.",
    }] } });
  };

  it("the stakeholder's own approval reaches the round, self-attested, and the item is consumed", () => {
    const after = ingestLikeTheShell(withReply(), "pi-round");
    const priya = designRoundRollup(after).people.find((p) => p.name === "Priya Nair")!;
    expect(priya.state).toBe("accepted");
    expect(priya.attestation).toBe("self");
    expect(listPortalInbox(after).some((i) => i.id === "pi-round")).toBe(false);
  });

  /**
   * HOW THE WORDS WERE PRODUCED SURVIVES THE HOP.
   *
   * `recordInboxResponseOnRound` used to forward only `text`, so a dictated answer
   * arrived at the round indistinguishable from a typed one. The portal worked
   * around it by appending "— Dictated by X, not typed." INSIDE the answer, which
   * put a remark about the stakeholder's dictation into the stakeholder's own
   * words. `capture` is a field on DesignRoundResponse now, and this is the hop
   * that has to carry it.
   */
  const withReply2 = (capture?: string): ProgramSummary => {
    const p = withReply();
    const inner = (p.rawData as { data: Record<string, unknown> }).data;
    const inbox = (inner.flowPortalInbox as Array<Record<string, unknown>>)
      .map((i) => (capture === undefined ? i : { ...i, capture }));
    return apply(p, { data: { ...inner, flowPortalInbox: inbox } });
  };
  const priyaAfter = (capture?: string) =>
    designRoundRollup(ingestLikeTheShell(withReply2(capture), "pi-round"))
      .people.find((x) => x.name === "Priya Nair")!;

  it("REGRESSION: a dictated answer reaches the round marked as dictated", () => {
    expect(priyaAfter("dictated").capture).toBe("dictated");
    expect(priyaAfter("mixed").capture).toBe("mixed");
    expect(priyaAfter("typed").capture).toBe("typed");
    // and the words themselves stay the stakeholder's, unadorned
    expect(priyaAfter("dictated").text).toBe("I approve this design as the one we build on.");
  });

  it("an item with NO capture stays absent — never defaulted to \"typed\"", () => {
    // Rows written before the field existed, and clients that do not send one, must
    // not be recorded as having claimed authorship they never claimed.
    expect(priyaAfter(undefined).capture).toBeUndefined();
    // and the answer still lands — the field is additive, not a gate
    expect(priyaAfter(undefined).state).toBe("accepted");
  });

  it("a word outside the vocabulary is DROPPED, not stored", () => {
    // The edge whitelists this key, but the model validates rather than trusting a
    // cast: an older or hostile client cannot invent a mode.
    expect(priyaAfter("handwritten").capture).toBeUndefined();
    expect(priyaAfter("").capture).toBeUndefined();
  });

  it("the ATTRIBUTION validates on its own, not only on the way through record()", () => {
    // Asserted at this level deliberately. Through the ingest path the value passes
    // recordDesignRoundVerdict, which validates again — so removing the guard HERE
    // changed nothing any end-to-end case could see, and a test written only at the
    // far end would have passed over a guard that had stopped working.
    // `inboxItemRoundAttribution` is exported and returns `capture` to whoever asks,
    // so it has to be honest by itself.
    expect(inboxItemRoundAttribution(withReply2("dictated"), "pi-round")?.capture).toBe("dictated");
    expect(inboxItemRoundAttribution(withReply2("handwritten"), "pi-round")?.capture).toBeUndefined();
    expect(inboxItemRoundAttribution(withReply2(undefined), "pi-round")?.capture).toBeUndefined();
  });

  it("REVERSED, the verdict is lost — which is why the order is not a preference", () => {
    const after = ingestLikeTheShell(withReply(), "pi-round", true);
    const priya = designRoundRollup(after).people.find((p) => p.name === "Priya Nair")!;
    expect(priya.state).toBe("asked");
    expect(priya.attestation).toBeUndefined();
  });

  it("SOURCE: the shell records the round BEFORE the ingest, in one mutation", () => {
    const shell = src("AppShellV3.tsx");
    const round = shell.indexOf("recordInboxResponseOnRound(program, itemId, actor)");
    const ingest = shell.indexOf("ingestPortalResponse(next, itemId, actor)");
    expect(round, "the shell no longer records the round on ingest").toBeGreaterThan(-1);
    expect(ingest, "the ingest no longer runs on the round's result").toBeGreaterThan(-1);
    expect(round).toBeLessThan(ingest);
  });

  it("an ordinary interview reply writes nothing to the round — the LINK is the attribution", () => {
    // Nobody may be recorded as having answered a round they were never asked on.
    let p = seed();
    p = apply(p, openDesignRound(p, { roster: ROSTER }, "op"));
    const inner = (p.rawData as { data: Record<string, unknown> }).data;
    p = apply(p, { data: { ...inner, flowPortalInbox: [{
      id: "pi-plain", kind: "interview", stakeholder: "Marcus Bell", role: "Field Sales Director",
      receivedAt: AT, text: "we reconcile the pipeline weekly",
    }] } });
    expect(recordInboxResponseOnRound(p, "pi-plain", "op")).toBeNull();
  });
});
