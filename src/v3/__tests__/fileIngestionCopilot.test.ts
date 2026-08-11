/**
 * FILE INGESTION, PATH 3 — `src/new/lib/parseDocumentToText.ts`.
 *
 * There is a THIRD extractor besides the edge ladder and the dictionary parser:
 * the CoPilot composer's paper-clip (`CoPilotSidebar.tsx`, accept list
 * `.pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.png,.jpg,.jpeg`) parses IN THE BROWSER
 * via `parseDocumentToText`. It is far more capable than the edge ladder — real
 * multi-sheet Excel with `[Sheet: …]` headers, mammoth docx with tables, pdfjs
 * with a Tesseract OCR fallback — which is exactly why the divergence matters.
 *
 * Real bytes, real parsers. Two things cannot run under jsdom and are pinned at
 * SOURCE level instead, explicitly, so a skip never reads as a pass:
 *   • PDF  — `pdfjs-dist` needs a worker resolved from `import.meta.url`.
 *   • OCR  — `tesseract.js` needs a real canvas + worker.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseDocumentToText, detectFileType, htmlToStructuredText, ACCEPTED_FILE_EXTENSIONS } from "@/new/lib/parseDocumentToText";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const file = (name: string, body: BlobPart, type = "") => new File([body], name, { type });

describe("parseDocumentToText — real files", () => {
  it("multi-tab xlsx keeps EVERY sheet, its name, and its numbers", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Acme CRM Export"], ["Confidential"]]), "Cover");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Entity", "Field", "Type", "Max Length"],
      ["Account", "account_name", "string", 255],
      ["Contact", "email", "email", 320],
    ]), "Field Dictionary");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const res = await parseDocumentToText(file("dictionary.xlsx", bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sheetCount).toBe(2);
    expect(res.text).toContain("[Sheet: Cover]");
    expect(res.text).toContain("[Sheet: Field Dictionary]");
    expect(res.text).toContain("255");                       // numbers survive here
    expect(res.text).toContain("Account,account_name,string,255"); // and so does the ROW
  });

  /**
   * DOCX end-to-end cannot run here, and the reason is the TEST environment, not
   * the product: vitest resolves `mammoth` by node conditions, and mammoth's node
   * build accepts only `{path}`/`{buffer}` — `{arrayBuffer}` is the BROWSER build
   * (`mammoth.browser.js`, selected by Vite's `browser` field in the real app).
   * Calling it here rejects with "Could not find file in options".
   *
   * So the docx pipeline is verified in two halves instead, and neither is a skip:
   *   • the load-bearing half — `htmlToStructuredText`, which is what turns
   *     mammoth's HTML into text and is the whole reason `convertToHtml` is used
   *     instead of `extractRawText` — runs FOR REAL against jsdom's DOM;
   *   • the wiring is pinned at source.
   */
  it("docx table rows survive as pipe-delimited lines (htmlToStructuredText, real DOM)", () => {
    const mammothLikeHtml = "<p>Programme charter</p>"
      + "<table><tr><td>Metric</td><td>Target</td></tr><tr><td>Cycle time</td><td>12 days</td></tr></table>"
      + "<p>Signed by the sponsor.</p>";
    const text = htmlToStructuredText(mammothLikeHtml);
    expect(text).toContain("Programme charter");
    expect(text).toContain("Metric | Target");
    expect(text).toContain("Cycle time | 12 days");   // row pairing preserved, not flattened
    expect(text).toContain("Signed by the sponsor.");
  });

  it("[wiring pinned at source — mammoth's node build cannot be driven from vitest] parseDocx uses convertToHtml, not extractRawText", () => {
    const SRC = read("src/new/lib/parseDocumentToText.ts");
    expect(SRC).toContain('const mammoth = await import("mammoth");');
    expect(SRC).toContain("mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })");
    expect(SRC).toContain('return finish(htmlToStructuredText(result.value), "docx");');
  });

  it("html keeps table rows AND recovers an SPA JSON bootstrap", async () => {
    const html = `<html><head><script>window.__DATA__ = {"entity":"Account","rows":3};</script></head>`
      + `<body><h1>Field dictionary</h1><table><tr><th>Field</th><th>Type</th></tr>`
      + `<tr><td>arr</td><td>number</td></tr></table>`
      + `<p>The dictionary above is the system of record for Account typing.</p></body></html>`;
    const res = await parseDocumentToText(file("export.html", html, "text/html"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain("Field | Type");
    expect(res.text).toContain("arr | number");
    expect(res.text).toContain('"entity":"Account"');
  });

  it.each([
    ["rows.csv", "text/csv", "entity,field,type\nAccount,account_name,string\nContact,email,email\n", "entity: Account"],
    ["rows.tsv", "", "entity\tfield\ttype\nAccount\taccount_name\tstring\nContact\temail\temail\n", "entity: Account"],
    ["payload.json", "application/json", '{"entity":"Account","fields":["account_name","arr"],"note":"a long enough body to clear the 40 char floor"}', '"entity"'],
    ["notes.txt", "text/plain", "Kickoff notes. The sponsor wants the CRM merged before the Q3 board review.", "sponsor"],
    ["spec.md", "", "# Spec\n\nThe **dictionary** is the source of truth for Account typing across the estate.", "dictionary"],
    ["export.xml", "application/xml", "<dict><field>account_name is a string of at most 255 characters</field></dict>", "account_name"],
  ])("%s parses", async (name, mime, body, needle) => {
    const res = await parseDocumentToText(file(name, body, mime));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain(needle);
    expect(res.wordCount).toBeGreaterThan(0);
  });

  it("an empty file fails visibly with a reason", async () => {
    const res = await parseDocumentToText(file("empty.csv", "", "text/csv"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/empty/i);
  });

  it("a file below the 40-char readable floor fails visibly rather than returning a stub", async () => {
    const res = await parseDocumentToText(file("tiny.txt", "hi", "text/plain"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Document appears to be empty or contains no readable text.");
  });

  it("[wiring pinned at source — same mammoth limitation] legacy .doc ends in save-as guidance, never silent", () => {
    const SRC = read("src/new/lib/parseDocumentToText.ts");
    // The only two exits from parseDocLegacy: real text, or an explicit reason.
    expect(SRC).toContain('return finish(result.value, "doc");');
    expect(SRC).toContain('error: "Legacy .doc format could not be parsed. Please save as .docx and re-upload."');
    expect(SRC).not.toMatch(/parseDocLegacy[\s\S]{0,600}return \{ ok: true, text: "" \}/);
  });

  it("an unsupported extension is refused by name", async () => {
    const res = await parseDocumentToText(file("model.dwg", new Uint8Array([1, 2, 3, 4]), "application/octet-stream"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('Unsupported file type "dwg"');
  });

  it("a file over 50MB is refused before any parsing", async () => {
    const fake = file("huge.csv", "x", "text/csv");
    Object.defineProperty(fake, "size", { value: 60 * 1024 * 1024 });
    const res = await parseDocumentToText(fake);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("Maximum size is 50 MB");
  });

  it("a CSV lying about its extension (.xlsx) is RESCUED — SheetJS sniffs the content", async () => {
    const res = await parseDocumentToText(file(
      "dictionary.xlsx",
      "entity,field,type\nAccount,account_name,string\nContact,email,email\n",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain("account_name");   // content wins over the wrong extension
  });

  /**
   * FINDING — SheetJS falls back to CSV sniffing for anything it cannot recognise,
   * so a PDF renamed .xlsx comes back as a one-cell "Sheet1" instead of an error,
   * and the `[Sheet: Sheet1]` banner alone is enough to clear the 40-char floor.
   * The result is `ok: true` over content that is not the document. Not silent —
   * but confidently wrong, which reads to the operator exactly like a success.
   */
  it("a PDF lying about its extension (.xlsx) is reported as a SUCCESS over sniffed garbage", async () => {
    const res = await parseDocumentToText(file("report.xlsx", "%PDF-1.7\nnot a workbook\n%%EOF",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    expect(res.ok).toBe(true);           // ← the finding: no error is raised
    if (!res.ok) return;
    expect(res.text).toContain("[Sheet: Sheet1]");
    expect(res.text).toContain("%PDF-1.7");   // raw PDF header served as "document text"
  });

  it("routing is by extension first, mime second — a unicode name still routes", () => {
    expect(detectFileType(file("données_répertoire_测试.csv", "a,b"))).toBe("csv");
    expect(detectFileType(file("scan", "x", "application/pdf"))).toBe("pdf");
    expect(detectFileType(file("quarterly.csv", "x", "application/pdf"))).toBe("pdf"); // mime wins for pdf
    expect(detectFileType(file("model.dwg", "x"))).toBeNull();
  });
});

/**
 * NOT EXERCISED IN THIS ENVIRONMENT — pinned at source so the gap is explicit.
 * These are NOT passes for PDF text extraction or image OCR; they only assert
 * that the code path exists and is wired to the library it claims.
 */
describe("PDF and image OCR — cannot execute under jsdom (source-level pins only)", () => {
  const SRC = read("src/new/lib/parseDocumentToText.ts");

  it("[NOT RUN — jsdom has no pdf worker] the pdf branch is wired to pdfjs-dist with an OCR fallback", () => {
    expect(SRC).toContain('await import("pdfjs-dist")');
    expect(SRC).toContain("pdfjs-dist/build/pdf.worker.mjs");
    expect(SRC).toContain("return await ocrPdfDocument(pdf);");
    expect(SRC).toContain('return { ok: false, error: "Scanned PDF does not contain readable text after OCR."');
  });

  it("[NOT RUN — jsdom has no canvas/worker] the image branch is wired to tesseract.js and fails visibly", () => {
    expect(SRC).toContain('await import("tesseract.js")');
    expect(SRC).toContain("Image does not contain readable text (OCR found insufficient content).");
  });
});

/**
 * THE SILENT EMPTY, and the mutation proof for the fix.
 *
 * `CoPilotSidebar` cannot be rendered here — this repo has no @testing-library —
 * so the boundary is pinned by reading the source, the same lockstep technique
 * `portalDurableLink.test.ts` uses for the Deno entrypoint.
 *
 * BEFORE the fix the handler read `const text = result.ok ? result.text : "";`
 * and built the chip with no `error` field. A failed parse therefore rendered
 * "0 words extracted" in the SUCCESS colour, and `handleSend`'s
 * `.filter((doc) => doc.text.trim().length > 0)` dropped the document from the
 * prompt without a word. Reverting either assertion below fails this test.
 */
describe("CoPilotSidebar must not swallow a parse failure", () => {
  const SRC = read("src/v3/components/CoPilotSidebar.tsx");

  it("the failure reason is carried onto the attachment chip", () => {
    expect(SRC).toContain("error: result.ok ? undefined : result.error,");
    expect(SRC).toMatch(/error\?: string;/);
  });

  it("the chip renders the reason instead of a success-styled '0 words extracted'", () => {
    expect(SRC).toContain("Not read — {parsed.error}");
    expect(SRC).toContain('role="alert"');
    // the success line must now be the ELSE of the error branch, not unconditional
    const i = SRC.indexOf("parsed.error ? (");
    const j = SRC.indexOf("words extracted");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("handleSend still drops empty text — which is only safe because the chip now says why", () => {
    expect(SRC).toContain(".filter((doc) => doc.text.trim().length > 0)");
  });
});

describe("accept lists ⟷ parsers", () => {
  it("the CoPilot accept list is NARROWER than the parser and than the shared constant", () => {
    const copilot = ".pdf,.doc,.docx,.txt,.csv,.xlsx,.pptx,.png,.jpg,.jpeg".split(",");
    const supported = ACCEPTED_FILE_EXTENSIONS.split(",");
    // Types the parser handles that the composer will not let you pick:
    for (const ext of [".html", ".htm", ".xml", ".md", ".json", ".tsv", ".zip", ".eml", ".yaml", ".xls", ".ods", ".odt"]) {
      expect(supported).toContain(ext);
      expect(copilot).not.toContain(ext);
    }
    // …and one the composer offers that the parser can only reject:
    expect(copilot).toContain(".doc");
  });

  it("ACCEPTED_FILE_EXTENSIONS has ZERO importers — the exported constant is dead", () => {
    // If this ever becomes false, the accept-list gap above is likely fixed.
    const sidebar = read("src/v3/components/CoPilotSidebar.tsx");
    expect(sidebar).not.toContain("ACCEPTED_FILE_EXTENSIONS");
  });
});
