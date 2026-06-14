/**
 * Client-side document text extraction.
 *
 * Supported formats:
 *   .pptx  – ZIP-based Office Open XML; extracts text from slide XML nodes
 *   .docx  – ZIP-based Office Open XML; extracts text from document.xml
 *   .txt   – plain text
 *   .csv   – plain text
 *   .pdf   – raw text extraction (best-effort; embedded-font PDFs may be empty)
 *
 * Returns a plain-text string capped at ~20,000 characters.
 */

const MAX_CHARS = 20_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read an ArrayBuffer from a File */
function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Read a File as plain text */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

/**
 * Strip XML tags and decode basic entities from an XML string.
 * Fast enough for presentation / document XML blobs.
 */
function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")        // remove tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x[0-9a-fA-F]+;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Dynamically import JSZip (it's a production dep). */
async function loadJSZip(): Promise<typeof import("jszip")["default"] | null> {
  try {
    const mod = await import("jszip");
    return mod.default ?? mod as unknown as typeof import("jszip")["default"];
  } catch {
    return null;
  }
}

// ── PPTX parser ──────────────────────────────────────────────────────────────

async function parsePptx(buffer: ArrayBuffer): Promise<string> {
  const JSZip = await loadJSZip();
  if (!JSZip) throw new Error("JSZip not available");

  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
      const nb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
      return na - nb;
    });

  const parts: string[] = [];
  for (const entry of slideEntries) {
    const xml = await zip.files[entry].async("string");
    // Extract <a:t> text runs from slide XML
    const textRuns = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    if (textRuns.length) {
      parts.push(`[Slide ${parts.length + 1}] ${textRuns.join(" ")}`);
    }
  }

  return stripXml(parts.join("\n\n"));
}

// ── DOCX parser ──────────────────────────────────────────────────────────────

async function parseDocx(buffer: ArrayBuffer): Promise<string> {
  const JSZip = await loadJSZip();
  if (!JSZip) throw new Error("JSZip not available");

  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.files["word/document.xml"];
  if (!docFile) throw new Error("word/document.xml not found in DOCX");

  const xml = await docFile.async("string");
  // Extract <w:t> text runs
  const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  return stripXml(texts.join(" "));
}

// ── PDF parser (best-effort) ──────────────────────────────────────────────────

async function parsePdf(buffer: ArrayBuffer): Promise<string> {
  // Basic heuristic: scan for text-looking bytes in the PDF stream.
  // For PDFs with embedded fonts this won't give meaningful results,
  // but for text-heavy PDFs it extracts readable content.
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);

  // Extract text between BT...ET blocks (PDF text objects)
  const lines: string[] = [];
  for (const match of raw.matchAll(/BT([\s\S]*?)ET/g)) {
    const block = match[1];
    // Pull out strings between () or <>
    const strMatches = [...block.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)];
    const extracted = strMatches
      .map((m) => m[1].replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\\/g, "\\").replace(/\\\(/g, "(").replace(/\\\)/g, ")"))
      .join(" ")
      .trim();
    if (extracted.length > 3) lines.push(extracted);
  }

  return lines.join("\n").slice(0, MAX_CHARS) || "[PDF text could not be extracted — embedded font or scanned document]";
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ParsedDocument {
  filename: string;
  mimeType: string;
  text: string;
  wordCount: number;
  truncated: boolean;
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const name = file.name.toLowerCase();
  const mime = file.type;

  let text = "";

  try {
    if (name.endsWith(".pptx")) {
      const buf = await readFileBuffer(file);
      text = await parsePptx(buf);
    } else if (name.endsWith(".docx")) {
      const buf = await readFileBuffer(file);
      text = await parseDocx(buf);
    } else if (name.endsWith(".pdf")) {
      const buf = await readFileBuffer(file);
      text = await parsePdf(buf);
    } else if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".md")) {
      text = await readFileText(file);
    } else if (name.endsWith(".xlsx")) {
      // Fallback: treat as ZIP and pull any text from shared strings
      const JSZip = await loadJSZip();
      if (JSZip) {
        const buf = await readFileBuffer(file);
        const zip = await JSZip.loadAsync(buf);
        const ssFile = zip.files["xl/sharedStrings.xml"];
        if (ssFile) {
          const xml = await ssFile.async("string");
          const texts = [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
          text = texts.join(", ").slice(0, MAX_CHARS);
        }
      }
      if (!text) text = `[XLSX: ${file.name} — text extraction limited]`;
    } else {
      // Try reading as text
      try {
        text = await readFileText(file);
      } catch {
        text = `[${file.name} — binary file, text not extractable]`;
      }
    }
  } catch (err) {
    text = `[Error parsing ${file.name}: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS) + "\n\n[…truncated]";

  return {
    filename: file.name,
    mimeType: mime || "application/octet-stream",
    text: text.trim(),
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
    truncated,
  };
}

/** Format parsed documents into a Copilot context block */
export function formatDocumentsForPrompt(docs: ParsedDocument[]): string {
  return docs
    .map((d) => `--- Document: ${d.filename} (${d.wordCount} words${d.truncated ? ", truncated" : ""}) ---\n${d.text}`)
    .join("\n\n");
}
