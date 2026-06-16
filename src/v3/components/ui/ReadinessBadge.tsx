import React from "react";

interface ReadinessBadgeProps {
  score: number | null | undefined;
  blockers?: string[];
  size?: "sm" | "md";
}

function getScoreConfig(score: number | null | undefined): {
  label: string;
  background: string;
  color: string;
  borderColor: string;
} {
  if (score == null) {
    return {
      label: "—",
      background: "rgba(148,163,184,0.12)",
      color: "var(--v3-text-muted)",
      borderColor: "rgba(148,163,184,0.2)",
    };
  }
  if (score >= 85) {
    return {
      label: `Ready · ${score}%`,
      background: "rgba(34,197,94,0.12)",
      color: "#16a34a",
      borderColor: "rgba(34,197,94,0.25)",
    };
  }
  if (score >= 70) {
    return {
      label: `At Risk · ${score}%`,
      background: "rgba(245,158,11,0.12)",
      color: "#d97706",
      borderColor: "rgba(245,158,11,0.25)",
    };
  }
  return {
    label: `At Risk · ${score}%`,
    background: "rgba(239,68,68,0.12)",
    color: "#dc2626",
    borderColor: "rgba(239,68,68,0.25)",
  };
}

export function ReadinessBadge({ score, blockers, size = "md" }: ReadinessBadgeProps) {
  const config = getScoreConfig(score);

  const tooltipText =
    blockers && blockers.length > 0 ? blockers.join(" · ") : undefined;

  const paddingInline = size === "sm" ? "6px 10px" : "5px 12px";
  const fontSize = size === "sm" ? 11 : 12;

  return (
    <span
      title={tooltipText}
      style={{
        display: "inline-flex",
        alignItems: "center",
        paddingInline,
        paddingBlock: size === "sm" ? 3 : 4,
        borderRadius: 999,
        fontSize,
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: config.background,
        color: config.color,
        border: `1px solid ${config.borderColor}`,
        whiteSpace: "nowrap",
        cursor: tooltipText ? "help" : "default",
        userSelect: "none",
      }}
    >
      {config.label}
    </span>
  );
}
