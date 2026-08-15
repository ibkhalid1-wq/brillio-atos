/**
 * Render a handoff markdown file as a Word document.
 *
 * Not wired into `npm run validate` and `docx` is deliberately NOT a dependency —
 * one document does not justify a package in everyone's install. To regenerate:
 *
 *   npm i -D docx
 *   node scripts/docx/build-handoff-docx.mjs docs/aura/azure-environment-setup.md out.docx
 *
 * THE MARKDOWN IS THE SOURCE. This renders it; it must never become a fork of it.
 *
 * A focused markdown renderer rather than a hand-transcription: the source doc is
 * the thing under version control, so the .docx has to be regenerable from it, not
 * a fork of it that drifts.
 */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TableOfContents,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageOrientation,
  Header, Footer, PageNumber, LevelFormat, convertInchesToTwip, ExternalHyperlink,
} = require("docx");

const SRC = process.argv[2];
const OUT = process.argv[3];
const md = fs.readFileSync(SRC, "utf8");

// ── palette: Azure-adjacent blues, warm neutral for code, red for the risk callouts
const INK = "1B1B1F", MUTED = "5A5F६B".replace("६", "6"), RULE = "D6DAE2";
const ACCENT = "0F5B9E";      // heading blue
const ACCENT_SOFT = "EAF1F8"; // table header fill
const CODE_BG = "F4F5F7", CODE_INK = "24292F";
const PAGE = { width: 12240, height: 15840 };   // US Letter, DXA
const CONTENT_W = PAGE.width - convertInchesToTwip(1) * 2;

/** Inline markdown → TextRun[]. Handles `code`, **bold**, *italic*, [text](url). */
function runs(text, base = {}) {
  const out = [];
  // Split on the inline constructs, keeping delimiters.
  const re = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0, m;
  const push = (t, extra) => { if (t) out.push(new TextRun({ text: t, ...base, ...extra })); };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const url = tok.slice(tok.indexOf("](") + 2, -1);
      if (/^https?:/.test(url)) {
        out.push(new ExternalHyperlink({
          link: url,
          children: [new TextRun({ text: label, ...base, style: "Hyperlink" })],
        }));
      } else {
        // Relative repo path — a Word reader cannot follow it, so show it as code.
        push(label, { font: "Consolas", color: CODE_INK });
      }
    } else if (tok.startsWith("`")) {
      push(tok.slice(1, -1), { font: "Consolas", size: 18, color: CODE_INK, shading: { type: ShadingType.CLEAR, fill: CODE_BG } });
    } else if (tok.startsWith("**")) {
      push(tok.slice(2, -2), { bold: true });
    } else {
      push(tok.slice(1, -1), { italics: true });
    }
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return out.length ? out : [new TextRun({ text: "", ...base })];
}

const body = (text, opts = {}) => new Paragraph({
  children: runs(text), spacing: { after: 140, line: 300 }, ...opts,
});

const codeBlock = (lines) => lines.map((l, i) => new Paragraph({
  children: [new TextRun({ text: l || " ", font: "Consolas", size: 17, color: CODE_INK })],
  shading: { type: ShadingType.CLEAR, fill: CODE_BG },
  spacing: { before: i === 0 ? 100 : 0, after: i === lines.length - 1 ? 160 : 0, line: 260 },
  indent: { left: convertInchesToTwip(0.18), right: convertInchesToTwip(0.18) },
  border: {
    left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 },
    ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: CODE_BG, space: 6 } } : {}),
    ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 2, color: CODE_BG, space: 6 } } : {}),
  },
}));

/** A markdown table block → a docx Table with dual widths (DXA on table AND cells). */
function tableFrom(rows) {
  const cells = rows.map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const header = cells[0];
  const dataRows = cells.slice(2);   // row 1 is the |---|---| separator
  const n = header.length;
  // First column carries the subject and gets more room; the rest share what is left.
  const first = Math.round(CONTENT_W * (n > 3 ? 0.26 : 0.34));
  const rest = Math.floor((CONTENT_W - first) / (n - 1));
  const widths = [first, ...Array(n - 1).fill(rest)];
  widths[n - 1] = CONTENT_W - widths.slice(0, n - 1).reduce((a, b) => a + b, 0); // exact sum
  const cell = (text, i, isHeader) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: ACCENT_SOFT } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: runs(text, isHeader ? { bold: true, color: ACCENT } : {}),
      spacing: { after: 0, line: 260 },
    })],
  });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((c, i) => cell(c, i, true)) }),
      ...dataRows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
}

// ── parse ────────────────────────────────────────────────────────────────────────
const lines = md.split("\n");
const children = [];
let i = 0;

// Title block, then the rest of the document from the source.
children.push(
  new Paragraph({
    children: [new TextRun({ text: "ATOS Flow on Azure", bold: true, size: 56, color: ACCENT })],
    spacing: { before: 1400, after: 60 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Environment setup and Supabase exit", size: 32, color: MUTED })],
    spacing: { after: 320 },
  }),
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT } },
    spacing: { after: 260 },
  }),
  new Paragraph({
    children: [
      new TextRun({ text: "Engineering handoff", bold: true, size: 22 }),
      new TextRun({ text: "   ·   13 August 2026   ·   measured against commit ", size: 22, color: MUTED }),
      new TextRun({ text: "b734df5", font: "Consolas", size: 20, color: CODE_INK }),
    ],
    spacing: { after: 900 },
  }),
  new Paragraph({
    children: [new TextRun({ text: "Contents", bold: true, size: 26, color: ACCENT })],
    spacing: { after: 160 },
  }),
  new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new TextRun("")], pageBreakBefore: true }),
);

while (i < lines.length) {
  const line = lines[i];

  if (i < 12 && /^# /.test(line)) { i++; continue; }          // title handled above
  if (/^---\s*$/.test(line)) {                                 // horizontal rule
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE } },
      spacing: { before: 120, after: 240 },
    }));
    i++; continue;
  }
  if (/^```/.test(line)) {                                     // fenced code
    const buf = [];
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
    i++;
    children.push(...codeBlock(buf));
    continue;
  }
  if (/^\|/.test(line)) {                                      // table
    const buf = [];
    while (i < lines.length && /^\|/.test(lines[i])) buf.push(lines[i++]);
    children.push(tableFrom(buf));
    children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 160 } }));
    continue;
  }
  if (/^### /.test(line)) {
    children.push(new Paragraph({
      children: runs(line.slice(4), { bold: true, size: 24, color: INK }),
      heading: HeadingLevel.HEADING_3, spacing: { before: 280, after: 120 },
    }));
    i++; continue;
  }
  if (/^## /.test(line)) {
    children.push(new Paragraph({
      children: runs(line.slice(3), { bold: true, size: 30, color: ACCENT }),
      heading: HeadingLevel.HEADING_2, spacing: { before: 420, after: 160 },
    }));
    i++; continue;
  }
  if (/^# /.test(line)) {
    children.push(new Paragraph({
      children: runs(line.slice(2), { bold: true, size: 36, color: ACCENT }),
      heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 },
    }));
    i++; continue;
  }
  if (/^\s*-\s+/.test(line)) {                                 // bullet (may wrap)
    let text = line.replace(/^\s*-\s+/, "");
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[-\d]/.test(lines[i + 1])) {
      text += " " + lines[++i].trim();
    }
    children.push(new Paragraph({
      children: runs(text), numbering: { reference: "bullets", level: 0 },
      spacing: { after: 100, line: 300 },
    }));
    i++; continue;
  }
  if (/^\d+\.\s+/.test(line)) {                                // ordered (may wrap)
    let text = line.replace(/^\d+\.\s+/, "");
    while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*[-\d]/.test(lines[i + 1])) {
      text += " " + lines[++i].trim();
    }
    children.push(new Paragraph({
      children: runs(text), numbering: { reference: "ordered", level: 0 },
      spacing: { after: 100, line: 300 },
    }));
    i++; continue;
  }
  if (line.trim() === "") { i++; continue; }

  // paragraph — join soft-wrapped lines
  let text = line.trim();
  while (i + 1 < lines.length && lines[i + 1].trim() !== ""
         && !/^(#|\||```|---|\s*-\s|\d+\.\s)/.test(lines[i + 1])) {
    text += " " + lines[++i].trim();
  }
  children.push(body(text));
  i++;
}

// ── document ─────────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: "Brillio — ATOS Flow",
  title: "ATOS Flow on Azure — environment setup and Supabase exit",
  description: "Engineering handoff for standing ATOS Flow up on Azure with Azure Database for PostgreSQL.",
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 21, color: INK }, paragraph: { spacing: { line: 300 } } },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.18) } } },
        }],
      },
      {
        reference: "ordered",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.34), hanging: convertInchesToTwip(0.22) } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE.width, height: PAGE.height, orientation: PageOrientation.PORTRAIT },
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({ text: "ATOS Flow on Azure — environment setup and Supabase exit", size: 16, color: MUTED })],
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE } },
          spacing: { after: 200 },
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: "Page ", size: 16, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
            new TextRun({ text: " of ", size: 16, color: MUTED }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("wrote", OUT, buf.length, "bytes");
});
