/**
 * EVERY CONTROL MUST SAY WHAT IT DOES — asserted by mounting the real surfaces and
 * computing the real accessible name of every real interactive element.
 *
 * The readiness report's accessibility note said "icon-only glyphs … not fully
 * audited". This is that audit, done the only way it can be done honestly: mount
 * FlowShell on the Laila snapshot (the same fixture inboxBadgeIsThePage uses, so the
 * surfaces are full rather than empty), walk every view, open every disclosure that
 * hides more controls, and ask each focusable element what a screen reader would
 * announce for it.
 *
 * THE BAR is two letters. A name of "⌄", "✕", "＋", "▾" or "" is what the DOM had in
 * several places; a blind operator hears "black down-pointing triangle, button" or
 * nothing at all. `isWordless` in helpers/accessibleName.ts encodes the bar, and the
 * name computation there deliberately does NOT read CSS pseudo-content or chase
 * aria-labelledby recursively — an audit should under-report a name, never over-report.
 *
 * WHY IT ALSO COUNTS DECORATIVE GLYPHS. A glyph sitting beside real text ("⬆ upload
 * the CRM dictionary") is read twice: once as its Unicode name, once as the words.
 * The second describe() below holds every such glyph inside `aria-hidden="true"`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSummary } from "@/new/types";
import FlowShell from "@/v3/components/flow/FlowShell";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { accessibleName, isWordless, interactiveElements, isInteractive, roleOf } from "./helpers/accessibleName";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const LAILA_BLOB = {
  domainOntology: snap("domain-ontology.json") as Record<string, unknown>,
  currentStateAtlas: snap("current-state-atlas.json") as Record<string, unknown>,
  flowOperatorOverrides: snap("operator-overrides.json") as unknown[],
};
/**
 * The same migration the app runs, only so the operator actions below can name REAL
 * loci — an assignment against an invented `about` renders no row, and a row that
 * does not render is a control this audit would never see.
 */
const lailaQueue = buildUnknownQueue(migrate({
  ontology: LAILA_BLOB.domainOntology,
  atlas: LAILA_BLOB.currentStateAtlas,
  overrides: LAILA_BLOB.flowOperatorOverrides as Array<Record<string, unknown>>,
} as Snapshot));

const AT = "2026-08-01T00:00:00Z";
/** Record-side items too, so the Inbox draws approvals, portal replies and disputes. */
const RECORD_SIDE = {
  flowPortalInbox: [
    {
      id: "ap-1", kind: "approval", artifactId: "currentStateAtlas", movementId: "listen",
      artifactTitle: "Current-State Atlas", verdict: "approved",
      approver: { name: "Dana", role: "Sponsor" }, receivedAt: AT,
    },
    { id: "pi-1", kind: "interview", stakeholder: "Ada", role: "Ops", receivedAt: AT, text: "we reconcile it weekly" },
  ],
  phaseInputs: {
    listen: {
      _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Ada", role: "Regional Ops", roleResolved: false }]),
      // Two operator verbs, so the Inbox draws its in-flight section (reassign
      // select + the three exit tabs) and its decided trace. Without an assignment
      // on the fixture, those controls never mount and never get audited.
      _operatorActions: JSON.stringify([
        // TWO assignments, not one: the in-flight section repeats a whole control set
        // (reassign select, three exit tabs) per question, and a fixture with a single
        // row cannot show that the twenty-first "answer" button is indistinguishable
        // from the first. Ambiguity needs at least two of a thing to be visible.
        {
          kind: "assign", about: lailaQueue.items[0].about, slot: lailaQueue.items[0].slot,
          owner: { label: "Sales Ops", isRole: true }, by: "op", at: AT,
        },
        {
          kind: "assign", about: lailaQueue.items[2].about, slot: lailaQueue.items[2].slot,
          owner: { label: "Sales Ops", isRole: true }, by: "op", at: AT,
        },
        {
          kind: "decide-fate", about: lailaQueue.items[1].about, slot: lailaQueue.items[1].slot,
          decision: "out-of-scope", reason: "not in this programme", by: "op", at: AT,
        },
      ]),
    },
  },
};
/**
 * A TAGGED CLAIM and the transcript it came from, because the Library's claims panel
 * (and the untag "✕" inside each of its rows) renders only when there is a claim. A
 * fixture without one made an entire panel — and the one control on it whose accessible
 * name was a bare glyph — invisible to this audit.
 */
const CLAIMS = {
  claimTags: [{
    id: "c1", quote: "we reconcile the pipeline weekly by hand", who: "Ada",
    movementId: "listen", ts: AT, by: "op",
    target: { kind: "process", refId: "pr-1", label: "Pipeline reconciliation" },
  }],
};
const PROGRAM = {
  id: "p1", name: "Laila", client: "Laila Skin", methodology: "atos-flow",
  rawData: {
    data: {
      ...LAILA_BLOB, ...RECORD_SIDE, ...CLAIMS,
      phaseInputs: {
        ...RECORD_SIDE.phaseInputs,
        listen: {
          ...RECORD_SIDE.phaseInputs.listen,
          transcripts: [{ who: "Ada", text: "we reconcile the pipeline weekly by hand, every Friday", capturedAt: AT }],
        },
      },
    },
  },
} as unknown as ProgramSummary;
/** A second programme so Portfolio draws more than one card (and its rename/chevron). */
const SIBLING = { id: "p2", name: "Sibling programme", methodology: "atos-flow", rawData: { data: {} } } as unknown as ProgramSummary;

type Props = Parameters<typeof FlowShell>[0];
const noop = async () => {};
const shellProps = (): Props => ({
  program: PROGRAM, programs: [PROGRAM, SIBLING], runningAgentIds: new Set<string>(),
  onSelectProgram: () => {}, onCreateProgram: () => {}, onDrillDown: () => {},
  onOpenSetup: () => {}, onOpenCopilot: () => {}, onRunAgent: () => {},
  onSaveInputs: noop, onResolveDecision: noop,
  fleet: [], loadMovementSpend: async () => ({}), onSetHaltAll: noop,
  onToggleAgentHalt: noop, onSetMovementBudget: noop, onMintPacks: noop,
  onMintDemoInvites: noop, onCompileShipLanes: noop, onToggleShipItem: noop,
  onSetShipLane: noop, onHydratePrograms: noop, onScheduleFollowUp: noop,
  onMintFollowUp: async () => null, onMintReview: async () => null, onMintBrief: async () => null,
  onRecordShowPass: noop, onSaveArtifactDoc: noop,
  onIngestPortalItem: noop, onDismissPortalItem: noop, onRecordApproval: noop,
  onRenameProgram: () => {}, onDeleteProgram: () => {}, onTagClaim: noop, onGoFlow: () => {},
  // The Design Loop's review round is a WRITE surface: without this handler the band
  // renders read-only and its controls never mount, so the audit would pass over a
  // whole zone it has never seen.
  onDesignRound: noop,
  presence: [],
} as unknown as Props);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** Land on a view by clicking its rail item (or, for Portfolio, its breadcrumb). */
const goto = (label: string) => {
  const b = [...host.querySelectorAll("nav.v3fs-dock button, header.v3fs-appbar button")]
    .find((x) => (x.getAttribute("aria-label") ?? "").startsWith(label)) as HTMLButtonElement | undefined;
  if (!b) throw new Error(`no navigation control for ${label}`);
  act(() => { b.click(); });
};

/**
 * Open every disclosure on the page so the controls they hide are audited too —
 * the Sessions pairs, the Discover drill-downs, the per-person evidence groups, the
 * artifact phase <details>, the stakeholder exit tabs. Runs twice: opening one
 * disclosure can reveal another.
 */
const expandEverything = () => {
  for (let pass = 0; pass < 2; pass++) {
    const togglers = [
      ...host.querySelectorAll('button[aria-expanded="false"]'),
      ...host.querySelectorAll(".v3ib-tab, .v3dl-drillbtn, .v3fs-ev-ghead, .v3ib-disc"),
    ] as HTMLButtonElement[];
    for (const t of togglers) {
      if (t.disabled) continue;
      act(() => { t.click(); });
    }
    for (const d of Array.from(host.querySelectorAll("details"))) {
      act(() => { (d as HTMLDetailsElement).open = true; });
    }
  }
};

/**
 * THE ARTIFACT STUDIOS — the half of the Library this audit could not see.
 *
 * A studio is not a disclosure, so `expandEverything` never reached one. Clicking a
 * Library artifact row sets FlowShell's `docFor`, and FlowShell renders the studio
 * through `React.lazy` behind `<Suspense fallback={null}>`. A SYNCHRONOUS
 * `act(() => row.click())` therefore renders nothing and throws nothing: the chunk is
 * still a pending promise and the fallback is `null`. That silence is why every
 * control on the seam grid, the swimlane, the step inspector and the lifecycle grid
 * was absent from every case in this file — the audit was green over an empty div.
 *
 * So the chunk is awaited, which makes the audit async from here down. `import()` is
 * cached by the module registry, so the await after the first is free.
 */
const STUDIO_CHUNK = import("@/v3/components/flow/studio/FlowArtifactStudio");

/** The artifact rows that actually open — "not yet generated" rows are inert. */
const artifactRows = () =>
  [...host.querySelectorAll(".v3fs-art-row.v3fs-row-open")] as HTMLElement[];

/**
 * Open one artifact studio and walk into it: expand the seam view's workflows (which
 * is what draws the swimlane at all), then SELECT a step, because the step inspector
 * — reorder, drop/restore, every field — renders only for a selected step and is
 * otherwise a control surface no audit can see.
 */
const openStudio = async (row: HTMLElement) => {
  act(() => { row.click(); });
  await act(async () => { await STUDIO_CHUNK; });
  expandEverything();
  // The tile is clicked LAST, and deliberately: `expandEverything` toggles the seam
  // view's workflow disclosures, WorkflowStudio re-derives its active workflow when
  // they change, and that clears the selected step — so selecting first and expanding
  // afterwards left the inspector closed and its controls unaudited.
  const tile = host.querySelector("button.v3fs-swim-tile") as HTMLButtonElement | null;
  if (tile) act(() => { tile.click(); });
};

/** Close it again, so the next studio opens onto a clean page. */
const closeStudio = () => {
  const close = [...host.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").trim() === "Close") as HTMLButtonElement | undefined;
  if (close) act(() => { close.click(); });
};

/**
 * Land on a view and open everything on it. On Library that now includes the artifact
 * studios: the FIRST one is left open so every case below audits a studio, and the
 * per-studio case further down walks each of them in turn.
 */
const enter = async (view: string) => {
  goto(view);
  expandEverything();
  if (view === "Library") {
    const first = artifactRows()[0];
    if (first) await openStudio(first);
  }
};

const VIEWS = ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"] as const;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  // React Flow's ZoomPane constructs a ResizeObserver on mount, and jsdom has none.
  // Without this the graph surfaces THROW, ViewBoundary catches it, and the Library
  // renders an error card instead of the page — an audit that then finds nothing
  // wrong because there is nothing left to find. A no-op observer is honest here:
  // this file measures names and roles, and layout callbacks change neither.
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: class { observe() {} unobserve() {} disconnect() {} },
    writable: true, configurable: true,
  });
  act(() => { root.render(createElement(FlowShell, shellProps())); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** One line per offender, so a failure reads as a to-do list and not as a diff. */
const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()} role=${roleOf(el)} class="${el.getAttribute("class") ?? ""}"> text=${JSON.stringify((el.textContent ?? "").slice(0, 40))}`;

describe("no interactive element is nameless or glyph-only", () => {
  for (const view of VIEWS) {
    it(`${view}: every control announces words`, async () => {
      // Portfolio is reached from the app bar, not the rail — but the rail label
      // exists for it too; goto() covers both because both carry the aria-label.
      await enter(view);
      const bad = interactiveElements(host)
        .map((el) => ({ el, name: accessibleName(el) }))
        .filter(({ name }) => isWordless(name));
      expect(
        bad.map(({ el, name }) => `${describeEl(el)}  →  accessible name ${JSON.stringify(name)}`),
        `${view}: controls with no usable accessible name`,
      ).toEqual([]);
    });
  }

  it("the whole shell, every view at once, has zero wordless controls", async () => {
    // A belt-and-braces sweep: some controls only exist while another view has been
    // visited (the Inbox's dictionary preview, the Library's doc router). Visiting
    // every view in one mount catches anything the per-view cases miss.
    const bad: string[] = [];
    for (const view of VIEWS) {
      await enter(view);
      for (const el of interactiveElements(host)) {
        const name = accessibleName(el);
        if (isWordless(name)) bad.push(`${view}: ${describeEl(el)} → ${JSON.stringify(name)}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe("decorative glyphs are hidden from the reading order", () => {
  /**
   * The glyph vocabulary these surfaces draw. Anything in a name is read aloud.
   *
   * MATHEMATICAL OPERATORS (U+2200–U+22FF) were a HOLE in this list, and the studios
   * fell straight through it: "⊘ Mark dropped (reversible)" — U+2298, circled division
   * slash — sat between the arrows block that ends at U+21FF and the misc-technical
   * block that starts at U+2300, so the audit read the words, found them, and passed a
   * name a screen reader announces as "circled division slash, mark dropped". The two
   * supplemental symbol blocks (U+2900–U+2AFF) are closed for the same reason. No
   * legitimate label spells a word out of a maths operator, so the range is safe to
   * ban wholesale; em dashes, ellipses and middots are punctuation and stay allowed.
   */
  const GLYPHS = /[←-⇿∀-⋿⌀-⏿■-➿⤀-⫿⬀-⯿！-～\u{1F300}-\u{1FAFF}]/u;

  /**
   * Two controls carrying an unhidden glyph live in files this audit does not own, so
   * they are RECORDED rather than silently tolerated. The list is exact: a THIRD
   * offender, or either of these moving, turns this red.
   *   · "＋ add to the record"  — .v3ln-a, rendered by TheLine.tsx
   *   · "⌲ Attach a file …"     — .v3fs-a,  rendered by AttachFileButton in flowCapture.tsx
   */
  const NOT_OURS: Array<{ cls: string; name: RegExp; owner: string }> = [
    { cls: "v3ln-a", name: /^＋ add to the record$/, owner: "TheLine.tsx" },
    { cls: "v3fs-a", name: /^⌲ Attach a file/, owner: "flowCapture.tsx (AttachFileButton)" },
  ];
  const excused = (el: Element, name: string) =>
    NOT_OURS.some((x) => (el.getAttribute("class") ?? "").split(/\s+/).includes(x.cls) && x.name.test(name));

  it("no control we own announces a decorative glyph", async () => {
    const offenders: string[] = [];
    for (const view of VIEWS) {
      await enter(view);
      for (const el of interactiveElements(host)) {
        const name = accessibleName(el);
        const hit = name.match(GLYPHS);
        if (hit && !excused(el, name)) {
          offenders.push(`${view}: ${describeEl(el)} → name ${JSON.stringify(name)} contains ${JSON.stringify(hit[0])}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("the two glyph controls in other agents' files are still exactly those two", async () => {
    // A known-defect pin. When their owners fix them, this goes red and the excuse
    // above is deleted — which is the point: an exemption has to be able to expire.
    const found = new Set<string>();
    for (const view of VIEWS) {
      await enter(view);
      for (const el of interactiveElements(host)) {
        const name = accessibleName(el);
        if (GLYPHS.test(name)) found.add(`${el.getAttribute("class")}|${name.slice(0, 24)}`);
      }
    }
    expect([...found].sort()).toEqual([
      "v3fs-a|⌲ Attach a file — PDF, W",
      "v3ln-a|＋ add to the record",
    ]);
  });
});

/**
 * EVERY STUDIO, ONE AT A TIME. `enter("Library")` leaves the FIRST artifact open, which
 * is enough to stop the sweeps above being blind — but only the first. A studio is a
 * whole application surface (the Atlas alone draws a seam grid, a swimlane, a step
 * inspector, a lifecycle grid and four routed registers), so each is opened and audited
 * on its own, and each failure names the studio it came from rather than "Library".
 */
describe("the artifact studios say what their controls do", () => {
  it("the Library actually opens studios on this fixture", async () => {
    // If the router ever stops opening — a renamed class, a lazy chunk that throws,
    // a fixture whose artifacts are all "not yet generated" — every case below goes
    // vacuously green. That is the exact failure this whole section exists to end,
    // so it is asserted before anything is measured.
    goto("Library");
    expandEverything();
    expect(artifactRows().length, "no artifact on this fixture is openable").toBeGreaterThan(0);
    await openStudio(artifactRows()[0]);
    expect(
      host.querySelectorAll(".v3fs-seam-tile, button.v3fs-swim-tile, .v3fs-stu-sec").length,
      "the studio opened but drew none of its own surfaces",
    ).toBeGreaterThan(0);
  });

  it("the Current-State Atlas studio really draws its swimlane and step inspector", async () => {
    // The named surfaces, asserted rather than hoped for: the probe that started this
    // work found 0 swim tiles, 0 `.v3fs-swim-acts` buttons and 0 `.v3fs-wf-bar` buttons
    // on Library, and every one of those was a control this file had never seen.
    goto("Library");
    expandEverything();
    const atlas = artifactRows().find((r) => (r.textContent ?? "").includes("Current-State Atlas"));
    expect(atlas, "the Current-State Atlas must be openable on the Laila snapshot").toBeTruthy();
    await openStudio(atlas!);
    expect(host.querySelectorAll(".v3fs-seam-tile").length, "seam tiles").toBeGreaterThan(0);
    expect(host.querySelectorAll("button.v3fs-swim-tile").length, "swimlane tiles").toBeGreaterThan(0);
    expect(host.querySelectorAll(".v3fs-swim-acts button").length, "per-tile add/drop").toBeGreaterThan(0);
    expect(host.querySelectorAll(".v3fs-wf-bar button").length, "the step toolbar").toBeGreaterThan(0);
    expect(host.querySelectorAll(".v3fs-wf-inspector").length, "the step inspector").toBe(1);
  });

  it("no control in any studio is nameless, glyph-named or ambiguous", async () => {
    const GLYPHS = /[←-⇿∀-⋿⌀-⏿■-➿⤀-⫿⬀-⯿！-～\u{1F300}-\u{1FAFF}]/u;
    const offenders: string[] = [];
    goto("Library");
    expandEverything();
    const titles = artifactRows().map((r) => (r.querySelector(".v3fs-row-n")?.textContent ?? "?").trim());
    for (const title of titles) {
      const row = artifactRows().find((r) => (r.querySelector(".v3fs-row-n")?.textContent ?? "").trim() === title);
      if (!row) continue;
      await openStudio(row);
      const byName = new Map<string, Element[]>();
      for (const el of interactiveElements(host)) {
        const name = accessibleName(el);
        if (isWordless(name)) { offenders.push(`${title}: ${describeEl(el)} → nameless ${JSON.stringify(name)}`); continue; }
        const hit = name.match(GLYPHS);
        // The Library page itself stays mounted behind the studio, and its one
        // excused control (flowCapture's "⌲ Attach a file") is not ours to fix here.
        if (hit && !(el.getAttribute("class") ?? "").split(/\s+/).includes("v3fs-a")) {
          offenders.push(`${title}: ${describeEl(el)} → glyph ${JSON.stringify(hit[0])} in ${JSON.stringify(name)}`);
        }
        (byName.get(name) ?? byName.set(name, []).get(name)!).push(el);
      }
      for (const [name, els] of byName) {
        if (els.length > 1) offenders.push(`${title}: ${els.length}x ${JSON.stringify(name)} (${els[0].tagName}.${els[0].getAttribute("class")})`);
      }
      closeStudio();
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

describe("repeated controls are told apart", () => {
  it("no two controls on a page answer to the same name", async () => {
    // The other half of "say what it does": twenty buttons all announcing "answer",
    // or eight selects all announcing "Owner", are each individually named and
    // collectively useless — a screen-reader user tabbing the Inbox cannot tell which
    // question they are about to record against. Wordlessness is caught above; this
    // catches ambiguity, which is the failure mode of a repeated row.
    const clashes: string[] = [];
    for (const view of VIEWS) {
      await enter(view);
      const byName = new Map<string, Element[]>();
      for (const el of interactiveElements(host)) {
        const name = accessibleName(el);
        if (!name) continue;
        (byName.get(name) ?? byName.set(name, []).get(name)!).push(el);
      }
      for (const [name, els] of byName) {
        // ONE allowance, and it is not ambiguity: "New programme" appears twice on
        // Portfolio — once in the programme switcher's menu, once as the page's own
        // button — and both do exactly the same thing. WCAG 2.4.6 asks a label to
        // DESCRIBE its purpose, not to be unique; two doors to one room may share a
        // sign. Every other repeat here was a different action wearing the same word.
        if (name === "New programme") continue;
        if (els.length > 1) clashes.push(`${view}: ${els.length}x ${JSON.stringify(name)} (${els[0].tagName}.${els[0].getAttribute("class")})`);
      }
    }
    expect([...new Set(clashes)]).toEqual([]);
  });
});

describe("form controls inside rows are labelled", () => {
  it("every select, input and textarea has a name that is not just its placeholder", async () => {
    await enter("Inbox");
    // isInteractive, not a bare selector: the dictionary file input is deliberately
    // aria-hidden + tabindex=-1 (a real button proxies it), so it is not a control a
    // user can reach and asking it for a label would be asking the wrong question.
    const fields = [...host.querySelectorAll("select, input, textarea")]
      .filter((el) => isInteractive(el)) as HTMLElement[];
    expect(fields.length, "the Inbox should be drawing form controls on this fixture").toBeGreaterThan(0);
    const unlabelled = fields.filter((el) => {
      const name = accessibleName(el);
      if (isWordless(name)) return true;
      // A placeholder is a fallback, not a label: it disappears on input and is
      // announced inconsistently. Require something stronger to exist.
      const placeholder = el.getAttribute("placeholder");
      const strong = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title");
      const labelled = !!el.id && !![...host.querySelectorAll("label[for]")].some((l) => l.getAttribute("for") === el.id);
      return !strong && !labelled && !!placeholder;
    });
    expect(unlabelled.map(describeEl), "form controls named only by their placeholder").toEqual([]);
  });

  it("every label's `for` resolves to the control it names", async () => {
    await enter("Inbox");
    const broken = [...host.querySelectorAll("label[for]")]
      .filter((l) => {
        const target = l.getAttribute("for")!;
        // getElementById, not a selector — ids here contain colons and spaces.
        return !host.ownerDocument.getElementById(target) && !host.querySelector(`[id="${CSS.escape(target)}"]`);
      })
      .map((l) => `<label for=${JSON.stringify(l.getAttribute("for"))}>${l.textContent}`);
    expect(broken, "labels pointing at nothing").toEqual([]);
  });

  it("no two controls on the page share an id", async () => {
    await enter("Inbox");
    const seen = new Map<string, number>();
    for (const el of Array.from(host.querySelectorAll("[id]"))) {
      const id = el.id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });
});
