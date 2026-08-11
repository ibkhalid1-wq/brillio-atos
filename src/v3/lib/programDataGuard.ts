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
  // Action side-channels: these exist (or appear) even on a skeleton state —
  // a mint or an attestation fired pre-hydration must NOT make an otherwise
  // empty payload look like real content. This is exactly how the 2026-07-13
  // clobber slipped past the guard: the payload was empty except for the
  // link pack the action had just appended.
  "flowattestations",
  "flowinterviewpacks",
  "flowdemoinvites",
  "flowapprovalpacks",
  "flowportalinbox",
  "flowoperatoroverrides",
  // The DESIGN REVIEW ROUND (`flowDesignRound.ts`) is the same shape of append-only
  // side-channel as the packs above: opening a round writes `flowDesignRounds` plus an
  // attestation and nothing else, so a round opened against a half-hydrated programme
  // would make an otherwise-empty payload read as real content — the exact 2026-07-13
  // clobber shape with a different key on it.
  "flowdesignrounds",
  "programsnapshots",
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
