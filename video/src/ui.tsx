import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ELECTRIC, FONT, INK } from "./tokens";

/**
 * A generated backing plate behind a scene's type.
 *
 * The three plates carry the film's argument in pictures: the opening
 * diverges, the reveal assembles, the close converges. They are deliberately
 * held under the type — a plate that competes with the words has failed.
 *
 * Source clips are 5s and scenes run three times that, so playback is slowed
 * to fit rather than looped, which would read as a repeat. Slowing repeats
 * source frames, so a continuous scale drift runs on top: the sub-pixel
 * movement keeps the image alive between them.
 */
export const Plate: React.FC<{
  src: string;
  dur: number;
  /** Length of the source clip in seconds. */
  clip?: number;
  opacity?: number;
  /**
   * Live-action footage arrives in its own daylight palette and has to be
   * pulled into the film's world; the generated abstracts are already there.
   */
  tone?: "abstract" | "people";
}> = ({ src, dur, clip = 5, opacity = 0.55, tone = "abstract" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Stretch the clip just past the scene so it never freezes on its last frame.
  const rate = Math.min(1, (clip * fps) / (dur * 1.04));
  const scale = 1.04 + (frame / dur) * 0.09;
  const fade = interpolate(frame, [0, 18, dur - 24, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const people = tone === "people";
  return (
    <AbsoluteFill style={{ opacity: fade * opacity }}>
      <OffthreadVideo
        src={staticFile(src)}
        playbackRate={rate}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: people ? "saturate(0.45) contrast(1.1)" : undefined,
        }}
      />
      {people ? (
        // Flat indigo at high opacity, not a blend mode: mix-blend-mode
        // "color" keeps the backdrop's luminance, so it tinted the office
        // without ever darkening it and the headline had nothing to sit on.
        <AbsoluteFill style={{ background: "rgba(16,11,44,0.76)" }} />
      ) : null}
      {/* Scrim: the type sits centre-frame, so darken there hardest. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 64% 54% at 50% 50%, rgba(13,10,34,${
            people ? 0.62 : 0.86
          }), rgba(13,10,34,0.34) 72%, rgba(13,10,34,0.16) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Monospace-feel typed text with a blinking block cursor — the film's motif. */
export const Typed: React.FC<{
  text: string;
  start: number;
  cps?: number; // characters per second at 30fps
  style?: React.CSSProperties;
  cursor?: boolean;
  /** Substrings rendered in the electric accent — the load-bearing words. */
  accents?: string[];
}> = ({ text, start, cps = 24, style, cursor = true, accents }) => {
  const frame = useCurrentFrame();
  const chars = Math.max(0, Math.floor(((frame - start) / 30) * cps));
  const done = chars >= text.length;
  const blink = Math.floor(frame / 16) % 2 === 0;
  // Split the text into plain/accent segments (first occurrence of each).
  const segs: Array<{ str: string; acc: boolean }> = [];
  const ranges: Array<[number, number]> = [];
  for (const a of accents ?? []) {
    const i = text.indexOf(a);
    if (i >= 0) ranges.push([i, i + a.length]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let pos = 0;
  for (const [s0, e0] of ranges) {
    if (s0 > pos) segs.push({ str: text.slice(pos, s0), acc: false });
    segs.push({ str: text.slice(s0, e0), acc: true });
    pos = e0;
  }
  if (pos < text.length) segs.push({ str: text.slice(pos), acc: false });
  let consumed = 0;
  return (
    <span style={{ fontFamily: FONT, whiteSpace: "pre-wrap", ...style }}>
      {segs.map((sg, i) => {
        const startC = consumed;
        consumed += sg.str.length;
        const vis = Math.max(0, Math.min(sg.str.length, chars - startC));
        return (
          <span key={i} style={sg.acc ? { color: ELECTRIC } : undefined}>
            {sg.str.slice(0, vis)}
          </span>
        );
      })}
      {cursor && frame >= start ? (
        <span style={{ opacity: !done || blink ? 1 : 0 }}>▌</span>
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
}> = ({ start, dur = 22, children, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, ...style }}>
      {children}
    </div>
  );
};

/** Editorial eyebrow above a scene headline — numbered, tracked, violet. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: FONT, fontSize: 17, fontWeight: 800, letterSpacing: "0.34em",
      color: ELECTRIC, textTransform: "uppercase", marginBottom: 16,
    }}
  >
    {children}
  </div>
);

/** Soft violet glow puddle for depth behind key elements. */
export const Glow: React.FC<{ size: number; x: string; y: string; opacity?: number }> = ({ size, x, y, opacity = 0.35 }) => (
  <div
    style={{
      position: "absolute", left: x, top: y, width: size, height: size,
      transform: "translate(-50%, -50%)", borderRadius: "50%", opacity,
      background: `radial-gradient(circle, ${ELECTRIC}55 0%, transparent 65%)`,
      filter: "blur(2px)", pointerEvents: "none",
    }}
  />
);

/** Scene shell: eased fade/scale in, fade out at the tail — no hard cuts. */
export const FadeScene: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  const outP = interpolate(frame, [dur - 12, dur - 1], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic),
  });
  const o = Math.min(inP, outP);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o, transform: `scale(${0.988 + inP * 0.012})` }}>
      {children}
    </div>
  );
};

/** Full-frame film grain + vignette — the premium texture pass. */
export const Grain: React.FC = () => (
  <>
    <svg width="1920" height="1080" style={{ position: "absolute", inset: 0, opacity: 0.05, pointerEvents: "none", mixBlendMode: "overlay" }}>
      <filter id="nz"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" /></filter>
      <rect width="1920" height="1080" filter="url(#nz)" />
    </svg>
    <div style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      background: "radial-gradient(ellipse 105% 90% at 50% 42%, transparent 58%, rgba(6,4,20,0.55) 100%)",
    }} />
  </>
);

/** Bottom progress hairline — the film quietly tells you where it is. */
export const ProgressLine: React.FC<{ total: number }> = ({ total }) => {
  const frame = useCurrentFrame();
  useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${(frame / total) * 100}%`,
      background: `linear-gradient(90deg, ${ELECTRIC}00, ${ELECTRIC})`, opacity: 0.75, pointerEvents: "none" }} />
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
