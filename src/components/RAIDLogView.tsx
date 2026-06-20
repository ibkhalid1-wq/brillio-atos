import { useEffect, useMemo, useRef, useState } from "react";

const CATEGORY_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  risk: { bg: "#fee2e2", color: "#991b1b", label: "Risk" },
  assumption: { bg: "#fef3c7", color: "#92400e", label: "Assumption" },
  issue: { bg: "#fce7f3", color: "#9d174d", label: "Issue" },
  dependency: { bg: "#dbeafe", color: "#1e40af", label: "Dependency" },
};

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

interface RAIDEntry {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  owner: string | null;
  phaseId: string;
  extractedAt: string;
  resolved: boolean;
}

interface RAIDLogViewProps {
  entries: RAIDEntry[];
  focusSeverity?: string | null;
  focusEntryId?: string | null;
  focusToken?: number;
  onResolve: (id: string) => void;
  onExport: () => void;
}

export function RAIDLogView({
  entries,
  focusSeverity = null,
  focusEntryId = null,
  focusToken = 0,
  onResolve,
  onExport,
}: RAIDLogViewProps) {
  const [filter, setFilter] = useState<string>("all");
  const [showResolved, setShowResolved] = useState(false);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const visible = useMemo(
    () => entries
      .filter((entry) => (filter === "all" || entry.category === filter) && (showResolved || !entry.resolved))
      .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]),
    [entries, filter, showResolved],
  );

  const counts = Object.fromEntries(
    ["risk", "assumption", "issue", "dependency"].map((category) => [
      category,
      entries.filter((entry) => entry.category === category && !entry.resolved).length,
    ]),
  );
  const focusedEntry = focusEntryId ? entries.find((entry) => entry.id === focusEntryId) || null : null;

  useEffect(() => {
    if (focusEntryId) {
      setShowResolved(false);
      setFilter("all");
      setHighlightEntryId(focusEntryId);
      const frame = window.requestAnimationFrame(() => {
        rowRefs.current[focusEntryId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const timer = window.setTimeout(() => {
        setHighlightEntryId((current) => (current === focusEntryId ? null : current));
      }, 2400);
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(timer);
      };
    }
    if (!focusSeverity) return;
    setShowResolved(false);
    setFilter("all");
    const target = entries.find((entry) => !entry.resolved && entry.severity === focusSeverity);
    if (!target) return;
    setHighlightEntryId(target.id);
    const frame = window.requestAnimationFrame(() => {
      rowRefs.current[target.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => {
      setHighlightEntryId((current) => (current === target.id ? null : current));
    }, 2400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [entries, focusEntryId, focusSeverity, focusToken]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {focusedEntry || focusSeverity ? (
        <div
          style={{
            margin: "12px 16px 0",
            borderRadius: 10,
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", marginBottom: 4 }}>
            Review requested
          </div>
          <div style={{ fontSize: 12, color: "#1e3a8a", lineHeight: 1.5 }}>
            {focusedEntry
              ? `ADAM brought you to the exact RAID item "${focusedEntry.title}" so you can review or resolve it now.`
              : `ADAM brought you to the highest-priority ${focusSeverity} severity RAID items requiring attention.`}
          </div>
        </div>
      ) : null}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>RAID Log</span>
        <label style={{ fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
          Show resolved
        </label>
        <button onClick={onExport} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 11, cursor: "pointer", background: "#ffffff" }}>
          Export CSV
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, padding: "8px 16px", borderBottom: "1px solid #f3f4f6" }}>
        {(["all", "risk", "assumption", "issue", "dependency"] as const).map((category) => {
          const count = category === "all"
            ? Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
            : counts[category];
          const color = category !== "all" ? CATEGORY_COLORS[category] : null;
          return (
            <button
              key={category}
              onClick={() => setFilter(category)}
              style={{
                padding: "3px 10px",
                borderRadius: 10,
                fontSize: 11,
                border: "1px solid",
                borderColor: filter === category ? (color?.color ?? "#2563eb") : "#e5e7eb",
                background: filter === category ? (color?.bg ?? "#eff6ff") : "#ffffff",
                color: filter === category ? (color?.color ?? "#1d4ed8") : "#374151",
                cursor: "pointer",
              }}
            >
              {category === "all" ? "All" : CATEGORY_COLORS[category].label} {count > 0 ? `(${count})` : ""}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {visible.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No entries</div>
        ) : null}
        {visible.map((entry) => {
          const color = CATEGORY_COLORS[entry.category];
          return (
            <div
              key={entry.id}
              ref={(node) => { rowRefs.current[entry.id] = node; }}
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid #f3f4f6",
                opacity: entry.resolved ? 0.5 : 1,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                background:
                  highlightEntryId === entry.id
                    ? "#eff6ff"
                    : focusSeverity && !entry.resolved && entry.severity === focusSeverity
                      ? "#eff6ff"
                      : undefined,
                boxShadow: highlightEntryId === entry.id ? "inset 0 0 0 2px rgba(37,99,235,0.18)" : undefined,
              }}
            >
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: color.bg,
                  color: color.color,
                  whiteSpace: "nowrap",
                  marginTop: 2,
                }}
              >
                {color.label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{entry.title}</div>
                <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5 }}>{entry.description}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 10, color: "#9ca3af", flexWrap: "wrap" }}>
                  <span style={{ color: entry.severity === "high" ? "#dc2626" : entry.severity === "medium" ? "#d97706" : "#6b7280" }}>
                    {entry.severity}
                  </span>
                  <span>{entry.phaseId}</span>
                  {entry.owner ? <span>Owner: {entry.owner}</span> : null}
                </div>
              </div>
              {!entry.resolved ? (
                <button
                  onClick={() => onResolve(entry.id)}
                  style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #d1d5db", cursor: "pointer", whiteSpace: "nowrap", color: "#6b7280", background: "#ffffff" }}
                >
                  Resolve
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
