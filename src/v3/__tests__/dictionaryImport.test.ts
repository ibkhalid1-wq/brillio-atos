/**
 * The data-dictionary import: parser + adapter + reconcile-close + confirm-or-deviate.
 * Proven against the migrated Laila ledger (the CRM domain with no standard).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { reconcile } from "@/v3/lib/ledger/merge";
import {
  parseDictionaryCsv, dictionaryToClaims, TYPING_SLOTS,
  readDictionarySources, writeDictionaryField, pickDictionarySheet, isSpreadsheetName,
  type ParsedDictionary,
} from "@/v3/lib/ledger/dictionary";
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

/**
 * ONE FIELD, ONE OR MANY UPLOADS — `_dataDictionary` accepts a keyed map ADDITIVELY.
 * The whole point is that nothing already stored changes shape or stops working: a
 * plain CSV string stays valid and reads as the programme-wide dictionary, and the
 * keyed form appears only once a per-SoR upload actually happens.
 */
describe("the dictionary field: keyed per SoR, additively", () => {
  const csv = ["Entity,Field,Type", "Case,Status,picklist"].join("\n");
  const csv2 = ["Entity,Field,Type", "Invoice,Amount,currency"].join("\n");

  it("BACKWARD COMPATIBLE: the legacy plain CSV reads as the ONE programme-wide dictionary", () => {
    const sources = readDictionarySources(csv);
    expect(sources).toHaveLength(1);
    expect(sources[0].sor).toBeNull();
    expect(sources[0].dict.fields).toHaveLength(1);
  });

  it("BACKWARD COMPATIBLE: a pre-parsed {name,fields} doc still reads, and is not mistaken for a keyed map", () => {
    const sources = readDictionarySources({ name: "sf", fields: [{ entity: "Case", field: "Status" }] });
    expect(sources).toHaveLength(1);
    expect(sources[0].sor).toBeNull();
    expect(sources[0].dict.name).toBe("sf");
  });

  it("a keyed map yields one source per system, the reserved '*' key being the global one", () => {
    const stored = JSON.stringify({ EHR: csv, Billing: csv2, "*": csv });
    const sources = readDictionarySources(stored);
    expect(sources.map((s) => s.sor)).toEqual(["EHR", "Billing", null]);
    expect(sources[1].dict.fields[0]).toMatchObject({ entity: "Invoice", field: "Amount" });
  });

  it("nothing on file, or unreadable, is [] — never a guessed shape", () => {
    expect(readDictionarySources(undefined)).toEqual([]);
    expect(readDictionarySources("")).toEqual([]);
    expect(readDictionarySources("   ")).toEqual([]);
    expect(readDictionarySources(42)).toEqual([]);
  });

  it("a global write on a programme with no keyed uploads keeps the PLAIN CSV shape (no forced migration)", () => {
    expect(writeDictionaryField(undefined, csv)).toBe(csv);
    expect(writeDictionaryField(csv, csv2)).toBe(csv2);
  });

  it("a per-SoR write keys the field and PRESERVES what was already on file", () => {
    const first = writeDictionaryField(csv, csv2, "Billing");     // legacy CSV becomes the global entry
    expect(readDictionarySources(first).map((s) => s.sor)).toEqual([null, "Billing"]);
    const second = writeDictionaryField(first, csv, "EHR");       // and the Billing one survives
    expect(readDictionarySources(second).map((s) => s.sor)).toEqual([null, "Billing", "EHR"]);
    expect(readDictionarySources(second).find((s) => s.sor === "Billing")!.dict.fields[0].entity).toBe("Invoice");
  });

  it("re-uploading for a system REPLACES its dictionary — case-insensitively, never a second entry", () => {
    const once = writeDictionaryField(undefined, csv, "CRM");
    const twice = writeDictionaryField(once, csv2, "crm");
    const sources = readDictionarySources(twice);
    expect(sources).toHaveLength(1);
    expect(sources[0].sor).toBe("CRM");                            // the first spelling is kept
    expect(sources[0].dict.fields[0].entity).toBe("Invoice");      // with the new content
  });

  it("a per-SoR dictionary reconciles into the store exactly like the global one (same path, same claims)", () => {
    const store = migrate(snapshot);
    const before = typingOpen(store);
    const source = readDictionarySources(writeDictionaryField(undefined, [
      "Entity,Field,Type", "Opportunity,Stage,picklist",
    ].join("\n"), "CRM"))[0];
    expect(source.sor).toBe("CRM");
    applyDict(store, source.dict);
    expect(typingOpen(store)).toBeLessThan(before);
  });
});

// ── spreadsheet uploads — the promise the Inbox was already making ──────────────────
/**
 * `OperatorInbox.tsx` told the operator "CSV/XLSX dictionaries parse now" while the file
 * input accepted `.csv,.tsv,.txt`, and `xlsx` sat in package.json with ZERO importers.
 * An operator exporting from Salesforce — where XLSX is the default — was told it worked
 * and then could not select the file. These build real workbooks and read them back.
 */
describe("spreadsheet dictionaries", () => {
  const wb = async (sheets: Record<string, string[][]>): Promise<ArrayBuffer> => {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    }
    return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  };
  const DICT = [
    ["Entity", "Field", "Type", "Values", "Required"],
    ["Account", "isClientOrPartner", "picklist", "client;partner", "yes"],
    ["Account", "region", "text", "", "no"],
  ];

  it("an .xlsx export parses through the SAME parser as a .csv one", async () => {
    const picked = await pickDictionarySheet(await wb({ Dictionary: DICT }));
    expect(picked.sheet).toBe("Dictionary");
    const parsed = parseDictionaryCsv(picked.csv, "export");
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0]).toMatchObject({ entity: "Account", field: "isClientOrPartner" });
  });

  it("a cover sheet does not win — the sheet that PARSES is chosen, not sheet zero", () => {
    // This is the real shape of an export: notes first, data second. Taking
    // SheetNames[0] would parse zero fields and report "nothing matches", which reads
    // as a data problem rather than the wrong sheet.
    return wb({
      "Read me": [["Exported 2026-08-10"], ["Confidential"]],
      "Data Dictionary": DICT,
    }).then(async (bytes) => {
      const picked = await pickDictionarySheet(bytes);
      expect(picked.sheet).toBe("Data Dictionary");
      expect(picked.sheets).toEqual(["Read me", "Data Dictionary"]);
      expect(parseDictionaryCsv(picked.csv, "x").fields).toHaveLength(2);
    });
  });

  it("when NOTHING parses, a named sheet comes back — never an unexplained blank", async () => {
    const picked = await pickDictionarySheet(await wb({ Notes: [["just prose"]] }));
    expect(picked.sheet).toBe("Notes");                    // the operator can go and look
    expect(parseDictionaryCsv(picked.csv, "x").fields).toEqual([]);
  });

  it("extension detection covers the formats the input accepts, and nothing else", () => {
    for (const n of ["a.xlsx", "A.XLSX", "b.xlsm", "c.xlsb", "d.xls"]) expect(isSpreadsheetName(n)).toBe(true);
    for (const n of ["a.csv", "b.tsv", "c.txt", "d.xlsx.csv"]) expect(isSpreadsheetName(n)).toBe(false);
  });
});
