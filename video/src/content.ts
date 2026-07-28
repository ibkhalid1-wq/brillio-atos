/**
 * ── THE CONTENT LIBRARY ──────────────────────────────────────────────────
 *
 * Every word in the film lives here. Nothing else needs editing to change
 * copy, narration, or pacing.
 *
 *   Change a word          → edit it below, then `npm run build:film`
 *   Change a narration line → edit `vo` below, re-record that segment,
 *                             drop it in vo-you/, then `npm run build:film`
 *   Change the pacing       → edit `tail` (breath after the line) or
 *                             `animFloor` (frames the animation needs)
 *
 * Scene durations are DERIVED, never hand-set: each scene is sized to
 * max(its narration + lead + tail, its animation floor). That is why the
 * film re-times itself whenever narration changes.
 */

export const FPS = 30;

/** Seconds of silence before a scene's narration begins. */
export const LEAD_IN = 0.4;

/* ── The beat grid ──────────────────────────────────────────────────────
 * The score runs at 120 BPM: a beat every 0.5s, a bar every 2s. Every cut
 * lands on a bar line and every element enters on a beat, so the edit
 * breathes with the music instead of alongside it.
 */
export const BPM = 120;
export const BEAT = Math.round((60 / BPM) * FPS);   // 15 frames
export const BAR = BEAT * 4;                        // 60 frames = 2s
/** n beats, in frames — the unit every animation is written in. */
export const b = (n: number): number => Math.round(n * BEAT);
/** Round up to the next bar line. */
export const toBar = (frames: number): number => Math.ceil(frames / BAR) * BAR;

export const BRAND = {
  company: "brillio",
  product: "AURA",
  /** Retired from the close in v7.1 — kept for decks and stills. */
  tagline: "Evidence in. Agentic systems out.",
  programme: "Laila CRM",
};

export type Scene = {
  /** Matches the narration file name: vo-you/<id>.wav */
  id: string;
  /** Editorial label above the headline. Omit for the bookend scenes. */
  eyebrow?: string;
  headline?: string;
  subline?: string;
  /** Substrings rendered in the electric accent as they type. */
  accents?: string[];
  /** The narration read. Keep in sync with what was recorded. */
  vo: string;
  /** Frames this scene's animation needs regardless of narration length. */
  animFloor: number;
  /** Seconds of breath after the line lands, before the cut. */
  tail: number;
};

export const SCENES: Scene[] = [
  {
    id: "seg1",
    headline: "If two teams mapped your business today —\nwould they draw the same picture?",
    accents: ["same picture?"],
    vo: "If two teams mapped your business today … would they draw the same picture? … That's where AI transformation quietly fails. A graveyard of pilots. Solutions in search of a problem.",
    animFloor: 444,
    tail: 1.4,
  },
  {
    id: "seg2",
    headline: "The failure was never AI.",
    subline:
      "An agent is only as good as its model of the business — and that model lives in heads, decks, and disagreement.",
    vo: "The failure was never AI. An agent is only as good as its model of the business — and that model lives in heads, decks, and disagreement.",
    animFloor: 220,
    tail: 1.4,
  },
  {
    id: "seg3",
    headline: "AURA derived Laila from evidence.",
    subline: "Meet AURA — Brillio's AI-native delivery methodology.",
    accents: ["Laila", "evidence"],
    vo: "Meet AURA — Brillio's AI-native delivery methodology. The demo you just saw — Laila — AURA derived it from evidence. A working pilot, in twenty-one days.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg4",
    eyebrow: "02 · It starts with people",
    headline: "AURA is designed to engage with stakeholders autonomously.",
    subline:
      "Every gap becomes a plain-language question — routed on a no-login link, answered in their own words, folded back in.",
    vo: "It starts with people. AURA is designed to engage with stakeholders autonomously — every gap a plain-language question, every disagreement a finding, not noise.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg5",
    eyebrow: "03 · In the business's own language",
    headline: "Same mandate. Same model. Every time.",
    vo: "From those voices, AURA draws the business in its own language — every entity grounded in the industry's standards. Run it twice: the same model, every time.",
    animFloor: 380,
    tail: 1.4,
  },
  {
    id: "seg6",
    eyebrow: "04 · Governed by design",
    headline: "Autonomous — with a human in the loop, end to end.",
    subline: "Machine proposes. Humans decide. Every judgment recorded as evidence.",
    vo: "And control is the architecture. The machine proposes — the business decides. Every phase gates on a demonstration. Every judgment lands on a permanent record. Autonomy you can audit.",
    animFloor: 380,
    tail: 1.4,
  },
  {
    id: "seg7",
    vo: "One real business problem. Fifteen stakeholders heard. Thirty-four entities across ten business areas. A working system in twenty-one days — validated by the people who named the problem.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg8",
    eyebrow: "05 · Any business",
    headline: "One method. Every industry.",
    subline:
      "Different industries. Different problems. The same discipline — start from the business.",
    vo: "Patient referrals. Loan origination. Order fulfillment. Different problems — the same discipline: start from the business.",
    animFloor: 200,
    tail: 1.4,
  },
  {
    id: "seg9",
    headline: "They now would… with AURA.",
    subline: "Would two teams draw the same picture?",
    accents: ["with AURA."],
    vo: "So — would two teams draw the same picture? … They now would… with AURA.",
    animFloor: 220,
    tail: 1.6,
  },
];

/* ── Scene-specific content ────────────────────────────────────────────── */

/** Scene 1 — the failed-pilot cards. Anaphoric on purpose: A… A… A… */
export const GRAVEYARD = [
  "A copilot nobody adopted",
  "A solution in search of a problem",
  "A POC that proved nothing",
];

/** Scene 2 — the two poles the middle fails to connect. */
export const DIAGNOSIS_POLES = ["BUSINESS NEEDS", "AI SOLUTION"];

/** Scene 3 — the methodology spine. */
export const SPINE = ["Frame", "Listen", "Prototype ⟳", "Ship", "Evolve"];
export const REVEAL_CHIP = "21 days to a working pilot";

/** Scene 4 — the stakeholders AURA engages, placed clockwise from top-left. */
export const STAKEHOLDERS = [
  { label: "Marketing", angle: -150 },
  { label: "Sales", angle: -90 },
  { label: "Legal", angle: -30 },
  { label: "Finance", angle: 30 },
  { label: "Delivery", angle: 90 },
  { label: "Talent", angle: 150 },
];
export const CONTRADICTION = {
  tag: "⚖ CONTRADICTION",
  body: "“two weeks” vs “three-day SLA” — surfaced as ",
  emphasis: "a finding, not noise",
};

/** Scene 5 — the entities that bloom on the ontology map. */
export const ONTOLOGY_NODES: Array<[number, number, string]> = [
  [420, 300, "Account"], [700, 190, "Opportunity"], [960, 320, "Quote"],
  [560, 470, "Contact"], [830, 500, "Contract"], [1120, 210, "Campaign"],
  [1180, 460, "Invoice"], [300, 480, "Partner"], [1330, 330, "Engagement"],
];
export const STANDARDS = ["FHIR", "FIBO", "GS1", "schema.org"];

/** Scene 6 — what AURA does alone, and what a human decides, per movement. */
export const JOURNEY = [
  { phase: "Frame", aura: "Drafts charter + discovery kit", human: "Sponsor confirms scope", stamp: "Scope confirmed" },
  { phase: "Listen", aura: "Builds ontology + atlas, routes questions", human: "Operator resolves disputes", stamp: "Disputes resolved" },
  { phase: "Prototype ⟳", aura: "Derives blueprint, builds the system", human: "Stakeholders validate the demo", stamp: "Demo validated" },
  { phase: "Ship", aura: "Drafts hardening + runbook", human: "Go / no-go on the record", stamp: "Go recorded" },
  { phase: "Evolve", aura: "Watches drift, proposes fixes", human: "Team accepts each change", stamp: "Changes accepted" },
];
export const GOVERNANCE_CHIPS = [
  "Every phase gates on a demonstration",
  "Every judgment on a permanent record",
  "“Working” defined before a line of code",
];

/** Scene 7 — the proof. Last entry rolls 0→21 as it lands. */
export const NUMBERS = [
  "1 mandate",
  "15 stakeholders heard",
  "34 entities",
  "10 business areas",
  "21 days → working Sales pilot",
];

/** Scene 8 — the cross-industry proof. */
export const DOMAINS = [
  {
    industry: "Life Sciences", standard: "HL7 FHIR", programme: "Patient referrals",
    nodes: [[120,40,"Patient"],[340,40,"Referral"],[120,130,"Provider"],[340,130,"Encounter"],[230,210,"Care Plan"]] as Array<[number,number,string]>,
    edges: [[0,1],[1,3],[2,3],[3,4],[0,4]] as Array<[number,number]>,
    flow: ["Identify", "Verify", "Schedule", "Consult", "Follow-up"],
  },
  {
    industry: "Financial Services", standard: "FIBO", programme: "Loan origination",
    nodes: [[120,40,"Applicant"],[340,40,"Loan"],[120,130,"Credit File"],[340,130,"Collateral"],[230,210,"Account"]] as Array<[number,number,string]>,
    edges: [[0,1],[0,2],[1,3],[1,4],[2,1]] as Array<[number,number]>,
    flow: ["Apply", "Underwrite", "Approve", "Fund", "Service"],
  },
  {
    industry: "Supply Chain", standard: "GS1", programme: "Order fulfillment",
    nodes: [[120,40,"Order"],[340,40,"Shipment"],[120,130,"SKU"],[340,130,"Carrier"],[230,210,"Warehouse"]] as Array<[number,number,string]>,
    edges: [[0,1],[0,2],[1,3],[2,4],[1,4]] as Array<[number,number]>,
    flow: ["Order", "Pick", "Pack", "Ship", "Deliver"],
  },
];

/** Real screenshots from the live programme — receipts, not recreations. */
export const RECEIPTS = {
  standardAlignment: { file: "align-row.png", label: "STANDARD ALIGNMENT · LIVE FROM THE PROGRAMME", entity: "Account" },
  coverageLedger: { file: "cov-strip-wide.png", label: "LIVE · THE COVERAGE LEDGER" },
  routedQuestion: { file: "ask-panel.png", label: "LIVE · A ROUTED QUESTION" },
};

/* ── Derived timing ────────────────────────────────────────────────────── */

/**
 * Measured narration lengths in seconds, written by `npm run measure`.
 * Missing entries fall back to the animation floor, so the film still
 * renders before anything is recorded.
 */
import durations from "./vo-durations.json";

const secs = (id: string): number => (durations as Record<string, number>)[id] ?? 0;

/** Frames a scene needs: its narration with breathing room, or its animation. */
export const sceneFrames = (s: Scene): number => {
  const voFrames = Math.ceil((LEAD_IN + secs(s.id) + s.tail) * FPS);
  // Fit the narration and the animation, then snap the cut to a bar line.
  return toBar(Math.max(s.animFloor, voFrames, BAR * 2));
};

export type Timeline = {
  T: Record<string, { from: number; dur: number }>;
  totalFrames: number;
  /** Narration start times in milliseconds, for the audio mix. */
  voOffsetsMs: Record<string, number>;
};

export const timeline = (): Timeline => {
  const T: Timeline["T"] = {};
  const voOffsetsMs: Record<string, number> = {};
  let cursor = 0;
  for (const s of SCENES) {
    const dur = sceneFrames(s);
    T[s.id] = { from: cursor, dur };
    // The opening line starts almost immediately; later scenes take the lead-in.
    const lead = s.id === "seg1" ? 0.5 : LEAD_IN;
    voOffsetsMs[s.id] = Math.round(((cursor / FPS) + lead) * 1000);
    cursor += dur;
  }
  return { T, totalFrames: cursor, voOffsetsMs };
};

/** Look up a scene's copy by id — used by the components. */
export const copy = (id: string): Scene => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`No scene "${id}" in the content library`);
  return s;
};
