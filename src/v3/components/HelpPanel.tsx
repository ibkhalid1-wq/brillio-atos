import React, { useMemo, useState } from "react";
import { ADAM_USER_GUIDE, searchUserGuide, type GuideArticle } from "@/lib/adamUserGuide";

// ─── Category meta ────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  "Getting Started":   { icon: "◎", color: "var(--v3-accent)" },
  "Phases":            { icon: "→", color: "var(--v3-green)" },
  "Agents":            { icon: "⬡", color: "#a78bfa" },
  "Governance":        { icon: "⊕", color: "var(--v3-amber)" },
  "Copilot":           { icon: "◇", color: "var(--v3-accent)" },
  "Decisions":         { icon: "⊖", color: "var(--v3-amber)" },
  "Reports":           { icon: "≡", color: "var(--v3-green)" },
  "Intelligence":      { icon: "✦", color: "#a78bfa" },
};

function categoryMeta(category: string) {
  return CATEGORY_META[category] ?? { icon: "◉", color: "var(--v3-text-muted)" };
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

function renderMarkdown(body: string): React.ReactNode[] {
  const lines = body.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let i = 0;

  // Inline styles: **bold**, `code`
  function inlineRender(text: string): React.ReactNode {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={idx} style={{ fontWeight: 700, color: "var(--v3-text-primary)" }}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={idx} style={{ fontFamily: "monospace", fontSize: "0.9em", background: "var(--v3-surface-3)", borderRadius: 3, padding: "1px 5px", color: "var(--v3-accent)" }}>{part.slice(1, -1)}</code>;
      }
      return part;
    });
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty
    if (!trimmed) { i++; continue; }

    // H1
    if (trimmed.startsWith("# ")) {
      nodes.push(
        <h1 key={key++} style={{ fontSize: 20, fontWeight: 800, color: "var(--v3-text-primary)", letterSpacing: "-0.02em", margin: "0 0 20px", lineHeight: 1.2, fontFamily: "var(--v3-font)" }}>
          {trimmed.slice(2)}
        </h1>
      );
      i++; continue;
    }

    // H2
    if (trimmed.startsWith("## ")) {
      nodes.push(
        <h2 key={key++} style={{ fontSize: 13, fontWeight: 700, color: "var(--v3-text-primary)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "24px 0 10px", borderBottom: "1px solid var(--v3-border-soft)", paddingBottom: 6, fontFamily: "var(--v3-font)" }}>
          {trimmed.slice(3)}
        </h2>
      );
      i++; continue;
    }

    // H3
    if (trimmed.startsWith("### ")) {
      nodes.push(
        <h3 key={key++} style={{ fontSize: 13, fontWeight: 700, color: "var(--v3-text-primary)", margin: "16px 0 6px", fontFamily: "var(--v3-font)" }}>
          {inlineRender(trimmed.slice(4))}
        </h3>
      );
      i++; continue;
    }

    // Table (detect | at start)
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse rows — skip separator rows (|---|)
      const rows = tableLines
        .filter((row) => !/^\s*\|[\s|:-]+\|\s*$/.test(row))
        .map((row) =>
          row.split("|")
            .filter((_, ci) => ci > 0 && ci < row.split("|").length - 1)
            .map((cell) => cell.trim())
        );
      if (rows.length > 0) {
        nodes.push(
          <table key={key++} style={{ width: "100%", borderCollapse: "collapse", margin: "12px 0", fontFamily: "var(--v3-font)", fontSize: 13 }}>
            <thead>
              <tr>
                {rows[0].map((cell, ci) => (
                  <th key={ci} style={{ textAlign: "left", padding: "7px 12px", background: "var(--v3-surface-2)", borderBottom: "1px solid var(--v3-border-soft)", fontSize: 11, fontWeight: 700, color: "var(--v3-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {inlineRender(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, ri) => (
                <tr key={ri} style={{ borderBottom: "1px solid var(--v3-border-soft)" }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "8px 12px", color: "var(--v3-text-secondary)", verticalAlign: "top" }}>
                      {inlineRender(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      continue;
    }

    // Bullet list
    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++} style={{ margin: "8px 0 12px", paddingLeft: 0, listStyle: "none" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0", fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.6, fontFamily: "var(--v3-font)" }}>
              <span style={{ color: "var(--v3-accent)", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>·</span>
              <span>{inlineRender(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} style={{ margin: "8px 0 12px", paddingLeft: 0, listStyle: "none", counterReset: "md-list" }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "4px 0", fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.6, fontFamily: "var(--v3-font)" }}>
              <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: "var(--v3-surface-3)", color: "var(--v3-text-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, marginTop: 1 }}>{ii + 1}</span>
              <span>{inlineRender(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph
    nodes.push(
      <p key={key++} style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.75, margin: "0 0 12px", fontFamily: "var(--v3-font)" }}>
        {inlineRender(trimmed)}
      </p>
    );
    i++;
  }

  return nodes;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface HelpPanelProps {
  onClose: () => void;
  initialQuery?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function HelpPanel({ onClose, initialQuery = "" }: HelpPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<GuideArticle | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const isSearching = query.trim().length > 0;
  const results = useMemo(() => (isSearching ? searchUserGuide(query, 30) : ADAM_USER_GUIDE), [query, isSearching]);

  // Group articles by category
  const categories = useMemo(() => {
    const cats: Record<string, GuideArticle[]> = {};
    ADAM_USER_GUIDE.forEach((a) => {
      if (!cats[a.category]) cats[a.category] = [];
      cats[a.category].push(a);
    });
    return cats;
  }, []);

  const categoryList = Object.keys(categories);

  const displayArticles = isSearching
    ? results
    : activeCategory
    ? categories[activeCategory] ?? []
    : null; // null = show category grid

  return (
    <>
      <div className="v3-sheet-overlay" onClick={onClose} />
      <div className="v3-help-sheet">
        {/* ── Header ── */}
        <div className="v3-help-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(selected || activeCategory) && !isSearching && (
              <button
                className="v3-button ghost"
                style={{ fontSize: 12, padding: "4px 8px" }}
                onClick={() => { if (selected) setSelected(null); else setActiveCategory(null); }}
              >
                ←
              </button>
            )}
            <div>
              <div className="v3-help-title">
                {selected ? selected.title : activeCategory ?? "Help & Guide"}
              </div>
              {!selected && !activeCategory && (
                <div className="v3-help-subtitle">Brillio ATOS · Agentic Transformation OS</div>
              )}
            </div>
          </div>
          <button className="v3-sheet-close" onClick={onClose} aria-label="Close help">×</button>
        </div>

        {/* ── Search ── */}
        <div className="v3-help-search-wrap">
          <svg className="v3-help-search-icon" width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            type="search"
            className="v3-help-search"
            aria-label="Search help articles"
            placeholder="Search articles…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); setActiveCategory(null); }}
            autoFocus={!initialQuery}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--v3-text-muted)", fontSize: 16, lineHeight: 1 }}
            >×</button>
          )}
        </div>

        {/* ── Body ── */}
        <div className="v3-help-body">

          {/* Article detail */}
          {selected ? (
            <div className="v3-help-article">
              {/* Article meta */}
              <div className="v3-help-article-meta">
                <span className="v3-chip muted" style={{ fontSize: 11 }}>{selected.category}</span>
              </div>
              {/* Summary callout */}
              {selected.summary && (
                <div className="v3-help-summary">
                  <span className="v3-help-summary-icon">◇</span>
                  <span>{selected.summary}</span>
                </div>
              )}
              {/* Rendered body */}
              <div className="v3-help-article-body">
                {renderMarkdown(selected.body)}
              </div>
              {/* Related articles */}
              {selected.relatedArticleIds?.length > 0 && (
                <div className="v3-help-related">
                  <div className="v3-help-related-label">Related articles</div>
                  <div className="v3-help-related-list">
                    {selected.relatedArticleIds
                      .map((id) => ADAM_USER_GUIDE.find((a) => a.id === id))
                      .filter(Boolean)
                      .map((rel) => (
                        <button
                          key={rel!.id}
                          className="v3-help-related-item"
                          onClick={() => setSelected(rel!)}
                        >
                          <span>{rel!.title}</span>
                          <span>›</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : isSearching ? (
            /* Search results */
            <div className="v3-help-results">
              {results.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--v3-text-muted)", fontSize: 13 }}>
                  No articles match "<strong>{query}</strong>"
                </div>
              ) : (
                <>
                  <div className="v3-help-results-count">{results.length} result{results.length !== 1 ? "s" : ""}</div>
                  {results.map((article) => (
                    <button key={article.id} className="v3-help-article-row" onClick={() => setSelected(article)}>
                      <span className="v3-help-article-row-icon" style={{ color: categoryMeta(article.category).color }}>
                        {categoryMeta(article.category).icon}
                      </span>
                      <span className="v3-help-article-row-body">
                        <span className="v3-help-article-row-title">{article.title}</span>
                        <span className="v3-help-article-row-summary">{article.summary}</span>
                      </span>
                      <span className="v3-chip muted" style={{ fontSize: 10, flexShrink: 0 }}>{article.category}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : activeCategory ? (
            /* Category article list */
            <div className="v3-help-results">
              {(categories[activeCategory] ?? []).map((article) => (
                <button key={article.id} className="v3-help-article-row" onClick={() => setSelected(article)}>
                  <span className="v3-help-article-row-icon" style={{ color: categoryMeta(article.category).color }}>
                    {categoryMeta(article.category).icon}
                  </span>
                  <span className="v3-help-article-row-body">
                    <span className="v3-help-article-row-title">{article.title}</span>
                    <span className="v3-help-article-row-summary">{article.summary}</span>
                  </span>
                  <span style={{ color: "var(--v3-text-muted)", fontSize: 16, flexShrink: 0 }}>›</span>
                </button>
              ))}
            </div>
          ) : (
            /* Category grid (home) */
            <div className="v3-help-home">
              <div className="v3-help-home-intro">
                <div className="v3-help-home-logo">◇</div>
                <div className="v3-help-home-tagline">How can we help?</div>
                <div className="v3-help-home-copy">Browse by topic or search above to find answers fast.</div>
              </div>
              <div className="v3-help-category-grid">
                {categoryList.map((cat) => {
                  const meta = categoryMeta(cat);
                  const count = categories[cat].length;
                  return (
                    <button key={cat} className="v3-help-category-card" onClick={() => setActiveCategory(cat)}>
                      <span className="v3-help-category-icon" style={{ color: meta.color }}>{meta.icon}</span>
                      <span className="v3-help-category-name">{cat}</span>
                      <span className="v3-help-category-count">{count} article{count !== 1 ? "s" : ""}</span>
                    </button>
                  );
                })}
              </div>
              {/* Quick links */}
              <div className="v3-help-quick">
                <div className="v3-help-quick-label">Popular articles</div>
                <div className="v3-help-results">
                  {ADAM_USER_GUIDE.slice(0, 4).map((article) => (
                    <button key={article.id} className="v3-help-article-row" onClick={() => setSelected(article)}>
                      <span className="v3-help-article-row-icon" style={{ color: categoryMeta(article.category).color }}>
                        {categoryMeta(article.category).icon}
                      </span>
                      <span className="v3-help-article-row-body">
                        <span className="v3-help-article-row-title">{article.title}</span>
                      </span>
                      <span style={{ color: "var(--v3-text-muted)", fontSize: 16, flexShrink: 0 }}>›</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
