import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
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
              text={"Laila was derived from evidence.\nBy AURA."}
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
          {/* The receipt: REAL pixels of the live programme's Account card —
              its Standard-alignment row, captured from the running app. */}
          <Rise start={130} style={{ position: "absolute", left: 260, top: 670 }}>
            <div
              style={{
                fontFamily: FONT, background: "#fff", color: INK, borderRadius: 18,
                padding: "22px 30px", boxShadow: "0 30px 80px -20px rgba(0,0,0,.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginBottom: 14 }}>
                <span style={{ fontSize: 28, fontWeight: 800 }}>Account</span>
                <span style={{ fontSize: 19, fontWeight: 700, color: ELECTRIC, letterSpacing: ".1em" }}>
                  STANDARD ALIGNMENT · LIVE FROM THE PROGRAMME
                </span>
              </div>
              <Img src={staticFile("align-row.png")} style={{ width: 1340, display: "block", borderRadius: 10 }} />
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
const STAKEHOLDERS = [
  { label: "Marketing", angle: -150 },
  { label: "Sales", angle: -90 },
  { label: "Legal", angle: -30 },
  { label: "Finance", angle: 30 },
  { label: "Delivery", angle: 90 },
  { label: "Talent", angle: 150 },
];
export const SceneAlignment: React.FC = () => {
  const frame = useCurrentFrame();
  const R = 330;
  const cx = 960, cy = 545;
  const pos = (angle: number) => {
    const a = (angle * Math.PI) / 180;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.62 };
  };
  return (
    <Ground>
      <Rise start={0} style={{ position: "absolute", top: 96, width: "100%", textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
          AURA engages the stakeholders itself.
        </div>
        <div style={{ fontFamily: FONT, fontSize: 22, color: MUTED }}>
          Every gap becomes a plain-language question — routed on a no-login link, answered in their own words, folded back in.
        </div>
      </Rise>

      <svg viewBox="0 0 1920 1080" width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {STAKEHOLDERS.map((st, i) => {
          const p2 = pos(st.angle);
          const spokeAt = 26 + i * 8;
          const spokeO = interpolate(frame, [spokeAt, spokeAt + 12], [0, 0.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const outAt = 70 + i * 22;
          const outP = interpolate(frame, [outAt, outAt + 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const backAt = outAt + 60;
          const backP = interpolate(frame, [backAt, backAt + 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const qx = cx + (p2.x - cx) * outP, qy = cy + (p2.y - cy) * outP;
          const rx = p2.x + (cx - p2.x) * backP, ry = p2.y + (cy - p2.y) * backP;
          return (
            <g key={st.label}>
              <line x1={cx} y1={cy} x2={p2.x} y2={p2.y} stroke="#fff" strokeWidth={1.6} opacity={spokeO} />
              {outP > 0 && outP < 1 ? <circle cx={qx} cy={qy} r={9} fill={ELECTRIC} /> : null}
              {backP > 0 && backP < 1 ? <circle cx={rx} cy={ry} r={9} fill="#fff" /> : null}
            </g>
          );
        })}
      </svg>

      {STAKEHOLDERS.map((st, i) => {
        const p2 = pos(st.angle);
        const at = 26 + i * 8;
        const o = interpolate(frame, [at, at + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const heard = frame >= 70 + i * 22 + 94;
        return (
          <div key={st.label}
            style={{
              position: "absolute", left: p2.x, top: p2.y, transform: "translate(-50%, -50%)", opacity: o,
              fontFamily: FONT, fontSize: 22, fontWeight: 700, whiteSpace: "nowrap",
              padding: "12px 22px", borderRadius: 99,
              background: heard ? "rgba(46, 160, 90, 0.25)" : "rgba(255,255,255,0.07)",
              border: `1px solid ${heard ? "rgba(110,220,150,0.8)" : "rgba(255,255,255,0.25)"}`,
              color: "#fff",
            }}>
            {heard ? "✓ " : ""}{st.label}
          </div>
        );
      })}

      <div style={{ position: "absolute", left: cx, top: cy, transform: "translate(-50%, -50%)",
        width: 148, height: 148, borderRadius: "50%", background: "rgba(255,255,255,0.06)",
        border: `2px solid ${ELECTRIC}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <DrawnLine size={92} progress={1} />
      </div>

      <Rise start={250} style={{ position: "absolute", bottom: 150, width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "center", fontFamily: FONT, color: "#fff" }}>
          <span style={{ fontSize: 23, fontWeight: 800, background: "#B4541E", borderRadius: 10, padding: "7px 14px" }}>⚖ CONTRADICTION</span>
          <span style={{ fontSize: 24, color: MUTED }}>
            “two weeks” vs “three-day SLA” — surfaced as <b style={{ color: "#fff" }}>a finding, not noise</b>
          </span>
        </div>
      </Rise>
      <Rise start={290} style={{ position: "absolute", bottom: 62, width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <span style={{ fontFamily: FONT, fontSize: 19, fontWeight: 800, letterSpacing: ".12em", color: ELECTRIC }}>
            LIVE · THE COVERAGE LEDGER
          </span>
          <div style={{ background: "#fff", borderRadius: 12, padding: "10px 18px", boxShadow: "0 24px 60px -24px rgba(0,0,0,.6)" }}>
            <Img src={staticFile("cov-strip-wide.png")} style={{ width: 640, display: "block" }} />
          </div>
        </div>
      </Rise>
    </Ground>
  );
};

/* ── Scene 4b · Autonomy + human in the loop, end to end (1:00–1:12) ── */
const JOURNEY: Array<{ phase: string; aura: string; human: string }> = [
  { phase: "Frame", aura: "Drafts charter + discovery kit", human: "Sponsor confirms scope" },
  { phase: "Listen", aura: "Builds ontology + atlas, routes questions", human: "Operator resolves disputes" },
  { phase: "Prototype ⟳", aura: "Derives blueprint, builds the system", human: "Stakeholders validate the demo" },
  { phase: "Ship", aura: "Drafts hardening + runbook", human: "Go / no-go on the record" },
  { phase: "Evolve", aura: "Watches drift, proposes fixes", human: "Team accepts each change" },
];
export const SceneJourney: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Ground>
      <div style={{ width: 1780, textAlign: "center" }}>
        <Rise start={0}>
          <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
            Autonomous — with a human in the loop, end to end.
          </div>
          <div style={{ fontFamily: FONT, fontSize: 22, color: MUTED, marginBottom: 44 }}>
            Machine proposes. Humans decide. Every judgement recorded as evidence.
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 22, justifyContent: "center", alignItems: "stretch" }}>
          {JOURNEY.map((col, i) => {
            const at = 30 + i * 22;
            const p = interpolate(frame, [at, at + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const humanAt = at + 55;
            const hp = interpolate(frame, [humanAt, humanAt + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div key={col.phase} style={{ width: 320, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, fontFamily: FONT }}>
                <div style={{
                  borderRadius: 16, border: `1px solid ${ELECTRIC}`, background: "rgba(110,91,255,0.14)",
                  padding: "18px 18px", minHeight: 118, display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", color: ELECTRIC, marginBottom: 8 }}>AURA · AUTONOMOUS</div>
                  <div style={{ fontSize: 21, color: "#fff", lineHeight: 1.35 }}>{col.aura}</div>
                </div>
                <div style={{ padding: "13px 0", fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: ".02em" }}>
                  {col.phase}
                </div>
                <div style={{
                  opacity: hp, transform: `translateY(${(1 - hp) * 16}px)`,
                  borderRadius: 16, border: "1px solid rgba(110,220,150,0.65)", background: "rgba(46,160,90,0.16)",
                  padding: "18px 18px", minHeight: 96, display: "flex", flexDirection: "column", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", color: "#7EDCA0", marginBottom: 8 }}>HUMAN · IN THE LOOP</div>
                  <div style={{ fontSize: 21, color: "#fff", lineHeight: 1.35 }}>{col.human}</div>
                </div>
              </div>
            );
          })}
        </div>
        <Rise start={220}>
          <div style={{ marginTop: 40, fontFamily: FONT, fontSize: 24, color: MUTED }}>
            Change anything upstream — AURA regenerates what depends on it, and <b style={{ color: "#fff" }}>your judgements survive</b>.
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
        {/* The bookend: the opening question, answered. No ask — the film
            closes on the claim it spent ninety seconds earning. */}
        <div style={{ opacity: cardP, transform: `translateY(${(1 - cardP) * 24}px)` }}>
          <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 600, color: MUTED, marginBottom: 18 }}>
            Would two teams draw the same picture?
          </div>
          <Typed
            start={cardAt + 30}
            cps={16}
            text="They now would… with AURA."
            style={{ fontSize: 58, fontWeight: 800, color: "#fff" }}
          />
        </div>
      </div>
    </Ground>
  );
};

/* ── Scene 5b · One method, every industry (1:18–1:33) ──────────────── */
type Domain = {
  industry: string;
  standard: string;
  programme: string;
  nodes: Array<[number, number, string]>;
  edges: Array<[number, number]>;
  flow: string[];
};
const DOMAINS: Domain[] = [
  {
    industry: "Life Sciences",
    standard: "HL7 FHIR",
    programme: "Patient referrals",
    nodes: [[120, 40, "Patient"], [340, 40, "Referral"], [120, 130, "Provider"], [340, 130, "Encounter"], [230, 210, "Care Plan"]],
    edges: [[0, 1], [1, 3], [2, 3], [3, 4], [0, 4]],
    flow: ["Identify", "Verify", "Schedule", "Consult", "Follow-up"],
  },
  {
    industry: "Financial Services",
    standard: "FIBO",
    programme: "Loan origination",
    nodes: [[120, 40, "Applicant"], [340, 40, "Loan"], [120, 130, "Credit File"], [340, 130, "Collateral"], [230, 210, "Account"]],
    edges: [[0, 1], [0, 2], [1, 3], [1, 4], [2, 1]],
    flow: ["Apply", "Underwrite", "Approve", "Fund", "Service"],
  },
  {
    industry: "Supply Chain",
    standard: "GS1",
    programme: "Order fulfilment",
    nodes: [[120, 40, "Order"], [340, 40, "Shipment"], [120, 130, "SKU"], [340, 130, "Carrier"], [230, 210, "Warehouse"]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 4], [1, 4]],
    flow: ["Order", "Pick", "Pack", "Ship", "Deliver"],
  },
];

const MiniDomain: React.FC<{ d: Domain; start: number }> = ({ d, start }) => {
  const frame = useCurrentFrame();
  const panelP = interpolate(frame, [start, start + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        opacity: panelP,
        transform: `translateY(${(1 - panelP) * 34}px)`,
        width: 520,
        borderRadius: 22,
        border: `1px solid ${FAINT}`,
        background: "rgba(255,255,255,0.04)",
        padding: "26px 28px",
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 27, fontWeight: 800, color: "#fff" }}>{d.industry}</span>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: ".1em", color: ELECTRIC }}>{d.standard}</span>
      </div>
      <div style={{ fontSize: 19, color: MUTED, marginBottom: 10 }}>{d.programme}</div>
      <svg viewBox="0 0 460 250" width={464} height={252}>
        {d.edges.map(([a, b], i) => {
          const at = start + 26 + i * 7;
          const o = interpolate(frame, [at, at + 10], [0, 0.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return <line key={i} x1={d.nodes[a][0]} y1={d.nodes[a][1]} x2={d.nodes[b][0]} y2={d.nodes[b][1]} stroke="#fff" strokeWidth={2} opacity={o} />;
        })}
        {d.nodes.map(([x, y, label], i) => {
          const at = start + 20 + i * 8;
          const o = interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <g key={label} opacity={o}>
              <rect x={x - 78} y={y - 22} width={156} height={44} rx={11} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.4)" />
              <text x={x} y={y + 7} textAnchor="middle" fill="#fff" fontFamily={FONT} fontSize={20} fontWeight={700}>{label}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14, flexWrap: "nowrap" }}>
        {d.flow.map((step, i) => {
          const at = start + 90 + i * 14;
          const lit = frame >= at;
          return (
            <React.Fragment key={step}>
              <span
                style={{
                  fontSize: 15.5, fontWeight: 700, whiteSpace: "nowrap",
                  padding: "7px 11px", borderRadius: 99,
                  background: lit ? ELECTRIC : "rgba(255,255,255,0.07)",
                  color: lit ? "#fff" : MUTED,
                  transition: "none",
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
          <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", marginBottom: 8 }}>
            One method. Every industry.
          </div>
          <div style={{ fontFamily: FONT, fontSize: 23, color: MUTED, marginBottom: 36 }}>
            Ontology and workflows, grounded in each industry&rsquo;s own standard — generated the same way, every time.
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 36, justifyContent: "center" }}>
          {DOMAINS.map((d, i) => (
            <MiniDomain key={d.industry} d={d} start={20 + i * 60} />
          ))}
        </div>
      </div>
    </Ground>
  );
};
