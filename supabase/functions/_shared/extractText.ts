/**
 * Shared document-to-text extraction ladder. Callers gate ACCESS (JWT for
 * flow-extract, a live pack token for flow-portal); this module only turns
 * bytes into reviewable text and never stores anything.
 */
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import { completeClaudeText } from "./claudeClient.ts";

// Anchored: "xml" alone would swallow application/vnd.openXMLformats (docx et al).
const TEXT_MIMES = /^text\/|^application\/(json|xml|xhtml\+xml|x-yaml|csv)$/i;
const TEXT_EXTS = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "xml", "log", "yaml", "yml"]);
/**
 * Extensions that are OOXML ZIP containers. `xlsm`/`xlsb` are here so a file whose
 * mime arrives EMPTY (a drag-drop from some browsers, a re-upload from storage, any
 * client that does not sniff) is still routed by EXTENSION into the office branch.
 * Without them the container fell through to the trailing salvage decoder and its
 * raw ZIP bytes were ingested as if they were the document's text.
 */
const OFFICE_EXTS = new Set(["docx", "pptx", "xlsx", "xlsm", "xlsb"]);
/** The spreadsheet subset: cells, not prose — a different reader entirely (see sheetText). */
const SHEET_EXTS = new Set(["xlsx", "xlsm", "xlsb"]);
const MODEL_MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];   // "PK\x03\x04" — a local file header

/** Text runs from Office XML: w:t (Word), a:t (PowerPoint). Spreadsheets go to sheetText. */
function officeText(bytes: Uint8Array, ext: string): string {
  const files = unzipSync(bytes);
  const wanted = ext === "docx"
    ? ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]
    : Object.keys(files).filter((name) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(name)).sort();
  const chunks: string[] = [];
  for (const name of wanted) {
    if (!files[name]) continue;
    const xml = strFromU8(files[name]);
    const runs = [...xml.matchAll(/<(?:w:t|a:t)(?:\s[^>]*)?>([^<]*)<\/(?:w:t|a:t)>/g)].map((m) => m[1]);
    // Paragraph boundaries become newlines so the text reads as prose.
    const paragraphed = xml.split(/<\/(?:w:p|a:p)>/).map((part) =>
      [...part.matchAll(/<(?:w:t|a:t)(?:\s[^>]*)?>([^<]*)<\/(?:w:t|a:t)>/g)].map((m) => m[1]).join(""),
    ).filter((line) => line.trim());
    chunks.push(paragraphed.length ? paragraphed.join("\n") : runs.join(" "));
  }
  return chunks.join("\n\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}

/* ── Spreadsheets ────────────────────────────────────────────────────────────
 *
 * A workbook is NOT prose in a bag, and scraping every `<t>` out of its XML is
 * not "adequate but lossy" — it is the wrong document. In SpreadsheetML:
 *
 *   · a string cell holds an INDEX (`t="s"`, `<v>12</v>`) into `sharedStrings.xml`,
 *     which is DEDUPLICATED — "Account" appears once no matter how many rows use
 *     it, so scraping the pool destroys row structure and row counts;
 *   · a NUMBER has no string-table entry at all (`<v>255</v>` in the sheet), so
 *     every figure in the workbook is simply absent from the pool;
 *   · many producers (SheetJS, BI exporters, ODS converters) write no pool at
 *     all — strings sit inline in the sheet — so the pool reader returns "";
 *   · sheet identity lives in `workbook.xml`, nowhere near the values.
 *
 * So this branch resolves each cell IN ITS SHEET, IN ITS ROW, IN ITS COLUMN, and
 * emits one tab-separated line per row under a named sheet heading. The consumer
 * is a model prompt, so plain readable text beats markup.
 *
 * This mirrors `pickDictionarySheet` (src/v3/lib/ledger/dictionary.ts), which gets
 * the same semantics from the `xlsx` npm package. That module is CLIENT code and
 * cannot be imported by Deno, so the semantics are re-implemented here on fflate
 * rather than a second remote dependency being added.
 */

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const codePoint = (n: number): string =>
  Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
/** Decode XML entities in ONE pass, so `&amp;lt;` stays `&lt;` instead of becoming `<`. */
const unescapeXml = (raw: string): string =>
  raw.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (_m, hex, dec, name) =>
    hex ? codePoint(parseInt(hex, 16)) : dec ? codePoint(Number(dec)) : NAMED_ENTITIES[name as string]);
/** A cell's text, flattened: an embedded newline would break the one-line-per-row promise. */
const cellText = (raw: string): string => unescapeXml(raw).replace(/[\t\r\n]+/g, " ").trim();

/** Optional namespace prefix — Excel writes `<c>`, some producers write `<x:c>`. */
const P = "(?:[\\w.-]+:)?";
/** `<tag …/>` or `<tag …>body</tag>`, body in group 1. */
const element = (tag: string, flags = "g"): RegExp =>
  new RegExp(`<${P}${tag}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${P}${tag}>)`, flags);
/** Concatenate every `<t>` run, minus `<rPh>` phonetic hints (which are not content). */
const runsText = (xml: string): string =>
  [...xml.replace(element("rPh"), "").matchAll(element("t"))].map((m) => m[1] ?? "").join("");

/** `"BC12"` → 54. Returns -1 when the ref carries no column letters. */
function columnIndex(ref: string): number {
  let n = 0, seen = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
    seen++;
  }
  return seen ? n - 1 : -1;
}

/**
 * Excel serial → ISO. Base 1899-12-30 because serial 61 is 1900-03-01: Excel keeps
 * a 1900-02-29 that never existed, so serials below it need the other base.
 */
function serialToIso(serial: number): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_466) return "";
  if (serial < 1) {                                          // a time of day, no date part
    const secs = Math.round(serial * 86_400);
    const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    return [hh, mm, ss].map((v) => String(v).padStart(2, "0")).join(":");
  }
  const days = Math.floor(serial);
  const base = Date.UTC(1899, 11, serial < 60 ? 31 : 30);
  const at = new Date(base + days * 86_400_000 + Math.round((serial - days) * 86_400) * 1000);
  const iso = at.toISOString();
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
/** A format code is a date/time one if a y/m/d/h/s survives once literals are stripped. */
const isDateFormat = (code: string): boolean =>
  /[ymdhs]/i.test(code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").replace(/\\./g, ""));

/**
 * `s="7"` on a cell indexes `cellXfs`; that xf's `numFmtId` says whether the number
 * is a DATE. Without this a date column extracts as "45880" — a figure that is not
 * the one in the document, which is the same class of defect as dropping it.
 */
function dateStyleIndex(stylesXml: string | undefined): (styleId: string) => boolean {
  if (!stylesXml) return () => false;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<[\w.-]*:?numFmt\b[^>]*\/?>/g)) {
    const id = /\bnumFmtId="(\d+)"/.exec(m[0]);
    const code = /\bformatCode="([^"]*)"/.exec(m[0]);
    if (id && code) custom.set(Number(id[1]), unescapeXml(code[1]));
  }
  const cellXfs = element("cellXfs", "").exec(stylesXml)?.[1] ?? "";
  const isDate = [...cellXfs.matchAll(/<[\w.-]*:?xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    const code = custom.get(id);
    return code !== undefined ? isDateFormat(code) : BUILTIN_DATE_FMTS.has(id);
  });
  return (styleId: string) => isDate[Number(styleId)] === true;
}

/** One worksheet → tab-separated lines, gaps preserved, empty rows dropped. */
function sheetLines(xml: string, shared: string[], styledAsDate: (s: string) => boolean, budget: number): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const rowMatch of xml.matchAll(element("row"))) {
    const body = rowMatch[1];
    if (!body) continue;
    const cells: string[] = [];
    let next = 0;
    for (const cellMatch of body.matchAll(element("c"))) {
      const head = cellMatch[0].slice(0, cellMatch[0].indexOf(">") + 1);
      const inner = cellMatch[1] ?? "";
      const type = /\bt="([^"]*)"/.exec(head)?.[1] ?? "n";
      const ref = /\br="([^"]*)"/.exec(head)?.[1] ?? "";
      const at = columnIndex(ref);
      const col = at >= 0 ? at : next;
      next = col + 1;
      const raw = element("v", "").exec(inner)?.[1] ?? "";
      let value: string;
      if (type === "s") value = cellText(shared[Number(unescapeXml(raw))] ?? "");
      else if (type === "inlineStr") value = cellText(runsText(element("is", "").exec(inner)?.[1] ?? inner));
      else if (type === "str" || type === "e" || type === "d") value = cellText(raw);
      else if (type === "b") value = raw.trim() === "" ? "" : raw.trim() === "0" ? "FALSE" : "TRUE";
      else {
        // Numeric: no `t` at all, or t="n". The style decides date vs figure.
        const text = cellText(raw);
        const n = Number(text);
        const styleId = /\bs="(\d+)"/.exec(head)?.[1];
        value = text === "" ? ""
          : styleId !== undefined && styledAsDate(styleId) && Number.isFinite(n) ? (serialToIso(n) || text)
          : Number.isFinite(n) ? String(n) : text;
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (!cells.length) continue;
    const line = cells.join("\t");
    lines.push(line);
    used += line.length + 1;
    if (used > budget) break;                 // the caller caps anyway; don't build the excess
  }
  return lines;
}

/** `Target="worksheets/sheet1.xml"` (relative to xl/) or `"/xl/worksheets/sheet1.xml"`. */
const relTarget = (target: string): string => {
  const t = unescapeXml(target).replace(/\\/g, "/");
  return (t.startsWith("/") ? t.slice(1) : `xl/${t}`).replace(/\/\.\//g, "/");
};

/**
 * A workbook → readable, sheet-attributed rows. Returns "" only when the container
 * holds no cells anywhere (the caller then fails visibly); a BINARY workbook body
 * (.xlsb) is reported as such rather than mistaken for an empty one.
 */
function sheetText(bytes: Uint8Array, maxChars: number): { text: string } | { error: string; status: number } {
  const files = unzipSync(bytes);
  const read = (name: string): string | undefined => (files[name] ? strFromU8(files[name]) : undefined);

  const worksheets = Object.keys(files).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n));
  if (!worksheets.length) {
    // .xlsb keeps every sheet as BIFF12 records in a .bin part — no XML to read.
    if (Object.keys(files).some((n) => /^xl\/.*\.bin$/i.test(n))) {
      return { error: "This workbook stores its sheets in Excel's binary format (.xlsb), which can't be read here — re-save it as .xlsx and upload again.", status: 415 };
    }
    return { error: "No worksheets found inside the workbook.", status: 422 };
  }

  const shared: string[] = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(element("si"))) shared.push(cellText(runsText(m[1] ?? "")));
  const styledAsDate = dateStyleIndex(read("xl/styles.xml"));

  // Sheet NAME and ORDER live in workbook.xml; the part each name points at is
  // resolved through the rels, because sheet3.xml is not necessarily the 3rd tab.
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const byRid = new Map<string, string>();
  for (const m of rels.matchAll(/<[\w.-]*:?Relationship\b[^>]*\/?>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && target) byRid.set(id, relTarget(target));
  }
  const workbook = read("xl/workbook.xml") ?? "";
  const tabs: Array<{ name: string; part: string }> = [];
  for (const m of workbook.matchAll(/<[\w.-]*:?sheet\b[^>]*\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /(?:^|\s)(?:[\w.-]+:)?id="([^"]*)"/.exec(m[0])?.[1];
    const part = rid ? byRid.get(rid) : undefined;
    if (name === undefined || !part || !worksheets.includes(part)) continue;   // chartsheets et al
    tabs.push({ name: unescapeXml(name), part });
  }
  if (!tabs.length) {
    // No readable workbook.xml — fall back to part order so values are never lost,
    // and label each block with the part it came from rather than inventing a name.
    const numeric = (n: string) => Number(/(\d+)\.xml$/i.exec(n)?.[1] ?? 0);
    for (const part of worksheets.slice().sort((a, b) => numeric(a) - numeric(b) || a.localeCompare(b))) {
      tabs.push({ name: part.replace(/^xl\/worksheets\//, "").replace(/\.xml$/i, ""), part });
    }
  }

  const blocks: string[] = [];
  let cellsAnywhere = false;
  let used = 0;
  for (const tab of tabs) {
    const lines = used > maxChars ? [] : sheetLines(read(tab.part) ?? "", shared, styledAsDate, maxChars - used);
    if (lines.length) cellsAnywhere = true;
    // An empty tab SAYS it is empty: a bare heading with nothing under it reads as
    // lost content, and silently dropping the tab hides that the workbook has one.
    const block = `=== Sheet: ${tab.name} ===\n${lines.length ? lines.join("\n") : "(no cells)"}`;
    blocks.push(block);
    used += block.length + 2;
  }
  return { text: cellsAnywhere ? blocks.join("\n\n") : "" };
}

export interface ExtractOk { text: string; method: string }
export interface ExtractErr { error: string; status: number }

export async function extractDocumentText(
  bytes: Uint8Array, base64: string, mime: string, filename: string, maxChars: number,
): Promise<ExtractOk | ExtractErr> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  try {
    if (OFFICE_EXTS.has(ext) || /officedocument|msword|ms-excel|ms-powerpoint/i.test(mime)) {
      const officeExt = OFFICE_EXTS.has(ext) ? ext : /word/i.test(mime) ? "docx" : /excel|spreadsheet/i.test(mime) ? "xlsx" : "pptx";
      if (SHEET_EXTS.has(officeExt)) {
        const sheet = sheetText(bytes, maxChars);
        if ("error" in sheet) return sheet;
        if (!sheet.text) return { error: "No readable text found inside the document.", status: 422 };
        return { text: sheet.text.slice(0, maxChars), method: "office-xml" };
      }
      const text = officeText(bytes, officeExt);
      if (!text) return { error: "No readable text found inside the document.", status: 422 };
      return { text: text.slice(0, maxChars), method: "office-xml" };
    }
    if (TEXT_MIMES.test(mime) || TEXT_EXTS.has(ext)) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
      if (!text) return { error: "The file decoded to empty text.", status: 422 };
      return { text: text.slice(0, maxChars), method: "decoded" };
    }
    if (MODEL_MIMES.has(mime) || ext === "pdf") {
      const result = await completeClaudeText({
        system: "You transcribe documents verbatim. Output ONLY the document's full text content, preserving headings, lists and table rows as plain text lines. No commentary, no summaries, no markdown fences.",
        messages: [{ role: "user", content: `Transcribe the attached document (${filename || mime}) in full.` }],
        fileAttachment: { base64, mimeType: mime || "application/pdf", name: filename || undefined },
        maxTokens: 16_000,
      });
      const text = (result.text ?? "").trim();
      if (!text) return { error: "The document produced no readable text.", status: 422 };
      return { text: text.slice(0, maxChars), method: "model" };
    }
    // A ZIP container is never text. Decoding one yields the local-file signature,
    // the internal part paths and 19 KB of deflate mojibake — which the salvage
    // ratio below used to ACCEPT, ingesting the container as if it were the document.
    if (ZIP_MAGIC.every((b, i) => bytes[i] === b)) {
      return { error: `Cannot read .${ext || "this"} files — the file is a zipped container, not text. Export to PDF or paste the text instead.`, status: 415 };
    }
    const guess = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // U+FFFD is the REPLACEMENT character the decoder emits for bytes that are not
    // UTF-8 — it is decode damage, so it must not count towards "printable". It sat
    // inside the kept \u00a0-\uffff range, which is why arbitrary binary passed.
    const printable = guess.replace(/[^\x20-\x7E\s\u00a0-\ufffc\ufffe\uffff]/g, "");
    if (guess.length && printable.length / guess.length > 0.9 && printable.trim().length > 40) {
      return { text: printable.slice(0, maxChars).trim(), method: "decoded" };
    }
    return { error: `Cannot read .${ext || "this"} files — export to PDF or paste the text instead.`, status: 415 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/provider key is not configured/i.test(message)) {
      return { error: "Reading PDFs and images needs an AI provider on the project — paste the text instead.", status: 501 };
    }
    console.error("extractDocumentText error", message.slice(0, 300));
    return { error: "Could not read that file — paste the text instead.", status: 502 };
  }
}

/**
 * Focus an extraction on ONE question: pull the passages, rows and figures
 * that bear on it, VERBATIM — never a summary, never invented. Falls back to
 * the full text when no provider is configured or the pass fails: losing
 * focus is acceptable, losing evidence is not.
 */
export async function extractRelevant(text: string, question: string): Promise<{ text: string; refined: boolean }> {
  if (text.length < 1_500) return { text, refined: false };
  try {
    const result = await completeClaudeText({
      system: [
        "You extract the RELEVANT parts of a document for a specific question.",
        "Rules: copy passages, table rows and figures VERBATIM from the document — never summarise, never paraphrase, never add commentary.",
        "Preserve enough surrounding context that each excerpt stands alone. Separate excerpts with a blank line.",
        "If the whole document is relevant, return it whole. If nothing is relevant, return the document's most informative sections anyway — the reviewer decides.",
      ].join(" "),
      messages: [{ role: "user", content: `Question being answered:\n${question}\n\nDocument text:\n${text.slice(0, 150_000)}` }],
      maxTokens: 8_000,
    });
    const refined = (result.text ?? "").trim();
    // A suspiciously tiny result means the pass went wrong — keep the evidence.
    if (refined.length >= 200 || refined.length >= text.length * 0.5) return { text: refined, refined: true };
    return { text, refined: false };
  } catch {
    return { text, refined: false };
  }
}
