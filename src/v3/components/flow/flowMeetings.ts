/**
 * Meeting kits — if the input is a conversation, the workspace should hand
 * you the conversation: who to sit down with, the script to run, and a place
 * to capture what was said. One kit per movement, derived from what the
 * programme already knows (missing facts become questions; generated agendas
 * and demo scripts become the script), so the kit is always current and costs
 * no model call.
 */
import type { ProgramSummary } from "@/new/types";
import { readMovementInputs, parseGridRows } from "@/v3/components/flow/flowShellData";

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
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
}

const filled = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
const today = () => new Date().toISOString().slice(0, 10);

export function meetingKit(program: ProgramSummary, movementId: string): MeetingKit | null {
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
    if (!scripts.length) return null;
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
