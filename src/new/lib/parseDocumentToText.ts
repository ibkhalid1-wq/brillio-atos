/**
 * parseDocumentToText
 * Converts an uploaded File to plain text for ATOS agent ingestion.
 *
 * Supported formats:
 *   Documents : PDF, DOCX, PPTX, XLSX/XLS/ODS, ODT, DOC (best-effort)
 *   Web       : HTML, HTM, XML, Markdown (.md)
 *   Images    : PNG, JPG, JPEG, WEBP, BMP, TIFF (OCR via Tesseract.js)
 *   Data      : CSV, TSV, JSON, JSONL
 *   Design    : Figma JSON export (.fig.json / .figma.json)
 *   Email     : EML (plain text extraction)
 *   Archives  : ZIP (recursively extracts and concatenates supported files)
 *   Plain     : TXT, LOG, ENV, YAML, TOML
 */

export type SupportedFileType =
  | "pdf" | "docx" | "pptx" | "xlsx" | "odt" | "doc"
  | "html" | "xml" | "markdown"
  | "image"
  | "csv" | "tsv" | "json" | "jsonl"
  | "figma"
  | "eml"
  | "zip"
  | "text";

export type ParseResult =
  | {
    ok: true;
    text: string;
    fileType: SupportedFileType;
    wordCount: number;
    pageCount?: number;
    sheetCount?: number;
    slideCount?: number;
    ocrConfidence?: number;
  }
  | {
    ok: false;
    error: string;
    fileType?: SupportedFileType;
  };

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MIN_TEXT_LENGTH = 40;

export function detectFileType(file: File): SupportedFileType | null {
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop() ?? "";
  const mime = file.type.toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === "pptx" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (["xlsx", "xls", "ods"].includes(ext)) return "xlsx";
  if (ext === "odt" || mime === "application/vnd.oasis.opendocument.text") return "odt";
  if (ext === "doc") return "doc";
  if (["html", "htm"].includes(ext) || mime === "text/html") return "html";
  if (ext === "xml" || mime === "application/xml" || mime === "text/xml") return "xml";
  if (["md", "mdx", "markdown"].includes(ext)) return "markdown";
  if (["png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif"].includes(ext) || mime.startsWith("image/")) return "image";
  if (ext === "csv" || mime === "text/csv") return "csv";
  if (ext === "tsv" || mime === "text/tab-separated-values") return "tsv";
  if (ext === "jsonl") return "jsonl";
  if (ext === "json" || mime === "application/json") {
    if (name.includes(".fig") || name.includes("figma")) return "figma";
    return "json";
  }
  if (ext === "eml" || mime === "message/rfc822") return "eml";
  if (ext === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
  if (["txt", "log", "env", "yaml", "yml", "toml", "ini", "conf"].includes(ext) || mime.startsWith("text/")) return "text";

  return null;
}

export const FILE_TYPE_LABELS: Record<SupportedFileType, string> = {
  pdf: "PDF Document",
  docx: "Word Document",
  pptx: "PowerPoint Presentation",
  xlsx: "Excel Spreadsheet",
  odt: "OpenDocument Text",
  doc: "Word 97-2003 Document",
  html: "HTML Page",
  xml: "XML Document",
  markdown: "Markdown",
  image: "Image (OCR)",
  csv: "CSV Spreadsheet",
  tsv: "TSV Spreadsheet",
  json: "JSON",
  jsonl: "JSON Lines",
  figma: "Figma Export",
  eml: "Email",
  zip: "ZIP Archive",
  text: "Plain Text",
};

export const ACCEPTED_FILE_EXTENSIONS =
  ".pdf,.docx,.pptx,.xlsx,.xls,.ods,.odt,.doc,.html,.htm,.xml,.md,.mdx,.markdown," +
  ".png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif," +
  ".csv,.tsv,.json,.jsonl,.eml,.zip," +
  ".txt,.log,.yaml,.yml,.toml,.env,.ini,.conf";

export function getFileTypeEmoji(type: string | null): string {
  const map: Record<string, string> = {
    pdf: "📄",
    docx: "📝",
    pptx: "📊",
    xlsx: "📋",
    image: "🖼️",
    html: "🌐",
    markdown: "✏️",
    csv: "📊",
    json: "{ }",
    figma: "🎨",
    eml: "📧",
    zip: "🗜️",
    text: "📃",
    odt: "📝",
    xml: "🔖",
    tsv: "📋",
    jsonl: "{ }",
    doc: "📝",
  };
  return map[type ?? ""] ?? "📄";
}

export async function parseDocumentToText(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File too large. Maximum size is 50 MB (this file is ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  }

  const fileType = detectFileType(file);
  if (!fileType) {
    return {
      ok: false,
      error: `Unsupported file type "${file.name.split(".").pop()}". Supported: PDF, DOCX, PPTX, XLSX, HTML, Markdown, PNG/JPG, CSV, JSON, ZIP, EML and more.`,
    };
  }

  try {
    switch (fileType) {
      case "pdf": return await parsePdf(file);
      case "docx": return await parseDocx(file);
      case "pptx": return await parsePptx(file);
      case "xlsx": return await parseExcel(file);
      case "odt": return await parseOdt(file);
      case "doc": return await parseDocLegacy(file);
      case "html": return await parseHtml(file);
      case "xml": return await parseXml(file);
      case "markdown": return await parseMarkdown(file);
      case "image": return await parseImage(file);
      case "csv": return await parseDelimited(file, ",");
      case "tsv": return await parseDelimited(file, "\t");
      case "json": return await parseJson(file);
      case "jsonl": return await parseJsonl(file);
      case "figma": return await parseFigma(file);
      case "eml": return await parseEml(file);
      case "zip": return await parseZip(file);
      case "text": return await parseText(file);
      default:
        return {
          ok: false,
          error: `No parser is configured for ${file.name}.`,
          fileType,
        };
    }
  } catch (error: any) {
    return {
      ok: false,
      error: `Failed to parse ${FILE_TYPE_LABELS[fileType]}: ${error?.message ?? "Unknown error"}`,
      fileType,
    };
  }
}

async function parsePdf(file: File): Promise<ParseResult> {
  const pdfjsLib = await import("pdfjs-dist");
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  const pdf = await (pdfjsLib as any).getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lineText = content.items
      .map((item: any) => item.str)
      .join(" ")
      .replace(/\s{3,}/g, "  ");

    if (lineText.trim()) {
      pages.push(`[Page ${i}]\n${lineText}`);
    }
  }

  const rawText = pages.join("\n\n");
  if (rawText.trim().length < 200 && pdf.numPages > 0) {
    return await ocrPdfDocument(pdf);
  }

  return finish(rawText, "pdf", { pageCount: pdf.numPages });
}

async function parseDocx(file: File): Promise<ParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return finish(result.value, "docx");
}

async function parsePptx(file: File): Promise<ParseResult> {
  const officeParser = await import("officeparser");
  // officeparser v7+ exports parseOffice; older builds exported parseOfficeAsync
  const parseFn = (
    (officeParser as any).parseOffice
    || (officeParser as any).default?.parseOffice
    || (officeParser as any).parseOfficeAsync
    || (officeParser as any).default?.parseOfficeAsync
  );

  if (typeof parseFn !== "function") {
    return { ok: false, error: "PowerPoint parsing is unavailable in this build.", fileType: "pptx" };
  }

  const result = await parseFn(await file.arrayBuffer(), { outputErrorToConsole: false });
  // officeparser v7 returns an AST with a toText() method; older versions returned a plain string
  const text: string = (typeof result === "string")
    ? result
    : (typeof (result as any)?.toText === "function")
      ? (result as any).toText()
      : String(result ?? "");
  const slideCount = (text.match(/\[Slide \d+\]/g) ?? []).length || undefined;
  return finish(text, "pptx", { slideCount });
}

async function parseExcel(file: File): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellText: true,
    cellDates: true,
  });

  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
    if (rows.trim()) {
      sections.push(`[Sheet: ${sheetName}]\n${rows}`);
    }
  }

  return finish(sections.join("\n\n"), "xlsx", { sheetCount: workbook.SheetNames.length });
}

async function parseOdt(file: File): Promise<ParseResult> {
  const { ZipReader, BlobReader, TextWriter } = await import("@zip.js/zip.js");
  const zipReader = new ZipReader(new BlobReader(file));
  try {
    const entries = await zipReader.getEntries();
    const contentEntry = entries.find((entry: any) => entry.filename === "content.xml");
    if (!contentEntry) {
      return { ok: false, error: "Could not read ODT content.", fileType: "odt" };
    }

    const content = await contentEntry.getData?.(new TextWriter());
    if (typeof content !== "string") {
      return { ok: false, error: "Could not decode ODT content.", fileType: "odt" };
    }

    const text = content.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
    return finish(text, "odt");
  } finally {
    await zipReader.close();
  }
}

async function parseDocLegacy(file: File): Promise<ParseResult> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (result.value.trim().length > MIN_TEXT_LENGTH) {
      return finish(result.value, "doc");
    }
  } catch {
    // Fall through to the explicit guidance below.
  }

  return {
    ok: false,
    error: "Legacy .doc format could not be parsed. Please save as .docx and re-upload.",
    fileType: "doc",
  };
}

async function parseHtml(file: File): Promise<ParseResult> {
  const html = await file.text();
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(html, "text/html");

  // Recover embedded structured data BEFORE stripping scripts. Exported/SPA HTML
  // is frequently a JS-rendered shell whose real content lives in a JSON
  // bootstrap (<script type="application/json"> or `window.__DATA__ = {…}`),
  // not in static elements — dropping scripts outright loses everything.
  const dataBlocks = extractEmbeddedHtmlData(documentNode);

  ["script", "style", "nav", "footer", "header", "aside"].forEach((tag) => {
    documentNode.querySelectorAll(tag).forEach((element) => element.remove());
  });

  // innerText is empty on DOMParser-created (non-rendered) documents, so fall
  // back to textContent. `??` would keep an empty string — use `||`.
  const visible = (documentNode.body?.innerText || documentNode.body?.textContent || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const text = [visible, ...dataBlocks].filter(Boolean).join("\n\n");

  return finish(text, "html");
}

/**
 * Pull machine-readable content out of an HTML document's scripts: JSON-LD and
 * `application/json` blocks, plus well-known SPA bootstrap globals
 * (window.__DATA__, __NEXT_DATA__, __NUXT__, __INITIAL_STATE__, __APP_DATA__).
 * Returns readable, pretty-printed JSON strings; skips anything unparseable so
 * minified app code is never dumped as noise.
 */
function extractEmbeddedHtmlData(documentNode: Document): string[] {
  const blocks: string[] = [];

  documentNode
    .querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')
    .forEach((element) => {
      const raw = element.textContent?.trim();
      if (raw) blocks.push(normaliseJsonOrRaw(raw));
    });

  const BOOTSTRAP_GLOBALS = ["__DATA__", "__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "__APP_DATA__"];
  documentNode.querySelectorAll("script:not([type]), script[type='text/javascript']").forEach((element) => {
    const src = element.textContent ?? "";
    for (const name of BOOTSTRAP_GLOBALS) {
      const json = extractBalancedAssignment(src, name);
      if (json) blocks.push(normaliseJsonOrRaw(json));
    }
  });

  return blocks;
}

/** Find `…<name> = { … }` and return the brace-balanced object/array literal. */
function extractBalancedAssignment(source: string, name: string): string | null {
  const marker = new RegExp(`${name}\\s*=\\s*([\\[{])`);
  const match = marker.exec(source);
  if (!match) return null;

  const open = match[1];
  const close = open === "{" ? "}" : "]";
  const start = match.index + match[0].length - 1;

  let depth = 0;
  let inString: '"' | "'" | null = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Validate + compact JSON (token-efficient so large blobs survive caps); raw on failure. */
function normaliseJsonOrRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

async function parseXml(file: File): Promise<ParseResult> {
  const raw = await file.text();
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(raw, "application/xml");
  const text = (documentNode.documentElement?.textContent ?? raw.replace(/<[^>]+>/g, " "))
    .replace(/\s{2,}/g, " ")
    .trim();
  return finish(text, "xml");
}

async function parseMarkdown(file: File): Promise<ParseResult> {
  const raw = await file.text();
  const text = raw
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return finish(text, "markdown");
}

async function parseImage(file: File): Promise<ParseResult> {
  return await ocrImageBlob(file, "image");
}

async function parseDelimited(file: File, delimiter: string): Promise<ParseResult> {
  const raw = await file.text();
  const lines = raw.split("\n").filter((line) => line.trim());
  const fileType: SupportedFileType = delimiter === "\t" ? "tsv" : "csv";

  if (!lines.length) {
    return { ok: false, error: "File appears to be empty.", fileType };
  }

  const headers = lines[0].split(delimiter).map((header) => header.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1, 201);
  const prose = rows.map((row) => {
    const cells = row.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    return headers
      .map((header, index) => `${header}: ${cells[index] ?? ""}`)
      .filter((pair) => !pair.endsWith(": "))
      .join(" | ");
  }).join("\n");

  const summary = lines.length > 201
    ? `\n\n[Note: File contains ${lines.length - 1} rows. First 200 shown above.]`
    : "";

  return finish(`Headers: ${headers.join(", ")}\n\n${prose}${summary}`, fileType);
}

async function parseJson(file: File): Promise<ParseResult> {
  const raw = await file.text();
  try {
    const parsed = JSON.parse(raw);
    return finish(JSON.stringify(parsed, null, 2), "json");
  } catch {
    return { ok: false, error: "File is not valid JSON.", fileType: "json" };
  }
}

async function parseJsonl(file: File): Promise<ParseResult> {
  const raw = await file.text();
  const lines = raw.split("\n").filter((line) => line.trim());
  const parsed = lines.slice(0, 100).map((line, index) => {
    try {
      return `[${index + 1}] ${JSON.stringify(JSON.parse(line), null, 0)}`;
    } catch {
      return `[${index + 1}] ${line}`;
    }
  });
  return finish(parsed.join("\n"), "jsonl");
}

async function parseFigma(file: File): Promise<ParseResult> {
  const raw = await file.text();
  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Figma export is not valid JSON.", fileType: "figma" };
  }

  const texts: string[] = [];

  function walk(node: any, depth = 0) {
    if (!node || typeof node !== "object" || depth > 20) return;

    if (node.name) texts.push(`[${node.type ?? "Node"}] ${node.name}`);
    if (node.characters) texts.push(`  Text: "${node.characters}"`);
    if (node.description) texts.push(`  Description: ${node.description}`);

    if (Array.isArray(node.children)) node.children.forEach((child: any) => walk(child, depth + 1));
    if (Array.isArray(node.nodes)) node.nodes.forEach((child: any) => walk(child, depth + 1));
  }

  walk(parsed);

  if (!texts.length) {
    return { ok: false, error: "No readable content found in Figma export.", fileType: "figma" };
  }

  const summary = [
    parsed.name ? `File: ${parsed.name}` : "",
    parsed.version ? `Version: ${parsed.version}` : "",
    parsed.lastModified ? `Last modified: ${parsed.lastModified}` : "",
    "",
    ...texts,
  ].filter(Boolean).join("\n");

  return finish(summary, "figma");
}

async function parseEml(file: File): Promise<ParseResult> {
  const raw = await file.text();
  const headers: string[] = [];
  const headerMatch = raw.match(/^(From|To|Subject|Date|Cc):\s*.+/gim);
  if (headerMatch) headers.push(...headerMatch);

  let body = raw;
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = raw.split(new RegExp(`--${escapedBoundary}`));
    const textPart = parts.find((part) => (
      part.includes("Content-Type: text/plain")
      || (!part.includes("Content-Type:") && part.trim().length > 50)
    ));
    if (textPart) body = textPart;
  }

  body = body
    .replace(/^[A-Za-z-]+:\s*.+\r?\n/gm, "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();

  const text = [...headers, "", body].join("\n").trim();
  return finish(text, "eml");
}

async function parseZip(file: File): Promise<ParseResult> {
  const { ZipReader, BlobReader, BlobWriter } = await import("@zip.js/zip.js");
  const zipReader = new ZipReader(new BlobReader(file));

  try {
    const entries = await zipReader.getEntries();
    const supportedEntries = entries.filter((entry: any) => {
      if (entry.directory) return false;
      const ext = entry.filename.split(".").pop()?.toLowerCase() ?? "";
      return [
        "pdf", "docx", "pptx", "xlsx", "xls", "ods", "txt", "md",
        "csv", "tsv", "json", "jsonl", "html", "xml", "eml", "yaml",
        "yml", "toml", "png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif",
      ].includes(ext);
    });

    if (!supportedEntries.length) {
      return { ok: false, error: "ZIP archive contains no supported document types.", fileType: "zip" };
    }

    const sections: string[] = [];
    for (const entry of supportedEntries.slice(0, 20)) {
      try {
        const innerBlob = await entry.getData?.(new BlobWriter());
        if (!(innerBlob instanceof Blob)) continue;
        const innerFile = new File([innerBlob], entry.filename, { type: innerBlob.type || "" });
        const result = await parseDocumentToText(innerFile);
        if (result.ok && result.text.trim().length > MIN_TEXT_LENGTH) {
          sections.push(`[File: ${entry.filename}]\n${result.text}`);
        }
      } catch {
        // Skip unreadable entries so one bad file does not block the bundle.
      }
    }

    if (!sections.length) {
      return { ok: false, error: "No readable content found in ZIP archive.", fileType: "zip" };
    }

    return finish(sections.join("\n\n---\n\n"), "zip");
  } finally {
    await zipReader.close();
  }
}

async function parseText(file: File): Promise<ParseResult> {
  return finish(await file.text(), "text");
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function finish(
  text: string,
  fileType: SupportedFileType,
  meta: { pageCount?: number; sheetCount?: number; slideCount?: number; ocrConfidence?: number } = {},
): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) {
    return {
      ok: false,
      error: "Document appears to be empty or contains no readable text.",
      fileType,
    };
  }

  return {
    ok: true,
    text: trimmed,
    fileType,
    wordCount: countWords(trimmed),
    ...meta,
  };
}

async function ocrPdfDocument(pdf: any): Promise<ParseResult> {
  const pageTexts: string[] = [];
  const confidences: number[] = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return { ok: false, error: "Canvas rendering is unavailable for OCR fallback.", fileType: "pdf" };
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) continue;

    const ocrResult = await ocrImageBlob(blob, "pdf");
    if (ocrResult.ok) {
      pageTexts.push(`[Page ${pageIndex}]\n${ocrResult.text}`);
      if (typeof ocrResult.ocrConfidence === "number") {
        confidences.push(ocrResult.ocrConfidence);
      }
    }
  }

  if (!pageTexts.length) {
    return { ok: false, error: "Scanned PDF does not contain readable text after OCR.", fileType: "pdf" };
  }

  const averageConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : undefined;

  return finish(pageTexts.join("\n\n"), "pdf", {
    pageCount: pdf.numPages,
    ocrConfidence: averageConfidence,
  });
}

async function ocrImageBlob(blob: Blob, fileType: "image" | "pdf"): Promise<ParseResult> {
  const Tesseract = await import("tesseract.js");
  const worker = await (Tesseract as any).createWorker("eng");

  try {
    const url = URL.createObjectURL(blob);
    const result = await worker.recognize(url);
    URL.revokeObjectURL(url);

    const text = result.data.text.trim();
    const confidence = result.data.confidence;

    if (text.length < MIN_TEXT_LENGTH) {
      return {
        ok: false,
        error: fileType === "pdf"
          ? "Scanned PDF does not contain readable text after OCR."
          : "Image does not contain readable text (OCR found insufficient content).",
        fileType,
      };
    }

    return {
      ok: true,
      text,
      fileType,
      wordCount: countWords(text),
      ocrConfidence: Math.round(confidence),
    };
  } finally {
    await worker.terminate();
  }
}
