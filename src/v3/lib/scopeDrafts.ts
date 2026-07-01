/**
 * Discover scope-boundary projection.
 *
 * The Discover phase's `scopeInclusions` / `scopeExclusions` grids used to be
 * blank tables a PM hand-filled — tedious, and redundant with work already done
 * upstream: the Strategy Transformation Charter agent emits `inScope` /
 * `outOfScope` string arrays as part of setting the programme's boundary. Those
 * map directly onto each grid's lead column, so the panel can offer the charter's
 * boundary as a review draft — the charter states it, the human curates and tags
 * the type — instead of a blank grid.
 *
 * This module owns the pure mapping from that charter output to grid-shaped rows.
 * It is read-only: nothing is written to program.data here. The projection is only
 * adopted into the editable grid (and later persisted) by an explicit user action
 * in the panel.
 *
 * The row keys MUST stay in lockstep with the `scopeInclusions` / `scopeExclusions`
 * grid columns declared in methodology.ts (item / category). `category` is left
 * empty for the human to tag (process / system / geography), since the charter
 * states the scope item but not its type.
 */

/** A projected scope row, keyed by the scope grids' column keys. */
export interface ProjectedScopeRow {
  item: string;
  category: string;
  // Index signature mirrors GridRow so a projected row is assignable wherever a
  // generic grid row (Record<string, string>) is expected — e.g. the draft banner.
  [key: string]: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
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

/** Project a charter scope array (`inScope` or `outOfScope`) into grid rows. */
function projectCharterScope(rawData: unknown, key: "inScope" | "outOfScope"): ProjectedScopeRow[] {
  const root = resolveDataRoot(rawData);
  if (!root) return [];
  const doc = root.transformationCharter;
  if (!isObject(doc)) return [];
  const items = doc[key];
  if (!Array.isArray(items)) return [];

  const rows: ProjectedScopeRow[] = [];
  const seen = new Set<string>();
  for (const entry of items) {
    const item = asTrimmedString(entry);
    if (!item) continue;
    // De-duplicate on the item text so a repeated charter line never doubles up.
    const dedupeKey = item.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push({ item, category: "" });
  }
  return rows;
}

/**
 * Project the Transformation Charter's `inScope` into rows shaped for the
 * `scopeInclusions` grid. Returns [] when the charter has not run or names no
 * in-scope items.
 */
export function projectCharterInScope(rawData: unknown): ProjectedScopeRow[] {
  return projectCharterScope(rawData, "inScope");
}

/**
 * Project the Transformation Charter's `outOfScope` into rows shaped for the
 * `scopeExclusions` grid. Returns [] when the charter has not run or names no
 * exclusions.
 */
export function projectCharterOutOfScope(rawData: unknown): ProjectedScopeRow[] {
  return projectCharterScope(rawData, "outOfScope");
}
