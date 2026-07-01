/**
 * Design-decision projection.
 *
 * The "Key design decisions" grid in the Design phase used to be a blank table a
 * PM hand-filled BEFORE the Solution Architecture agent ran — tedious, and
 * redundant: that agent already emits the same content. Its structured output
 * (top-level `solutionArchitecture.architectureDecisions`, produced by run-agent)
 * carries `{ decision, rationale, alternatives[] }` per decision, which maps 1:1
 * onto the grid's columns.
 *
 * This module owns the pure mapping from that agent output to grid-shaped rows so
 * the panel can offer the agent's draft as a review surface — the agent drafts,
 * the human curates — instead of a blank grid. It is read-only: nothing is
 * written to program.data here. The projection is only adopted into the editable
 * grid (and later persisted) by an explicit user action in the panel.
 *
 * The row keys MUST stay in lockstep with the `keyDesignDecisions` grid columns
 * declared in methodology.ts (decision / optionsConsidered / rationale).
 */

/** A projected decision row, keyed by the keyDesignDecisions grid column keys. */
export interface ProjectedDecisionRow {
  decision: string;
  optionsConsidered: string;
  rationale: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Join a heterogeneous alternatives value into a single "options considered" cell. */
function joinAlternatives(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : entry == null ? "" : String(entry).trim()))
      .filter((entry) => entry.length > 0)
      .join(", ");
  }
  return asTrimmedString(value);
}

/**
 * Resolve the program data root that holds the top-level formal-artifact mirrors.
 * Accepts either the raw row (`{ data: {...} }`) or an already-unwrapped data
 * object, mirroring the `inner = rawData.data ?? rawData` convention used across
 * the app.
 */
function resolveDataRoot(rawData: unknown): Record<string, unknown> | null {
  if (!isObject(rawData)) return null;
  if (isObject(rawData.data)) return rawData.data;
  return rawData;
}

/**
 * Project the Solution Architecture agent's `architectureDecisions` into rows
 * shaped for the keyDesignDecisions grid. Returns [] when the agent has not run
 * or produced no usable decisions. A row is emitted only when it has a non-empty
 * `decision` (the grid's lead column) — so a rationale/alternatives fragment with
 * no decision never becomes a ghost row.
 */
export function projectArchitectureDecisions(rawData: unknown): ProjectedDecisionRow[] {
  const root = resolveDataRoot(rawData);
  if (!root) return [];
  const doc = root.solutionArchitecture;
  if (!isObject(doc)) return [];
  const decisions = doc.architectureDecisions;
  if (!Array.isArray(decisions)) return [];

  const rows: ProjectedDecisionRow[] = [];
  for (const entry of decisions) {
    if (!isObject(entry)) continue;
    const decision = asTrimmedString(entry.decision);
    if (!decision) continue;
    rows.push({
      decision,
      optionsConsidered: joinAlternatives(entry.alternatives),
      rationale: asTrimmedString(entry.rationale),
    });
  }
  return rows;
}
