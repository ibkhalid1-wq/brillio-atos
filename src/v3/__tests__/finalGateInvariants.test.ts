/**
 * FINAL GATE — the three invariants this branch is defended by, re-checked by READING
 * the shipped source rather than trusting the last commit message.
 *
 *  (a) question TEXT has exactly one producer — renderQuestion.ts;
 *  (b) no constant/default owner is stamped inside src/v3/lib/ledger/;
 *  (c) the rail badge and the Inbox page's emptiness check are ONE expression.
 *
 * Two of the three were already true; (b) and (c) were not, and this file pins the
 * fixes so neither can quietly come back:
 *
 *  · (c) FlowToday asked "is the inbox empty?" as `items.total === 0` AND
 *    `operatorQueueCount(ledger) > 0` — arithmetically the same predicate as the
 *    badge's `inboxWaitingCount`, but a SECOND spelling of it. A third term added to
 *    the badge would have left the quiet block behind, printing "Nothing needs you
 *    right now" over a populated page — the exact bug fd1cec7 had just fixed. Both
 *    now read `inboxWaitingCountFrom`.
 *
 *  · (b) adapters.ts stamped `{ kind: "role", role: "Sales Ops" }` on every claim from
 *    BOTH import adapters, so the FHIR (healthcare) path attributed clinical
 *    attributes to a CRM sales function. Nothing in an imported file says that. It is
 *    `unowned` now — the claims are born closed by an import, so no one owns them
 *    "while open" at all.
 *
 * The source sentries below read the real files off disk. They are deliberately about
 * SHAPE (which function is called, which literals exist), because that is what drifts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProgramSummary } from "@/new/types";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import {
  salesforceToClaims, fhirToClaims,
  type SfCustomObject, type FhirStructureDefinition,
} from "@/v3/lib/ledger/adapters";
import { operatorQueueCounts, type OperatorQueueReads } from "@/v3/lib/ledger/operatorQueue";
import { programInboxItems, inboxWaitingCount, inboxWaitingCountFrom } from "@/v3/components/flow/flowInbox";

const src = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

// ── (c) ONE definition, one expression: the badge and the page's empty state ────────
const NO_LEDGER_ITEMS: OperatorQueueReads = {
  assignQueue: [], sessionQueue: [], conflicts: [], assignments: [], pinConflicts: [], decideFates: [],
  artifactAsks: { asks: [], unattributed: { weight: 0, abouts: [] }, frameComplete: true },
};
// One ledger-side item and nothing on the record — the shape that used to show a bare
// icon over a populated Inbox.
const ONE_SESSION: OperatorQueueReads = {
  ...NO_LEDGER_ITEMS,
  sessionQueue: [{ pair: "Sales ⋈ Finance", abouts: ["el:x#phase"], items: [] }] as OperatorQueueReads["sessionQueue"],
};
const prog = (data: Record<string, unknown> = {}): ProgramSummary =>
  ({ id: "p1", rawData: { data } } as unknown as ProgramSummary);
const bare = prog();
const withRecordItem = prog({
  phaseInputs: { listen: { _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Ada", role: "Regional Ops", roleResolved: false }]) } },
});

describe("(c) the badge and the Inbox emptiness check are the same expression", () => {
  it("inboxWaitingCountFrom over the page's own lists === the badge's inboxWaitingCount", () => {
    for (const program of [bare, withRecordItem]) {
      for (const ledger of [NO_LEDGER_ITEMS, ONE_SESSION]) {
        expect(inboxWaitingCountFrom(programInboxItems(program), ledger))
          .toBe(inboxWaitingCount(program, ledger));
      }
    }
  });

  it("the page is empty in exactly the cases the badge reads 0 — no third state", () => {
    const cases: Array<[ProgramSummary, OperatorQueueReads, boolean]> = [
      [bare, NO_LEDGER_ITEMS, true],            // nothing at all -> quiet block earns the page
      [bare, ONE_SESSION, false],               // ledger half only -> quiet block must NOT show
      [withRecordItem, NO_LEDGER_ITEMS, false], // record half only
      [withRecordItem, ONE_SESSION, false],     // both
    ];
    for (const [program, ledger, isEmpty] of cases) {
      const items = programInboxItems(program);
      expect(inboxWaitingCountFrom(items, ledger) === 0).toBe(isEmpty);
      // and the ledger half's own null-render rule agrees on the ledger term
      expect(operatorQueueCounts(ledger).total === 0).toBe(ledger === NO_LEDGER_ITEMS);
    }
  });

  it("SOURCE: FlowToday gates the quiet block on `waiting`, and no longer re-adds the ledger term", () => {
    const shell = src("v3/components/flow/FlowShell.tsx");
    expect(shell).toContain("inboxWaitingCountFrom(items, ledger)");
    expect(shell).toContain("waiting > 0 ? null :");
    // The second spelling is gone: FlowShell reaches the ledger half only THROUGH
    // flowInbox, so a new term in the badge reaches the empty state for free.
    expect(shell).not.toContain("operatorQueueCount(");
  });

  it("SOURCE: the badge itself still reads the one helper", () => {
    const shell = src("v3/components/flow/FlowShell.tsx");
    expect(shell).toContain("inboxWaitingCount(program, ledger)");
    expect(src("v3/components/flow/flowInbox.ts")).toContain("inboxWaitingCountFrom(programInboxItems(program), ledger)");
  });
});

// ── (b) no constant / default owner anywhere in the ledger ──────────────────────────
const SF: SfCustomObject = {
  fullName: "Opportunity",
  fields: [{ fullName: "StageName", type: "Picklist", picklistValues: [{ fullName: "Prospecting" }] }],
};
const FHIR: FhirStructureDefinition = {
  resourceType: "StructureDefinition", name: "Encounter", kind: "resource",
  snapshot: { element: [
    { path: "Encounter" },
    { path: "Encounter.status", min: 1, max: "1", type: [{ code: "code" }], binding: { strength: "required", valueSet: "http://hl7.org/fhir/ValueSet/encounter-status" } },
  ] },
};

describe("(b) the import adapters invent no owner", () => {
  it("a FHIR import stamps NO role on any clinical attribute — unowned, not 'Sales Ops'", () => {
    const s = createLedgerStore();
    fhirToClaims(FHIR, s);
    const claims = s.claims();
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(c.ownerWhileOpen.kind).toBe("unowned");
      expect(JSON.stringify(c.ownerWhileOpen)).not.toContain("Sales");
    }
  });

  it("a Salesforce import likewise — the export names no owner, so neither does the ledger", () => {
    const s = createLedgerStore();
    salesforceToClaims(SF, s);
    for (const c of s.claims()) expect(c.ownerWhileOpen.kind).toBe("unowned");
  });

  it("no imported claim is OPEN, so no import can route work to anyone", () => {
    const s = createLedgerStore();
    salesforceToClaims(SF, s);
    fhirToClaims(FHIR, s);
    for (const c of s.claims()) expect(["closed", "weak"]).toContain(c.status);
  });

  it("SOURCE: the only constant role-owner literal left in src/v3/lib/ledger is the dictionary's neutral band", () => {
    // A literal owner is `role: "Something"`. Derived owners (`role: fn`,
    // `role: a.owner.label`) are not literals and are not matched. The allowlist is
    // the exception list — anything NEW shows up here as a failure with its file.
    const ALLOWED = new Map([["dictionary.ts", "System Owner"]]);
    const files = ["adapters.ts", "dictionary.ts", "migrate.ts", "curation.ts", "operatorActions.ts", "operatorQueue.ts",
      "artifactAsks.ts", "kitProjection.ts", "renderQuestion.ts", "useProgramLedger.ts", "phrasing.ts", "merge.ts"];
    const found: string[] = [];
    for (const f of files) {
      for (const m of src(`v3/lib/ledger/${f}`).matchAll(/role:\s*"([^"]+)"/g)) {
        if (ALLOWED.get(f) === m[1]) continue;
        found.push(`${f}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("SOURCE: migrate's one constant area call is confined to CLOSED override claims", () => {
    // `ownerFor("sales")` survives on the override-log path (removed / edited entities).
    // It is inert — every one of those asserts is born `status: "weak"` with a closure,
    // and buildUnknownQueue only ever reads open|blocked — but it IS a constant, so it
    // is pinned here: if one of these lines ever mints an OPEN claim, this fails.
    const migrate = src("v3/lib/ledger/migrate.ts");
    const lines = migrate.split("\n").filter((l) => l.includes('ownerFor("sales")'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/status: "weak"/);
  });
});

// ── (a) one producer of question text ───────────────────────────────────────────────
describe("(a) question text comes only from renderQuestion.ts", () => {
  it("SOURCE: every ledger question surface renders through the one producer", () => {
    for (const f of ["v3/components/flow/TheLine.tsx", "v3/components/flow/OperatorInbox.tsx", "v3/components/flow/DesignLoopZones.tsx"]) {
      expect(src(f)).toMatch(/from "@\/v3\/lib\/ledger\/renderQuestion"/);
    }
    expect(src("v3/lib/ledger/kitProjection.ts")).toContain('from "./renderQuestion"');
  });

  it("SOURCE: none of those surfaces assigns a question STRING of its own", () => {
    // `question: r.question` (a rendering) is fine; `question: "…"` (a literal) is a
    // second producer. Only the renderer may write the words.
    for (const f of ["v3/components/flow/TheLine.tsx", "v3/components/flow/OperatorInbox.tsx",
      "v3/components/flow/DesignLoopZones.tsx", "v3/lib/ledger/kitProjection.ts"]) {
      expect(src(f)).not.toMatch(/question:\s*["`]/);
    }
  });

  it("SOURCE: the kit agenda's stored strings are a CACHE, and are read through one accessor", () => {
    const cache = src("v3/lib/ledger/kitAgendaCache.ts");
    expect(cache).toContain("cache of rendered question text");
    expect(cache).toContain('origin: "cache" | "legacy-inline" | "none"');
  });
});
