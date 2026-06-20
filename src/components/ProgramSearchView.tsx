import { useCallback, useEffect, useState } from "react";

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  field: { bg: "#eff6ff", color: "#1d4ed8" },
  artifact: { bg: "#f0fdf4", color: "#14532d" },
  briefing: { bg: "#faf5ff", color: "#6b21a8" },
  raid: { bg: "#fff7ed", color: "#9a3412" },
  qa: { bg: "#fefce8", color: "#713f12" },
  risk: { bg: "#fef2f2", color: "#991b1b" },
};

interface SearchResult {
  id: string;
  type: string;
  phaseId: string;
  label: string;
  snippet: string;
  navigateTo: string;
}

interface ProgramSearchViewProps {
  onSearch: (query: string) => Promise<SearchResult[]>;
  onNavigate: (phaseId: string) => void;
  initialQuery?: string;
}

export function ProgramSearchView({ onSearch, onNavigate, initialQuery = "" }: ProgramSearchViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const suggestions = [
    "data migration decisions",
    "vendor risk",
    "integration approach",
    "compliance gaps",
    "go-live blockers",
    "stakeholder concerns",
  ];

  const run = useCallback(async (nextQuery: string) => {
    if (!nextQuery.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      setResults(await onSearch(nextQuery));
    } finally {
      setLoading(false);
    }
  }, [onSearch]);

  useEffect(() => {
    if (!initialQuery.trim()) return;
    setQuery(initialQuery);
    void run(initialQuery);
  }, [initialQuery, run]);

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Program Search</h2>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>
        Search across all artifacts, fields, RAID entries, briefings, and Q&amp;A.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run(query);
          }}
          placeholder='e.g. "data migration" or "vendor lock-in risk"'
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, outline: "none" }}
        />
        <button
          type="button"
          onClick={() => void run(query)}
          disabled={loading || !query.trim()}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            background: loading ? "#93c5fd" : "#2563eb",
            color: "white",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {!searched ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setQuery(suggestion);
                void run(suggestion);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "white",
                fontSize: 12,
                color: "#6b7280",
                cursor: "pointer",
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {searched && !loading && results.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          No results found for "{query}"
        </div>
      ) : null}

      {results.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
            {results.length} result{results.length > 1 ? "s" : ""} for "{query}"
          </div>
          {results.map((result) => {
            const colorSet = TYPE_COLORS[result.type] ?? { bg: "#f9fafb", color: "#374151" };
            return (
              <div
                key={result.id}
                onClick={() => onNavigate(result.navigateTo)}
                style={{
                  padding: "12px 16px",
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: "white",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: colorSet.bg, color: colorSet.color }}>
                    {result.type}
                  </span>
                  <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{result.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>→ {result.phaseId}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>{result.snippet}</p>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
