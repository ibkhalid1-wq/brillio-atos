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
      "Every one of those pilots was built on somebody's opinion of how the business works. Never on evidence.",
    vo: "The failure was never AI. Every one of those pilots was built on somebody's opinion of how the business works. Never on evidence.",
    animFloor: 220,
    tail: 1.4,
  },
  {
    id: "seg3",
    headline: "AURA derived Laila from evidence.",
    subline: "Meet AURA — Brillio's AI-native delivery methodology, and the system that runs it.",
    accents: ["Laila", "evidence"],
    vo: "Meet Aura — Brillio's AI-native delivery methodology, and the system that runs it … Laila, a functional CRM prototype, was derived from evidence and built by Aura.",
    animFloor: 360,
    tail: 1.4,
    // The mark draws, then the spine assembles, and only then does the name
    // type on at b(12). Speaking before that had the line arriving five
    // seconds after it was said. Now the three sentences land with the
    // subline, the headline and the 21-days chip in turn.
    voAt: 11,
  },
  {
    // AURA does not start from a blank page — it starts from the industry's
    // accumulated standards and produces something provisional, fast. This
    // answers the cold-start question a sceptic always asks: how does it know
    // anything before it has spoken to anyone?
    id: "seg4a",
    eyebrow: "It doesn't start from a blank page",
    headline: "Provisional in minutes. Grounded in the standards.",
    subline: "Entities, personas and workflows — drawn from the standards of your industry before a single conversation.",
    vo: "Aura doesn't start from a blank page. It generates a provisional ontology — personas, workflows, entities — grounded in the standards of your industry.",
    animFloor: 420,
    tail: 1.6,
  },
  {
    id: "seg8",
    eyebrow: "Any business",
    headline: "One method. Every industry.",
    subline:
      "Different industries. Different problems. The same discipline — start from the business.",
    vo: "Patient referrals. Loan origination. Order fulfillment. Different problems — the same discipline … start from the business.",
    animFloor: 200,
    tail: 1.6,
    wpm: 132,
  },
  {
    id: "seg4",
    eyebrow: "Then it goes to the people",
    headline: "AURA is designed to engage with stakeholders autonomously.",
    subline:
      "Every gap becomes a plain-language question — routed on a no-login link, answered in their own words, folded back in.",
    vo: "From there Aura engages your stakeholders autonomously — writing the agenda from its own gaps, drafting the invitation, transcribing the conversation, folding every answer back into the model. Every disagreement a finding, not noise. The provisional becomes yours.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg5",
    eyebrow: "Your business, mapped",
    headline: "Same mandate. Same map. Every time.",
    vo: "What comes back is your company's own map. Not a document — the foundation. The architecture, the solutions and the prototype are all generated from it … Run it twice: the same map, every time.",
    animFloor: 380,
    tail: 1.4,
  },
  {
    id: "seg6",
    eyebrow: "Governed by design",
    headline: "Autonomous — with a human in the loop, end to end.",
    subline: "Machine proposes. The business validates. Every judgment recorded as evidence.",
    vo: "And control is the architecture. The machine proposes — the business validates. Every phase gates on a demonstration. Every judgment lands on a permanent record. And it doesn't stop at go-live: Aura watches the model drift as the business changes, and proposes the correction for your team to accept … Autonomy you can audit.",
    animFloor: 380,
    tail: 1.4,
  },
  {
    id: "seg7",
    vo: "One real business problem. Ten stakeholders heard. Thirty-two entities across ten business areas. A working prototype in twenty-one days, validated by the people who named the problem.",
    animFloor: 360,
    tail: 1.4,
  },
  {
    id: "seg9",
    headline: "21 days from problem to working prototype.",
    subline: "Delivery economics that would be a Brillio differentiator today.",
    vo: "Twenty-one days from problem to working prototype. That's delivery economics that would be a Brillio differentiator today.",
    animFloor: 300,
    tail: 1.6,
  },
  {
    // The film has just proved one delivery. This is the only forward-looking
    // beat in it: what the same orchestration does across a whole product
    // life, with today's five movements shown as one segment of a longer arc.
    id: "seg7b",
    eyebrow: "What comes next",
    headline: "Imagine the possibilities.",
    subline: "Today, AI-native solutions to complex business problems. Next, the full product lifecycle.",
    vo: "Today, Aura orchestrates the design of AI-native solutions to complex business problems … Imagine extending it to deliver the full product lifecycle.",
    // The arc has to draw, nine stages have to land and the key has to
    // register; the narration is short, so the scene is sized by the build.
    animFloor: 450,
    tail: 1.8,
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
    // Generated near its target so the levelling pass barely touches it:
    // stretching this line 12% to reach the film rate produced a drawl that
    // reads as slow even though it is the fastest line in the cut.
    wpm: 180,
    // A crawl has to be readable, and there are twenty names plus four
    // department headings to get past the frame. This is the one scene whose
    // length is set by how long people need, not by the narration.
    //
    // 930 kept each name legible for 10.3s — about a THIRD of cinema speed,
    // which is why the close dragged. The crawl is a linear interpolation over
    // [b(1), dur - b(5)], so this number alone sets the rate: 570 puts a name
    // on screen for 6s, still a fifth longer than a real end-credit roll,
    // which suits a room where people are looking for their own name.
    animFloor: 570,
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

/**
 * Scene 4a — the PROVISIONAL ontology, before anyone has been interviewed.
 *
 * All thirteen entities of the live "Laila - Provisional" programme, verbatim:
 * a standards-derived seed generated from the sponsor's mandate alone, with
 * zero voices heard. Read them and the point makes itself — Person,
 * Organization, Product, Order — these are textbook nouns. ANY business could
 * have this list, which is exactly what a provisional model should look like.
 *
 * The contrast with ONTOLOGY_NODES below is the whole mechanism of the film,
 * and it is carried by the words themselves rather than by a caption. Both
 * lists are real; neither is illustrative.
 */
export const PROVISIONAL_LABELS: string[] = [
  // Ontology3D links each node to the next two, so ORDER is what draws the
  // relationships. Account sits beside Opportunity because "Opportunity
  // applies to Account" is one of the eleven relations the live provisional
  // programme actually returned — the pairing is real, not arranged. Lead
  // precedes Opportunity for the same reason ("Lead leads to Opportunity").
  "Person", "Organization", "Account", "Opportunity", "Lead", "Contact",
  "Offer", "Order", "Contract", "Invoice", "Campaign", "Product", "Service",
];

/** Scene 5 — the entities that bloom on the ontology map. */
/**
 * ALL 32 entities of Laila's live domain ontology, and the count is the point:
 * against the thirteen above, the map has to LOOK like more than the seed or
 * the scene argues against itself. Showing twelve made the finished ontology
 * appear smaller than the provisional one.
 *
 * Thirty-two labelled plates cannot fit two side-by-side run cards, so eight
 * carry their names and the other twenty-four are drawn as nodes (empty label
 * = unlabelled). Every one is a real entity, listed in ONTOLOGY_CORE below —
 * none is decoration, and the dense pattern being identical across both runs
 * proves determinism harder than twelve plates did.
 *
 * The named eight are deliberately the ones the STANDARDS could never have
 * supplied. Buying Committee, Practice Forecast Split, Revenue Recognition and
 * Forecast Snapshot came out of sixteen interviews and exist nowhere in
 * schema.org — set against the provisional list above, they are the visible
 * proof that the stakeholders changed something.
 */
/** The eight the map names — every one a noun sixteen interviews produced and
 * schema.org has never heard of, plus the anchors that orient the value chain. */
/** All 32 of Laila CRM's live entities, in the app's own order. Every name on
 * the map is a name the business uses; none is a placeholder. */
export const ONTOLOGY_SPHERE: string[] = [
  "Lead", "Lead Score", "Campaign", "Campaign Member", "Buying Committee",
  "Contact", "Account", "Competitor", "Opportunity", "Opportunity Line Item",
  "Quote", "Proposal", "Contract", "SOW", "Engagement",
  "Milestone", "Delivery Health", "Escalation", "Staffing", "Timesheet",
  "Invoice", "Billing Schedule", "Revenue Recognition", "Revenue Projection",
  "Practice Contribution", "Practice Forecast Split", "Forecast Snapshot",
  "Partner", "Signal", "Signal Action", "Document", "Event",
];

/** The same 32 nodes for the closing ring, but only eight named. At that size
 * the centre has to read as the OBJECT the board already met in the map scene,
 * not as text — 32 labels at 11px is a grey blob. Density carries the
 * recognition; the eight names carry the vocabulary. */
const RING_NAMED = ["Lead", "Opportunity", "Contract", "SOW", "Engagement", "Invoice", "Delivery Health", "Forecast Snapshot"];
export const ONTOLOGY_RING: string[] = Array.from(
  { length: 32 },
  (_, i) => (i % 4 === 0 ? RING_NAMED[i / 4] ?? "" : ""),
);

/**
 * The twenty-four the core stands for, in the app's own order — kept so the
 * claim "every node is real" is checkable rather than asserted.
 */
export const ONTOLOGY_CORE: string[] = [
  "Account", "Billing Schedule", "Campaign", "Campaign Member", "Competitor",
  "Contact", "Contract", "Delivery Health", "Document", "Engagement",
  "Escalation", "Event", "Invoice", "Lead Score", "Milestone",
  "Opportunity Line Item", "Partner", "Practice Contribution", "Quote",
  "Revenue Projection", "Signal", "Signal Action", "SOW", "Staffing",
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
/**
 * Scene 7b — the arc. The five movements the film has just demonstrated sit
 * lit in the middle; the stages either side are dimmed, because they are the
 * possibility being described rather than anything that has been run.
 */
export const LIFECYCLE = {
  today: ["Frame", "Listen", "Prototype"],
  after: ["Ship", "Evolve", "Adoption", "Scale"],
};

export const GOVERNANCE_CHIPS = [
  "Every phase gates on a demonstration",
  "Every judgment on a permanent record",
  "“Working” defined before a line of code",
];

/** Scene 7 — the proof. Last entry rolls 0→21 as it lands. */
export const NUMBERS = [
  "1 mandate",
  "10 stakeholders heard",
  "32 entities",
  "10 business areas",
  "21 days → working Sales prototype in Laila",
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
  // Organization, not Account. The card's row reads schema.org/Organization,
  // and in the live provisional programme Account no longer carries that
  // alignment — it resolves to a CRM class, and there is no public CRM URI
  // namespace, so it aligns to nothing. Organization is the entity that
  // genuinely holds this row (voted from the drafts, hence skos:closeMatch
  // rather than the exactMatch a synthesised core would get).
  standardAlignment: { file: "align-row.png", label: "STANDARD ALIGNMENT · LIVE FROM THE PROGRAMME", entity: "Organization" },
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
