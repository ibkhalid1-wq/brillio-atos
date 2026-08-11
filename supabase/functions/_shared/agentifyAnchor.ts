/**
 * ANCHORING AGENTIFY AT GENERATION TIME (edge half).
 *
 * Agentify re-emits the Current-State Atlas's workflows with a call on each step.
 * The claims ledger, though, is derived from the ATLAS, so a claim on a step is
 * filed under an element id built from the atlas's own text. The two copies agree
 * exactly once — the moment the generator returns, having been told to carry the
 * atlas forward verbatim — and every operator edit afterwards is a chance for them
 * to stop agreeing. So the correspondence is written down HERE, while it is still
 * true, as an id on each workflow and step.
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

/**
 * Stamp a generated Agentify result with the atlas element ids its workflows and
 * steps were drafted from. No-op for any other artifact, and for a programme with no
 * atlas yet. An existing anchor is never overwritten; a workflow or step the atlas
 * does not hold is left unanchored rather than given a fabricated id.
 */
export function anchorAgentifyToAtlas(
  fieldKey: string,
  result: Record<string, unknown>,
  atlasWorkflows: Array<Record<string, unknown>>,
): void {
  if (fieldKey !== "agentify" || !atlasWorkflows.length) return;
  const emitted = arr(result.workflows).filter(isRec);
  if (!emitted.length) return;

  const byName = new Map<string, Record<string, unknown>>();
  for (const w of atlasWorkflows) {
    const k = key(w.name);
    if (k && !byName.has(k)) byName.set(k, w);   // first wins; a duplicate name is not a second identity
  }

  for (const wf of emitted) {
    const source = byName.get(key(wf.name));
    if (!source) continue;
    const wid = workflowElementId(source.name);
    if (!str(wf[ATLAS_WORKFLOW_ID])) wf[ATLAS_WORKFLOW_ID] = wid;

    // The atlas's steps under both readings of a step's identity: strict
    // (actor + action) and loose (action alone, for a step whose actor was retyped).
    const strict = new Map<string, Record<string, unknown>>();
    const loose = new Map<string, Record<string, unknown>>();
    for (const st of arr(source.steps).filter(isRec)) {
      const action = key(stepName(st.action));
      if (!action) continue;
      const both = `${key(st.actor)} ${action}`;
      if (!strict.has(both)) strict.set(both, st);
      if (!loose.has(action)) loose.set(action, st);
    }

    for (const step of arr(wf.steps).filter(isRec)) {
      if (str(step[ATLAS_STEP_ID])) continue;
      const action = key(stepName(step.action));
      const twin = strict.get(`${key(step.actor)} ${action}`) ?? loose.get(action);
      if (twin) step[ATLAS_STEP_ID] = stepElementId(wid, twin.actor, twin.action);
    }
  }
}
