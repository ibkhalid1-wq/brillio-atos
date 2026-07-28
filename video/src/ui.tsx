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
 * The business ontology as an actual object in space: entities distributed
 * over a sphere, rotating at constant angular velocity, drawn with real
 * perspective projection so near nodes are larger, brighter and in front.
 *
 * Constant velocity is the point — an eased rotation reads as an animation
 * playing, a steady one reads as a model you could reach out and turn. The
 * only easing is on the entrance.
 */
export const Ontology3D: React.FC<{
  labels: string[];
  /** Frames for one full revolution. Slower is calmer; 900 is ~30s. */
  period?: number;
  /** Entrance: nodes fade up in sequence from this frame. */
  start?: number;
  radius?: number;
  width?: number;
  height?: number;
}> = ({ labels, period = 900, start = 0, radius = 300, width = 1500, height = 620 }) => {
  const frame = useCurrentFrame();
  const cx = width / 2;
  const cy = height / 2;
  const FOCAL = 1100;
  const CAM = 1150;

  // Fibonacci sphere: an even spread without clumping at the poles, which is
  // what a naive lat/long grid gives you.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const base = labels.map((label, i) => {
    const y = 1 - (i / Math.max(1, labels.length - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    // Wider than tall: the frame is 16:9 and the labels are wide boxes, so an
    // even sphere puts them on top of each other. Stretch x/z, squash y.
    return {
      label,
      x: Math.cos(theta) * r * radius * 1.18,
      y: y * radius * 0.86,
      z: Math.sin(theta) * r * radius * 1.18,
    };
  });

  const spin = (frame / period) * Math.PI * 2;
  const tilt = -0.22; // a touch of downward look, so it reads as an object

  const pts = base.map((n, i) => {
    const x = n.x * Math.cos(spin) + n.z * Math.sin(spin);
    const z = -n.x * Math.sin(spin) + n.z * Math.cos(spin);
    const y = n.y * Math.cos(tilt) - z * Math.sin(tilt);
    const zz = z * Math.cos(tilt) + n.y * Math.sin(tilt) + CAM;
    const s = FOCAL / zz;
    const at = start + i * 4;
    return {
      label: n.label,
      sx: cx + x * s,
      sy: cy + y * s,
      s,
      depth: zz,
      enter: interpolate(frame, [at, at + 34], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
    };
  });

  // Edges to the two following nodes, matching the flat map this replaced.
  const edges: Array<[number, number]> = [];
  pts.forEach((_, i) => {
    for (let k = 1; k <= 2; k++) if (i + k < pts.length) edges.push([i, i + k]);
  });

  // Painter's algorithm: far nodes first, so nearer ones genuinely occlude.
  const order = pts.map((p, i) => i).sort((a, c) => pts[c].depth - pts[a].depth);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {edges.map(([a, c], i) => {
        const p = pts[a];
        const q = pts[c];
        const o = Math.min(p.enter, q.enter) * 0.3 * ((p.s + q.s) / 2);
        return (
          <line
            key={i}
            x1={p.sx} y1={p.sy} x2={q.sx} y2={q.sy}
            stroke="#fff" strokeWidth={1.4} opacity={o}
          />
        );
      })}
      {order.map((i) => {
        const p = pts[i];
        const w = 176 * p.s;
        const h = 58 * p.s;
        // Depth cue: things further away are dimmer as well as smaller.
        const dim = interpolate(p.s, [0.72, 1.24], [0.12, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <g key={p.label} opacity={p.enter * dim}>
            {/* Opaque backing first, so the painter's sort genuinely occludes
                rather than letting far labels read through near ones. */}
            <rect x={p.sx - w / 2} y={p.sy - h / 2} width={w} height={h} rx={14 * p.s} fill="#241A54" />
            <rect
              x={p.sx - w / 2} y={p.sy - h / 2} width={w} height={h} rx={14 * p.s}
              fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.38)" strokeWidth={1.2}
            />
            {/* Back-hemisphere nodes read as depth, not as competing words. */}
            {p.s >= 0.82 ? (
              <text
                x={p.sx} y={p.sy + 9 * p.s} textAnchor="middle" fill="#fff"
                fontFamily={FONT} fontSize={25 * p.s} fontWeight={700}
              >
                {p.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
};

/**
 * A recording of the product actually being operated, framed as a screen.
 *
 * These are the film's only footage of a person using AURA rather than of
 * its outputs, so they are deliberately left bright and ungraded — a receipt
 * that has been colour-matched into the film stops reading as a receipt.
 * The frame and shadow do the work of belonging instead.
 */
export const ScreenInset: React.FC<{
  src: string;
  width: number;
  /** Frame at which it fades up. */
  start: number;
  label?: string;
  /** Seconds into the recording to begin — skip dead air at the head. */
  from?: number;
  /**
   * Punch in on the part of the screen that matters. A product recording
   * shown whole is texture; a receipt nobody can read scores as no receipt
   * at all, which is worse than not showing one.
   */
  zoom?: number;
  origin?: string;
  /** Slow the recording so it never runs out and freezes on its last frame. */
  rate?: number;
}> = ({ src, width, start, label, from = 0, zoom = 1, origin = "50% 50%", rate = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [start, start + 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)`, fontFamily: FONT }}>
      {label ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span
            style={{
              width: 9, height: 9, borderRadius: "50%", background: "#E0553B",
              opacity: 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(frame / 9)),
            }}
          />
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC }}>
            {label}
          </span>
        </div>
      ) : null}
      <div
        style={{
          width,
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.22)",
          boxShadow: "0 40px 90px -30px rgba(0,0,0,0.75)",
          background: "#fff",
          display: "block",
          lineHeight: 0,
        }}
      >
        <div style={{ overflow: "hidden", aspectRatio: "1600 / 802" }}>
          <OffthreadVideo
            src={staticFile(src)}
            startFrom={Math.round(from * fps)}
            playbackRate={rate}
            muted
            style={{
              width: "100%", display: "block",
              transform: `scale(${zoom})`, transformOrigin: origin,
            }}
          />
        </div>
      </div>
    </div>
  );
};

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

  /* Frame blending. At this much slowdown each source frame is held for
     roughly five output frames, and the plate steps rather than moves —
     the single most visible thing stopping the film reading as smooth.
     Neither Remotion's ffmpeg nor the system has motion interpolation
     available, so blend it here: two copies of the clip one source frame
     apart, cross-faded by where we are between them. Not true optical
     flow, but it turns a step into a slide. */
  const srcFrame = frame * rate;
  const mix = srcFrame - Math.floor(srcFrame);
  const layer = (startFrom: number, o: number) => (
    <AbsoluteFill style={{ opacity: o }}>
      <OffthreadVideo
        src={staticFile(src)}
        playbackRate={rate}
        startFrom={startFrom}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: people ? "saturate(0.45) contrast(1.1)" : undefined,
        }}
      />
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ opacity: fade * opacity }}>
      {layer(0, 1)}
      {layer(1, mix)}
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
      {cursor && chars > 0 && frame < start + (text.length / cps) * 30 + 30 ? (
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
}> = ({ start, dur = 34, children, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 22}px)`, ...style }}>
      {children}
    </div>
  );
};

/** Editorial eyebrow above a scene headline — numbered, tracked, violet. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: FONT, fontSize: 21, fontWeight: 700, letterSpacing: "0.32em",
      color: "#9B8CFF", textTransform: "uppercase", marginBottom: 16,
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
  const inP = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const outP = interpolate(frame, [dur - 7, dur - 1], [1, 0], {
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
  // Retired: a scrubber bar reads as a video player, not as a film, and it
  // was the clearest tell that this came off a template. Kept as a component
  // so the Root call site and TOTAL_FRAMES wiring stay intact.
  void frame; void total;
  return null;
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
