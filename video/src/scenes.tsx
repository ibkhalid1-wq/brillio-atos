import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { ELECTRIC, FAINT, FONT, INK, INK_2, MUTED, T } from "./tokens";
import { AuraWord, Chip, DrawnLine, Eyebrow, Glow, Ontology3D, Plate, Rise, Typed } from "./ui";
import {
  b, copy, CONTRADICTION, DIAGNOSIS_POLES, DOMAINS, GOVERNANCE_CHIPS, GRAVEYARD,
  JOURNEY, NUMBERS, ONTOLOGY_LABELS, RECEIPTS, TRANSCRIPT, REVEAL_CHIP, SPINE, STAKEHOLDERS, STANDARDS, TEAM,
} from "./content";

/**
 * The film's easing curve. Expo-out rather than cubic-out: it leaves faster
 * and settles far more gently, so elements arrive without the small visible
 * stop that cubic gives at this scale. Everything on screen shares it, which
 * is most of why the cut reads as one piece rather than a stack of effects.
 */
const EASE = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
  easing: Easing.bezier(0.16, 1, 0.3, 1),
};
const LIN = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const Ground: React.FC<{
  children?: React.ReactNode;
  /**
   * Backing footage, passed here rather than dropped in with the content:
   * a plate is absolutely positioned and the scene copy mostly isn't, so as
   * a sibling it painted straight over the type. As a named layer it stays
   * where it belongs — under everything.
   */
  plate?: React.ReactNode;
}> = ({ children, plate }) => {
  const frame = useCurrentFrame();
  // Ambient aurora: two slow-drifting glows so no frame is ever static.
  const gx = 30 + Math.sin(frame / 210) * 12;
  const gy = 24 + Math.cos(frame / 260) * 8;
  const hx = 74 - Math.sin(frame / 240) * 10;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 60% 52% at ${gx}% ${gy}%, rgba(110,91,255,0.16), transparent 70%),
          radial-gradient(ellipse 55% 60% at ${hx}% 82%, rgba(46,35,100,0.9), transparent 75%),
          linear-gradient(150deg, ${INK_2} 0%, ${INK} 62%)`,
      }}
    >
      {plate}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ── 1 · The question (0:00–0:14) ───────────────────────────────────── */
export const SceneQuestion: React.FC = () => {
  const frame = useCurrentFrame();
  const grave = GRAVEYARD;
  return (
    <Ground plate={<Plate src="plate-teams.mp4" dur={T.seg1.dur} tone="people" opacity={1} />}>
      <div style={{ width: 1680, textAlign: "center" }}>
        <Typed
          start={10}
          cps={26}
          text={copy("seg1").headline!}
          accents={copy("seg1").accents}
          style={{ fontSize: 60, fontWeight: 800, color: "#fff", lineHeight: 1.4, letterSpacing: "-0.01em" }}
        />
        <div style={{ height: 70 }} />
        <div style={{ display: "flex", gap: 22, justifyContent: "center" }}>
          {grave.map((g, i) => {
            const at = b(18) + i * b(2);
            const p = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
            const grey = interpolate(frame, [at + b(2), at + b(4)], [1, 0.34], LIN);
            return (
              <div
                key={g}
                style={{
                  opacity: p * grey,
                  transform: `translateY(${(1 - p) * 22}px)`,
                  fontFamily: FONT, fontSize: 27, fontWeight: 650, color: "#fff",
                  padding: "14px 26px", borderRadius: 14, border: `1px solid ${FAINT}`,
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

/* ── 2 · The diagnosis — the missing middle (0:14–0:26) ─────────────── */
export const SceneDiagnosis: React.FC = () => {
  const frame = useCurrentFrame();
  const leftP = interpolate(frame, [b(1), b(2.5)], [0, 1], EASE);
  const rightP = interpolate(frame, [b(2), b(3.5)], [0, 1], EASE);
  // The lines draw toward the centre from both sides — and never meet.
  const lineP = interpolate(frame, [b(4), b(7)], [0, 1], EASE);
  const qP = interpolate(frame, [b(8), b(9.5)], [0, 1], EASE);
  const pulse = 0.6 + Math.sin(frame / 15) * 0.18;
  const capP = interpolate(frame, [b(12), b(13.5)], [0, 1], EASE);
  const pill = (p: number): React.CSSProperties => ({
    opacity: p, transform: `translateY(${(1 - p) * 24}px)`,
    fontFamily: FONT, fontSize: 34, fontWeight: 800, color: "#fff",
    padding: "22px 44px", borderRadius: 18, border: `1px solid ${FAINT}`,
    background: "rgba(255,255,255,0.05)", whiteSpace: "nowrap",
  });
  return (
    <Ground plate={<Plate src="plate-gap.mp4" dur={T.seg2.dur} opacity={0.45} />}>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={pill(leftP)}>{DIAGNOSIS_POLES[0]}</div>
          <svg width={560} height={64}>
            <line x1={0} y1={32} x2={200 * lineP} y2={32} stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.5} />
            <line x1={560} y1={32} x2={560 - 200 * lineP} y2={32} stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.5} />
            <text x={280} y={45} textAnchor="middle" fontFamily={FONT} fontSize={40} fontWeight={800}
              fill={ELECTRIC} opacity={qP * pulse}>?</text>
          </svg>
          <div style={pill(rightP)}>{DIAGNOSIS_POLES[1]}</div>
        </div>
        <div style={{ marginTop: 60, opacity: capP, transform: `translateY(${(1 - capP) * 18}px)` }}>
          <div style={{ fontFamily: FONT, fontSize: 36, fontWeight: 750, color: "#fff", marginBottom: 12 }}>
            {copy("seg2").headline}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 24, color: MUTED, maxWidth: 1100, margin: "0 auto", lineHeight: 1.5 }}>
            {copy("seg2").subline}
          </div>
        </div>
      </div>
    </Ground>
  );
};

/* ── 3 · The reveal (0:26–0:42) ─────────────────────────────────────── */
export const SceneReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [b(1), b(8)], [0, 1], EASE);
  const spine = SPINE;
  // The chip lands on "in twenty-one days" — the fourth sentence, not the third.
  const counter = interpolate(frame, [b(38), b(39.5)], [0, 1], EASE);
  return (
    <Ground plate={<Plate src="plate-draw.mp4" dur={T.seg3.dur} opacity={0.5} />}>
      <Glow size={900} x="50%" y="34%" />
      <div style={{ textAlign: "center" }}>
        <DrawnLine size={330} progress={draw} />
        <div style={{ height: 26 }} />
        <div style={{ display: "flex", gap: 34, justifyContent: "center" }}>
          {spine.map((s, i) => (
            <Rise key={s} start={b(8) + i * b(0.5)} dur={b(1)}>
              <span style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: MUTED, letterSpacing: "0.06em" }}>
                {s}
                {i < spine.length - 1 ? <span style={{ color: FAINT, marginLeft: 34 }}>→</span> : null}
              </span>
            </Rise>
          ))}
        </div>
        <div style={{ height: 56 }} />
        <div style={{ minHeight: 70 }}>
          {frame >= b(12) ? (
            <Typed
              start={b(12)}
              cps={30}
              text={copy("seg3").subline!}
              accents={["AURA"]}
              style={{ fontSize: 38, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}
            />
          ) : null}
        </div>
        <div style={{ height: 26 }} />
        <div style={{ minHeight: 90 }}>
          {frame >= b(30) ? (
            <Typed
              start={b(30)}
              cps={30}
              text={copy("seg3").headline!}
              accents={copy("seg3").accents}
              style={{ fontSize: 54, fontWeight: 800, color: "#fff", lineHeight: 1.4 }}
            />
          ) : null}
        </div>
        <div style={{ height: 40 }} />
        <div style={{ opacity: counter, transform: `translateY(${(1 - counter) * 16}px)` }}>
          <Chip tone="violet">{REVEAL_CHIP}</Chip>
        </div>
      </div>
    </Ground>
  );
};

/* ── 4 · It starts with people (0:42–0:56) ──────────────────────────── */
export const SceneAlignment: React.FC = () => {
  const frame = useCurrentFrame();
  const R = 330;
  const cx = 960, cy = 555;
  const pos = (angle: number) => {
    const a = (angle * Math.PI) / 180;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.62 };
  };
  return (
    <Ground plate={<Plate src="plate-speaking.mp4" dur={T.seg4.dur} tone="people" opacity={1} />}>
      <Rise start={0} style={{ position: "absolute", top: 86, width: "100%", textAlign: "center" }}>
        <Eyebrow>{copy("seg4").eyebrow}</Eyebrow>
        <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
          {copy("seg4").headline}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 22, color: MUTED }}>
          {copy("seg4").subline}
        </div>
      </Rise>

      <svg viewBox="0 0 1920 1080" width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {STAKEHOLDERS.map((st, i) => {
          const p2 = pos(st.angle);
          const spokeAt = b(1) + i * b(0.5);
          const spokeO = interpolate(frame, [spokeAt, spokeAt + b(0.75)], [0, 0.3], EASE);
          const outAt = b(4) + i * b(1);
          const outP = interpolate(frame, [outAt, outAt + b(2)], [0, 1], LIN);
          const backAt = outAt + b(3);
          const backP = interpolate(frame, [backAt, backAt + b(2)], [0, 1], LIN);
          const qx = cx + (p2.x - cx) * outP, qy = cy + (p2.y - cy) * outP;
          const rx = p2.x + (cx - p2.x) * backP, ry = p2.y + (cy - p2.y) * backP;
          // Dots fade in and out along their travel — no popping at endpoints.
          const outO = Math.sin(Math.PI * outP);
          const backO = Math.sin(Math.PI * backP);
          return (
            <g key={st.label}>
              <line x1={cx} y1={cy} x2={p2.x} y2={p2.y} stroke="#fff" strokeWidth={1.6} opacity={spokeO} />
              {outO > 0.01 ? <circle cx={qx} cy={qy} r={9} fill={ELECTRIC} opacity={outO} /> : null}
              {backO > 0.01 ? <circle cx={rx} cy={ry} r={9} fill="#fff" opacity={backO} /> : null}
            </g>
          );
        })}
      </svg>

      {STAKEHOLDERS.map((st, i) => {
        const p2 = pos(st.angle);
        const at = b(1) + i * b(0.5);
        const o = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
        const heardAt = b(4) + i * b(1) + b(5);
        const hp = interpolate(frame, [heardAt, heardAt + b(1)], [0, 1], EASE);
        return (
          <div key={st.label}
            style={{
              position: "absolute", left: p2.x, top: p2.y, transform: "translate(-50%, -50%)", opacity: o,
              fontFamily: FONT, fontSize: 22, fontWeight: 700, whiteSpace: "nowrap",
              padding: "12px 22px", borderRadius: 99,
              background: `rgba(${Math.round(255 - (255 - 46) * hp)},${Math.round(255 - (255 - 160) * hp)},${Math.round(255 - (255 - 90) * hp)},${0.07 + 0.18 * hp})`,
              border: `1.5px solid rgba(${Math.round(255 - (255 - 110) * hp)},${Math.round(255 - (255 - 220) * hp)},${Math.round(255 - (255 - 150) * hp)},${0.25 + 0.55 * hp})`,
              color: "#fff",
            }}>
            <span style={{ opacity: hp, fontWeight: 800 }}>✓ </span>{st.label}
          </div>
        );
      })}

      <div style={{ position: "absolute", left: cx, top: cy, transform: "translate(-50%, -50%)",
        width: 148, height: 148, borderRadius: "50%", background: "rgba(255,255,255,0.06)",
        border: `2px solid ${ELECTRIC}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <DrawnLine size={92} progress={1} />
      </div>

      <Rise start={b(6)} style={{ position: "absolute", left: 70, top: 400 }}>
        <div style={{ fontFamily: FONT }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC, marginBottom: 10 }}>
            {RECEIPTS.routedQuestion.label}
          </div>
          <div style={{ background: "#fff", borderRadius: 14, padding: "12px 16px", boxShadow: "0 24px 60px -24px rgba(0,0,0,.6)" }}>
            <Img src={staticFile(RECEIPTS.routedQuestion.file)} style={{ width: 400, display: "block", borderRadius: 8 }} />
          </div>
        </div>
      </Rise>
      {/* The plate shows someone talking to a laptop; this is the laptop
          hearing them. The line is the "two weeks" half of the
          contradiction the scene surfaces a few beats later. */}
      <Rise start={b(7)} style={{ position: "absolute", right: 70, top: 400 }}>
        <div style={{ fontFamily: FONT, width: 430 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%", background: "#E0553B",
              opacity: 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(frame / 9)),
            }} />
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC }}>
              {TRANSCRIPT.label}
            </span>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.06)", border: `1px solid ${FAINT}`,
            borderRadius: 14, padding: "18px 20px",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: MUTED, letterSpacing: ".06em", marginBottom: 10 }}>
              {TRANSCRIPT.speaker.toUpperCase()}
            </div>
            <Typed
              start={b(8)}
              cps={19}
              text={TRANSCRIPT.text}
              style={{ fontSize: 22, fontWeight: 600, color: "#fff", lineHeight: 1.5 }}
            />
          </div>
        </div>
      </Rise>

      <Rise start={b(15)} style={{ position: "absolute", bottom: 140, width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "center", fontFamily: FONT, color: "#fff" }}>
          <span style={{ fontSize: 23, fontWeight: 800, background: "#B4541E", borderRadius: 10, padding: "7px 14px" }}>{CONTRADICTION.tag}</span>
          <span style={{ fontSize: 24, color: MUTED }}>
            “two weeks” vs “three-day SLA” — surfaced as <b style={{ color: "#fff" }}>a finding, not noise</b>
          </span>
        </div>
      </Rise>
      <Rise start={b(18)} style={{ position: "absolute", bottom: 56, width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <span style={{ fontFamily: FONT, fontSize: 19, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC }}>
            {RECEIPTS.coverageLedger.label}
          </span>
          <div style={{ background: "#fff", borderRadius: 12, padding: "10px 18px", boxShadow: "0 24px 60px -24px rgba(0,0,0,.6)" }}>
            <Img src={staticFile(RECEIPTS.coverageLedger.file)} style={{ width: 640, display: "block" }} />
          </div>
        </div>
      </Rise>
    </Ground>
  );
};

/* ── 5 · The business's own language (0:56–1:12) ────────────────────── */
export const SceneGrounding: React.FC = () => {
  const frame = useCurrentFrame();
  // Crossfade between the map view and the RUN1|RUN2 view — no hard flip.
  // The comparison appears on "Run it twice", which is now the third
  // sentence rather than the second.
  const mapO = interpolate(frame, [b(24), b(26)], [1, 0], LIN);
  const runO = interpolate(frame, [b(25), b(27)], [0, 1], LIN);
  return (
    <Ground>
      <Rise start={0} style={{ position: "absolute", top: 58, width: "100%", textAlign: "center" }}>
        <Eyebrow>{copy("seg5").eyebrow}</Eyebrow>
      </Rise>
      {mapO > 0.01 ? (
        <div style={{ position: "absolute", inset: 0, opacity: mapO }}>
          {/* The ontology as an object in space, turning slowly, rather than
              a flat diagram that happens to fade in. */}
          <div style={{ position: "absolute", left: 210, top: 78 }}>
            <Ontology3D labels={ONTOLOGY_LABELS} start={0} period={1100} radius={252} height={560} />
          </div>
          <Rise start={b(5)} style={{ position: "absolute", left: 260, top: 680 }}>
            <div
              style={{
                fontFamily: FONT, background: "#fff", color: INK, borderRadius: 18,
                padding: "22px 30px", boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginBottom: 14 }}>
                <span style={{ fontSize: 28, fontWeight: 800 }}>Account</span>
                <span style={{ fontSize: 19, fontWeight: 700, color: ELECTRIC, letterSpacing: ".1em" }}>
                  {RECEIPTS.standardAlignment.label}
                </span>
              </div>
              <Img src={staticFile(RECEIPTS.standardAlignment.file)} style={{ width: 1340, display: "block", borderRadius: 10 }} />
            </div>
          </Rise>
          <Rise start={b(8)} style={{ position: "absolute", right: 150, top: 230 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {STANDARDS.map((s) => (
                <Chip key={s}>{s}</Chip>
              ))}
            </div>
          </Rise>
        </div>
      ) : null}
      {runO > 0.01 ? (
        <div style={{ position: "absolute", inset: 0, opacity: runO, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 1620, textAlign: "center" }}>
            <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
              {["RUN 1", "RUN 2"].map((r) => (
                <div
                  key={r}
                  style={{
                    width: 700, height: 500, borderRadius: 22, border: `1px solid ${FAINT}`,
                    position: "relative", overflow: "hidden",
                  }}
                >
                  <span style={{ position: "absolute", top: 20, left: 26, fontFamily: FONT, fontSize: 26, fontWeight: 800, color: MUTED, letterSpacing: ".14em" }}>
                    {r}
                  </span>
                  <div style={{ position: "absolute", left: -40, top: -30, transform: "scale(0.56)", transformOrigin: "top left" }}>
                    <Ontology3D labels={ONTOLOGY_LABELS} start={285} period={1100} radius={280} width={1300} height={900} />
                  </div>
                </div>
              ))}
            </div>
            {/* Lands on the closing sentence, not four seconds after it. */}
            <Rise start={b(28)}>
              <div style={{ marginTop: 38, fontFamily: FONT, fontSize: 46, fontWeight: 800, color: "#fff" }}>
                {copy("seg5").headline!.replace(" Every time.", " ")}<span style={{ color: ELECTRIC }}>Every time.</span>
              </div>
            </Rise>
          </div>
        </div>
      ) : null}
    </Ground>
  );
};

/* ── 6 · Governed by design (1:12–1:32) ─────────────────────────────── */
export const SceneJourney: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Ground>
      <div style={{ width: 1780, textAlign: "center" }}>
        <Rise start={0}>
          <Eyebrow>{copy("seg6").eyebrow}</Eyebrow>
          <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
            {copy("seg6").headline}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 22, color: MUTED, marginBottom: 38 }}>
            {copy("seg6").subline}
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 22, justifyContent: "center", alignItems: "stretch" }}>
          {JOURNEY.map((col, i) => {
            const at = b(1) + i * b(0.75);
            const p = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
            const humanAt = at + b(4);
            const hp = interpolate(frame, [humanAt, humanAt + b(1)], [0, 1], EASE);
            return (
              <div key={col.phase} style={{ width: 320, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, fontFamily: FONT }}>
                <div style={{
                  borderRadius: 16, border: `1px solid ${ELECTRIC}`, background: "rgba(110,91,255,0.14)",
                  padding: "16px 18px", minHeight: 104, display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", color: ELECTRIC, marginBottom: 8 }}>AURA · AUTONOMOUS</div>
                  <div style={{ fontSize: 20.5, color: "#fff", lineHeight: 1.35 }}>{col.aura}</div>
                </div>
                <div style={{ padding: "12px 0", fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: ".02em" }}>
                  {col.phase}
                </div>
                <div style={{
                  opacity: hp, transform: `translateY(${(1 - hp) * 16}px)`,
                  borderRadius: 16, border: "1px solid rgba(110,220,150,0.65)", background: "rgba(46,160,90,0.16)",
                  padding: "16px 18px", minHeight: 86, display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", color: "#7EDCA0", marginBottom: 8 }}>HUMAN · IN THE LOOP</div>
                  <div style={{ fontSize: 20.5, color: "#fff", lineHeight: 1.35 }}>{col.human}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* The record accumulates: each human decision stamps onto the trail. */}
        <div style={{ marginTop: 36, position: "relative", height: 62 }}>
          <div style={{ position: "absolute", left: 140, right: 140, top: 11, height: 2, background: "rgba(255,255,255,0.18)" }} />
          <div style={{ position: "absolute", left: 100, right: 100, top: 0, display: "flex", justifyContent: "space-between" }}>
            {JOURNEY.map((col, i) => {
              const at = b(1) + i * b(0.75) + b(6);
              const p = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
              return (
                <div key={col.stamp} style={{ opacity: p, transform: `translateY(${(1 - p) * 12}px)`, textAlign: "center", fontFamily: FONT }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", margin: "0 auto 8px", background: "rgba(46,160,90,0.9)",
                    color: "#fff", fontSize: 14, fontWeight: 800, lineHeight: "22px" }}>✓</div>
                  <div style={{ fontSize: 16.5, fontWeight: 650, color: MUTED, whiteSpace: "nowrap" }}>{col.stamp}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Governance band — the three claims that survive the meeting. */}
        <div style={{ marginTop: 28, display: "flex", gap: 20, justifyContent: "center" }}>
          {GOVERNANCE_CHIPS.map((c, i) => {
            const at = 420 + i * 24;
            const p = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
            return (
              <div key={c} style={{
                opacity: p, transform: `translateY(${(1 - p) * 18}px)`,
                fontFamily: FONT, fontSize: 22, fontWeight: 750, color: "#fff",
                padding: "14px 26px", borderRadius: 99,
                border: `1px solid ${ELECTRIC}`, background: "rgba(110,91,255,0.16)",
                whiteSpace: "nowrap",
              }}>
                {c}
              </div>
            );
          })}
        </div>
      </div>
    </Ground>
  );
};

/* ── 7 · The proof (1:32–1:48) ──────────────────────────────────────── */
export const SceneNumbers: React.FC = () => {
  const frame = useCurrentFrame();
  const stamps = NUMBERS;
  return (
    <Ground plate={<Plate src="plate-demo.mp4" dur={T.seg7.dur} tone="people" opacity={1} />}>
      <Glow size={1100} x="50%" y="50%" opacity={0.28} />
      <div style={{ display: "flex", flexDirection: "column", gap: 34, alignItems: "center" }}>
        {stamps.map((s, i) => {
          const at = b(4) + i * b(5);
          // Eased landing, no overshoot — buttery, not bouncy.
          const p = interpolate(frame, [at, at + b(1.5)], [0, 1], EASE);
          const last = i === stamps.length - 1;
          // The film's most important stat rolls up 0→21 as it lands.
          // Roll the leading number up as it lands, but take the wording from
          // the content library — it used to be hardcoded here, which is why
          // "in Laila" never appeared on screen.
          const label = last
            ? s.replace(/^\d+/, String(Math.round(interpolate(frame, [at, at + b(1.5)], [0, 21], LIN))))
            : s;
          return (
            <div
              key={s}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 34}px) scale(${0.94 + p * 0.06})`,
                fontFamily: FONT,
                fontSize: last ? 78 : 58,
                fontWeight: 800,
                color: last ? ELECTRIC : "#fff",
                letterSpacing: "-0.01em",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </Ground>
  );
};

/* ── 8 · Any business (1:48–2:00) ───────────────────────────────────── */

const MiniDomain: React.FC<{ d: (typeof DOMAINS)[number]; start: number }> = ({ d, start }) => {
  const frame = useCurrentFrame();
  const panelP = interpolate(frame, [start, start + b(1)], [0, 1], EASE);
  return (
    <div
      style={{
        opacity: panelP,
        transform: `translateY(${(1 - panelP) * 34}px)`,
        width: 520, borderRadius: 22, border: `1px solid ${FAINT}`,
        background: "rgba(255,255,255,0.04)", padding: "26px 28px", fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 27, fontWeight: 800, color: "#fff" }}>{d.industry}</span>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".1em", color: ELECTRIC }}>{d.standard}</span>
      </div>
      <div style={{ fontSize: 19, color: MUTED, marginBottom: 10 }}>{d.programme}</div>
      <svg viewBox="0 0 460 250" width={464} height={252}>
        {d.edges.map(([from_, to_], i) => {
          const at = start + b(1.5) + i * 3;
          const o = interpolate(frame, [at, at + 12], [0, 0.5], EASE);
          return <line key={i} x1={d.nodes[from_][0]} y1={d.nodes[from_][1]} x2={d.nodes[to_][0]} y2={d.nodes[to_][1]} stroke="#fff" strokeWidth={2} opacity={o} />;
        })}
        {d.nodes.map(([x, y, label], i) => {
          const at = start + b(1) + i * 4;
          const o = interpolate(frame, [at, at + 12], [0, 1], EASE);
          return (
            <g key={label} opacity={o}>
              <rect x={x - 78} y={y - 22} width={156} height={44} rx={11} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" />
              <text x={x} y={y + 7} textAnchor="middle" fill="#fff" fontFamily={FONT} fontSize={20} fontWeight={700}>{label}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14 }}>
        {d.flow.map((step, i) => {
          const at = start + 80 + i * 12;
          // Chips light with a soft ease, not a binary pop.
          const lp = interpolate(frame, [at, at + b(0.5)], [0, 1], EASE);
          return (
            <React.Fragment key={step}>
              <span
                style={{
                  fontSize: 15.5, fontWeight: 700, whiteSpace: "nowrap",
                  padding: "7px 11px", borderRadius: 99,
                  background: `rgba(${Math.round(255 - (255 - 110) * lp)},${Math.round(255 - (255 - 91) * lp)},255,${0.07 + 0.86 * lp})`,
                  color: lp > 0.5 ? "#fff" : MUTED,
                }}
              >
                {step}
              </span>
              {i < d.flow.length - 1 ? <span style={{ color: FAINT, fontSize: 15 }}>→</span> : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export const SceneIndustries: React.FC = () => {
  return (
    <Ground>
      <div style={{ textAlign: "center" }}>
        <Rise start={0}>
          <Eyebrow>{copy("seg8").eyebrow}</Eyebrow>
          <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", marginBottom: 8 }}>
            {copy("seg8").headline}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 23, color: MUTED, marginBottom: 36 }}>
            {copy("seg8").subline}
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 36, justifyContent: "center" }}>
          {DOMAINS.map((d, i) => (
            <MiniDomain key={d.industry} d={d} start={18 + i * 46} />
          ))}
        </div>
      </div>
    </Ground>
  );
};

/* ── 9 · Close (2:00–2:10) ──────────────────────────────────────────── */
export const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const qP = interpolate(frame, [70, 94], [0, 1], EASE);
  return (
    <Ground plate={<Plate src="plate-converge.mp4" dur={T.seg9.dur} opacity={0.5} />}>
      <Glow size={800} x="50%" y="42%" opacity={0.25} />
      <div style={{ textAlign: "center" }}>
        <Rise start={b(1)}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, justifyContent: "center" }}>
            {/* The real wordmark, not the typeface approximation. Its two
                green dots sit below the baseline, so the mark is nudged up
                to line its letterforms up with AURA's. */}
            <Img
              src={staticFile("brillio.png")}
              style={{ height: 58, display: "block", marginBottom: -12 }}
            />
            <span style={{ color: MUTED, fontSize: 44 }}>–</span>
            <AuraWord height={46} />
          </div>
        </Rise>
        <div style={{ height: 100 }} />
        {/* The bookend: the opening question, answered. Nothing else. */}
        <div style={{ opacity: qP, transform: `translateY(${(1 - qP) * 24}px)` }}>
          <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 600, color: MUTED, marginBottom: 22 }}>
            {copy("seg9").subline}
          </div>
          <Typed
            start={b(5.5)}
            cps={18}
            text={copy("seg9").headline!}
            accents={copy("seg9").accents}
            style={{ fontSize: 62, fontWeight: 800, color: "#fff" }}
          />
        </div>
      </div>
    </Ground>
  );
};

/* ── 10 · The team ───────────────────────────────────────────────────────
 * The one scene about people rather than method, so it earns a slower hand:
 * names arrive a beat apart in the deck's reading order, and the rule above
 * them draws itself rather than appearing. No photographs — the film is
 * typographic throughout, and twelve headshots would break it.
 */
export const SceneTeam: React.FC = () => {
  const frame = useCurrentFrame();
  const dur = T.seg10.dur;

  /* Motion-picture end credits: department heading, then role right-aligned
     against a centre gutter with the name left-aligned across it, the whole
     block crawling upward at constant speed. Constant speed is what makes it
     read as credits — anything eased reads as a slide animating in. The crawl
     stops with the lockup centred and holds, so the film ends on the mark
     rather than on an empty screen. */
  const TITLE_H = 240;
  const GROUP_H = 116;
  const ROW_H = 104;
  const GAP = 150;
  const LOCKUP_H = 150;
  const people = TEAM.reduce((n, g) => n + g.people.length, 0);
  const lockupCentre =
    TITLE_H + TEAM.length * GROUP_H + people * ROW_H + GAP + LOCKUP_H / 2;

  const from = 1140;
  const to = 540 - lockupCentre;
  const y = interpolate(frame, [b(1), dur - b(5)], [from, to], LIN);

  return (
    <AbsoluteFill style={{ background: "#08061A", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translateY(${y}px)` }}>
        <div style={{ width: 1500, margin: "0 auto", fontFamily: FONT }}>
          <div style={{ height: TITLE_H, textAlign: "center" }}>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: ".34em", color: ELECTRIC }}>
              {copy("seg10").headline!.toUpperCase()}
            </div>
            <div style={{ width: 120, height: 1, background: FAINT, margin: "30px auto 0" }} />
          </div>

          {TEAM.map((group) => (
            <div key={group.group}>
              <div
                style={{
                  height: GROUP_H,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: 26,
                }}
              >
                <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: ".3em", color: FAINT }}>
                  {group.group.toUpperCase()}
                </span>
              </div>
              {group.people.map((p) => (
                <div
                  key={p.name}
                  style={{
                    height: ROW_H,
                    display: "grid",
                    gridTemplateColumns: "1fr 60px 1fr",
                    alignItems: "baseline",
                  }}
                >
                  <div style={{ textAlign: "right", fontSize: 20, fontWeight: 600, letterSpacing: ".14em", color: MUTED }}>
                    {p.role.toUpperCase()}
                  </div>
                  <div />
                  <div style={{ textAlign: "left", fontSize: 33, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
                    {p.name}
                  </div>
                </div>
              ))}
            </div>
          ))}

          <div style={{ height: GAP }} />
          <div style={{ height: LOCKUP_H, display: "flex", alignItems: "center", justifyContent: "center", gap: 26 }}>
            <Img src={staticFile("brillio.png")} style={{ height: 52, display: "block", marginBottom: -11 }} />
            <span style={{ color: MUTED, fontSize: 40 }}>–</span>
            <AuraWord height={42} />
          </div>
        </div>
      </AbsoluteFill>

      {/* Names arrive and leave through darkness, never at a hard frame edge. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, #08061A 0%, rgba(8,6,26,0) 17%, rgba(8,6,26,0) 83%, #08061A 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
