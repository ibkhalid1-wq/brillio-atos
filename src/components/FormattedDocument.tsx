import React, { Fragment, type CSSProperties, type ReactNode } from "react";

interface IndentedLine {
  text: string;
  indent: number;
}

type DocumentNode =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "subheading"; text: string }
  | { type: "paragraph"; lines: IndentedLine[] }
  | { type: "bullets"; items: IndentedLine[] }
  | { type: "numbered"; items: IndentedLine[]; start: number }
  | { type: "blockquote"; text: string }
  | { type: "table"; rows: string[] };

interface FormattedDocumentProps {
  content?: string | null;
  compact?: boolean;
  emptyState?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function getHeadingLevel(line: string): number {
  const trimmed = line.trim();
  if (/^###\s+/.test(trimmed)) return 3;
  if (/^##\s+/.test(trimmed)) return 2;
  if (/^#\s+/.test(trimmed)) return 1;
  return 0;
}

function normalizeHeadingText(line: string): string {
  return line
    .trim()
    .replace(/^#{1,3}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__([^_]+)__$/, "$1")
    .trim();
}

function looksLikeBoldHeading(line: string): boolean {
  const trimmed = line.trim();
  return /^(\*\*|__)[^*_].+(\*\*|__)$/.test(trimmed) && trimmed.split(/\s+/).length <= 8;
}

function looksLikeNaturalHeading(line: string, nextLine = ""): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (getHeadingLevel(trimmed)) return false;
  if (looksLikeBoldHeading(trimmed)) return true;
  if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^\|.+\|$/.test(trimmed)) return false;
  if (trimmed.length > 72) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.replace(/:\s*$/, "").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 7) return false;
  const titleCaseLike = words.every((word) => /^[A-Z0-9][A-Za-z0-9/&+()\-:%]*$/.test(word));
  const shortFollowLine = !String(nextLine || "").trim() || String(nextLine || "").trim().length > 20;
  return (trimmed.endsWith(":") || titleCaseLike) && shortFollowLine;
}

function isBulletLine(line: string): boolean {
  return /^[-*•]\s+/.test(line.trim());
}

function isNumberedLine(line: string): boolean {
  return /^\d+\.\s+/.test(line.trim());
}

function getNumberedLineStart(line: string): number {
  const match = line.trim().match(/^(\d+)\.\s+/);
  return match ? Number(match[1]) : 1;
}

function isQuoteLine(line: string): boolean {
  return /^>\s+/.test(line.trim());
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\|.+\|$/.test(trimmed);
}

function getLogicalIndent(line: string): number {
  const leadingWhitespace = (line.match(/^\s*/) || [""])[0].replace(/\t/g, "  ");
  return Math.max(0, Math.floor(leadingWhitespace.length / 2));
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      parts.push(<strong key={key} style={{ fontWeight: 700, color: "#0f172a" }}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={key}
          style={{
            background: "#e2e8f0",
            color: "#0f172a",
            borderRadius: 6,
            padding: "2px 6px",
            fontSize: "0.92em",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={key} style={{ fontStyle: "italic", color: "#334155" }}>{token.slice(1, -1)}</em>);
    } else {
      parts.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function parseDocumentNodes(content: string): DocumentNode[] {
  const lines = content.split("\n");
  const nodes: DocumentNode[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const rawCurrentLine = lines[cursor] || "";
    const currentLine = rawCurrentLine.trim();
    const nextLine = (lines[cursor + 1] || "").trim();

    if (!currentLine) {
      cursor += 1;
      continue;
    }

    const headingLevel = getHeadingLevel(currentLine);
    if (headingLevel === 1) {
      nodes.push({ type: "title", text: normalizeHeadingText(currentLine) });
      cursor += 1;
      continue;
    }
    if (headingLevel === 2) {
      nodes.push({ type: "heading", text: normalizeHeadingText(currentLine) });
      cursor += 1;
      continue;
    }
    if (headingLevel === 3) {
      nodes.push({ type: "subheading", text: normalizeHeadingText(currentLine) });
      cursor += 1;
      continue;
    }

    if (looksLikeBoldHeading(currentLine) || looksLikeNaturalHeading(currentLine, nextLine)) {
      nodes.push({
        type: nodes.length === 0 ? "heading" : "subheading",
        text: normalizeHeadingText(currentLine),
      });
      cursor += 1;
      continue;
    }

    if (isQuoteLine(currentLine)) {
      const quoteLines: string[] = [];
      while (cursor < lines.length && isQuoteLine(lines[cursor] || "")) {
        quoteLines.push((lines[cursor] || "").trim().replace(/^>\s+/, ""));
        cursor += 1;
      }
      nodes.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    if (isBulletLine(currentLine)) {
      const items: IndentedLine[] = [];
      while (cursor < lines.length && isBulletLine(lines[cursor] || "")) {
        const rawLine = lines[cursor] || "";
        items.push({
          text: rawLine.trim().replace(/^[-*•]\s+/, "").trim(),
          indent: getLogicalIndent(rawLine),
        });
        cursor += 1;
      }
      nodes.push({ type: "bullets", items });
      continue;
    }

    if (isNumberedLine(currentLine)) {
      const items: IndentedLine[] = [];
      const start = getNumberedLineStart(currentLine);
      while (cursor < lines.length && isNumberedLine(lines[cursor] || "")) {
        const rawLine = lines[cursor] || "";
        items.push({
          text: rawLine.trim().replace(/^\d+\.\s+/, "").trim(),
          indent: getLogicalIndent(rawLine),
        });
        cursor += 1;
      }
      nodes.push({ type: "numbered", items, start });
      continue;
    }

    if (isTableLine(currentLine)) {
      const rows: string[] = [];
      while (cursor < lines.length && isTableLine(lines[cursor] || "")) {
        rows.push((lines[cursor] || "").trim());
        cursor += 1;
      }
      nodes.push({ type: "table", rows });
      continue;
    }

    const paragraphLines: IndentedLine[] = [];
    while (cursor < lines.length) {
      const rawLine = lines[cursor] || "";
      const value = rawLine.trim();
      if (
        !value
        || getHeadingLevel(value)
        || looksLikeBoldHeading(value)
        || looksLikeNaturalHeading(value, lines[cursor + 1] || "")
        || isQuoteLine(value)
        || isBulletLine(value)
        || isNumberedLine(value)
        || isTableLine(value)
      ) {
        break;
      }
      paragraphLines.push({
        text: value,
        indent: getLogicalIndent(rawLine),
      });
      cursor += 1;
    }

    if (paragraphLines.length) {
      nodes.push({ type: "paragraph", lines: paragraphLines });
      continue;
    }

    cursor += 1;
  }

  return nodes;
}

export function FormattedDocument({
  content,
  compact = false,
  emptyState = "No document content available yet.",
  className,
  style,
}: FormattedDocumentProps) {
  const text = String(content || "").trim();

  if (!text) {
    return (
      <div
        className={className}
        style={{
          fontSize: compact ? 11.5 : 12.5,
          color: "#64748b",
          lineHeight: compact ? 1.62 : 1.74,
          ...style,
        }}
      >
        {emptyState}
      </div>
    );
  }

  const nodes = parseDocumentNodes(text);
  const indentSpacing = compact ? 12 : 16;

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gap: compact ? 10 : 14,
        ...style,
      }}
    >
      {nodes.map((node, blockIndex) => {
        if (node.type === "title") {
          return (
            <div key={`doc-node-${blockIndex}`} style={{ fontSize: compact ? 18 : 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", lineHeight: 1.18 }}>
              {renderInlineText(node.text, `title-${blockIndex}`)}
            </div>
          );
        }

        if (node.type === "heading") {
          return (
            <div key={`doc-node-${blockIndex}`} style={{ fontSize: compact ? 14.5 : 16.5, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", lineHeight: 1.22 }}>
              {renderInlineText(node.text, `heading-${blockIndex}`)}
            </div>
          );
        }

        if (node.type === "subheading") {
          return (
            <div key={`doc-node-${blockIndex}`} style={{ fontSize: compact ? 12.5 : 13.75, fontWeight: 800, color: "#1e293b", letterSpacing: "-0.01em", lineHeight: 1.3 }}>
              {renderInlineText(node.text, `subheading-${blockIndex}`)}
            </div>
          );
        }

        if (node.type === "blockquote") {
          return (
            <blockquote
              key={`doc-node-${blockIndex}`}
              style={{
                margin: 0,
                borderLeft: "4px solid #cbd5e1",
                background: "rgba(248,250,252,0.92)",
                borderRadius: "0 12px 12px 0",
                padding: compact ? "10px 12px" : "12px 14px",
                color: "#475569",
                fontSize: compact ? 11.5 : 12.5,
                lineHeight: compact ? 1.62 : 1.72,
              }}
            >
              {renderInlineText(node.text, `quote-${blockIndex}`)}
            </blockquote>
          );
        }

        if (node.type === "bullets") {
          return (
            <ul
              key={`doc-node-${blockIndex}`}
              style={{
                margin: 0,
                paddingLeft: compact ? 22 : 26,
                display: "grid",
                gap: compact ? 5 : 6,
                color: "#1f2937",
              }}
            >
              {node.items.map((item, index) => (
                <li
                  key={`doc-node-${blockIndex}-bullet-${index}`}
                  style={{
                    fontSize: compact ? 11.5 : 12.75,
                    lineHeight: compact ? 1.62 : 1.74,
                    paddingLeft: 2,
                    marginLeft: item.indent * indentSpacing,
                  }}
                >
                  {renderInlineText(item.text, `bullet-${blockIndex}-${index}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (node.type === "numbered") {
          return (
            <ol
              key={`doc-node-${blockIndex}`}
              start={node.start}
              style={{
                margin: 0,
                paddingLeft: compact ? 22 : 26,
                display: "grid",
                gap: compact ? 5 : 6,
                color: "#1f2937",
              }}
            >
              {node.items.map((item, index) => (
                <li
                  key={`doc-node-${blockIndex}-numbered-${index}`}
                  style={{
                    fontSize: compact ? 11.5 : 12.75,
                    lineHeight: compact ? 1.62 : 1.74,
                    paddingLeft: 2,
                    marginLeft: item.indent * indentSpacing,
                  }}
                >
                  {renderInlineText(item.text, `numbered-${blockIndex}-${index}`)}
                </li>
              ))}
            </ol>
          );
        }

        if (node.type === "table") {
          return (
            <div
              key={`doc-node-${blockIndex}`}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                background: "rgba(248,250,252,0.94)",
                padding: compact ? "10px 12px" : "12px 14px",
                overflowX: "auto",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: compact ? 10.5 : 11.5,
                  lineHeight: 1.6,
                  color: "#334155",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {node.rows.map((row, index) => (
                  <div key={`doc-node-${blockIndex}-row-${index}`}>{row}</div>
                ))}
              </div>
            </div>
          );
        }

        const paragraphLines = node.lines.filter((line) => line.text.trim());
        if (paragraphLines.length <= 1) {
          const singleLine = paragraphLines[0];
          return (
            <p
              key={`doc-node-${blockIndex}`}
              style={{
                margin: 0,
                paddingLeft: (singleLine?.indent || 0) * indentSpacing,
                fontSize: compact ? 11.85 : 13.25,
                color: "#1f2937",
                lineHeight: compact ? 1.72 : 1.88,
              }}
            >
              {renderInlineText(singleLine?.text || "", `paragraph-${blockIndex}`).map((part, index) => (
                <Fragment key={`paragraph-${blockIndex}-${index}`}>{part}</Fragment>
              ))}
            </p>
          );
        }

        return (
          <div
            key={`doc-node-${blockIndex}`}
            style={{
              display: "grid",
              gap: compact ? 4 : 6,
              margin: 0,
              fontSize: compact ? 11.85 : 13.25,
              color: "#1f2937",
              lineHeight: compact ? 1.72 : 1.88,
            }}
          >
            {paragraphLines.map((line, lineIndex) => (
              <div
                key={`paragraph-${blockIndex}-${lineIndex}`}
                style={{
                  paddingLeft: line.indent * indentSpacing,
                }}
              >
                {renderInlineText(line.text, `paragraph-${blockIndex}-${lineIndex}`).map((part, index) => (
                  <Fragment key={`paragraph-${blockIndex}-${lineIndex}-${index}`}>{part}</Fragment>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
