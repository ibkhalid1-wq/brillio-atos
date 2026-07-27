import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ELECTRIC, FONT, INK } from "./tokens";

/** Monospace-feel typed text with a blinking block cursor — the film's motif. */
export const Typed: React.FC<{
  text: string;
  start: number;
  cps?: number; // characters per second at 30fps
  style?: React.CSSProperties;
  cursor?: boolean;
}> = ({ text, start, cps = 24, style, cursor = true }) => {
  const frame = useCurrentFrame();
  const chars = Math.max(0, Math.floor(((frame - start) / 30) * cps));
  const shown = text.slice(0, chars);
  const done = chars >= text.length;
  const blink = Math.floor(frame / 16) % 2 === 0;
  return (
    <span style={{ fontFamily: FONT, whiteSpace: "pre-wrap", ...style }}>
      {shown}
      {cursor && (!done || blink) && frame >= start ? (
        <span style={{ opacity: done && !blink ? 0 : 1 }}>▌</span>
      ) : null}
    </span>
  );
};

/** The Drawn Line glyph, animatable: progress 0→1 draws the spine line. */
export const DrawnLine: React.FC<{
  size: number;
  progress: number; // 0..1 — line draw
  ink?: string;
  crossbarAt?: number; // progress threshold when the crossbar pops
}> = ({ size, progress, ink = "#fff", crossbarAt = 0.8 }) => {
  // Path length of polyline 4,44 18,44 34,10 50,44 64,44 ≈ 14 + 37.3 + 37.3 + 14 = 102.6
  const LEN = 102.6;
  const off = LEN * (1 - Math.min(1, progress));
  const bar = progress >= crossbarAt;
  const nodes = progress >= 1;
  return (
    <svg viewBox="0 0 68 52" width={size} height={(size * 52) / 68}>
      <polyline
        points="4,44 18,44 34,10 50,44 64,44"
        fill="none"
        stroke={ink}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={LEN}
        strokeDashoffset={off}
      />
      {bar ? (
        <line x1={25} y1={32} x2={43} y2={32} stroke={ELECTRIC} strokeWidth={6} strokeLinecap="round" />
      ) : null}
      {nodes ? (
        <>
          <circle cx={4} cy={44} r={4.5} fill={ELECTRIC} />
          <circle cx={64} cy={44} r={4.5} fill={ELECTRIC} />
        </>
      ) : null}
    </svg>
  );
};

/** Fade+rise entrance for a block. */
export const Rise: React.FC<{
  start: number;
  dur?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ start, dur = 18, children, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 26}px)`, ...style }}>
      {children}
    </div>
  );
};

/** A small AURA product wordmark: glyph-as-A + URA, light-on-dark. */
export const AuraWord: React.FC<{ height?: number }> = ({ height = 44 }) => (
  <span style={{ display: "inline-flex", alignItems: "baseline", gap: height * 0.14 }}>
    <DrawnLine size={height * 1.15} progress={1} />
    <span
      style={{
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: height * 1.18,
        letterSpacing: "0.17em",
        color: "#fff",
        lineHeight: 1,
      }}
    >
      URA
    </span>
  </span>
);

/** UI chip used in the product recreations. */
export const Chip: React.FC<{ children: React.ReactNode; tone?: "ink" | "violet" | "ghost" }> = ({
  children,
  tone = "ghost",
}) => (
  <span
    style={{
      fontFamily: FONT,
      fontSize: 22,
      fontWeight: 700,
      padding: "8px 18px",
      borderRadius: 99,
      background: tone === "violet" ? ELECTRIC : tone === "ink" ? INK : "rgba(255,255,255,0.09)",
      color: "#fff",
      border: tone === "ghost" ? "1px solid rgba(255,255,255,0.22)" : "none",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);
