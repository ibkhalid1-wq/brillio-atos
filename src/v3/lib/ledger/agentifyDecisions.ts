/**
 * AGENTIFY STORES DECISIONS, NOT WORKFLOWS.
 *
 * The Current-State Atlas describes the work: the workflows, their steps, who does
 * what in which system, and the full CRUD to change any of it. Agentify makes ONE
 * call about that same work — can this step be agentified — and it is the only
 * thing Agentify decides.
 *
 * The obvious implementation is the one that was there: give Agentify its own
 * `workflows` array, carried forward verbatim from the Atlas, and hang a `mode` on
 * each step. That is a COPY, and it forks on the first keystroke — a rename on
 * either tab and the two documents describe different businesses, with nothing to
 * say which is right. agentifyAnchor exists because of that fork (it re-anchors a
 * drifted copy to the evidence it was drafted from); this module removes the fork
 * instead.
 *
 * So a decision is stored ALONE, under the LEDGER ELEMENT ID of the atlas step it
 * is about:
 *
 *   agentify.decisions = [{ _stepId, workflow, step, mode, rationale }, …]
 *
 *  · `_stepId` is the identity, and the ONLY thing resolution uses. It is built by
 *    migrate.ts's own exported builders, so the id a decision is filed under and the
 *    element the ledger holds are the same function or provably the same nothing.
 *  · `workflow` / `step` are a LEGEND — human text so the typeset document reads as
 *    sentences rather than hashes. Nothing resolves through them, and they are
 *    re-stamped from the Atlas on every write, so they cannot quietly go stale into
 *    something that looks like a second copy.
 *  · underscore-prefixed `_stepId` because that is this codebase's mark for
 *    internal-not-user-facing, and DocumentView skips those keys — an identity must
 *    never typeset as a column.
 *
 * LEGACY. A document generated (or edited) before this shape carries
 * `agentify.workflows[].steps[].mode`. Those decisions are real and are read here,
 * through anchorWorkflowsToAtlas — the same text-match-once-then-write-it-down trick,
 * used at the only moment it is legitimate. They are never written back in that
 * shape: the first new decision migrates the lot into `decisions`.
 *
 * Pure; no React, no store writes. The frozen ledger core is untouched, and the
 * atlas document is never written from here.
 */
import { workflowElementId, stepElementId } from "./migrate";
import { anchorWorkflowsToAtlas, ATLAS_STEP_ID, ATLAS_WORKFLOW_ID } from "./agentifyAnchor";

/** The three exclusive calls, and a fourth state that is NOT a mode: undecided. */
export const AGENTIFY_MODES = ["agentify", "assist", "keep"] as const;
export type AgentifyMode = (typeof AGENTIFY_MODES)[number];

/** Where the decisions live on the Agentify document. */
export const DECISIONS_FIELD = "decisions";
/** The identity a decision is filed under — internal, never typeset. */
export const DECISION_STEP_ID = "_stepId";

export interface StepDecision {
  /** `""` is a call WITHDRAWN — stored (so it beats a legacy copy), never READ:
   *  readDecisions drops it, because "no entry" is what undecided means. */
  mode: AgentifyMode | "";
  rationale: string;
}
/** Atlas step element id → the call made on it. Steps absent from the map are
 *  UNDECIDED, which is a state of its own and never a default dressed up as one. */
export type DecisionMap = Record<string, StepDecision>;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** A recorded mode, or "" when the value is anything else. Never guessed. */
export const asMode = (v: unknown): AgentifyMode | "" => {
  const value = str(v).trim().toLowerCase();
  return (AGENTIFY_MODES as readonly string[]).includes(value) ? value as AgentifyMode : "";
};

/**
 * The id a decision about this step is filed under.
 *
 * The anchor when the step carries one (a document stamped by agentifyAnchor), else
 * derived from the workflow name + actor + action through the SAME builders migrate
 * files its elements with. The two agree by construction: for a step read straight
 * off the Atlas the derivation IS the anchor, which is why Agentify can render the
 * Atlas's own workflows and still key its decisions stably.
 */
export function decisionStepId(
  workflow: Record<string, unknown>,
  step: Record<string, unknown>,
): string {
  const anchored = str(step[ATLAS_STEP_ID]).trim();
  if (anchored) return anchored;
  const wid = str(workflow[ATLAS_WORKFLOW_ID]).trim() || workflowElementId(workflow.name);
  return stepElementId(wid, step.actor, step.action);
}

/** One decision row as stored. */
const rowOf = (id: string, workflow: string, step: string, d: StepDecision): Record<string, unknown> =>
  ({ [DECISION_STEP_ID]: id, workflow, step, mode: d.mode, rationale: d.rationale });

/**
 * Every decision on record, keyed by atlas step id: the legacy copy's `step.mode`
 * first, then the stored `decisions` rows, which WIN — including a row that records
 * `mode: ""`, an operator explicitly clearing a call the generator made. Clearing has
 * to beat the legacy copy or the cleared decision would resurrect on next render.
 */
export function readDecisions(
  agentifyDoc: Record<string, unknown> | null | undefined,
  atlasDoc: Record<string, unknown> | null | undefined,
): DecisionMap {
  const doc = asRecord(agentifyDoc);
  const out: DecisionMap = {};

  // ── legacy: Agentify's own copy of the workflows, carrying a mode per step.
  // Anchored against the Atlas first, so a decision made on a copy that has since
  // been renamed still lands on the step it was about.
  const legacy = anchorWorkflowsToAtlas(asArray(doc.workflows).map(asRecord), atlasDoc);
  for (const wf of legacy) {
    for (const step of asArray(wf.steps).map(asRecord)) {
      const mode = asMode(step.mode);
      if (!mode) continue;
      out[decisionStepId(wf, step)] = { mode, rationale: str(step.modeRationale) };
    }
  }

  // ── the decisions register. Present-and-empty is a decision to un-decide.
  for (const raw of asArray(doc[DECISIONS_FIELD])) {
    const row = asRecord(raw);
    const id = str(row[DECISION_STEP_ID]).trim();
    if (!id) continue;
    const mode = asMode(row.mode);
    if (mode) out[id] = { mode, rationale: str(row.rationale) };
    else delete out[id];
  }
  return out;
}

/** Every atlas step, indexed by the id its decision files under, with the human
 *  labels a reader needs. The legend's single source. */
function atlasIndex(atlasDoc: Record<string, unknown> | null | undefined): Map<string, { workflow: string; step: string }> {
  const index = new Map<string, { workflow: string; step: string }>();
  for (const wf of asArray(asRecord(atlasDoc).workflows).map(asRecord)) {
    for (const step of asArray(wf.steps).map(asRecord)) {
      index.set(decisionStepId(wf, step), { workflow: str(wf.name), step: str(step.action) });
    }
  }
  return index;
}

/**
 * Record (or clear) the call on one step, returning the next Agentify document.
 *
 * Three things happen, and all three are the point:
 *  1. the decision is written under `stepId` — never onto a workflow;
 *  2. any legacy `workflows` copy is MIGRATED into the same register, so the two
 *     shapes cannot both be live and disagree;
 *  3. every row's legend is re-stamped from the Atlas as it stands, so the typeset
 *     document names the step by its current words rather than the words it had when
 *     the call was made. The id never moves; only the legend does.
 *
 * `mode: ""` is stored rather than dropped: it is the record of a decision withdrawn,
 * and it is what makes clearing a generated call stick.
 */
export function writeDecision(
  agentifyDoc: Record<string, unknown> | null | undefined,
  atlasDoc: Record<string, unknown> | null | undefined,
  stepId: string,
  patch: { mode?: AgentifyMode | ""; rationale?: string },
): Record<string, unknown> {
  const doc = { ...asRecord(agentifyDoc) };
  const current = readDecisions(doc, atlasDoc);
  const existing = current[stepId];
  const next: StepDecision = {
    mode: patch.mode !== undefined ? asMode(patch.mode) : (existing?.mode ?? ""),
    rationale: patch.rationale !== undefined ? patch.rationale : (existing?.rationale ?? ""),
  };

  const index = atlasIndex(atlasDoc);
  const stored = asArray(doc[DECISIONS_FIELD]).map(asRecord);
  const label = (id: string, fallback: Record<string, unknown> | undefined) =>
    index.get(id) ?? { workflow: str(fallback?.workflow), step: str(fallback?.step) };

  // Every id that has, or has just been given, a call — legacy included.
  const ids = new Set<string>([...Object.keys(current), ...stored.map((r) => str(r[DECISION_STEP_ID]).trim()).filter(Boolean), stepId]);
  const byId = new Map(stored.map((r) => [str(r[DECISION_STEP_ID]).trim(), r]));
  const rows: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const decision = id === stepId ? next : current[id];
    // Never invent a row for an id nobody has ever decided on.
    if (!decision) continue;
    const { workflow, step } = label(id, byId.get(id));
    rows.push(rowOf(id, workflow, step, decision));
  }

  doc[DECISIONS_FIELD] = rows;
  // The copy is retired, not kept in parallel: its decisions are now in the register
  // above, and leaving the array behind would let a stale `mode` argue with them.
  if (Array.isArray(doc.workflows)) delete doc.workflows;
  return doc;
}
