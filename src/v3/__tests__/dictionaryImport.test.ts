/**
 * The data-dictionary import: parser + adapter + reconcile-close + confirm-or-deviate.
 * Proven against the migrated Laila ledger (the CRM domain with no standard).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { reconcile } from "@/v3/lib/ledger/merge";
import { parseDictionaryCsv, dictionaryToClaims, TYPING_SLOTS, type ParsedDictionary } from "@/v3/lib/ledger/dictionary";
import { isLive, slotOf } from "@/v3/lib/ledger/types";
import type { LedgerStore } from "@/v3/lib/ledger/store";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const snapshot: Snapshot = { ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") };
const typingOpen = (store: LedgerStore) => store.claims().filter((c) => isLive(c) && c.status === "open" && TYPING_SLOTS.has(slotOf(c.about))).length;
const applyDict = (store: LedgerStore, dict: ParsedDictionary) => {
  const { batch, elements } = dictionaryToClaims(dict, new Set(store.elements().map((e) => e.id)));
  for (const e of elements) store.addElement(e);
  return reconcile(store, batch, new Set(store.elements().map((e) => e.id)));
};

describe("data-dictionary parser", () => {
  it("parses a CSV dictionary; emits a claim only where a value is STATED (no fabrication)", () => {
    const csv = ["Entity,Field,Type,Values,Required",
      "Opportunity,Stage,picklist,Prospecting|Won|Lost,yes",
      "Opportunity,Amount,currency,,yes",
      "Opportunity,Notes,,,"].join("\n"); // Notes has no type → must stay ?unknown
    const d = parseDictionaryCsv(csv, "sf");
    expect(d.fields).toHaveLength(3);
    expect(d.fields[0]).toMatchObject({ entity: "Opportunity", field: "Stage", dataType: "picklist", required: true });
    expect(d.fields[0].valueSet).toEqual(["Prospecting", "Won", "Lost"]);
    expect(d.fields[1].valueSet).toBeUndefined();       // no values stated
    expect(d.fields[2].dataType).toBeUndefined();       // silence → no claim, stays ?unknown
  });
  it("returns no fields for an unrecognisable header (never guesses a shape)", () => {
    expect(parseDictionaryCsv("foo,bar\n1,2").fields).toHaveLength(0);
  });
});

describe("data-dictionary → reconcile closes the typing wall", () => {
  it("fills dataType/valueSet unknowns as code-derived, dropping the typing count", () => {
    const store = migrate(snapshot);
    const before = typingOpen(store);
    expect(before).toBeGreaterThan(100);                 // Laila's wall is large
    // a Salesforce dictionary covering the org's own fields
    const nameOf = new Map(store.elements().map((e) => [e.id, e.name] as const));
    const fields = store.elements().filter((e) => e.kind === "attribute" && e.of).map((a) => ({
      entity: nameOf.get(a.of!) ?? "", field: a.name,
      dataType: /stage|status|type|severity/i.test(a.name) ? "picklist" : "text",
      valueSet: /stage|status|type|severity/i.test(a.name) ? ["Open", "Closed"] : undefined,
    }));
    const rep = applyDict(store, { name: "sf-dict", fields });
    expect(rep.filledUnknowns).toBeGreaterThan(100);
    const after = typingOpen(store);
    expect(after).toBeLessThan(before);                  // the wall shrank
    // dataType specifically → all closed
    const openDataType = store.claims().filter((c) => isLive(c) && c.status === "open" && slotOf(c.about) === "dataType").length;
    expect(openDataType).toBe(0);
  });
  it("confirm-or-deviate: a stakeholder assertion beats the dictionary's code-derived claim", () => {
    const store = migrate(snapshot);
    const nameOf = new Map(store.elements().map((e) => [e.id, e.name] as const));
    const fields = store.elements().filter((e) => e.kind === "attribute" && e.of).map((a) => ({ entity: nameOf.get(a.of!) ?? "", field: a.name, dataType: "text" }));
    applyDict(store, { name: "sf-dict", fields });
    const dictClaim = store.claims().find((c) => isLive(c) && slotOf(c.about) === "dataType" && c.source === "code-derived");
    expect(dictClaim).toBeTruthy();
    store.assert({ about: dictClaim!.about, value: { kind: "scalar", value: "LOCAL-scale" }, source: "asserted", world: "to-be", layer: "configuration", ownerWhileOpen: { kind: "role", role: "Sales Leaders" }, status: "closed", closedBy: { method: "assertion", by: "Sales Lead" } });
    const live = store.liveClaimsAbout(dictClaim!.about).filter(isLive);
    expect(live.some((c) => c.source === "asserted")).toBe(true);
    expect(live.some((c) => c.source === "code-derived")).toBe(false); // dictionary superseded by the human answer
  });
});
