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
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, dictionaryBucket } from "@/v3/lib/ledger/projections";
import { deriveArtifactAsks, asksNeedingChase } from "@/v3/lib/ledger/artifactAsks";

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
