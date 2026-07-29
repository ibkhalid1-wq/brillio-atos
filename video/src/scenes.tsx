import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { ELECTRIC, ELECTRIC_TEXT, FAINT, FONT, INK, INK_2, MUTED, T } from "./tokens";
import { AuraWord, Chip, DrawnLine, Eyebrow, Glow, Ontology3D, Plate, Rise, ScreenInset, Typed } from "./ui";
import {
  b, copy, CONTRADICTION, DIAGNOSIS_POLES, DOMAINS, GOVERNANCE_CHIPS, GRAVEYARD,
  JOURNEY, LIFECYCLE, NUMBERS, ONTOLOGY_SPHERE, PROVISIONAL_LABELS, RECEIPTS, TRANSCRIPT, SPINE, STAKEHOLDERS, STANDARDS, TEAM,
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
            // 8.0s "a graveyard of pilots", 9.5s "solutions in search of a
            // problem", 12.0s "proof of concepts that prove nothing".
            const at = [b(15), b(19), b(24)][i];
            const p = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
            const grey = interpolate(frame, [at + b(2), at + b(4)], [1, 0.58], LIN);
            return (
              <div
                key={g}
                style={{
                  opacity: p * grey,
                  transform: `translateY(${(1 - p) * 22}px)`,
                  fontFamily: FONT, fontSize: 27, fontWeight: 650, color: "#fff",
                  padding: "14px 26px", borderRadius: 14, border: `1px solid ${FAINT}`,
                  background: "rgba(13,10,34,0.5)",
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
  const capP = interpolate(frame, [b(3), b(4.5)], [0, 1], EASE);
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
          {frame >= b(21) ? (
            <Typed
              start={b(21)}
              cps={30}
              text={copy("seg3").headline!}
              accents={copy("seg3").accents}
              style={{ fontSize: 54, fontWeight: 800, color: "#fff", lineHeight: 1.4 }}
            />
          ) : null}
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

      {/* A stakeholder working through the workflow AURA routed to them —
          marking what is right, what doesn't happen, in their own words. */}
      <div style={{ position: "absolute", left: 64, top: 330 }}>
        <ScreenInset
          src="screen-stakeholder.mp4"
          width={470}
          start={b(6)}
          from={1.5}
          zoom={2.05}
          origin="46% 30%"
          rate={0.75}
          label="LIVE · STAKEHOLDERS VALIDATE"
        />
      </div>
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
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC_TEXT }}>
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
          <span style={{ fontFamily: FONT, fontSize: 19, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC_TEXT }}>
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
/* ── 4a · Grounded ───────────────────────────────────────────────────────
 * The cold-start answer. AURA does not begin from nothing: it begins from
 * the industry's accumulated standards and has a provisional model of the
 * business before it has spoken to a single person. This scene used to be
 * the front half of the map scene, which put it after the stakeholders
 * and told the mechanism backwards.
 */
export const SceneGrounded: React.FC = () => {
  return (
    <Ground>
      <Rise start={0} style={{ position: "absolute", top: 58, width: "100%", textAlign: "center" }}>
        <Eyebrow>{copy("seg4a").eyebrow}</Eyebrow>
        <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
          {copy("seg4a").headline}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 22, color: MUTED }}>
          {copy("seg4a").subline}
        </div>
      </Rise>
      <div style={{ position: "absolute", left: 210, top: 190 }}>
        {/* The PROVISIONAL programme, not the finished map: this scene is the
            cold-start answer, so it has to show what AURA knows before anyone
            has spoken. Rendering the map here was the flaw four board
            reviewers each flagged independently — the two ontologies looked
            identical, so the stakeholders appeared to change nothing. */}
        <Ontology3D labels={PROVISIONAL_LABELS} start={b(2)} period={1100} radius={240} height={520} />
      </div>
      <Rise start={b(6)} style={{ position: "absolute", left: 260, top: 700 }}>
        <div
          style={{
            fontFamily: FONT, background: "#fff", color: INK, borderRadius: 18,
            padding: "22px 30px", boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginBottom: 14 }}>
            {/* From the content library, never typed here. This exact word was
                hardcoded once before and outlived the fact it named. */}
            <span style={{ fontSize: 28, fontWeight: 800 }}>{RECEIPTS.standardAlignment.entity}</span>
            <span style={{ fontSize: 19, fontWeight: 700, color: ELECTRIC_TEXT, letterSpacing: ".1em" }}>
              {RECEIPTS.standardAlignment.label}
            </span>
          </div>
          <Img src={staticFile(RECEIPTS.standardAlignment.file)} style={{ width: 1340, display: "block", borderRadius: 10 }} />
        </div>
      </Rise>
      <Rise start={b(9)} style={{ position: "absolute", right: 150, top: 300 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {STANDARDS.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </div>
      </Rise>
    </Ground>
  );
};

/* ── 5 · The map ─────────────────────────────────────────────────────────
 * What comes back from the people, and what everything downstream is
 * generated from. "Map" rather than "fabric": it is the word a board already
 * owns, and it closes the loop with the opening question, which is literally
 * about two teams drawing the same picture. The two runs are the proof that
 * "generated" means reproducible rather than merely automated.
 */
export const SceneFabric: React.FC = () => {
  const frame = useCurrentFrame();
  const pair = interpolate(frame, [b(4), b(7)], [0, 1], EASE);
  return (
    <Ground>
      <Rise start={0} style={{ position: "absolute", top: 58, width: "100%", textAlign: "center" }}>
        <Eyebrow>{copy("seg5").eyebrow}</Eyebrow>
      </Rise>
      <div style={{ width: 1620, textAlign: "center", opacity: pair, transform: `translateY(${(1 - pair) * 18}px)` }}>
        <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
          {["RUN 1", "RUN 2"].map((r) => (
            <div
              key={r}
              style={{
                width: 760, height: 430, borderRadius: 22, border: `1px solid ${FAINT}`,
                position: "relative", overflow: "hidden",
              }}
            >
              <span style={{ position: "absolute", top: 20, left: 26, fontFamily: FONT, fontSize: 26, fontWeight: 800, color: MUTED, letterSpacing: ".14em", zIndex: 2 }}>
                {r}
              </span>
              {/* Both runs in 3D, and still provably the same picture twice:
                  Ontology3D derives its rotation from the frame alone, so at
                  any instant the pair is pixel-identical. The earlier note here
                  worried that rotation broke the proof — it does not. The claim
                  is run 1 == run 2 at a given frame, not frame N == frame N+1. */}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ontology3D labels={ONTOLOGY_SPHERE} start={b(4)} period={720} radius={196} width={740} height={420} />
              </div>
            </div>
          ))}
        </div>
        {/* Lands on the closing sentence, not before it. */}
        <Rise start={b(16)}>
          <div style={{ marginTop: 38, fontFamily: FONT, fontSize: 46, fontWeight: 800, color: "#fff" }}>
            {copy("seg5").headline!.replace(" Every time.", " ")}<span style={{ color: ELECTRIC }}>Every time.</span>
          </div>
        </Rise>
      </div>
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
            const at = b(1) + i * b(2);
            const p = interpolate(frame, [at, at + b(1)], [0, 1], EASE);
            const humanAt = at + b(2.5);
            const hp = interpolate(frame, [humanAt, humanAt + b(1)], [0, 1], EASE);
            // The narration reaches Evolve last and dwells there; lift that
            // column while it does, so the words have something to point at.
            // The narration dwells on Evolve, so its column brightens — it
            // does NOT move. Lifting one card out of a five-column grid
            // breaks the row in the scene whose entire argument is rigour.
            const isEvolve = i === JOURNEY.length - 1;
            const lift = isEvolve
              ? interpolate(frame, [b(26), b(29), b(42), b(45)], [0, 1, 1, 0], LIN)
              : 0;
            return (
              <div
                key={col.phase}
                style={{
                  width: 320,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 30}px)`,
                  fontFamily: FONT,
                  filter: lift > 0.01 ? `drop-shadow(0 14px 40px rgba(110,91,255,${0.62 * lift}))` : undefined,
                }}
              >
                <div style={{
                  borderRadius: 16, border: `1px solid ${ELECTRIC}`, background: "rgba(110,91,255,0.14)",
                  padding: "16px 18px", height: 116, display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", color: ELECTRIC_TEXT, marginBottom: 8 }}>AURA · AUTONOMOUS</div>
                  <div style={{ fontSize: 20.5, color: "#fff", lineHeight: 1.35 }}>{col.aura}</div>
                </div>
                <div style={{ padding: "12px 0", fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: ".02em" }}>
                  {col.phase}
                </div>
                <div style={{
                  opacity: hp, transform: `translateY(${(1 - hp) * 16}px)`,
                  borderRadius: 16, border: "1px solid rgba(110,220,150,0.65)", background: "rgba(46,160,90,0.16)",
                  padding: "16px 18px", height: 98, display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", color: "#7EDCA0", marginBottom: 8 }}>HUMAN · IN THE LOOP</div>
                  <div style={{ fontSize: 20.5, color: "#fff", lineHeight: 1.35 }}>{col.human}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* The record accumulates: each human decision stamps onto the trail. */}
        <div style={{ marginTop: 20, position: "relative", height: 52 }}>
          <div style={{ position: "absolute", left: 140, right: 140, top: 11, height: 2, background: "rgba(255,255,255,0.18)" }} />
          <div style={{ position: "absolute", left: 100, right: 100, top: 0, display: "flex", justifyContent: "space-between" }}>
            {JOURNEY.map((col, i) => {
              const at = b(1) + i * b(2) + b(4);
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

        {/* The other half of "the machine proposes, the business validates":
            three architectures scored by AURA, one crowned, an operator free
            to refine it. Replaces the governance chips, which restated the
            narration word for word. */}
        {/* The receipt arrives as the last stamp settles and then takes the
            room: the table dims behind it so the scene ends on evidence
            rather than on a diagram of itself. 0.52x also keeps the
            recording from exhausting if the narration is ever re-cut longer. */}
        <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
          <ScreenInset
            src="screen-architecture.mp4"
            width={980}
            start={b(14)}
            from={2}
            rate={0.52}
            zoom={2.0}
            zoomTo={1.0}
            zoomDur={150}
            origin="50% 42%"
            label="LIVE · OPERATORS MAKE THE CHOICE"
          />
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
      {/* Local scrim so the figures never sit on the plate's highlights. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 54% 46% at 50% 50%, rgba(10,7,28,0.76), transparent 74%)" }} />
      <Glow size={1100} x="50%" y="50%" opacity={0.28} />
      <div style={{ display: "flex", flexDirection: "column", gap: 34, alignItems: "center" }}>
        {stamps.map((s, i) => {
          const at = b(1) + i * b(2.5);
          // Eased landing, no overshoot — buttery, not bouncy.
          const p = interpolate(frame, [at, at + b(1.5)], [0, 1], EASE);
          const last = i === stamps.length - 1;
          // The film's most important stat rolls up 0→21 as it lands.
          // Roll the leading number up as it lands, but take the wording from
          // the content library — it used to be hardcoded here, which is why
          // "in Laila" never appeared on screen.
          // The roll lands in under half a second: it is the film's best
          // beat, but any longer and a still pulled for a deck can catch a
          // half-counted number on the one claim the film exists to make.
          const label = last
            ? s.replace(/^\d+/, String(Math.round(interpolate(frame, [at, at + b(0.8)], [0, 21], EASE))))
            : s;
          return (
            <div
              key={s}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 34}px) scale(${0.94 + p * 0.06})`,
                fontFamily: FONT,
                fontSize: last ? 66 : 54,
                fontWeight: 800,
                // Electric on a live plate measures about 2:1 and greys out on
                // a projector. The accent carries as a rule underneath instead.
                color: "#fff",
                letterSpacing: "-0.01em",
                fontVariantNumeric: "tabular-nums",
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

/* ── 7b · The arc ────────────────────────────────────────────────────────
 * The one forward-looking beat. Today's five movements are lit in the
 * middle of a longer line; the stages either side are dimmed and dashed,
 * because they are the possibility being described, not anything run. The
 * film is careful everywhere else about not claiming what it hasn't done,
 * and this scene has to hold that line while still opening the door.
 */
export const SceneArc: React.FC = () => {
  const frame = useCurrentFrame();

  /* The pull-back. The spine the board learned in scene 3 opens oversized and
     alone, filling the frame; the camera then pulls back until it is the
     middle third of a much longer line, and the stages either side fade up on
     the extensions. One continuous move, no cut — the same grammar as the
     receipt in scene 6, so the film keeps one visual language for "there is
     more here than you are currently seeing". */
  const pull = interpolate(frame, [b(4), b(13)], [1.62, 1], EASE);
  const lineP = interpolate(frame, [b(10), b(18)], [0, 1], EASE);
  const outer = interpolate(frame, [b(13), b(17)], [0, 1], EASE);

  const stage = (label: string, lit: boolean, at: number) => {
    const p = interpolate(frame, [at, at + b(1.5)], [0, 1], EASE);
    return (
      <div
        key={label}
        style={{
          opacity: p * (lit ? 1 : outer * 0.5),
          transform: `translateY(${(1 - p) * 14}px)`,
          fontFamily: FONT,
          fontSize: lit ? 26 : 22,
          fontWeight: lit ? 750 : 600,
          color: "#fff",
          whiteSpace: "nowrap",
          padding: lit ? "16px 26px" : "13px 22px",
          borderRadius: 99,
          border: lit ? `1.5px solid ${ELECTRIC}` : `1.5px dashed ${FAINT}`,
          background: lit ? "rgba(110,91,255,0.18)" : "rgba(255,255,255,0.03)",
        }}
      >
        {label}
      </div>
    );
  };

  return (
    <Ground>
      <Glow size={1100} x="50%" y="52%" opacity={0.26} />
      <div style={{ width: 1720, textAlign: "center" }}>
        <Rise start={0}>
          <Eyebrow>{copy("seg7b").eyebrow}</Eyebrow>
          <div style={{ fontFamily: FONT, fontSize: 54, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            {copy("seg7b").headline}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 27, fontWeight: 600, color: MUTED, marginTop: 14 }}>
            {copy("seg7b").subline}
          </div>
        </Rise>

        <div style={{ height: 92 }} />

        {/* Only this layer scales, so the type above stays put while the
            diagram beneath it pulls back. */}
        <div style={{ transform: `scale(${pull})`, transformOrigin: "21% 50%" }}>
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute", left: 0, top: "50%",
                height: 2, width: `${lineP * 100}%`, transform: "translateY(-50%)",
                background: `linear-gradient(90deg, ${FAINT}, ${ELECTRIC} 30%, ${ELECTRIC} 70%, ${FAINT})`,
                opacity: 0.7,
              }}
            />
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              {LIFECYCLE.today.map((l, i) => stage(l, true, b(1) + i * b(0.9)))}
              {LIFECYCLE.after.map((l, i) => stage(l, false, b(13) + i * b(0.6)))}
            </div>
          </div>
        </div>

        <div style={{ height: 54 }} />
        <Rise start={b(19)}>
          <div style={{ display: "flex", justifyContent: "center", gap: 44, fontFamily: FONT, fontSize: 19, fontWeight: 800, letterSpacing: ".2em" }}>
            <span style={{ color: ELECTRIC_TEXT }}>■ TODAY · AI-NATIVE SOLUTIONS</span>
            <span style={{ color: MUTED }}>□ NEXT · THE FULL LIFECYCLE</span>
          </div>
        </Rise>
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
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".1em", color: ELECTRIC_TEXT }}>{d.standard}</span>
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
            <MiniDomain key={d.industry} d={d} start={15 + i * 24} />
          ))}
        </div>
      </div>
    </Ground>
  );
};

/* ── 9 · Close (2:00–2:10) ──────────────────────────────────────────── */
export const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const qP = interpolate(frame, [b(2), b(4)], [0, 1], EASE);
  return (
    <Ground plate={<Plate src="plate-converge.mp4" dur={T.seg10.dur} opacity={0.5} />}>
      <Glow size={800} x="50%" y="42%" opacity={0.25} />
      <div style={{ textAlign: "center" }}>
        <Rise start={b(1)}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, justifyContent: "center" }}>
            <Img src={staticFile("brillio.png")} style={{ height: 58, display: "block", marginBottom: -12 }} />
            <span style={{ color: MUTED, fontSize: 44 }}>–</span>
            <AuraWord height={46} />
          </div>
        </Rise>
        <div style={{ height: 100 }} />
        {/* The bookend: the opening question, answered. Nothing else. */}
        <div style={{ opacity: qP, transform: `translateY(${(1 - qP) * 24}px)` }}>
          <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 600, color: MUTED, marginBottom: 22 }}>
            {copy("seg10").subline}
          </div>
          <Typed
            start={b(8)}
            cps={18}
            text={copy("seg10").headline!}
            accents={copy("seg10").accents}
            style={{ fontSize: 62, fontWeight: 800, color: "#fff" }}
          />
        </div>
      </div>
    </Ground>
  );
};
/* ── 9 · What it's worth ─────────────────────────────────────────────────
 * The film's only commercial claim, given a scene rather than a corner of
 * one. Deliberately bare: a number that large earns silence around it.
 */
export const SceneValue: React.FC = () => {
  const frame = useCurrentFrame();
  const rule = interpolate(frame, [b(6), b(9)], [0, 1], EASE);
  const so = interpolate(frame, [b(9), b(12)], [0, 1], EASE);
  return (
    <Ground>
      <Glow size={1000} x="50%" y="46%" opacity={0.3} />
      <div style={{ textAlign: "center", fontFamily: FONT }}>
        <Rise start={0}>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: ".3em", color: ELECTRIC_TEXT }}>
            THE ECONOMICS
          </div>
        </Rise>
        <div style={{ height: 46 }} />
        {/* Stated, not counted: the 0→21 roll belongs to scene 7 and loses
            its force if the film performs it twice. */}
        <Rise start={b(2)}>
          <div style={{ fontSize: 168, fontWeight: 800, color: "#fff", lineHeight: 1, letterSpacing: "-0.03em" }}>
            21 days
          </div>
        </Rise>
        <div style={{ height: 26 }} />
        <div style={{ fontSize: 40, fontWeight: 700, color: "rgba(255,255,255,0.82)" }}>
          from problem to working prototype
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "48px 0 40px" }}>
          <div style={{ width: 280 * rule, height: 2, background: ELECTRIC, opacity: 0.85 }} />
        </div>
        <div style={{ opacity: so, transform: `translateY(${(1 - so) * 18}px)`, fontSize: 34, fontWeight: 700, color: ELECTRIC }}>
          {copy("seg9").subline}
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
  const dur = T.seg11.dur;

  /* Motion-picture end credits: department heading, then role right-aligned
     against a centre gutter with the name left-aligned across it, the whole
     block crawling upward at constant speed. Constant speed is what makes it
     read as credits — anything eased reads as a slide animating in. The crawl
     stops with the lockup centred and holds, so the film ends on the mark
     rather than on an empty screen. */
  const TITLE_H = 240;
  const GROUP_H = 116;
  const ROW_H = 76;
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
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: ".34em", color: ELECTRIC_TEXT }}>
              {copy("seg11").headline!.toUpperCase()}
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
