import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ADAM_USER_GUIDE,
  type GuideArticle,
  getArticleById,
  getArticlesByCategory,
  getArticlesByPhase,
  searchUserGuide,
} from "@/lib/adamUserGuide";

interface HelpPanelProps {
  currentPhase?: string;
  initialArticleId?: string | null;
  onClose: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  "Getting Started": "🚀",
  Phases: "🧭",
  Copilot: "🤖",
  Artifacts: "📋",
  "Transformation Twin": "🔮",
  Troubleshooting: "🔧",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Getting Started": "Core orientation for first-time teams and sponsors.",
  Phases: "What each stage is for, what good looks like, and what must be complete.",
  Copilot: "How to use ADAM's guidance, automation, and safety checks well.",
  Artifacts: "How evidence, approvals, and versioning work across the methodology.",
  "Transformation Twin": "How to read the living model of value, dependency, and risk.",
  Troubleshooting: "Fast answers when saving, sync, or Copilot behaviour feels off.",
};

const PHASE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  mobilise: "Mobilise",
  discover: "Discover",
  design: "Design",
  build: "Build",
  operate: "Operate",
  govern: "Govern",
  optimize: "Optimize",
  valuerealize: "Value Realize",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateText(value: string, max = 120) {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max).trim()}…` : value;
}

function getPhaseLabel(phase?: string) {
  return PHASE_LABELS[phase || ""] || (phase ? `${phase.charAt(0).toUpperCase()}${phase.slice(1)}` : "Current phase");
}

function getArticleMeta(article: GuideArticle) {
  if (article.phase) {
    return {
      eyebrow: `${getPhaseLabel(article.phase)} guidance`,
      why: "Use this when you need to understand what the phase is for, what must be complete, and what commonly blocks progress.",
    };
  }
  if (article.category === "Copilot") {
    return {
      eyebrow: "Copilot guidance",
      why: "Use this when you want faster progress with less manual effort and clearer explanations in context.",
    };
  }
  if (article.category === "Artifacts") {
    return {
      eyebrow: "Evidence guidance",
      why: "Use this when you need to understand how artifacts, approvals, and phase evidence support readiness.",
    };
  }
  if (article.category === "Troubleshooting") {
    return {
      eyebrow: "Support guidance",
      why: "Use this when something feels unclear, slow, or broken and you need a fast recovery path.",
    };
  }
  return {
    eyebrow: article.category,
    why: "Use this when you need a quick explanation, a clear next step, or a reliable way to move forward.",
  };
}

function buttonStyle(active = false): React.CSSProperties {
  return {
    border: `1px solid ${active ? "#0f172a" : "#e2e8f0"}`,
    background: active ? "#0f172a" : "#ffffff",
    color: active ? "#ffffff" : "#475569",
    borderRadius: 10,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    cursor: "pointer",
    transition: "all 160ms ease",
  };
}

function chipStyle(color = "#2563eb", bg = "#eff6ff", border = "#bfdbfe"): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${border}`,
    background: bg,
    color,
    borderRadius: 999,
    padding: "4px 9px",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.02em",
  };
}

function cardStyle(emphasis = false): React.CSSProperties {
  return {
    border: `1px solid ${emphasis ? "#dbeafe" : "#e2e8f0"}`,
    background: emphasis ? "linear-gradient(135deg, rgba(239,246,255,0.98) 0%, rgba(255,255,255,0.99) 100%)" : "rgba(255,255,255,0.99)",
    borderRadius: 18,
    padding: 14,
    boxShadow: emphasis ? "0 16px 30px rgba(37,99,235,0.08), inset 0 1px 0 rgba(255,255,255,0.95)" : "0 12px 24px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.92)",
  };
}

export function HelpPanel({ currentPhase, initialArticleId, onClose }: HelpPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuideArticle[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<GuideArticle | null>(null);
  const [view, setView] = useState<"search" | "browse" | "article">("search");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length >= 2) {
      setResults(searchUserGuide(query, 5));
    } else {
      setResults([]);
    }
  }, [query]);

  useEffect(() => {
    if (!initialArticleId) return;
    const article = getArticleById(initialArticleId);
    if (article) {
      setSelectedArticle(article);
      setView("article");
    }
  }, [initialArticleId]);

  const phaseArticles = useMemo(
    () => (currentPhase ? getArticlesByPhase(currentPhase) : []),
    [currentPhase],
  );
  const currentPhaseLabel = useMemo(() => getPhaseLabel(currentPhase), [currentPhase]);
  const categories = useMemo(
    () => Array.from(new Set(ADAM_USER_GUIDE.map((article) => article.category))),
    [],
  );
  const popularArticles = useMemo(
    () => ["gs-001", "gs-002", "gs-003", "cp-001", "ar-003", "tw-001"]
      .map((id) => getArticleById(id))
      .filter((article): article is GuideArticle => !!article),
    [],
  );
  const phaseLeadArticle = phaseArticles[0] || null;

  function openArticle(article: GuideArticle) {
    setSelectedArticle(article);
    setView("article");
  }

  function renderMarkdown(markdown: string) {
    const escaped = escapeHtml((markdown || "").trim());
    const codeBlocks: string[] = [];
    let html = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(
        `<pre style="background:#020617;color:#e2e8f0;border-radius:14px;padding:12px 14px;font-size:12px;overflow-x:auto;margin:0 0 14px;"><code>${code.trim()}</code></pre>`,
      );
      return token;
    });

    html = html
      .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:700;color:#0f172a;margin:18px 0 8px;">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:800;color:#0f172a;margin:22px 0 10px;">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:900;color:#0f172a;margin:0 0 14px;letter-spacing:-0.02em;">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;color:#1e293b;padding:2px 6px;border-radius:6px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">$1</code>')
      .replace(/^> (.+)$/gm, '<blockquote style="border-left:4px solid #fbbf24;background:#fffbeb;padding:10px 12px;margin:14px 0;border-radius:0 10px 10px 0;font-size:13px;line-height:1.6;color:#92400e;">$1</blockquote>')
      .replace(/^- \[ \] (.+)$/gm, '<div style="display:flex;gap:8px;font-size:13px;line-height:1.6;color:#334155;margin:0 0 6px;"><span style="color:#94a3b8;">[ ]</span><span>$1</span></div>')
      .replace(/^- (.+)$/gm, '<li style="margin:0 0 6px 18px;color:#334155;font-size:13px;line-height:1.65;">$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li style="margin:0 0 6px 18px;color:#334155;font-size:13px;line-height:1.65;">$1</li>')
      .replace(/^\|(.+)\|$/gm, '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin:0 0 6px;">$&</div>');

    html = `<p style="font-size:13px;line-height:1.75;color:#334155;margin:0 0 10px;">${html.replace(/\n\n/g, '</p><p style="font-size:13px;line-height:1.75;color:#334155;margin:0 0 10px;">')}</p>`;
    codeBlocks.forEach((block, index) => {
      html = html.replace(`__CODE_BLOCK_${index}__`, block);
    });
    return html;
  }

  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column", background: "linear-gradient(180deg, rgba(255,255,255,0.995) 0%, rgba(248,250,252,0.99) 100%)" }}>
      <div style={{ borderBottom: "1px solid #e2e8f0", background: "linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.98) 100%)", padding: "16px 18px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: 10, background: "linear-gradient(145deg, #0f172a 0%, #334155 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, boxShadow: "0 10px 18px rgba(15,23,42,0.15)" }}>✦</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" }}>ADAM Guide</div>
            </div>
            <p style={{ margin: 0, maxWidth: 320, fontSize: 12.5, lineHeight: 1.6, color: "#64748b" }}>
              Practical guidance for the screen you are on, the decision you are making, and the next move that matters.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 16, cursor: "pointer", boxShadow: "0 8px 16px rgba(15,23,42,0.06)" }}
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, borderRadius: 14, border: "1px solid #e2e8f0", background: "rgba(255,255,255,0.98)", padding: 4, boxShadow: "0 10px 18px rgba(15,23,42,0.04)" }}>
          <button onClick={() => setView("search")} style={buttonStyle(view === "search")}>Search</button>
          <button onClick={() => setView("browse")} style={buttonStyle(view === "browse")}>Browse</button>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #e2e8f0", padding: "14px 18px" }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for a question, phase, artifact, or task"
          style={{ width: "100%", borderRadius: 14, border: "1px solid #cbd5e1", background: "rgba(248,250,252,0.98)", padding: "11px 13px", fontSize: 13, color: "#0f172a", outline: "none", boxSizing: "border-box", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.92)" }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
          <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: "#94a3b8" }}>
            Try: “why is my gate blocked?”, “how is readiness scored?”, or “how do proposals work?”
          </p>
          {currentPhase ? (
            <span style={chipStyle("#1d4ed8", "#eff6ff", "#dbeafe")}>{currentPhaseLabel}</span>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
        {view === "article" && selectedArticle ? (
          <div>
            <button
              onClick={() => {
                setView("search");
                setSelectedArticle(null);
              }}
              style={{ marginBottom: 12, border: "none", background: "transparent", padding: 0, fontSize: 12, fontWeight: 700, color: "#2563eb", cursor: "pointer" }}
            >
              ← Back
            </button>
            <div style={{ ...cardStyle(true), marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>{getArticleMeta(selectedArticle).eyebrow}</span>
                <span style={chipStyle("#475569", "#fff", "#e2e8f0")}>
                  {CATEGORY_ICONS[selectedArticle.category] || "📄"} {selectedArticle.category}
                </span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", lineHeight: 1.08, letterSpacing: "-0.04em", marginBottom: 10 }}>
                {selectedArticle.title}
              </div>
              <div style={{ borderRadius: 14, background: "rgba(255,255,255,0.95)", border: "1px solid #dbeafe", padding: "12px 14px", fontSize: 13.5, lineHeight: 1.7, color: "#1e3a8a", marginBottom: 12 }}>
                {selectedArticle.summary}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={cardStyle(false)}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Why this matters</div>
                  <div style={{ fontSize: 12, lineHeight: 1.65, color: "#475569" }}>{getArticleMeta(selectedArticle).why}</div>
                </div>
                <div style={cardStyle(false)}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Use this when</div>
                  <div style={{ fontSize: 12, lineHeight: 1.65, color: "#475569" }}>{truncateText(selectedArticle.summary, 150)}</div>
                </div>
              </div>
            </div>
            <div
              style={{ ...cardStyle(false), padding: 18 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedArticle.body) }}
            />
            {selectedArticle.relatedArticleIds.length > 0 ? (
              <div style={{ ...cardStyle(false), marginTop: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Related articles</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedArticle.relatedArticleIds.map((id) => {
                    const relatedArticle = getArticleById(id);
                    if (!relatedArticle) return null;
                    return (
                      <button
                        key={id}
                        onClick={() => openArticle(relatedArticle)}
                        style={{ ...cardStyle(false), textAlign: "left", cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{relatedArticle.title}</div>
                        <div style={{ fontSize: 12, lineHeight: 1.6, color: "#64748b" }}>{relatedArticle.summary}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "search" ? (
          <div>
            {query.length < 2 && phaseLeadArticle ? (
              <div style={{ ...cardStyle(true), marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Recommended for this phase</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1.2, marginBottom: 6 }}>{phaseLeadArticle.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: "#475569", marginBottom: 12 }}>{phaseLeadArticle.summary}</div>
                <button
                  onClick={() => openArticle(phaseLeadArticle)}
                  style={{ border: "none", background: "#0f172a", color: "#fff", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 14px 24px rgba(15,23,42,0.16)" }}
                >
                  Open {currentPhaseLabel} guidance
                </button>
              </div>
            ) : null}

            {query.length >= 2 && results.length === 0 ? (
              <div style={{ ...cardStyle(false), textAlign: "center", padding: "28px 18px", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 6 }}>No results for "{query}"</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#64748b" }}>
                  Try simpler keywords or switch to Browse to scan the full guide.
                </div>
              </div>
            ) : null}

            {results.length > 0 ? (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Search results</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {results.map((article) => (
                    <button
                      key={article.id}
                      onClick={() => openArticle(article)}
                      style={{ ...cardStyle(false), textAlign: "left", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6, fontSize: 11, color: "#94a3b8" }}>
                        <span>{CATEGORY_ICONS[article.category] || "📄"}</span>
                        <span>{article.category}</span>
                        {article.phase ? <span style={chipStyle("#64748b", "#f8fafc", "#e2e8f0")}>{getPhaseLabel(article.phase)}</span> : null}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{article.title}</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#64748b" }}>{article.summary}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {query.length < 2 && phaseArticles.length > 0 ? (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Current phase help</div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>{currentPhaseLabel}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {phaseArticles.map((article) => (
                    <button
                      key={article.id}
                      onClick={() => openArticle(article)}
                      style={{ ...cardStyle(true), textAlign: "left", cursor: "pointer" }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{article.title}</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#1d4ed8" }}>{article.summary}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {query.length < 2 ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Popular articles</div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Start here</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {popularArticles.map((article) => (
                    <button
                      key={article.id}
                      onClick={() => openArticle(article)}
                      style={{ ...cardStyle(false), textAlign: "left", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 11, color: "#94a3b8" }}>
                        <span>{CATEGORY_ICONS[article.category] || "📄"}</span>
                        <span>{article.category}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{article.title}</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#64748b" }}>{article.summary}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "browse" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {categories.map((category) => (
              <div key={category} style={cardStyle(false)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  <span>{CATEGORY_ICONS[category] || "📄"}</span>
                  <span>{category}</span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#64748b", marginBottom: 10 }}>
                  {CATEGORY_DESCRIPTIONS[category] || "Browse articles in this topic."}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {getArticlesByCategory(category).map((article) => (
                    <button
                      key={article.id}
                      onClick={() => openArticle(article)}
                      style={{ ...cardStyle(false), textAlign: "left", cursor: "pointer", padding: 12 }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{article.title}</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "#64748b" }}>{article.summary}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
