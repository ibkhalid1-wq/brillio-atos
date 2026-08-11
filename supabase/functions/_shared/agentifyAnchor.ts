/**
 * ANCHORING AGENTIFY AT GENERATION TIME (edge half).
 *
 * Agentify's calls are about the Current-State ATLAS's steps, and the claims ledger
 * is derived from the ATLAS, so a claim on a step is filed under an element id built
 * from the atlas's own text. What the generator returns is TEXT — a workflow name and
 * a step action — and text agrees with the atlas exactly once: the moment the
 * generator returns, having been told to name each step the Atlas's way. Every
 * operator edit afterwards is a chance for it to stop agreeing. So the correspondence
 * is written down HERE, while it is still true, as an id.
 *
 * TWO SHAPES, ONE RULE. The generator now emits DECISIONS — one row per step it has
 * an opinion about — and each row is stamped with `_stepId`, the atlas step id the
 * client files its own decisions under (src/v3/lib/ledger/agentifyDecisions.ts). A
 * document in the OLD shape (`workflows[].steps[].mode`, a copy of the atlas carried
 * forward) is still stamped with `_atlasWorkflowId` / `_atlasStepId`: the prompt no
 * longer asks for it, but a model that returns it anyway must not have its calls
 * silently stranded — that is the shape readDecisions harvests legacy modes through.
 *
 * WHY THE EDGE AND NOT ONLY THE CLIENT. The client stamps too (see
 * src/v3/lib/ledger/agentifyAnchor.ts), from the document as it stands, which covers
 * every document generated before anchoring existed. What it cannot cover is the
 * window between generation and the operator's first edit: if the Atlas is
 * re-synthesised in that window, the client has nothing left to match against, and a
 * step whose evidence genuinely moved would read as a step that never had any. Born
 * anchored, it reads STRANDED instead — which is the truth.
 *
 * THIS IS A SECOND COPY of the client's stamping rule, and the repo's usual reason
 * applies (the edge is self-contained; no edge file imports src/ — see the note on
 * contentId in ledgerGenerator.ts). The lockstep is enforced by a test that runs BOTH
 * implementations over the same fixture and asserts identical output —
 * src/v3/__tests__/agentifyLedgerAnchor.test.ts §"client and edge stamp identically".
 *
 * Deterministic, pure, idempotent: no clock, no randomness, and a second pass over an
 * already-anchored result changes nothing. Mutates `result` in place, exactly as
 * tagArtifactAreas does.
 */
import { slug, contentId } from "./ledgerGenerator.ts";

/** Keys are underscore-prefixed: internal provenance, never typeset by DocumentView. */
export const ATLAS_WORKFLOW_ID = "_atlasWorkflowId";
export const ATLAS_STEP_ID = "_atlasStepId";
/** Where the decisions live, and the identity each is filed under — the SAME two
 *  names the client writes with (agentifyDecisions.DECISIONS_FIELD / DECISION_STEP_ID),
 *  so a generated call and an operator's land on one row, not two. */
export const DECISIONS_FIELD = "decisions";
export const DECISION_STEP_ID = "_stepId";

/** How much of an action IS the step, for identity (mirrors migrate.ts STEP_NAME_CHARS). */
const STEP_NAME_CHARS = 60;

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const key = (v: unknown): string => str(v).trim().toLowerCase();
const stepName = (action: unknown): string => str(action).slice(0, STEP_NAME_CHARS);

/** THE ledger element id of an atlas workflow (mirrors migrate.ts workflowElementId). */
export const workflowElementId = (name: unknown): string => `el:wf:${slug(name)}`;
/** THE ledger element id of an atlas step (mirrors migrate.ts stepElementId). */
export const stepElementId = (workflowId: string, actor: unknown, action: unknown): string =>
  contentId("el:step", workflowId, str(actor), stepName(action));

/** The atlas's steps under both readings of a step's identity: strict (actor +
 *  action) and loose (action alone, for a step whose actor was retyped — and the only
 *  reading available to a decision row, which names no actor). First wins in both. */
interface StepIndex {
  strict: Map<string, Record<string, unknown>>;
  loose: Map<string, Record<string, unknown>>;
}

/**
 * Stamp a generated Agentify result with the atlas element ids it was drafted from:
 * `_stepId` on every emitted decision, and — for a result in the old shape —
 * `_atlasWorkflowId` / `_atlasStepId` on its carried-forward workflows and steps.
 *
 * No-op for any other artifact, and for a programme with no atlas yet. An existing
 * anchor is never overwritten. A workflow, step or decision the atlas does not hold
 * is left UNANCHORED rather than given a fabricated id: this stamps, it never edits
 * or discards the model's output, and an unanchored decision simply does not resolve
 * (readDecisions skips a row with no id) — which is the honest reading of a call made
 * about a step nobody does.
 */
export function anchorAgentifyToAtlas(
  fieldKey: string,
  result: Record<string, unknown>,
  atlasWorkflows: Array<Record<string, unknown>>,
): void {
  if (fieldKey !== "agentify" || !atlasWorkflows.length) return;
  const decisions = arr(result[DECISIONS_FIELD]).filter(isRec);
  const emitted = arr(result.workflows).filter(isRec);
  if (!decisions.length && !emitted.length) return;

  const byName = new Map<string, Record<string, unknown>>();
  for (const w of atlasWorkflows) {
    const k = key(w.name);
    if (k && !byName.has(k)) byName.set(k, w);   // first wins; a duplicate name is not a second identity
  }

  const indexes = new Map<Record<string, unknown>, StepIndex>();
  const stepIndex = (source: Record<string, unknown>): StepIndex => {
    const cached = indexes.get(source);
    if (cached) return cached;
    const index: StepIndex = { strict: new Map(), loose: new Map() };
    for (const st of arr(source.steps).filter(isRec)) {
      const action = key(stepName(st.action));
      if (!action) continue;
      const both = `${key(st.actor)} ${action}`;
      if (!index.strict.has(both)) index.strict.set(both, st);
      if (!index.loose.has(action)) index.loose.set(action, st);
    }
    indexes.set(source, index);
    return index;
  };

  // ── the shape the generator emits now: a decision names its step in the Atlas's
  // own words, and the words are turned into the id here, once, while they agree.
  for (const row of decisions) {
    if (str(row[DECISION_STEP_ID])) continue;
    const source = byName.get(key(row.workflow));
    if (!source) continue;
    // A decision row carries no actor, so only the loose reading is available to it.
    const twin = stepIndex(source).loose.get(key(stepName(row.step)));
    if (twin) row[DECISION_STEP_ID] = stepElementId(workflowElementId(source.name), twin.actor, twin.action);
  }

  // ── the old shape: a copy of the atlas's workflows with a mode on each step. The
  // prompt no longer asks for it; a model that returns it anyway is still anchored,
  // because that is how readDecisions harvests those calls.
  for (const wf of emitted) {
    const source = byName.get(key(wf.name));
    if (!source) continue;
    const wid = workflowElementId(source.name);
    if (!str(wf[ATLAS_WORKFLOW_ID])) wf[ATLAS_WORKFLOW_ID] = wid;

    const { strict, loose } = stepIndex(source);
    for (const step of arr(wf.steps).filter(isRec)) {
      if (str(step[ATLAS_STEP_ID])) continue;
      const action = key(stepName(step.action));
      const twin = strict.get(`${key(step.actor)} ${action}`) ?? loose.get(action);
      if (twin) step[ATLAS_STEP_ID] = stepElementId(wid, twin.actor, twin.action);
    }
  }
}
