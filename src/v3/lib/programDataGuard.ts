/**
 * Data-loss guard for program persistence.
 *
 * The program list loads metadata first and hydrates each program's `data` blob
 * lazily, so `program.rawData` is briefly `{}` after a program is opened. If a
 * save fires in that window it carries an empty payload, and the optimistic
 * `updated_at` check can't catch it (the in-memory timestamp still matches the
 * row) — so the empty blob overwrites real content irrecoverably. This predicate
 * lets a writer detect a content-free payload and refuse to clobber a populated
 * cloud row.
 *
 * "Substantive" means: at least one key that is not pure metadata/provenance and
 * whose value is non-empty. A genuinely new/empty program reads as non-substantive
 * (and may be written freely); a hydrated program with inputs, artifacts, gate
 * reviews, formal mirrors, or snapshots reads as substantive.
 */

// Keys that describe the program but are not its working content.
const META_KEYS = new Set([
  "_syncedat",
  "name",
  "client",
  "industry",
  "objective",
  "id",
  "owner_id",
  "updatedat",
  "created_at",
  "createdat",
  "is_deleted",
  "projectmeta",
]);

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false; // numbers/booleans are content
}

function hasSubstance(root: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(root)) {
    if (META_KEYS.has(key.toLowerCase())) continue;
    if (!isEmptyValue(value)) return true;
  }
  return false;
}

/**
 * True when `data` carries real program content. Accepts either a data root or a
 * `{ data: {...} }` wrapper (one level is unwrapped defensively).
 */
export function hasSubstantiveProgramData(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const root = data as Record<string, unknown>;
  if (hasSubstance(root)) return true;
  const nested = root.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return hasSubstance(nested as Record<string, unknown>);
  }
  return false;
}
