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
const OFFICE_EXTS = new Set(["docx", "pptx", "xlsx"]);
const MODEL_MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Text runs from Office XML: w:t (Word), a:t (PowerPoint), t (Excel shared strings). */
function officeText(bytes: Uint8Array, ext: string): string {
  const files = unzipSync(bytes);
  const wanted = ext === "docx"
    ? ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]
    : ext === "xlsx"
      ? ["xl/sharedStrings.xml"]
      : Object.keys(files).filter((name) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(name)).sort();
  const chunks: string[] = [];
  for (const name of wanted) {
    if (!files[name]) continue;
    const xml = strFromU8(files[name]);
    const runs = [...xml.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([^<]*)<\/(?:w:t|a:t|t)>/g)].map((m) => m[1]);
    // Paragraph/row boundaries become newlines so the text reads as prose.
    const paragraphed = xml.split(/<\/(?:w:p|a:p|row)>/).map((part) =>
      [...part.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([^<]*)<\/(?:w:t|a:t|t)>/g)].map((m) => m[1]).join(""),
    ).filter((line) => line.trim());
    chunks.push(paragraphed.length ? paragraphed.join("\n") : runs.join(" "));
  }
  return chunks.join("\n\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
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
    const guess = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const printable = guess.replace(/[^\x20-\x7E\s\u00a0-\uffff]/g, "");
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
