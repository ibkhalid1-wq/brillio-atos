import React from "react";

interface RiskBadgeProps {
  risk: "high" | "medium" | "low" | null | undefined;
  reason?: string;
  label?: string;
}

const RISK_CONFIG = {
  high: {
    background: "rgba(239,68,68,0.12)",
    color: "#dc2626",
    borderColor: "rgba(239,68,68,0.25)",
    defaultLabel: "High",
  },
  medium: {
    background: "rgba(245,158,11,0.12)",
    color: "#d97706",
    borderColor: "rgba(245,158,11,0.25)",
    defaultLabel: "Medium",
  },
  low: {
    background: "rgba(34,197,94,0.12)",
    color: "#16a34a",
    borderColor: "rgba(34,197,94,0.25)",
    defaultLabel: "Low",
  },
} as const;

export function RiskBadge({ risk, reason, label }: RiskBadgeProps) {
  if (!risk) return null;

  const config = RISK_CONFIG[risk];
  const displayLabel = label ?? config.defaultLabel;

  return (
    <span
      title={reason}
      style={{
        display: "inline-flex",
        alignItems: "center",
        paddingInline: "10px",
        paddingBlock: 4,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: config.background,
        color: config.color,
        border: `1px solid ${config.borderColor}`,
        whiteSpace: "nowrap",
        cursor: reason ? "help" : "default",
        userSelect: "none",
      }}
    >
      {displayLabel}
    </span>
  );
}
