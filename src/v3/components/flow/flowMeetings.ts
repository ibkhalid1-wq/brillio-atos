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
import { flowMovements, movementArtifacts, gateChecklist, readMovementInputs, parseGridRows } from "@/v3/components/flow/flowShellData";
import { FORMAL_ARTIFACT_FIELD_KEYS, FORMAL_ARTIFACT_PHASES } from "@/v3/lib/formalArtifacts";

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
    if (parseGridRows(inputs.stakeholderSeed).length === 0) questions.push("Whose working day changes? Name the people we must hear from.");
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
      header: `— ${who || "Stakeholder"}, ${today()} —`,
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
      captureField: "goDecisionRef",
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
export function kitGaps(program: ProgramSummary, movementId: string): string[] {
  const movement = flowMovements().find((entry) => entry.id === movementId);
  if (!movement) return [];
  const gaps: string[] = [];
  for (const item of gateChecklist(program, movement, movementArtifacts(program, movement))) {
    if (!item.done && item.anchor) gaps.push(item.label);
  }
  const inner = innerData(program);
  for (const [agentId, phase] of Object.entries(FORMAL_ARTIFACT_PHASES)) {
    if (phase !== movementId) continue;
    const doc = inner[FORMAL_ARTIFACT_FIELD_KEYS[agentId]];
    if (isRecord(doc) && Array.isArray(doc.gaps)) {
      gaps.push(...doc.gaps.map(String).filter(Boolean).slice(0, 4));
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

export function meetingKit(program: ProgramSummary, movementId: string): MeetingKit | null {
  const base = baseMeetingKit(program, movementId);
  if (!base) return null;
  if (!base.done) return { ...base, followUp: false, gaps: [], documents: scriptDocumentRefs(base.questions) };
  const gaps = kitGaps(program, movementId);
  if (!gaps.length) return { ...base, followUp: false, gaps: [], documents: scriptDocumentRefs(base.questions) };
  return {
    ...base,
    followUp: true,
    gaps,
    documents: scriptDocumentRefs(gaps),
    title: "Follow-up — close the gaps",
    purpose: `The last conversation left ${gaps.length} point${gaps.length === 1 ? "" : "s"} open. This script asks for exactly what's missing — nothing else.`,
    questions: gaps,
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
