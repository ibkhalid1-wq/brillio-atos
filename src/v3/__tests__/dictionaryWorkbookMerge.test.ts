/**
 * "UPLOADED 1 OF 3 DICTIONARY FILES AND NOTHING HAPPENED."
 *
 * A real 12-tab Salesforce master workbook (README cover · 01_Master_Field_List ·
 * 02_Keep_Migrate · … · 06_Picklist_Values · validation rules · list views). Four
 * defects stacked, each hiding the next:
 *
 *  D0  `XLSX.read` was handed the raw ArrayBuffer under `type: "array"`, which means
 *      "array of bytes". SheetJS does not throw on that — it returns a workbook with
 *      ONE sheet called "Sheet1" whose content is the file's own ZIP header read as
 *      text ("PK…"). Measured on the real file: 1 sheet via ArrayBuffer,
 *      12 via Uint8Array. Every xlsx dictionary parsed zero fields.
 *
 *  D1  Header matching was exact equality, so the field column — headed "Field API
 *      Name" — matched none of ["field","attribute","column",…] and the parser
 *      returned [] for every sheet.
 *
 *  D2  A per-object workbook has no entity COLUMN; it names its object once, in the
 *      title. Every row parsed with an empty entity, and `dictionaryToClaims` skips
 *      those by design ("a row with no entity can't be keyed to a locus"). A file
 *      full of answers closed nothing.
 *
 *  D3  The dictionary is split across tabs: types on the field list, allowed values
 *      on a picklist tab at one row per value. Picking a single "best" sheet loses
 *      half either way — and picking by row count picked the 442-row picklist tab
 *      over the field list, losing every type.
 *
 * WHY D0's GUARD IS A SOURCE SCAN. It cannot be reproduced with a workbook built in
 * the test: SheetJS's own output survives the wrong input type. Verified both ways
 * — plain and compressed, 24KB and 11KB, ArrayBuffer and Uint8Array all returned
 * the right sheet count. That is exactly how this survived a green suite for
 * months: `fileIngestion.test.ts` proved multi-sheet selection worked, on the only
 * bytes that were never mis-read. So the byte-level contract is pinned at the call
 * site, where it is decided.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  readDictionaryWorkbook, parseDictionaryCsv, entityFromTitle, fieldsToCsv, dictionaryToClaims,
  dictLocusId, dictionaryCoverage,
} from "@/v3/lib/ledger/dictionary";

/** The real workbook's shape: a cover, a field list keyed by API name with no entity
 *  column, and allowed values on their own tab at one row per value. */
function masterWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Acme CRM — Master Workbook - Accounts Object"],
    ["Single source of truth for the Account object migration"],
  ]), "README");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Field API Name", "Label", "Type", "Verdict", "Maps To New Field", "In XML?"],
    ["Account_ID__c", "Account ID", "AutoNumber", "KEEP", "AccountId", "Yes"],
    ["Account_Tier__c", "Account Tier", "Picklist", "KEEP", "AccountTier", "Yes"],
    ["Annual_Revenue__c", "Annual Revenue", "Currency", "KEEP", "AnnualRevenue", "Yes"],
  ]), "01_Master_Field_List");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Release notes"], ["v3 adds the tier picklist"],
  ]), "05_Notes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Field API Name", "Field Label", "Verdict", "Picklist Value", "Default"],
    ["Account_Tier__c", "Account Tier", "KEEP", "Platinum", "false"],
    ["Account_Tier__c", "Account Tier", "KEEP", "Gold", "true"],
    ["Account_Tier__c", "Account Tier", "KEEP", "Silver", "false"],
  ]), "06_Picklist_Values");
  const u8 = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe("[D0] the bytes handed to SheetJS", () => {
  it("the workbook reader converts to a Uint8Array before reading", () => {
    // The contract a behavioural test cannot reach (see the header). If this call
    // ever passes the ArrayBuffer straight through again, every real-world xlsx
    // silently becomes a one-sheet workbook of ZIP bytes and parses nothing.
    const src = readFileSync(resolve(__dirname, "../lib/ledger/dictionary.ts"), "utf8");
    const calls = [...src.matchAll(/XLSX\.read\(([^,]+),/g)].map((m) => m[1].trim());
    expect(calls.length, "no XLSX.read call found — re-anchor this scan").toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg, `XLSX.read got "${arg}" — it must be wrapped in new Uint8Array(...)`)
        .toMatch(/^new Uint8Array\(/);
    }
  });
});

describe("[D1] headers as they are actually written", () => {
  const parse = (header: string[], row: string[]) =>
    parseDictionaryCsv([header.join(","), row.join(",")].join("\n")).fields[0];

  it("REGRESSION: 'Field API Name' is the field column", () => {
    expect(parse(["Field API Name", "Type"], ["Account_ID__c", "Text"]))
      .toMatchObject({ field: "Account_ID__c", dataType: "Text" });
  });

  it("the SPECIFIC alias wins over the general one, wherever the column sits", () => {
    // "Field Label" and "Maps To New Field" both contain "field". The API name is
    // the key; reading the label instead would key every locus to a display string.
    const f = parse(
      ["Label", "Maps To New Field", "Field API Name", "Data Type"],
      ["Account ID", "AccountId", "Account_ID__c", "AutoNumber"],
    );
    expect(f.field).toBe("Account_ID__c");
    expect(f.dataType).toBe("AutoNumber");
  });

  it("a trailing 'field' token never beats a real field column", () => {
    // The claim that matters. "Maps To New Field" is a mapping TARGET, not the key;
    // reading it as the key would mis-address every locus. The prefix pass keeps it
    // out whenever a real column exists — which is the case that occurs.
    const f = parseDictionaryCsv(
      "Maps To New Field,Field API Name,Type\nAccountId,Account_ID__c,Text",
    ).fields[0];
    expect(f.field).toBe("Account_ID__c");
  });

  it("with NO better column, a contains-match is accepted — deliberately", () => {
    // Recorded as a decision, not an accident. The last-resort pass is what reads
    // "Source Field" and "Target Field", which ARE field columns; no rule separates
    // those from "Maps To New Field" by shape alone. The operator is the check: the
    // preview states how many fields parsed and what they closed, and nothing is
    // written until they commit. Parsing nothing would fail the commoner case.
    expect(parseDictionaryCsv("Source Field,Type\nAccount_ID__c,Text").fields[0])
      .toMatchObject({ field: "Account_ID__c" });
  });

  it("the plain headers still work — this widened matching, it did not replace it", () => {
    expect(parse(["Entity", "Field", "Type"], ["Account", "name", "string"]))
      .toMatchObject({ entity: "Account", field: "name", dataType: "string" });
  });
});

describe("[D2] the object a single-object workbook is about", () => {
  it("reads an explicit '<Name> Object' phrase, singularised", () => {
    expect(entityFromTitle("Acme_Master - Accounts Object.xlsx")).toBe("Account");
    expect(entityFromTitle("Opportunity Object")).toBe("Opportunity");
  });

  it("returns null rather than guessing when the phrase is absent", () => {
    expect(entityFromTitle("Q3 export final v2.xlsx")).toBeNull();
    expect(entityFromTitle("")).toBeNull();
  });

  it("REGRESSION: rows with no entity column are keyed, and the source is reported", async () => {
    const r = await readDictionaryWorkbook(masterWorkbook(), "Acme_Master - Accounts Object.xlsx");
    expect(r.entity).toBe("Account");
    expect(r.entityFrom, "where the entity came from must be stated").toBe("the file name");
    expect(parseDictionaryCsv(r.csv).fields.every((f) => f.entity === "Account")).toBe(true);
  });

  it("a derived entity is NOT applied when a sheet names one itself", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Entity", "Field API Name", "Type"], ["Contact", "Email__c", "Email"],
    ]), "Fields");
    const u8 = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const r = await readDictionaryWorkbook(
      u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer,
      "Acme - Accounts Object.xlsx",
    );
    expect(r.entityFrom, "the file name overrode what the sheet stated").toBeNull();
    expect(parseDictionaryCsv(r.csv).fields[0].entity).toBe("Contact");
  });
});

describe("[D3] every sheet, merged", () => {
  it("REGRESSION: types come from the field list AND values from the picklist tab", async () => {
    const r = await readDictionaryWorkbook(masterWorkbook(), "Acme - Accounts Object.xlsx");
    const fields = parseDictionaryCsv(r.csv).fields;
    const tier = fields.find((f) => f.field === "Account_Tier__c")!;
    expect(tier, "the field list did not contribute").toBeTruthy();
    expect(tier.dataType, "the type was lost — the picklist tab won the pick").toBe("Picklist");
    expect(tier.valueSet, "the values were lost — one sheet was chosen").toEqual(["Platinum", "Gold", "Silver"]);
  });

  it("one row per value becomes one field with many values", async () => {
    const r = await readDictionaryWorkbook(masterWorkbook(), "Acme - Accounts Object.xlsx");
    const fields = parseDictionaryCsv(r.csv).fields;
    expect(fields.filter((f) => f.field === "Account_Tier__c")).toHaveLength(1);
  });

  it("sheets that carry no dictionary are named, not silently dropped", async () => {
    const r = await readDictionaryWorkbook(masterWorkbook(), "Acme - Accounts Object.xlsx");
    expect(r.used).toEqual(["01_Master_Field_List", "06_Picklist_Values"]);
    expect(r.skipped).toEqual(["README", "05_Notes"]);
    expect(r.sheets).toHaveLength(4);
  });

  it("the merged CSV re-parses to exactly what was previewed", async () => {
    // What is stored is the normalized CSV, and the count shown before committing
    // has to be the count that lands.
    const r = await readDictionaryWorkbook(masterWorkbook(), "Acme - Accounts Object.xlsx");
    expect(parseDictionaryCsv(r.csv).fields).toHaveLength(r.fields);
    expect(fieldsToCsv(parseDictionaryCsv(r.csv).fields)).toBe(r.csv);
  });

  it("and the result actually reaches the ledger as claims", async () => {
    const r = await readDictionaryWorkbook(masterWorkbook(), "Acme - Accounts Object.xlsx");
    const { batch } = dictionaryToClaims(parseDictionaryCsv(r.csv, "d"), new Set());
    const slots = batch.map((b) => b.about.split("#")[1]);
    expect(slots, "no type claim reached the ledger").toContain("dataType");
    expect(slots, "no value-set claim reached the ledger").toContain("valueSet");
    expect(batch.every((b) => b.about.startsWith("el:attr:account."))).toBe(true);
  });
});

/**
 * D4 — THE HEADER IS NOT ALWAYS ROW 1, AND A FIELD COLUMN IS NOT A DICTIONARY.
 *
 * The second workbook uploaded that day leads every sheet with a title row
 * ("Recommended Opportunity Schema — 130 Essential Fields") and puts the real
 * header under it; one sheet has a note as well, putting it on row 3. Reading row 1
 * unconditionally found no field column and returned nothing for all seven sheets.
 *
 * Scanning for a header made that work and immediately over-reached: a lone field
 * column pulled in the first workbook's Validation Rules ("Rule Name"), its Web
 * Links (whose values are URLs) and its List Views (whose cells hold a whole
 * comma-joined column set) — about eighty attributes invented from three tabs that
 * describe the object's UI, not its data. Both guards are held here.
 */
describe("[D4] finding the header, and knowing a dictionary from a list", () => {
  const csv = (lines: string[]) => lines.join("\n");

  it("REGRESSION: a title row above the header does not hide the dictionary", () => {
    const d = parseDictionaryCsv(csv([
      "Recommended Opportunity Schema for Agentic CRM — 130 Essential Fields,,,",
      "#,Category,API Name (existing),Data Type",
      "1,Core Standard,AccountId,Lookup",
    ]));
    expect(d.fields).toHaveLength(1);
    expect(d.fields[0]).toMatchObject({ field: "AccountId", dataType: "Lookup" });
  });

  it("a title AND a note above the header still resolves", () => {
    const d = parseDictionaryCsv(csv([
      "Key Picklist Values to Carry Over,",
      "Picklist values are the business taxonomy. Review with RevOps before commit.,",
      "Field,Canonical Values",
      "StageName,Suspect | Qualified | Closed Won",
    ]));
    expect(d.fields[0]).toMatchObject({ field: "StageName", valueSet: ["Suspect", "Qualified", "Closed Won"] });
  });

  it("REGRESSION: a field column ALONE is not a dictionary sheet", () => {
    // A validation-rules tab: names a thing, says nothing about a field's data.
    expect(parseDictionaryCsv(csv([
      "Rule Name,Description,Error Message",
      "Removed user Ids,Blocks removed users,You cannot do that",
    ])).fields).toHaveLength(0);
  });

  it("it IS a dictionary once the header says something about the field", () => {
    expect(parseDictionaryCsv(csv([
      "Rule Name,Data Type", "Removed user Ids,Text",
    ])).fields).toHaveLength(1);
  });

  it("REGRESSION: a comma-joined column set is not a field name", () => {
    // The List Views tab: one cell holds a whole view's column list.
    expect(parseDictionaryCsv(csv([
      "Columns,Data Type",
      '"Account_ID__c, ACCOUNT.NAME, ACCOUNT.TYPE",Text',
    ])).fields).toHaveLength(0);
  });

  it("REGRESSION: a URL is not a field name", () => {
    expect(parseDictionaryCsv(csv([
      "Field API Name,Data Type", "/apex/CloneListPage?source=Account,Text",
    ])).fields).toHaveLength(0);
  });

  it("ordinary field names are untouched by those guards", () => {
    const d = parseDictionaryCsv(csv([
      "Field API Name,Data Type", "Account_ID__c,AutoNumber", "annual revenue,Currency",
    ]));
    expect(d.fields.map((f) => f.field)).toEqual(["Account_ID__c", "annual revenue"]);
  });

  it("a spreadsheet that is not a dictionary at all yields nothing", async () => {
    // A revenue report read as a dictionary would invent attributes from its columns.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Region", "Q1", "Q2", "Q3"], ["EMEA", 120, 130, 140],
    ]), "Revenue Data");
    const u8 = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const r = await readDictionaryWorkbook(
      u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer,
      "FY2026_Revenue.xlsx",
    );
    expect(r.fields).toBe(0);
    expect(r.csv).toBe("");
  });
});

/**
 * D5 — THE DICTIONARY AND THE ONTOLOGY NAME THE SAME FIELD DIFFERENTLY.
 *
 * With every parsing defect fixed, the Opportunity workbook read 434 fields and
 * matched ZERO of 63 open typing questions. Both sides were right and neither
 * could see the other: a Salesforce export keys on `StageName`, `Name`,
 * `CloseDate`; the ontology was written from how the business talks, so it holds
 * `stage`, `opportunity name`, `expected close date`.
 *
 * The bridge is stated IN the file — these workbooks carry the label beside the
 * API name — so a row binds to whichever of its two names the ontology modelled.
 * No fuzzy match, no stemming: a label that names nothing changes nothing, and
 * "TCV" still does not become "value".
 *
 * And the DENOMINATOR was the second half of the same problem. "0 of 63" was true
 * and useless: 59 of those were on Lead, Campaign and Account, which an
 * Opportunity-only export never claimed to answer.
 */
describe("[D5] binding a dictionary row to the locus it answers", () => {
  const f = (over: Partial<Parameters<typeof dictLocusId>[0]>) =>
    ({ entity: "Opportunity", field: "StageName", ...over }) as Parameters<typeof dictLocusId>[0];

  it("REGRESSION: the label binds when the ontology modelled the label", () => {
    const open = new Set(["el:attr:opportunity.stage"]);
    expect(dictLocusId(f({ label: "Stage" }), open)).toBe("el:attr:opportunity.stage");
  });

  it("the API name wins when the ontology modelled THAT", () => {
    const open = new Set(["el:attr:opportunity.stagename", "el:attr:opportunity.stage"]);
    expect(dictLocusId(f({ label: "Stage" }), open)).toBe("el:attr:opportunity.stagename");
  });

  it("neither modelled → the API name, because that is the system's real key", () => {
    expect(dictLocusId(f({ label: "Stage" }), new Set())).toBe("el:attr:opportunity.stagename");
    expect(dictLocusId(f({ label: "Stage" }))).toBe("el:attr:opportunity.stagename");
  });

  it("a label that names nothing changes nothing — no fuzzy match", () => {
    // "TCV" is the label on `Amount`; the ontology says "value". They stay apart.
    const open = new Set(["el:attr:opportunity.value"]);
    expect(dictLocusId(f({ field: "Amount", label: "TCV" }), open)).toBe("el:attr:opportunity.amount");
  });

  it("the label is parsed, and a label equal to the field is not stored", () => {
    const rows = parseDictionaryCsv([
      "API Name (existing),Recommended Label,Data Type",
      "StageName,Stage,Picklist",
      "Amount,Amount,Currency",
    ].join("\n")).fields;
    expect(rows[0]).toMatchObject({ field: "StageName", label: "Stage" });
    expect(rows[1].label, "a label identical to the field is noise").toBeUndefined();
  });

  it("the label survives the merged CSV round trip", () => {
    const back = parseDictionaryCsv(fieldsToCsv([
      { entity: "Opportunity", field: "StageName", label: "Stage", dataType: "Picklist" },
    ]));
    expect(back.fields[0]).toMatchObject({ field: "StageName", label: "Stage" });
  });
});

describe("[D5] the denominator is what the file covers", () => {
  const fields = [
    { entity: "Opportunity", field: "StageName", label: "Stage" },
    { entity: "Opportunity", field: "Amount", label: "TCV" },
  ];
  const open = new Set([
    "el:attr:opportunity.stage", "el:attr:opportunity.value",
    "el:attr:lead.status", "el:attr:campaign.channel",
  ]);

  it("REGRESSION: questions on entities the file never names are not its misses", () => {
    const c = dictionaryCoverage(fields, open);
    expect(c.entities).toEqual(["Opportunity"]);
    expect(c.inScope, "Opportunity has two open questions").toBe(2);
    expect(c.matched, "Stage matched through its label").toBe(1);
    expect(c.outside, "Lead and Campaign are outside this file's scope").toBe(2);
  });

  it("a dictionary covering several entities scopes to all of them", () => {
    const c = dictionaryCoverage([...fields, { entity: "Lead", field: "status" }], open);
    expect(c.entities).toEqual(["Opportunity", "Lead"]);
    expect(c.inScope).toBe(3);
    expect(c.matched).toBe(2);
    expect(c.outside).toBe(1);
  });

  it("counts loci, not rows — two rows on one locus are one match", () => {
    const c = dictionaryCoverage(
      [{ entity: "Opportunity", field: "stage" }, { entity: "Opportunity", field: "Stage" }],
      new Set(["el:attr:opportunity.stage"]),
    );
    expect(c.matched).toBe(1);
  });
});
