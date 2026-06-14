import React from "react";

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`v3-skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function SkeletonShimmer({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`v3-skeleton v3-skeleton--shimmer ${className}`.trim()} style={style} aria-hidden="true" />;
}

interface SkeletonBlockProps {
  height?: number | string;
  width?: number | string;
  borderRadius?: number | string;
  style?: React.CSSProperties;
}

export function SkeletonBlock({ height = 16, width = "100%", borderRadius = 6, style }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        height,
        width,
        borderRadius,
        background: "var(--v3-surface-2)",
        animation: "v3-shimmer 1.6s ease-in-out infinite",
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--v3-surface-3) 60%, transparent) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        background: "var(--v3-surface)",
        border: "1px solid var(--v3-border)",
        borderRadius: "var(--v3-radius-lg)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <SkeletonBlock height={14} width="60%" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} height={12} width={i === lines - 1 ? "40%" : "100%"} />
      ))}
    </div>
  );
}
