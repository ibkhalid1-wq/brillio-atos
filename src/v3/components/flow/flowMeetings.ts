/**
 * Meeting kits — if the input is a conversation, the workspace should hand
 * you the conversation: who to sit down with, the script to run, and a place
 * to capture what was said. One kit per movement, derived from what the
 * programme already knows (missing facts become questions; generated agendas
 * and demo scripts become the script), so the kit is always current and costs
 * no model call.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { flowMovements, movementArtifacts, movementOpenIssues, kitPersonas, gateChecklist, readMovementInputs, parseGridRows, readContradictions, falsifiedGap } from "@/v3/components/flow/flowShellData";
import { FORMAL_ARTIFACT_FIELD_KEYS, FORMAL_ARTIFACT_PHASES } from "@/v3/lib/formalArtifacts";
import { getPhaseDefinition } from "@/v3/lib/methodology";

// stakeholderEmail moved to flowShellData (the gate checklist needs it); the
// meeting-kit surface keeps importing it from here.
export { stakeholderEmail } from "@/v3/components/flow/flowShellData";

export interface MeetingKit {
  /** e.g. "The sponsor conversation" */
  title: string;
  /** Who sits across the table. */
  who: string;
  purpose: string;
  questions: string[];
  /** Where the transcript lands when captured inline. */
  captureField: string;
  captureLabel: string;
  /** Prefilled attribution header for the paste. */
  header: string;
  /** The conversation this kit prepares is already on record. */
  done: boolean;
  /** This kit closes gaps a previous conversation left open. */
  followUp: boolean;
  gaps: string[];
  /** Documents the script's questions reference — offer to attach them. */
  documents: string[];
}

export interface FlowFollowUp {
  id: string;
  movementId: string;
  who: string;
  date: string;
  gaps: string[];
  createdAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

const filled = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
const today = () => new Date().toISOString().slice(0, 10);

function baseMeetingKit(program: ProgramSummary, movementId: string): Omit<MeetingKit, "followUp" | "gaps" | "documents"> | null {
  const inputs = readMovementInputs(program, movementId);
  const inner = innerData(program);

  if (movementId === "frame") {
    const sponsor = filled(inputs.sponsor) ? String(inputs.sponsor) : "the executive sponsor";
    const done = filled(inputs.sponsorConversation);
    const questions: string[] = [];
    if (!filled(inputs.businessObjective)) questions.push("What outcome should this system achieve — the change, the magnitude, and by when?");
    if (!filled(inputs.sponsor)) questions.push("Who owns this transformation end to end — name and role?");
    if (!filled(inputs.successMetric)) questions.push("Which single measure proves it worked? What is it today, and what should it become?");
    if (parseGridRows(readMovementInputs(program, "listen").interviewRoster).length === 0) questions.push("Whose working day changes? Name the people we must hear from.");
    if (!filled(inputs.targetFirstDemoDate)) questions.push("When should the first stakeholder watch their own workflow run — pick a date.");
    questions.push("What must NOT change — hard boundaries, systems that stay, lines we don't cross?");
    if (done && questions.length <= 1) {
      questions.length = 0;
      questions.push(
        "Anything shifted since we last spoke — scope, urgency, people?",
        "Does the charter read as your mandate — what would you change?",
        "Is the first-demonstration date still right?",
      );
    }
    return {
      title: "The sponsor conversation",
      who: sponsor,
      purpose: done
        ? "The mandate is on record — this script re-confirms it as things move."
        : "One recorded conversation frames the whole programme — the charter and discovery kit draft themselves from it.",
      questions,
      captureField: "sponsorConversation",
      captureLabel: "Paste what was said",
      header: `— ${sponsor === "the executive sponsor" ? "Sponsor" : sponsor}, ${today()} —`,
      done,
    };
  }

  if (movementId === "listen") {
    const kit = isRecord(inner.discoveryKit) ? inner.discoveryKit : null;
    const interviews = kit && Array.isArray(kit.interviews) ? kit.interviews.filter(isRecord) : [];
    if (!interviews.length) return null;
    const roster = parseGridRows(inputs.interviewRoster);
    const heard = new Set(
      roster.filter((row) => /heard|waived/i.test(row.status ?? "")).map((row) => (row.name ?? "").trim().toLowerCase()),
    );
    const next = interviews.find((entry) => !heard.has(String(entry.stakeholder ?? "").trim().toLowerCase()));
    const done = !next;
    const target = next ?? interviews[0];
    const agenda = Array.isArray(target.agenda) ? target.agenda.filter(isRecord) : [];
    const questions = agenda.flatMap((slot) => (Array.isArray(slot.questions) ? slot.questions.map(String) : [])).filter(Boolean).slice(0, 10);
    const objectives = Array.isArray(target.objectives) ? target.objectives.map(String).filter(Boolean) : [];
    const who = [String(target.stakeholder ?? "Stakeholder"), String(target.role ?? "")].filter(Boolean).join(", ");
    return {
      title: done ? "Follow-up conversation" : "The next discovery conversation",
      who,
      purpose: done
        ? "Every voice is heard — use this to close contradictions or go deeper."
        : objectives.length ? `This conversation must surface: ${objectives.join("; ")}.` : "A 45-minute recorded conversation, their own workflow in their own words.",
      questions,
      captureField: "interviewTranscripts",
      captureLabel: "Paste the conversation",
      header: `— ${who || "Stakeholder"}, ${today()} —`,
      done,
    };
  }

  if (movementId === "envision") {
    const strategy = isRecord(inner.architectureStrategy) ? inner.architectureStrategy : null;
    const candidates = strategy && Array.isArray(strategy.candidates) ? strategy.candidates.filter(isRecord) : [];
    if (!candidates.length) return null;
    const done = filled(inputs.steeringConversation) || filled(inputs.directionDecision);
    const questions = candidates.slice(0, 3).map((candidate) =>
      `${String(candidate.name ?? "Candidate")} (${String(candidate.shape ?? "shape")}): are its risks — ${(Array.isArray(candidate.risks) ? candidate.risks.map(String).slice(0, 2).join("; ") : "as scored")} — ones we can carry?`,
    );
    const recommendation = isRecord(strategy?.recommendation) ? String(strategy!.recommendation.candidate ?? "") : "";
    if (recommendation) questions.push(`ATOS recommends “${recommendation}” — what would make you overrule it?`);
    questions.push("Which candidate do we choose, and what are we knowingly trading away?");
    return {
      title: "The direction conversation",
      who: "Sponsor + technical leads",
      purpose: "Choose between the candidate architectures on the record — the Blueprint frames itself from this conversation.",
      questions,
      captureField: "steeringConversation",
      captureLabel: "Paste the conversation",
      header: `— Steering group, ${today()} —`,
      done,
    };
  }

  if (movementId === "show") {
    const doc = isRecord(inner.demoScripts) ? inner.demoScripts : null;
    const scripts = doc && Array.isArray(doc.scripts) ? doc.scripts.filter(isRecord) : [];
    if (!scripts.length) {
      // No scripted tour yet — the session still produces evidence. Capture
      // reactions and change asks into demoFeedback all the same.
      const tour = parseGridRows(inputs.demoTour);
      if (!tour.length && !filled(inputs.prototypeLocation)) return null;
      const pending = tour.find((row) => !/accepted/i.test(row.verdict ?? ""));
      const who = String(pending?.stakeholder ?? "The room");
      const done = filled(inputs.demoFeedback);
      return {
        title: "The demo session",
        who,
        purpose: "Every session is evidence — capture reactions and change asks while they are fresh; verdicts land in the tour ledger.",
        questions: [
          "What did you just watch run — in your words?",
          "Where does it not match how the work actually happens?",
          "What must change before you accept it?",
        ],
        captureField: "demoFeedback",
        captureLabel: "Paste the session — reactions and change asks",
        header: `— ${who}, Demo session, ${today()} —`,
        done,
      };
    }
    const tour = parseGridRows(inputs.demoTour);
    const verdictFor = (name: string) =>
      tour.find((row) => (row.stakeholder ?? "").trim().toLowerCase() === name.trim().toLowerCase())?.verdict ?? "";
    const next = scripts.find((script) => !/accepted/i.test(verdictFor(String(script.stakeholder ?? ""))));
    const done = !next;
    const target = next ?? scripts[0];
    const steps = Array.isArray(target.steps) ? target.steps.filter(isRecord) : [];
    const questions = [
      String(target.openingQuote ?? "").trim() ? `Open with their words: ${String(target.openingQuote)}` : "",
      ...steps.slice(0, 6).map((step) => [step.beat, step.say].filter(Boolean).map(String).join(" — ")),
      String(target.acceptanceAsk ?? "Does this run your workflow the way you need it to?"),
    ].filter(Boolean);
    const who = [String(target.stakeholder ?? "Stakeholder"), String(target.role ?? "")].filter(Boolean).join(", ");
    return {
      title: done ? "Encore demonstration" : "The next demonstration",
      who,
      purpose: done
        ? "Every verdict is in — run this again after refinements."
        : "They watch their own workflow run; the verdict is the gate.",
      questions,
      captureField: "demoFeedback",
      captureLabel: "Paste the session — reactions and change asks",
      header: `— ${who || "Stakeholder"}, Demo session, ${today()} —`,
      done,
    };
  }

  if (movementId === "ship") {
    const lanesDoc = isRecord(inner.shipLanes) ? inner.shipLanes : null;
    if (!lanesDoc) return null;
    const done = filled(inputs.goDecisionRef);
    return {
      title: "The go / no-go conversation",
      who: "Sponsor + operating owner",
      purpose: "The shipping decision is a recorded conversation, not a signature.",
      questions: [
        "Is the eval suite green — and do we trust what it measures?",
        "Which hardening items remain open, and do we accept them as named risks?",
        "Is the operating team ready to own it from day one?",
        "Go or no-go — who says it, and when do we cut over?",
      ],
      captureField: "shipConversations",
      captureLabel: "Record the decision — reference or summary",
      header: "",
      done,
    };
  }

  if (movementId === "evolve") {
    return {
      title: "The monthly ops review",
      who: "Operating owner + sponsor",
      purpose: "The loop that keeps the system honest — each review re-runs the benefits pulse and drift detection.",
      questions: [
        "What moved on the KPIs since last month — and does the system get the credit?",
        "Where has reality drifted from the shipped workflows or the ontology?",
        "What did people route around? That's the next backlog item.",
        "Anything to retire, simplify, or double down on?",
      ],
      captureField: "opsConversations",
      captureLabel: "Paste this month's review",
      header: `— Ops review, ${today()} —`,
      done: false,
    };
  }

  return null;
}

/**
 * What the conversations on record FAILED to surface: unmet fact criteria
 * from the gate checklist plus the gaps every generator writes into its own
 * document ("the charter cannot be considered ready because…"). These are the
 * follow-up's agenda.
 */
export function kitGaps(program: ProgramSummary, movementId: string, opts?: { gateLabels?: boolean }): string[] {
  // Gate-checklist labels ("Business objective captured") are bookkeeping —
  // useful to the operator (they gate whether a follow-up still matters), but
  // never a question to put back in front of a stakeholder once a conversation
  // is on record. Stakeholder-facing callers pass gateLabels:false so a
  // follow-up re-asks only what a NEW conversation can actually resolve.
  const gateLabels = opts?.gateLabels ?? true;
  const movement = flowMovements().find((entry) => entry.id === movementId);
  if (!movement) return [];
  const gaps: string[] = [];
  // Whatever the movement's documents still ASK — unresolved ambiguities,
  // open questions — is conversation work: it lands on the follow-up script
  // (the askable filter strips anything operator-phrased downstream).
  for (const issue of movementOpenIssues(program, movement)) {
    gaps.push(issue.text);
  }
  // Open contradictions route to the SPONSOR: two accounts disagree and
  // someone with authority arbitrates. Each open row becomes an ask on the
  // sponsor's follow-up script (and its async link) automatically.
  if (movementId === "frame") {
    // A persona nobody can speak for is the sponsor's to place: who faces
    // them, who owns their part of the workflow?
    const personas = kitPersonas(program) ?? [];
    for (const persona of personas.filter((entry) => entry.unrepresented || entry.spokenForBy.length === 0)) {
      gaps.push(`Who can speak for the ${persona.name}${persona.kind === "external" ? " — the person who faces them, if they can't be in the room" : ""}?`);
    }
    for (const row of readContradictions(program, true)) {
      const between = row.between.trim();
      gaps.push(`Two accounts disagree${between ? ` (${between})` : ""}: "${row.statement.trim()}" — which is right, and what settles it?`);
    }
  }
  // ARTIFACT gaps outrank gate-checklist labels: a generated document saying
  // "we still don't know X" is a real question for a stakeholder; a checklist
  // label is bookkeeping that only pads the script. EVERY artifact this
  // movement requires contributes — the methodology's own requiredArtifacts
  // list is the source of truth, so an artifact whose FORMAL_ARTIFACT_PHASES
  // entry still names a retired classic home (the charter → "strategy") can
  // never fall out of sight of its kit.
  const inner = innerData(program);
  const flowDef = getPhaseDefinition(movementId, "atos-flow");
  const gapDocKeys = new Set<string>();
  for (const [agentId, phase] of Object.entries(FORMAL_ARTIFACT_PHASES)) {
    if (phase === movementId) gapDocKeys.add(FORMAL_ARTIFACT_FIELD_KEYS[agentId]);
  }
  for (const artifactId of flowDef?.requiredArtifacts ?? []) {
    const fieldKey = FORMAL_ARTIFACT_FIELD_KEYS[artifactId];
    if (fieldKey) gapDocKeys.add(fieldKey);
  }
  for (const fieldKey of gapDocKeys) {
    const doc = inner[fieldKey];
    if (isRecord(doc) && Array.isArray(doc.gaps)) {
      // Falsified field-demands (the field is demonstrably filled) drop here
      // too — the scripts, the cards, and the gate read one truth.
      gaps.push(...doc.gaps.map(String).filter(Boolean)
        .filter((gap) => !falsifiedGap(program, gap)).slice(0, 4));
    }
  }
  if (gateLabels) {
    for (const item of gateChecklist(program, movement, movementArtifacts(program, movement))) {
      if (!item.done && item.anchor) gaps.push(item.label);
    }
  }
  return [...new Set(gaps)].slice(0, 8);
}

/**
 * The kit, made practical: once a conversation is on record, any gaps it
 * left turn the kit into a FOLLOW-UP — a script targeting exactly what's
 * missing, schedulable onto the calendar or sendable as an async link.
 */
/**
 * Document names a script's questions reference — quoted names plus
 * "the <name> <document-word>" phrases. Deterministic, so the kit can offer
 * to attach exactly what the conversation will ask for.
 */
const DOC_WORD = "(?:document|export|report|spreadsheet|sheet|policy|log|register|deck|diagram|contract|sow|runbook|extract|file)";
export function scriptDocumentRefs(questions: string[]): string[] {
  const out = new Map<string, string>(); // lowercased key → first-seen casing
  const add = (name: string) => {
    const key = name.trim().toLowerCase();
    if (key && !out.has(key)) out.set(key, name.trim());
  };
  for (const question of questions) {
    for (const match of question.matchAll(/["“”]([^"“”]{3,60})["“”]/g)) add(match[1]);
    for (const match of question.matchAll(new RegExp(`\\b(?:the|a|an|your|their|its|current|latest)\\s+([A-Za-z0-9][\\w&/-]*(?:\\s+[\\w&/-]+){0,5}?\\s${DOC_WORD})\\b`, "gi"))) {
      add(match[1]);
    }
  }
  return [...out.values()].slice(0, 4);
}

/**
 * A gap is ASKABLE when a conversation can supply it. Gaps phrased against
 * the app's plumbing — inputs, ledgers, artifacts, regeneration — are the
 * operator's work; they live on the cards and the gate, never in a script
 * put in front of a stakeholder.
 */
function askableGap(gap: string): boolean {
  return !/\binputs?\b|\bledger\b|\bartifacts?\b|\bregenerat|\bevidence changed\b|\bemail\b/i.test(gap);
}

/**
 * Operator-worded gaps about STAKEHOLDER-OWNED facts become stakeholder
 * questions instead of dying in the filter. "Add a concise, outcome-oriented
 * statement to the Objective input" is phrased at the operator — but the
 * objective is the sponsor's fact, so the follow-up script asks the sponsor
 * for it directly. Gaps about genuine plumbing (ledgers, regeneration) still
 * stay off every script.
 */
const GAP_REPHRASE: Array<{ match: RegExp; ask: string }> = [
  { match: /objective|outcome-oriented/i, ask: "In one sentence: what outcome must this programme achieve — by when, and measured how?" },
  { match: /success (?:criteria|metric)|kpi|baseline|target/i, ask: "Which measurable results would prove this worked — and what are today's baselines and the targets?" },
  { match: /\bscope\b/i, ask: "What is explicitly in scope — and what is explicitly out?" },
  { match: /sponsor|mandate|authoris/i, ask: "Who commissioned this programme, and what exactly did they commission?" },
  { match: /budget|funding|cost envelope/i, ask: "What budget envelope backs this programme — and how should spend be tracked against it?" },
];

function rephraseGapAsAsk(gap: string): string {
  if (askableGap(gap)) return gap;
  const hit = GAP_REPHRASE.find((entry) => entry.match.test(gap));
  if (hit) return hit.ask;
  // No bespoke rule, but the gap names the field it wants ("… to the Budget
  // input"): ask the stakeholder for the FACT rather than dropping the ask —
  // a gap shown on the artifact card must reach the follow-up script.
  const field = gap.match(/to the ([A-Za-z][\w ,&/-]{2,48}?) inputs?\b/i)?.[1];
  if (field) return `What should go on record for ${field.trim().toLowerCase()}? Please give the specifics a document could cite.`;
  return gap;
}

/**
 * The movement's open gaps as STAKEHOLDER questions — rephrased where the gap
 * was operator-worded, plumbing filtered out, capped. This is the one door
 * through which artifact gaps reach interview scripts, so per-person scripts
 * (the interviewee cards) and the movement kit always agree.
 */
export function askableMovementGaps(program: ProgramSummary, movementId: string, cap = 8): string[] {
  // Stakeholder-facing: drop gate-checklist bookkeeping — an interviewee gets
  // real artifact questions and disputes, never "discovery kit generated".
  // The cap matches kitGaps' own ceiling so a gap shown on an artifact card is
  // ALSO on the follow-up script — one set of open questions, two surfaces.
  return [...new Set(kitGaps(program, movementId, { gateLabels: false }).map(rephraseGapAsAsk))].filter(askableGap).slice(0, cap);
}

/**
 * Discovery-kit regeneration guidance from the operator's coverage map. Thin
 * domains (and personas nobody can speak for) become explicit instructions to
 * deepen those domains' questions and secure a second voice — so a Regenerate
 * acts on the operator's triage instead of re-deriving from evidence alone.
 * Returns null when the map is clean (nothing to steer).
 */
export function discoveryKitCoverageGuidance(program: ProgramSummary): string | null {
  const kit = innerData(program).discoveryKit;
  if (!isRecord(kit)) return null;
  const rows = Array.isArray(kit.coverageMap) ? kit.coverageMap.filter(isRecord) : [];
  const thin = rows.filter((row) => row.thin === true).map((row) => String(row.domain ?? "").trim()).filter(Boolean);
  const unrep = (Array.isArray(kit.personas) ? kit.personas.filter(isRecord) : [])
    .filter((persona) => persona.unrepresented === true || (Array.isArray(persona.spokenForBy) && persona.spokenForBy.length === 0))
    .map((persona) => String(persona.name ?? "").trim()).filter(Boolean);
  if (!thin.length && !unrep.length) return null;
  const lines = ["## Coverage priorities from the operator (honour these when regenerating the kit)"];
  if (thin.length) lines.push(`These workflow domains are THINLY covered — add deeper, domain-specific questions for them and line up a second interviewee who owns each: ${thin.join(", ")}.`);
  if (unrep.length) lines.push(`These personas have no voice yet — add an interview (or a proxy) who can speak for them: ${unrep.join(", ")}.`);
  return lines.join("\n");
}

export function meetingKit(program: ProgramSummary, movementId: string): MeetingKit | null {
  const base = baseMeetingKit(program, movementId);
  if (!base) return null;
  if (!base.done) return { ...base, followUp: false, gaps: [], documents: scriptDocumentRefs(base.questions) };
  // A conversation is on record: the follow-up re-asks only what a NEW
  // conversation can resolve — open artifact gaps, contradictions, unplaced
  // personas — not gate-checklist labels the operator closes by regenerating.
  const asks = [...new Set(kitGaps(program, movementId, { gateLabels: false }).map(rephraseGapAsAsk))].filter(askableGap);
  // Heard, nothing outstanding: the script is DONE — show no follow-up
  // questions rather than replaying the original agenda they've answered.
  if (!asks.length) return { ...base, followUp: false, gaps: [], questions: [], documents: [] };
  return {
    ...base,
    followUp: true,
    gaps: asks,
    documents: scriptDocumentRefs(asks),
    title: "Follow-up — close the gaps",
    purpose: `The last conversation left ${asks.length} point${asks.length === 1 ? "" : "s"} open. This script asks for exactly what's missing — nothing else.`,
    questions: asks,
  };
}

/** Schedule a follow-up: it lands on Today's calendar with its gap agenda. */
export function scheduleFollowUp(
  program: ProgramSummary,
  movementId: string,
  who: string,
  date: string,
  actor: string,
): Record<string, unknown> | null {
  if (!who.trim() || !date) return null;
  const { wrapper, inner, usesNestedData } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const list = Array.isArray(inner.flowFollowUps) ? (inner.flowFollowUps as unknown[]) : [];
  const entry = {
    id: `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    movementId,
    who: who.trim(),
    date,
    gaps: kitGaps(program, movementId).slice(0, 6),
    createdAt: new Date().toISOString(),
  };
  const log = Array.isArray(inner.flowAttestations) ? (inner.flowAttestations as unknown[]) : [];
  const attestation = {
    ts: new Date().toISOString(), agentId: actor, phaseId: movementId, tier: 2,
    action: `Scheduled a follow-up — ${entry.who}, ${date}`,
    detail: entry.gaps.slice(0, 3).join("; ").slice(0, 160),
  };
  return wrapProgramState(wrapper, {
    ...inner,
    flowFollowUps: [...list, entry].slice(-30),
    flowAttestations: [...log, attestation].slice(-200),
  }, usesNestedData);
}

/** Scheduled follow-ups that still matter: dated today+ AND with open gaps. */
export function listFollowUps(program: ProgramSummary): FlowFollowUp[] {
  const list = innerData(program).flowFollowUps;
  if (!Array.isArray(list)) return [];
  const cutoff = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return list.filter(isRecord).map((entry): FlowFollowUp => ({
    id: String(entry.id ?? ""),
    movementId: String(entry.movementId ?? ""),
    who: String(entry.who ?? ""),
    date: String(entry.date ?? ""),
    gaps: Array.isArray(entry.gaps) ? entry.gaps.map(String) : [],
    createdAt: String(entry.createdAt ?? ""),
  })).filter((entry) =>
    entry.id && entry.date >= cutoff && kitGaps(program, entry.movementId).length > 0,
  );
}


const escapeIcs = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** An .ics calendar invite whose DESCRIPTION is the interview script — open
 * it and the meeting lands on the calendar with the agenda attached. Floating
 * local time (no TZID): 10:00 wherever the operator is. */
export function buildMeetingIcs(input: {
  who: string;
  email?: string | null;
  date: string;
  durationMinutes?: number;
  programmeName: string;
  intro?: string;
  questions: string[];
}): string {
  const day = input.date.replace(/-/g, "");
  const minutes = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 45;
  const endHour = 10 + Math.floor(minutes / 60);
  const endMin = minutes % 60;
  const description = [
    input.intro ?? "",
    "",
    "Agenda:",
    ...input.questions.map((question, index) => `${index + 1}. ${question}`),
  ].filter((line, index) => index !== 0 || line).join("\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ATOS Flow//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:atos-${day}-${input.who.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@atos-flow`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${day}T100000`,
    `DTEND:${day}T${String(endHour).padStart(2, "0")}${String(endMin).padStart(2, "0")}00`,
    `SUMMARY:${escapeIcs(`${input.programmeName} — discovery with ${input.who}`)}`,
    ...(input.email ? [`ATTENDEE;CN=${escapeIcs(input.who)}:mailto:${input.email}`] : []),
    `DESCRIPTION:${escapeIcs(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** mailto: URL carrying a response link, ready to send. */
export function mailtoLink(email: string, input: { stakeholder: string; programmeName: string; link: string }): string {
  const subject = `${input.programmeName} — a few questions, in your own words`;
  const body = [
    `Hi ${input.stakeholder.split(" ")[0]},`,
    "",
    "Your perspective shapes what we build next. This link takes a few minutes,",
    "typed or dictated, whenever suits you:",
    "",
    input.link,
    "",
    "Everything you write arrives attributed to you and goes on the record.",
  ].join("\n");
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
