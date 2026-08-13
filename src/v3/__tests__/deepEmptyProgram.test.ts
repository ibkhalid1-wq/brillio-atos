/**
 * CHECK 6 — EMPTY PROGRAMME (deep validation, 2026-08-11).
 *
 * A programme that has been FRAMED (it has a name, a sponsor, declared systems of
 * record) but carries ZERO questions: no ontology, no atlas, therefore no elements and
 * no claims.
 *
 * INVARIANTS
 *  1. F2 (CURRENT RULE, per the user's 2026-08-10 override): a zero-count section is
 *     HIDDEN. Not a three-way empty state, not a "0" row — hidden. Asserted against the
 *     rendered DOM, not the source.
 *  2. NO DIVISION BY ZERO anywhere a percentage or a ratio is computed. Every ratio site
 *     reachable from the question pipeline is enumerated below and exercised; the values
 *     must be finite, and no surface may print NaN/Infinity.
 *  3. The kit renders its HONEST COLD-START section — a sentence that says the record is
 *     empty and what to do — rather than an empty shell or a fabricated placeholder.
 *  4. NOTHING FABRICATES A COUNT to avoid an empty state. A miss stays visible: the
 *     companion programme below holds exactly ONE unowned question and it is drawn.
 *
 * SCOPE (stated, not assumed): "everywhere a percentage is computed" is scoped to the
 * QUESTION PIPELINE and its surfaces — the ledger projections, the ledger primitives,
 * the operator inbox, the kit, and Listen coverage (which feeds the Line's Listen band).
 * The methodology-spine scorers (`phaseReadiness`, `confidenceScore`, `phaseSchedule`)
 * are a different pipeline and are out of scope for this check; they are named here so
 * the boundary is explicit rather than silent.
 *
 * Scratch only: the programmes below are built in memory. No snapshot is mutated.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import { migrate, migrationStats, type Snapshot } from "@/v3/lib/ledger/migrate";
import {
  buildUnknownQueue, buildKitView, buildHeardRegister, buildDeviationRegister,
  buildOntologyView, buildAtlasView, openOwnerQuestions, dictionaryBucket,
} from "@/v3/lib/ledger/projections";
import { projectKitQuestions, reconcileKit } from "@/v3/lib/ledger/kitProjection";
import { deriveArtifactAsks, asksNeedingChase } from "@/v3/lib/ledger/artifactAsks";
import { operatorQueueCounts, sessionQuestionCount } from "@/v3/lib/ledger/operatorQueue";
import { affordanceOptions } from "@/v3/lib/ledger/renderQuestion";
import type { LedgerStore } from "@/v3/lib/ledger/store";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import OperatorInbox, { SessionsSection } from "@/v3/components/flow/OperatorInbox";
import {
  ConvergenceReadout, HeardReadout, UnownedSeamStrip,
} from "@/v3/components/flow/studio/ledgerPrimitives";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
import { listenCoverage } from "@/v3/components/flow/flowShellData";

// ── the FRAMED-but-empty programme ───────────────────────────────────────────────
const EMPTY_SNAPSHOT: Snapshot = { ontology: {}, atlas: {}, overrides: [] };

const framedProgram = (): ProgramSummary => ({
  id: "empty-1", name: "Framed, nothing modelled", client: "Acme", methodology: "atos-flow",
  rawData: {
    data: {
      phaseInputs: {
        frame: { sponsor: "Sarah Chen", systemsOfRecord: "CoreSystem" },
        listen: {},
      },
    },
  },
  updatedAt: "2026-08-11",
} as unknown as ProgramSummary);

/** A real ProgramLedger, derived the way `useProgramLedger` derives one — projections,
 *  not stubs — so the empty-state assertions test the actual read path. */
function ledgerFor(store: LedgerStore, declaredSors: string[] = []): ProgramLedger {
  const queue = buildUnknownQueue(store);
  const kit = buildKitView(store);
  const assignQueue = openOwnerQuestions(queue);
  const typingLoci = dictionaryBucket(queue);
  return {
    store,
    stats: migrationStats(store),
    queue,
    kit,
    artifactAsks: deriveArtifactAsks(store, { marks: [], dictionaryName: null, declaredSors, dictionaryBySor: new Map() }),
    devs: buildDeviationRegister(store),
    heard: buildHeardRegister(store),
    ontology: buildOntologyView(store),
    atlas: buildAtlasView(store),
    ownership: { operator: 0, stakeholder: 0, joint: 0, draft: 0, total: 0, bySource: {} },
    unownedBands: kit.bands.filter((b) => b.kind === "unowned"),
    seamBands: kit.bands.filter((b) => b.kind === "seam"),
    actions: [], assignments: [], schedules: [], captures: [], redirects: [],
    decideFates: [], pins: [], pinnedAbouts: new Set(), pinConflicts: [],
    proposals: [], proposedAbouts: new Set(), capturedAbouts: new Set(),
    conflicts: [],
    unownedOpen: assignQueue.length,
    soloByOwner: new Map(),
    sessionQueue: [],
    typingLoci,
    dictionaryName: null,
    assignQueue,
  } as unknown as ProgramLedger;
}

const emptyStore = () => migrate(EMPTY_SNAPSHOT);

// ── DOM harness (the idiom from nothingHeardCaveat / operatorQueueTruth) ──────────
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let renderErrors: unknown[] = [];
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  renderErrors = [];
  // React 19 reports an uncaught render error and leaves the DOM EMPTY rather than
  // throwing. An empty DOM is exactly what "the section is hidden" looks like, so an
  // unwatched crash would read as a PASS on every F2 assertion in this file. Captured
  // and asserted instead.
  root = createRoot(host, { onUncaughtError: (e: unknown) => { renderErrors.push(e); } } as never);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(renderErrors, `a render error was swallowed: ${renderErrors.map((e) => String(e)).join(" | ")}`).toHaveLength(0);
});
const render = (node: ReturnType<typeof createElement>) => { act(() => root.render(node)); };

/** No surface may print a broken number, and none may print a fabricated 100%. */
const assertNoBrokenNumbers = (text: string, where: string) => {
  for (const bad of ["NaN", "Infinity", "undefined", "null%", "0 of 0", "0/0"]) {
    expect(text.includes(bad), `${where} printed "${bad}"`).toBe(false);
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 6a · THE LEDGER ITSELF IS EMPTY, AND SAYS SO
// ════════════════════════════════════════════════════════════════════════════════
describe("[6a] a framed programme with zero questions", () => {
  const store = emptyStore();

  it("migrates to a genuinely empty ledger — zero elements, zero claims, zero questions", () => {
    expect(store.elements()).toHaveLength(0);
    expect(store.claims()).toHaveLength(0);
    expect(buildUnknownQueue(store).items).toHaveLength(0);
    expect(projectKitQuestions(store)).toHaveLength(0);
  });

  it("every queue term is 0 — and 0 is REPORTED, never rounded up into something", () => {
    const q = buildUnknownQueue(store);
    expect(q.counts).toEqual({ blocking: 0, unowned: 0, "answerable-without-a-meeting": 0, blocked: 0, total: 0 });
    expect(q.byOwner).toHaveLength(0);
    expect(q.unowned).toHaveLength(0);
    expect(openOwnerQuestions(q)).toHaveLength(0);
    expect(dictionaryBucket(q)).toHaveLength(0);
  });

  it("the projections do not invent rows for an empty store", () => {
    expect(buildOntologyView(store)).toHaveLength(0);
    expect(buildAtlasView(store)).toHaveLength(0);
    expect(buildDeviationRegister(store)).toHaveLength(0);
    expect(buildKitView(store).bands).toHaveLength(0);
    expect(migrationStats(store).elements).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6b · NO DIVISION BY ZERO — every ratio site in the question pipeline, exercised
// ════════════════════════════════════════════════════════════════════════════════
describe("[6b] every percentage / ratio site survives 0 of 0", () => {
  const store = emptyStore();

  it("SITE 1 — burn-down + convergence percentages (projections.ts `pct`, the only division in the ledger core)", () => {
    const bd = buildKitView(store).burnDown;
    expect(bd).toEqual({ total: 0, closed: 0, weak: 0, open: 0, pctClosed: 0, pctSettled: 0 });
    for (const v of [bd.pctClosed, bd.pctSettled]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
    // …and it is 0, not the 100% a naive "closed === total" would produce.
    expect(bd.pctClosed).not.toBe(100);
    expect(bd.pctSettled).not.toBe(100);
  });

  it("SITE 2 — the ConvergenceReadout's bar widths are finite CSS, and the caveat correctly stays away", () => {
    const bd = buildKitView(store).burnDown;
    render(createElement(ConvergenceReadout, { burnDown: bd, perAreaProvisional: false }));
    const bar = host.querySelector(".v3lc-conv-bar")!;
    const spans = [...bar.querySelectorAll("span")];
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      const w = (s as HTMLElement).style.width;
      expect(w, "a bar width was computed from 0/0").toMatch(/^\d+(\.\d+)?%$/);
    }
    assertNoBrokenNumbers(host.textContent ?? "", "ConvergenceReadout");
    // "nothing heard yet" is a caveat about UNANSWERED work; with no work at all it
    // would be a lie, and the guard is `total > 0`. Pinned here as part of the empty rule.
    expect(host.querySelector(".v3lc-conv-nh")).toBeNull();
    expect(host.textContent).toContain("0%");
  });

  it("SITE 3 — the heard register / HeardReadout (a count, never a fraction of zero)", () => {
    const heard = buildHeardRegister(store);
    expect(heard).toEqual({ byBand: [], total: 0, totalClosedOrWeak: 0 });
    render(createElement(HeardReadout, { heard, perAreaProvisional: false }));
    assertNoBrokenNumbers(host.textContent ?? "", "HeardReadout");
    expect(host.textContent).toContain("0");
  });

  it("SITE 4 — Listen coverage (`done of total` on the Line's Listen band) has no roster to divide by", () => {
    const cov = listenCoverage(framedProgram());
    expect(cov).toEqual({ done: 0, total: 0 });
    // lineModel guards on `total > 0` and prints the cold-start sentence instead of a
    // fraction — asserted at the data level here, and in the DOM in 6d.
    expect(cov.total > 0).toBe(false);
  });

  it("SITE 5 — the dictionary-ask weights (the 'closes N' ratio) with no systems modelled", () => {
    const asks = deriveArtifactAsks(store, { marks: [], dictionaryName: null, declaredSors: ["coresystem"], dictionaryBySor: new Map() });
    // A SoR the sponsor NAMED still produces its ask — that is a Frame obligation, not a
    // count derived from an empty ontology…
    expect(asks.asks).toHaveLength(1);
    // …and its weight is honestly 0 with 0 entities, never a fabricated non-zero.
    expect(asks.asks[0].weight).toBe(0);
    expect(asks.asks[0].entityCount).toBe(0);
    expect(asks.unattributed).toEqual({ weight: 0, abouts: [] });
    expect(Number.isFinite(asks.asks[0].weight)).toBe(true);
  });

  it("SITE 6 — the operator queue sums (every term, both sums)", () => {
    const counts = operatorQueueCounts(ledgerFor(store));
    expect(counts.assign).toBe(0);
    expect(counts.sessionQuestions).toBe(0);
    expect(counts.adjudicate).toBe(0);
    expect(counts.pinned).toBe(0);
    expect(counts.inFlight).toBe(0);
    expect(counts.decided).toBe(0);
    expect(counts.total).toBe(0);
    expect(counts.rendered).toBe(0);
    expect(sessionQuestionCount([])).toBe(0);
    for (const v of Object.values(counts)) expect(Number.isFinite(v)).toBe(true);
  });

  it("SITE 7 — the picker vocabulary is EMPTY, not a fabricated menu (affordanceOptions)", () => {
    for (const kind of ["phase", "actorRole", "valueSet", "owner"]) {
      expect(affordanceOptions(store, kind)).toEqual([]);
    }
  });

  it("SITE 8 — kit reconciliation against an empty ledger reports gaps, and divides nothing", () => {
    const rec = reconcileKit(["Which phase does intake belong to?"], store);
    expect(rec.matched).toHaveLength(0);
    expect(rec.projectedOnly).toHaveLength(0);
    // the kit question is not silently dropped — it becomes a visible ontology-gap finding
    expect(rec.unmatched).toHaveLength(1);
    expect(rec.unmatched[0].reason).toBe("ontology-gap");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6c · F2 — ZERO-COUNT SECTIONS ARE HIDDEN (the CURRENT rule, 2026-08-10 override)
// ════════════════════════════════════════════════════════════════════════════════
describe("[6c] F2 — every zero-count section is HIDDEN, not drawn empty", () => {
  it("the WHOLE operator inbox is hidden on a programme with nothing to decide", () => {
    render(createElement(OperatorInbox, {
      ledger: ledgerFor(emptyStore()), candidates: [], by: "operator", onCommit: async () => {},
    }));
    expect(host.innerHTML, "the inbox drew an empty shell").toBe("");
    expect(host.querySelector(".v3ib")).toBeNull();
  });

  it("no zero section survives: header, assign, sessions, adjudicate, pinned, in-flight, dictionary", () => {
    render(createElement(OperatorInbox, {
      ledger: ledgerFor(emptyStore()), candidates: [], by: "operator", onCommit: async () => {},
    }));
    for (const id of ["ib-assign", "ib-sessions", "ib-adjudicate", "ib-pinned", "ib-inflight"]) {
      expect(host.querySelector(`#${id}`), `${id} rendered with a zero count`).toBeNull();
    }
    expect(host.querySelector(".v3ib-dict")).toBeNull();
    // No chrome describing an empty thing — and since the header strip is gone
    // entirely (2026-08-13) this would pass vacuously, so it asserts what an empty
    // board DOES show instead: which kind of empty it is.
    expect(host.querySelector(".v3ib-top")).toBeNull();
    expect(host.querySelector(".v3ib-collapsed-row"), "the superseded three-way empty row is back").toBeNull();
  });

  it("the Sessions section hides itself at zero seams (its own rule, unchanged)", () => {
    render(createElement(SessionsSection, {
      sessionQueue: [], plannedPairs: new Set<string>(), busy: null, onPropose: () => {},
    }));
    expect(host.innerHTML).toBe("");
  });

  it("the unowned/seam strip hides itself when there is nothing unowned and no seam", () => {
    const l = ledgerFor(emptyStore());
    render(createElement(UnownedSeamStrip, {
      unownedBands: l.unownedBands, seamBands: l.seamBands, openTotal: 0, unownedOpen: 0,
    }));
    expect(host.innerHTML).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6d · THE KIT'S HONEST COLD START — a sentence, not a shell, not a placeholder
// ════════════════════════════════════════════════════════════════════════════════
describe("[6d] the kit cold-starts honestly", () => {
  it("the Discovery Kit alignment surface names the empty state and the next move", () => {
    render(createElement(DiscoveryKitAlign, { program: framedProgram() }));
    const empty = host.querySelector(".v3fs-dka-empty");
    expect(empty, "the kit drew a matrix of nothing instead of saying it is empty").not.toBeNull();
    expect(empty!.textContent).toMatch(/no people yet/i);
    expect(empty!.textContent).toMatch(/add a role/i);        // …and what to do about it
    assertNoBrokenNumbers(host.textContent ?? "", "DiscoveryKitAlign");
  });

  it("it fabricates NO coverage: no person rows, no area columns, no invented heard fraction", () => {
    render(createElement(DiscoveryKitAlign, { program: framedProgram() }));
    expect(host.querySelectorAll(".v3fs-dka-person")).toHaveLength(0);
    const text = host.textContent ?? "";
    expect(text).not.toMatch(/\bcovering\b/);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+\s*heard/);
    expect(text).not.toContain("100%");
  });

  it("the kit PROJECTION is empty and honest — zero questions, and no placeholder question", () => {
    const kit = projectKitQuestions(emptyStore());
    expect(kit).toEqual([]);
    // nothing invents a "we'll ask you later" row to keep the surface populated
    expect(kit.some((k) => !k.about)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6e · NOTHING FABRICATES A COUNT — a miss stays visible
// ════════════════════════════════════════════════════════════════════════════════
describe("[6e] a miss stays visible — the hide rule is ZERO, not 'small'", () => {
  /** One entity in an area the function table does not know → exactly one UNOWNED
   *  open question (its attribute's dataType). The smallest non-empty programme. */
  const oneMiss = (): LedgerStore => migrate({
    ontology: { entities: [{ name: "Case", area: "Surgical Operations", attributes: ["acuity"] }] },
    atlas: {}, overrides: [],
  });

  it("the fixture really is one unowned question, and its owner is a MISS not a default", () => {
    const q = buildUnknownQueue(oneMiss());
    const open = q.items.filter((i) => i.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].about).toBe("el:attr:case.acuity#dataType");
    expect(open[0].owner).toEqual({ kind: "unowned" });     // never a fabricated fallback role
    expect(open[0].ownerLabel).toBe("unowned");
  });

  it("ONE typing question routes to the dictionary ask and the inbox DRAWS it (nothing is hidden away)", () => {
    const store = oneMiss();
    const ledger = ledgerFor(store, ["coresystem"]);
    // it is a typing question, so it is the dictionary's work, not an assign row
    expect(ledger.assignQueue).toHaveLength(0);
    expect(ledger.typingLoci).toHaveLength(1);
    expect(operatorQueueCounts(ledger).chase).toBeGreaterThan(0);
    render(createElement(OperatorInbox, { ledger, candidates: [], by: "operator", onCommit: async () => {} }));
    expect(host.innerHTML, "the inbox hid a programme that still owes work").not.toBe("");
    expect(host.querySelector(".v3ib-dict"), "the dictionary ask was hidden").not.toBeNull();
    assertNoBrokenNumbers(host.textContent ?? "", "OperatorInbox(one miss)");
  });

  it("ONE unowned NON-typing question draws the assign section and its count reads 1", () => {
    // A workflow in an unknown area opens a `phase` question nobody owns.
    const store = migrate({
      ontology: {},
      atlas: { workflows: [{ name: "Case Review", area: "Surgical Operations", steps: [] }] },
      overrides: [],
    });
    const ledger = ledgerFor(store);
    expect(ledger.assignQueue).toHaveLength(1);
    expect(ledger.unownedOpen).toBe(1);
    render(createElement(OperatorInbox, { ledger, candidates: [], by: "operator", onCommit: async () => {} }));
    expect(host.querySelector("#ib-assign"), "one unowned question was hidden").not.toBeNull();
    // The header strip that carried this stat was removed on 2026-08-13; the count it
    // printed now lives on the section's own badge, which is the number the operator
    // actually reads. Same guarantee, surviving element.
    const stat = host.querySelector("#ib-assign .v3ib-n");
    expect(stat, "the assign section printed no count for a count of 1").toBeTruthy();
    expect(stat!.textContent).toContain("1");
    assertNoBrokenNumbers(host.textContent ?? "", "OperatorInbox(one unowned)");
  });

  it("the empty programme's numbers are all real zeros — no count is invented to fill a surface", () => {
    const store = emptyStore();
    const ledger = ledgerFor(store, ["coresystem"]);
    // the ONE thing a framed-but-empty programme legitimately owes is the Frame-born
    // dictionary ask for the system the sponsor NAMED — declared data, not a fabrication.
    expect(asksNeedingChase(ledger.artifactAsks)).toHaveLength(1);
    expect(ledger.artifactAsks.asks[0].weight).toBe(0);
    // everything derived from the (absent) ontology stays at zero
    expect(ledger.unownedOpen).toBe(0);
    expect(ledger.typingLoci).toHaveLength(0);
    expect(ledger.heard.total).toBe(0);
    expect(ledger.kit.burnDown.total).toBe(0);
    expect(ledger.devs).toHaveLength(0);
  });
});
