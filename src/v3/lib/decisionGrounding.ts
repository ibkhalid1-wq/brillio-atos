/**
 * Client-side grounding guard for persisted change-request (PCR) decisions.
 *
 * The edge function suppresses "no objectives / no owners / no timeline / no
 * KPIs" findings at generation time (run-agent `buildPlanGroundingIndex` +
 * `claimsMissing`). But once such a finding has been persisted into
 * `program.data.decisionQueue`, the persisted re-emit path resurfaces it on
 * every render regardless of current state — so a PCR claiming something is
 * missing keeps reappearing even after the programme has that thing populated.
 *
 * This mirrors the edge logic on the client so the open queue self-suppresses a
 * persisted absence-claim PCR the moment the programme grounds it, instead of
 * requiring the user to reject the same false positive after every regeneration.
 * Exit-criteria PCRs are stale by methodology definition (exit criteria are
 * derived at gate review, never user-authored), so they are dropped outright.
 *
 * Scope is deliberately limited to change-request/PCR decisions: a gate approval
 * or escalation that merely mentions "objectives" in passing is never touched.
 */
import type { DecisionSummary, ProgramSummary } from "@/new/types";

const ABSENCE_NEG =
  "(?:no|not|none|missing|lack(?:s|ing)?|absence|without|never|undefined|absent|isn'?t|aren'?t|hasn'?t|haven'?t)";
const ABSENCE_DEF_VERB =
  "(?:defined|established|set|provided|identified|assigned|specified|documented|baselined|in\\s+place|exist|present|available|captured)";
const TIMELINE_NOUN =
  "(?:estimated\\s+)?(?:timelines?|milestones?|target\\s+dates?|delivery\\s+dates?|schedules?|start\\s+and\\s+end\\s+dates?)";
const OWNER_NOUN = "(?:owners?|accountable\\s+(?:owners?|parties)|raci(?:\\s+matrix)?)";
const OBJECTIVE_NOUN =
  "(?:(?:program(?:me)?|business|strategic|transformation)\\s+)?(?:objectives?|goals?|vision|mandate)";
const KPI_NOUN =
  "(?:kpis?|key\\s+(?:health\\s+)?(?:indicators?|metrics?)|health\\s+indicators?|success\\s+(?:metrics?|criteria)|target\\s+(?:metrics?|outcomes?)|measures\\s+of\\s+success)";
const EXIT_CRITERIA = /\b(?:phase\s+)?exit\s+criteria\b|\bexit\s+gate/i;

// Decision types that represent a recommended change request. Only these are
// eligible for grounding suppression — every other decision type is left alone.
const PCR_DECISION_TYPES = new Set(["pcr-review", "pcr", "change_request", "change-request"]);

/** True when `text` asserts the absence/undefined-ness of `nounSource`. */
export function claimsMissing(text: string, nounSource: string, allowBare: boolean): boolean {
  const fill = "[\\w\\s,/'\"()-]";
  const negThenNoun = new RegExp(`\\b${ABSENCE_NEG}\\b${fill}{0,60}?\\b${nounSource}\\b${fill}{0,40}?\\b${ABSENCE_DEF_VERB}\\b`, "i");
  const nounThenNeg = new RegExp(`\\b${nounSource}\\b${fill}{0,40}?\\b${ABSENCE_NEG}\\b${fill}{0,25}?\\b${ABSENCE_DEF_VERB}\\b`, "i");
  if (negThenNoun.test(text) || nounThenNeg.test(text)) return true;
  if (allowBare) {
    const bare = new RegExp(`\\b(?:no|missing|without|lack of|absence of)\\s+(?:\\w+\\s+){0,2}?${nounSource}\\b`, "i");
    if (bare.test(text)) return true;
  }
  return false;
}

export interface PlanGrounding {
  hasTimeline: boolean;
  hasOwners: boolean;
  hasObjective: boolean;
  hasKpis: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** A string input that carries real content (a few words, not a placeholder). */
function inputHasContent(value: unknown, minLen = 12): boolean {
  return typeof value === "string" && value.trim().length >= minLen;
}

/** A KPI grid (array or JSON-encoded array) with at least one populated row. */
function kpiGridHasEntries(value: unknown): boolean {
  const arr = typeof value === "string" ? safeParse(value) : value;
  return Array.isArray(arr) && arr.filter(isRecord).some((row) =>
    Object.values(row).some((cell) => typeof cell === "string" && cell.trim().length > 0),
  );
}

/** Roster row carries a non-empty value in a name-like column. */
function rosterHasNamedOwner(rows: Array<Record<string, unknown>>): boolean {
  return rows.some((row) => {
    const nameKey = Object.keys(row).find((key) => /name/i.test(key));
    const value = nameKey ? row[nameKey] : null;
    return typeof value === "string" && value.trim().length > 0;
  });
}

/** Every array-of-records value in the Mobilise inputs, treated as roster rows. */
function collectRosterRows(inputs: Record<string, unknown>): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const value of Object.values(inputs)) {
    const arr = typeof value === "string" ? safeParse(value) : value;
    if (Array.isArray(arr)) {
      for (const item of arr) if (isRecord(item)) rows.push(item);
    }
  }
  return rows;
}

/**
 * Which "absence" claims are provably false for this programme, read from the
 * Strategy/Mobilise phase inputs — the same source the edge function grounds on
 * (timeline + objective + KPIs live on Strategy inputs; named owners live on the
 * Mobilise roster).
 */
export function buildPlanGroundingIndex(program: ProgramSummary | null | undefined): PlanGrounding {
  const raw = asRecord(program?.rawData as unknown);
  const inner = isRecord(raw.data) ? (raw.data as Record<string, unknown>) : raw;
  const phaseInputs = asRecord(inner.phaseInputs);
  const strategy = asRecord(phaseInputs.strategy);
  const mobilise = asRecord(phaseInputs.mobilise);
  const start = strategy.startDate;
  const end = strategy.targetEndDate ?? strategy.endDate;
  const hasTimeline =
    typeof start === "string" && !!start.trim() && typeof end === "string" && !!end.trim();
  const hasOwners = rosterHasNamedOwner(collectRosterRows(mobilise));
  const hasObjective =
    inputHasContent(strategy.businessObjective) ||
    inputHasContent(strategy.objective) ||
    inputHasContent(strategy.vision);
  const hasKpis =
    kpiGridHasEntries(strategy.kpis) ||
    inputHasContent(strategy.successMetric) ||
    inputHasContent(strategy.successMetrics) ||
    inputHasContent(strategy.healthIndicators);
  return { hasTimeline, hasOwners, hasObjective, hasKpis };
}

/**
 * True when a piece of text provably contradicts current programme state: it
 * claims objectives / owners / timeline / KPIs are missing while those inputs
 * are populated, or it demands phase exit criteria (which are derived at gate
 * review, never authored). Operates on free text so both PCR decisions and scope
 * signals can be grounded through the same logic.
 */
export function isGroundedAbsenceClaim(text: string, grounding: PlanGrounding): boolean {
  const lower = (text ?? "").toLowerCase();
  if (EXIT_CRITERIA.test(lower)) return true;
  if (grounding.hasTimeline && claimsMissing(lower, TIMELINE_NOUN, false)) return true;
  if (grounding.hasOwners && claimsMissing(lower, OWNER_NOUN, true)) return true;
  if (grounding.hasObjective && claimsMissing(lower, OBJECTIVE_NOUN, true)) return true;
  if (grounding.hasKpis && claimsMissing(lower, KPI_NOUN, true)) return true;
  return false;
}

// Imperative verbs that ask someone to supply a missing artefact value.
const PROVIDE_VERB =
  "(?:define|establish|set(?:\\s+up)?|provide|document|baseline|create|assign|identify|specify|capture|add|approve)";

/**
 * True when a piece of text *directs* the reader to supply something the
 * programme already owns: "define the objectives", "establish exit criteria",
 * "assign owners". The absence-claim check catches negated statements ("no
 * objectives are defined"); this catches the imperative phrasing recommendation
 * lists use. Only fires when the named thing is grounded (or is exit criteria,
 * which are always gate-derived), so genuine gaps are left intact.
 */
export function isGroundedDirective(text: string, grounding: PlanGrounding): boolean {
  const lower = (text ?? "").toLowerCase();
  if (EXIT_CRITERIA.test(lower)) return true;
  const directs = (noun: string) =>
    new RegExp(`\\b${PROVIDE_VERB}\\b[\\w\\s,/'"()-]{0,40}?\\b${noun}\\b`, "i").test(lower);
  if (grounding.hasTimeline && directs(TIMELINE_NOUN)) return true;
  if (grounding.hasOwners && directs(OWNER_NOUN)) return true;
  if (grounding.hasObjective && directs(OBJECTIVE_NOUN)) return true;
  if (grounding.hasKpis && directs(KPI_NOUN)) return true;
  return false;
}

/**
 * True when a persisted change-request decision provably contradicts current
 * programme state (see {@link isGroundedAbsenceClaim}). Non-PCR decisions always
 * return false — a gate approval or escalation that merely mentions "objectives"
 * in passing is never touched.
 */
export function isGroundedFalsePositiveDecision(
  decision: DecisionSummary,
  grounding: PlanGrounding,
): boolean {
  if (!PCR_DECISION_TYPES.has(decision.type)) return false;
  const text = `${decision.title ?? ""} ${decision.question ?? ""} ${decision.recommendation ?? ""}`;
  return isGroundedAbsenceClaim(text, grounding);
}
