import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ELECTRIC, FAINT, FONT, INK, INK_2, MUTED } from "./tokens";
import { AuraWord, Chip, DrawnLine, Rise, Typed } from "./ui";

const Ground: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(150deg, ${INK_2} 0%, ${INK} 62%)`,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {children}
  </AbsoluteFill>
);

/* ── Scene 1 · The question (0:00–0:12) ─────────────────────────────── */
export const SceneQuestion: React.FC = () => {
  const frame = useCurrentFrame();
  const grave = [
    "Copilot nobody adopted",
    "Use case picked in a workshop",
    "POC that proved nothing",
  ];
  return (
    <Ground>
      <div style={{ width: 1680, textAlign: "center" }}>
        <Typed
          start={10}
          cps={26}
          text={"If two teams mapped your business today —\nwould they draw the same picture?"}
          style={{ fontSize: 60, fontWeight: 800, color: "#fff", lineHeight: 1.4, letterSpacing: "-0.01em" }}
        />
        <div style={{ height: 70 }} />
        <div style={{ display: "flex", gap: 22, justifyContent: "center" }}>
          {grave.map((g, i) => {
            const at = 210 + i * 34;
            const p = interpolate(frame, [at, at + 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const grey = interpolate(frame, [at + 30, at + 55], [1, 0.34], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={g}
                style={{
                  opacity: p * grey,
                  transform: `translateY(${(1 - p) * 20}px)`,
                  fontFamily: FONT,
                  fontSize: 27,
                  fontWeight: 650,
                  color: "#fff",
                  padding: "14px 26px",
                  borderRadius: 14,
                  border: `1px solid ${FAINT}`,
                }}
              >
                {g}
              </div>
            );
          })}
        </div>
      </div>
    </Ground>
  );
};

/* ── Scene 2 · The reveal (0:12–0:30) ───────────────────────────────── */
export const SceneReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = interpolate(frame, [20, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const spine = ["Frame", "Listen", "Prototype ⟳", "Ship", "Evolve"];
  const counter = spring({ frame: frame - 320, fps, config: { damping: 200 } });
  return (
    <Ground>
      <div style={{ textAlign: "center" }}>
        <DrawnLine size={330} progress={draw} />
        <div style={{ height: 26 }} />
        <div style={{ display: "flex", gap: 34, justifyContent: "center" }}>
          {spine.map((s, i) => (
            <Rise key={s} start={110 + i * 12} dur={14}>
              <span style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: MUTED, letterSpacing: "0.06em" }}>
                {s}
                {i < spine.length - 1 ? <span style={{ color: FAINT, marginLeft: 34 }}>→</span> : null}
              </span>
            </Rise>
          ))}
        </div>
        <div style={{ height: 76 }} />
        <div style={{ minHeight: 170 }}>
          {frame >= 190 ? (
            <Typed
              start={190}
              cps={30}
              text={"The demo you just saw — Laila —\nwas grown from evidence. By AURA."}
              style={{ fontSize: 54, fontWeight: 800, color: "#fff", lineHeight: 1.4 }}
            />
          ) : null}
        </div>
        <div style={{ height: 40 }} />
        <div style={{ opacity: counter, transform: `scale(${0.9 + counter * 0.1})` }}>
          <Chip tone="violet">15 days to first demo</Chip>
        </div>
      </div>
    </Ground>
  );
};

/* ── Scene 3 · Grounded, not guessed (0:30–0:48) ────────────────────── */
const NODE_POS: Array<[number, number, string]> = [
  [420, 300, "Account"], [700, 190, "Opportunity"], [960, 320, "Quote"],
  [560, 470, "Contact"], [830, 500, "Contract"], [1120, 210, "Campaign"],
  [1180, 460, "Invoice"], [300, 480, "Partner"], [1330, 330, "Engagement"],
];
export const SceneGrounding: React.FC = () => {
  const frame = useCurrentFrame();
  const split = frame >= 300;
  const runP = interpolate(frame, [310, 360], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const graph = (scale: number, offX: number, seed: number) => (
    <svg viewBox="0 0 1600 700" width={1600 * scale} height={700 * scale} style={{ position: "absolute", left: offX, top: 130 }}>
      {NODE_POS.map(([x1, y1], i) =>
        NODE_POS.slice(i + 1, i + 3).map(([x2, y2], j) => {
          const at = seed + 10 + (i * 2 + j) * 7;
          const o = interpolate(frame, [at, at + 12], [0, 0.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return <line key={`${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={2} opacity={o} />;
        }),
      )}
      {NODE_POS.map(([x, y, label], i) => {
        const at = seed + i * 9;
        const o = interpolate(frame, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <g key={label} opacity={o}>
            <rect x={x - 92} y={y - 30} width={184} height={60} rx={14} fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.35)" />
            <text x={x} y={y + 9} textAnchor="middle" fill="#fff" fontFamily={FONT} fontSize={26} fontWeight={700}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
  return (
    <Ground>
      {!split ? (
        <>
          {graph(1, 160, 0)}
          <Rise start={130} style={{ position: "absolute", left: 320, top: 690 }}>
            <div
              style={{
                fontFamily: FONT, background: "#fff", color: INK, borderRadius: 18,
                padding: "26px 34px", boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)", display: "flex", gap: 26, alignItems: "center",
              }}
            >
              <span style={{ fontSize: 30, fontWeight: 800 }}>Account</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: ELECTRIC, letterSpacing: ".08em" }}>STANDARD ALIGNMENT</span>
              <span style={{ fontSize: 26, fontFamily: "ui-monospace, monospace" }}>schema.org/Organization</span>
              <span style={{ fontSize: 24, fontStyle: "italic", opacity: 0.6 }}>skos:closeMatch</span>
            </div>
          </Rise>
          <Rise start={200} style={{ position: "absolute", right: 150, top: 220 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {["FHIR", "FIBO", "GS1", "schema.org"].map((s) => (
                <Chip key={s}>{s}</Chip>
              ))}
            </div>
          </Rise>
        </>
      ) : (
        <div style={{ width: 1620, textAlign: "center" }}>
          <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
            {["RUN 1", "RUN 2"].map((r) => (
              <div
                key={r}
                style={{
                  width: 700, height: 560, borderRadius: 22, border: `1px solid ${FAINT}`,
                  position: "relative", overflow: "hidden", opacity: runP,
                }}
              >
                <span style={{ position: "absolute", top: 20, left: 26, fontFamily: FONT, fontSize: 26, fontWeight: 800, color: MUTED, letterSpacing: ".14em" }}>
                  {r}
                </span>
                <div style={{ position: "absolute", left: -60, top: -40, transform: "scale(0.55)" }}>{graph(1, 0, 310)}</div>
              </div>
            ))}
          </div>
          <Rise start={430}>
            <div style={{ marginTop: 44, fontFamily: FONT, fontSize: 46, fontWeight: 800, color: "#fff" }}>
              Same mandate. Same model. <span style={{ color: ELECTRIC }}>Every time.</span>
            </div>
          </Rise>
        </div>
      )}
    </Ground>
  );
};

/* ── Scene 4 · Autonomous alignment (0:48–1:00) ─────────────────────── */
export const SceneAlignment: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fly = spring({ frame: frame - 70, fps, config: { damping: 100, stiffness: 60 } });
  const fold = interpolate(frame, [200, 240], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Ground>
      <div style={{ width: 1560 }}>
        <Rise start={0}>
          <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: MUTED, letterSpacing: ".14em", marginBottom: 30 }}>
            EVERY GAP BECOMES A QUESTION — ROUTED, ANSWERED, FOLDED BACK IN
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 44, alignItems: "flex-start" }}>
          <Rise start={16} style={{ flex: 1 }}>
            <div style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${FAINT}`, borderRadius: 20, padding: 34, fontFamily: FONT, color: "#fff" }}>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: ".1em", color: ELECTRIC, marginBottom: 14 }}>OPEN QUESTION · LEGAL</div>
              <div style={{ fontSize: 34, lineHeight: 1.45 }}>
                “After a quote is approved, what happens between contract request and signature?”
              </div>
              <div style={{ marginTop: 24, display: "flex", gap: 14, alignItems: "center" }}>
                <Chip tone="violet">routed → Legal SME</Chip>
                <Chip>no-login link · takes seconds</Chip>
              </div>
            </div>
          </Rise>
          <div style={{ flex: 1, transform: `translateX(${(1 - fly) * 160}px)`, opacity: fly }}>
            <div style={{ background: "#fff", borderRadius: 26, padding: 36, fontFamily: FONT, color: INK, boxShadow: "0 40px 90px -30px rgba(0,0,0,.65)" }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".1em", color: ELECTRIC, marginBottom: 12 }}>LEGAL SME · REPLIES IN THEIR OWN WORDS</div>
              <div style={{ fontSize: 30, lineHeight: 1.5 }}>
                “Drafting, client redlines, then signature — the delay is usually business terms, not legal review…”
              </div>
              <div style={{ marginTop: 20, opacity: fold, fontSize: 24, fontWeight: 700, color: "#1B7F4B" }}>
                ✓ Folded into the workflow — gap closed
              </div>
            </div>
          </div>
        </div>
        <Rise start={260}>
          <div style={{ marginTop: 40, display: "flex", gap: 18, alignItems: "center", fontFamily: FONT, color: "#fff" }}>
            <span style={{ fontSize: 26, fontWeight: 800, background: "#B4541E", borderRadius: 10, padding: "8px 16px" }}>⚖ CONTRADICTION</span>
            <span style={{ fontSize: 28, color: MUTED }}>
              “pricing approval takes two weeks” vs “our SLA is three days — and we hit it” — <b style={{ color: "#fff" }}>a finding, not noise</b>
            </span>
          </div>
        </Rise>
      </div>
    </Ground>
  );
};

/* ── Scene 5 · The numbers (1:00–1:18) ──────────────────────────────── */
export const SceneNumbers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stamps = [
    "1 mandate",
    "15 stakeholders heard",
    "34 entities",
    "10 business areas",
    "15 days → working Sales POC",
  ];
  return (
    <Ground>
      <div style={{ display: "flex", flexDirection: "column", gap: 34, alignItems: "center" }}>
        {stamps.map((s, i) => {
          const at = 30 + i * 80;
          const p = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 160 } });
          const last = i === stamps.length - 1;
          return (
            <div
              key={s}
              style={{
                opacity: Math.min(1, p * 1.4),
                transform: `scale(${0.7 + p * 0.3})`,
                fontFamily: FONT,
                fontSize: last ? 78 : 58,
                fontWeight: 800,
                color: last ? ELECTRIC : "#fff",
                letterSpacing: "-0.01em",
              }}
            >
              {s}
            </div>
          );
        })}
      </div>
    </Ground>
  );
};

/* ── Scene 6 · Close + handoff (1:18–1:30) ──────────────────────────── */
export const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const cardAt = 240;
  const cardP = interpolate(frame, [cardAt, cardAt + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Ground>
      <div style={{ textAlign: "center" }}>
        <Rise start={6}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, justifyContent: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 52, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>brillio</span>
            <span style={{ color: MUTED, fontSize: 44 }}>–</span>
            <AuraWord height={46} />
          </div>
        </Rise>
        <div style={{ height: 54 }} />
        <Typed
          start={60}
          cps={20}
          text="Evidence in. Agentic systems out."
          style={{ fontSize: 56, fontWeight: 800, color: "#fff", fontStyle: "italic" }}
        />
        <div style={{ height: 90 }} />
        <div style={{ opacity: cardP, transform: `translateY(${(1 - cardP) * 24}px)` }}>
          <span style={{ fontFamily: FONT, fontSize: 40, fontWeight: 650, color: MUTED }}>
            The path forward — over to the room.
          </span>
        </div>
      </div>
    </Ground>
  );
};
