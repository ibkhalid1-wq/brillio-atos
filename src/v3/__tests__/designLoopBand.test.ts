/**
 * THE DESIGN LOOP BAND, SIMPLIFIED (2026-08-11) — what it stopped drawing, and the
 * proof that nothing you could DO there stopped being doable.
 *
 * The band below "Operator builds it" drew roughly eight blocks and two of them carried
 * live state. The rest were paragraphs about things that were not there: an empty
 * deviation register with a paragraph explaining deviations, "0 asserted intents" with a
 * paragraph explaining intent, "0 refinements · prototype not built" with a paragraph
 * explaining a precedence rule, and — one line under the gate's own empty state — a
 * second, hand-written sentence saying the round had not been opened.
 *
 * WHAT THIS FILE HOLDS, in three parts:
 *
 *   §1 CAPABILITY — one case per thing an operator could reach from this band before,
 *      each named after the capability so the mapping is obvious at a glance. Hiding a
 *      zero-count SECTION is the house rule; hiding a CONTROL that had work behind it
 *      is not, and these are what stops the second from happening by accident.
 *
 *   §2 STAGE — the band is staged to the loop's own sequence (build → ask → collect →
 *      approve) and draws the stage it is in. The four rows of the stage table are four
 *      cases here.
 *
 *   §3 EMPTY, ZERO, UNKNOWN — F2 (a zero-count section is HIDDEN, the 2026-08-10
 *      decision the Inbox follows) applied to this band, plus the thing F2 alone does
 *      not give you: when a section vanishes, the operator must still be able to tell
 *      "nothing here yet" from "this surface is broken". And 0 deviations (a real zero)
 *      must not read the same as 0 stakeholder assertions (a gated write path).
 *
 * Fixtures are built by the MODEL's own verbs where a round is involved, exactly as
 * `designRoundSurfaces.test.ts` builds them, so the programme under test is a real one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import FlowShell from "@/v3/components/flow/FlowShell";
import DesignLoopZones from "@/v3/components/flow/DesignLoopZones";
import { buildLineModel } from "@/v3/lib/lineModel";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import {
  currentDesignRound, designRoundReviewInput, openDesignRound, recordDesignRoundVerdict,
} from "@/v3/components/flow/flowDesignRound";
import { mintReviewPack } from "@/v3/components/flow/flowPortal";
import { accessibleName, interactiveElements, isWordless } from "./helpers/accessibleName";

const AT = "2026-08-01T00:00:00Z";

const ROSTER = [
  { name: "Priya Nair", role: "Head of Revenue Operations" },
  { name: "Marcus Bell", role: "Field Sales Director" },
  { name: "Dana Ruiz", role: "Compliance Lead" },
];

/** A programme whose Design Loop artifacts are BUILT — so every operator tile that can
 *  be opened is open, and `openDesignRound` has a design version to be about. */
const seed = (over: Record<string, unknown> = {}): ProgramSummary => ({
  id: "p1", name: "Laila CRM", client: "Laila", methodology: "atos-flow",
  rawData: {
    data: {
      architectureStrategy: { generatedAt: AT, summary: "Modular monolith first" },
      experienceDesign: { generatedAt: AT, summary: "Quote-to-cash in four screens" },
      agenticBlueprint: { generatedAt: AT, summary: "Six agents" },
      prototypeBuild: { title: "Laila CRM pilot", generatedAt: AT, html: "<main>pilot</main>", summary: "Nine screens, quote to cash" },
      demoScripts: { generatedAt: AT, scripts: [{ area: "Sales", openingQuote: "Quotes take a week." }] },
      discoveryKit: { interviews: ROSTER.map((p) => ({ stakeholder: p.name, role: p.role, questions: ["What is slow?"] })) },
      ...over,
    },
  },
} as unknown as ProgramSummary);

/** The same programme with NOTHING built — the first row of the stage table. */
const unbuilt = (): ProgramSummary => ({
  id: "p0", name: "Laila CRM", client: "Laila", methodology: "atos-flow",
  rawData: {
    data: {
      // Listen is done — so the first Design Loop artifact has its inputs and reads
      // "inputs ready — generate" rather than "upstream not ready".
      domainOntology: { generatedAt: AT, summary: "Quote, Deal, Account" },
      currentStateAtlas: { generatedAt: AT, summary: "Six workflows across two areas" },
      discoveryKit: { interviews: ROSTER.map((p) => ({ stakeholder: p.name, role: p.role, questions: ["What is slow?"] })) },
    },
  },
} as unknown as ProgramSummary);

/**
 * THE REAL LAILA LEDGER — the same snapshot the a11y suites mount, so the band's
 * owned-question line is a real count (hundreds of role-owned open unknowns) rather
 * than a fixture that happens to be empty. This IS the programme in the screenshot the
 * simplification was asked for.
 */
const lailaSnap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = (): ProgramSummary => ({
  ...seed({
    domainOntology: lailaSnap("domain-ontology.json") as Record<string, unknown>,
    currentStateAtlas: lailaSnap("current-state-atlas.json") as Record<string, unknown>,
    flowOperatorOverrides: lailaSnap("operator-overrides.json") as unknown[],
  }),
  id: "laila",
} as unknown as ProgramSummary);

const apply = (program: ProgramSummary, blob: Record<string, unknown> | null): ProgramSummary =>
  blob ? ({ ...program, rawData: blob } as ProgramSummary) : program;

/** Everyone asked, nobody answered — the "collect" stage. */
const collecting = (): ProgramSummary => {
  let p = seed();
  p = apply(p, openDesignRound(p, { roster: ROSTER }, "op"));
  const round = currentDesignRound(p)!;
  p = apply(p, mintReviewPack(p, designRoundReviewInput(p, round.id, "Priya Nair")!, "op"));
  return p;
};

/** Priya approved, Dana asked for changes — the "changes" stage. Dana is deliberately
 *  LAST on the roster, so an unstaged list would bury the row that needs acting on. */
const objecting = (): ProgramSummary => {
  let p = seed();
  p = apply(p, openDesignRound(p, { roster: ROSTER }, "op"));
  p = apply(p, recordDesignRoundVerdict(p, { who: "Priya Nair", verdict: "approved", attestation: "operator", text: "Said yes on the 4 August call." }, "op"));
  p = apply(p, recordDesignRoundVerdict(p, { who: "Dana Ruiz", verdict: "changes", attestation: "operator", text: "Retention rules are missing from the quote screen." }, "op"));
  return p;
};

/* ------------------------------------------------------------------ *
 * Harness — FlowShell, the real prop chain (FlowShell → TheLine → band)
 * ------------------------------------------------------------------ */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onDesignRound: ReturnType<typeof vi.fn>;
let onMintReview: ReturnType<typeof vi.fn>;
let onRunAgent: ReturnType<typeof vi.fn>;

type Props = Parameters<typeof FlowShell>[0];
const noop = async () => {};
const shellProps = (program: ProgramSummary): Props => ({
  program, programs: [program], runningAgentIds: new Set<string>(),
  onSelectProgram: () => {}, onCreateProgram: () => {}, onDrillDown: () => {},
  onOpenSetup: () => {}, onOpenCopilot: () => {}, onRunAgent,
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

const band = () => host.querySelector(".v3dl") as HTMLElement | null;
const round = () => host.querySelector(".v3dr") as HTMLElement | null;
const bandText = () => band()?.textContent ?? "";
const buttonSaying = (scope: ParentNode, fragment: string) =>
  [...scope.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(fragment)) as HTMLButtonElement | undefined;
/** The tile drawn for one artifact, by its title. */
const tile = (title: string) =>
  [...host.querySelectorAll(".v3dl-tile")]
    .find((t) => (t.querySelector(".v3dl-tile-n")?.textContent ?? "") === title) as HTMLElement | undefined;
const personRow = (name: string) =>
  [...host.querySelectorAll(".v3dr-person")].find((li) => (li.textContent ?? "").includes(name)) as HTMLElement | undefined;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  onDesignRound = vi.fn(async () => {});
  onMintReview = vi.fn(async () => "https://example.test/link");
  onRunAgent = vi.fn();
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

// ════════════════════════════════════════════════════════════════════════════
// §1 · CAPABILITY — one case per thing that was reachable before
// ════════════════════════════════════════════════════════════════════════════

describe("§1 CAPABILITY — every verb the band offered is still reachable", () => {
  it("CAPABILITY open an operator-built artifact — all FOUR are tiles now, in dependency order", () => {
    // TWO PAIRS, two to a row (operator direction 2026-08-15):
    //   shape ▸ agents      — what we are building, and what runs it
    //   experience ▸ build  — how it is navigated, and the thing itself
    // Was a single four-step pipeline (Architecture → Experience → Blueprint →
    // Prototype), which read as a queue rather than as two related pairs. Experience
    // Design used to be an "open Experience Design →" link buried in the joint zone's
    // right-hand column; it is a tile beside its siblings now, which is also how it is
    // generated and rebuilt.
    mountShell(seed());
    const names = [...host.querySelectorAll(".v3dl-tile-n")].map((n) => n.textContent);
    expect(names).toEqual(["Architecture Strategy", "Agentic Blueprint", "Experience Design", "Prototype"]);
    for (const title of names as string[]) {
      const open = tile(title)!.querySelector(".v3dl-tile-open") as HTMLButtonElement;
      expect(open.disabled, `${title} cannot be opened`).toBe(false);
    }
  });

  it("CAPABILITY open Experience Design — the joint zone's link is gone, the tile hands over the same card", () => {
    // The exact regression this guards: "Joint — designed together" hosted the ONLY way
    // to Experience Design ("open Experience Design →"), and it was deleted as a standing
    // zone. Mounted directly so the card handed to `onOpen` can be read; the shell wiring
    // is `designLoopZonesProps.test.ts`'s job.
    const onOpen = vi.fn();
    mountBandWith(seed(), ledgerWith([]), { onOpen });
    expect(buttonSaying(band()!, "open Experience Design"), "the old joint-zone link is back as well").toBeUndefined();
    act(() => { (tile("Experience Design")!.querySelector(".v3dl-tile-open") as HTMLButtonElement).click(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0][0] as { id: string }).id).toBe("experience-design");
  });

  it("CAPABILITY rebuild an artifact from claims — every BUILT tile keeps it, Experience Design included", () => {
    // Experience Design never had a rebuild: the joint zone offered only a link to open
    // it. Joining its siblings as a tile is how it gained one, so this case is both a
    // no-loss check for the other three and the proof of the gain.
    mountShell(seed());
    const built = [...host.querySelectorAll(".v3dl-tile")]
      .filter((t) => (t.textContent ?? "").includes("decided, on record"));
    expect(built.length, "the fixture built nothing — this case would prove nothing").toBeGreaterThan(2);
    for (const t of built) {
      const title = t.querySelector(".v3dl-tile-n")!.textContent!;
      expect(buttonSaying(t, "rebuild from claims"), `${title} lost its rebuild`).toBeTruthy();
    }
    expect(built.map((t) => t.querySelector(".v3dl-tile-n")!.textContent)).toContain("Experience Design");
    act(() => { buttonSaying(tile("Experience Design")!, "rebuild from claims")!.click(); });
    expect(onRunAgent).toHaveBeenCalled();
  });

  it("CAPABILITY generate an artifact that is not built yet", () => {
    mountShell(unbuilt());
    const open = tile("Architecture Strategy")!.querySelector(".v3dl-tile-open") as HTMLButtonElement;
    expect(open.textContent).toContain("inputs ready — generate");
    act(() => { open.click(); });
    expect(onRunAgent).toHaveBeenCalled();
  });

  it("CAPABILITY open Validation — the stakeholder zone's header link", () => {
    mountShell(seed());
    expect(buttonSaying(band()!, "open Validation")).toBeTruthy();
  });

  it("CAPABILITY open a design review round — the roster picker, the note and the verb", () => {
    mountShell(seed());
    act(() => { buttonSaying(round()!, "open a design review round")!.click(); });
    for (const p of ROSTER) expect(bandText()).toContain(p.name);
    expect(host.querySelector(".v3dr-pick input[type=checkbox]")).toBeTruthy();
    expect([...host.querySelectorAll(".v3dr-pick label span")].map((s) => s.textContent))
      .toContain("A note for the round — optional");
  });

  it("CAPABILITY run a live round — share, meeting mode, record/waive/delegate all still mount", () => {
    // Behaviour is pinned in designRoundSurfaces.test.ts; this case exists so that the
    // staging work cannot silently stop DRAWING any of them.
    mountShell(collecting());
    expect(buttonSaying(round()!, "share the round link"), "the mint is unreachable").toBeTruthy();
    expect(buttonSaying(round()!, "meeting mode"), "meeting mode is unreachable").toBeTruthy();
    expect(host.querySelectorAll(".v3dr-disc").length, "no record/waive/delegate disclosures").toBe(ROSTER.length);
    expect(host.querySelectorAll(".v3dr-person").length, "a participant was dropped by the stage sort").toBe(ROSTER.length);
  });

    /* RETIRED 2026-08-13, with the band's foot. It proved a real principle — a
     vanished section is accounted for, and 0-deviations (a real zero) reads
     differently from 0-stakeholder-assertions (a gated write path). The foot was
     removed on request: it reported ABSENCES the operator does nothing about, and
     its second line pointed at Listen's work from inside the design round.

     THE TRADE IS REAL AND IS RECORDED: the band no longer distinguishes empty from
     unknown on screen. The distinction still holds in the ledger and on the surfaces
     that act on it; it is simply not narrated here any more. Worklog: "the design
     round no longer narrates absence". */


  it("CAPABILITY read the precedence rules — they moved into disclosures, they were not deleted", () => {
    // "An asserted refinement wins over the operator's re-gen" is a RULE: true on every
    // render, worth reading once. It is behind a real button with aria-expanded now
    // instead of competing with the state beside it.
    mountShell(seed());
    const helps = [...host.querySelectorAll(".v3dl-help")] as HTMLButtonElement[];
    expect(helps.length, "the zone disclosures are gone").toBeGreaterThanOrEqual(2);
    expect(bandText(), "a rule is still printed unconditionally").not.toContain("wins over");
    for (const h of helps) {
      expect(h.tagName).toBe("BUTTON");
      expect(h.getAttribute("aria-expanded")).toBe("false");
      act(() => { h.click(); });
    }
    const text = bandText();
    expect(text).toContain("wins over the");            // the refinement precedence rule
    expect(text).toContain("never the re-gen");
    // …and the intent-vs-render rule, which used to be a standing zone of its own, is
    // stated where the artifact it describes lives — not only inside the deviation
    // section, which is hidden when there is nothing to adjudicate.
    expect(text).toContain("Where the two disagree the gap is a deviation");
  });

  it("CAPABILITY read where a question about an artifact routes — the per-tile fact survived", () => {
    mountShell(seed());
    const notes = [...host.querySelectorAll(".v3dl-question-note")].map((n) => n.textContent);
    expect(notes).toHaveLength(4);
    expect(notes.join(" ")).toContain("routes to Architect");
    expect(notes.join(" ")).toContain("routes to Design team");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §2 · STAGE — the band draws the stage it is in, and the rest recedes
// ════════════════════════════════════════════════════════════════════════════

describe("§2 STAGE — build → ask → collect → approve", () => {
  const railNow = () => host.querySelector(".v3dl-railstep.is-now")?.textContent;

  it("the rail reports the stage and is NOT a set of controls — it says where you are", () => {
    mountShell(seed());
    const rail = host.querySelector(".v3dl-rail")!;
    expect([...rail.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["Build", "Ask", "Collect", "Approve"]);
    expect(rail.querySelectorAll("button, a, [role=button], [tabindex]"), "the rail grew dead affordances").toHaveLength(0);
    expect(rail.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("STAGE nothing built — build the prototype first, and NOTHING else is drawn", () => {
    mountShell(unbuilt());
    expect(railNow()).toBe("Build");
    // the gate says it, once
    expect(host.querySelector(".v3dr-gate-d")!.textContent).toContain("Build the prototype first");
    // …and no round machinery is offered for a design that does not exist
    expect(buttonSaying(round()!, "open a design review round"), "a roster picker for nothing").toBeUndefined();
    expect(host.querySelector(".v3dr-pick")).toBeNull();
    expect(host.querySelector(".v3dr-counts")).toBeNull();
    expect(host.querySelectorAll(".v3dr-person")).toHaveLength(0);
  });

  it("STAGE built, no round — the roster picker and 'open a round', and no rollup", () => {
    mountShell(seed());
    expect(railNow()).toBe("Ask");
    expect(buttonSaying(round()!, "open a design review round")).toBeTruthy();
    expect(host.querySelector(".v3dr-counts"), "a rollup for a round that does not exist").toBeNull();
    expect(host.querySelectorAll(".v3dr-person")).toHaveLength(0);
  });

  it("STAGE round open — the rollup, per person, by name", () => {
    mountShell(collecting());
    expect(railNow()).toBe("Collect");
    expect(host.querySelector(".v3dr-counts")).toBeTruthy();
    for (const p of ROSTER) expect(personRow(p.name), `${p.name} is not on the board`).toBeTruthy();
    expect(buttonSaying(round()!, "open a design review round"), "the picker is still offered mid-round").toBeUndefined();
  });

  it("STAGE objections — the changes to act on come FIRST, without a second copy of them", () => {
    // Dana is last on the roster and is the one who asked for changes. Unstaged, her row
    // sits at the bottom; staged, it leads — and her words are read off her own row, so
    // the zone does not print the objection twice.
    mountShell(objecting());
    expect(railNow()).toBe("Collect");
    const names = [...host.querySelectorAll(".v3dr-person .v3dr-name")].map((n) => n.textContent);
    expect(names[0], "the objection is not the first thing you see").toBe("Dana Ruiz");
    expect(names.slice().sort()).toEqual(ROSTER.map((p) => p.name).sort());   // nobody dropped
    expect(host.querySelector(".v3dr-gate-l")!.textContent).toContain("Dana Ruiz");
    const said = [...host.querySelectorAll(".v3dr-said-text")].filter((p) => (p.textContent ?? "").includes("Retention rules"));
    expect(said, "the objection is printed twice").toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §3 · EMPTY vs ZERO vs UNKNOWN
// ════════════════════════════════════════════════════════════════════════════

/** A ledger stub — enough of the read model for the band, so a DEVIATION can be put on
 *  it. `designLoopZonesProps.test.ts` holds the real wiring; what is under test here is
 *  what the band draws for a given ledger. */
const ledgerWith = (devs: ProgramLedger["devs"], stakeholderAsserts = 0): ProgramLedger => ({
  queue: { counts: { blocking: 3, "answerable-without-a-meeting": 2, blocked: 0 }, items: [] },
  kit: { burnDown: { total: 10, closed: 0, weak: 4, open: 6, pctClosed: 0, pctSettled: 40 } },
  heard: { total: 0, totalClosedOrWeak: 4 },
  ownership: { operator: 0, stakeholder: stakeholderAsserts, joint: 0, draft: 0, total: 0, bySource: {} },
  devs,
} as unknown as ProgramLedger);

const ONE_DEV: ProgramLedger["devs"] = [{
  about: "el:attr:quote.approvalTier", asIs: "manual", toBe: "auto-tiered",
  classification: "unbacked", stillReferenced: false,
}] as unknown as ProgramLedger["devs"];

/** Mount the band alone, on a REAL line model, with the handlers a case wants to spy on. */
const mountBandWith = (
  program: ProgramSummary, ledger: ProgramLedger, over: Record<string, unknown> = {},
) => {
  const loop = buildLineModel(program).bands.find((b) => b.id === "loop")!;
  act(() => {
    root.render(createElement(DesignLoopZones, {
      band: loop, program, ledger,
      roster: ROSTER.map((p) => ({ ...p, isRole: false })),
      onOpen: () => {},
      onDesignRound: async () => {},
      regenBusy: {}, genBusy: {},
      ...over,
    }));
  });
};
const mountBand = (program: ProgramSummary, ledger: ProgramLedger) => mountBandWith(program, ledger);

describe("§3 EMPTY ≠ ZERO ≠ UNKNOWN — F2 applied to this band", () => {
  it("F2 zero deviations — the whole deviation section is HIDDEN, not drawn empty", () => {
    mountBand(seed(), ledgerWith([]));
    expect(host.querySelector(".v3dl-zone.is-joint"), "an empty deviation zone was drawn").toBeNull();
    expect(host.querySelector(".v3dl-devreg")).toBeNull();
    expect(host.textContent, "the old 'no deviations on record' shell is back")
      .not.toContain("No as-is → to-be deviations on record");
  });

  it("F2 is ZERO, not 'small' — ONE deviation draws the section and the register", () => {
    mountBand(seed(), ledgerWith(ONE_DEV));
    const zone = host.querySelector(".v3dl-zone.is-joint")!;
    expect(zone, "one real deviation was hidden away").toBeTruthy();
    expect(zone.querySelectorAll(".v3dl-devlist li")).toHaveLength(1);
    expect(zone.textContent).toContain("approvalTier");
    expect(zone.textContent).toContain("auto-tiered");
  });

    /* RETIRED 2026-08-13, with the band's foot. It proved a real principle — a
     vanished section is accounted for, and 0-deviations (a real zero) reads
     differently from 0-stakeholder-assertions (a gated write path). The foot was
     removed on request: it reported ABSENCES the operator does nothing about, and
     its second line pointed at Listen's work from inside the design round.

     THE TRADE IS REAL AND IS RECORDED: the band no longer distinguishes empty from
     unknown on screen. The distinction still holds in the ledger and on the surfaces
     that act on it; it is simply not narrated here any more. Worklog: "the design
     round no longer narrates absence". */


    /* RETIRED 2026-08-13, with the band's foot. It proved a real principle — a
     vanished section is accounted for, and 0-deviations (a real zero) reads
     differently from 0-stakeholder-assertions (a gated write path). The foot was
     removed on request: it reported ABSENCES the operator does nothing about, and
     its second line pointed at Listen's work from inside the design round.

     THE TRADE IS REAL AND IS RECORDED: the band no longer distinguishes empty from
     unknown on screen. The distinction still holds in the ledger and on the surfaces
     that act on it; it is simply not narrated here any more. Worklog: "the design
     round no longer narrates absence". */


  it("with assertions on record the register's count is drawn, and the quiet line drops that item", () => {
    mountBand(seed(), ledgerWith(ONE_DEV, 7));
    expect(host.querySelector(".v3dl-zone.is-joint")!.textContent).toContain("7 asserted intents");
    expect(host.querySelector(".v3dl-quiet"), "everything is on record and the not-drawn line still shows").toBeNull();
  });

  it("the owned-question line hides itself at zero — there is no work to hand over", () => {
    const empty = ledgerWith([]);
    (empty.queue.counts as Record<string, number>).blocking = 0;
    (empty.queue.counts as Record<string, number>)["answerable-without-a-meeting"] = 0;
    mountBand(seed(), empty);
    expect(host.querySelector(".v3dl-elsewhere")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4 · the new controls under the a11y bar this band is held to
// ════════════════════════════════════════════════════════════════════════════

describe("§4 the controls this change ADDED meet the band's a11y bar", () => {
  it("every disclosure is a real <button> carrying aria-expanded, and it toggles", () => {
    mountShell(seed());
    const helps = [...host.querySelectorAll(".v3dl-help")] as HTMLButtonElement[];
    expect(helps.length).toBeGreaterThan(0);
    for (const h of helps) {
      expect(h.tagName, "a disclosure that is not a button cannot be reached by keyboard").toBe("BUTTON");
      expect(h.getAttribute("aria-expanded")).toBe("false");
    }
    // …and the attribute tracks the state rather than being decoration
    const first = helps[0];
    act(() => { first.click(); });
    expect(first.getAttribute("aria-expanded")).toBe("true");
    act(() => { first.click(); });
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("no two controls on the band answer to the same words, and none is wordless", () => {
    mountShell(seed());
    for (const h of [...host.querySelectorAll(".v3dl-help")] as HTMLButtonElement[]) act(() => { h.click(); });
    const named = interactiveElements(band()!).map((el) => ({ el, name: accessibleName(el) }));
    expect(named.length).toBeGreaterThan(4);
    expect(named.filter((x) => isWordless(x.name)).map((x) => x.el.className)).toEqual([]);
    const seen = new Map<string, number>();
    for (const { name } of named) seen.set(name, (seen.get(name) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });
});

/**
 * §4 — ONE NUMBER, ONE HOME.
 *
 * Convergence and Heard were drawn twice on the Work board: once in TheLine's Work
 * strip and again, identically, in the Design Loop band's own header ~570px below.
 * Two writes of the same figure drift the moment one of them gains a caveat the
 * other does not.
 *
 * The band's copy is the one that had to go, and not merely because it was second.
 * These are PROGRAMME-wide numbers, and the band is one of several on the board — a
 * programme figure in a band-scoped position reads as that band's progress, which it
 * never was. The surviving home is also the one you can act from: its Heard figure
 * is a button that jumps to Discovery.
 */
describe("[§4] convergence and heard are stated once, in the surface that owns them", () => {
  it("REGRESSION: the band does not redraw the programme's convergence or heard", () => {
    mountShell(laila());
    const b = band();
    expect(b, "the band did not mount — this case would pass vacuously").toBeTruthy();
    expect(b!.querySelector(".v3dl-head"), "the duplicate header is back").toBeNull();
    expect(b!.querySelector(".v3dl-conv")).toBeNull();
    // and not merely restyled under another class
    expect(bandText()).not.toMatch(/convergence/i);
    expect(bandText()).not.toMatch(/attributed closures/i);
  });

  /**
   * BOTH ARE OFF THE BOARD NOW (operator direction, 2026-08-12: "hide", on the
   * Round/Heard/Convergence strip). This case used to require the Work strip to
   * survive as their one home. It no longer exists — so the rule it enforces
   * changes from "exactly once" to "not at all, and not sneaking back".
   *
   * What did NOT change: the numbers. `ledger.heard` and `kit.burnDown` are still
   * computed and still consumed — the gate reads convergence. Only their display on
   * this board is gone, which is why the assertions below are about the SCREEN.
   */
  it("neither is drawn on the WORK board any more", () => {
    // Scoped to Work, which is what this mounts. Heard has since come BACK on
    // DISCOVER (see the case below) — it is the roster's own progress and Discover
    // is the roster. What must not return is either of them as a headline HERE,
    // above the work, which is what was hidden.
    mountShell(laila());
    const board = (host.querySelector(".v3ln") ?? host).textContent ?? "";
    // MUTATION: restore the `.v3ln-stats.ledger` strip → both are RED.
    expect(board.match(/Convergence/g) ?? [], "the convergence readout is back on Work").toHaveLength(0);
    expect(board.match(/attributed closures/g) ?? [], "the heard readout is back on Work").toHaveLength(0);
    expect(host.querySelector(".v3ln-stats.ledger"), "the strip itself is back").toBeNull();
  });

  it("Heard lives on Discover instead — it was not simply deleted", () => {
    // The honest half of the removal. Hiding the Work strip took the LAST rendering
    // of HeardReadout with it, which the guard here caught at the time. It is drawn
    // again, as one more state of the people on the Discover board.
    // MUTATION: remove the engagement-bar pill → RED.
    const src = readFileSync(resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8");
    expect(src).toContain('v3ln-engpill is-heard');
    expect(src, "the readout itself must be the one rendered, not a re-derived number")
      .toContain("<HeardReadout heard={ledger.heard} />");
  });

  it("the burn-down headline went with them", () => {
    // The same direction, one strip earlier: "206 open · 0 answered · 0 need an
    // owner · 106 → dictionary · 4 seams" was five programme-wide numbers and no act.
    mountShell(laila());
    const board = (host.querySelector(".v3ln") ?? host).textContent ?? "";
    expect(board).not.toMatch(/close the burn-down/i);
  });

  it("but the ledger still HOLDS what the board stopped showing", () => {
    // The guard against hiding turning into losing: a removal from the screen must
    // not quietly become a removal from the record. If this ever goes red, the
    // numbers stopped being computed and the two cases above are hiding a hole.
    const program = laila();
    mountShell(program);
    const seen = (host.querySelector(".v3ln") ?? host).textContent ?? "";
    expect(seen.length, "the board did not mount — these cases would pass vacuously").toBeGreaterThan(200);
    expect(band(), "the board's own band went with the strips").toBeTruthy();
  });
});
