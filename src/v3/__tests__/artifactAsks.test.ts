/**
 * ACCEPTANCE — dictionary ask: preventive by default, remedial fallback.
 *
 * One ask PER SYSTEM OF RECORD, born at SoR identification (derivation — naming the
 * SoR and creating its ask are one act). Owner = system owner or TBC (null), never
 * fabricated. Weight = the typing questions the artifact would close; conservation:
 * Σ ask weights + unattributed === the dictionary bucket. The inbox chase list holds
 * an ask only while unprovided (self-clearing on import); questions minted after an
 * import REOPEN the same ask — never a second one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProgramSummary } from "@/new/types";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, dictionaryBucket } from "@/v3/lib/ledger/projections";
import {
  deriveArtifactAsks, asksNeedingChase, frameSorReadiness, parseDeclaredSors,
  type ArtifactAskMark,
} from "@/v3/lib/ledger/artifactAsks";
import { flowMovements, gateChecklist } from "@/v3/components/flow/flowShellData";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = () => migrate({ ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") } as Snapshot);

// Surgery-shaped program: ONE SoR (the EHR) named on the entities, one without.
const surgery: Snapshot = {
  ontology: {
    entities: [
      { name: "Case", area: "Surgical Operations", systemOfRecord: "EHR", attributes: ["status", "priority"] },
      { name: "Anesthesia Record", area: "Anesthesiology", systemOfRecord: "EHR", attributes: ["type"] },
      { name: "Whiteboard Note", area: "Surgical Operations", attributes: ["status"] }, // no SoR named — a Frame gap
    ],
    relations: [],
  },
  atlas: { workflows: [{ name: "Case Cancellation Review", area: "Surgical Operations", owner: "Chief of Surgery", trigger: "cancel", steps: [{ action: "Decide whether to cancel", actor: "Surgeon" }] }] },
  overrides: [],
};
const surgeryRoster = [
  { label: "Chief of Surgery", role: "Chief of Surgery" },
  { label: "Dana Cole", role: "EHR Systems Lead" },
];

describe("preventive ask — born at SoR identification, per SoR", () => {
  const store = laila();
  const view = deriveArtifactAsks(store, {});

  it("Laila: one ask per named SoR (5), no dictionary yet → all unrequested → Frame incomplete", () => {
    expect(view.asks.map((a) => a.sor).sort()).toEqual(
      ["CRM", "Content Management System", "Contract Management System", "Finance System", "Project Management System"]);
    expect(view.asks.every((a) => a.state === "unrequested")).toBe(true);
    expect(view.frameComplete).toBe(false);
  });

  it("owner honesty: no system owner on the roster → owner null (renders TBC), never fabricated", () => {
    expect(view.asks.every((a) => a.owner === null)).toBe(true);
    const withOwner = deriveArtifactAsks(store, { roster: [{ label: "Sam Data", role: "Salesforce Admin" }] });
    expect(withOwner.asks.every((a) => a.owner === "Sam Data")).toBe(true);
  });

  it("CONSERVATION: Σ ask weights + unattributed === the dictionary bucket (one count)", () => {
    const bucket = dictionaryBucket(buildUnknownQueue(store)).length;
    const sum = view.asks.reduce((n, a) => n + a.weight, 0) + view.unattributed.weight;
    expect(sum).toBe(bucket);
    expect(bucket).toBeGreaterThan(0);
  });

  it("surgery: the EHR ask exists with the EHR Systems Lead as owner; the no-SoR entity's questions are unattributed (a Frame gap, not an ask)", () => {
    const v = deriveArtifactAsks(migrate(surgery), { roster: surgeryRoster });
    expect(v.asks.map((a) => a.sor)).toEqual(["EHR"]);
    expect(v.asks[0].owner).toBe("Dana Cole");
    expect(v.asks[0].weight).toBeGreaterThan(0);
    expect(v.unattributed.weight).toBeGreaterThan(0); // Whiteboard Note's typing questions
  });
});

describe("state machine — request, provide (self-clear), reopen (never a second ask), has-none", () => {
  it("requested: the operator mark sets the ageing anchor; still chases", () => {
    const v = deriveArtifactAsks(migrate(surgery), {
      roster: surgeryRoster, marks: [{ sor: "EHR", mark: "requested", at: "2026-08-01T00:00:00Z" }],
    });
    expect(v.asks[0].state).toBe("requested");
    expect(v.asks[0].requestedAt).toBe("2026-08-01T00:00:00Z");
    expect(asksNeedingChase(v).map((a) => a.sor)).toEqual(["EHR"]);
    expect(v.frameComplete).toBe(true); // requested counts as a handled Frame item
  });

  it("provided: dictionary on file + zero residue → ask satisfied, inbox self-clears", () => {
    const store = migrate(surgery);
    // close every EHR typing locus the way a dictionary import does
    const v0 = deriveArtifactAsks(store, {});
    for (const about of v0.asks[0].abouts) {
      store.assert({ about, value: { kind: "scalar", value: "string" }, world: "to-be", layer: "configuration",
        source: "code-derived", ownerWhileOpen: { kind: "unowned" }, status: "weak",
        closedBy: { method: "import", by: "dictionary:ehr-dd" } });
    }
    const v = deriveArtifactAsks(store, { dictionaryName: "ehr-dd" });
    const ehr = v.asks.find((a) => a.sor === "EHR")!;
    expect(ehr.state).toBe("provided");
    expect(ehr.weight).toBe(0);
    expect(asksNeedingChase(v).some((a) => a.sor === "EHR")).toBe(false); // self-cleared
  });

  it("reopened: questions minted AFTER the import attach to the SAME ask — never a second one", () => {
    const store = migrate(surgery);
    const v0 = deriveArtifactAsks(store, {});
    for (const about of v0.asks[0].abouts) {
      store.assert({ about, value: { kind: "scalar", value: "string" }, world: "to-be", layer: "configuration",
        source: "code-derived", ownerWhileOpen: { kind: "unowned" }, status: "weak",
        closedBy: { method: "import", by: "dictionary:ehr-dd" } });
    }
    // ontology growth: a NEW attribute on an EHR entity mints a new typing unknown
    store.addElement({ id: "el:attr:case.acuity", kind: "attribute", name: "acuity", of: "el:entity:case" });
    store.assert({ about: "el:attr:case.acuity#dataType", value: { kind: "unknown" }, world: "to-be", layer: "configuration",
      source: "generated", ownerWhileOpen: { kind: "unowned" }, status: "open" });
    const v = deriveArtifactAsks(store, { dictionaryName: "ehr-dd" });
    const ehrAsks = v.asks.filter((a) => a.sor === "EHR");
    expect(ehrAsks).toHaveLength(1);            // ONE ask, always
    expect(ehrAsks[0].state).toBe("reopened");  // the same ask reopened
    expect(ehrAsks[0].weight).toBe(1);
    expect(asksNeedingChase(v).map((a) => a.sor)).toEqual(["EHR"]); // back in the inbox
  });

  it("has-none: an explicit operator mark completes the Frame item and stops the chase", () => {
    const v = deriveArtifactAsks(migrate(surgery), {
      roster: surgeryRoster, marks: [{ sor: "EHR", mark: "has-none", at: "2026-08-01T00:00:00Z" }],
    });
    expect(v.asks[0].state).toBe("has-none");
    expect(asksNeedingChase(v)).toHaveLength(0);
    expect(v.frameComplete).toBe(true);
  });
});

/**
 * BORN AT FRAME TIME — the sponsor's `systemsOfRecord` input.
 *
 * Until now a SoR could only be named by the ontology (entities[].systemOfRecord),
 * generated in Listen — so the preventive ask could not exist before an ontology did,
 * which is precisely when the dictionary is cheapest to ask for. The Frame input is
 * the first-class place the sponsor NAMES the systems; the two sources merge
 * case-insensitively so ONE system is never TWO asks.
 */
describe("Frame SoR input — the ask is born when the sponsor names the system", () => {
  const empty: Snapshot = { ontology: { entities: [], relations: [] }, atlas: { workflows: [] }, overrides: [] };

  it("parseDeclaredSors: lines, commas, bullets — and ONE ask per system (case-insensitive dedupe)", () => {
    expect(parseDeclaredSors("Salesforce CRM\n- SAP Finance\nWorkday, Salesforce crm"))
      .toEqual(["Salesforce CRM", "SAP Finance", "Workday"]);
    expect(parseDeclaredSors(undefined)).toEqual([]);
    expect(parseDeclaredSors("   ")).toEqual([]);
  });

  it("declared with NO ontology: the ask exists, unrequested, and CHASES (nothing modelled to weigh yet)", () => {
    const v = deriveArtifactAsks(migrate(empty), { declaredSors: ["Salesforce CRM"] });
    expect(v.asks.map((a) => a.sor)).toEqual(["Salesforce CRM"]);
    expect(v.asks[0].state).toBe("unrequested");
    expect(v.asks[0].source).toBe("frame");
    expect(v.asks[0].entityCount).toBe(0);
    expect(v.asks[0].weight).toBe(0);          // honest: nothing modelled against it yet
    expect(v.asks[0].owner).toBeNull();        // TBC, never fabricated
    expect(v.frameComplete).toBe(false);       // an incomplete Frame item, as it should be
    expect(asksNeedingChase(v).map((a) => a.sor)).toEqual(["Salesforce CRM"]);
  });

  it("ONE ASK PER SoR holds across the two sources: a differently-cased declaration does NOT mint a second", () => {
    const v = deriveArtifactAsks(migrate(surgery), { roster: surgeryRoster, declaredSors: ["ehr", "Billing"] });
    expect(v.asks.filter((a) => a.sor.toLowerCase() === "ehr")).toHaveLength(1);
    const ehr = v.asks.find((a) => a.sor.toLowerCase() === "ehr")!;
    expect(ehr.sor).toBe("EHR");        // the MODELLED spelling wins — it carries the entities
    expect(ehr.source).toBe("both");
    expect(ehr.entityCount).toBe(2);
    expect(ehr.weight).toBeGreaterThan(0);
    // the declared-only one is its own ask, born at Frame
    expect(v.asks.find((a) => a.sor === "Billing")?.source).toBe("frame");
  });

  it("CONSERVATION survives the new source: Σ weights + unattributed === the dictionary bucket", () => {
    const store = migrate(surgery);
    const bucket = dictionaryBucket(buildUnknownQueue(store)).length;
    const v = deriveArtifactAsks(store, { declaredSors: ["EHR", "Billing", "Scheduling"] });
    const sum = v.asks.reduce((n, a) => n + a.weight, 0) + v.unattributed.weight;
    expect(sum).toBe(bucket);   // declared-only asks add names, never phantom weight
  });

  it("a requested/has-none mark completes the Frame item for a declared-only SoR", () => {
    const marked = deriveArtifactAsks(migrate(empty), {
      declaredSors: ["Salesforce CRM"],
      marks: [{ sor: "salesforce crm", mark: "requested", at: "2026-08-01T00:00:00Z" }],
    });
    expect(marked.asks[0].state).toBe("requested");   // marks match case-insensitively
    expect(marked.frameComplete).toBe(true);
  });

  it("frameSorReadiness reads BOTH sources and reports which is which", () => {
    const ontology = { entities: [{ name: "Case", systemOfRecord: "EHR" }] };
    const r = frameSorReadiness(ontology, [], false, ["ehr", "Billing"]);
    expect(r.named).toEqual(["Billing", "EHR"]);      // merged, one per system
    expect(r.fromOntology).toEqual(["EHR"]);
    expect(r.fromFrame).toEqual(["ehr", "Billing"]);
    expect(r.complete).toBe(false);
    // the ontology-only call site that predates the field is unchanged
    expect(frameSorReadiness(ontology, [], false).named).toEqual(["EHR"]);
  });
});

/**
 * PER-SoR DICTIONARIES — `_dataDictionary` was ONE global CSV, so a single CRM export
 * marked every system's ask satisfied. A CRM export answers nothing about the finance
 * system; that is fabrication by omission. Each ask now consumes its OWN dictionary.
 */
describe("each ask consumes its own dictionary", () => {
  const twoSystems: Snapshot = {
    ontology: {
      entities: [
        { name: "Case", area: "Surgical Operations", systemOfRecord: "EHR", attributes: ["status", "priority"] },
        { name: "Invoice", area: "Finance", systemOfRecord: "Billing", attributes: ["amount", "terms"] },
      ],
      relations: [],
    },
    atlas: { workflows: [] },
    overrides: [],
  };
  /** Close one SoR's typing loci the way importing ITS dictionary does. */
  const importFor = (store: ReturnType<typeof migrate>, sor: string) => {
    for (const about of deriveArtifactAsks(store, {}).asks.find((a) => a.sor === sor)!.abouts) {
      store.assert({ about, value: { kind: "scalar", value: "string" }, world: "to-be", layer: "configuration",
        source: "code-derived", ownerWhileOpen: { kind: "unowned" }, status: "weak",
        closedBy: { method: "import", by: `dictionary:${sor}` } });
    }
  };

  it("the EHR dictionary satisfies the EHR ask and LEAVES the Billing ask open", () => {
    const store = migrate(twoSystems);
    importFor(store, "EHR");
    const v = deriveArtifactAsks(store, { dictionaryBySor: new Map([["ehr", "ehr-dd"]]) });
    const ehr = v.asks.find((a) => a.sor === "EHR")!;
    const billing = v.asks.find((a) => a.sor === "Billing")!;
    expect(ehr.state).toBe("provided");
    expect(ehr.dictionary).toBe("ehr-dd");
    expect(ehr.ownDictionary).toBe(true);
    // the honest part: nothing about Billing was answered by the EHR file
    expect(billing.state).toBe("unrequested");
    expect(billing.dictionary).toBeNull();
    expect(billing.weight).toBeGreaterThan(0);
    expect(asksNeedingChase(v).map((a) => a.sor)).toEqual(["Billing"]);
    expect(v.frameComplete).toBe(false);
  });

  it("the PROGRAMME-WIDE upload still claims to cover everything — the old behaviour, kept and named", () => {
    const store = migrate(twoSystems);
    importFor(store, "EHR");
    const v = deriveArtifactAsks(store, { dictionaryName: "everything-dd" });
    const billing = v.asks.find((a) => a.sor === "Billing")!;
    expect(billing.state).toBe("reopened");        // covered, but questions remain
    expect(billing.dictionary).toBe("everything-dd");
    expect(billing.ownDictionary).toBe(false);     // not its own file — say so
  });

  it("ONE ASK PER SoR survives keyed uploads, and conservation is untouched", () => {
    const store = migrate(twoSystems);
    const bucket = dictionaryBucket(buildUnknownQueue(store)).length;
    const v = deriveArtifactAsks(store, {
      declaredSors: ["ehr"],
      dictionaryBySor: new Map([["ehr", "a"], ["billing", "b"]]),
    });
    expect(v.asks).toHaveLength(2);                                     // not 3
    expect(v.asks.reduce((n, a) => n + a.weight, 0) + v.unattributed.weight).toBe(bucket);
  });
});

describe("the Frame GATE surfaces the sponsor's declaration — before any ontology exists", () => {
  const programme = (frameInputs: Record<string, unknown>, inner: Record<string, unknown> = {}): ProgramSummary => ({
    id: "p1", name: "SoR", client: "", methodology: "atos-flow",
    rawData: { data: { phaseInputs: { frame: frameInputs }, ...inner } }, updatedAt: "2026-08-10",
  } as unknown as ProgramSummary);
  const frame = () => flowMovements().find((m) => m.id === "frame")!;
  const sorItem = (p: ProgramSummary) => gateChecklist(p, frame(), []).find((c) => c.id === "sor-dictionary");

  it("no ontology, no declaration → no item (we do not invent an obligation)", () => {
    expect(sorItem(programme({ sponsor: "Sarah" }))).toBeUndefined();
  });

  it("no ontology, sponsor named two systems → the item is LIVE and incomplete at Frame", () => {
    const item = sorItem(programme({ systemsOfRecord: "Salesforce CRM\nSAP Finance" }));
    expect(item).toBeDefined();
    expect(item!.done).toBe(false);
    expect(item!.label).toContain("2 of 2 systems of record");
    expect(item!.label).toContain("Salesforce CRM");
    expect(item!.why).toBe("2 named in Frame only");
    expect(item!.anchor).toBe("input:systemsOfRecord");
  });

  it("ontology + declaration of the SAME system → ONE row, and the item says where the names came from", () => {
    const item = sorItem(programme(
      { systemsOfRecord: "ehr, Billing" },
      { domainOntology: { entities: [{ name: "Case", systemOfRecord: "EHR" }] } },
    ));
    expect(item!.label).toContain("2 of 2 systems of record");   // EHR + Billing, not 3
    expect(item!.why).toBe("1 on the ontology · 1 named in Frame only");
  });

  it("a PER-SoR dictionary handles only its own system; the programme-wide one handles all", () => {
    const csv = "Entity,Field,Type\nCase,Status,picklist";
    const withInputs = (listen: Record<string, unknown>) => ({
      id: "p1", name: "SoR", client: "", methodology: "atos-flow",
      rawData: { data: { phaseInputs: { frame: { systemsOfRecord: "EHR\nBilling" }, listen } } },
      updatedAt: "2026-08-10",
    } as unknown as ProgramSummary);
    const perSor = sorItem(withInputs({ _dataDictionary: JSON.stringify({ EHR: csv }) }))!;
    expect(perSor.done).toBe(false);
    expect(perSor.label).toContain("1 of 2 systems of record");
    expect(perSor.label).toContain("Billing");        // the one still unanswered, named
    const global = sorItem(withInputs({ _dataDictionary: csv }))!;
    expect(global.done).toBe(true);                   // the un-keyed upload claims to cover everything
  });
});

/**
 * SETTLING AN ASK THAT ALREADY HAS A DICTIONARY.
 *
 * A dictionary arrives, closes some of the typing wall and not all of it, so the
 * ask REOPENS and keeps chasing. The only disposition on offer was "has no
 * dictionary" — false the moment one has been uploaded. The operator's real
 * position ("that upload is everything this system has") had no way onto the
 * record, so quieting the card meant recording something untrue.
 *
 * `complete` says the true thing. What it does NOT do is make the remaining
 * questions go away: they stay open, stay counted, stay in the burn-down. It ends
 * the chase, not the count.
 */
describe("the 'that's the whole dictionary' disposition", () => {
  // The surgery shape: the EHR names two entities, so a dictionary on file that
  // does not answer everything leaves the ask REOPENED — the state this exists for.
  const withDict = (marks: ArtifactAskMark[] = []) =>
    deriveArtifactAsks(migrate(surgery), { dictionaryBySor: new Map([["ehr", "EHR dictionary"]]), marks });

  it("REGRESSION: a reopened ask can be settled without claiming there is no dictionary", () => {
    const before = withDict();
    const ask = before.asks.find((a) => a.sor === "EHR")!;
    expect(ask.state, "the precondition — a dictionary is on file and questions remain").toBe("reopened");
    expect(asksNeedingChase(before).some((a) => a.sor === "EHR")).toBe(true);

    const after = withDict([{ sor: "EHR", mark: "complete", at: "2026-08-12T00:00:00Z", by: "op" }]);
    expect(after.asks.find((a) => a.sor === "EHR")!.state).toBe("complete");
    expect(asksNeedingChase(after).some((a) => a.sor === "EHR"), "still chasing a settled ask").toBe(false);
  });

  it("settling ends the CHASE, never the count", () => {
    const before = withDict();
    const after = withDict([{ sor: "EHR", mark: "complete", at: "2026-08-12T00:00:00Z" }]);
    const w = (v: typeof before) => v.asks.find((a) => a.sor === "EHR")!.weight;
    expect(w(after), "the open questions were swallowed by the disposition").toBe(w(before));
    // conservation is over ALL asks, so a settled one must still be in the list
    expect(after.asks.some((a) => a.sor === "EHR")).toBe(true);
  });

  it("'complete' with NO dictionary on file is ignored — it describes nothing", () => {
    const v = deriveArtifactAsks(migrate(surgery), {
      marks: [{ sor: "EHR", mark: "complete", at: "2026-08-12T00:00:00Z" }],
    });
    const ask = v.asks.find((a) => a.sor === "EHR")!;
    expect(ask.state, "an ask with nothing on file was settled by a mark about a file").not.toBe("complete");
    expect(asksNeedingChase(v).some((a) => a.sor === "EHR"), "the ask stopped being chased anyway").toBe(true);
  });

  it("a later mark supersedes it — settling is reversible", () => {
    const after = withDict([
      { sor: "EHR", mark: "complete", at: "2026-08-12T00:00:00Z" },
      { sor: "EHR", mark: "requested", at: "2026-08-12T01:00:00Z" },
    ]);
    // With a dictionary on file the ask returns to `reopened`, which is the truth:
    // there is one, and questions remain.
    expect(after.asks.find((a) => a.sor === "EHR")!.state).toBe("reopened");
    expect(asksNeedingChase(after).some((a) => a.sor === "EHR")).toBe(true);
  });

  it("has-none still wins over complete — the stronger statement", () => {
    const after = withDict([{ sor: "EHR", mark: "has-none", at: "2026-08-12T00:00:00Z" }]);
    expect(after.asks.find((a) => a.sor === "EHR")!.state).toBe("has-none");
  });
});
