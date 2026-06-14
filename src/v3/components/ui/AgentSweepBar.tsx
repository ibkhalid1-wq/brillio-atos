import React from "react";

interface AgentSweepBarProps {
  active: boolean;
  style?: React.CSSProperties;
}

export function AgentSweepBar({ active, style }: AgentSweepBarProps) {
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0,
        height: 2,
        background: "var(--v3-gradient-primary)",
        backgroundSize: "200% 100%",
        animation: "v3-shimmer 1.8s linear infinite",
        borderRadius: "0 0 2px 2px",
        zIndex: 10,
        ...style,
      }}
    />
  );
}
