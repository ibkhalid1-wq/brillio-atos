import React from "react";

/**
 * Kpi — the single KPI tile primitive for the platform.
 *
 * One design DNA (typography scale, label treatment, border, radius, hover
 * behaviour, colour semantics) shared across every surface, expressed at two
 * sizes so the same metric reads as the same object whether it appears in the
 * prominent Executive metrics row (`variant="block"`) or the compact daily
 * feed strip (`variant="pill"`). Replaces the previously divergent local
 * `MetricBlock` (ExecutiveView) and `MetricPill` (InsightFeedView).
 */
export type KpiVariant = "block" | "pill";

export function Kpi({
  label,
  value,
  color,
  variant = "block",
  emphasis = false,
  onClick,
}: {
  label: string;
  value: string | number;
  /** Optional value colour (e.g. confidence/health tone). Defaults to primary text. */
  color?: string;
  /** Layout context: full-width row block (default) or compact inline pill. */
  variant?: KpiVariant;
  /** Block-only: render the value larger (used for the hero Confidence tile). */
  emphasis?: boolean;
  onClick?: () => void;
}) {
  const isBlock = variant === "block";

  const container: React.CSSProperties = {
    background: "var(--v3-surface)",
    border: "1px solid var(--v3-border-soft)",
    borderRadius: "var(--v3-radius)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--v3-font)",
    transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
    cursor: onClick ? "pointer" : "default",
    ...(isBlock
      ? { flex: 1, minWidth: 0, padding: "16px 18px", gap: 4, textAlign: "left" as const }
      : { display: "inline-flex", alignItems: "center", padding: "10px 18px", minWidth: 80, textAlign: "center" as const }),
  };

  const valueStyle: React.CSSProperties = {
    fontWeight: 800,
    color: color ?? "var(--v3-text-primary)",
    lineHeight: isBlock ? 1 : 1.1,
    letterSpacing: "-0.02em",
    fontSize: isBlock ? (emphasis ? 36 : 28) : 22,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: isBlock ? 11 : 10,
    color: "var(--v3-text-muted)",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginTop: isBlock ? 0 : 3,
  };

  const inner = (
    <>
      <span style={valueStyle}>{value}</span>
      <span style={labelStyle}>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={container}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--v3-surface-2)";
          e.currentTarget.style.borderColor = "var(--v3-accent)";
          if (isBlock) e.currentTarget.style.boxShadow = "0 2px 10px rgba(0,0,0,0.15)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--v3-surface)";
          e.currentTarget.style.borderColor = "var(--v3-border-soft)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {inner}
      </button>
    );
  }

  return <div style={container}>{inner}</div>;
}
