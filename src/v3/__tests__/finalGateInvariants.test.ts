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
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ProgramSummary } from "@/new/types";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import {
  salesforceToClaims, fhirToClaims,
  type SfCustomObject, type FhirStructureDefinition,
} from "@/v3/lib/ledger/adapters";
import { operatorQueueCounts, type OperatorQueueReads } from "@/v3/lib/ledger/operatorQueue";
// `inboxWaitingCount` is deliberately NOT imported: comparing it to its own definition is
// the tautology this file used to call its headline invariant. The badge's real number is
// asserted where it is rendered — inboxBadgeIsThePage.test.ts.
import { programInboxItems, inboxWaitingCountFrom, inboxRenderedCountFrom } from "@/v3/components/flow/flowInbox";
import { importsModule, ledgerFilesToScan, literalRoleOwners, constOwnerIsInert, codeOnly } from "./helpers/sourceGuards";

const src = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");
const LEDGER_DIR = resolve(__dirname, "../lib/ledger");

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
// The decided TRACE and nothing else — history the page draws, work nobody is waiting on.
const DECIDED_ONLY: OperatorQueueReads = {
  ...NO_LEDGER_ITEMS,
  decideFates: [{
    kind: "decide-fate", about: "el:x#phase", slot: "phase", decision: "out-of-scope",
    reason: "not in this programme", by: "op", at: "2026-08-01T00:00:00Z",
  }],
};
const prog = (data: Record<string, unknown> = {}): ProgramSummary =>
  ({ id: "p1", rawData: { data } } as unknown as ProgramSummary);
const bare = prog();
const withRecordItem = prog({
  phaseInputs: { listen: { _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Ada", role: "Regional Ops", roleResolved: false }]) } },
});

describe("(c) the badge and the Inbox emptiness check are the same expression", () => {
  // THE HEADLINE ASSERTION OF (c) — "the badge equals what the Inbox page renders" — is
  // NOT here. It cannot be: nothing in this file has ever looked at the page.
  //
  // What used to stand in its place was
  //     inboxWaitingCountFrom(programInboxItems(p), l) === inboxWaitingCount(p, l)
  // and flowInbox.ts DEFINES the right side as the left side. No input could fail it. It
  // read like the strongest test on the branch and was worth exactly nothing — worse than
  // nothing, because its presence is why nobody wrote the real one for so long.
  //
  // The real one is inboxBadgeIsThePage.test.ts: it MOUNTS FlowShell over four programme
  // shapes, reads the integer off the rail badge, counts the rows on the Inbox page, and
  // asserts they are equal. It caught D1 (approvals counted into the badge, drawn only
  // when an OPTIONAL handler happened to be passed) the moment it existed.
  //
  // What stays here is what this file is actually for: SHAPE. That the two surfaces reach
  // the count through one module, and that the empty state is that count's own zero.

  it("the page is empty in exactly the cases NOTHING IS DRAWN — no third state", () => {
    // The predicate is `rendered`, not the badge. The two were the same integer until
    // `decided` left the badge; the DECIDED_ONLY row is the case where they part, and
    // gating on the badge there put "Nothing needs you right now" over the trace.
    const cases: Array<[ProgramSummary, OperatorQueueReads, boolean]> = [
      [bare, NO_LEDGER_ITEMS, true],            // nothing at all -> quiet block earns the page
      [bare, ONE_SESSION, false],               // ledger half only -> quiet block must NOT show
      [withRecordItem, NO_LEDGER_ITEMS, false], // record half only
      [withRecordItem, ONE_SESSION, false],     // both
      [bare, DECIDED_ONLY, false],              // trace only -> DRAWN, so not empty (badge is 0)
    ];
    for (const [program, ledger, isEmpty] of cases) {
      const items = programInboxItems(program);
      expect(inboxRenderedCountFrom(items, ledger) === 0).toBe(isEmpty);
      // and the ledger half's own null-render rule agrees on the ledger term
      expect(operatorQueueCounts(ledger).rendered === 0).toBe(ledger === NO_LEDGER_ITEMS);
    }
  });

  it("the ONE deliberate divergence: the decided trace is drawn, and is not waiting", () => {
    // `decided` counts rulings ALREADY made. It only grows, so summing it into the badge
    // made the badge monotonic — see operatorQueue.ts. It is therefore in `rendered`
    // (the page draws the trace) and out of `total` (the badge is what waits on you).
    // This is a stated split between two named numbers, both written in one module —
    // not a second spelling of one predicate, which is what invariant (c) forbids.
    const c = operatorQueueCounts(DECIDED_ONLY);
    expect(c.total).toBe(0);
    expect(c.rendered).toBe(1);
    expect(inboxWaitingCountFrom(programInboxItems(bare), DECIDED_ONLY)).toBe(0);
    // and the page's own gate is the one that keeps the trace on screen
    expect(src("v3/components/flow/OperatorInbox.tsx")).toContain("queue.rendered === 0");
  });

  it("SOURCE: FlowToday gates the quiet block on `rendered`, and no longer re-adds the ledger term", () => {
    const shell = src("v3/components/flow/FlowShell.tsx");
    // `rendered`, NOT `waiting`: the quiet block asks "is anything on the screen", and
    // the decided trace is on the screen while the badge (correctly) reads 0.
    expect(shell).toContain("inboxRenderedCountFrom(items, ledger)");
    expect(shell).toContain("rendered > 0 ? null :");
    expect(codeOnly(shell)).not.toMatch(/waiting > 0 \? null :/);
    // The second spelling is gone. The guard used to be `not.toContain("operatorQueueCount(")`,
    // which does NOT match the exported PLURAL `operatorQueueCounts(` — the one spelling a
    // developer would actually reach for, so the guard was bypassable by its likeliest bypass.
    // Forbid the MODULE, not one arrangement of letters: FlowShell reaches the ledger half
    // only THROUGH flowInbox, so a new term in the badge reaches the empty state for free.
    expect(importsModule(shell, "@/v3/lib/ledger/operatorQueue")).toBe(false);
    expect(importsModule(shell, "../../lib/ledger/operatorQueue")).toBe(false);
    // and belt-and-braces on the call itself, both spellings this time
    expect(shell).not.toMatch(/operatorQueueCounts?\(/);
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

  it("SOURCE: the scan covers every non-frozen ledger module, not a hand-kept list", () => {
    // The scan used to iterate a HARDCODED 12-file array while the directory held 20,
    // so kitAgendaCache / pgStore / readModel / useOperatorCommits were never read —
    // and readModel is on the live path (useProgramLedger and pgStore both import it).
    // It reads the directory now. This test is the ratchet: it must never shrink back.
    const scanned = ledgerFilesToScan(LEDGER_DIR);
    for (const f of ["readModel.ts", "pgStore.ts", "kitAgendaCache.ts", "useOperatorCommits.ts"]) {
      expect(scanned).toContain(f);
    }
    // exactly the four frozen-core files are out (see FROZEN_CORE for why each is safe)
    for (const f of ["store.ts", "types.ts", "precedence.ts", "projections.ts"]) {
      expect(scanned).not.toContain(f);
    }
    expect(scanned.length).toBe(readdirSync(LEDGER_DIR).filter((f) => f.endsWith(".ts")).length - 4);
  });

  it("SOURCE: the only constant role-owner literal left in src/v3/lib/ledger is the dictionary's neutral band", () => {
    // A literal owner is `role: "Something"`. Derived owners (`role: fn`,
    // `role: a.owner.label`) are not literals and are not matched.
    //
    // ONE exemption, and it is CONDITIONAL. dictionary.ts's neutral "System Owner" band
    // used to be exempt on the string alone, unconditionally — so if dictionary.ts ever
    // stamped it on an OPEN claim the scan would have stayed green. It now has to earn
    // the exemption the same way migrate.ts's `ownerFor("sales")` does below: the literal
    // may only reach claims born weak/closed, where ownerWhileOpen routes work to nobody.
    const dictionary = src("v3/lib/ledger/dictionary.ts");
    const dictionaryInert = constOwnerIsInert(dictionary, "System Owner");
    if (literalRoleOwners(dictionary).includes("System Owner")) {
      // If this fails, the band is no longer inert — fix dictionary.ts, do NOT widen the
      // exemption. Cause is one of: the literal went inline, an `ownerWhileOpen: OWNER`
      // site lost its weak/closed status, or a second path started spending the binding.
      expect(dictionaryInert).toBe(true);
    }

    const found: string[] = [];
    for (const f of ledgerFilesToScan(LEDGER_DIR)) {
      for (const role of literalRoleOwners(src(`v3/lib/ledger/${f}`))) {
        if (f === "dictionary.ts" && role === "System Owner" && dictionaryInert) continue;
        found.push(`${f}: ${role}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("SOURCE: the Deno mirror is scanned too — a constant owner there was invisible to every gate", () => {
    // THE BLIND SPOT THIS CLOSES. The scan above walks src/v3/lib/ledger only, so
    // supabase/functions/_shared — the Deno mirror that mints claims on the server side —
    // was read by no guard at all. Not hypothetical: overrideAdapter.ts held
    // `const OP_OWNER: Owner = { kind: "role", role: "Sales Leaders" }` and stamped it on
    // every claim built from an override log while F4/F5/F6 printed PASS. The same
    // fabrication the client side is guarded against, on the other side of the boundary.
    //
    // No exemption list: the mirror has no dictionary.ts neutral band and no migrate pin,
    // so anything found here is a finding. `readModule` is supplied because these modules
    // import each other by relative path — which is exactly how a constant can be moved
    // one file away and vanish from a single-file scan.
    const dir = resolve(__dirname, "../../../supabase/functions/_shared");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
    expect(files.length, "the _shared scan found no modules — the path is wrong").toBeGreaterThan(5);
    const readModule = (spec: string): string | null => {
      if (!spec.startsWith(".")) return null;                    // remote/npm: not ours to read
      try { return readFileSync(resolve(dir, spec.replace(/\.ts$/, "") + ".ts"), "utf8"); }
      catch { return null; }
    };
    const found: string[] = [];
    for (const f of files) {
      for (const role of literalRoleOwners(readFileSync(resolve(dir, f), "utf8"), { readModule, ownerShapeOnly: true })) {
        found.push(`${f}: ${role}`);
      }
    }
    expect(found, `\nConstant role owners in the Deno mirror:\n${found.join("\n")}\n`).toEqual([]);
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
/** Every non-test module under src/v3 that names `renderQuestion` — the renderer itself
 *  excluded, since it is the one place allowed to write the words. Read off disk so a
 *  module added tomorrow is scanned the day it lands. */
const renderQuestionTouchers = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      const abs = resolve(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.tsx?$/.test(e.name) || e.name === "renderQuestion.ts") continue;
      if (readFileSync(abs, "utf8").includes("renderQuestion")) out.push(`v3/${r}`);
    }
  };
  walk(resolve(__dirname, ".."), "");
  return out.sort();
};

describe("(a) question text comes only from renderQuestion.ts", () => {
  it("SOURCE: every ledger question surface renders through the one producer", () => {
    // `DesignLoopZones.tsx` used to be on this list. It drew a routing-filtered drill
    // list of role-owned open questions inside the design-approval zone — Listen's
    // burn-down, hosted by the wrong loop. That block is gone (2026-08-11): the band
    // states the count on one line and hands the work to Discover, which is where the
    // questions are actually worked. It renders NO question text at all now, so the
    // requirement below would be vacuous for it — and the case underneath, which scans
    // the whole directory rather than a list, is what stops a literal creeping back in.
    for (const f of ["v3/components/flow/TheLine.tsx", "v3/components/flow/OperatorInbox.tsx"]) {
      expect(src(f)).toMatch(/from "@\/v3\/lib\/ledger\/renderQuestion"/);
    }
    expect(src("v3/lib/ledger/kitProjection.ts")).toContain('from "./renderQuestion"');
    // …and the band genuinely renders none: no import, and therefore no second producer.
    const band = src("v3/components/flow/DesignLoopZones.tsx");
    expect(band).not.toMatch(/from "@\/v3\/lib\/ledger\/renderQuestion"/);
    expect(band, "the band prints question text again — put it back on the list above").not.toMatch(/question:\s*["`]/);
  });

  it("SOURCE: NO module that touches renderQuestion assigns a question STRING of its own", () => {
    // `question: r.question` (a rendering) is fine; `question: "…"` (a literal) is a
    // second producer. Only the renderer may write the words.
    //
    // THE SCAN IS THE DIRECTORY, not a list. It used to name four files by hand while SIX
    // more modules import renderQuestion — portalQuestionModel, flowPortal, FlowRespond,
    // PortalQuestions, kitAgendaCache, phrasing — and none of them was subject to this
    // check. That is the same list-shaped guard the owner scan had before ledgerFilesToScan,
    // and validate-pipeline's A1 backstop is a grep for four fixed sentence fragments, so a
    // new template worded differently walked past both. The invariant DOES hold today; the
    // guard just wasn't shaped to keep holding it.
    const scanned = renderQuestionTouchers();
    for (const f of scanned) expect(src(f)).not.toMatch(/question:\s*["`]/);

    // the ratchet: it must never shrink back to a hand-kept list, and the six modules the
    // old list omitted are named so a regression is legible rather than a count going down
    for (const f of ["v3/components/flow/portalQuestionModel.ts", "v3/components/flow/flowPortal.ts",
      "v3/components/flow/FlowRespond.tsx", "v3/components/flow/PortalQuestions.tsx",
      "v3/lib/ledger/kitAgendaCache.ts", "v3/lib/ledger/phrasing.ts"]) {
      expect(scanned).toContain(f);
    }
    expect(scanned.length).toBeGreaterThanOrEqual(10);
  });

  it("SOURCE: the kit agenda's stored strings are a CACHE, and are read through one accessor", () => {
    const cache = src("v3/lib/ledger/kitAgendaCache.ts");
    expect(cache).toContain("cache of rendered question text");
    expect(cache).toContain('origin: "cache" | "legacy-inline" | "none"');
  });
});
