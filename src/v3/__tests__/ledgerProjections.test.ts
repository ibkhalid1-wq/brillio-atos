/**
 * Projections + deviation register on the migrated Laila ledger.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, buildOntologyView, buildAtlasView, buildKitView, buildDeviationRegister, buildSessionAgenda } from "@/v3/lib/ledger/projections";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { salesforceToClaims } from "@/v3/lib/ledger/adapters";
import { buildReadModel } from "@/v3/lib/ledger/pgStore";
import type { Claim, LedgerElement } from "@/v3/lib/ledger/types";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const snapshot: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const store = migrate(snapshot);

describe("2.3 unknown queue", () => {
  const q = buildUnknownQueue(store);
  it("routes every open unknown and ranks owners by how much they block", () => {
    expect(q.counts.total).toBeGreaterThan(50);
    expect(q.counts.blocking + q.counts["answerable-without-a-meeting"] + q.counts.blocked + q.counts.unowned).toBe(q.counts.total);
    // owners are ranked: the first owner blocks at least as much as the last
    if (q.byOwner.length > 1) {
      const first = q.byOwner[0].items.filter((i) => i.routing === "blocking").length;
      const last = q.byOwner[q.byOwner.length - 1].items.filter((i) => i.routing === "blocking").length;
      expect(first).toBeGreaterThanOrEqual(last);
    }
    // eslint-disable-next-line no-console
    console.log("QUEUE COUNTS", JSON.stringify(q.counts));
  });
});

describe("2.4 projections", () => {
  it("ontology view renders weak/unknown distinctly from closed", () => {
    const ont = buildOntologyView(store);
    expect(ont.length).toBeGreaterThan(30);
    const states = new Set(ont.flatMap((e) => e.slots.map((s) => s.state)));
    expect(states.has("open")).toBe(true);   // unknowns present
    expect(states.has("weak")).toBe(true);    // weak present, distinct
  });
  it("atlas view exposes steps with tri-state slots and ledger-sourced coherence", () => {
    const atlas = buildAtlasView(store);
    expect(atlas.length).toBe(14);
    const totalUnresolved = atlas.flatMap((w) => w.steps).reduce((n, s) => n + s.unresolvedRefs, 0);
    expect(totalUnresolved).toBeGreaterThan(0); // coherence gaps come from the ledger, not a side check
    expect(atlas.every((w) => w.steps.length >= 1)).toBe(true);
  });
  it("kit view groups by function, seams as joint bands, unowned its own band + burn-down", () => {
    const kit = buildKitView(store);
    expect(kit.bands.length).toBeGreaterThan(1);
    expect(kit.burnDown.total).toBeGreaterThan(0);
    expect(kit.burnDown.pctClosed).toBeGreaterThanOrEqual(0);
    // unowned/seam bands sort ahead of function bands
    const kinds = kit.bands.map((b) => b.kind);
    const firstFunction = kinds.indexOf("function");
    if (kinds.includes("unowned") && firstFunction >= 0) expect(kinds.indexOf("unowned")).toBeLessThan(firstFunction);
  });
});

describe("3.3 confirm-or-deviate agenda", () => {
  it("frames an open unknown against its strongest existing claim; an as-is import reads 'what you're leaving'", () => {
    const s = createLedgerStore();
    s.assert({ about: "el:attr:opportunity.stagename#valueSet", value: { kind: "unknown" }, world: "to-be", layer: "domain", source: "generated", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "open" });
    salesforceToClaims({ fullName: "Opportunity", fields: [{ fullName: "StageName", type: "Picklist", picklistValues: [{ fullName: "Prospecting" }, { fullName: "Qualification" }] }] }, s);
    const agenda = buildSessionAgenda(s);
    const item = agenda.find((a) => a.about === "el:attr:opportunity.stagename#valueSet");
    expect(item).toBeDefined();
    expect(item!.framing).toBe("confirm-or-deviate");
    expect(item!.against?.world).toBe("as-is");
    expect(item!.prompt.toLowerCase()).toContain("leaving");
  });
});

describe("2.5 deviation register", () => {
  const devs = buildDeviationRegister(store);
  it("catches a removed entity as an unbacked deviation (User: as-is true vs to-be false)", () => {
    const userDev = devs.find((d) => d.about === "el:removed:user#exists");
    expect(userDev).toBeDefined();
    expect(userDev!.asIs).toBe("true");
    expect(userDev!.toBe).toBe("false");
    expect(userDev!.classification).toBe("unbacked");
  });
  it("flags the removed entity as still-referenced when steps name it (surfaced as an UNVERIFIED name candidate, not a silent join)", () => {
    const userDev = devs.find((d) => d.about === "el:removed:user#exists");
    expect(userDev!.stillReferenced).toBe(true);
    expect(userDev!.stillReferencedVia).toBe("name-candidate-unverified"); // 3d — not a silent name join
  });
});

// deferred-pile read-model fixes (3a–3d), on controlled read models (buildReadModel over raw claim
// arrays, so coexisting claims can be constructed — the DB read model these projections consume).
describe("deviation register — deferred fixes 3a–3d", () => {
  const el = (id: string, kind: LedgerElement["kind"], name: string, of?: string): LedgerElement => ({ id, kind, name, of });
  let n = 0;
  const c = (about: string, value: Claim["value"], world: Claim["world"], source: Claim["source"]): Claim =>
    ({ id: `cl:t${n++}`, about, value, world, layer: "domain", source, status: "weak", ownerWhileOpen: { kind: "role", role: "R" }, contradicts: [] });

  it("3a — catches a picklist(as-is ref-list) vs value-set(to-be ref-list) deviation (ref-list was silently dropped)", () => {
    const rm = buildReadModel([el("el:attr:acct.stage", "attribute", "stage")], [
      c("el:attr:acct.stage#valueSet", { kind: "ref-list", to: ["Prospecting", "Qualification", "Closed"] }, "as-is", "code-derived"),
      c("el:attr:acct.stage#valueSet", { kind: "ref-list", to: ["New", "Working", "Won"] }, "to-be", "external-standard"),
    ]);
    const d = buildDeviationRegister(rm).find((x) => x.about === "el:attr:acct.stage#valueSet");
    expect(d).toBeDefined();                          // before the fix: undefined (ref-list filtered out)
    expect(d!.classification).toBe("document-backed"); // external-standard is backed
  });

  it("3b — surfaces every coexisting to-be value, not an arbitrary [0]", () => {
    const rm = buildReadModel([el("el:attr:x.y", "attribute", "y")], [
      c("el:attr:x.y#foo", { kind: "scalar", value: "A" }, "as-is", "code-derived"),
      c("el:attr:x.y#foo", { kind: "scalar", value: "B" }, "to-be", "asserted"),
      c("el:attr:x.y#foo", { kind: "scalar", value: "C" }, "to-be", "asserted"),
    ]);
    const ds = buildDeviationRegister(rm).filter((x) => x.about === "el:attr:x.y#foo");
    expect(ds.map((x) => x.toBe).sort()).toEqual(["B", "C"]); // both, not one hidden
  });

  it("3c — classification reflects the SPECIFIC claim, not any coexisting document claim on the locus", () => {
    const rm = buildReadModel([el("el:attr:x.z", "attribute", "z")], [
      c("el:attr:x.z#bar", { kind: "scalar", value: "OLD" }, "as-is", "code-derived"),
      c("el:attr:x.z#bar", { kind: "scalar", value: "GEN-NEW" }, "to-be", "generated"),   // truly unbacked
      c("el:attr:x.z#bar", { kind: "scalar", value: "DOC-VAL" }, "to-be", "document"),     // a coexisting backed claim
    ]);
    const ds = buildDeviationRegister(rm).filter((x) => x.about === "el:attr:x.z#bar");
    expect(ds.find((x) => x.toBe === "GEN-NEW")!.classification).toBe("unbacked");        // NOT corrupted to document-backed
    expect(ds.find((x) => x.toBe === "DOC-VAL")!.classification).toBe("document-backed");
  });

  it("3d — stillReferenced is a surfaced, UNVERIFIED name candidate (needs the binder), never a silent join", () => {
    const rm = buildReadModel([el("el:removed:widget", "entity", "Widget"), el("el:step:s1", "step", "do")], [
      c("el:removed:widget#exists", { kind: "scalar", value: true }, "as-is", "code-derived"),
      c("el:removed:widget#exists", { kind: "scalar", value: false }, "to-be", "dispositioned"),
      c("el:step:s1#touches.widget", { kind: "unresolved-ref", name: "Widget", why: "F-C" }, "to-be", "code-derived"),
    ]);
    const d = buildDeviationRegister(rm).find((x) => x.about === "el:removed:widget#exists");
    expect(d!.stillReferenced).toBe(true);
    expect(d!.stillReferencedVia).toBe("name-candidate-unverified");
  });
});
