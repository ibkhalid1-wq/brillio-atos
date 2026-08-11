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
        {
          kind: "assign", about: lailaQueue.items[0].about, slot: lailaQueue.items[0].slot,
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

const VIEWS = ["Inbox", "Flow", "Library", "People", "Pulse", "Control", "Portfolio"] as const;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
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
    it(`${view}: every control announces words`, () => {
      goto(view);
      // Portfolio is reached from the app bar, not the rail — but the rail label
      // exists for it too; goto() covers both because both carry the aria-label.
      expandEverything();
      const bad = interactiveElements(host)
        .map((el) => ({ el, name: accessibleName(el) }))
        .filter(({ name }) => isWordless(name));
      expect(
        bad.map(({ el, name }) => `${describeEl(el)}  →  accessible name ${JSON.stringify(name)}`),
        `${view}: controls with no usable accessible name`,
      ).toEqual([]);
    });
  }

  it("the whole shell, every view at once, has zero wordless controls", () => {
    // A belt-and-braces sweep: some controls only exist while another view has been
    // visited (the Inbox's dictionary preview, the Library's doc router). Visiting
    // every view in one mount catches anything the per-view cases miss.
    const bad: string[] = [];
    for (const view of VIEWS) {
      goto(view);
      expandEverything();
      for (const el of interactiveElements(host)) {
        const name = accessibleName(el);
        if (isWordless(name)) bad.push(`${view}: ${describeEl(el)} → ${JSON.stringify(name)}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe("decorative glyphs are hidden from the reading order", () => {
  /** The glyph vocabulary these surfaces draw. Anything in a name is read aloud. */
  const GLYPHS = /[←-⇿⌀-⏿■-➿⬀-⯿！-～\u{1F300}-\u{1FAFF}]/u;

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

  it("no control we own announces a decorative glyph", () => {
    const offenders: string[] = [];
    for (const view of VIEWS) {
      goto(view);
      expandEverything();
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

  it("the two glyph controls in other agents' files are still exactly those two", () => {
    // A known-defect pin. When their owners fix them, this goes red and the excuse
    // above is deleted — which is the point: an exemption has to be able to expire.
    const found = new Set<string>();
    for (const view of VIEWS) {
      goto(view);
      expandEverything();
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

describe("form controls inside rows are labelled", () => {
  it("every select, input and textarea has a name that is not just its placeholder", () => {
    goto("Inbox");
    expandEverything();
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

  it("every label's `for` resolves to the control it names", () => {
    goto("Inbox");
    expandEverything();
    const broken = [...host.querySelectorAll("label[for]")]
      .filter((l) => {
        const target = l.getAttribute("for")!;
        // getElementById, not a selector — ids here contain colons and spaces.
        return !host.ownerDocument.getElementById(target) && !host.querySelector(`[id="${CSS.escape(target)}"]`);
      })
      .map((l) => `<label for=${JSON.stringify(l.getAttribute("for"))}>${l.textContent}`);
    expect(broken, "labels pointing at nothing").toEqual([]);
  });

  it("no two controls on the page share an id", () => {
    goto("Inbox");
    expandEverything();
    const seen = new Map<string, number>();
    for (const el of Array.from(host.querySelectorAll("[id]"))) {
      const id = el.id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });
});
