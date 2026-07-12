/**
 * flow-extract — any document in, reviewable TEXT out. The extraction ladder:
 *   1. text-family types (txt/md/csv/json/html/xml) decode directly;
 *   2. Office files (docx/pptx/xlsx) are zip archives — their XML is unzipped
 *      and the text runs pulled out, no AI involved;
 *   3. PDFs and images go to the model as native attachments for a verbatim
 *      transcription (requires a configured AI provider).
 * Only the extracted text returns — the file itself is never stored here. The
 * operator READS the text in the capture form before it becomes evidence.
 */
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import { completeClaudeText } from "../_shared/claudeClient.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  let payload: { file?: string; mime?: string; filename?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON: { file: base64, mime, filename }" }, 400);
  }
  if (typeof payload.file !== "string" || !payload.file) {
    return jsonResponse({ error: "Missing file (base64)" }, 400);
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(payload.file);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    return jsonResponse({ error: "file is not valid base64" }, 400);
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return jsonResponse({ error: `File too large — cap is ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB` }, 413);
  }

  const filename = typeof payload.filename === "string" ? payload.filename : "";
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const mime = typeof payload.mime === "string" ? payload.mime : "";

  try {
    // 1. Office archives first — their mime contains "xml" and their bytes are
    // a zip, so they must never fall through to the plain-text decoder.
    if (OFFICE_EXTS.has(ext) || /officedocument|msword|ms-excel|ms-powerpoint/i.test(mime)) {
      const officeExt = OFFICE_EXTS.has(ext) ? ext : /word/i.test(mime) ? "docx" : /excel|spreadsheet/i.test(mime) ? "xlsx" : "pptx";
      const text = officeText(bytes, officeExt);
      if (!text) return jsonResponse({ error: "No readable text found inside the document." }, 422);
      return jsonResponse({ text: text.slice(0, MAX_TEXT_CHARS), method: "office-xml" });
    }

    // 2. Plain text family — decode and return.
    if (TEXT_MIMES.test(mime) || TEXT_EXTS.has(ext)) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
      if (!text) return jsonResponse({ error: "The file decoded to empty text." }, 422);
      return jsonResponse({ text: text.slice(0, MAX_TEXT_CHARS), method: "decoded" });
    }

    // 3. PDFs and images — the model reads the file natively and transcribes.
    if (MODEL_MIMES.has(mime) || ext === "pdf") {
      const result = await completeClaudeText({
        system: "You transcribe documents verbatim. Output ONLY the document's full text content, preserving headings, lists and table rows as plain text lines. No commentary, no summaries, no markdown fences.",
        messages: [{ role: "user", content: `Transcribe the attached document (${filename || mime}) in full.` }],
        fileAttachment: { base64: payload.file, mimeType: mime || "application/pdf", name: filename || undefined },
        maxTokens: 16_000,
      });
      const text = (result.text ?? "").trim();
      if (!text) return jsonResponse({ error: "The document produced no readable text." }, 422);
      return jsonResponse({ text: text.slice(0, MAX_TEXT_CHARS), method: "model" });
    }

    // 4. Unknown type — try a UTF-8 decode; accept it only if it looks like text.
    const guess = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const printable = guess.replace(/[^\x20-\x7E\s -￿]/g, "");
    if (guess.length && printable.length / guess.length > 0.9 && printable.trim().length > 40) {
      return jsonResponse({ text: printable.slice(0, MAX_TEXT_CHARS).trim(), method: "decoded" });
    }
    return jsonResponse({ error: `Cannot read .${ext || "this"} files — export to PDF or paste the text instead.` }, 415);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/provider key is not configured/i.test(message)) {
      return jsonResponse({ error: "Reading PDFs and images needs an AI provider — connect one in AI Settings, or paste the text." }, 501);
    }
    console.error("flow-extract error", message.slice(0, 300));
    return jsonResponse({ error: "Could not read that file — paste the text instead." }, 502);
  }
});
