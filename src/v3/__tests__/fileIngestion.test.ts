/**
 * FILE INGESTION — does Aura actually read what an operator attaches?
 *
 * Two independent ingest paths, both exercised here against REAL bytes built in
 * this file (no mocks of the parsers, no assertions on accept-list strings — an
 * accept list proves nothing about whether the bytes parse):
 *
 *   1. EVIDENCE ATTACHMENT (edge) — `_shared/extractText.ts`, called by
 *      flow-extract and flow-portal. Three routes: decode / office-xml / model.
 *      The model route is stubbed at `claudeClient` so we assert the BRANCH and
 *      the attachment PAYLOAD SHAPE without a network call.
 *   2. DATA-DICTIONARY UPLOAD (client) — `ledger/dictionary.ts`,
 *      `pickDictionarySheet` (workbooks) and `parseDictionaryCsv` (delimited).
 *
 * The defect being hunted is the SILENT EMPTY: a file that neither extracts nor
 * fails visibly. Every case below asserts one or the other, and the observed
 * outcome is recorded in RESULTS so the run prints a coverage table.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import { parseDictionaryCsv, pickDictionarySheet, isSpreadsheetName, SPREADSHEET_EXTENSIONS } from "@/v3/lib/ledger/dictionary";
import { loadExtractText, loadClaudeClient } from "./helpers/edgeModules";

/**
 * The model route is STUBBED at `claudeClient.completeClaudeText` — a spy, not a
 * `vi.mock` factory (this repo pins vitest 0.34.6, where `vi.hoisted` does not
 * exist). Nothing here reaches a network or a provider key; every Deno.env read
 * in `claudeClient` sits inside the function bodies the spy replaces.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;
const calls: AnyRec[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractDocumentText: (b: Uint8Array, s: string, m: string, f: string, n: number) => Promise<any>;
let modelReply = "MODEL TRANSCRIPT\nrow one\nrow two";

beforeAll(async () => {
  const client = await loadClaudeClient();
  vi.spyOn(client, "completeClaudeText").mockImplementation((async (options: AnyRec) => {
    calls.push(options);
    return { text: modelReply };
  }) as never);
  ({ extractDocumentText } = await loadExtractText());
});
beforeEach(() => {
  calls.length = 0;
  modelReply = "MODEL TRANSCRIPT\nrow one\nrow two";
});

// ── result table ────────────────────────────────────────────────────────────
type Route = "text" | "office" | "model" | "heuristic" | "rejected" | "client-workbook" | "client-csv";
type Outcome = "extracted" | "failed-visibly" | "SILENTLY EMPTY" | "WRONG CONTENT";
const RESULTS: Array<{ file: string; route: Route; outcome: Outcome; detail: string }> = [];
const record = (file: string, route: Route, outcome: Outcome, detail: string) =>
  RESULTS.push({ file, route, outcome, detail });

/** Classify an edge result and assert the never-silent rule in one place. */
function judge(file: string, route: Route, res: { text?: string; method?: string; error?: string; status?: number }) {
  if ("error" in res && res.error) {
    expect(typeof res.error).toBe("string");
    expect(res.error.length).toBeGreaterThan(10);          // an operator-readable reason
    expect(res.status).toBeGreaterThanOrEqual(400);        // and a real failure status
    record(file, route, "failed-visibly", `${res.status} — ${res.error}`);
    return;
  }
  const text = res.text ?? "";
  // THE RULE: a success must carry content. An ok-with-empty-text is the defect.
  expect(text.length).toBeGreaterThan(0);
  record(file, route, "extracted", `${text.length} chars via ${res.method}`);
}

const MAX = 60_000;
/**
 * Base64 via Node's Buffer, NOT `btoa`. Under this repo's vitest 0.34.6 + jsdom
 * environment `globalThis.btoa` never returns — it spins forever on even an
 * 11-character string, silently wedging the whole run. (The edge function runs
 * on Deno, whose native `btoa` is fine; this is purely a test-harness hazard.)
 */
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const utf8 = (s: string) => new TextEncoder().encode(s);
const run = (bytes: Uint8Array, mime: string, filename: string) =>
  extractDocumentText(bytes, b64(bytes), mime, filename, MAX);

// ── fixture builders (real containers, not stubs) ───────────────────────────
const DOCX_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${DOCX_NS}><w:body>${body}</w:body></w:document>`),
  });
}
function makePptx(slides: string[][]): Uint8Array {
  const files: Record<string, Uint8Array> = { "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>') };
  slides.forEach((lines, i) => {
    const paras = lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("");
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><p:sld xmlns:a="a"><p:cSld>${paras}</p:cSld></p:sld>`);
  });
  return zipSync(files);
}
/**
 * The multi-tab workbook every real export looks like: cover first, table later.
 *
 * `bookSST` matters enormously for the EDGE path and for nothing else. Microsoft
 * Excel pools every string into `xl/sharedStrings.xml` (bookSST-shaped); SheetJS,
 * many BI exporters and most ODS→XLSX converters instead write strings INLINE in
 * the sheet XML and emit no sharedStrings part at all. `officeText` reads only
 * `xl/sharedStrings.xml`, so the two shapes take visibly different outcomes.
 */
function makeMultiTabWorkbook(bookType: XLSX.BookType = "xlsx", bookSST = false): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Acme CRM — Data Dictionary Export"], ["Generated"], ["2026-08-11"], ["Confidential"],
  ]), "Cover");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Release notes"], ["v3 adds the consent flags"],
  ]), "Notes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Entity", "Field", "Type", "Allowed Values", "Required", "Max Length"],
    ["Account", "account_name", "string", "", "Yes", 255],
    ["Account", "status", "code", "Active|Churned|Prospect", "Yes", 12],
    ["Account", "arr", "number", "", "No", 18],
    ["Contact", "email", "email", "", "Yes", 320],
    ["Contact", "consent_flag", "boolean", "true|false", "No", 5],
  ]), "Field Dictionary");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType, bookSST }));
}

// ════════════════════════════════════════════════════════════════════════════
describe("edge attachment — text route", () => {
  const cases: Array<[string, string, string]> = [
    ["notes.txt", "text/plain", "Kickoff notes\nSponsor wants the CRM merged by Q3."],
    ["spec.md", "text/markdown", "# Spec\n\n- one\n- two"],
    ["rows.csv", "text/csv", "entity,field,type\nAccount,name,string\nAccount,arr,number"],
    ["rows.tsv", "", "entity\tfield\ttype\nAccount\tname\tstring"],
    ["payload.json", "application/json", '{"entity":"Account","fields":["name","arr"]}'],
    ["export.xml", "application/xml", "<dict><field name=\"arr\" type=\"number\"/></dict>"],
    ["page.html", "text/html", "<html><body><h1>Field dictionary</h1><table><tr><td>arr</td></tr></table></body></html>"],
    ["page.htm", "", "<html><body>legacy extension</body></html>"],
    ["run.log", "", "2026-08-11 INFO ingest ok"],
    ["conf.yaml", "", "entity: Account\nfields:\n  - arr"],
  ];
  it.each(cases)("%s extracts", async (name, mime, body) => {
    const res = await run(utf8(body), mime, name);
    judge(name, "text", res);
    expect(res.method).toBe("decoded");
    expect(res.text).toContain(body.split("\n")[0].slice(0, 12));
  });

  it("a unicode filename does not break routing", async () => {
    const name = "données_répertoire_测试_🗂.csv";
    const res = await run(utf8("entity,field\nCompte,nom"), "text/csv", name);
    judge(name, "text", res);
    expect(res.text).toContain("Compte");
  });

  it("a very large text file is capped, not dropped", async () => {
    const big = "entity,field,type\n" + "Account,f,string\n".repeat(400_000); // ~6.8MB
    expect(big.length).toBeGreaterThan(6_000_000);
    const res = await extractDocumentText(utf8(big), "", "text/csv", "huge.csv", MAX);
    // Assert on lengths/booleans only — never let vitest diff a multi-MB string.
    expect(res.error).toBeUndefined();
    expect(res.text.length).toBe(MAX);           // capped at maxChars, never truncated to nothing
    expect(res.text.startsWith("entity,field,type")).toBe(true);
    record("huge.csv (6.8MB)", "text", "extracted", `capped to ${MAX} chars via ${res.method}`);
  });
});

describe("edge attachment — office route", () => {
  it("docx: paragraphs survive as lines", async () => {
    const bytes = makeDocx(["Programme charter", "The sponsor is Dana Reyes.", "Go-live is 2026-11-02."]);
    const res = await run(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "charter.docx");
    judge("charter.docx", "office", res);
    expect(res.method).toBe("office-xml");
    expect(res.text.split("\n").length).toBe(3);
    expect(res.text).toContain("Dana Reyes");
  });

  it("pptx: every slide contributes", async () => {
    const bytes = makePptx([["Vision", "One customer record"], ["Risks", "Duplicate accounts"]]);
    const res = await run(bytes, "", "deck.pptx");
    judge("deck.pptx", "office", res);
    expect(res.text).toContain("One customer record");
    expect(res.text).toContain("Duplicate accounts");
  });

  /**
   * FINDING E1 — an Excel-shaped workbook (shared string table) extracts to an
   * UNUSABLE blob. `officeText` reads ONLY `xl/sharedStrings.xml`, which is the
   * deduplicated string POOL: no sheet names attached to values, no rows, no
   * columns, and NO NUMBERS (numeric cells live in the sheet XML). Worse, the
   * pool contains no `</row>` element, so the paragraph splitter finds a single
   * part and joins every string with the EMPTY separator — one glued line.
   */
  it("xlsx multi-tab (Excel-shaped, shared strings): extracts a glued, deduplicated, number-free blob", async () => {
    const bytes = makeMultiTabWorkbook("xlsx", true);
    const res = await run(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "dictionary.xlsx");
    judge("dictionary.xlsx (3 tabs, SST)", "office", res);

    expect(res.text).toContain("account_name");                  // strings do come through…
    for (const n of ["255", "320", "12"]) expect(res.text).not.toContain(n);  // …numbers do not
    expect(res.text.split("\n").length).toBe(1);                // ONE glued line for the whole book
    expect(res.text).toContain("EntityFieldType");               // adjacent header cells run together
    expect(res.text).toContain("Acme CRM");                      // cover-sheet prose merged with the table
    // Deduplicated: "Account" is the entity on THREE rows but appears once, so
    // row structure and row counts are unrecoverable from the extraction.
    expect((res.text.match(/Account(?!_)/g) ?? []).length).toBe(1);
    RESULTS[RESULTS.length - 1].outcome = "WRONG CONTENT";
    RESULTS[RESULTS.length - 1].detail += " — 1 glued line, numbers dropped, strings deduped, no sheet attribution";
  });

  /**
   * FINDING E2 — an inline-string workbook (SheetJS, many BI exporters, ODS→XLSX
   * converters) has NO `xl/sharedStrings.xml`. `officeText` therefore reads
   * nothing at all and the caller is told the document contains no text — while
   * `pickDictionarySheet` reads the very same bytes perfectly (see the client
   * suite below). The failure is visible, but the message is a lie.
   */
  it("xlsx multi-tab (inline strings, no SST): extracts NOTHING and reports 'no readable text'", async () => {
    const bytes = makeMultiTabWorkbook("xlsx", false);
    const res = await run(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "inline.xlsx");
    expect(res.text).toBeUndefined();
    expect(res.status).toBe(422);
    expect(res.error).toBe("No readable text found inside the document.");
    judge("inline.xlsx (3 tabs, no SST)", "office", res);
    RESULTS[RESULTS.length - 1].detail += " — but the SAME bytes parse to 5 fields on the client path";
  });

  it("xlsx with ONLY numeric cells extracts nothing — visible, and arguably correct", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1, 2, 3], [4, 5, 6]]), "Sheet1");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", bookSST: true }));
    const res = await run(bytes, "", "numbers.xlsx");
    expect(res.status).toBe(422);
    judge("numbers-only.xlsx", "office", res);
  });

  /**
   * FINDING H1 — THE FALLBACK HEURISTIC LAUNDERS BINARY INTO "TEXT".
   *
   * `.xlsm` is not in OFFICE_EXTS, so with an empty mime the workbook falls to
   * the trailing salvage branch. That branch strips the class
   * `[^ \x20-\x7E \s \u00a0-\uffff ]` (spaces added here only for legibility)
   * and accepts anything ≥90% "printable" — but decoding arbitrary bytes as UTF-8
   * yields U+FFFD replacement characters, and U+FFFD sits INSIDE the kept
   * \u00a0 to \uffff range.
   * So the filter removes almost nothing, the ratio passes, and 19 KB of zip
   * garbage is returned as `{ method: "decoded" }` — a confident success over
   * content that is not the document. Any binary above the 40-char floor lands
   * here; only tiny ones (like the 8-byte .dwg below) are correctly refused.
   */
  it("xlsm with an empty mime is 'salvaged' into replacement-character garbage", async () => {
    const bytes = makeMultiTabWorkbook("xlsm", true);
    const res = await run(bytes, "", "macro.xlsm");
    expect(res.method).toBe("decoded");                 // NOT office-xml, NOT rejected
    expect(res.error).toBeUndefined();
    expect(res.text.length).toBeGreaterThan(10_000);
    // The proof it is container bytes, not document text: it opens with the ZIP
    // local-file signature and carries internal OOXML part paths, and half of it
    // is non-ASCII mojibake from decoding deflate streams as UTF-8.
    expect(res.text.startsWith("PK")).toBe(true);               // ZIP local-file signature
    expect(res.text).toContain("xl/_rels/workbook.xml.rels");    // internal OOXML part paths
    expect(res.text).toContain("[Content_Types].xml");
    expect(res.text).toContain("�");                        // decode damage, not prose
    judge("macro.xlsm (mime empty)", "heuristic", res);
    RESULTS[RESULTS.length - 1].outcome = "WRONG CONTENT";
    RESULTS[RESULTS.length - 1].detail += " — raw ZIP container bytes, not cell values";
  });

  it("xlsm WITH the browser-supplied mime does reach the office route", async () => {
    const bytes = makeMultiTabWorkbook("xlsm", true);
    const res = await run(bytes, "application/vnd.ms-excel.sheet.macroEnabled.12", "macro.xlsm");
    judge("macro.xlsm (mime=ms-excel…)", "office", res);
    expect(res.method).toBe("office-xml");
  });

  it("legacy .doc (binary, not a zip) fails visibly on both mime spellings", async () => {
    // A real .doc is an OLE2/CFB compound file — magic D0 CF 11 E0.
    const cfb = new Uint8Array(4096);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    cfb.fill(0x00, 8);
    const withMime = await run(cfb, "application/msword", "charter.doc");
    expect(withMime.error).toBeTruthy();
    judge("charter.doc (mime=msword)", "office", withMime);
    const noMime = await run(cfb, "", "charter.doc");
    expect(noMime.error).toBeTruthy();
    judge("charter.doc (mime empty)", "rejected", noMime);
  });

  it("legacy .xls (BIFF8) fails visibly on the edge", async () => {
    const bytes = makeMultiTabWorkbook("xls");
    const res = await run(bytes, "application/vnd.ms-excel", "legacy.xls");
    expect(res.error).toBeTruthy();
    judge("legacy.xls", "office", res);
  });
});

describe("edge attachment — model route (branch + payload, no network)", () => {
  it("pdf goes to the model with the right attachment payload", async () => {
    const bytes = utf8("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n%%EOF");
    const res = await run(bytes, "application/pdf", "board-pack.pdf");
    judge("board-pack.pdf", "model", res);
    expect(res.method).toBe("model");
    expect(calls).toHaveLength(1);
    const call = calls[0] as { fileAttachment: { base64: string; mimeType: string; name: string }; maxTokens: number; system: string };
    expect(call.fileAttachment.mimeType).toBe("application/pdf");
    expect(call.fileAttachment.name).toBe("board-pack.pdf");
    expect(call.fileAttachment.base64).toBe(b64(bytes));      // the real bytes, round-tripped
    expect(call.maxTokens).toBe(16_000);
    expect(call.system).toMatch(/verbatim/i);
  });

  it("a pdf with no extension still routes on mime", async () => {
    const res = await run(utf8("%PDF-1.4 minimal"), "application/pdf", "scan");
    judge("scan (no ext, mime=pdf)", "model", res);
    expect(calls).toHaveLength(1);
  });

  it.each([["screenshot.png", "image/png"], ["photo.jpg", "image/jpeg"], ["anim.gif", "image/gif"], ["shot.webp", "image/webp"]])(
    "%s goes to the model", async (name, mime) => {
      const res = await run(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), mime, name);
      judge(name, "model", res);
      expect(calls[0].fileAttachment).toMatchObject({ mimeType: mime, name });
    });

  it("a model that returns nothing is reported, not swallowed", async () => {
    modelReply = "   ";
    const res = await run(utf8("%PDF-1.4"), "application/pdf", "blank.pdf");
    expect(res.status).toBe(422);
    judge("blank.pdf (empty model reply)", "model", res);
  });
});

describe("edge attachment — adversarial", () => {
  it("an empty file fails visibly on every route", async () => {
    const empty = new Uint8Array(0);
    for (const [name, mime, route] of [["empty.csv", "text/csv", "text"], ["empty.xlsx", "", "office"], ["empty.bin", "", "rejected"]] as const) {
      const res = await run(empty, mime, name);
      expect(res.error).toBeTruthy();          // never an ok with "" text
      expect(res.text).toBeUndefined();
      judge(name, route, res);
    }
  });

  it("a PDF that lies about its extension (.csv) is decoded as text, NOT routed to the model", async () => {
    // Real PDF magic, but the filename says csv. TEXT_EXTS is checked before the
    // model route and there is no content sniff, so the extension wins.
    const pdf = new Uint8Array([...utf8("%PDF-1.7\n"), 0x00, 0x01, 0x02, 0xff, 0xfe, ...utf8("\nstream\n"), 0x8b, 0x1d, 0x00]);
    const res = await run(pdf, "application/pdf", "quarterly.csv");
    expect(res.method).toBe("decoded");        // NOT "model"
    expect(calls).toHaveLength(0);     // the model was never consulted
    judge("quarterly.csv (really a PDF)", "text", res);
    RESULTS[RESULTS.length - 1].outcome = "WRONG CONTENT";
    RESULTS[RESULTS.length - 1].detail += " — extension beat mime; PDF decoded as mojibake";
  });

  it("a CSV that lies about its extension (.xlsx) fails visibly", async () => {
    const res = await run(utf8("entity,field\nAccount,name"), "text/csv", "dictionary.xlsx");
    expect(res.error).toBeTruthy();
    judge("dictionary.xlsx (really a CSV)", "office", res);
  });

  it("a corrupt/truncated zip fails visibly", async () => {
    const good = makeDocx(["hello"]);
    const truncated = good.subarray(0, Math.floor(good.length / 2));
    const res = await run(truncated, "", "torn.docx");
    expect(res.error).toBeTruthy();
    judge("torn.docx (truncated zip)", "office", res);
  });

  it("a password-protected workbook (CFB EncryptedPackage) fails visibly", async () => {
    const enc = new Uint8Array(2048);
    enc.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    enc.set(utf8("EncryptedPackage"), 512);
    const res = await run(enc, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "locked.xlsx");
    expect(res.error).toBeTruthy();
    judge("locked.xlsx (encrypted)", "office", res);
  });

  it("an unknown binary extension is refused with actionable advice", async () => {
    const res = await run(new Uint8Array([0, 1, 2, 3, 255, 254, 0, 0]), "application/octet-stream", "model.dwg");
    expect(res.status).toBe(415);
    expect(res.error).toContain(".dwg");
    judge("model.dwg", "rejected", res);
  });

  it("an unknown extension whose bytes are printable is salvaged by the heuristic", async () => {
    const res = await run(utf8("entity,field,type\nAccount,name,string\nAccount,arr,number\n"), "", "dictionary.dat");
    judge("dictionary.dat (printable)", "heuristic", res);
    expect(res.method).toBe("decoded");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("data-dictionary upload — client path", () => {
  it("multi-tab xlsx: the LATER sheet with the real table wins over the cover", async () => {
    const bytes = makeMultiTabWorkbook("xlsx");
    const pick = await pickDictionarySheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(pick.sheets).toEqual(["Cover", "Notes", "Field Dictionary"]);
    expect(pick.sheet).toBe("Field Dictionary");              // NOT SheetNames[0]
    const parsed = parseDictionaryCsv(pick.csv, "dictionary");
    expect(parsed.fields.length).toBe(5);
    expect(parsed.fields[1]).toMatchObject({
      entity: "Account", field: "status", dataType: "code",
      valueSet: ["Active", "Churned", "Prospect"], required: true,
    });
    expect(parsed.fields[4]).toMatchObject({ entity: "Contact", field: "consent_flag", required: false });
    record("dictionary.xlsx (3 tabs)", "client-workbook", "extracted", `sheet "${pick.sheet}" of 3, ${parsed.fields.length} fields`);
  });

  /** The contrast that makes FINDING E2 a defect rather than a limitation. */
  it("the SAME workbook bytes the edge calls 'no readable text' parse to 5 fields here", async () => {
    const bytes = makeMultiTabWorkbook("xlsx", false);
    const edge = await run(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "inline.xlsx");
    expect(edge.error).toBe("No readable text found inside the document.");
    const pick = await pickDictionarySheet(bytes.buffer.slice(0) as ArrayBuffer);
    expect(pick.sheet).toBe("Field Dictionary");
    expect(parseDictionaryCsv(pick.csv).fields.length).toBe(5);
  });

  it.each(["xlsm", "xlsb", "xls"] as XLSX.BookType[])("legacy/alternate workbook .%s parses", async (bookType) => {
    const bytes = makeMultiTabWorkbook(bookType);
    const pick = await pickDictionarySheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const parsed = parseDictionaryCsv(pick.csv, `d.${bookType}`);
    expect(parsed.fields.length).toBeGreaterThan(0);
    expect(pick.sheet).toBe("Field Dictionary");
    record(`dictionary.${bookType}`, "client-workbook", "extracted", `sheet "${pick.sheet}", ${parsed.fields.length} fields`);
  });

  it("every extension the accept list offers is one isSpreadsheetName agrees with", () => {
    for (const ext of SPREADSHEET_EXTENSIONS) expect(isSpreadsheetName(`export${ext}`)).toBe(true);
    expect(isSpreadsheetName("export.csv")).toBe(false);
  });

  it("a workbook with no recognisable table names the sheet it read — never a blank", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Total revenue"], [42]]), "Summary");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const pick = await pickDictionarySheet(bytes.buffer.slice(0) as ArrayBuffer);
    expect(pick.sheet).toBe("Summary");
    expect(pick.csv.length).toBeGreaterThan(0);
    expect(parseDictionaryCsv(pick.csv).fields.length).toBe(0);   // 0 fields, against a NAMED sheet
    record("no-table.xlsx", "client-workbook", "failed-visibly", '0 fields parsed against named sheet "Summary"');
  });

  /**
   * FINDING D1 — `XLSX.read` CONTENT-SNIFFS. Anything it cannot recognise as a
   * workbook it re-reads as CSV, so a non-workbook does NOT throw: it comes back
   * as a fabricated single sheet called "Sheet1". `pickDictionarySheet` therefore
   * never raises for a mislabelled text file, and the OperatorInbox catch never
   * fires. What the operator sees is "0 fields parsed from sheet Sheet1" — a
   * count, against a sheet name that does not exist in any file they own.
   */
  it("a non-workbook byte stream does NOT throw — it yields a fabricated 'Sheet1' and 0 fields", async () => {
    const pick = await pickDictionarySheet(utf8("this is not a workbook at all").buffer as ArrayBuffer);
    expect(pick.sheet).toBe("Sheet1");
    expect(pick.sheets).toEqual(["Sheet1"]);
    expect(parseDictionaryCsv(pick.csv).fields.length).toBe(0);
    record("garbage.xlsx", "client-workbook", "failed-visibly",
      'no throw — fabricated sheet "Sheet1", 0 fields; operator sees a count, not "not a workbook"');
  });

  it("a PDF renamed .xlsx also sniffs to a fabricated sheet with 0 fields", async () => {
    const pick = await pickDictionarySheet(utf8("%PDF-1.7\nnot a workbook\n%%EOF").buffer as ArrayBuffer);
    expect(pick.sheet).toBe("Sheet1");
    expect(parseDictionaryCsv(pick.csv).fields.length).toBe(0);
    record("report.xlsx (really a PDF)", "client-workbook", "failed-visibly", 'no throw — "Sheet1", 0 fields');
  });

  it("an EMPTY file yields a fabricated sheet with an empty csv — the weakest signal in either path", async () => {
    const pick = await pickDictionarySheet(new Uint8Array(0).buffer);
    expect(pick.sheet).toBe("Sheet1");
    expect(pick.csv).toBe("");
    expect(parseDictionaryCsv(pick.csv).fields.length).toBe(0);
    record("empty.xlsx", "client-workbook", "failed-visibly", '0 fields against a fabricated "Sheet1"');
  });

  it("a password-protected / CFB workbook DOES throw, and the Inbox catch surfaces it", async () => {
    const enc = new Uint8Array(2048);
    enc.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(pickDictionarySheet(enc.buffer)).rejects.toThrow();
    record("locked.xlsx (encrypted)", "client-workbook", "failed-visibly", "throws; OperatorInbox catch renders dictError");
  });

  it("csv / tsv / quoted csv parse deterministically", () => {
    const csv = parseDictionaryCsv('entity,field,type,values,required\nAccount,status,code,"Active,Churned",Yes\n');
    expect(csv.fields[0]).toMatchObject({ entity: "Account", field: "status", valueSet: ["Active", "Churned"], required: true });
    const tsv = parseDictionaryCsv("entity\tfield\ttype\nAccount\tarr\tnumber");
    expect(tsv.fields[0]).toMatchObject({ entity: "Account", field: "arr", dataType: "number" });
    record("dictionary.csv / .tsv", "client-csv", "extracted", `${csv.fields.length}+${tsv.fields.length} fields`);
  });

  it("an unrecognisable header yields zero fields — the caller reports the count", () => {
    expect(parseDictionaryCsv("alpha,beta\n1,2").fields.length).toBe(0);
    expect(parseDictionaryCsv("").fields.length).toBe(0);
    record("wrong-header.csv", "client-csv", "failed-visibly", "0 fields, surfaced as a count in the preview");
  });

  it("a large workbook is not silently truncated", async () => {
    const rows: (string | number)[][] = [["Entity", "Field", "Type"]];
    for (let i = 0; i < 20_000; i++) rows.push(["Account", `field_${i}`, "string"]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Dict");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const pick = await pickDictionarySheet(bytes.buffer.slice(0) as ArrayBuffer);
    expect(parseDictionaryCsv(pick.csv).fields.length).toBe(20_000);
    record("large-20k-rows.xlsx", "client-workbook", "extracted", "20000 fields, no truncation");
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════
/**
 * GAP LOCKS — the accept lists and the extractor must agree. These fail if
 * either side moves without the other.
 */
describe("accept list ⟷ extractor agreement", () => {
  const EVIDENCE_ACCEPT = ".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.png,.jpg,.jpeg"   // CoPilotSidebar.tsx
    .split(",").map((s) => s.replace(".", ""));

  it("the CoPilot accept list offers .doc, which the extractor cannot read", () => {
    expect(EVIDENCE_ACCEPT).toContain("doc");
    const OFFICE_EXTS = ["docx", "pptx", "xlsx"];
    expect(OFFICE_EXTS).not.toContain("doc");
  });

  it("the extractor reads html/htm/md/json/xml/tsv/yaml, which no evidence accept list offers", () => {
    for (const ext of ["html", "htm", "md", "json", "xml", "tsv", "yaml", "yml", "log", "markdown"]) {
      expect(EVIDENCE_ACCEPT).not.toContain(ext);
    }
  });

  it("the dictionary accept list offers .xlsb and .xls, and pickDictionarySheet reads both", () => {
    expect(SPREADSHEET_EXTENSIONS).toEqual([".xlsx", ".xlsm", ".xlsb", ".xls"]);
  });
});

afterAll(() => {
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = ["", "FILE INGESTION COVERAGE", "─".repeat(112),
    `${pad("FILE", 36)}${pad("ROUTE", 18)}${pad("OUTCOME", 16)}DETAIL`, "─".repeat(112)];
  for (const r of RESULTS) lines.push(`${pad(r.file, 36)}${pad(r.route, 18)}${pad(r.outcome, 16)}${r.detail}`);
  lines.push("─".repeat(112));
  const silent = RESULTS.filter((r) => r.outcome === "SILENTLY EMPTY");
  lines.push(`${RESULTS.length} cases · ${RESULTS.filter((r) => r.outcome === "extracted").length} extracted · ` +
    `${RESULTS.filter((r) => r.outcome === "failed-visibly").length} failed visibly · ` +
    `${RESULTS.filter((r) => r.outcome === "WRONG CONTENT").length} wrong content · ${silent.length} SILENTLY EMPTY`, "");
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
});
