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
  /**
   * Beats to wait before the narration starts, so the words arrive with the
   * visual they describe rather than ahead of it. Most scenes put their
   * subject on screen immediately and use the default; raise it where the
   * animation has to build something first.
   */
  voAt?: number;
  /**
   * Words per minute for this scene's read. Defaults to the film's rate;
   * lower it where a line needs room — a list of three industries and a
   * conclusion wants space that the average rate doesn't give it.
   */
  wpm?: number;
};

/** Default narration entry: half a beat past the cut. */
const VO_AT_DEFAULT = 1;

export const SCENES: Scene[] = [
  {
    id: "seg1",
    headline: "If two teams mapped your business today —\nwould they draw the same picture?",
    accents: ["same picture?"],
    vo: "If two teams mapped your business today … would they draw the same picture? … … That's where AI transformation quietly fails. A graveyard of pilots. Solutions in search of a problem. Proof of concepts that prove nothing.",
    animFloor: 444,
    tail: 1.4,
  },
  {
    id: "seg2",
    headline: "The failure was never AI.",
    subline:
      "An agent is only as good as its model of the business — and that model lives in heads, decks, and disagreements.",
    vo: "The failure was never AI. An agent is only as good as its model of the business — and that model lives in heads, decks, and disagreements.",
    animFloor: 220,
    tail: 1.4,
  },
  {
    id: "seg3",
    headline: "AURA derived Laila from evidence.",
    subline: "Meet AURA — Brillio's AI-native delivery methodology, and the system that runs it.",
    accents: ["Laila", "evidence"],
    vo: "Meet Aura — Brillio's AI-native delivery methodology, and the system that runs it … Laila, a sales CRM, was derived from evidence and built by Aura. A working pilot, in twenty-one days.",
    animFloor: 360,
    tail: 1.4,
    // The mark draws, then the spine assembles, and only then does the name
    // type on at b(12). Speaking before that had the line arriving five
    // seconds after it was said. Now the three sentences land with the
    // subline, the headline and the 21-days chip in turn.
    voAt: 11,
  },
  {
    // Everything after this point is one programme's worth of evidence, and
    // the film says so before it starts making claims. Scoping the sample is
    // what lets the rest of the film be believed rather than discounted.
    id: "seg3b",
    headline: "One programme. Ours.",
    subline: "Brillio's own sales CRM. Still in development.",
    vo: "One programme. Ours. Still being built. Everything that follows is what we measured on it.",
    animFloor: 180,
    tail: 1.6,
  },
  {
    id: "seg4",
    eyebrow: "01 · It starts with people",
    headline: "AURA is designed to engage with stakeholders autonomously.",
    subline:
      "Every gap becomes a plain-language question — routed on a no-login link, answered in their own words, folded back in.",
    vo: "It starts with people. Aura is designed to engage with stakeholders autonomously — every gap a plain-language question, every disagreement a finding, not noise.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg5",
    eyebrow: "02 · In the business's own language",
    headline: "Same mandate. Same model. Every time.",
    vo: "From those voices, Aura draws the business in its own language — every entity grounded in the industry's standards. That model isn't a document. It's what the working system is generated from … Run it twice: the same model, every time.",
    animFloor: 380,
    tail: 1.4,
  },
  {
    id: "seg6",
    eyebrow: "03 · Governed by design",
    headline: "Autonomous — with a human in the loop, end to end.",
    subline: "Machine proposes. The business validates. Every judgment recorded as evidence.",
    vo: "And control is the architecture. The machine proposes — the business validates. Every phase gates on a demonstration. Every judgment lands on a permanent record. And it doesn't stop at go-live: Aura watches the model drift as the business changes, and proposes the correction for your team to accept. Autonomy you can audit.",
    animFloor: 380,
    tail: 1.4,
  },
  {
    id: "seg7",
    vo: "One real business problem. Fifteen stakeholders heard. Thirty-four entities across ten business areas. A working pilot in twenty-one days, validated by the people who named the problem.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg9",
    headline: "21 days from problem to working pilot.",
    subline: "Delivery economics that would be a differentiator for Brillio.",
    vo: "Twenty-one days from problem to working pilot. That's delivery economics that would be a differentiator for Brillio.",
    animFloor: 300,
    tail: 1.6,
  },
  {
    id: "seg8",
    eyebrow: "04 · Any business",
    headline: "One method. Every industry.",
    subline:
      "Different industries. Different problems. The same discipline — start from the business.",
    vo: "Patient referrals. Loan origination. Order fulfillment. Different problems — the same discipline … start from the business.",
    animFloor: 200,
    tail: 1.6,
    wpm: 132,
  },
  {
    id: "seg10",
    headline: "They now would… with AURA.",
    subline: "Would two teams draw the same picture?",
    accents: ["with AURA."],
    vo: "So — would two teams draw the same picture? … They now would… with Aura.",
    animFloor: 300,
    tail: 2.0,
  },
  {
    id: "seg11",
    headline: "The team that made Laila happen.",
    vo: "Meet the team that worked behind the scenes to make it all happen.",
    // A crawl has to be readable, and there are twenty names plus four
    // department headings to get past the frame. This is the one scene whose
    // length is set by how long people need, not by the narration.
    animFloor: 930,
    tail: 3.5,
  },
];

/**
 * Scene 10 — the credits, grouped by discipline the way a film's end titles
 * are: who shaped it, who built it, who designed it.
 */
export const TEAM: Array<{ group: string; people: Array<{ name: string; role: string }> }> = [
  {
    group: "Product",
    people: [
      { name: "Ibrahim Khalid", role: "Product Owner" },
      { name: "Nayana Pai", role: "Solution Architect" },
      { name: "Vasudev Bhat", role: "Technical Architect" },
      { name: "Prasoon Gupta", role: "Project Manager" },
    ],
  },
  {
    group: "Engineering",
    people: [
      { name: "Deepankar Nath", role: "Tech Lead" },
      { name: "Sunil Thukkaram", role: "Developer" },
      { name: "Farheen Fatima", role: "Developer" },
      { name: "Shashank Verma", role: "Developer" },
    ],
  },
  {
    group: "Design",
    people: [
      { name: "Alejandra Soto", role: "UX Designer" },
      { name: "Shweta Desai", role: "UX Designer" },
      { name: "Nithish R", role: "UX Designer" },
      { name: "Rishabh Bajaj", role: "UX Designer" },
    ],
  },
  {
    group: "Business SMEs",
    people: [
      { name: "Smitha B V", role: "Marketing" },
      { name: "Prakash TM", role: "Practices Sales" },
      { name: "Brindtiha RAI", role: "Practices Sales" },
      { name: "Hema Panneerselvam", role: "Delivery Manager" },
      { name: "Shripad Dixit", role: "Delivery Lead" },
      { name: "Tejwasvi Mohan", role: "Alliances" },
      { name: "Vimal Pandey", role: "Revenue Operation" },
      { name: "Ahmed Abouelkhir", role: "Talent Acquisition" },
    ],
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

/** Scene 4 — the stakeholders AURA engages, placed clockwise from top-left. */
export const STAKEHOLDERS = [
  { label: "Marketing", angle: -150 },
  { label: "Sales", angle: -90 },
  { label: "Legal", angle: -30 },
  { label: "Finance", angle: 30 },
  { label: "Delivery", angle: 90 },
  { label: "Talent", angle: 150 },
];
/**
 * Scene 4 — what the machine is hearing while the stakeholder talks. The
 * line is the "two weeks" half of the contradiction the scene then surfaces,
 * so the transcript is where the finding actually comes from.
 */
export const TRANSCRIPT = {
  label: "LIVE · TRANSCRIBING",
  speaker: "Sales lead",
  text: "We can't quote until Legal clears the terms — that's usually two weeks.",
};

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
/** Just the entity names — what the 3D model of the ontology renders. */
export const ONTOLOGY_LABELS: string[] = ONTOLOGY_NODES.map(([, , label]) => label);

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
  "21 days → working Sales pilot in Laila",
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

/** Seconds into a scene at which its narration begins. */
export const voLead = (s: Scene): number => ((s.voAt ?? VO_AT_DEFAULT) * BEAT) / FPS;

/** Frames a scene needs: its narration with breathing room, or its animation. */
export const sceneFrames = (s: Scene): number => {
  const voFrames = Math.ceil((voLead(s) + secs(s.id) + s.tail) * FPS);
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
    voOffsetsMs[s.id] = Math.round(((cursor / FPS) + voLead(s)) * 1000);
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
