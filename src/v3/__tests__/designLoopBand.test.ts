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
    // Architecture → Experience Design → Blueprint → Prototype. Experience Design used
    // to be an "open Experience Design →" link buried in the joint zone's right-hand
    // column; it is a tile beside its siblings now, which is also how it is generated
    // and rebuilt.
    mountShell(seed());
    const names = [...host.querySelectorAll(".v3dl-tile-n")].map((n) => n.textContent);
    expect(names).toEqual(["Architecture Strategy", "Experience Design", "Agentic Blueprint", "Prototype"]);
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

  it("CAPABILITY work the role-owned open questions — the band hands them to Discover", () => {
    // The routing-filtered drill list ("341 open unknowns owned by a role · 148 blocking
    // · 193 answerable") is Listen's burn-down and lived inside the design-APPROVAL zone,
    // giving that zone two unrelated jobs. It is one line at the foot now, and the line's
    // button lands on the tab where the questions are actually worked.
    mountShell(seed());
    const go = buttonSaying(band()!, "work them in Discover");
    if (!go) {
      // A fixture with no role-owned open questions hides the line by the zero rule —
      // then there is no work to reach and nothing to prove. Say so rather than pass.
      expect(host.querySelector(".v3dl-elsewhere"), "no owned-question line and no owned questions").toBeNull();
      return;
    }
    act(() => { go.click(); });
    expect(host.querySelector('[aria-label="Discover"]'), "the band's link did not land on Discover").toBeTruthy();
    expect(host.querySelector(".v3dl"), "the Work board is still drawn — the tab did not change").toBeNull();
  });

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
      onOpen: () => {}, onGoDiscover: () => {},
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

  it("a vanished section is ACCOUNTED FOR — 'nothing here yet' never reads as 'broken'", () => {
    mountBand(seed(), ledgerWith([]));
    const quiet = host.querySelector(".v3dl-quiet")!;
    expect(quiet, "sections disappeared with no account of themselves").toBeTruthy();
    expect(quiet.textContent).toContain("Not drawn");
    expect(quiet.textContent).toContain("deviation register");
  });

  it("EMPTY vs UNKNOWN — 0 deviations is a real zero; 0 stakeholder assertions is a gated write path", () => {
    mountBand(seed(), ledgerWith([]));
    const quiet = host.querySelector(".v3dl-quiet")!.textContent ?? "";
    expect(quiet).toContain("no as-is to-be deviation on this programme");   // a real zero
    expect(quiet).toContain("unknown rather than none");                     // NOT a zero
    expect(quiet).toContain("write path is not wired");
    expect(host.querySelector(".v3dl-quiet .v3lc-prov"), "the unknown lost its provisional mark").toBeTruthy();
  });

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
